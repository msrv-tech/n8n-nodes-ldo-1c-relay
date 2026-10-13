import { randomUUID } from 'node:crypto';
import {
	UserError,
	type IDataObject,
	type IExecuteFunctions,
	type ILoadOptionsFunctions,
	type IHttpRequestOptions,
} from 'n8n-workflow';

export type OperationContext = IExecuteFunctions | ILoadOptionsFunctions;
export type ConnectionMode = 'queue' | 'direct' | 'msrv';

export function connectionMode(context: OperationContext): ConnectionMode {
	const node = context.getNode();
	if ((node.typeVersion ?? 2) < 2) return 'msrv';
	const mode = node.parameters?.connectionMode ?? 'queue';
	if (mode !== 'queue' && mode !== 'direct' && mode !== 'msrv')
		throw new UserError('Select a supported connection mode');
	return mode;
}

export function connectionUrl(value: unknown, standalone: boolean) {
	let url: URL | undefined;
	try {
		url = new URL(String(value));
	} catch {
		url = undefined;
	}
	if (!url) throw new UserError('Configure an HTTP(S) connection URL');
	if (
		!['http:', 'https:'].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	) {
		throw new UserError('Use an HTTP(S) URL without credentials, query parameters, or a fragment');
	}
	const host = url.hostname.toLowerCase().replace(/\.$/, '');
	if (standalone && (host === 'msrv.tech' || host.endsWith('.msrv.tech'))) {
		throw new UserError(
			'Standalone connections cannot use MSRV infrastructure. Select the MSRV connection mode to use an enrolled service.',
		);
	}
	return url.toString().replace(/\/$/, '');
}

export function requiredCredential(credentials: IDataObject, name: string) {
	if (typeof credentials[name] !== 'string' || !String(credentials[name]).trim())
		throw new UserError(`Configure ${name} in the connection credential`);
	return String(credentials[name]);
}

export async function directCommand(
	context: OperationContext,
	commandType: string,
	payload: IDataObject,
	commandId: string = randomUUID(),
	timeoutSeconds = 60,
) {
	const credentials = await context.getCredentials('ldo1cApi');
	const apiUrl = connectionUrl(requiredCredential(credentials, 'apiUrl'), true);
	for (const field of ['username', 'profileToken', 'profileId', 'policyRevision'])
		requiredCredential(credentials, field);
	const type = commandType.replace(/^n8n\./, '');
	const result = (await context.helpers.httpRequestWithAuthentication.call(context, 'ldo1cApi', {
		method: 'POST',
		url: `${apiUrl}/commands`,
		json: true,
		disableFollowRedirect: true,
		timeout: timeoutSeconds * 1000,
		body: {
			contract_version: '1.0',
			command_id: commandId,
			command_type: type,
			payload: {
				...payload,
				profile_id: credentials.profileId,
				policy_revision: credentials.policyRevision,
			},
		},
	})) as IDataObject;
	if (
		!result ||
		result.contract_version !== '1.0' ||
		result.command_id !== commandId ||
		result.command_type !== type
	)
		throw new UserError('1C returned a result that does not match the requested command');
	if (result.status !== 'succeeded')
		throw new UserError(
			String((result.error as IDataObject)?.message || '1C rejected the operation'),
		);
	if (!result.data || Array.isArray(result.data) || typeof result.data !== 'object')
		throw new UserError('1C returned invalid operation data');
	return { commandId, data: result.data as IDataObject };
}

export function validateCredentialTarget(apiUrl: unknown, request: IHttpRequestOptions) {
	const base = new URL(connectionUrl(apiUrl, true));
	const target = new URL(request.url || '', request.baseURL || base.toString());
	connectionUrl(target.origin, true);
	if (target.origin !== base.origin)
		throw new UserError(
			'The standalone credential can only authenticate requests to its configured server',
		);
}
