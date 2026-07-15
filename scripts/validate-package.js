#!/usr/bin/env node
/**
 * Regression guard for the nested-n8n-workflow / esprima-next load failure.
 *
 * n8n's Community Nodes UI installs each node with `npm install` rooted at
 * `~/.n8n/nodes` (or `N8N_USER_FOLDER/nodes`), a directory with its own
 * synthetic package.json that does not share node_modules with n8n core.
 * `@n8n/eslint-plugin-community-nodes`'s `valid-peer-dependencies` rule
 * requires `peerDependencies["n8n-workflow"] = "*"` to be present, so it
 * cannot simply be removed. Left on its own, though, that wildcard peer lets
 * npm's peer-auto-install treat the "unmet" peer as something to resolve and
 * install directly into that root — creating a second, independently
 * resolved copy of n8n-workflow nested inside the community node's own
 * install tree, version-drifted from (and here missing transitive deps
 * such as esprima-next relative to) the copy n8n core itself bundles.
 *
 * The fix is `peerDependenciesMeta["n8n-workflow"].optional = true`: it
 * keeps the required peer declaration (satisfying the lint rule and
 * documenting real compatibility) while telling npm/pnpm this peer is
 * host-provided and must never be auto-installed. n8n-workflow stays a
 * devDependency for local typecheck/build only; n8n core always has its own
 * complete copy already loaded, and this package's eager, top-level
 * `import { ... } from 'n8n-workflow'` statements resolve up to it via
 * normal Node module resolution as long as nothing nested shadows it.
 *
 * This script guards all three invariants so a future edit can't silently
 * drop the `optional: true` marker (which would reintroduce the bug while
 * leaving the peerDependencies block looking correct at a glance) or
 * reintroduce n8n-workflow as a bundled dependency.
 *
 * Usage: node scripts/validate-package.js
 */

const path = require('path');
const { execFileSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const pkg = require(path.join(repoRoot, 'package.json'));

const DEP_NAME = 'n8n-workflow';
let failed = false;

function fail(msg) {
	console.error(`✖ ${msg}`);
	failed = true;
}
function ok(msg) {
	console.log(`✔ ${msg}`);
}

let packFiles = [];
try {
	const raw = execFileSync('npm', ['pack', '--dry-run', '--json'], {
		cwd: repoRoot,
		encoding: 'utf8',
	});
	const parsed = JSON.parse(raw);
	packFiles = parsed[0]?.files?.map((f) => f.path) ?? [];
} catch (err) {
	fail(`\`npm pack --dry-run --json\` failed: ${err.message}`);
}

if (!packFiles.includes('package.json')) {
	fail('package.json is not present in the npm pack file list.');
} else {
	ok('package.json is present in the npm pack file list.');
}

if (pkg.dependencies && Object.prototype.hasOwnProperty.call(pkg.dependencies, DEP_NAME)) {
	fail(`"dependencies.${DEP_NAME}" is set — remove it. n8n-workflow must never be bundled.`);
} else {
	ok(`"dependencies.${DEP_NAME}" is absent.`);
}

if (!pkg.devDependencies || !pkg.devDependencies[DEP_NAME]) {
	fail(`"devDependencies.${DEP_NAME}" is missing — local typecheck/build needs n8n-workflow's types.`);
} else {
	ok(`"devDependencies.${DEP_NAME}" = ${pkg.devDependencies[DEP_NAME]}`);
}

if (!pkg.peerDependencies || pkg.peerDependencies[DEP_NAME] !== '*') {
	fail(
		`"peerDependencies.${DEP_NAME}" must be exactly "*" — required by ` +
			"@n8n/eslint-plugin-community-nodes's valid-peer-dependencies rule.",
	);
} else {
	ok(`"peerDependencies.${DEP_NAME}" = "*"`);
}

if (!pkg.peerDependenciesMeta?.[DEP_NAME]?.optional) {
	fail(
		`"peerDependenciesMeta.${DEP_NAME}.optional" must be true — without it, npm/pnpm treat the wildcard ` +
			"peer above as unmet and auto-install a separate, nested copy of n8n-workflow inside the community " +
			'node\'s own install tree (the exact incident this guards against; see CHANGELOG 2.26.1).',
	);
} else {
	ok(`"peerDependenciesMeta.${DEP_NAME}.optional" is true.`);
}

if (failed) {
	console.error('\nPackage validation failed.');
	process.exit(1);
}
console.log('\nPackage validation passed.');
