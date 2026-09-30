import { CameraWorld } from '../engine/camera/geom.ts';
import {
  placement,
  sweepCrossing,
  readability,
} from '../engine/camera/quality.ts';
import type { CameraPose } from '../engine/camera/shots.ts';
import type { Observation } from './types.ts';
import { distance } from './types.ts';
// Camera point + .3m envelope: inflate prisms for entire continuous sweep.
// Actors conservatively boxed at their current causal poses, never modified.
export function safetyWorld(o: Observation): CameraWorld {
  const obstacles = [
    ...o.scene.obstacles,
    ...Object.entries(o.subjects)
      .filter(([, s]) => s.kind === 'human')
      .map(([id, s]) => ({
        id: `body:${id}`,
        kind: 'solid' as const,
        obb: {
          c: [s.p[0], s.p[2]] as [number, number],
          half: [0.32, 0.32] as [number, number],
          yaw: 0,
        },
        y0: s.p[1],
        y1: s.p[1] + Math.max(1.75, s.height ?? 1.75),
      })),
  ];
  return new CameraWorld({
    ...o.scene,
    obstacles: obstacles.map((q) => ({
      ...q,
      obb: { ...q.obb, half: [q.obb.half[0] + 0.3, q.obb.half[1] + 0.3] },
      y0: q.y0 - 0.3,
      y1: q.y1 + 0.3,
    })),
  });
}
export function poseValid(p: CameraPose): boolean {
  return (
    [...p.position, ...p.target, p.fov].every(Number.isFinite) &&
    p.fov >= 20 &&
    p.fov <= 80 &&
    distance(p.position, p.target) > 0.1
  );
}
export function safePose(o: Observation, p: CameraPose): boolean {
  return poseValid(p) && placement(safetyWorld(o), p.position, 0).valid;
}
export function execute(
  o: Observation,
  previous: CameraPose | undefined,
  desired: CameraPose,
  editorialCut: boolean,
  dt: number,
  subjects: string[],
): { pose?: CameraPose; cut: boolean; reason: string } {
  const world = safetyWorld(o);
  if (!poseValid(desired) || !placement(world, desired.position, 0).valid)
    return {
      cut: false,
      reason: 'camera.placement-invalid: no safe program pose',
    };
  if (!previous || editorialCut)
    return {
      pose: desired,
      cut: !!previous,
      reason: 'editorial cut between valid viewpoints',
    };
  if (!safePose(o, previous))
    return {
      pose: desired,
      cut: true,
      reason: 'camera.recovery-cut: previous placement became unsafe',
    };
  const length = distance(previous.position, desired.position);
  const u = Math.min(1, (Math.max(0, dt) * 1.5) / Math.max(length, 0.001));
  const blend = (a: number[], b: number[], weight = u) =>
    a.map((v, i) => v + (b[i] - v) * weight) as [number, number, number];
  const oldDirection = previous.target.map((v, i) => v - previous.position[i]),
    newDirection = desired.target.map((v, i) => v - desired.position[i]);
  const dot =
    oldDirection.reduce((n, v, i) => n + v * newDirection[i], 0) /
    (Math.hypot(...oldDirection) * Math.hypot(...newDirection));
  const angle = Math.acos(Math.min(1, Math.max(-1, dot)));
  const pan = Math.min(
    1,
    (Math.max(0, dt) * Math.PI) / 3 / Math.max(angle, 0.001),
    Math.max(0, dt) * 2,
  );
  const fovDelta = Math.max(
    -dt * 5,
    Math.min(dt * 5, desired.fov - previous.fov),
  );
  const pose = {
    position: blend(previous.position, desired.position),
    target: blend(previous.target, desired.target, pan),
    fov: previous.fov + fovDelta,
  };
  if (sweepCrossing(world, previous.position, pose.position))
    return {
      pose: desired,
      cut: true,
      reason:
        'camera.sweep-cut: continuous transition crosses clearance envelope',
    };
  const read = readability(
    new CameraWorld(o.scene),
    pose,
    o.subjects,
    subjects,
    { aspect: 16 / 9, minSize: 0.08 },
  ).score;
  if (!placement(world, pose.position, 0).valid || read < 0.55)
    return {
      pose: desired,
      cut: true,
      reason: 'camera.visibility-recovery-cut: blend is unreadable',
    };
  return { pose, cut: false, reason: 'bounded smooth tracking' };
}
