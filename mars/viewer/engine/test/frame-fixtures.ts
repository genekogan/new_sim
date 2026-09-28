// Test fixtures for rack-structure access and hand-up (frame.test.ts, handup.test.ts): a bay of two
// standing 12 ft uprights built *by state* (beam seats above standing reach cannot be placed by a
// ground crew, so the tests set the assembly directly, as progressive.test does for its second bay).
// A at z 0 (yaw π), B at z L (yaw 0); columns at x ±D/2; beams along z; joists across x.
import { Runtime, type Invariant } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { Spatial } from '../spatial/service.ts';
import { emptyWorld, human, addAll, component } from '../world/factory.ts';
import { walkTo } from '../locomotion/walk.ts';
import { CONSTRUCTION_ACTIONS, frameAccessContributor, frameAccessOk, liftHandsInReach, progressiveContributor, progressiveSupported, uprightsSupported } from '../construction/index.ts';
import { snapSeat } from '../construction/rules.ts';
import { def } from '../world/catalog.ts';
import type { ActionDef } from '../actions/types.ts';
import type { Entity, WorldState } from '../world/types.ts';
import type { SpatialScene } from '../spatial/types.ts';

export const D12 = def('upright-12ft').size[0];
export const BEAM_H = def('beam-9ft').size[1];
export const JOIST_H = def('2x4-6ft').size[1];

export function openGround(): SpatialScene {
  return { bounds: [-15, -15, 15, 15], levels: [{ id: 0, y: 0, label: 'ground' }], surfaces: [{ id: 'ground', level: 0, y: 0, obb: { c: [0, 0], half: [15, 15], yaw: 0 } }], obstacles: [], links: [] };
}

export type BayOpts = {
  /** Upper beam seat (snapped to the frame's holes). */
  seat: number;
  beam?: 'beam-9ft' | 'beam-12ft';
  /** Which upper beams exist ('r' = x +D/2, 'l' = x −D/2). Lower beams at 0.5 m on both columns always. */
  upper?: ('l' | 'r')[];
  /** Uprights released (installed, connected) — else held by people u1/u2 (phase placed). */
  installed?: boolean;
  /** Joists installed across the upper beams at these z (metres from A). */
  joists?: number[];
  /** Extra beams: [id, side (+1 = x +D/2), seat]. */
  extra?: [string, 1 | -1, number][];
  /** Extra verbs / invariants (vehicles, forklift). */
  actions?: ActionDef[];
  invariants?: Invariant[];
};

/** Beam spec: [id, x side (+1 = x +D/2), seat]. A's column 'l' is at x +D/2 (A faces −z). */
function beamState(w: WorldState, id: string, defId: string, side: 1 | -1, h: number, L: number) {
  const A = w.entities.A, B = w.entities.B;
  const colA = side > 0 ? 'l' : 'r', colB = side > 0 ? 'r' : 'l';
  const kA = `col${colA}@${h.toFixed(3)}`, kB = `col${colB}@${h.toFixed(3)}`;
  const b = component(id, defId, [(side * D12) / 2, h, L / 2], Math.PI / 2, { phase: 'installed' });
  b.support = { kind: 'connected', to: ['A', 'B'] };
  b.connections = [{ socket: 'end-l', to: 'A', toSocket: kA }, { socket: 'end-r', to: 'B', toSocket: kB }];
  (A.connections ??= []).push({ socket: kA, to: id, toSocket: 'end-l' });
  (B.connections ??= []).push({ socket: kB, to: id, toSocket: 'end-r' });
  w.entities[id] = b;
}

export type Bay = { rt: Runtime; L: number; seat: number; top: number; E: Record<string, Entity> };

/** The bay + people p1..p6 on a muster line south of it (z −4) and extras (id → [x, z]). */
export function bay(o: BayOpts, extras: Entity[] = []): Bay {
  const beamDef = o.beam ?? 'beam-9ft';
  const L = def(beamDef).size[0];
  const base = openGround();
  const A = component('A', 'upright-12ft', [0, 0, 0], Math.PI, { phase: o.installed === false ? 'placed' : 'installed' });
  const B = component('B', 'upright-12ft', [0, 0, L], 0, { phase: o.installed === false ? 'placed' : 'installed' });
  const w = addAll(emptyWorld('open-ground', base), A, B, ...['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'u1', 'u2'].map((id, i) => human(id, -6 + i * 1.2, -4)), ...extras);
  const seat = snapSeat(A, o.seat)!;
  const low = snapSeat(A, 0.5)!;
  beamState(w, 'b1', beamDef, 1, low, L);
  beamState(w, 'b2', beamDef, -1, low, L);
  const upper = o.upper ?? ['l', 'r'];
  if (upper.includes('r')) beamState(w, 'b3', beamDef, 1, seat, L);
  if (upper.includes('l')) beamState(w, 'b4', beamDef, -1, seat, L);
  for (const [id, side, h] of o.extra ?? []) beamState(w, id, beamDef, side, snapSeat(A, h)!, L);
  for (const [id, side, h] of o.extra ?? []) beamState(w, id, beamDef, side, snapSeat(A, h)!, L);
  const beams = Object.keys(w.entities).filter((k) => /^b\d$/.test(k));
  for (const [u, holder] of [['A', 'u1'], ['B', 'u2']] as const) {
    const e = w.entities[u];
    if (o.installed === false) {
      e.support = { kind: 'held', by: [holder] };
      Object.assign(w.entities[holder].human!, { activity: 'support', grip: { entity: u, slot: 'hold-0' } });
    } else e.support = { kind: 'connected', to: beams };
  }
  const top = seat + BEAM_H;
  for (const [k, z] of (o.joists ?? []).entries()) {
    const id = `j${k + 1}`;
    const j = component(id, '2x4-6ft', [0, top, z], Math.PI, { phase: 'installed' });
    j.support = { kind: 'resting-on', on: 'b4' };
    j.connections = ['b4', 'b3'].map((b) => ({ socket: 'bears-on', to: b, toSocket: `joist@${z.toFixed(2)}` }));
    w.entities[id] = j;
  }
  const reg = new Map<string, ActionDef>([['walk_to', walkTo], ...[...CONSTRUCTION_ACTIONS, ...(o.actions ?? [])].map((a) => [a.verb, a] as [string, ActionDef])]);
  const rt = new Runtime(w, reg, { spatial: new Spatial(base, { contributors: [progressiveContributor, frameAccessContributor] }) }, [
    ...DEFAULT_INVARIANTS, uprightsSupported, progressiveSupported, liftHandsInReach, frameAccessOk, ...(o.invariants ?? []),
  ]);
  return { rt, L, seat, top, E: rt.world.entities };
}

/** Submit and run to completion; throws with the diagnostic otherwise. */
export function run(rt: Runtime, verb: string, params: unknown, maxTicks = 20 * 240) {
  const r = rt.submit(verb, params);
  if (r.status !== 'failed') rt.runUntilIdle(maxTicks, [r.id]);
  if (r.status !== 'completed') {
    const kids = [...rt.records.values()].filter((x) => x.parent === r.id).map((x) => `${x.verb}:${x.status}:${x.diagnostic?.message ?? ''}`);
    throw new Error(`${verb} ${JSON.stringify(params)} → ${r.status} ${r.phase ?? ''} ${r.diagnostic?.code} ${r.diagnostic?.message} ${kids.join(' | ')}`);
  }
  return r;
}
