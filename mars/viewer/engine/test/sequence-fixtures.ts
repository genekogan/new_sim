// Shared proving-ground fixtures for sequence / take / rehearsal tests (not a test file itself).
import { z } from 'zod';
import type { ActionDef } from '../actions/types.ts';
import { WorldHistory } from '../history/store.ts';
import { walkTo } from '../locomotion/walk.ts';
import type { EngineConfig } from '../rehearsal/rehearse.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { provingGround } from '../scenes/proving-ground.ts';
import type { SequenceTemplate } from '../sequence/types.ts';
import { Spatial } from '../spatial/service.ts';
import { addAll, component, emptyWorld, human } from '../world/factory.ts';
import type { WorldState } from '../world/types.ts';

export const RULES = 'mars-rules/test-1';

/** Test-only verb: counts ticks, optionally fails at the end. No reservations. */
export const waitTicks: ActionDef<{ n: number; fail?: boolean }, null, { left: number; fail: boolean }> = {
  verb: 'wait_ticks',
  description: 'test: wait n ticks then complete (or fail)',
  schema: z.strictObject({ n: z.number().int().min(0).max(100000), fail: z.boolean().optional() }),
  reservations: () => [],
  plan: () => ({ ok: true, program: null }),
  start: (_rt, p) => ({ left: p.n, fail: p.fail ?? false }),
  step: (_rt, ex) => {
    if (--ex.left > 0) return { status: 'running', phase: 'waiting' };
    return ex.fail ? { status: 'failed', diagnostic: { code: 'test.fail', message: 'wait_ticks was told to fail' } } : { status: 'completed' };
  },
  cancel: () => ({ ok: true }),
};

export const registry = () =>
  new Map<string, ActionDef>([
    ['walk_to', walkTo],
    ['wait_ticks', waitTicks],
  ]);

export function config(): EngineConfig {
  return { registry: registry(), invariants: DEFAULT_INVARIANTS, services: () => ({ spatial: new Spatial(provingGround()) }) };
}

/** Standing plywood sheet as a movable obstacle; parked well away from every test route. */
export const PANEL_PARK = { p: [-25, 0, 25] as [number, number, number], yaw: 0, roll: Math.PI / 2 };
export const PANEL_IN_PASSAGE = { p: [15, 0, -15] as [number, number, number], yaw: 0, roll: Math.PI / 2 };

export function pgWorld(): WorldState {
  const w = emptyWorld('proving-ground', provingGround());
  return addAll(
    w,
    human('n1', 15, -20, { yaw: Math.PI / 2 }),
    human('s1', 15, -10, { yaw: -Math.PI / 2 }),
    human('p1', 3.5, 12.5),
    component('panel', 'plywood-4x8', PANEL_PARK.p, 0, { phase: 'installed', pose: { ...PANEL_PARK } }),
  );
}

/** Canonical (protected) proving ground + one editable fork "ws". */
export function pgHistory() {
  const h = new WorldHistory(RULES);
  h.publishCanonical('pg', 'Proving ground (canonical)', pgWorld(), 'fixture');
  h.fork('pg', 'ws', 'workspace');
  return h;
}

/** Two walkers cross the 1 m passage in opposite directions; a third climbs to the deck after both. */
export const crossTemplate: SequenceTemplate = {
  schema: 'mars-sequence/1',
  id: 'cross-and-climb',
  label: 'cross the passage, then climb',
  params: { crew: { kind: 'actors' }, deck: { kind: 'point' } },
  steps: [
    { id: 'north', verb: 'walk_to', params: { actor: '$crew[0]', x: 15, z: -10.5 } },
    { id: 'south', verb: 'walk_to', params: { actor: '$crew[1]', x: 15, z: -19.5 } },
    { id: 'climb', verb: 'walk_to', params: { actor: '$crew[2]', x: '$deck[0]', z: '$deck[1]', level: 1 }, after: ['north', 'south'] },
  ],
};
export const crossBindings = { crew: ['n1', 's1', 'p1'], deck: [10, 10] };

/** ~60 s of three people walking chained legs (payload measurement scenario). */
export const minuteTemplate: SequenceTemplate = {
  schema: 'mars-sequence/1',
  id: 'minute-walk',
  params: { a: { kind: 'actor' }, b: { kind: 'actor' }, c: { kind: 'actor' } },
  steps: [
    { id: 'a1', verb: 'walk_to', params: { actor: '$a', x: -10, z: -22 } },
    { id: 'a2', verb: 'walk_to', params: { actor: '$a', x: -20, z: -15 }, after: ['a1'] },
    { id: 'a3', verb: 'walk_to', params: { actor: '$a', x: -15, z: 10 }, after: ['a2'] },
    { id: 'b1', verb: 'walk_to', params: { actor: '$b', x: 25, z: 0 } },
    { id: 'b2', verb: 'walk_to', params: { actor: '$b', x: 15, z: -20 }, after: ['b1'] },
    { id: 'b3', verb: 'walk_to', params: { actor: '$b', x: 0, z: -25 }, after: ['b2'] },
    { id: 'b4', verb: 'walk_to', params: { actor: '$b', x: 5, z: -5 }, after: ['b3'] },
    { id: 'c1', verb: 'walk_to', params: { actor: '$c', x: 10, z: 10, level: 1 } },
    { id: 'c2', verb: 'walk_to', params: { actor: '$c', x: 7, z: 12, level: 1 }, after: ['c1'] },
    { id: 'c3', verb: 'walk_to', params: { actor: '$c', x: -5, z: 5, level: 0 }, after: ['c2'] },
    { id: 'c4', verb: 'walk_to', params: { actor: '$c', x: -15, z: 11 }, after: ['c3'] },
  ],
};
export const minuteBindings = { a: 'n1', b: 's1', c: 'p1' };
