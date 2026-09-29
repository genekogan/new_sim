// Shared, synchronous compilation kernel for the browser worker and explicit Node callers.
// Scene loading stays with direct-camera.ts; no fetch, renderer, lifecycle options or worker globals here.
import { hashOf } from '../../engine/core/hash.ts';
import { takeFacts } from '../../engine/camera/direct.ts';
import { directCamera, type DirectResult } from '../../engine/camera/synth.ts';
import { DEFAULT_CAMERA_POLICY, type CameraPolicy } from '../../engine/camera/geom.ts';
import { takeSampler } from '../../engine/camera/take-sampler.ts';
import { toCameraTrack, trackData } from '../../engine/camera/track.ts';
import { takeDuration } from '../../engine/take/replay.ts';
import type { SpatialScene } from '../../engine/spatial/types.ts';
import type { Take } from '../../engine/take/types.ts';
import type { WorldState } from '../../engine/world/types.ts';
import type { ActiveTrack } from '../engine-view/take-replay.ts';

export const DIRECT_POLICY: CameraPolicy = { ...DEFAULT_CAMERA_POLICY, component: { collide: true, occlude: false } };
export type CameraCompileOptions = { correct?: boolean; hz?: number; datetime?: string };
export type CameraCompileJob = { take: Take; scene: SpatialScene; directions: unknown[]; opts: CameraCompileOptions };
export type CompiledTakeCamera = { result: DirectResult; track?: ActiveTrack; ms: number };
export type CameraWorkerReply = { type: 'started' } | { type: 'result'; compiled: CompiledTakeCamera };

export const trackOf = (result: DirectResult, takeId: string, key: unknown, hz: number): ActiveTrack | undefined => {
  if (!result.ok) return undefined;
  const id = `dir-${hashOf({ take: takeId, directions: key, hz }).slice(0, 12)}`;
  const t = toCameraTrack(id, takeId, result.plan, 'directed');
  return { id, kind: 'directed', data: trackData(t) };
};

export function compileTakeCamera({ take, scene, directions, opts }: CameraCompileJob): CompiledTakeCamera {
  const hz = opts.hz ?? 10;
  const world: WorldState = opts.datetime ? { ...take.finalState, env: { ...take.finalState.env, datetime: opts.datetime } } : take.finalState;
  const t0 = performance.now();
  const result = directCamera(directions, { scene, world, sampler: takeSampler(take), facts: takeFacts(take), duration: takeDuration(take), hz, policy: DIRECT_POLICY, ...(opts.correct === false ? { correct: false } : {}) });
  return { result, track: trackOf(result, take.id, { directions, correct: opts.correct, datetime: opts.datetime }, hz), ms: Math.round(performance.now() - t0) };
}

export function cameraWorkerFailure(takeId: string, code: string, message: string): CompiledTakeCamera {
  return { result: { ok: false, diagnostics: [{ code, message, subjects: [takeId] }], shots: [] }, ms: 0 };
}
