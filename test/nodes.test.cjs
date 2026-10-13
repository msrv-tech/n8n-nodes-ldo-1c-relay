'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

const credential = {
	apiToken: 'synthetic-test-token',
	apiUrl: 'https://relay.test',
	databaseId: 'demo-base',
	profileId: '11111111-1111-4111-8111-111111111111',
	policyRevision: '22222222-2222-4222-8222-222222222222',
	minimumWaitSeconds: 0,
};

const { Ldo1cRelay } = require('../dist/nodes/Ldo1cRelay/Ldo1cRelay.node');

function context(parameters, responses, input = [{ json: {} }]) {
	const requests = [];
	const execution = {
		requests,
		getInputData: () => input,
		getCredentials: async (name) => {
			assert.equal(name, 'ldoRelayApi');
			return credential;
		},
		getNodeParameter: (name) => parameters[name],
		getCurrentNodeParameter: (name) => parameters[name],
		getNode: () => ({ name: '1С через LDO Relay', typeVersion: 1 }),
		continueOnFail: () => false,
		helpers: {
			httpRequestWithAuthentication: async (credentialType, request) => {
				assert.equal(credentialType, 'ldoRelayApi');
				requests.push(request);
				const response = responses.shift();
				return typeof response === 'function' ? response(request) : response;
			},
			prepareBinaryData: async (content, filename, mimeType) => ({
				data: content.toString('base64'),
				fileName: filename,
				mimeType,
			}),
		},
	};
	return execution;
}

