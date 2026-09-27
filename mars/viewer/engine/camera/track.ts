// CameraTrack payload: a planned camera is self-contained plain JSON stored
// as `CameraTrack.data` next to a take. It references the take only by id, so
// attaching, editing or replacing it can never change the take or its hash.
import type { CameraTrack } from '../take/types.ts';
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
