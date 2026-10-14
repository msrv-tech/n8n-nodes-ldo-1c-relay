import {
	UserError,
	NodeConnectionTypes,
	type INodeType,
	type INodeTypeDescription,
	type ILoadOptionsFunctions,
	type IWebhookFunctions,
	type IWebhookResponseData,
} from 'n8n-workflow';
import { queueConfiguration, pinQueueConfiguration, queueRpc } from '../Ldo1cRelay/queue';
import {
	connectionRecord,
	connectionCommandRow,
	listQueueConnections,
	matchesSecret,
	pairQueue,
	retireStaleCommands,
	synchronizeQueuePolicy,
	validateConnectionTable,
} from '../Ldo1cRelay/pairing';

export class Ldo1cQueueTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'LDO 1C Queue Gateway Trigger',
		name: 'ldo1cQueueTrigger',
		icon: {
			light: 'file:../Ldo1cRelay/ldoRelay.svg',
			dark: 'file:../Ldo1cRelay/ldoRelay.dark.svg',
		},
		group: ['trigger'],
		version: 2,
		subtitle: 'Standalone 1C queue',
		description: 'Pair and exchange commands with a closed 1C database through your own n8n queue',
		defaults: { name: 'LDO 1C Queue Gateway' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'ldo1cQueueApi', required: true }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: '1c-queue',
				isFullPath: false,
			},
		],
		properties: [
			{
				displayName: 'Connection Name or ID',
				name: 'connectionId',
				type: 'options',
				noDataExpression: true,
				default: '',
				required: true,
				typeOptions: { loadOptionsMethod: 'getConnections' },
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
			{
				displayName:
					'Create a connection in LDO 1C → Connection, then paste its pairing code into 1C. This gateway returns directly without starting workflow executions.',
				name: 'notice',
				type: 'notice',
				default: '',
			},
		],
	};
	methods = {
		loadOptions: {
			async getConnections(this: ILoadOptionsFunctions) {
				return await listQueueConnections(this);
			},
		},
	};
	webhookMethods: NonNullable<INodeType['webhookMethods']> = {
		default: {
			async checkExists() {
				await validateConnectionTable(this);
				return true;
			},
			async create() {
				await validateConnectionTable(this);
				return true;
			},
			async delete() {
				return true;
			},
		},
	};
	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const response = this.getResponseObject();
		try {
			const body = this.getBodyData();
			if (!body || Array.isArray(body) || body.contract_version !== '1.0')
				throw new UserError('Invalid request');
			if (body.action === 'pair') {
				response
					.status(200)
					.json(await pairQueue(this, body, this.getHeaderData()['x-ldo-pairing-token']));
				return { noWebhookResponse: true };
			}
			let saved = await connectionRecord(this);
			if (
				saved.row.status !== 'paired' ||
				!matchesSecret(this.getHeaderData()['x-ldo-queue-token'], saved.manifest.token_hash)
			) {
				response.status(401).json({ error: 'access_denied' });
				return { noWebhookResponse: true };
			}
			if (body.database_id !== saved.row.database_id || body.profile_id !== saved.row.profile_id)
				throw new UserError('Invalid scope');
			if (body.action === 'sync') {
				saved = await synchronizeQueuePolicy(this, body, saved);
				await retireStaleCommands(this, saved);
				response
					.status(200)
					.json({
						status: 'ok',
						contract_version: '1.0',
						policy_revision: saved.row.policy_revision,
					});
				return { noWebhookResponse: true };
			}
			if (body.action !== 'result' && body.policy_revision !== saved.row.policy_revision)
				throw new UserError('Invalid policy');
			const config = await queueConfiguration(this);
			// In-flight responses belong to the revision under which they were leased.
			if (body.action === 'result') {
				const row = await connectionCommandRow(this, saved, Number(body.id));
				if (
					body.policy_revision !== saved.row.policy_revision &&
					body.policy_revision !== row.policy_revision
				)
					throw new UserError('Invalid result policy');
				pinQueueConfiguration(this, { ...config, policyRevision: String(row.policy_revision) });
				response
					.status(200)
					.json(await queueRpc(this, { ...body, policy_revision: row.policy_revision }));
			} else {
				if (body.action === 'poll') await retireStaleCommands(this, saved);
				response.status(200).json(await queueRpc(this, body));
			}
		} catch {
			response.status(400).json({ error: 'queue_request_failed' });
		}
		return { noWebhookResponse: true };
	}
}
