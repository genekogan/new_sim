// Take adapter for the camera (CAMERA.md "take adapter"): a `Sampler` over a
// recorded Take. Same poses as `sampleTake` (same bracketing + `interpSample`),
// but indexed per entity so a planner can call it tens of thousands of times.
// Humans are standing subjects (default readability points); components get
// their catalog box corners + centre as points, so a carried beam or a seated
// sheet is a subject the camera can frame and score.
import { POS_Q, ANG_Q, type PoseSample, type Take } from '../take/types.ts';
import { interpSample } from '../take/replay.ts';
import { entityCorners } from '../spatial/service.ts';
import type { Entity } from '../world/types.ts';
import type { Vec3 } from '../core/math.ts';
import type { Sampler, SubjectPose } from './shots.ts';

type Info = { kind: string; def?: string; present: [number, boolean][]; track: PoseSample[] };

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

function presentAt(p: [number, boolean][], tick: number): boolean {
  let v = false;
  for (const [t, on] of p) {
    if (t > tick) break;
    v = on;
  }
  return v;
}

/** Subject poses for every entity present at time t (seconds from take start). Pure; memoised per tick. */
export function takeSampler(take: Take, opts: { cache?: number } = {}): Sampler {
  const info = new Map<string, Info>();
  for (const id of Object.keys(take.tracks)) {
    const e = take.finalState.entities[id];
    info.set(id, { kind: e?.kind ?? 'human', def: e?.def, present: [], track: take.tracks[id] });
  }
  for (const [t, id, field, value] of take.changes) if (field === 'present') info.get(id)?.present.push([t, value === true]);
  const cache = new Map<number, Record<string, SubjectPose>>();
  const limit = opts.cache ?? 4096;
  return (t) => {
    const tick = Math.min(Math.max(0, Math.round((t / take.dt) * 1e6) / 1e6), take.ticks);
    const hit = cache.get(tick);
    if (hit) return hit;
    const out: Record<string, SubjectPose> = {};
    for (const [id, e] of info) {
      if (!presentAt(e.present, tick)) continue;
      const br = bracket(e.track, tick);
      if (!br) continue;
      const s = interpSample(br[0], br[1], tick);
      const p: Vec3 = [s[1] / POS_Q, s[2] / POS_Q, s[3] / POS_Q];
      const yaw = s[4] / ANG_Q;
      if (e.kind !== 'component' || !e.def) {
        out[id] = { p, yaw };
        continue;
      }
      const ent = { def: e.def, pose: { p, yaw, pitch: (s[5] ?? 0) / ANG_Q, roll: (s[6] ?? 0) / ANG_Q } } as Entity;
      const cs = entityCorners(ent);
      const c: Vec3 = [0, 0, 0];
      let top = -Infinity;
      for (const q of cs) { c[0] += q[0] / 8; c[1] += q[1] / 8; c[2] += q[2] / 8; top = Math.max(top, q[1]); }
      out[id] = { p, yaw, height: Math.max(0.5, top - p[1]), points: [c, ...cs] };
    }
    if (cache.size >= limit) cache.delete(cache.keys().next().value!);
    cache.set(tick, out);
    return out;
  };
}
