// Hierarchical-task helper: a parent action runs child walk_to actions for
// its crew using its own reservations (Runtime.submit { parent }).
import type { ActionRecord, Diagnostic } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Vec2 } from '../core/math.ts';

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

/** 'done' when all children completed; a diagnostic if any failed. */
export function childrenState(ch: Children): 'running' | 'done' | Diagnostic {
  for (const r of ch.recs) if (r.status === 'failed' || r.status === 'cancelled') return r.diagnostic ?? { code: 'child.cancelled', message: `${r.verb} ${r.id} was cancelled` };
  return ch.recs.every((r) => r.status === 'completed') ? 'done' : 'running';
}
