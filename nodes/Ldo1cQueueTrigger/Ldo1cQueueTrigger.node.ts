import { createHash, timingSafeEqual } from 'node:crypto';
import {
	NodeConnectionTypes,
	type INodeType,
	type INodeTypeDescription,
	type IWebhookFunctions,
	type IWebhookResponseData,
} from 'n8n-workflow';
import { queueConfiguration, queueRpc, validateQueueTable } from '../Ldo1cRelay/queue';

export class Ldo1cQueueTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'LDO 1C Queue Gateway Trigger',
		name: 'ldo1cQueueTrigger',
		icon: {
			light: 'file:../Ldo1cRelay/ldoRelay.svg',
			dark: 'file:../Ldo1cRelay/ldoRelay.dark.svg',
		},
		group: ['trigger'],
		version: 1,
		subtitle: 'Standalone 1C queue',
		description:
			'Receive outbound queue requests from a closed 1C database using your own n8n data table',
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
				displayName:
					'Connect the production webhook URL to the 1C queue settings. Queue requests persist data and return directly without starting the workflow.',
				name: 'notice',
				type: 'notice',
				default: '',
			},
		],
	};
	webhookMethods: NonNullable<INodeType['webhookMethods']> = {
		default: {
			async checkExists() {
				await validateQueueTable(this);
				return true;
			},
			async create() {
				await validateQueueTable(this);
				return true;
			},
			async delete() {
				return true;
			},
		},
	};
	// 1C polls an n8n-owned URL configured by its administrator. No webhook is
	// registered on the closed database; n8n owns route activation and removal.
	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const response = this.getResponseObject();
		try {
			const config = await queueConfiguration(this);
			const supplied = this.getHeaderData()['x-ldo-queue-token'];
			const hash = (value: string) => createHash('sha256').update(value).digest();
			if (
				typeof supplied !== 'string' ||
				!timingSafeEqual(hash(supplied), hash(config.queueToken))
			) {
				response.status(401).json({ error: 'access_denied' });
				return { noWebhookResponse: true };
			}
			response.status(200).json(await queueRpc(this, this.getBodyData()));
		} catch {
			// Responses must not disclose n8n API credentials, table contents or URLs.
			response.status(400).json({ error: 'queue_request_failed' });
		}
		return { noWebhookResponse: true };
	}
}
