import type { IDataObject } from 'n8n-workflow';

export interface ReferenceValue {
	id: string;
	presentation: string;
}

export interface Field {
	id: string;
	presentation?: string;
	value_type?: string;
	reference?: { cache_values?: ReferenceValue[] };
}

export interface ObjectType {
	object_type: string;
	kind?: string;
	operations?: string[];
	fields?: Field[];
	write_fields?: Field[];
	forms?: ReferenceValue[];
	search?: {
		filters: Array<{ id: string; value_type: string; match_modes: string[] }>;
		max_results: number;
		max_period_days: number;
		date_semantics?: string;
	};
}

export interface ProcessProfile {
	id: string;
	presentation?: string;
	object_types?: string[];
	transitions?: Array<{ id: string; presentation?: string }>;
}

export interface Capabilities {
	object_types?: ObjectType[];
	process_profiles?: ProcessProfile[];
}

export interface RelayEvent extends IDataObject {
	id: number;
	payload?: {
		status?: string;
		data?: IDataObject;
		error?: { message?: string };
		file_id?: string;
		sha256?: string;
		size_bytes?: number;
		filename?: string;
	};
}
