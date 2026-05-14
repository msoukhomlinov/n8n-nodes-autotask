#!/usr/bin/env node
/**
 * One-off check: measure tool description length per resource against the
 * P2 lean rewrite target (≤800 chars) and hard limit (1200).
 *
 * Calls buildUnifiedDescriptionTemplate(...) via the compiled dist and reports.
 * Read-only — does not modify project files.
 *
 * Usage:  node scripts/check-description-sizes.js
 */

const path = require('path');

const distRoot = path.resolve(__dirname, '..', 'dist', 'nodes', 'Autotask');

const {
	RESOURCE_OPERATIONS_MAP,
} = require(path.join(distRoot, 'constants', 'resource-operations.js'));

const {
	SUPPORTED_TOOL_OPERATIONS,
} = require(path.join(distRoot, 'ai-tools', 'operation-metadata.js'));

const descBuilders = require(path.join(distRoot, 'ai-tools', 'description-builders.js'));

const { buildUnifiedDescriptionTemplate, injectDescriptionReferenceUtc } = descBuilders;

const TARGET = 800;
const HARD_LIMIT = 1300;

// Synthetic UTC reference for placeholder replacement.
const REFERENCE_UTC = '2026-05-14T00:00:00Z';

// Resources whose tool the user would actually mount. Match AutotaskAiTools.node.ts
// loadOptions filter: keep entries with at least one supported tool op.
const candidateResources = Object.entries(RESOURCE_OPERATIONS_MAP)
	.filter(([, ops]) => ops.some((o) => SUPPORTED_TOOL_OPERATIONS.includes(o)))
	.map(([resource, ops]) => ({
		resource,
		ops: ops.filter((o) => SUPPORTED_TOOL_OPERATIONS.includes(o)),
	}));

const rows = [];

for (const { resource, ops } of candidateResources) {
	const resourceLabel = `${resource} records`;
	// Worst-case rendering: assume impersonation is supported (adds the line).
	const template = buildUnifiedDescriptionTemplate(
		resourceLabel,
		resource,
		ops,
		[], // readFields — lean template doesn't iterate them
		[], // writeFields — same
		true, // supportsImpersonation: worst case adds the line
	);
	const rendered = injectDescriptionReferenceUtc(template, REFERENCE_UTC);
	rows.push({
		resource,
		opsCount: ops.length,
		templateLen: template.length,
		renderedLen: rendered.length,
		overTarget: rendered.length > TARGET,
		overHard: rendered.length > HARD_LIMIT,
	});
}

rows.sort((a, b) => b.renderedLen - a.renderedLen);

const w = (s, n) => String(s).padEnd(n);
console.log(w('resource', 36) + w('ops', 5) + w('len', 6) + w('vs800', 8) + 'vsHARD');
console.log('-'.repeat(70));
for (const r of rows) {
	const flag800 = r.overTarget ? `+${r.renderedLen - TARGET}` : 'ok';
	const flagHard = r.overHard ? `OVER!` : 'ok';
	console.log(w(r.resource, 36) + w(r.opsCount, 5) + w(r.renderedLen, 6) + w(flag800, 8) + flagHard);
}

const overTarget = rows.filter((r) => r.overTarget).length;
const overHard = rows.filter((r) => r.overHard).length;
const max = rows[0]?.renderedLen ?? 0;
const min = rows[rows.length - 1]?.renderedLen ?? 0;
const avg = Math.round(rows.reduce((s, r) => s + r.renderedLen, 0) / rows.length);

console.log('');
console.log(`resources total:      ${rows.length}`);
console.log(`max length:           ${max}`);
console.log(`min length:           ${min}`);
console.log(`avg length:           ${avg}`);
console.log(`over ${TARGET}-char target:  ${overTarget}`);
console.log(`over ${HARD_LIMIT}-char limit: ${overHard}`);

process.exit(overHard > 0 ? 1 : 0);
