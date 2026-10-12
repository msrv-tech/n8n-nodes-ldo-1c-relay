import { createHash, randomUUID } from 'node:crypto';
import {
	NodeConnectionTypes,
	sleep,
	UserError,
	type IDataObject,
	type IExecuteFunctions,
	type ILoadOptionsFunctions,
	type INodeType,
	type INodeTypeDescription,
	type INodeExecutionData,
	type INodePropertyOptions,
} from 'n8n-workflow';
import type { Capabilities, RelayEvent, ReferenceValue } from './types';
import {
	configuration,
	operationWaitSeconds,
	commandEnvelope,
	relayBinaryRequest,
	relayCapabilities,
	relayError,
	relayRequest,
} from './relay';

const businessEvents = [
	{ name: 'Approval Started', value: 'approval.started' },
	{ name: 'Document Approved', value: 'document.approved' },
	{ name: 'Document Rejected', value: 'document.rejected' },
];

function selectedObject(capabilities: Capabilities, objectType: string) {
	return (
		(capabilities.object_types || []).find((item) => item && item.object_type === objectType) ||
		null
	);
}

function selectedWriteField(capabilities: Capabilities, objectType: string, fieldId: string) {
	const object = selectedObject(capabilities, objectType);
	return (object?.write_fields || []).find((item) => item && item.id === fieldId) || null;
}

function selectedProcessProfile(capabilities: Capabilities, profileId: string) {
	return (
		(capabilities.process_profiles || []).find((item) => item && item.id === profileId) || null
	);
}

function objectTypesForProcess(capabilities: Capabilities, profileId: string) {
	const profile = selectedProcessProfile(capabilities, profileId);
	return profile?.object_types || [];
}

function processValues(value: unknown): IDataObject {
	if (value === undefined || value === null || value === '') return {};
	const parsed = typeof value === 'string' ? JSON.parse(value) : value;
	if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
		throw new UserError('Values must be a JSON object');
	}
	return parsed as IDataObject;
}

async function catalogue(
	context: IExecuteFunctions | ILoadOptionsFunctions,
): Promise<Capabilities> {
	const response = await relayCapabilities(context);
	if (!response || !response.capabilities || typeof response.capabilities !== 'object') {
		throw new UserError('Relay returned an invalid capabilities catalogue');
	}
	return response.capabilities;
}

function requiredFileId(value: unknown) {
	const text = String(value);
	if (!/^[1-9][0-9]*$/.test(text)) throw new UserError('Relay returned an invalid PDF file ID');
	return text;
}

function requiredSha256(value: unknown) {
	const text = String(value).toLowerCase();
	if (!/^[a-f0-9]{64}$/.test(text)) throw new UserError('Relay returned an invalid PDF SHA-256');
	return text;
}

function requiredSize(value: unknown) {
	const size = Number(value);
	if (!Number.isSafeInteger(size) || size < 1)
		throw new UserError('Relay returned an invalid PDF size');
	return size;
}

function requiredEventId(value: unknown) {
	const id = Number(value);
	if (!Number.isSafeInteger(id) || id < 1) throw new UserError('A Relay event ID is required');
	return id;
}

function asBuffer(content: unknown) {
	if (Buffer.isBuffer(content)) return content;
	if (content instanceof ArrayBuffer) return Buffer.from(content);
	if (ArrayBuffer.isView(content))
		return Buffer.from(content.buffer, content.byteOffset, content.byteLength);
	throw new UserError('Relay returned an invalid binary PDF response');
}

async function awaitEvent(
	context: IExecuteFunctions,
	commandId: string,
	kind: string,
	timeoutSeconds: number,
	pollSeconds: number,
): Promise<RelayEvent> {
	const pathKind = kind === 'fileReady' ? 'file' : 'result';
	const deadline = Date.now() + timeoutSeconds * 1000;
	while (Date.now() < deadline) {
		const event = await relayRequest(context, {
			method: 'GET',
			path: `/v1/queue/events/${pathKind}/${encodeURIComponent(commandId)}`,
		});
		if (event) return event;
		await sleep(pollSeconds * 1000);
	}
	throw new UserError(
		kind === 'fileReady'
			? `PDF for ${commandId} was not received within the configured timeout`
			: `Relay result for ${commandId} was not received within the configured timeout`,
	);
}

async function acknowledge(context: IExecuteFunctions, eventId: unknown) {
	return relayRequest(context, {
		method: 'POST',
		path: `/v1/queue/events/${requiredEventId(eventId)}/ack`,
	});
}

