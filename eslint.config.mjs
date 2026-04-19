import { configWithoutCloudSupport } from '@n8n/node-cli/eslint';

export default [
	...configWithoutCloudSupport,
	{
		ignores: ['tests/**'],
	},
	{
		files: ['credentials/**/*.ts'],
		rules: {
			'n8n-nodes-base/cred-class-field-documentation-url-missing': 'off',
			'n8n-nodes-base/cred-class-field-documentation-url-miscased': 'off',
		},
	},
	{
		files: ['nodes/**/*.ts', 'credentials/**/*.ts'],
		rules: {
			// Server-side node — console is the only logging mechanism available
			'no-console': 'off',
			// Many catch blocks intentionally ignore the error variable
			'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '.*' }],
			// Duplicate imports from n8n-workflow split type-only vs value imports (required by isolatedModules)
			'import-x/no-duplicates': 'off',
			// Empty interfaces used as branded type aliases (JsonObject, JsonArray, IValidationRules)
			'@typescript-eslint/no-empty-object-type': 'off',
			// Singleton initializer side-effects (rateTracker, endpointThreadTracker)
			'@typescript-eslint/no-unused-expressions': 'off',
			// IRequestOptions → IHttpRequestOptions migration is planned but non-trivial
			'@n8n/community-nodes/no-deprecated-workflow-functions': 'off',
		},
	},
	{
		// runtime.ts intentionally uses createRequire + any for LangChain instanceof compatibility
		files: ['nodes/Autotask/ai-tools/runtime.ts'],
		rules: {
			'@typescript-eslint/no-require-imports': 'off',
			'@typescript-eslint/no-explicit-any': 'off',
		},
	},
	{
		// credential-masking deals with arbitrary error/object shapes — any is correct here
		files: ['nodes/Autotask/helpers/security/credential-masking.ts'],
		rules: {
			'@typescript-eslint/no-explicit-any': 'off',
		},
	},
	{
		// Autotask.node.ts defines description via a separate const — linter can't see icon statically
		files: ['nodes/Autotask/Autotask.node.ts'],
		rules: {
			'@n8n/community-nodes/icon-validation': 'off',
		},
	},
	{
		files: ['nodes/**/*.ts'],
		rules: {
			'n8n-nodes-base/node-execute-block-missing-continue-on-fail': 'off',
			'n8n-nodes-base/node-resource-description-filename-against-convention': 'off',
			'n8n-nodes-base/node-param-fixed-collection-type-unsorted-items': 'off',
			'n8n-nodes-base/node-param-options-type-unsorted-items': 'off',
			'n8n-nodes-base/node-class-description-inputs-wrong-regular-node': 'off',
			'n8n-nodes-base/node-class-description-outputs-wrong': 'off',
			'n8n-nodes-base/node-param-resource-with-plural-option': 'off',
		},
	},
	{
		files: ['package.json'],
		rules: {
			'n8n-nodes-base/community-package-json-name-still-default': 'off',
		},
	},
];
