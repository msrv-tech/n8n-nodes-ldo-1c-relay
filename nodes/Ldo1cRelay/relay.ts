import {
	NodeApiError,
	NodeOperationError,
	type IDataObject,
	type IExecuteFunctions,
	type ILoadOptionsFunctions,
	type IHttpRequestOptions,
	type JsonObject,
} from 'n8n-workflow';
import type { Capabilities, RelayEvent } from './types';
import { connectionMode, connectionUrl, directConnection } from './connection';
import { queueCapabilities, queueConfiguration } from './queue';

type RelayContext = IExecuteFunctions | ILoadOptionsFunctions;
type RelayRequest = Omit<IHttpRequestOptions, 'url'> & { path: string };

export async function configuration(context: RelayContext) {
	const mode = connectionMode(context);
	if (mode === 'queue') return { ...(await queueConfiguration(context)), mode };
	if (mode === 'direct') {
		const credentials = await context.getCredentials('ldo1cApi');
		return {
			apiUrl: connectionUrl(credentials.apiUrl, true),
			databaseId: '',
			profileId: '',
			policyRevision: '',
			minimumWaitSeconds: 0,
			mode,
		};
	}
	const credentials = await context.getCredentials('ldoRelayApi');
	for (const name of ['apiUrl', 'apiToken', 'databaseId', 'profileId', 'policyRevision']) {
		if (typeof credentials[name] !== 'string' || !String(credentials[name]).trim()) {
			throw new NodeOperationError(
				context.getNode(),
				`Configure ${name} in the LDO Relay credential`,
			);
		}
	}
	const url = new URL(String(credentials.apiUrl));
	if (
		!['http:', 'https:'].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	) {
		throw new NodeOperationError(
			context.getNode(),
			'Use an HTTP(S) Relay URL without credentials, query parameters, or a fragment',
		);
	}
	return {
		mode,
		apiUrl: url.toString().replace(/\/$/, ''),
		databaseId: String(credentials.databaseId),
		profileId: String(credentials.profileId),
		policyRevision: String(credentials.policyRevision),
		minimumWaitSeconds: Number(credentials.minimumWaitSeconds ?? 900),
	};
}

export async function relayRequest<T = RelayEvent>(
	context: RelayContext,
	request: RelayRequest,
): Promise<T> {
	if (connectionMode(context) !== 'msrv')
		throw new Error('Relay requests require the explicit MSRV connection mode');
	const config = await configuration(context);
	const { path, ...options } = request;
	try {
		return (await context.helpers.httpRequestWithAuthentication.call(context, 'ldoRelayApi', {
			...options,
			url: `${config.apiUrl}${path}`,
			json: true,
			disableFollowRedirect: true,
		})) as T;
	} catch (error) {
		throw new NodeApiError(context.getNode(), error as JsonObject);
	}
}

export async function relayBinaryRequest(
	context: IExecuteFunctions,
	path: string,
): Promise<unknown> {
	if (connectionMode(context) !== 'msrv')
		throw new Error('Relay file requests require the explicit MSRV connection mode');
	const config = await configuration(context);
	try {
		return await context.helpers.httpRequestWithAuthentication.call(context, 'ldoRelayApi', {
			method: 'GET',
			url: `${config.apiUrl}${path}`,
			encoding: 'arraybuffer',
			disableFollowRedirect: true,
		});
	} catch (error) {
		throw new NodeApiError(context.getNode(), error as JsonObject);
	}
}

export function relayError(context: IExecuteFunctions, error: Error, itemIndex: number) {
	if (error instanceof NodeApiError) return error;
	return new NodeOperationError(context.getNode(), error, { itemIndex });
}

export async function commandEnvelope(
	context: IExecuteFunctions,
	commandType: string,
	commandId: string,
	payload: IDataObject,
) {
	const config = await configuration(context);
	return {
		database_id: config.databaseId,
		command_id: commandId,
		command_type: commandType,
		payload: {
			...payload,
			contract_version: '1.0',
			profile_id: config.profileId,
			policy_revision: config.policyRevision,
		},
	};
}

export async function relayCapabilities(context: RelayContext) {
	if (connectionMode(context) === 'direct')
		return {
			capabilities: (await directConnection(context)).capabilities as unknown as Capabilities,
		};
	if (connectionMode(context) === 'queue')
		return { capabilities: (await queueCapabilities(context)) as Capabilities };
	const config = await configuration(context);
	const query = new URLSearchParams({
		profile_id: config.profileId,
		policy_revision: config.policyRevision,
	});
	return await relayRequest<{ capabilities: Capabilities }>(context, {
		method: 'GET',
		path: `/v1/relay/capabilities?${query.toString()}`,
	});
}

export function operationWaitSeconds(requested: unknown, minimum: unknown = 900) {
	const floor = Number(minimum);
	const value = Number(requested);
	if (
		!Number.isFinite(floor) ||
		floor < 0 ||
		floor > 1800 ||
		!Number.isFinite(value) ||
		value < 1 ||
		value > 1800
	) {
		throw new Error(
			'Use an operation timeout between 1 and 1800 seconds and a minimum wait between 0 and 1800 seconds',
		);
	}
	return Math.max(value, floor);
}
