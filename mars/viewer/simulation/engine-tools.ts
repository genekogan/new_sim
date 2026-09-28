// engine_* MCP tools, generated from the engine controller's op registry
// (engine/api/schemas.ts) — no parallel control system (spec §13, §15).
// Tool listings publish each op's zod JSON Schema, but input is validated once,
// inside controller.call, so a bad argument comes back as the same JSON refusal
// envelope as every other failure ({ ok:false, code:'op.invalid-input', message,
// details.issues }, isError) instead of the SDK's plain-text validation error.
import type { McpServer } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import { engineTools } from '../engine/api/index.ts';

export type EngineInvoke = (op: string, args: unknown) => Promise<{ ok: boolean; [k: string]: unknown }>;

export const ENGINE_TOOL_NAMES = engineTools().map((t) => t.name);

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

export function registerEngineTools(server: McpServer, invoke: EngineInvoke) {
  for (const t of engineTools())
    server.registerTool(
      t.name,
      { description: t.description, inputSchema: listedSchema(t.inputSchema) as unknown as typeof t.inputSchema, annotations: { readOnlyHint: t.readOnly } },
      async (args: unknown) => {
        try {
          const r = await invoke(t.op, args);
          return { ...(r.ok === false ? { isError: true } : {}), content: [{ type: 'text' as const, text: JSON.stringify(r) }] };
        } catch (e) {
          return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, code: 'engine.error', message: e instanceof Error ? e.message : 'engine call failed' }) }] };
        }
      },
    );
}
