// Hierarchical-task helper: a parent action runs child walk_to actions for
// its crew using its own reservations (Runtime.submit { parent }).
import type { ActionRecord, Diagnostic } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Vec2 } from '../core/math.ts';
import type { Spatial } from '../spatial/service.ts';
import { HUMAN_PROFILE } from '../spatial/types.ts';

export type Children = { recs: ActionRecord[] };

export function walkCrew(rt: Runtime, parent: string, moves: { actor: string; p: Vec2; yaw: number; level?: number }[]): Children | Diagnostic {
  const recs: ActionRecord[] = [];
  for (const m of moves) {
    const r = rt.submit('walk_to', { actor: m.actor, x: m.p[0], z: m.p[1], face: m.yaw, level: m.level }, { parent });
    if (r.status === 'failed') {
      for (const x of recs) if (rt.isActive(x.id)) rt.cancel(x.id);
      return { ...r.diagnostic!, message: `${m.actor} cannot reach their station: ${r.diagnostic!.message}` };
    }
    recs.push(r);
  }
  return { recs };
}

/**
 * Plan-time check that every crew member has a route to their station (review H1), so an
 * unreachable station is refused before anything is reserved, not discovered mid-action.
 */
export function checkStations(rt: Runtime, moves: { actor: string; p: Vec2; level?: number }[]): Diagnostic | null {
  const sp = rt.services.spatial as Spatial;
  sp.sync(rt.world);
  for (const m of moves) {
    const a = rt.world.entities[m.actor];
    if (!a?.human) continue;
    const r = sp.route(rt.world, HUMAN_PROFILE, { level: a.human.level, p: [a.pose.p[0], a.pose.p[2]] }, { level: m.level ?? a.human.level, p: m.p });
    if (!r.ok)
      return { ...r.diagnostic, subjects: [m.actor, ...(r.diagnostic.subjects ?? [])], message: `${m.actor} cannot reach their station at (${m.p[0].toFixed(2)}, ${m.p[1].toFixed(2)}): ${r.diagnostic.message}` };
  }
  return null;
}

/** 'done' when all children completed; a diagnostic if any failed. */
export function childrenState(ch: Children): 'running' | 'done' | Diagnostic {
  for (const r of ch.recs) if (r.status === 'failed' || r.status === 'cancelled') return r.diagnostic ?? { code: 'child.cancelled', message: `${r.verb} ${r.id} was cancelled` };
  return ch.recs.every((r) => r.status === 'completed') ? 'done' : 'running';
}
