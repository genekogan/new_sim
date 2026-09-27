// raise_upright: a crew raises a lying upright about its base line, then keeps
// holding it (support = held) until release_support succeeds (spec §7, §12).
import { z } from 'zod';
import { obbOverlap } from '../core/math.ts';
import type { ActionDef, Diagnostic } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Entity } from '../world/types.ts';
import { def } from '../world/catalog.ts';
import { entityFootprint, type Spatial } from '../spatial/service.ts';
import { holdingDiagnostic, holdStations, isUpright } from './rules.ts';
import { childrenState, walkCrew, type Children } from './children.ts';

const RAISE_RATE = Math.PI / 2 / 5; // rad/s: ~5 s for a full raise

type P = { crew: string[]; item: string };
type Exec = { p: P; id: string; phase: 'approach' | 'grip' | 'raise'; children?: Children; t: number };

/** Sample the raising arc and report the first static obstacle it would hit. */
export function raiseSweep(rt: Runtime, u: Entity, from: number, to: number): Diagnostic | null {
  const sp = rt.services.spatial as Spatial;
  sp.sync(rt.world);
  const steps = 24;
  for (let k = 0; k <= steps; k++) {
    const pitch = from + ((to - from) * k) / steps;
    const f = entityFootprint({ ...u, pose: { ...u.pose, pitch } });
    for (const o of sp.scene.obstacles) {
      if (o.id === u.id || o.y1 <= f.y0 + 0.02 || o.y0 >= f.y1) continue;
      if (obbOverlap(f.obb, o.obb, -0.01))
        return {
          code: 'raise.arc-blocked',
          message: `${def(u.def).label} ${u.id} cannot rotate through its raising arc: at ${Math.round((1 - pitch / (Math.PI / 2)) * 90)}° it intersects ${o.label ?? o.id}`,
          subjects: [u.id, o.id],
          at: [o.obb.c[0], (f.y0 + f.y1) / 2, o.obb.c[1]],
        };
    }
  }
  return null;
}

export const raiseUpright: ActionDef<P, null, Exec> = {
  verb: 'raise_upright',
  description:
    'A crew walks to stations at the base of a lying upright, raises it about its base to standing, and keeps holding it. The crew stays committed until release_support succeeds.',
  schema: z.strictObject({ crew: z.array(z.string().max(80)).min(1).max(4), item: z.string().max(80) }),
  reservations: (_w, p) => [...p.crew.map((c) => ({ resource: `actor:${c}`, mode: 'exclusive' as const })), { resource: `entity:${p.item}`, mode: 'exclusive' }],
  plan(rt, p) {
    const u = rt.world.entities[p.item];
    if (!isUpright(u)) return { ok: false, diagnostic: { code: 'raise.not-upright', message: `${p.item} is not a pallet-rack upright`, subjects: [p.item] } };
    const need = def(u.def).handling?.raiseCrew ?? 2;
    if (p.crew.length < need)
      return { ok: false, diagnostic: { code: 'raise.crew-too-small', message: `raising the ${def(u.def).label} ${u.id} needs at least ${need} people; ${p.crew.length} assigned`, subjects: [u.id, ...p.crew] } };
    if (Math.abs((u.pose.pitch ?? 0) - Math.PI / 2) > 0.02 || u.support?.kind !== 'ground')
      return { ok: false, diagnostic: { code: 'raise.not-lying', message: `${u.id} must be lying flat on the ground (base at its pivot) before it can be raised`, subjects: [u.id] } };
    for (const c of p.crew) {
      const d = holdingDiagnostic(rt.world, c);
      if (d) return { ok: false, diagnostic: d };
      if (rt.world.entities[c]?.kind !== 'human') return { ok: false, diagnostic: { code: 'entity.unknown', message: `no person "${c}"`, subjects: [c] } };
    }
    const sweep = raiseSweep(rt, u, Math.PI / 2, 0);
    if (sweep) return { ok: false, diagnostic: sweep };
    return { ok: true, program: null };
  },
  start(rt, p, _prog, id) {
    const u = rt.world.entities[p.item];
    u.phase = 'reserved';
    u.reservedBy = id;
    return { p, id, phase: 'approach', t: 0 };
  },
  step(rt, ex, dt) {
    const w = rt.world;
    const u = w.entities[ex.p.item];
    if (ex.phase === 'approach') {
      if (!ex.children) {
        const st = holdStations(u, ex.p.crew.length);
        const r = walkCrew(rt, ex.id, ex.p.crew.map((c, i) => ({ actor: c, p: st[i].p, yaw: st[i].yaw })));
        if ('code' in r) return { status: 'failed', diagnostic: { ...r, code: 'raise.station-unreachable' } };
        ex.children = r;
      }
      const s = childrenState(ex.children);
      if (s === 'running') return { status: 'running', phase: 'approach' };
      if (s !== 'done') return { status: 'failed', diagnostic: s };
      ex.phase = 'grip';
      ex.t = 0;
    }
    if (ex.phase === 'grip') {
      ex.t += dt;
      for (const [i, c] of ex.p.crew.entries()) {
        const h = w.entities[c].human!;
        h.activity = 'support';
        h.grip = { entity: u.id, slot: `hold-${i}` };
        h.task = ex.id;
      }
      if (ex.t < 1.0) return { status: 'running', phase: 'grip' };
      u.support = { kind: 'held', by: [...ex.p.crew] };
      u.phase = 'raising';
      ex.phase = 'raise';
    }
    // raise: rotate pitch toward 0 about the base line (origin at base centre)
    const next = Math.max(0, (u.pose.pitch ?? 0) - RAISE_RATE * dt);
    u.pose.pitch = next;
    if (next > 0) return { status: 'running', phase: 'raise' };
    u.phase = 'placed';
    u.reservedBy = undefined;
    return { status: 'completed', outputs: { holding: ex.p.crew } };
  },
  cancel(rt, ex) {
    const u = rt.world.entities[ex.p.item];
    if (ex.phase === 'raise' && (u.pose.pitch ?? 0) < Math.PI / 2 - 1e-6)
      return { ok: false, diagnostic: { code: 'raise.cancel-unsafe', message: `${u.id} is partly raised; cancelling now would leave it unsupported (lowering is not yet modelled)`, subjects: [u.id] } };
    for (const c of ex.p.crew) {
      const h = rt.world.entities[c].human!;
      h.grip = undefined;
      h.activity = 'idle';
      h.task = undefined;
    }
    for (const r of ex.children?.recs ?? []) if (rt.isActive(r.id)) rt.cancel(r.id);
    u.phase = 'staged';
    u.reservedBy = undefined;
    u.support = { kind: 'ground' };
    return { ok: true };
  },
};
