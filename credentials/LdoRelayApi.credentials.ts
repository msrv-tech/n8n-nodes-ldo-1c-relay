import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
	Icon,
} from 'n8n-workflow';

export class LdoRelayApi implements ICredentialType {
	name = 'ldoRelayApi';
	displayName = 'LDO Relay API';
	icon: Icon = {
		light: 'file:../nodes/Ldo1cRelay/ldoRelay.svg',
		dark: 'file:../nodes/Ldo1cRelay/ldoRelay.dark.svg',
	};
	documentationUrl =
		'https://github.com/msrv-tech/n8n-nodes-ldo-1c-relay/blob/main/docs/connection.md';
	properties: INodeProperties[] = [
		{
			displayName: 'Relay URL',
			name: 'apiUrl',
			type: 'string',
			default: 'https://api.ldo.msrv.tech',
			required: true,
			placeholder: 'e.g. https://api.ldo.msrv.tech',
		},
		{
			displayName: 'API Token',
			name: 'apiToken',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'Scoped Relay token issued when enrolling your database',
		},
		{ displayName: 'Database ID', name: 'databaseId', type: 'string', default: '', required: true },
		{ displayName: 'Profile ID', name: 'profileId', type: 'string', default: '', required: true },
		{
			displayName: 'Policy Revision',
			name: 'policyRevision',
			type: 'string',
			default: '',
			required: true,
		},
		{
			displayName: 'Minimum Wait (Seconds)',
			name: 'minimumWaitSeconds',
			type: 'number',
			default: 900,
			typeOptions: { minValue: 0, maxValue: 1800 },
			description:
				'Minimum operation timeout for the database polling schedule. Use 900 for a 15-minute schedule.',
		},
	];
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: { headers: { Authorization: '=Bearer {{$credentials.apiToken}}' } },
	};
	test: ICredentialTestRequest = {
		request: {
			baseURL:
				'={{$credentials.apiUrl.endsWith("/") ? $credentials.apiUrl.slice(0, -1) : $credentials.apiUrl}}',
			url: '/v1/relay/capabilities',
			method: 'GET',
			qs: {
				profile_id: '={{$credentials.profileId}}',
				policy_revision: '={{$credentials.policyRevision}}',
			},
		},
	};
}
