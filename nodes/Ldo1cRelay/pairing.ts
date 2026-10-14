import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
	NodeOperationError,
	UserError,
	type IDataObject,
	type IExecuteFunctions,
	type INodePropertyOptions,
} from 'n8n-workflow';
import { connectionUrl, requiredCredential } from './connection';
import { queueColumns } from './queue-schema';
import type { QueueContext, QueueRow } from './queue';

const protocol = 'ldo.queue.connection/1';
const prefix = 'LDO 1C / ';
const codePrefix = 'ldo_n8n_pair_v1:';
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export interface ConnectionManifest extends IDataObject {
	protocol: string;
	name: string;
	pairing_id: string;
	pairing_hash: string;
	expires_at: number;
	gateway_url: string;
	workflow_id: string;
	token_hash: string;
	request_hash: string;
	policy_serial: number;
	capabilities: IDataObject;
}
export function secretHash(value: string) {
	return createHash('sha256').update(value).digest('hex');
}
export function matchesSecret(value: unknown, expected: string) {
	return (
		typeof value === 'string' &&
		/^[a-f0-9]{64}$/.test(expected) &&
		timingSafeEqual(Buffer.from(secretHash(value), 'hex'), Buffer.from(expected, 'hex'))
	);
}
function object(value: unknown): value is IDataObject {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}
function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (object(value))
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
			.join(',')}}`;
	return JSON.stringify(value);
}
export async function n8nQueueRequest<T>(
	context: QueueContext,
	method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
	path: string,
	body?: IDataObject,
	qs?: IDataObject,
): Promise<T> {
	const credential = await context.getCredentials('ldo1cQueueApi');
	const url = connectionUrl(requiredCredential(credential, 'apiUrl'), true);
	requiredCredential(credential, 'apiToken');
	return (await context.helpers.httpRequestWithAuthentication.call(context, 'ldo1cQueueApi', {
		method,
		url: `${url}/api/v1${path}`,
		body,
		qs,
		json: true,
		disableFollowRedirect: true,
		timeout: 30_000,
	})) as T;
}
function tablePath(id: string) {
	if (!id || id.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(id))
		throw new UserError('Select a queue connection');
	return `/data-tables/${encodeURIComponent(id)}`;
}
export function selectedConnection(context: QueueContext) {
	return String(context.getNode().parameters.connectionId ?? '');
}
export async function connectionRecord(context: QueueContext, id = selectedConnection(context)) {
	const result = await n8nQueueRequest<{ data: QueueRow[] }>(
		context,
		'GET',
		`${tablePath(id)}/rows`,
		undefined,
		{
			filter: JSON.stringify({
				type: 'and',
				filters: [{ columnName: 'kind', condition: 'eq', value: 'connection' }],
			}),
			limit: 2,
		},
	);
	if (!Array.isArray(result?.data) || result.data.length !== 1)
		throw new UserError('The connection record is missing or ambiguous');
	const row = result.data[0];
	const manifest = JSON.parse(row.payload) as ConnectionManifest;
	if (
		manifest.protocol !== protocol ||
		!uuidPattern.test(manifest.pairing_id) ||
		!['pending', 'paired', 'disabled', 'setup_failed'].includes(row.status)
	)
		throw new UserError('Invalid queue connection');
	return { row, manifest, tableId: id };
}
export async function validateConnectionTable(
	context: QueueContext,
	id = selectedConnection(context),
) {
	const table = await n8nQueueRequest<{ columns: Array<{ name: string; type: string }> }>(
		context,
		'GET',
		tablePath(id),
	);
	if (
		!Array.isArray(table?.columns) ||
		queueColumns.some(
			(column) =>
				!table.columns.some((saved) => saved.name === column.name && saved.type === column.type),
		)
	)
		throw new UserError('This table does not contain a 1C queue');
	await connectionRecord(context, id);
}
export async function listQueueConnections(context: QueueContext): Promise<INodePropertyOptions[]> {
	const options: INodePropertyOptions[] = [];
	let cursor: string | undefined;
	do {
		const result = await n8nQueueRequest<{
			data: Array<{ id: string; name: string }>;
			nextCursor?: string;
		}>(context, 'GET', '/data-tables', undefined, { limit: 100, ...(cursor ? { cursor } : {}) });
		if (!Array.isArray(result?.data)) throw new UserError('n8n did not return its data tables');
		for (const table of result.data.filter((item) => item.name.startsWith(prefix))) {
			const saved = await connectionRecord(context, table.id);
			if (saved.row.status !== 'setup_failed')
				options.push({ name: `${saved.manifest.name} (${saved.row.status})`, value: table.id });
		}
		cursor = result.nextCursor;
	} while (cursor && options.length < 1000);
	return options;
}
export async function updateConnectionRecord(
	context: QueueContext,
	saved: Awaited<ReturnType<typeof connectionRecord>>,
	manifest: ConnectionManifest,
	fields: IDataObject = {},
) {
	const rows = await n8nQueueRequest<QueueRow[]>(
		context,
		'PATCH',
		`${tablePath(saved.tableId)}/rows/update`,
		{
			filter: {
				type: 'and',
				filters: [
					{ columnName: 'id', condition: 'eq', value: saved.row.id },
					{ columnName: 'kind', condition: 'eq', value: 'connection' },
					{ columnName: 'status', condition: 'eq', value: saved.row.status },
					{ columnName: 'payload', condition: 'eq', value: saved.row.payload },
				],
			},
			data: { ...fields, payload: JSON.stringify(manifest) },
			returnData: true,
		},
	);
	if (!Array.isArray(rows) || rows.length !== 1)
		throw new UserError('The queue connection changed concurrently; refresh its status');
	return { row: rows[0], manifest, tableId: saved.tableId };
}
function encodePairing(manifest: ConnectionManifest, secret: string) {
	return (
		codePrefix +
		Buffer.from(
			JSON.stringify({
				gateway_url: manifest.gateway_url,
				pairing_id: manifest.pairing_id,
				pairing_secret: secret,
				expires_at: manifest.expires_at,
			}),
		).toString('base64')
	);
}
export async function createQueueConnection(
	context: IExecuteFunctions,
	name: string,
	publicUrl = '',
) {
	if (!name.trim() || name.length > 60)
		throw new UserError('Use a connection name between 1 and 60 characters');
	const credential = context.getNode().credentials?.ldo1cQueueApi;
	if (!credential?.id)
		throw new UserError('Select and save an n8n queue credential before creating the connection');
	const credentials = await context.getCredentials('ldo1cQueueApi');
	const publicBase = connectionUrl(publicUrl || requiredCredential(credentials, 'apiUrl'), true);
	const table = await n8nQueueRequest<{ id: string }>(context, 'POST', '/data-tables', {
		name: prefix + name,
		columns: queueColumns,
	});
	if (!table?.id) throw new UserError('n8n did not confirm the connection table');
	const secret = randomBytes(32).toString('hex');
	const webhookId = randomUUID();
	const manifest: ConnectionManifest = {
		protocol,
		name,
		pairing_id: randomUUID(),
		pairing_hash: secretHash(secret),
		expires_at: Date.now() + 15 * 60_000,
		gateway_url: `${publicBase}/webhook/${webhookId}/1c-queue`,
		workflow_id: '',
		token_hash: '',
		request_hash: '',
		policy_serial: 0,
		capabilities: {},
	};
	await n8nQueueRequest(context, 'POST', `${tablePath(table.id)}/rows`, {
		returnType: 'all',
		data: [
			{
				database_id: '',
				profile_id: '',
				policy_revision: '',
				kind: 'connection',
				command_id: manifest.pairing_id,
				command_type: protocol,
				payload: JSON.stringify(manifest),
				status: 'pending',
				lease_token: '',
				lease_until: 0,
				attempt_count: 0,
				ready_at: 0,
				result: '',
			},
		],
	});
	try {
		const workflow = await n8nQueueRequest<{ id: string }>(context, 'POST', '/workflows', {
			name: `LDO 1C Queue Gateway / ${name}`,
			nodes: [
				{
					id: randomUUID(),
					name: '1C Queue Gateway',
					type: 'n8n-nodes-ldo-1c-relay.ldo1cQueueTrigger',
					typeVersion: 2,
					position: [300, 300],
					webhookId,
					parameters: { connectionId: table.id },
					credentials: { ldo1cQueueApi: credential },
				},
			],
			connections: {},
			settings: {
				executionOrder: 'v1',
				saveManualExecutions: false,
				saveDataSuccessExecution: 'none',
				saveDataErrorExecution: 'none',
			},
		});
		if (!workflow?.id) throw new UserError('n8n did not confirm the gateway workflow');
		manifest.workflow_id = workflow.id;
		await updateConnectionRecord(context, await connectionRecord(context, table.id), manifest);
		await n8nQueueRequest(
			context,
			'POST',
			`/workflows/${encodeURIComponent(workflow.id)}/activate`,
			{},
		);
		return {
			connection_id: table.id,
			name,
			pairing_code: encodePairing(manifest, secret),
			expires_at: new Date(manifest.expires_at).toISOString(),
			gateway_url: manifest.gateway_url,
			workflow_id: workflow.id,
		};
	} catch {
		const saved = await connectionRecord(context, table.id);
		await updateConnectionRecord(
			context,
			saved,
			{ ...saved.manifest, pairing_hash: '' },
			{ status: 'setup_failed' },
		);
		throw new NodeOperationError(
			context.getNode(),
			'Gateway setup failed. Check data-table and workflow create/activate API permissions. The connection is not available.',
		);
	}
}
export async function queueConnectionStatus(context: QueueContext) {
	const saved = await connectionRecord(context);
	return {
		connection_id: saved.tableId,
		name: saved.manifest.name,
		status: saved.row.status,
		database_id: saved.row.database_id,
		profile_id: saved.row.profile_id,
		policy_revision: saved.row.policy_revision,
		gateway_url: saved.manifest.gateway_url,
		workflow_id: saved.manifest.workflow_id,
	};
}
export async function renewQueuePairing(context: QueueContext) {
	const saved = await connectionRecord(context);
	if (!['pending', 'disabled'].includes(saved.row.status))
		throw new UserError('Disconnect the existing connection before pairing another database');
	const secret = randomBytes(32).toString('hex');
	const manifest = {
		...saved.manifest,
		pairing_id: randomUUID(),
		pairing_hash: secretHash(secret),
		expires_at: Date.now() + 15 * 60_000,
		token_hash: '',
		request_hash: '',
		policy_serial: 0,
		capabilities: {},
	};
	await updateConnectionRecord(context, saved, manifest, {
		status: 'pending',
		database_id: '',
		profile_id: '',
		policy_revision: '',
	});
	await n8nQueueRequest(
		context,
		'POST',
		`/workflows/${encodeURIComponent(manifest.workflow_id)}/activate`,
		{},
	);
	return {
		connection_id: saved.tableId,
		pairing_code: encodePairing(manifest, secret),
		expires_at: new Date(manifest.expires_at).toISOString(),
	};
}
export async function disconnectQueue(context: QueueContext) {
	const saved = await connectionRecord(context);
	await updateConnectionRecord(
		context,
		saved,
		{ ...saved.manifest, pairing_hash: '', token_hash: '' },
		{ status: 'disabled' },
	);
	await n8nQueueRequest(
		context,
		'POST',
		`/workflows/${encodeURIComponent(saved.manifest.workflow_id)}/deactivate`,
		{},
	);
	return { connection_id: saved.tableId, status: 'disabled' };
}
function policyDescription(body: IDataObject) {
	const capabilities = body.capabilities;
	if (
		!uuidPattern.test(String(body.database_id)) ||
		!uuidPattern.test(String(body.profile_id)) ||
		!uuidPattern.test(String(body.policy_revision)) ||
		!Number.isSafeInteger(body.policy_serial) ||
		Number(body.policy_serial) < 1 ||
		!object(capabilities) ||
		capabilities.contract_version !== '1.0' ||
		capabilities.policy_revision !== body.policy_revision ||
		!Array.isArray(capabilities.object_types) ||
		Buffer.byteLength(JSON.stringify(capabilities)) > 256 * 1024
	)
		throw new UserError('Invalid database profile description');
	return capabilities;
}
export async function pairQueue(context: QueueContext, body: IDataObject, pairingToken: unknown) {
	const saved = await connectionRecord(context);
	if (
		body.contract_version !== '1.0' ||
		body.pairing_id !== saved.manifest.pairing_id ||
		!matchesSecret(pairingToken, saved.manifest.pairing_hash)
	)
		throw new UserError('Invalid pairing code');
	const requestHash = secretHash(canonical(body));
	const acknowledge = (row: QueueRow) => ({
		status: 'paired',
		contract_version: '1.0',
		connection_id: saved.tableId,
		pairing_id: body.pairing_id,
		database_id: row.database_id,
		profile_id: row.profile_id,
		policy_revision: body.policy_revision,
	});
	// An exact retry restores a lost acknowledgement, never rebinds a used code.
	if (saved.row.status === 'paired' && requestHash === saved.manifest.request_hash)
		return acknowledge(saved.row);
	if (saved.row.status !== 'pending' || Date.now() >= saved.manifest.expires_at)
		throw new UserError('The pairing code has expired or was already used');
	const capabilities = policyDescription(body);
	if (
		typeof body.queue_token !== 'string' ||
		body.queue_token.length < 64 ||
		body.queue_token.length > 256
	)
		throw new UserError('Invalid queue exchange key');
	const updated = await updateConnectionRecord(
		context,
		saved,
		{
			...saved.manifest,
			token_hash: secretHash(body.queue_token),
			request_hash: requestHash,
			policy_serial: Number(body.policy_serial),
			capabilities,
		},
		{
			status: 'paired',
			database_id: body.database_id,
			profile_id: body.profile_id,
			policy_revision: body.policy_revision,
		},
	);
	return acknowledge(updated.row);
}
export async function synchronizeQueuePolicy(
	context: QueueContext,
	body: IDataObject,
	saved: Awaited<ReturnType<typeof connectionRecord>>,
) {
	const capabilities = policyDescription(body);
	if (
		Number(body.policy_serial) < saved.manifest.policy_serial ||
		(Number(body.policy_serial) === saved.manifest.policy_serial &&
			(body.policy_revision !== saved.row.policy_revision ||
				canonical(capabilities) !== canonical(saved.manifest.capabilities)))
	)
		throw new UserError('A stale or conflicting policy cannot replace the current queue profile');
	if (Number(body.policy_serial) === saved.manifest.policy_serial) return saved;
	return await updateConnectionRecord(
		context,
		saved,
		{ ...saved.manifest, policy_serial: Number(body.policy_serial), capabilities },
		{ policy_revision: body.policy_revision },
	);
}
export async function retireStaleCommands(
	context: QueueContext,
	saved: Awaited<ReturnType<typeof connectionRecord>>,
) {
	const result = await n8nQueueRequest<{ data: QueueRow[] }>(
		context,
		'GET',
		`${tablePath(saved.tableId)}/rows`,
		undefined,
		{
			filter: JSON.stringify({
				type: 'and',
				filters: [
					{ columnName: 'database_id', condition: 'eq', value: saved.row.database_id },
					{ columnName: 'profile_id', condition: 'eq', value: saved.row.profile_id },
					{ columnName: 'kind', condition: 'eq', value: 'command' },
					{ columnName: 'status', condition: 'eq', value: 'pending' },
				],
			}),
			limit: 100,
			sortBy: 'id:asc',
		},
	);
	if (!Array.isArray(result?.data)) throw new UserError('Invalid pending queue response');
	for (const row of result.data.filter(
		(item) => item.policy_revision !== saved.row.policy_revision,
	)) {
		await n8nQueueRequest(context, 'PATCH', `${tablePath(saved.tableId)}/rows/update`, {
			filter: {
				type: 'and',
				filters: [
					{ columnName: 'id', condition: 'eq', value: row.id },
					{ columnName: 'status', condition: 'eq', value: 'pending' },
					{ columnName: 'policy_revision', condition: 'eq', value: row.policy_revision },
				],
			},
			data: {
				status: 'completed',
				result: JSON.stringify({
					contract_version: '1.0',
					command_id: row.command_id,
					command_type: row.command_type,
					status: 'failed',
					error: {
						code: 'policy_revision_changed',
						message: 'The local policy changed before this command was executed',
						retryable: false,
					},
				}),
			},
			returnData: true,
		});
	}
}
export async function connectionCommandRow(
	context: QueueContext,
	saved: Awaited<ReturnType<typeof connectionRecord>>,
	id: number,
) {
	const result = await n8nQueueRequest<{ data: QueueRow[] }>(
		context,
		'GET',
		`${tablePath(saved.tableId)}/rows`,
		undefined,
		{
			filter: JSON.stringify({
				type: 'and',
				filters: [
					{ columnName: 'id', condition: 'eq', value: id },
					{ columnName: 'database_id', condition: 'eq', value: saved.row.database_id },
					{ columnName: 'profile_id', condition: 'eq', value: saved.row.profile_id },
					{ columnName: 'kind', condition: 'eq', value: 'command' },
				],
			}),
			limit: 1,
		},
	);
	if (!result?.data?.[0]) throw new UserError('The command is not part of this connection');
	return result.data[0];
}
