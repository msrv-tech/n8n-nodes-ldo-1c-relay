import { validateCredentialTarget } from '../nodes/Ldo1cRelay/connection';
import type {
	IAuthenticate,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
	Icon,
} from 'n8n-workflow';

export class Ldo1cQueueApi implements ICredentialType {
	name = 'ldo1cQueueApi';
	displayName = 'LDO 1C Standalone Queue API';
	icon: Icon = {
		light: 'file:../nodes/Ldo1cRelay/ldoRelay.svg',
		dark: 'file:../nodes/Ldo1cRelay/ldoRelay.dark.svg',
	};
	documentationUrl =
		'https://github.com/msrv-tech/n8n-nodes-ldo-1c-relay/blob/main/docs/standalone.md';
	properties: INodeProperties[] = [
		{
			displayName: 'n8n URL',
			name: 'apiUrl',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'https://n8n.example.com',
		},
		{
			displayName: 'n8n API Key',
			name: 'apiToken',
			type: 'string',
			default: '',
			required: true,
			typeOptions: { password: true },
			description:
				'API key with permissions to read/write data tables and create/activate gateway workflows. This key stays in n8n and must never be shared with 1C.',
		},
		{
			displayName: 'Minimum Wait (Seconds)',
			name: 'minimumWaitSeconds',
			type: 'number',
			default: 900,
			typeOptions: { minValue: 0, maxValue: 1800 },
		},
	];
	authenticate: IAuthenticate = async (credentials, requestOptions) => {
		validateCredentialTarget(credentials.apiUrl, requestOptions);
		return {
			...requestOptions,
			disableFollowRedirect: true,
			headers: { ...requestOptions.headers, 'X-N8N-API-KEY': String(credentials.apiToken) },
		};
	};
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.apiUrl.replace(/\\/$/, "")}}',
			url: '/api/v1/data-tables?limit=1',
			method: 'GET',
			disableFollowRedirect: true,
		},
	};
}
