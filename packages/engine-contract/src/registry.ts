import { z } from 'zod';
import type { ActionDef } from './actions.ts';

/** `scope: 'world'` marks a verb that belongs to one world's engine (not the shared body language); such verbs are listed briefly, with schemas on request. */
export type VerbInfo = { verb: string; description: string; inputSchema: Record<string, unknown>; scope?: 'world' };

export function createRegistry(defs: ActionDef[]): Map<string, ActionDef> {
  const m = new Map<string, ActionDef>();
  for (const d of defs) { if (m.has(d.verb)) throw new Error(`duplicate verb ${d.verb}`); m.set(d.verb, d); }
  return m;
}
export const jsonSchemaOf = (schema: z.ZodType) => z.toJSONSchema(schema, { unrepresentable: 'any', io: 'input' }) as Record<string, unknown>;
export const describeVerbs = (registry: Map<string, ActionDef>): VerbInfo[] =>
  [...registry.values()].sort((a, b) => a.verb.localeCompare(b.verb)).map((d) => ({ verb: d.verb, description: d.description, inputSchema: jsonSchemaOf(d.schema) }));
