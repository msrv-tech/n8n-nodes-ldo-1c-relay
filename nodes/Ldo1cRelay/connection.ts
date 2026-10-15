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

export class CommandFailure extends UserError {
	constructor(
		message: string,
		readonly commandId: string,
		readonly errorCode: string,
	) {
		super(message);
	}
}

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

export async function directConnection(context: OperationContext, timeoutSeconds = 60) {
	const credentials = await context.getCredentials('ldo1cApi');
	const apiUrl = connectionUrl(requiredCredential(credentials, 'apiUrl'), true);
	requiredCredential(credentials, 'username');
	const descriptor = (await context.helpers.httpRequestWithAuthentication.call(
		context,
		'ldo1cApi',
		{
			method: 'GET',
			url: `${apiUrl}/connection`,
			json: true,
			disableFollowRedirect: true,
			timeout: timeoutSeconds * 1000,
		},
	)) as IDataObject;
	if (
		descriptor?.contract_version !== '1.0' ||
		descriptor.status !== 'connected' ||
		typeof descriptor.profile_id !== 'string' ||
		!descriptor.profile_id ||
		typeof descriptor.policy_revision !== 'string' ||
		!descriptor.policy_revision ||
		!descriptor.capabilities ||
		typeof descriptor.capabilities !== 'object' ||
		Array.isArray(descriptor.capabilities)
	)
		throw new UserError('1C did not provide an enabled profile for this user');
	return {
		apiUrl,
		profileId: descriptor.profile_id,
		policyRevision: descriptor.policy_revision,
		capabilities: descriptor.capabilities as IDataObject,
	};
}

export async function directCommand(
	context: OperationContext,
	commandType: string,
	payload: IDataObject,
	commandId: string = randomUUID(),
	timeoutSeconds = 60,
) {
	const config = await directConnection(context, timeoutSeconds);
	const type = commandType.replace(/^n8n\./, '');
	const response = (await context.helpers.httpRequestWithAuthentication.call(context, 'ldo1cApi', {
		method: 'POST',
		url: `${config.apiUrl}/commands`,
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
		disableFollowRedirect: true,
		timeout: timeoutSeconds * 1000,
		body: {
			contract_version: '1.0',
			command_id: commandId,
			command_type: type,
			payload: {
				...payload,
				profile_id: config.profileId,
				policy_revision: config.policyRevision,
			},
		},
	})) as { statusCode: number; body: IDataObject };
	// The native service uses 403 for a normalized business refusal as well.
	// Decode only correlated contract results; proxy/authentication errors remain errors.
	if (![200, 403].includes(response.statusCode))
		throw new UserError('1C rejected the HTTP command request');
	const result = response.body;
	if (
		!result ||
		result.contract_version !== '1.0' ||
		result.command_id !== commandId ||
		result.command_type !== type ||
		(response.statusCode !== 200 && result.status === 'succeeded')
	)
		throw new UserError('1C returned a result that does not match the requested command');
	if (result.status !== 'succeeded') {
		const code = String((result.error as IDataObject)?.code || 'operation_failed');
		throw new CommandFailure(
			String((result.error as IDataObject)?.message || '1C rejected the operation'),
			commandId,
			/^[a-z][a-z0-9_]{0,63}$/.test(code) ? code : 'operation_failed',
		);
	}
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
