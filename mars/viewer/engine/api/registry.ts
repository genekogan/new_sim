// The ONE action registry + engine configuration used by every host: Node
// tests, the browser, and the Durable Object control plane (spec §13, §15).
// MCP tools, JSON Schemas and in-process calls are all generated from here;
// there is no parallel control system.
import { z } from 'zod';
import { hashOf } from '../core/hash.ts';
import { sceneForWorld } from '../spatial/edits.ts';
import type { ActionDef } from '../actions/types.ts';
import { walkTo } from '../locomotion/walk.ts';
import { carry } from '../carry/actions.ts';
import { FIXTURE_ACTIONS } from '../carry/fixture.ts';
import { CARRY_INVARIANTS } from '../carry/invariants.ts';
import { SOCIAL_ACTIONS } from '../social/actions.ts';
import { CLASSROOM_ACTIONS, STOW_ACTIONS, ROOM_SETUP_ACTIONS, SHARED_FOOD_ACTIONS, PURPOSEFUL_ROUTINE_ACTIONS } from '../activities/index.ts';
import { OBJECT_ACTIONS, ClassroomDisplayService } from '../objects/classroom.ts';
import { WORKSTATION_ACTIONS } from '../objects/workstation.ts';
import { ITEM_ACTIONS } from '../items/actions.ts';
import { VEHICLE_ACTIONS, VEHICLE_INVARIANTS } from '../vehicles/index.ts';
import { FORKLIFT_ACTIONS, FORKLIFT_INVARIANTS } from '../vehicles/forklift.ts';
import { CONSTRUCTION_ACTIONS, FRAMING_ACTIONS, FRAMING_INVARIANTS, frameAccessContributor, frameAccessOk, liftHandsInReach, RULES_VERSION as ASSEMBLY_RULES, progressiveContributor, progressiveSupported, uprightsSupported } from '../construction/index.ts';
import { SOLAR_ACTIONS } from '../construction/solar.ts';
import { PAINT_ACTIONS } from '../work/paint.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import type { Invariant } from '../runtime/runtime.ts';
import type { EngineConfig } from '../rehearsal/rehearse.ts';
import { Spatial } from '../spatial/service.ts';
import { SEQUENCE_VERBS } from '../sequence/runner.ts';
import type { SpatialScene } from '../spatial/types.ts';
import type { WorldState } from '../world/types.ts';

/** Changing any verb's semantics, DT or an invariant is a rules-version change (plans bound under another version go stale). */
export const ENGINE_RULES_VERSION = `mars-engine/1+${ASSEMBLY_RULES}+activities/9`;

export const ENGINE_ACTIONS: ActionDef[] = [walkTo, carry, ...FIXTURE_ACTIONS, ...CONSTRUCTION_ACTIONS, ...SOCIAL_ACTIONS, ...ITEM_ACTIONS, ...VEHICLE_ACTIONS, ...FORKLIFT_ACTIONS, ...SOLAR_ACTIONS, ...PAINT_ACTIONS, ...FRAMING_ACTIONS, ...OBJECT_ACTIONS, ...CLASSROOM_ACTIONS, ...WORKSTATION_ACTIONS, ...STOW_ACTIONS, ...ROOM_SETUP_ACTIONS, ...SHARED_FOOD_ACTIONS, ...PURPOSEFUL_ROUTINE_ACTIONS];
export const ENGINE_INVARIANTS: Invariant[] = [...DEFAULT_INVARIANTS, ...CARRY_INVARIANTS, uprightsSupported, progressiveSupported, liftHandsInReach, frameAccessOk, ...VEHICLE_INVARIANTS, ...FORKLIFT_INVARIANTS, ...FRAMING_INVARIANTS];

export function createRegistry(extra: ActionDef[] = []): Map<string, ActionDef> {
  const m = new Map<string, ActionDef>();
  for (const a of [...ENGINE_ACTIONS, ...extra]) {
    if (m.has(a.verb)) throw new Error(`duplicate verb ${a.verb}`);
    if (Object.hasOwn(SEQUENCE_VERBS, a.verb)) throw new Error(`verb ${a.verb} is a sequence built-in (sequence/runner.ts SEQUENCE_VERBS)`);
    m.set(a.verb, a);
  }
  return m;
}

/**
 * Scenes by `world.base.campus`; every run gets fresh Spatial state for the world's own base. The rack
 * structure's climb links and beam walkways (construction/frame.ts) are part of the scene by default
 * (`frameAccess: false` opts out); they are narrower than a routing disc, so walk_to never uses them.
 */
export function servicesFor(scenes: Record<string, SpatialScene>, opts: { frameAccess?: boolean } = {}) {
  const contributors = opts.frameAccess === false ? [progressiveContributor] : [progressiveContributor, frameAccessContributor];
  return (world: WorldState) => {
    const scene = scenes[world.base.campus];
    if (!scene) throw new Error(`no spatial scene registered for campus "${world.base.campus}"`);
    // campus scenes (mars-<year>) are identified by their file's content hash (world.base.staticHash)
    const baseId = (scene as SpatialScene & { meta?: { contentHash?: string } }).meta?.contentHash;
    const sourceId = baseId ?? hashOf(scene);
    const effectiveId = world.obstacleEdits ? hashOf({ source: sourceId, obstacleEdits: world.obstacleEdits }) : sourceId;
    return { spatial: new Spatial(sceneForWorld(scene, world), { contributors, baseId: effectiveId }), classroomDisplay: new ClassroomDisplayService() };
  };
}

export function engineConfig(scenes: Record<string, SpatialScene>, opts: { registry?: Map<string, ActionDef>; invariants?: Invariant[]; maxTicks?: number; frameAccess?: boolean } = {}): EngineConfig {
  return {
    registry: opts.registry ?? createRegistry(),
    invariants: opts.invariants ?? ENGINE_INVARIANTS,
    services: servicesFor(scenes, { frameAccess: opts.frameAccess }),
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

/** The runner's own step verbs (`mark`, `cancel`; LM-016), described like registry verbs. */
export function describeSequenceVerbs(): VerbInfo[] {
  return Object.entries(SEQUENCE_VERBS).map(([verb, d]) => ({ verb, description: `[sequence built-in] ${d.description}`, inputSchema: jsonSchemaOf(d.schema) }));
}
