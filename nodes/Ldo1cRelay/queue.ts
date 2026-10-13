import { randomUUID } from 'node:crypto';
import {
	sleep,
	UserError,
	type IDataObject,
	type IExecuteFunctions,
	type ILoadOptionsFunctions,
	type IHookFunctions,
	type IWebhookFunctions,
} from 'n8n-workflow';
import { connectionUrl, requiredCredential } from './connection';

export type QueueContext =
	| IExecuteFunctions
	| ILoadOptionsFunctions
	| IWebhookFunctions
	| IHookFunctions;
type Filter = { columnName: string; condition: 'eq' | 'lte'; value: string | number };
export interface QueueRow extends IDataObject {
	id: number;
	kind: string;
	command_id: string;
	command_type: string;
	payload: string;
	status: string;
	lease_token: string;
	lease_until: number;
	attempt_count: number;
	ready_at: number;
	result: string;
}

export const queueColumns = [
	...[
		'database_id',
		'profile_id',
		'policy_revision',
		'kind',
		'command_id',
		'command_type',
		'payload',
		'status',
		'lease_token',
		'result',
	].map((name) => ({ name, type: 'string' })),
	...['lease_until', 'attempt_count', 'ready_at'].map((name) => ({ name, type: 'number' })),
];

const commandTypes = new Set([
	'capabilities.get',
	'document.get',
	'document.fields.update',
	'catalog.get',
	'catalog.fields.update',
	'reference.search',
	'document.file.prepare',
	'process.start',
	'process.get',
	'process.transition',
	'process.fields.update',
	'process.cancel',
]);
const eventTypes = new Set(['approval.started', 'document.approved', 'document.rejected']);

export async function queueConfiguration(context: QueueContext) {
	const credentials = await context.getCredentials('ldo1cQueueApi');
	for (const field of [
		'apiUrl',
		'apiToken',
		'tableId',
		'databaseId',
		'profileId',
		'policyRevision',
		'queueToken',
	])
		requiredCredential(credentials, field);
	if (String(credentials.queueToken).length < 32)
		throw new UserError('Use a queue token with at least 32 random characters');
	return {
		apiUrl: connectionUrl(credentials.apiUrl, true),
		tableId: String(credentials.tableId),
		databaseId: String(credentials.databaseId),
		profileId: String(credentials.profileId),
		policyRevision: String(credentials.policyRevision),
		queueToken: String(credentials.queueToken),
		minimumWaitSeconds: Number(credentials.minimumWaitSeconds ?? 900),
	};
}

async function tableRequest<T>(
	context: QueueContext,
	method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
	suffix = '',
	body?: IDataObject,
	qs?: IDataObject,
): Promise<T> {
	const config = await queueConfiguration(context);
	return (await context.helpers.httpRequestWithAuthentication.call(context, 'ldo1cQueueApi', {
		method,
		url: `${config.apiUrl}/api/v1/data-tables/${encodeURIComponent(config.tableId)}${suffix}`,
		body,
		qs,
		json: true,
		disableFollowRedirect: true,
		timeout: 30_000,
	})) as T;
}

export async function validateQueueTable(context: QueueContext) {
	const table = await tableRequest<{ columns: Array<{ name: string; type: string }> }>(
		context,
		'GET',
	);
	if (
		!Array.isArray(table?.columns) ||
		queueColumns.some(
			(column) =>
				!table.columns.some(
					(existing) => existing.name === column.name && existing.type === column.type,
				),
		)
	) {
		throw new UserError('The configured data table does not have the required 1C queue schema');
	}
}

async function filters(context: QueueContext, extra: Filter[]) {
	const config = await queueConfiguration(context);
	return {
		type: 'and',
		filters: [
			{ columnName: 'database_id', condition: 'eq', value: config.databaseId },
			{ columnName: 'profile_id', condition: 'eq', value: config.profileId },
			{ columnName: 'policy_revision', condition: 'eq', value: config.policyRevision },
			...extra,
		],
	};
}

export async function queueRows(context: QueueContext, extra: Filter[], sortBy = 'id:asc') {
	const result = await tableRequest<{ data: QueueRow[] }>(context, 'GET', '/rows', undefined, {
		filter: JSON.stringify(await filters(context, extra)),
		limit: 100,
		sortBy,
	});
	if (!result || !Array.isArray(result.data))
		throw new UserError('n8n returned an invalid queue table response');
	return result.data;
}

