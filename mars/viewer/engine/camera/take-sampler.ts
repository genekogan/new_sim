// Take adapter for the camera (CAMERA.md "take adapter"): a `Sampler` over a
// recorded Take. Same poses as `sampleTake` (same bracketing + `interpSample`),
// but indexed per entity so a planner can call it tens of thousands of times.
// Humans are standing subjects (default readability points, `kind: 'human'`, so
// they occlude other subjects); components get their catalog box corners +
// centre as points, so a carried beam or a seated sheet is a subject the camera
// can frame and score. `crew` = humans gripping the part / sharing its action.
// Components also carry their sight-blocking boxes (`occluders`, kind-aware:
// upright posts, stair stringers, slabs/beams) and a gripping human its grip
// point (`contacts`), so readability treats parts as occluders per tick.
import { POS_Q, ANG_Q, type PoseSample, type Take } from '../take/types.ts';
import { interpSample } from '../take/replay.ts';
import { entityCorners } from '../spatial/service.ts';
import type { Entity } from '../world/types.ts';
import type { Vec3 } from '../core/math.ts';
import type { Sampler, SubjectPose } from './shots.ts';
import { gripPoint, partOccluders, type PartPose } from './occluders.ts';

type Info = { kind: string; def?: string; present: [number, boolean][]; track: PoseSample[]; grip: [number, unknown][]; task: [number, unknown][]; reservedBy: [number, unknown][] };

function bracket(s: PoseSample[], tick: number): [PoseSample, PoseSample] | null {
  if (!s.length || tick < s[0][0]) return null;
  if (tick >= s[s.length - 1][0]) return [s[s.length - 1], s[s.length - 1]];
  let lo = 0, hi = s.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (s[mid][0] <= tick) lo = mid;
    else hi = mid;
  }
  return [s[lo], s[hi]];
}

function valueAt<T>(p: [number, T][], tick: number, v: T): T {
  for (const [t, x] of p) {
    if (t > tick) break;
    v = x;
  }
  return v;
}
const presentAt = (p: [number, boolean][], tick: number) => valueAt(p, tick, false);
const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

/** Subject poses for every entity present at time t (seconds from take start). Pure; memoised per tick. */
export function takeSampler(take: Take, opts: { cache?: number } = {}): Sampler {
  const info = new Map<string, Info>();
  for (const id of Object.keys(take.tracks)) {
    const e = take.finalState.entities[id];
    info.set(id, { kind: e?.kind ?? 'human', def: e?.def, present: [], track: take.tracks[id], grip: [], task: [], reservedBy: [] });
  }
  for (const [t, id, field, value] of take.changes) {
    const e = info.get(id);
    if (!e) continue;
    if (field === 'present') e.present.push([t, value === true]);
    else if (field === 'grip' || field === 'task' || field === 'reservedBy') e[field].push([t, value]);
  }
  const cache = new Map<number, Record<string, SubjectPose>>();
  const limit = opts.cache ?? 4096;
  return (t) => {
    const tick = Math.min(Math.max(0, Math.round((t / take.dt) * 1e6) / 1e6), take.ticks);
    const hit = cache.get(tick);
    if (hit) return hit;
    const out: Record<string, SubjectPose> = {};
    // crews: humans gripping a part or sharing an action (task) belong to that subject for occlusion
    const byTask = new Map<string, string[]>(), byGrip = new Map<string, string[]>();
    const push = (m: Map<string, string[]>, k: string, id: string) => { const l = m.get(k); if (l) l.push(id); else m.set(k, [id]); };
    for (const [id, e] of info) {
      if (e.kind === 'component' || !presentAt(e.present, tick)) continue;
      const task = str(valueAt(e.task, tick, null as unknown));
      const grip = valueAt(e.grip, tick, null as unknown) as { entity?: string } | null;
      if (task) push(byTask, task, id);
      if (grip && typeof grip.entity === 'string') push(byGrip, grip.entity, id);
    }
    const crewOf = (id: string, e: Info): string[] | undefined => {
      const c = new Set<string>();
      if (e.kind === 'component') {
        for (const h of byGrip.get(id) ?? []) c.add(h);
        const r = str(valueAt(e.reservedBy, tick, null as unknown));
        if (r) for (const h of byTask.get(r) ?? []) c.add(h);
      } else {
        const task = str(valueAt(e.task, tick, null as unknown));
        const grip = valueAt(e.grip, tick, null as unknown) as { entity?: string } | null;
        if (task) for (const h of byTask.get(task) ?? []) c.add(h);
        if (grip && typeof grip.entity === 'string') for (const h of byGrip.get(grip.entity) ?? []) c.add(h);
        c.delete(id);
      }
      return c.size ? [...c].sort() : undefined;
    };
    // poses first (a carrier's contact point lies on the part it grips)
    const poses = new Map<string, { e: Info; pose: PartPose }>();
    for (const [id, e] of info) {
      if (!presentAt(e.present, tick)) continue;
      const br = bracket(e.track, tick);
      if (!br) continue;
      const s = interpSample(br[0], br[1], tick);
      poses.set(id, { e, pose: { p: [s[1] / POS_Q, s[2] / POS_Q, s[3] / POS_Q], yaw: s[4] / ANG_Q, pitch: (s[5] ?? 0) / ANG_Q, roll: (s[6] ?? 0) / ANG_Q } });
    }
    for (const [id, { e, pose }] of poses) {
      const { p, yaw } = pose;
      const crew = crewOf(id, e);
      if (e.kind !== 'component' || !e.def) {
        const grip = valueAt(e.grip, tick, null as unknown) as { entity?: string; slot?: string } | null;
        const part = grip && typeof grip.entity === 'string' ? poses.get(grip.entity) : undefined;
        const contact = part?.e.def && typeof grip!.slot === 'string' ? gripPoint(part.e.def, part.pose, grip!.slot, byGrip.get(grip!.entity!)?.length) : null;
        out[id] = { p, yaw, kind: 'human', ...(crew ? { crew } : {}), ...(contact ? { contacts: [contact] } : {}) };
        continue;
      }
      const cs = entityCorners({ def: e.def, pose } as Entity);
      const c: Vec3 = [0, 0, 0];
      let top = -Infinity;
      for (const q of cs) { c[0] += q[0] / 8; c[1] += q[1] / 8; c[2] += q[2] / 8; top = Math.max(top, q[1]); }
      const occluders = partOccluders(e.def, pose);
      out[id] = { p, yaw, height: Math.max(0.5, top - p[1]), points: [c, ...cs], kind: 'component', ...(crew ? { crew } : {}), ...(occluders.length ? { occluders } : {}) };
    }
    if (cache.size >= limit) cache.delete(cache.keys().next().value!);
    cache.set(tick, out);
    return out;
  };
}