async function runCommand(
	context: IExecuteFunctions,
	commandType: string,
	payload: IDataObject,
	timeoutSeconds: number,
	pollSeconds: number,
) {
	const commandId = randomUUID();
	await relayRequest(context, {
		method: 'POST',
		path: '/v1/queue/commands',
		body: await commandEnvelope(context, commandType, commandId, payload),
	});
	const result = await awaitEvent(
		context,
		commandId,
		'operationResult',
		timeoutSeconds,
		pollSeconds,
	);
	await acknowledge(context, result.id);
	if (result.payload?.status !== 'succeeded') {
		throw new UserError(result.payload?.error?.message || `1C rejected ${commandType}`);
	}
	return { commandId, data: result.payload?.data || {} };
}

export class Ldo1cRelay implements INodeType {
	methods: NonNullable<INodeType['methods']> = {
		loadOptions: {
			async getDocumentTypes(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const capabilities = await catalogue(this);
				return (capabilities.object_types || [])
					.filter((item) => item && item.operations?.length)
					.map((item) => ({ name: item.object_type, value: item.object_type }));
			},
			async getWritableDocumentTypes(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const capabilities = await catalogue(this);
				return (capabilities.object_types || [])
					.filter(
						(item) =>
							item &&
							item.operations?.includes('document.fields.update') &&
							item.write_fields?.length,
					)
					.map((item) => ({ name: item.object_type, value: item.object_type }));
			},
			async getCatalogTypes(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const capabilities = await catalogue(this);
				return (capabilities.object_types || [])
					.filter(
						(item) => item && item.kind === 'catalog' && item.operations?.includes('catalog.get'),
					)
					.map((item) => ({ name: item.object_type, value: item.object_type }));
			},
			async getWritableCatalogTypes(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const capabilities = await catalogue(this);
				return (capabilities.object_types || [])
					.filter(
						(item) =>
							item &&
							item.kind === 'catalog' &&
							item.operations?.includes('catalog.fields.update') &&
							item.write_fields?.length,
					)
					.map((item) => ({ name: item.object_type, value: item.object_type }));
			},
			async getDocumentWriteFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const object = selectedObject(
					await catalogue(this),
					this.getCurrentNodeParameter('writeDocumentType') as string,
				);
				return (object?.write_fields || []).map((item) => ({
					name: `${item.presentation || item.id} (${item.value_type})`,
					value: item.id,
				}));
			},
			async getReferenceWritableObjectTypes(
				this: ILoadOptionsFunctions,
			): Promise<INodePropertyOptions[]> {
				const capabilities = await catalogue(this);
				return (capabilities.object_types || [])
					.filter(
						(item) =>
							item &&
							item.operations?.some((operation) => operation.endsWith('.fields.update')) &&
							item.write_fields?.some((field) => field?.value_type === 'reference'),
					)
					.map((item) => ({ name: item.object_type, value: item.object_type }));
			},
			async getReferenceWriteFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const object = selectedObject(
					await catalogue(this),
					this.getCurrentNodeParameter('referenceObjectType') as string,
				);
				return (object?.write_fields || [])
					.filter((item) => item?.value_type === 'reference')
					.map((item) => ({ name: item.presentation || item.id, value: item.id }));
			},
			async getReferenceCacheValues(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const capabilities = await catalogue(this);
				const field = selectedWriteField(
					capabilities,
					this.getCurrentNodeParameter('referenceObjectType') as string,
					this.getCurrentNodeParameter('referenceFieldId') as string,
				);
				return (field?.reference?.cache_values || []).map((item) => ({
					name: item.presentation,
					value: item.id,
				}));
			},
			async getDocumentFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const object = selectedObject(
					await catalogue(this),
					this.getCurrentNodeParameter('documentType') as string,
				);
				return (object?.fields || []).map((item) => ({ name: item.id, value: item.id }));
			},
			async getCatalogFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const object = selectedObject(
					await catalogue(this),
					this.getCurrentNodeParameter('catalogType') as string,
				);
				return (object?.fields || []).map((item) => ({ name: item.id, value: item.id }));
			},
			async getPrintForms(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const object = selectedObject(
					await catalogue(this),
					this.getCurrentNodeParameter('documentType') as string,
				);
				return (object?.forms || []).map((item) => ({ name: item.presentation, value: item.id }));
			},
			async getProcessProfiles(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const capabilities = await catalogue(this);
				return (capabilities.process_profiles || []).map((item) => ({
					name: item.presentation || item.id,
					value: item.id,
				}));
			},
			async getProcessDocumentTypes(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const capabilities = await catalogue(this);
				return objectTypesForProcess(
					capabilities,
					this.getCurrentNodeParameter('processProfileId') as string,
				).map((item) => ({ name: item, value: item }));
			},
			async getProcessTransitions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const profile = selectedProcessProfile(
					await catalogue(this),
					this.getCurrentNodeParameter('processProfileId') as string,
				);
				return (profile?.transitions || []).map((item) => ({
					name: item.presentation || item.id,
					value: item.id,
				}));
			},
		},
	};
	description: INodeTypeDescription = {
		displayName: 'LDO Relay for 1C',
		name: 'ldo1cRelay',
		icon: { light: 'file:ldoRelay.svg', dark: 'file:ldoRelay.dark.svg' },
		group: ['transform'],
		version: 1,
		usableAsTool: true,
		description: 'Work with a 1C database through the LDO Relay API',
		credentials: [{ name: 'ldoRelayApi', required: true }],
		subtitle:
			'={{$parameter["resource"] === "operation" ? $parameter["operation"] : $parameter["resource"]}}',
		defaults: { name: 'LDO Relay for 1C' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				noDataExpression: true,
				type: 'options',
				default: 'operation',
				required: true,
				options: [
					{ name: '1C Operation', value: 'operation' },
					{ name: 'Event', value: 'events' },
					{ name: 'Delivery', value: 'finalize' },
				],
			},
			{
				displayName: 'Operation',
				name: 'operation',
				noDataExpression: true,
				type: 'options',
				default: 'capabilities',
				options: [
					{
						name: 'Cancel External Process',
						value: 'processCancel',
						description: 'Cancel external process through LDO Relay',
						action: 'Cancel external process',
					},
					{
						name: 'Get Capabilities',
						value: 'capabilities',
						description: 'Get capabilities through LDO Relay',
						action: 'Get capabilities',
					},
					{
						name: 'Get Catalog Fields',
						value: 'catalogGet',
						description: 'Get catalog fields through LDO Relay',
						action: 'Get catalog fields',
					},
					{
						name: 'Get Document Fields',
						value: 'documentGet',
						description: 'Get document fields through LDO Relay',
						action: 'Get document fields',
					},
					{
						name: 'Get External Process',
						value: 'processGet',
						description: 'Get external process through LDO Relay',
						action: 'Get external process',
					},
					{
						name: 'Prepare Document PDF',
						value: 'documentFilePrepare',
						description: 'Prepare document PDF through LDO Relay',
						action: 'Prepare document PDF',
					},
					{
						name: 'Search Reference Values',
						value: 'referenceSearch',
						description: 'Search reference values through LDO Relay',
						action: 'Search reference values',
					},
					{
						name: 'Start External Process',
						value: 'processStart',
						description: 'Start external process through LDO Relay',
						action: 'Start external process',
					},
					{
						name: 'Transition External Process',
						value: 'processTransition',
						description: 'Transition external process through LDO Relay',
						action: 'Transition external process',
					},
					{
						name: 'Update Catalog Fields',
						value: 'catalogFieldsUpdate',
						description: 'Update catalog fields through LDO Relay',
						action: 'Update catalog fields',
					},
					{
						name: 'Update Document Fields',
						value: 'documentFieldsUpdate',
						description: 'Update document fields through LDO Relay',
						action: 'Update document fields',
					},
					{
						name: 'Update External Process Fields',
						value: 'processFieldsUpdate',
						description: 'Update external process fields through LDO Relay',
						action: 'Update external process fields',
					},
					{
						name: 'Update Reference Field',
						value: 'referenceFieldUpdate',
						description: 'Update reference field through LDO Relay',
						action: 'Update reference field',
					},
				],
				displayOptions: { show: { resource: ['operation'] } },
			},
			{
				displayName: 'External Process Profile Name or ID',
				name: 'processProfileId',
				type: 'options',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				default: '',
				required: true,
				typeOptions: { loadOptionsMethod: 'getProcessProfiles' },
				displayOptions: {
					show: {
						resource: ['operation'],
						operation: ['processStart', 'processTransition', 'processFieldsUpdate'],
					},
				},
			},
			{
				displayName: 'Document Type Name or ID',
				name: 'processDocumentType',
				type: 'options',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				default: '',
				required: true,
				typeOptions: {
					loadOptionsMethod: 'getProcessDocumentTypes',
					loadOptionsDependsOn: ['processProfileId'],
				},
				displayOptions: { show: { resource: ['operation'], operation: ['processStart'] } },
			},
			{
				displayName: 'Document ID',
				name: 'processDocumentId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['operation'], operation: ['processStart'] } },
			},
			{
				displayName: 'External Process ID',
				name: 'processId',
				type: 'string',
				default: '={{$json.process_id}}',
				required: true,
				displayOptions: {
					show: {
						resource: ['operation'],
						operation: ['processGet', 'processTransition', 'processFieldsUpdate', 'processCancel'],
					},
				},
			},
			{
				displayName: 'Expected Revision',
				name: 'expectedRevision',
				type: 'number',
				default: 0,
				required: true,
				typeOptions: { minValue: 1 },
				displayOptions: {
					show: {
						resource: ['operation'],
						operation: ['processTransition', 'processFieldsUpdate', 'processCancel'],
					},
				},
			},
			{
				displayName: 'Transition Name or ID',
				name: 'transitionId',
				type: 'options',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				default: '',
				required: true,
				typeOptions: {
					loadOptionsMethod: 'getProcessTransitions',
					loadOptionsDependsOn: ['processProfileId'],
				},
				displayOptions: { show: { resource: ['operation'], operation: ['processTransition'] } },
			},
			{
				displayName: 'Process Field Values (JSON)',
				name: 'processValues',
				type: 'json',
				default: '{}',
				description: 'Only process fields published by the selected profile are accepted',
				displayOptions: {
					show: {
						resource: ['operation'],
						operation: ['processTransition', 'processFieldsUpdate'],
					},
				},
			},
			{
				displayName: 'Document Type Name or ID',
				name: 'documentType',
				type: 'options',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				default: '',
				typeOptions: { loadOptionsMethod: 'getDocumentTypes' },
				displayOptions: {
					show: { resource: ['operation'], operation: ['documentGet', 'documentFilePrepare'] },
				},
			},
			{
				displayName: 'Document Type Name or ID',
				name: 'writeDocumentType',
				type: 'options',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				default: '',
				required: true,
				typeOptions: { loadOptionsMethod: 'getWritableDocumentTypes' },
				displayOptions: {
					show: { resource: ['operation'], operation: ['documentFieldsUpdate'] },
				},
			},
			{
				displayName: 'Catalog Type Name or ID',
				name: 'catalogType',
				type: 'options',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				default: '',
				required: true,
				typeOptions: { loadOptionsMethod: 'getCatalogTypes' },
				displayOptions: { show: { resource: ['operation'], operation: ['catalogGet'] } },
			},
			{
				displayName: 'Catalog Item ID',
				name: 'catalogId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['operation'], operation: ['catalogGet'] } },
			},
			{
				displayName: 'Field Names or IDs',
				name: 'catalogFields',
				type: 'multiOptions',
				description:
					'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				default: [],
				required: true,
				typeOptions: {
					loadOptionsMethod: 'getCatalogFields',
					loadOptionsDependsOn: ['catalogType'],
				},
				displayOptions: { show: { resource: ['operation'], operation: ['catalogGet'] } },
			},
			{
				displayName: 'Catalog Type Name or ID',
				name: 'writeCatalogType',
				type: 'options',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				default: '',
				required: true,
				typeOptions: { loadOptionsMethod: 'getWritableCatalogTypes' },
				displayOptions: { show: { resource: ['operation'], operation: ['catalogFieldsUpdate'] } },
			},
			{
				displayName: 'Catalog Item ID',
				name: 'writeCatalogId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['operation'], operation: ['catalogFieldsUpdate'] } },
			},
			{
				displayName: 'Expected Revision',
				name: 'expectedCatalogRevision',
				type: 'string',
				default: '={{$json.revision}}',
				required: true,
				displayOptions: { show: { resource: ['operation'], operation: ['catalogFieldsUpdate'] } },
			},
			{
				displayName: 'Changes (JSON)',
				name: 'catalogChanges',
				type: 'json',
				default: '{}',
				required: true,
				description:
					'Use field IDs published by the catalog policy. Reference values use {"ID":"UUID"}.',
				displayOptions: { show: { resource: ['operation'], operation: ['catalogFieldsUpdate'] } },
			},
			{
				displayName: 'Document ID',
				name: 'writeDocumentId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: { resource: ['operation'], operation: ['documentFieldsUpdate'] },
				},
			},
			{
				displayName: 'Expected Document Revision',
				name: 'expectedDocumentRevision',
				type: 'string',
				default: '={{$json.revision}}',
				required: true,
				description:
					'Use the revision returned by Get Document Fields. Changes in 1C cause a revision conflict.',
				displayOptions: {
					show: { resource: ['operation'], operation: ['documentFieldsUpdate'] },
				},
			},
			{
				displayName: 'Changes (JSON)',
				name: 'documentChanges',
				type: 'json',
				default: '{}',
				required: true,
				description:
					'Use policy field IDs. Reference values use {"ID":"UUID"}; enumerations use an allowed value ID.',
				displayOptions: {
					show: { resource: ['operation'], operation: ['documentFieldsUpdate'] },
				},
			},
			{
				displayName: 'Object Type Name or ID',
				name: 'referenceObjectType',
				type: 'options',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				default: '',
				required: true,
				typeOptions: { loadOptionsMethod: 'getReferenceWritableObjectTypes' },
				displayOptions: {
					show: {
						resource: ['operation'],
						operation: ['referenceSearch', 'referenceFieldUpdate'],
					},
				},
			},
			{
				displayName: 'Reference Field Name or ID',
				name: 'referenceFieldId',
				type: 'options',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				default: '',
				required: true,
				typeOptions: {
					loadOptionsMethod: 'getReferenceWriteFields',
					loadOptionsDependsOn: ['referenceObjectType'],
				},
				displayOptions: {
					show: {
						resource: ['operation'],
						operation: ['referenceSearch', 'referenceFieldUpdate'],
					},
				},
			},
			{
				displayName: 'Search Query',
				name: 'referenceQuery',
				type: 'string',
				default: '',
				required: true,
				description:
					'Use at least two characters. Search is limited to the reference type allowed by the field policy.',
				displayOptions: { show: { resource: ['operation'], operation: ['referenceSearch'] } },
			},
			{
				displayName: 'Limit',
				name: 'referenceLimit',
				type: 'number',
				default: 20,
				typeOptions: { minValue: 1, maxValue: 50 },
				displayOptions: { show: { resource: ['operation'], operation: ['referenceSearch'] } },
			},
			{
				displayName: 'Object ID',
				name: 'referenceOwnerId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: { resource: ['operation'], operation: ['referenceFieldUpdate'] },
				},
			},
			{
				displayName: 'Expected Object Revision',
				name: 'referenceOwnerRevision',
				type: 'string',
				default: '={{$json.revision}}',
				required: true,
				description: 'Revision returned by reading the object or receiving its event',
				displayOptions: {
					show: { resource: ['operation'], operation: ['referenceFieldUpdate'] },
				},
			},
			{
				displayName: 'Value Source',
				name: 'referenceValueMode',
				type: 'options',
				default: 'id',
				required: true,
				options: [
					{ name: 'ID', value: 'id' },
					{ name: 'Search at Execution', value: 'live' },
					{ name: 'From Cache', value: 'cache' },
				],
				displayOptions: {
					show: { resource: ['operation'], operation: ['referenceFieldUpdate'] },
				},
			},
			{
				displayName: 'Reference Value ID',
				name: 'referenceValueId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: {
						resource: ['operation'],
						operation: ['referenceFieldUpdate'],
						referenceValueMode: ['id'],
					},
				},
			},
			{
				displayName: 'Reference Search Query',
				name: 'referenceLiveQuery',
				type: 'string',
				default: '',
				required: true,
				description: 'The update proceeds only when 1C returns exactly one match',
				displayOptions: {
					show: {
						resource: ['operation'],
						operation: ['referenceFieldUpdate'],
						referenceValueMode: ['live'],
					},
				},
			},
			{
				displayName: 'Cached Reference Value Name or ID',
				name: 'referenceCachedId',
				type: 'options',
				default: '',
				required: true,
				typeOptions: {
					loadOptionsMethod: 'getReferenceCacheValues',
					loadOptionsDependsOn: ['referenceObjectType', 'referenceFieldId'],
				},
				description:
					'Refresh the cache with Get Capabilities. 1C validates the reference again before writing. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				displayOptions: {
					show: {
						resource: ['operation'],
						operation: ['referenceFieldUpdate'],
						referenceValueMode: ['cache'],
					},
				},
			},
			{
				displayName: 'Document ID',
				name: 'documentId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: {
					show: { resource: ['operation'], operation: ['documentGet', 'documentFilePrepare'] },
				},
			},
			{
				displayName: 'Field Names or IDs',
				name: 'fields',
				type: 'multiOptions',
				description:
					'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				default: [],
				required: true,
				typeOptions: {
					loadOptionsMethod: 'getDocumentFields',
					loadOptionsDependsOn: ['documentType'],
				},
				displayOptions: { show: { resource: ['operation'], operation: ['documentGet'] } },
			},
			{
				displayName: 'Print Form Name or ID',
				name: 'formId',
				type: 'options',
				description:
					'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				default: '',
				required: true,
				typeOptions: {
					loadOptionsMethod: 'getPrintForms',
					loadOptionsDependsOn: ['documentType'],
				},
				displayOptions: { show: { resource: ['operation'], operation: ['documentFilePrepare'] } },
			},
			{
				displayName: 'Document Revision',
				name: 'revision',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['operation'], operation: ['documentFilePrepare'] } },
			},
			{
				displayName: 'Timeout (Seconds)',
				name: 'timeoutSeconds',
				type: 'number',
				default: 900,
				typeOptions: { minValue: 1, maxValue: 1800 },
				displayOptions: { show: { resource: ['operation'] } },
			},
			{
				displayName: 'Poll Interval (Seconds)',
				name: 'pollSeconds',
				type: 'number',
				default: 2,
				typeOptions: { minValue: 1, maxValue: 30 },
				displayOptions: { show: { resource: ['operation'] } },
			},
			{
				displayName: 'Event Types',
				name: 'eventTypes',
				type: 'multiOptions',
				default: ['approval.started'],
				required: true,
				options: businessEvents,
				displayOptions: { show: { resource: ['events'] } },
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				description: 'Max number of results to return',
				default: 50,
				typeOptions: { minValue: 1, maxValue: 100 },
				displayOptions: { show: { resource: ['events'] } },
			},
			{
				displayName: 'Operation',
				name: 'finalizeAction',
				noDataExpression: true,
				type: 'options',
				default: 'event',
				options: [
					{ name: 'Acknowledge Event', value: 'event' },
					{ name: 'Confirm PDF Delivery', value: 'file' },
					{ name: 'Retry Event', value: 'fail' },
				],
				displayOptions: { show: { resource: ['finalize'] } },
			},
			{
				displayName: 'Event ID',
				name: 'eventId',
				type: 'number',
				default: 0,
				required: true,
				displayOptions: { show: { resource: ['finalize'] } },
			},
			{
				displayName: 'PDF ID',
				name: 'fileId',
				type: 'string',
				default: '={{$json._ldo?.file_id || $json.file_id}}',
				required: true,
				displayOptions: { show: { resource: ['finalize'], finalizeAction: ['file'] } },
			},
			{
				displayName: 'PDF SHA-256',
				name: 'sha256',
				type: 'string',
				default: '={{$json._ldo?.sha256 || $json.sha256}}',
				required: true,
				displayOptions: { show: { resource: ['finalize'], finalizeAction: ['file'] } },
			},
			{
				displayName: 'Failure Description',
				name: 'error',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['finalize'], finalizeAction: ['fail'] } },
			},
			{
				displayName: 'Retry Delay (Seconds)',
				name: 'retryAfterSeconds',
				type: 'number',
				default: 60,
				typeOptions: { minValue: 0, maxValue: 86400 },
				displayOptions: { show: { resource: ['finalize'], finalizeAction: ['fail'] } },
			},
		],
	};

	async operation(this: IExecuteFunctions, index: number): Promise<INodeExecutionData> {
		const operation = this.getNodeParameter('operation', index) as string;
		const timeout = operationWaitSeconds(
			this.getNodeParameter('timeoutSeconds', index) as number,
			(await configuration(this)).minimumWaitSeconds,
		);
		const poll = this.getNodeParameter('pollSeconds', index) as number;
		if (operation === 'referenceFieldUpdate') {
			const objectType = this.getNodeParameter('referenceObjectType', index) as string;
			const fieldId = this.getNodeParameter('referenceFieldId', index) as string;
			const mode = this.getNodeParameter('referenceValueMode', index) as string;
			let referenceId: string;
			let resolvedReference: ReferenceValue | null = null;
			if (mode === 'live') {
				const lookup = await runCommand(
					this,
					'n8n.reference.search',
					{
						object_type: objectType,
						field_id: fieldId,
						query: this.getNodeParameter('referenceLiveQuery', index) as string,
						limit: 2,
					},
					timeout,
					poll,
				);
				const matches = Array.isArray(lookup.data.items)
					? (lookup.data.items as unknown as ReferenceValue[])
					: [];
				if (matches.length !== 1) {
					const presentations = matches
						.map((item) => item?.presentation)
						.filter(Boolean)
						.join(', ');
					throw new UserError(
						matches.length === 0
							? '1C found no matching reference value'
							: `1C found multiple matches: ${presentations}. Refine the search query.`,
					);
				}
				resolvedReference = matches[0];
				referenceId = matches[0].id;
			} else if (mode === 'cache') {
				referenceId = this.getNodeParameter('referenceCachedId', index) as string;
				const capabilities = await catalogue(this);
				const field = selectedWriteField(capabilities, objectType, fieldId);
				resolvedReference =
					(field?.reference?.cache_values || []).find((item) => item.id === referenceId) || null;
				if (!resolvedReference)
					throw new UserError(
						'The selected value is missing from the current Relay cache. Refresh Get Capabilities.',
					);
			} else {
				referenceId = this.getNodeParameter('referenceValueId', index) as string;
			}
			const commandType = objectType.startsWith('catalog.')
				? 'n8n.catalog.fields.update'
				: 'n8n.document.fields.update';
			const update = await runCommand(
				this,
				commandType,
				{
					object: {
						type: objectType,
						id: this.getNodeParameter('referenceOwnerId', index) as string,
					},
					expected_revision: this.getNodeParameter('referenceOwnerRevision', index) as string,
					changes: { [fieldId]: { id: referenceId } },
				},
				timeout,
				poll,
			);
			return {
				json: {
					...update.data,
					_ldo: {
						command_id: update.commandId,
						operation: commandType,
						reference: { mode, id: referenceId, presentation: resolvedReference?.presentation },
					},
				},
				pairedItem: { item: index },
			};
		}
		const commandId = randomUUID();
		let commandType = 'n8n.capabilities.get';
		let payload: IDataObject = {};
		if (operation === 'processStart') {
			commandType = 'n8n.process.start';
			payload = {
				process_profile_id: this.getNodeParameter('processProfileId', index) as string,
				object: {
					type: this.getNodeParameter('processDocumentType', index) as string,
					id: this.getNodeParameter('processDocumentId', index) as string,
				},
			};
		} else if (operation === 'processGet') {
			commandType = 'n8n.process.get';
			payload = { process_id: this.getNodeParameter('processId', index) as string };
		} else if (operation === 'processTransition') {
			commandType = 'n8n.process.transition';
			payload = {
				process_profile_id: this.getNodeParameter('processProfileId', index) as string,
				process_id: this.getNodeParameter('processId', index) as string,
				expected_revision: this.getNodeParameter('expectedRevision', index) as number,
				transition_id: this.getNodeParameter('transitionId', index) as string,
				values: processValues(this.getNodeParameter('processValues', index) as string),
			};
		} else if (operation === 'processFieldsUpdate') {
			commandType = 'n8n.process.fields.update';
			payload = {
				process_profile_id: this.getNodeParameter('processProfileId', index) as string,
				process_id: this.getNodeParameter('processId', index) as string,
				expected_revision: this.getNodeParameter('expectedRevision', index) as number,
				values: processValues(this.getNodeParameter('processValues', index) as string),
			};
		} else if (operation === 'processCancel') {
			commandType = 'n8n.process.cancel';
			payload = {
				process_id: this.getNodeParameter('processId', index) as string,
				expected_revision: this.getNodeParameter('expectedRevision', index) as number,
			};
		} else if (operation === 'documentFieldsUpdate') {
			commandType = 'n8n.document.fields.update';
			payload = {
				object: {
					type: this.getNodeParameter('writeDocumentType', index) as string,
					id: this.getNodeParameter('writeDocumentId', index) as string,
				},
				expected_revision: this.getNodeParameter('expectedDocumentRevision', index) as string,
				changes: processValues(this.getNodeParameter('documentChanges', index) as string),
			};
		} else if (operation === 'catalogFieldsUpdate') {
			commandType = 'n8n.catalog.fields.update';
			payload = {
				object: {
					type: this.getNodeParameter('writeCatalogType', index) as string,
					id: this.getNodeParameter('writeCatalogId', index) as string,
				},
				expected_revision: this.getNodeParameter('expectedCatalogRevision', index) as string,
				changes: processValues(this.getNodeParameter('catalogChanges', index) as string),
			};
		} else if (operation === 'catalogGet') {
			commandType = 'n8n.catalog.get';
			payload = {
				object: {
					type: this.getNodeParameter('catalogType', index) as string,
					id: this.getNodeParameter('catalogId', index) as string,
				},
				fields: this.getNodeParameter('catalogFields', index) as string[],
			};
		} else if (operation === 'referenceSearch') {
			commandType = 'n8n.reference.search';
			payload = {
				object_type: this.getNodeParameter('referenceObjectType', index) as string,
				field_id: this.getNodeParameter('referenceFieldId', index) as string,
				query: this.getNodeParameter('referenceQuery', index) as string,
				limit: this.getNodeParameter('referenceLimit', index) as number,
			};
		} else if (operation !== 'capabilities') {
			const object = {
				type: this.getNodeParameter('documentType', index) as string,
				id: this.getNodeParameter('documentId', index) as string,
			};
			if (operation === 'documentGet') {
				commandType = 'n8n.document.get';
				payload = { object, fields: this.getNodeParameter('fields', index) as string[] };
			} else {
				commandType = 'n8n.document.file.prepare';
				payload = {
					object,
					form_id: this.getNodeParameter('formId', index) as string,
					revision: this.getNodeParameter('revision', index) as string,
				};
			}
		}
		await relayRequest(this, {
			method: 'POST',
			path: '/v1/queue/commands',
			body: await commandEnvelope(this, commandType, commandId, payload),
		});
		const result = await awaitEvent(this, commandId, 'operationResult', timeout, poll);
		await acknowledge(this, result.id);
		if (result.payload?.status !== 'succeeded') {
			throw new UserError(result.payload?.error?.message || `1C rejected ${commandType}`);
		}
		if (operation !== 'documentFilePrepare') {
			return {
				json: {
					...(result.payload?.data || {}),
					_ldo: { command_id: commandId, operation: commandType },
				},
				pairedItem: { item: index },
			};
		}
		const ready = await awaitEvent(this, commandId, 'fileReady', timeout, poll);
		const payloadReady = ready.payload || {};
		const fileId = requiredFileId(payloadReady.file_id);
		const sha256 = requiredSha256(payloadReady.sha256);
		const size = requiredSize(payloadReady.size_bytes);
		const filename = String(payloadReady.filename || 'print-form.pdf');
		const content = asBuffer(await relayBinaryRequest(this, `/v1/relay/files/${fileId}`));
		if (content.length !== size || !content.subarray(0, 5).equals(Buffer.from('%PDF-')))
			throw new UserError('Relay returned an invalid PDF');
		if (createHash('sha256').update(content).digest('hex') !== sha256)
			throw new UserError('PDF SHA-256 does not match Relay metadata');
		const binary = await this.helpers.prepareBinaryData(content, filename, 'application/pdf');
		return {
			json: {
				file_id: fileId,
				sha256,
				size_bytes: size,
				filename,
				_ldo: { command_id: commandId, event_id: ready.id, file_id: fileId, sha256 },
			},
			binary: { data: binary },
			pairedItem: { item: index },
		};
	}

	async events(this: IExecuteFunctions, index: number): Promise<INodeExecutionData[]> {
		const types = this.getNodeParameter('eventTypes', index) as string[];
		const query = new URLSearchParams({
			limit: String(this.getNodeParameter('limit', index) as number),
		});
		for (const type of types) query.append('item_type', type);
		const events = await relayRequest<RelayEvent[]>(this, {
			method: 'GET',
			path: `/v1/queue/events?${query.toString()}`,
		});
		return events.map((event) => ({
			json: { ...event, _ldo: { event_id: event.id } },
			pairedItem: { item: index },
		}));
	}

	async finalize(this: IExecuteFunctions, index: number): Promise<INodeExecutionData> {
		const eventId = this.getNodeParameter('eventId', index) as number;
		const action = this.getNodeParameter('finalizeAction', index) as string;
		if (action === 'fail') {
			const result = await relayRequest(this, {
				method: 'POST',
				path: `/v1/queue/events/${requiredEventId(eventId)}/fail`,
				body: {
					error: this.getNodeParameter('error', index) as string,
					retry_after_seconds: this.getNodeParameter('retryAfterSeconds', index) as number,
				},
			});
			return { json: result, pairedItem: { item: index } };
		}
		if (action === 'file') {
			const fileId = requiredFileId(this.getNodeParameter('fileId', index) as string);
			const sha256 = requiredSha256(this.getNodeParameter('sha256', index) as string);
			await relayRequest(this, {
				method: 'POST',
				path: `/v1/relay/files/${fileId}/confirm`,
				body: { sha256 },
			});
		}
		const result = await acknowledge(this, eventId);
		return { json: result, pairedItem: { item: index } };
	}

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const output: INodeExecutionData[] = [];
		for (let index = 0; index < this.getInputData().length; index += 1) {
			try {
				const action = this.getNodeParameter('resource', index) as string;
				// n8n invokes execute with its execution context, not the node instance.
				// Keep the action implementations on the class for testability, but call
				// them explicitly with that context rather than reading instance methods.
				if (action === 'events')
					output.push(...(await Ldo1cRelay.prototype.events.call(this, index)));
				else if (action === 'finalize')
					output.push(await Ldo1cRelay.prototype.finalize.call(this, index));
				else output.push(await Ldo1cRelay.prototype.operation.call(this, index));
			} catch (error) {
				if (this.continueOnFail())
					output.push({ json: { error: error.message }, pairedItem: { item: index } });
				else throw relayError(this, error as Error, index);
			}
		}
		return [output];
	}
}
