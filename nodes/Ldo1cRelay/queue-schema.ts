export const queueColumns = [
	...[
		'database_id',
		'profile_id',
		'policy_revision',
		'kind',
		'command_id',
		'command_type',
		'payload',
		'status',
		'lease_token',
		'result',
	].map((name) => ({ name, type: 'string' })),
	...['lease_until', 'attempt_count', 'ready_at'].map((name) => ({ name, type: 'number' })),
];