async function update(context: QueueContext, extra: Filter[], data: IDataObject) {
	const result = await tableRequest<QueueRow[]>(context, 'PATCH', '/rows/update', {
		filter: await filters(context, extra),
		data,
		returnData: true,
	});
	if (!Array.isArray(result)) throw new UserError('n8n returned an invalid queue update response');
	return result;
}

function rowFilter(row: QueueRow): Filter[] {
	return [
		{ columnName: 'id', condition: 'eq', value: row.id },
		{ columnName: 'status', condition: 'eq', value: row.status },
		{ columnName: 'lease_token', condition: 'eq', value: row.lease_token },
		{ columnName: 'attempt_count', condition: 'eq', value: row.attempt_count },
	];
}

async function insert(
	context: QueueContext,
	kind: string,
	commandId: string,
	type: string,
	payload: IDataObject,
) {
	const config = await queueConfiguration(context);
	const serialized = JSON.stringify(payload);
	if (Buffer.byteLength(serialized) > 1024 * 1024)
		throw new UserError('A queue command or event cannot exceed 1 MiB');
	const existing = await queueRows(context, [
		{ columnName: 'kind', condition: 'eq', value: kind },
		{ columnName: 'command_id', condition: 'eq', value: commandId },
	]);
	if (existing.length) {
		if (existing.some((row) => row.command_type !== type || row.payload !== serialized))
			throw new UserError('This queue identifier was already used for a different payload');
		return existing[0];
	}
	const rows = await tableRequest<QueueRow[]>(context, 'POST', '/rows', {
		returnType: 'all',
		data: [
			{
				database_id: config.databaseId,
				profile_id: config.profileId,
				policy_revision: config.policyRevision,
				kind,
				command_id: commandId,
				command_type: type,
				payload: serialized,
				status: 'pending',
				lease_token: '',
				lease_until: 0,
				attempt_count: 0,
				ready_at: 0,
				result: '',
			},
		],
	});
	if (!Array.isArray(rows) || !rows[0])
		throw new UserError('n8n did not confirm queue persistence');
	return rows[0];
}

export async function enqueueCommand(
	context: QueueContext,
	type: string,
	commandId: string,
	payload: IDataObject,
) {
	const config = await queueConfiguration(context);
	const commandType = type.replace(/^n8n\./, '');
	if (!commandTypes.has(commandType)) throw new UserError('Unsupported 1C queue command');
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(commandId))
		throw new UserError('Use a UUID for the command ID');
	return insert(context, 'command', commandId, commandType, {
		...payload,
		contract_version: '1.0',
		profile_id: config.profileId,
		policy_revision: config.policyRevision,
	});
}

export async function waitCommand(
	context: QueueContext,
	commandId: string,
	timeoutSeconds: number,
	pollSeconds: number,
) {
	if (!Number.isFinite(pollSeconds) || pollSeconds < 1 || pollSeconds > 60)
		throw new UserError('Use a polling interval between 1 and 60 seconds');
	const deadline = Date.now() + timeoutSeconds * 1000;
	do {
		const rows = await queueRows(context, [
			{ columnName: 'kind', condition: 'eq', value: 'command' },
			{ columnName: 'command_id', condition: 'eq', value: commandId },
		]);
		const row = rows.find((item) => item.status === 'completed');
		if (row) {
			const result = JSON.parse(row.result) as IDataObject;
			if (
				result.contract_version !== '1.0' ||
				result.command_id !== commandId ||
				result.command_type !== row.command_type
			)
				throw new UserError('The stored result does not match the queued command');
			if (result.status !== 'succeeded')
				throw new UserError(
					String((result.error as IDataObject)?.message || '1C rejected the queued operation'),
				);
			if (!result.data || Array.isArray(result.data) || typeof result.data !== 'object')
				throw new UserError('1C returned invalid operation data');
			return { commandId, data: result.data as IDataObject };
		}
		if (rows.some((item) => item.status === 'dead'))
			throw new UserError('The command reached the queue attempt limit');
		if (Date.now() >= deadline) break;
		await sleep(pollSeconds * 1000);
	} while (Date.now() < deadline);
	throw new UserError(
		`Queue result for ${commandId} was not received. The command is retained; use the same Command ID to retrieve it without creating another operation.`,
	);
}

