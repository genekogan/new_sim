// engine_* MCP tools, generated from the engine controller's op registry
// (engine/api/schemas.ts). Same zod schemas validate MCP input here and again
// inside controller.call — no parallel control system (spec §13, §15).
import type { McpServer } from '@modelcontextprotocol/server';
import { engineTools } from '../engine/api/index.ts';

export type EngineInvoke = (op: string, args: unknown) => Promise<{ ok: boolean; [k: string]: unknown }>;

export const ENGINE_TOOL_NAMES = engineTools().map((t) => t.name);

export function registerEngineTools(server: McpServer, invoke: EngineInvoke) {
  for (const t of engineTools())
    server.registerTool(
      t.name,
      { description: t.description, inputSchema: t.inputSchema, annotations: { readOnlyHint: t.readOnly } },
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
