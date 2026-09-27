// The ONE action registry + engine configuration used by every host: Node
// tests, the browser, and the Durable Object control plane (spec §13, §15).
// MCP tools, JSON Schemas and in-process calls are all generated from here;
// there is no parallel control system.
import { z } from 'zod';
import type { ActionDef } from '../actions/types.ts';
import { walkTo } from '../locomotion/walk.ts';
import { carry } from '../carry/actions.ts';
import { CARRY_INVARIANTS } from '../carry/invariants.ts';
import { CONSTRUCTION_ACTIONS, liftHandsInReach, RULES_VERSION as ASSEMBLY_RULES, progressiveContributor, progressiveSupported, uprightsSupported } from '../construction/index.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import type { Invariant } from '../runtime/runtime.ts';
import type { EngineConfig } from '../rehearsal/rehearse.ts';
import { Spatial } from '../spatial/service.ts';
import type { SpatialScene } from '../spatial/types.ts';
import type { WorldState } from '../world/types.ts';

/** Changing any verb's semantics, DT or an invariant is a rules-version change (plans bound under another version go stale). */
export const ENGINE_RULES_VERSION = `mars-engine/1+${ASSEMBLY_RULES}`;

export const ENGINE_ACTIONS: ActionDef[] = [walkTo, carry, ...CONSTRUCTION_ACTIONS];
export const ENGINE_INVARIANTS: Invariant[] = [...DEFAULT_INVARIANTS, ...CARRY_INVARIANTS, uprightsSupported, progressiveSupported, liftHandsInReach];

export function createRegistry(extra: ActionDef[] = []): Map<string, ActionDef> {
  const m = new Map<string, ActionDef>();
  for (const a of [...ENGINE_ACTIONS, ...extra]) {
    if (m.has(a.verb)) throw new Error(`duplicate verb ${a.verb}`);
    m.set(a.verb, a);
  }
  return m;
}

/** Scenes by `world.base.campus`; every run gets fresh Spatial state for the world's own base. */
export function servicesFor(scenes: Record<string, SpatialScene>) {
  return (world: WorldState) => {
    const scene = scenes[world.base.campus];
    if (!scene) throw new Error(`no spatial scene registered for campus "${world.base.campus}"`);
    return { spatial: new Spatial(scene, { contributors: [progressiveContributor] }) };
  };
}

export function engineConfig(scenes: Record<string, SpatialScene>, opts: { registry?: Map<string, ActionDef>; invariants?: Invariant[]; maxTicks?: number } = {}): EngineConfig {
  return {
    registry: opts.registry ?? createRegistry(),
    invariants: opts.invariants ?? ENGINE_INVARIANTS,
    services: servicesFor(scenes),
    maxTicks: opts.maxTicks,
  };
}

export type VerbInfo = { verb: string; description: string; inputSchema: Record<string, unknown> };

/** JSON Schema (draft 2020-12) of a zod schema, as MCP clients see it. */
export function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { unrepresentable: 'any', io: 'input' }) as Record<string, unknown>;
}

export function describeVerbs(registry: Map<string, ActionDef>): VerbInfo[] {
  return [...registry.values()].map((d) => ({ verb: d.verb, description: d.description, inputSchema: jsonSchemaOf(d.schema) }));
}
