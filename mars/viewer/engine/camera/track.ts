// CameraTrack payload: a planned camera is self-contained plain JSON stored
// as `CameraTrack.data` next to a take. It references the take only by id, so
// attaching, editing or replacing it can never change the take or its hash.
import type { CameraTrack } from '../take/types.ts';
import type { Vec3 } from '../core/math.ts';
import type { CameraPose } from './shots.ts';
import type { CameraPlan } from './plan.ts';

export const CAMERA_TRACK_SCHEMA = 'mars-camera-track/1';
export type CameraTrackData = CameraPlan & { schema: typeof CAMERA_TRACK_SCHEMA };

export function toCameraTrack(id: string, takeId: string, plan: CameraPlan, kind = 'planned'): CameraTrack {
  const data: CameraTrackData = { schema: CAMERA_TRACK_SCHEMA, ...plan };
  return { id, takeId, kind, data };
}

export function trackData(track: CameraTrack): CameraTrackData {
  const d = track.data as CameraTrackData;
  if (!d || d.schema !== CAMERA_TRACK_SCHEMA) throw new Error(`camera track ${track.id}: data is not ${CAMERA_TRACK_SCHEMA}`);
  return d;
}

/** Pose at time t: linear between samples, held (no interpolation) across a cut. */
export function sampleTrack(data: CameraTrackData, t: number): CameraPose {
  const s = data.samples;
  const x = Math.max(0, Math.min(s.length - 1, t * data.hz));
  const i = Math.min(s.length - 1, Math.floor(x));
  const a = s[i], b = s[Math.min(s.length - 1, i + 1)];
  if (b === a || b.cut) return { position: a.position, target: a.target, fov: a.fov };
  const u = x - i;
  const l = (p: number[], q: number[]) => [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u, p[2] + (q[2] - p[2]) * u] as [number, number, number];
  return { position: l(a.position, b.position), target: l(a.target, b.target), fov: a.fov + (b.fov - a.fov) * u };
}

/**
 * Subjects the planner scored at each sample, stored compactly next to the poses so a
 * verifier never has to rebuild them from the take:
 *   sets[set[i]] = the subject ids of sample i;
 *   points = [sample, id, xyz…] entries, quantised to `q` metres (integers), written only
 *            when that subject's points change. The first entry of a subject (or the first
 *            after an empty one) is absolute; later ones are deltas from the previous entry.
 *            An empty entry marks the subject absent from then on.
 */
export type SubjectTrack = { q: number; sets: string[][]; set: number[]; points: [number, string, number[]][] };

export class SubjectTrackBuilder {
  readonly track: SubjectTrack;
  private setIndex = new Map<string, number>();
  private last = new Map<string, number[]>();
  constructor(q = 0.01) {
    this.track = { q, sets: [], set: [], points: [] };
  }
  /** Append the next sample: its subject ids and their points (ids missing from `points` were absent). */
  push(ids: string[], points: Record<string, Vec3[] | undefined>) {
    const t = this.track, i = t.set.length, key = JSON.stringify(ids);
    let k = this.setIndex.get(key);
    if (k === undefined) { k = t.sets.push([...ids]) - 1; this.setIndex.set(key, k); }
    t.set.push(k);
    for (const id of ids) {
      const pts = points[id];
      const prev = this.last.get(id);
      if (!pts) { // absent: an empty entry, so the reader does not carry stale points forward
        if (prev && prev.length) { this.last.set(id, []); t.points.push([i, id, []]); }
        continue;
      }
      const flat = pts.flatMap((p) => [Math.round(p[0] / t.q), Math.round(p[1] / t.q), Math.round(p[2] / t.q)]);
      if (prev && prev.length === flat.length && prev.every((v, j) => v === flat[j])) continue;
      this.last.set(id, flat);
      t.points.push([i, id, prev && prev.length ? flat.map((v, j) => v - prev[j]) : flat]);
    }
  }
}

/** Random-access reader over a SubjectTrack: `(i) → {ids, points}` for sample i. */
export function subjectReader(st: SubjectTrack): (i: number) => { ids: string[]; points: Record<string, Vec3[]> } {
  const byId = new Map<string, { at: number[]; flat: number[][] }>();
  for (const [i, id, entry] of st.points) {
    let e = byId.get(id);
    if (!e) byId.set(id, (e = { at: [], flat: [] }));
    const prev = e.flat.at(-1);
    e.at.push(i); e.flat.push(prev && prev.length && entry.length ? entry.map((v, j) => v + prev[j]) : entry);
  }
  return (i) => {
    const ids = st.sets[st.set[i]] ?? [];
    const points: Record<string, Vec3[]> = {};
    for (const id of ids) {
      const e = byId.get(id);
      if (!e || e.at[0] > i) continue;
      let lo = 0, hi = e.at.length - 1;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (e.at[m] <= i) lo = m; else hi = m - 1; }
      const f = e.flat[lo], out: Vec3[] = [];
      if (!f.length) continue; // absent at this sample
      for (let j = 0; j + 2 < f.length; j += 3) out.push([f[j] * st.q, f[j + 1] * st.q, f[j + 2] * st.q]);
      points[id] = out;
    }
    return { ids, points };
  };
}
