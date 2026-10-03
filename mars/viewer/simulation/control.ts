// One transport registry; engine workspaces and live viewer state remain distinct domains (LM-202).
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { engineTools } from '../engine/api/index.ts';
import { definitions } from './commands.ts';
import { legacyDescription, legacyRefusal } from './legacy.ts';
import { listedSchema } from './engine-tools.ts';

type ControlTool = { name: string; target: 'engine' | 'viewer'; op: string; inputSchema: z.ZodType; description: string; readOnly: boolean };
export type ControlContext = {
  engine(op: string, args: unknown): Promise<{ ok: boolean; [k: string]: unknown }>;
  viewerCommand(name: string, args: unknown, commandId: string): Promise<unknown>;
  snapshot(): Promise<unknown>;
  capabilities(): unknown;
};

export function controlTools(): ControlTool[] {
  return [
    ...engineTools().map((t) => ({ ...t, target: 'engine' as const })),
    ...[
      { name: 'get_state', description: 'Inspect room state, current positions, person IDs, walking capabilities, units and limitations.', inputSchema: z.object({}), readOnly: true },
      { name: 'get_capabilities', description: 'Discover all tools, full JSON schemas, stable entity/screen/rider IDs, landmarks, units, clock semantics and limitations. Call this before composing scene commands.', inputSchema: z.object({}), readOnly: true },
      ...Object.entries(definitions).map(([name, def]) => ({ name, description: def.description, inputSchema: def.schema, readOnly: false })),
    ].map((t) => ({ ...t, target: 'viewer' as const, op: t.name, description: legacyDescription(t.name, t.description) })),
  ];
}
const registry = new Map(controlTools().map((tool) => [tool.name, tool]));

/** Auth is enforced by the transport before dispatch. REST retains its viewer-command-only contract. */
export async function dispatchControl(context: ControlContext, name: string, args: unknown, options: { commandId?: string; viewerCommandsOnly?: boolean } = {}): Promise<{ value: unknown; isError: boolean }> {
  const tool = registry.get(name);
  try {
    if (!tool || (options.viewerCommandsOnly && (tool.target !== 'viewer' || tool.readOnly))) throw new Error('Unknown command');
    if (tool.target === 'engine') {
      const value = await context.engine(tool.op, args);
      return { value, isError: value.ok === false };
    }
    const parsed = tool.inputSchema.parse(args);
    const value = tool.name === 'get_state' ? await context.snapshot()
      : tool.name === 'get_capabilities' ? context.capabilities()
      : await context.viewerCommand(tool.op, parsed, options.commandId ?? crypto.randomUUID());
    return { value, isError: false };
  } catch (error) {
    const value = tool?.target === 'engine' && !options.viewerCommandsOnly
      ? { ok: false, code: 'engine.error', message: error instanceof Error ? error.message : 'engine call failed' }
      : legacyRefusal(name, error);
    return { value, isError: true };
  }
}

export function registerControlTools(server: McpServer, context: ControlContext) {
  for (const tool of registry.values()) server.registerTool(tool.name, {
    description: tool.description,
    // Publish precise schemas but validate in the shared dispatcher/controller, preserving JSON refusals.
    inputSchema: listedSchema(tool.inputSchema) as unknown as z.ZodType,
    annotations: { readOnlyHint: tool.readOnly },
  }, async (args: unknown) => {
    const result = await dispatchControl(context, tool.name, args);
    return { ...(result.isError ? { isError: true } : {}), content: [{ type: 'text' as const, text: JSON.stringify(result.value) }] };
  });
}