export async function commandResult(
	context: QueueContext,
	commandId: string,
): Promise<IDataObject> {
	const rows = await queueRows(context, [
		{ columnName: 'kind', condition: 'eq', value: 'command' },
		{ columnName: 'command_id', condition: 'eq', value: commandId },
	]);
	if (!rows.length) throw new UserError('The command is not present in this queue profile');
	const row = rows.find((item) => item.status === 'completed') || rows[0];
	if (row.status !== 'completed') return { command_id: commandId, status: row.status };
	const result = JSON.parse(row.result) as IDataObject;
	if (
		result.contract_version !== '1.0' ||
		result.command_id !== commandId ||
		result.command_type !== row.command_type
	)
		throw new UserError('The stored result does not match the queued command');
	return { ...result, command_id: commandId };
}

export async function cleanupQueue(context: QueueContext, retentionDays: number) {
	if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 365)
		throw new UserError('Use a retention period between 1 and 365 days');
	const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
	let removed = 0;
	for (const status of ['completed', 'acknowledged']) {
		const result = await tableRequest<QueueRow[]>(context, 'DELETE', '/rows', undefined, {
			filter: JSON.stringify(
				await filters(context, [
					{ columnName: 'status', condition: 'eq', value: status },
					{ columnName: 'createdAt', condition: 'lte', value: cutoff },
				]),
			),
			returnData: true,
		});
		if (!Array.isArray(result))
			throw new UserError('n8n returned an invalid queue cleanup response');
		removed += result.length;
	}
	return { removed, retention_days: retentionDays };
}

export async function queueCapabilities(context: QueueContext) {
	const rows = await queueRows(
		context,
		[
			{ columnName: 'kind', condition: 'eq', value: 'command' },
			{ columnName: 'command_type', condition: 'eq', value: 'capabilities.get' },
			{ columnName: 'status', condition: 'eq', value: 'completed' },
		],
		'id:desc',
	);
	for (const row of rows) {
		const result = JSON.parse(row.result) as IDataObject;
		if (result.status === 'succeeded' && result.data) return result.data;
	}
	throw new UserError('Run Get Capabilities once while the 1C queue poller is active');
}

export async function leaseRows(
	context: QueueContext,
	kind: 'command' | 'event',
	limit = 10,
	selectedTypes: string[] = [],
) {
	const now = Date.now();
	const candidates = [
		...(await queueRows(context, [
			{ columnName: 'kind', condition: 'eq', value: kind },
			{ columnName: 'status', condition: 'eq', value: 'leased' },
			{ columnName: 'lease_until', condition: 'lte', value: now },
		])),
		...(await queueRows(context, [
			{ columnName: 'kind', condition: 'eq', value: kind },
			{ columnName: 'status', condition: 'eq', value: 'pending' },
			{ columnName: 'ready_at', condition: 'lte', value: now },
		])),
	];
	const leased: QueueRow[] = [];
	for (const row of candidates) {
		if (kind === 'event' && selectedTypes.length && !selectedTypes.includes(row.command_type))
			continue;
		if (leased.length >= Math.min(Math.max(limit, 1), 50)) break;
		if (row.attempt_count >= 10) {
			await update(context, rowFilter(row), { status: 'dead' });
			continue;
		}
		const leaseToken = randomUUID();
		const changed = await update(context, rowFilter(row), {
			status: 'leased',
			lease_token: leaseToken,
			lease_until: now + 1_800_000,
			attempt_count: row.attempt_count + 1,
		});
		// SQLite returnData performs a preliminary read. Only our ownership token
		// proves that this request actually acquired the conditional update.
		const owned = changed.find((item) => item.id === row.id && item.lease_token === leaseToken);
		if (owned) leased.push(owned);
	}
	return leased;
}