async function testCapabilitiesAndDynamicOptions() {
	const catalogue = {
		capabilities: {
			object_types: [
				{
					object_type: 'document.СчетНаОплатуПоставщика',
					operations: ['document.get'],
					fields: [{ id: 'number' }],
					forms: [{ id: 'Invoice', presentation: 'Счёт' }],
				},
			],
		},
	};
	const node = new Ldo1cRelay();
	const options = context({ documentType: 'document.СчетНаОплатуПоставщика' }, [
		catalogue,
		catalogue,
		catalogue,
	]);
	assert.deepEqual(await node.methods.loadOptions.getDocumentTypes.call(options), [
		{ name: 'document.СчетНаОплатуПоставщика', value: 'document.СчетНаОплатуПоставщика' },
	]);
	assert.deepEqual(await node.methods.loadOptions.getDocumentFields.call(options), [
		{ name: 'number', value: 'number' },
	]);
	assert.deepEqual(await node.methods.loadOptions.getPrintForms.call(options), [
		{ name: 'Счёт', value: 'Invoice' },
	]);

	const run = context(
		{ resource: 'operation', operation: 'capabilities', timeoutSeconds: 1, pollSeconds: 1 },
		[
			{ status: 'accepted' },
			{ id: 17, payload: { status: 'succeeded', data: { operations: ['capabilities.get'] } } },
			{ id: 17, status: 'acknowledged' },
		],
	);
	const output = await Ldo1cRelay.prototype.execute.call(run);
	assert.equal(run.requests[0].url, 'https://relay.test/v1/queue/commands');
	assert.equal(run.requests[0].body.command_type, 'n8n.capabilities.get');
	assert.match(run.requests[0].body.command_id, /^[0-9a-f-]{36}$/);
	assert.match(run.requests[1].url, /\/v1\/queue\/events\/result\//);
	assert.equal(run.requests[2].url, 'https://relay.test/v1/queue/events/17/ack');
	assert.deepEqual(output[0][0].json.operations, ['capabilities.get']);
}

async function testReferenceSelectionModes() {
	const documentId = '33333333-3333-4333-8333-333333333333';
	const userId = '44444444-4444-4444-8444-444444444444';
	const objectType = 'document.СчетНаОплату';
	const fieldId = 'field_author';
	const catalogue = {
		capabilities: {
			object_types: [
				{
					object_type: objectType,
					operations: ['document.fields.update', 'reference.search'],
					write_fields: [
						{
							id: fieldId,
							presentation: 'Автор',
							value_type: 'reference',
							reference: {
								kind: 'catalog',
								metadata_name: 'Пользователи',
								selection_modes: ['id', 'live', 'cache'],
								cache_values: [{ id: userId, presentation: 'Иванов Иван' }],
								cache_complete: true,
							},
						},
					],
				},
			],
		},
	};
	const node = new Ldo1cRelay();
	const options = context({ referenceObjectType: objectType, referenceFieldId: fieldId }, [
		catalogue,
		catalogue,
		catalogue,
	]);
	assert.deepEqual(await node.methods.loadOptions.getReferenceWritableObjectTypes.call(options), [
		{ name: objectType, value: objectType },
	]);
	assert.deepEqual(await node.methods.loadOptions.getReferenceWriteFields.call(options), [
		{ name: 'Автор', value: fieldId },
	]);
	assert.deepEqual(await node.methods.loadOptions.getReferenceCacheValues.call(options), [
		{ name: 'Иванов Иван', value: userId },
	]);

	const direct = context(
		{
			resource: 'operation',
			operation: 'referenceFieldUpdate',
			referenceObjectType: objectType,
			referenceFieldId: fieldId,
			referenceOwnerId: documentId,
			referenceOwnerRevision: 'revision-1',
			referenceValueMode: 'id',
			referenceValueId: userId,
			timeoutSeconds: 1,
			pollSeconds: 1,
		},
		[
			{ status: 'accepted' },
			{ id: 41, payload: { status: 'succeeded', data: { revision: 'revision-2' } } },
			{ id: 41, status: 'acknowledged' },
		],
	);
	const directOutput = await Ldo1cRelay.prototype.execute.call(direct);
	assert.equal(direct.requests[0].body.command_type, 'n8n.document.fields.update');
	assert.deepEqual(direct.requests[0].body.payload.changes, { [fieldId]: { id: userId } });
	assert.equal(directOutput[0][0].json._ldo.reference.mode, 'id');

	const live = context(
		{
			resource: 'operation',
			operation: 'referenceFieldUpdate',
			referenceObjectType: objectType,
			referenceFieldId: fieldId,
			referenceOwnerId: documentId,
			referenceOwnerRevision: 'revision-1',
			referenceValueMode: 'live',
			referenceLiveQuery: 'Иванов',
			timeoutSeconds: 1,
			pollSeconds: 1,
		},
		[
			{ status: 'accepted' },
			{
				id: 42,
				payload: {
					status: 'succeeded',
					data: { items: [{ id: userId, presentation: 'Иванов Иван' }] },
				},
			},
			{ id: 42, status: 'acknowledged' },
			{ status: 'accepted' },
			{ id: 43, payload: { status: 'succeeded', data: { revision: 'revision-2' } } },
			{ id: 43, status: 'acknowledged' },
		],
	);
	const liveOutput = await Ldo1cRelay.prototype.execute.call(live);
	assert.equal(live.requests[0].body.command_type, 'n8n.reference.search');
	assert.equal(live.requests[0].body.payload.limit, 2);
	assert.equal(live.requests[3].body.command_type, 'n8n.document.fields.update');
	assert.equal(liveOutput[0][0].json._ldo.reference.presentation, 'Иванов Иван');

	const cached = context(
		{
			resource: 'operation',
			operation: 'referenceFieldUpdate',
			referenceObjectType: objectType,
			referenceFieldId: fieldId,
			referenceOwnerId: documentId,
			referenceOwnerRevision: 'revision-1',
			referenceValueMode: 'cache',
			referenceCachedId: userId,
			timeoutSeconds: 1,
			pollSeconds: 1,
		},
		[
			catalogue,
			{ status: 'accepted' },
			{ id: 44, payload: { status: 'succeeded', data: { revision: 'revision-2' } } },
			{ id: 44, status: 'acknowledged' },
		],
	);
	const cachedOutput = await Ldo1cRelay.prototype.execute.call(cached);
	assert.equal(cached.requests[1].body.command_type, 'n8n.document.fields.update');
	assert.equal(cachedOutput[0][0].json._ldo.reference.mode, 'cache');
}

async function testPdfOperationAndFinalize() {
	const pdf = Buffer.from('%PDF-test');
	const sha256 = createHash('sha256').update(pdf).digest('hex');
	const run = context(
		{
			resource: 'operation',
			operation: 'documentFilePrepare',
			documentType: 'document.СчетНаОплату',
			documentId: '33333333-3333-4333-8333-333333333333',
			formId: 'Invoice',
			revision: 'revision-1',
			timeoutSeconds: 1,
			pollSeconds: 1,
		},
		[
			{ status: 'accepted' },
			{ id: 19, payload: { status: 'succeeded', data: {} } },
			{ id: 19, status: 'acknowledged' },
			{
				id: 20,
				payload: { file_id: '23', sha256, size_bytes: pdf.length, filename: 'invoice.pdf' },
			},
			pdf,
		],
	);
	const output = await Ldo1cRelay.prototype.execute.call(run);
	assert.equal(run.requests[0].body.command_type, 'n8n.document.file.prepare');
	assert.match(run.requests[3].url, /\/v1\/queue\/events\/file\//);
	assert.equal(run.requests[4].url, 'https://relay.test/v1/relay/files/23');
	assert.equal(output[0][0].binary.data.fileName, 'invoice.pdf');
	assert.equal(output[0][0].json._ldo.event_id, 20);

	const finalize = context(
		{ resource: 'finalize', finalizeAction: 'file', eventId: 20, fileId: '23', sha256 },
		[
			{ id: 23, status: 'confirmed' },
			{ id: 20, status: 'acknowledged' },
		],
	);
	await Ldo1cRelay.prototype.execute.call(finalize);
	assert.equal(finalize.requests[0].url, 'https://relay.test/v1/relay/files/23/confirm');
	assert.deepEqual(finalize.requests[0].body, { sha256 });
	assert.equal(finalize.requests[1].url, 'https://relay.test/v1/queue/events/20/ack');
}

async function testDocumentFieldsUpdate() {
	const documentId = '33333333-3333-4333-8333-333333333333';
	const run = context(
		{
			resource: 'operation',
			operation: 'documentFieldsUpdate',
			writeDocumentType: 'document.ЗаказПокупателя',
			writeDocumentId: documentId,
			expectedDocumentRevision: 'revision-1',
			documentChanges:
				'{"comment":"Проверено роботом","manager":{"id":"44444444-4444-4444-8444-444444444444"}}',
			timeoutSeconds: 1,
			pollSeconds: 1,
		},
		[
			{ status: 'accepted' },
			{
				id: 31,
				payload: {
					status: 'succeeded',
					data: {
						object: { type: 'document.ЗаказПокупателя', id: documentId },
						revision: 'revision-2',
					},
				},
			},
			{ id: 31, status: 'acknowledged' },
		],
	);
	const output = await Ldo1cRelay.prototype.execute.call(run);
	assert.equal(run.requests[0].body.command_type, 'n8n.document.fields.update');
	assert.deepEqual(run.requests[0].body.payload, {
		contract_version: '1.0',
		profile_id: credential.profileId,
		policy_revision: credential.policyRevision,
		object: { type: 'document.ЗаказПокупателя', id: documentId },
		expected_revision: 'revision-1',
		changes: {
			comment: 'Проверено роботом',
			manager: { id: '44444444-4444-4444-8444-444444444444' },
		},
	});
	assert.equal(output[0][0].json.revision, 'revision-2');
}

async function testCatalogOperations() {
	const catalogId = '88888888-8888-4888-8888-888888888888';
	const read = context(
		{
			resource: 'operation',
			operation: 'catalogGet',
			catalogType: 'catalog.НоменклатурныеГруппы',
			catalogId,
			catalogFields: ['name', 'code'],
			timeoutSeconds: 1,
			pollSeconds: 1,
		},
		[
			{ status: 'accepted' },
			{
				id: 32,
				payload: {
					status: 'succeeded',
					data: { revision: 'revision-1', values: { name: 'Основной', code: '001' } },
				},
			},
			{ id: 32, status: 'acknowledged' },
		],
	);
	await Ldo1cRelay.prototype.execute.call(read);
	assert.equal(read.requests[0].body.command_type, 'n8n.catalog.get');
	assert.deepEqual(read.requests[0].body.payload.object, {
		type: 'catalog.НоменклатурныеГруппы',
		id: catalogId,
	});

	const update = context(
		{
			resource: 'operation',
			operation: 'catalogFieldsUpdate',
			writeCatalogType: 'catalog.НоменклатурныеГруппы',
			writeCatalogId: catalogId,
			expectedCatalogRevision: 'revision-1',
			catalogChanges: '{"comment":"Проверено роботом"}',
			timeoutSeconds: 1,
			pollSeconds: 1,
		},
		[
			{ status: 'accepted' },
			{ id: 33, payload: { status: 'succeeded', data: { revision: 'revision-2' } } },
			{ id: 33, status: 'acknowledged' },
		],
	);
	await Ldo1cRelay.prototype.execute.call(update);
	assert.equal(update.requests[0].body.command_type, 'n8n.catalog.fields.update');
	assert.deepEqual(update.requests[0].body.payload.changes, { comment: 'Проверено роботом' });
}

async function testExternalProcessOperations() {
	const profileId = '55555555-5555-4555-8555-555555555555';
	const processId = '66666666-6666-4666-8666-666666666666';
	const documentId = '77777777-7777-4777-8777-777777777777';
	const transition = context(
		{
			resource: 'operation',
			operation: 'processTransition',
			processProfileId: profileId,
			processId,
			expectedRevision: 3,
			transitionId: 'credit_check_passed',
			processValues: '{"risk_score":12}',
			timeoutSeconds: 1,
			pollSeconds: 1,
		},
		[
			{ status: 'accepted' },
			{
				id: 22,
				payload: {
					status: 'succeeded',
					data: { process_id: processId, status: 'finance_review', revision: 4 },
				},
			},
			{ id: 22, status: 'acknowledged' },
		],
	);
	const transitionOutput = await Ldo1cRelay.prototype.execute.call(transition);
	assert.equal(transition.requests[0].body.command_type, 'n8n.process.transition');
	assert.deepEqual(transition.requests[0].body.payload, {
		contract_version: '1.0',
		profile_id: credential.profileId,
		policy_revision: credential.policyRevision,
		process_profile_id: profileId,
		process_id: processId,
		expected_revision: 3,
		transition_id: 'credit_check_passed',
		values: { risk_score: 12 },
	});
	assert.equal(transitionOutput[0][0].json.revision, 4);

	const start = context(
		{
			resource: 'operation',
			operation: 'processStart',
			processProfileId: profileId,
			processDocumentType: 'document.ЗаказПокупателя',
			processDocumentId: documentId,
			timeoutSeconds: 1,
			pollSeconds: 1,
		},
		[
			{ status: 'accepted' },
			{
				id: 23,
				payload: {
					status: 'succeeded',
					data: { process_id: processId, status: 'draft', revision: 1 },
				},
			},
			{ id: 23, status: 'acknowledged' },
		],
	);
	await Ldo1cRelay.prototype.execute.call(start);
	assert.equal(start.requests[0].body.command_type, 'n8n.process.start');
	assert.deepEqual(start.requests[0].body.payload.object, {
		type: 'document.ЗаказПокупателя',
		id: documentId,
	});
}

async function testEventsAndRetry() {
	const events = context({ resource: 'events', eventTypes: ['approval.started'], limit: 20 }, [
		[{ id: 9, item_type: 'approval.started' }],
	]);
	const output = await Ldo1cRelay.prototype.execute.call(events);
	assert.equal(
		events.requests[0].url,
		'https://relay.test/v1/queue/events?limit=20&item_type=approval.started',
	);
	assert.equal(output[0][0].json._ldo.event_id, 9);

	const retry = context(
		{
			resource: 'finalize',
			finalizeAction: 'fail',
			eventId: 9,
			error: 'destination unavailable',
			retryAfterSeconds: 15,
		},
		[{ id: 9, status: 'retry-scheduled' }],
	);
	await Ldo1cRelay.prototype.execute.call(retry);
	assert.equal(retry.requests[0].url, 'https://relay.test/v1/queue/events/9/fail');
	assert.deepEqual(retry.requests[0].body, {
		error: 'destination unavailable',
		retry_after_seconds: 15,
	});
}

function testMinimumWait() {
	const { operationWaitSeconds } = require('../dist/nodes/Ldo1cRelay/relay');
	assert.equal(operationWaitSeconds(60, 0), 60);
	assert.equal(operationWaitSeconds(60, 900), 900);
	assert.equal(operationWaitSeconds(1200, 900), 1200);
	assert.throws(() => operationWaitSeconds(60, 'invalid'));
}

async function testCredentialIsolationAndValidation() {
	const credentialsForSecondDatabase = {
		...credential,
		apiUrl: 'https://second-relay.test/',
		databaseId: 'second-database',
		profileId: 'second-profile',
		policyRevision: 'second-policy',
	};
	const run = context(
		{ resource: 'operation', operation: 'capabilities', timeoutSeconds: 1, pollSeconds: 1 },
		[
			{ status: 'accepted' },
			{ id: 51, payload: { status: 'succeeded', data: {} } },
			{ status: 'acknowledged' },
		],
	);
	run.getCredentials = async () => credentialsForSecondDatabase;
	await Ldo1cRelay.prototype.execute.call(run);
	assert.equal(run.requests[0].url, 'https://second-relay.test/v1/queue/commands');
	assert.equal(run.requests[0].body.database_id, 'second-database');
	assert.equal(run.requests[0].body.payload.profile_id, 'second-profile');
	assert.equal(run.requests[0].body.payload.policy_revision, 'second-policy');
	assert.equal(run.requests[0].disableFollowRedirect, true);
	assert.equal(run.requests[0].path, undefined);
	assert.equal(run.requests[0].body.apiToken, undefined);

	for (const badCredential of [
		{ ...credential, apiToken: '' },
		{ ...credential, apiUrl: 'file:///tmp/relay' },
		{ ...credential, apiUrl: 'https://relay.test/?token=example' },
		{ ...credential, apiUrl: 'https://example:example@relay.test' },
	]) {
		const invalid = context(
			{ resource: 'operation', operation: 'capabilities', timeoutSeconds: 1, pollSeconds: 1 },
			[],
		);
		invalid.getCredentials = async () => badCredential;
		await assert.rejects(() => Ldo1cRelay.prototype.execute.call(invalid));
		assert.equal(invalid.requests.length, 0);
	}
}

async function testAmbiguousReferenceDoesNotWrite() {
	const run = context(
		{
			resource: 'operation',
			operation: 'referenceFieldUpdate',
			referenceObjectType: 'document.Order',
			referenceFieldId: 'manager',
			referenceValueMode: 'live',
			referenceLiveQuery: 'Alex',
			timeoutSeconds: 1,
			pollSeconds: 1,
		},
		[
			{ status: 'accepted' },
			{
				id: 52,
				payload: {
					status: 'succeeded',
					data: {
						items: [
							{ id: 'first', presentation: 'First' },
							{ id: 'second', presentation: 'Second' },
						],
					},
				},
			},
			{ status: 'acknowledged' },
		],
	);
	await assert.rejects(() => Ldo1cRelay.prototype.execute.call(run), /multiple matches/);
	assert.equal(run.requests.filter((request) => request.url.endsWith('/commands')).length, 1);
	assert.equal(run.requests[0].body.command_type, 'n8n.reference.search');
}

async function testCorruptPdfDoesNotConfirmDelivery() {
	const run = context(
		{
			resource: 'operation',
			operation: 'documentFilePrepare',
			documentType: 'document.Order',
			documentId: 'synthetic-id',
			formId: 'Invoice',
			revision: 'revision-1',
			timeoutSeconds: 1,
			pollSeconds: 1,
		},
		[
			{ status: 'accepted' },
			{ id: 53, payload: { status: 'succeeded', data: {} } },
			{ status: 'acknowledged' },
			{
				id: 54,
				payload: { file_id: '55', sha256: '0'.repeat(64), size_bytes: 9, filename: 'invoice.pdf' },
			},
			Buffer.from('%PDF-test'),
		],
	);
	await assert.rejects(() => Ldo1cRelay.prototype.execute.call(run), /SHA-256/);
	assert.equal(
		run.requests.some((request) => request.url.endsWith('/confirm')),
		false,
	);
	assert.equal(
		run.requests.some((request) => request.url.endsWith('/54/ack')),
		false,
	);
}

Promise.resolve()
	.then(testMinimumWait)
	.then(testCredentialIsolationAndValidation)
	.then(testAmbiguousReferenceDoesNotWrite)
	.then(testCorruptPdfDoesNotConfirmDelivery)
	.then(testCapabilitiesAndDynamicOptions)
	.then(testReferenceSelectionModes)
	.then(testPdfOperationAndFinalize)
	.then(testDocumentFieldsUpdate)
	.then(testCatalogOperations)
	.then(testExternalProcessOperations)
	.then(testEventsAndRetry)
	.then(() => console.log('LDO 1C Relay node tests passed'))
	.catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
