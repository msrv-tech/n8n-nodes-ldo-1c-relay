import { validateCredentialTarget } from '../nodes/Ldo1cRelay/connection';
import type {
	IAuthenticate,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
	Icon,
} from 'n8n-workflow';

export class Ldo1cApi implements ICredentialType {
	name = 'ldo1cApi';
	displayName = 'LDO 1C Direct API';
	icon: Icon = {
		light: 'file:../nodes/Ldo1cRelay/ldoRelay.svg',
		dark: 'file:../nodes/Ldo1cRelay/ldoRelay.dark.svg',
	};
	documentationUrl =
		'https://github.com/msrv-tech/n8n-nodes-ldo-1c-relay/blob/main/docs/standalone.md';
	properties: INodeProperties[] = [
		{
			displayName: '1C Service URL',
			name: 'apiUrl',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'https://1c.example.com/base/hs/ldo_n8n',
		},
		{ displayName: 'Username', name: 'username', type: 'string', default: '', required: true },
		{
			displayName: 'Password',
			name: 'password',
			type: 'string',
			default: '',
			typeOptions: { password: true },
		},
	];
	authenticate: IAuthenticate = async (credentials, requestOptions) => {
		validateCredentialTarget(credentials.apiUrl, requestOptions);
		return {
			...requestOptions,
			disableFollowRedirect: true,
			auth: {
				username: String(credentials.username),
				password: String(credentials.password ?? ''),
			},
		};
	};
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.apiUrl.replace(/\\/$/, "")}}',
			url: '/connection',
			method: 'GET',
			json: true,
			disableFollowRedirect: true,
		},
		rules: [
			{
				type: 'responseSuccessBody',
				properties: {
					key: 'status',
					value: 'failed',
					message: 'The native 1C user does not have an enabled direct access profile',
				},
			},
		],
	};
}