export async function finishEvent(
	context: QueueContext,
	id: number,
	leaseToken: string,
	retryAfterSeconds?: number,
) {
	if (!Number.isSafeInteger(id) || id < 1 || !leaseToken)
		throw new UserError('An event ID and its lease token are required');
	if (
		retryAfterSeconds !== undefined &&
		(!Number.isFinite(retryAfterSeconds) || retryAfterSeconds < 0 || retryAfterSeconds > 86400)
	)
		throw new UserError('Use a retry delay between 0 and 86400 seconds');
	const changed = await update(
		context,
		[
			{ columnName: 'id', condition: 'eq', value: id },
			{ columnName: 'kind', condition: 'eq', value: 'event' },
			{ columnName: 'status', condition: 'eq', value: 'leased' },
			{ columnName: 'lease_token', condition: 'eq', value: leaseToken },
		],
		{
			status: retryAfterSeconds === undefined ? 'acknowledged' : 'pending',
			ready_at: Date.now() + (retryAfterSeconds ?? 0) * 1000,
			lease_until: 0,
		},
	);
	if (
		!changed.some(
			(row) => row.id === id && row.lease_token === leaseToken && row.status !== 'leased',
		)
	)
		throw new UserError('This event lease is no longer owned by the workflow');
	return { id, status: retryAfterSeconds === undefined ? 'acknowledged' : 'retry_scheduled' };
}

export async function queueRpc(context: QueueContext, body: IDataObject): Promise<IDataObject> {
	if (body.contract_version !== '1.0') throw new UserError('Unsupported queue contract');
	const config = await queueConfiguration(context);
	for (const [key, expected] of [['database_id', config.databaseId], ['profile_id', config.profileId], ['policy_revision', config.policyRevision]]) {
		if (body[key] !== undefined && body[key] !== expected) throw new UserError('The 1C queue settings do not match this gateway profile');
	}
	if (body.action === 'ping') {
		await validateQueueTable(context);
		return { status: 'ok', contract_version: '1.0', database_id: config.databaseId, profile_id: config.profileId, policy_revision: config.policyRevision };
	}
	if (body.action === 'poll') {
		const rows = await leaseRows(context, 'command');
		return {
			commands: rows.map((row) => ({
				id: row.id,
				external_id: row.command_id,
				item_type: `n8n.${row.command_type}`,
				payload: JSON.parse(row.payload),
				lease_token: row.lease_token,
			})),
			contract_version: '1.0',
		};
	}
	if (body.action === 'event') {
		const type = String(body.event_type);
		const eventId = String(body.event_id ?? '');
		if (
			!eventTypes.has(type) ||
			!eventId ||
			eventId.length > 128 ||
			!body.payload ||
			Array.isArray(body.payload) ||
			typeof body.payload !== 'object'
		)
			throw new UserError('Invalid queue event');
		const row = await insert(context, 'event', eventId, type, body.payload as IDataObject);
		return { id: row.id, status: 'accepted' };
	}
	if (body.action === 'result') {
		const result = body.result as IDataObject;
		if (
			!result ||
			result.contract_version !== '1.0' ||
			!['succeeded', 'failed'].includes(String(result.status)) ||
			Buffer.byteLength(JSON.stringify(result)) > 10 * 1024 * 1024
		)
			throw new UserError('Invalid or oversized queue result');
		const rows = await queueRows(context, [
			{ columnName: 'id', condition: 'eq', value: Number(body.id) },
			{ columnName: 'kind', condition: 'eq', value: 'command' },
		]);
		const row = rows[0];
		if (
			!row ||
			result.command_id !== row.command_id ||
			result.command_type !== row.command_type ||
			body.lease_token !== row.lease_token
		)
			throw new UserError('The result does not match the command lease');
		if (row.status === 'completed' && row.result === JSON.stringify(result))
			return { id: row.id, status: 'accepted' };
		if (row.status !== 'leased') throw new UserError('The command lease is no longer active');
		const changed = await update(context, rowFilter(row), {
			status: 'completed',
			result: JSON.stringify(result),
			lease_until: 0,
		});
		if (
			!changed.some(
				(item) =>
					item.id === row.id && item.lease_token === row.lease_token && item.status === 'completed',
			)
		)
			throw new UserError('The command lease changed while saving the result');
		return { id: row.id, status: 'accepted' };
	}
	throw new UserError('Unsupported queue action');
}
