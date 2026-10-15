import {
	UserError,
	type IDataObject,
	type IExecuteFunctions,
	type INodeExecutionData,
} from 'n8n-workflow';
import type { Capabilities } from './types';
import { configuration, operationWaitSeconds } from './relay';

type CommandRunner = (
	context: IExecuteFunctions,
	command: string,
	payload: IDataObject,
	timeout: number,
	poll: number,
) => Promise<{ commandId: string; data: IDataObject }>;

export async function searchOperation(
	this: IExecuteFunctions,
	index: number,
	capabilities: Capabilities,
	run: CommandRunner,
): Promise<INodeExecutionData[]> {
	const operation = String(this.getNodeParameter('operation', index));
	const kind = operation === 'documentSearch' ? 'document' : 'catalog';
	const objectType = String(this.getNodeParameter('searchObjectType', index));
	const policy = capabilities.object_types?.find(
		(object) => object.object_type === objectType && object.operations?.includes(`${kind}.search`),
	)?.search;
	if (!policy || !objectType.startsWith(`${kind}.`))
		throw new UserError('Search is not enabled for this object type');
	const collection = this.getNodeParameter('searchFilters', index) as {
		conditions?: Array<{ field: string; match: string; value: string; to?: string }>;
	};
	const filters = collection.conditions || [];
	if (!filters.length || filters.length > 16)
		throw new UserError('Add at least one selective search filter');
	const used = new Set<string>();
	for (const filter of filters) {
		const descriptor = policy.filters.find((field) => field.id === filter.field);
		if (!descriptor || used.has(filter.field) || !descriptor.match_modes.includes(filter.match))
			throw new UserError('The selected search filter or match mode is not allowed by 1C');
		if (typeof filter.value !== 'string' || !filter.value.trim() || filter.value.length > 120)
			throw new UserError('Enter a search value of at most 120 characters');
		used.add(filter.field);
	}
	const mode = String(this.getNodeParameter('searchResultMode', index));
	const all = mode === 'list' && this.getNodeParameter('searchReturnAll', index) === true;
	const limit =
		mode === 'single' ? 2 : all ? 50 : Number(this.getNodeParameter('searchLimit', index));
	if (!Number.isInteger(limit) || limit < 1 || limit > 50)
		throw new UserError('Search limit must be between 1 and 50');
	const timeout = operationWaitSeconds(
		Number(this.getNodeParameter('timeoutSeconds', index)),
		(await configuration(this)).minimumWaitSeconds,
	);
	const poll = Number(this.getNodeParameter('pollSeconds', index));
	const deadline = Date.now() + timeout * 1000;
	let cursor = mode === 'single' ? '' : String(this.getNodeParameter('searchCursor', index, ''));
	const cursors = new Set<string>();
	const output: INodeExecutionData[] = [];
	const commandIds: string[] = [];
	do {
		if (Date.now() >= deadline) throw new UserError('Search exceeded the total configured timeout');
		if (cursor && cursors.has(cursor)) throw new UserError('1C returned a repeated search cursor');
		cursors.add(cursor);
		const completed = await run(
			this,
			`n8n.${kind}.search`,
			{
				object_type: objectType,
				filters: filters as unknown as IDataObject[],
				limit,
				cursor,
				result_mode: mode,
			},
			Math.max(1, Math.ceil((deadline - Date.now()) / 1000)),
			poll,
		);
		const { items, has_more: more, next_cursor: next } = completed.data;
		if (
			!Array.isArray(items) ||
			typeof more !== 'boolean' ||
			typeof next !== 'string' ||
			(more && (!next || items.length === 0))
		)
			throw new UserError('1C returned an invalid search page');
		if (mode === 'single' && (items.length !== 1 || more))
			throw new UserError(items.length === 0 ? 'object_not_found' : 'ambiguous_match');
		if (items.length > limit) throw new UserError('1C exceeded the requested page limit');
		commandIds.push(completed.commandId);
		for (const item of items as IDataObject[]) {
			const object = item.object as IDataObject | undefined;
			if (
				object?.type !== objectType ||
				typeof object.id !== 'string' ||
				typeof item.revision !== 'string'
			)
				throw new UserError('1C returned an invalid search object');
			output.push({
				json: {
					...item,
					_ldo: {
						command_id: completed.commandId,
						operation: `n8n.${kind}.search`,
						search: { has_more: more, next_cursor: next },
					},
				},
				pairedItem: { item: index },
			});
		}
		if (output.length > policy.max_results)
			throw new UserError('search_limit_exceeded: refine the filters');
		cursor = next;
		if (!all || !more) break;
	} while (all && cursor.length > 0);
	if (all)
		for (const item of output)
			item.json._ldo = {
				...(item.json._ldo as IDataObject),
				command_ids: commandIds,
				search: { has_more: false, next_cursor: '' },
			};
	return output;
}
