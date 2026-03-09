import type { toJsonSchema as _ToJsonSchema } from '@langchain/core/utils/json_schema';

/**
 * Normalise any tool schema (Zod or JSON schema) into a strict JSON schema
 * object with explicit root type so provider validation does not fail on
 * `tools.N.custom.input_schema.type`.
 */
export function normaliseToolInputSchema(schema: unknown): Record<string, unknown> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { toJsonSchema } = require('@langchain/core/utils/json_schema') as { toJsonSchema: typeof _ToJsonSchema };
    const converted = toJsonSchema(schema as never);
    const jsonSchema = (converted && typeof converted === 'object')
        ? { ...(converted as Record<string, unknown>) }
        : {};

    if (typeof jsonSchema.type !== 'string') {
        jsonSchema.type = 'object';
    }
    if (jsonSchema.type === 'object' && typeof jsonSchema.properties !== 'object') {
        jsonSchema.properties = {};
    }
    if (typeof jsonSchema.additionalProperties === 'undefined') {
        jsonSchema.additionalProperties = false;
    }

    return jsonSchema;
}
