// Shared MCP listing adapter. Registration/dispatch lives only in simulation/control.ts.
import type { z } from 'zod';

type JsonSchemaOptions = { target: string; libraryOptions?: Record<string, unknown> };
type JsonSchemaFn = (o: JsonSchemaOptions) => Record<string, unknown>;
type Direction = 'input' | 'output';
// Schemas in the shared registry are stable. Keep conversion results private;
// each server receives its own JSON tree, including nested schema definitions.
const jsonSchemas = new WeakMap<z.ZodType, Record<Direction, Map<string, Record<string, unknown>>>>();

function schemaJSON(schema: z.ZodType, direction: Direction, options: JsonSchemaOptions) {
  const std = schema['~standard'] as unknown as { jsonSchema: Record<Direction, JsonSchemaFn> };
  // Vendor options can change conversion semantics. Only the SDK's target-only
  // requests share a cache key; preserve other requests by converting them directly.
  if (Object.keys(options).some((key) => key !== 'target')) return structuredClone(std.jsonSchema[direction](options));
  let cached = jsonSchemas.get(schema);
  if (!cached) {
    cached = { input: new Map(), output: new Map() };
    jsonSchemas.set(schema, cached);
  }
  let json = cached[direction].get(options.target);
  if (!json) {
    json = structuredClone(std.jsonSchema[direction](options));
    cached[direction].set(options.target, json);
  }
  return structuredClone(json);
}

/**
 * Standard Schema that lists as `schema` (its JSON Schema) but accepts any input unchanged: the
 * controller validates with the very same zod schema and answers with a JSON refusal.
 */
export function listedSchema(schema: z.ZodType) {
  return {
    '~standard': {
      version: 1 as const,
      vendor: 'mars-engine',
      validate: (value: unknown) => ({ value }),
      jsonSchema: { input: (o: JsonSchemaOptions) => schemaJSON(schema, 'input', o), output: (o: JsonSchemaOptions) => schemaJSON(schema, 'output', o) },
    },
  };
}
