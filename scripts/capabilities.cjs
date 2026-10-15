/* Editorial registry + actual node UI metadata -> Markdown and portable JSON. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'docs/capabilities');
const registry = JSON.parse(fs.readFileSync(path.join(dir, 'registry.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const sourcePath = 'nodes/Ldo1cRelay/Ldo1cRelay.node.ts';
const source = ts.createSourceFile(
	sourcePath,
	fs.readFileSync(path.join(root, sourcePath), 'utf8'),
	ts.ScriptTarget.Latest,
	true,
);
const constants = new Map();
function literal(node) {
	if (!node) return undefined;
	if (ts.isStringLiteral(node) || ts.isNumericLiteral(node))
		return ts.isNumericLiteral(node) ? Number(node.text) : node.text;
	if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
	if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
	if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node))
		return literal(node.expression);
	if (ts.isIdentifier(node))
		return constants.has(node.text) ? literal(constants.get(node.text)) : undefined;
	if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
	if (ts.isObjectLiteralExpression(node))
		return Object.fromEntries(
			node.properties
				.filter(ts.isPropertyAssignment)
				.map((p) => [p.name.text, literal(p.initializer)]),
		);
	return undefined;
}
let description;
function walk(node) {
	if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name))
		constants.set(node.name.text, node.initializer);
	if (ts.isPropertyDeclaration(node) && node.name.getText(source) === 'description')
		description = node.initializer;
	ts.forEachChild(node, walk);
}
walk(source);
const ui = literal(description);
assert(ui && Array.isArray(ui.properties), 'Node UI description not found');
assert.equal(registry.schemaVersion, 1);
assert.equal(registry.packageVersion, pkg.version, 'Update registry for the new package version');
assert(/^\d+\.\d+$/.test(registry.coreVersion), 'Record the compatible LDO core release');
const release = JSON.parse(fs.readFileSync(path.join(dir, 'release.json'), 'utf8'));
assert.equal(release.schemaVersion, 1);
assert.equal(release.version, pkg.version, 'Update release notes for the new npm version');
assert.equal(release.coreVersion, registry.coreVersion);
assert(
	release.compatibleCoreVersions?.includes(registry.coreVersion),
	'List explicitly compatible published cores',
);
assert(release.compatibleCoreVersions.every((v) => /^\d+\.\d+$/.test(v)));
assert(/^\d{4}-\d{2}-\d{2}$/.test(release.date));
assert(release.summary && release.changes.length, 'Write user-facing release notes');
const versionAtMost = (value, maximum) => {
	const left = value.split('.').map(Number);
	const right = maximum.split('.').map(Number);
	for (let i = 0; i < left.length; i++) {
		if (left[i] !== right[i]) return left[i] < right[i];
	}
	return true;
};
for (const item of [...registry.operations, ...registry.features]) {
	const since = item.introducedIn;
	assert(
		since && /^\d+\.\d+\.\d+$/.test(since.nodeVersion) && /^\d+\.\d+$/.test(since.coreVersion),
		`Record introduction versions: ${item.id}`,
	);
	assert(versionAtMost(since.nodeVersion, pkg.version), `Future node requirement: ${item.id}`);
	assert(
		versionAtMost(since.coreVersion, registry.coreVersion),
		`Future core requirement: ${item.id}`,
	);
}
assert.deepEqual(registry.nodeVersions, ui.version);
const ids = new Set();
for (const item of [
	...registry.operations,
	...registry.features,
	...registry.gaps,
	...registry.evidence,
]) {
	assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id), `Invalid stable ID: ${item.id}`);
	assert(!ids.has(item.id), `Duplicate ID: ${item.id}`);
	ids.add(item.id);
}
const evidenceIds = new Set(registry.evidence.map((e) => e.id));
for (const gap of registry.gaps) {
	assert(['not-implemented', 'needs-validation', 'validated'].includes(gap.status));
	assert(
		(gap.evidence || []).every((id) => evidenceIds.has(id)),
		`Invalid evidence: ${gap.id}`,
	);
	if (gap.status === 'validated')
		assert(gap.evidence?.length, `Validated scenario requires evidence: ${gap.id}`);
}
const modes = new Set(registry.transports.map((t) => t.id));
function available(p, values) {
	const { show = {}, hide = {} } = p.displayOptions || {};
	return (
		Object.entries(show).every(([key, allowed]) => allowed.includes(values[key])) &&
		Object.entries(hide).every(([key, denied]) => !denied.includes(values[key]))
	);
}
const actualActions = new Map();
for (const prop of ui.properties.filter(
	(p) => p.name === 'operation' || p.name === 'finalizeAction',
)) {
	const resource = prop.displayOptions.show.resource[0];
	for (const option of prop.options) actualActions.set(`${resource}:${option.value}`, option.name);
}
actualActions.set('events:', 'Lease Events');
assert.equal(actualActions.size, registry.operations.length, 'Operation count differs from UI');
for (const op of registry.operations) {
	const key = `${op.resource}:${op.operation || ''}`;
	assert(actualActions.has(key), `Registry action not found in UI: ${key}`);
	op.uiName = actualActions.get(key);
	actualActions.delete(key);
	assert.equal(op.status, 'implemented');
	assert(
		op.transports.length && op.transports.every((m) => modes.has(m)),
		`Invalid transports: ${op.id}`,
	);
	for (const field of ['summary', 'title', 'example'])
		assert(typeof op[field] === 'string' && op[field], `Missing ${field}: ${op.id}`);
	for (const field of ['outputs', 'permissions', 'limitations', 'errors'])
		assert(Array.isArray(op[field]) && op[field].length, `Missing ${field}: ${op.id}`);
	assert(
		op.evidence.every((id) => evidenceIds.has(id)),
		`Invalid evidence: ${op.id}`,
	);
	const parameters = new Map();
	for (const mode of op.transports) {
		const values = {
			resource: op.resource,
			operation: op.operation,
			finalizeAction: op.operation,
			connectionMode: mode,
			'@version': 2,
		};
		for (const p of ui.properties) {
			if (
				['resource', 'operation', 'finalizeAction', 'connectionMode'].includes(p.name) ||
				p.type === 'hidden'
			)
				continue;
			// Preserve conditional fields; selection value is shown beside them.
			const conditions = Object.fromEntries(
				Object.entries(p.displayOptions?.show || {}).filter(([key]) => key in values),
			);
			const hidden = Object.fromEntries(
				Object.entries(p.displayOptions?.hide || {}).filter(([key]) => key in values),
			);
			if (!available({ ...p, displayOptions: { show: conditions, hide: hidden } }, values))
				continue;
			const existing = parameters.get(p.name);
			if (existing) {
				existing.transports.push(mode);
				continue;
			}
			parameters.set(p.name, {
				name: p.name,
				label: p.displayName,
				type: p.type,
				required: p.required === true,
				default: p.default,
				bounds:
					p.typeOptions?.minValue !== undefined
						? { min: p.typeOptions.minValue, max: p.typeOptions.maxValue }
						: undefined,
				choices: p.options?.map((o) => ({ value: o.value, label: o.name })),
				condition: p.displayOptions?.show?.referenceValueMode,
				visibility: p.displayOptions,
				fields: p.type === 'fixedCollection' ? p.options : undefined,
				optionsSource: p.typeOptions?.loadOptionsMethod,
				transports: [mode],
			});
		}
	}
	op.parameters = [...parameters.values()];
}
assert.equal(actualActions.size, 0, 'Undocumented UI actions');
for (const feature of registry.features)
	assert(
		feature.evidence.every((id) => evidenceIds.has(id)),
		`Invalid feature evidence: ${feature.id}`,
	);
const list = (values) => values.map((v) => `- ${v}`).join('\n');
const modeNames = (ms) =>
	ms.map((m) => registry.transports.find((t) => t.id === m).title).join(', ');
const esc = (s) => String(s).replaceAll('|', '\\|').replaceAll('\n', ' ');
const evidenceLinks = (es) =>
	es.length
		? es.map((id) => `[${id}](#${id})`).join(', ')
		: 'Отдельная реальная проверка этой операции в реестре не зафиксирована. Это не означает отсутствие реализации.';
let md = `<!-- Generated by scripts/capabilities.cjs. Edit registry.json or node UI metadata. -->\n# Реестр возможностей LDO 1C для n8n\n\nСрез: ${registry.updatedAt}. Пакет **${registry.package} ${registry.packageVersion}**, версии основной ноды ${registry.nodeVersions.join('/')}, контракт ${registry.contractVersion}.\n\n${registry.description}\n\n[Правила ведения и будущая база знаний](../knowledge-base.md) · [Исходные данные](registry.json) · [JSON для публикации](catalog.json) · [Главная документация](../../README.md)\n\n## Как читать реестр\n\n- «Реализовано» означает наличие действия в текущем коде, а не проверку каждого транспорта на каждой конфигурации.\n- Доступность в вашей базе определяется её локальным профилем, capabilities и штатными правами 1С.\n- Доказательства привязаны к версиям и сценарию; предыдущий тест не заменяет новый прогон.\n- Все карточки имеют постоянный ID для ссылок, поиска и будущих страниц сайта.\n- Параметры и английские имена интерфейса извлекаются из TypeScript ноды; описания и доказательства ведутся в registry.json.\n\n## Подключения\n\n`;
for (const t of registry.transports)
	md += `### ${t.title}\n\nCredential: **${t.credential}**.\n\n${t.authentication}\n\nТребования: ${t.requirements}\n\nMSRV: ${t.msrvAccess}\n\n[Инструкция](${t.guide})\n\n`;
md += `## Операции\n\n${registry.operations.length} действий основной ноды. Update Reference Field — составное действие; Event не имеет отдельного переключателя Operation. Поэтому число действий отличается от числа команд контракта.\n\n| ID | Действие n8n | Назначение | Транспорты |\n| --- | --- | --- | --- |\n`;
for (const op of registry.operations)
	md += `| [${op.id}](#${op.id}) | ${op.uiName} | ${op.title} | ${modeNames(op.transports)} |\n`;
for (const op of registry.operations) {
	md += `\n<a id="${op.id}"></a>\n\n### ${op.title}\n\n**${op.uiName}** · Resource: \`${op.resource}\`${op.operation ? ` · код действия: \`${op.operation}\`` : ''}\n\n${op.summary}\n\nСтатус: реализовано. Транспорты: ${modeNames(op.transports)}.\n\nКоманды: ${op.commands.length ? op.commands.map((c) => `\`${c}\``).join(', ') : 'служебное действие транспорта; не команда бизнес-обработчика 1С'}.\n\nПараметры интерфейса (среди них есть общие настройки подключения и ожидания):\n\n| Код / поле | Тип | Обязательно по UI | По умолчанию | Условие / варианты |\n| --- | --- | --- | --- | --- |\n`;
	for (const p of op.parameters) {
		const notes = [
			p.condition ? `Value Source=${p.condition.join('/')}` : '',
			p.visibility?.show?.searchResultMode
				? `Result Mode=${p.visibility.show.searchResultMode.join('/')}`
				: '',
			p.visibility?.hide?.searchReturnAll ? 'При выключенном Return All' : '',
			p.choices ? p.choices.map((c) => `${c.label}: ${c.value}`).join('; ') : '',
			p.bounds
				? p.bounds.max === undefined
					? `от ${p.bounds.min}`
					: `${p.bounds.min}–${p.bounds.max}`
				: '',
			p.optionsSource ? `Динамический список: ${p.optionsSource}` : '',
			p.transports.length !== op.transports.length ? modeNames(p.transports) : '',
		]
			.filter(Boolean)
			.join('; ');
		md += `| \`${p.name}\` / ${esc(p.label)} | ${p.type} | ${p.required ? 'да' : 'нет'} | ${esc(JSON.stringify(p.default) ?? '—')} | ${esc(notes) || '—'} |\n`;
	}
	md += `\n«Обязательно по UI» отражает required в описании ноды; дополнительные проверки выполняются при исполнении в 1С. Пустое поле или {} не являются разрешением обойти политику.\n\nРезультат:\n\n${list(op.outputs)}\n\nРазрешения:\n\n${list(op.permissions)}\n\nОграничения:\n\n${list(op.limitations)}\n\nОтказы и ошибки (причины; точный текст зависит от транспорта):\n\n${list(op.errors)}\n\nСценарий: ${op.example}\n\nРеальные проверки: ${evidenceLinks(op.evidence)}\n`;
}
md += '\n## Другие возможности\n';
for (const f of registry.features)
	md += `\n<a id="${f.id}"></a>\n\n### ${f.title}\n\nСтатус: реализовано. ${f.summary}\n\nОграничения: ${f.limitations}\n\n[Источник](${f.source}). Реальные проверки: ${evidenceLinks(f.evidence)}\n`;
md +=
	'\n## Пробелы и статус сценариев\n\nСтатус not-implemented означает отсутствие операции. needs-validation означает необходимость проверки сочетания версий/сценария. validated означает закрытый конкретным доказательством сценарий; запись сохраняет постоянный ID. Эти записи не утверждают сроки разработки.\n';
for (const g of registry.gaps)
	md += `\n<a id="${g.id}"></a>\n\n### ${g.title}\n\nСтатус: \`${g.status}\`. ${g.description}\n${g.design ? `\n[Проект следующего шага](${g.design})\n` : ''}${g.evidence ? `\nПроверки: ${evidenceLinks(g.evidence)}\n` : ''}`;
md +=
	'\n## Доказательства реальных проверок\n\nРезультаты привязаны к версиям и сценариям. [Воспроизводимый серверный набор](../../test/integration/README.md) и [матрица покрытия](../../test/integration/coverage.md) описывают запуск и ограничения. Контрактные тесты с синтетическими ответами находятся в test/nodes.test.cjs, test/standalone.test.cjs и test/pairing.test.cjs; они не доказывают реальные действия в 1С.\n';
for (const e of registry.evidence)
	md += `\n<a id="${e.id}"></a>\n\n### ${e.id}\n\nУровень: \`${e.level}\`. Дата: ${e.date}.\n\nВерсии: ${e.versions}.\n\nПокрытие: ${e.scope}\n\n[Отчёт](${e.source})\n`;
const outputs = { 'README.md': md, 'catalog.json': JSON.stringify(registry, null, 2) + '\n' };
for (const [file, text] of Object.entries(outputs)) {
	const target = path.join(dir, file);
	if (process.argv.includes('--check'))
		assert.equal(fs.readFileSync(target, 'utf8'), text, `${file} is stale; run npm run docs:build`);
	else fs.writeFileSync(target, text);
}
console.log(
	`Capabilities registry: ${registry.operations.length} actions match node UI; ${registry.features.length} features, ${registry.gaps.length} gaps; ${process.argv.includes('--check') ? 'checked' : 'generated'}.`,
);
