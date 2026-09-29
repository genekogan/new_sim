// Shared MCP listing adapter. Registration/dispatch lives only in simulation/control.ts.
import type { z } from 'zod';

type JsonSchemaFn = (o: { target: string }) => Record<string, unknown>;

/**
 * Standard Schema that lists as `schema` (its JSON Schema) but accepts any input unchanged: the
 * controller validates with the very same zod schema and answers with a JSON refusal.
 */
export function listedSchema(schema: z.ZodType) {
  const std = schema['~standard'] as unknown as { jsonSchema: { input: JsonSchemaFn; output: JsonSchemaFn } };
  return {
    '~standard': {
      version: 1 as const,
      vendor: 'mars-engine',
      validate: (value: unknown) => ({ value }),
      jsonSchema: { input: (o: { target: string }) => std.jsonSchema.input(o), output: (o: { target: string }) => std.jsonSchema.output(o) },
    },
  };
}
