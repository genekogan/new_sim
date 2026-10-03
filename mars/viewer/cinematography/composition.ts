// Camera-owned visual metrics. No authoritative state or renderer dependency.
import { CameraWorld, raycast } from '../engine/camera/geom.ts';
import type { CameraPose, SubjectPose } from '../engine/camera/shots.ts';
import type { Vec3 } from '../engine/core/math.ts';
const sub = (a: Vec3, b: Vec3) => a.map((v, i) => v - b[i]) as Vec3;
const norm = (v: Vec3) => {
  const n = Math.hypot(...v);
  return v.map((x) => x / Math.max(n, 0.00001)) as Vec3;
};
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export function frontality(pose: CameraPose, subject?: SubjectPose): number {
  if (!subject || subject.kind !== 'human') return 0.5;
  const dx = pose.position[0] - subject.p[0],
    dz = pose.position[2] - subject.p[2],
    n = Math.hypot(dx, dz);
  return (
    (1 +
      (dx * Math.cos(subject.yaw) + dz * Math.sin(subject.yaw)) /
        Math.max(n, 0.0001)) /
    2
  );
}
/** Fraction of a 4x4 image grid intercepted materially in front of the target plane.
 * Intended subjects/objects are excluded; architecture is always present.
 */
export function foreground(
  world: CameraWorld,
  pose: CameraPose,
  aspect: number,
  ids: string[],
): number {
  const f = norm(sub(pose.target, pose.position)),
    r = norm(cross(f, [0, 1, 0])),
    u = cross(r, f),
    depth = Math.hypot(...sub(pose.target, pose.position));
  const tv = Math.tan((pose.fov * Math.PI) / 360),
    th = tv * aspect,
    skip = new Set(ids);
  let hits = 0;
  for (const y of [-0.8, -0.27, 0.27, 0.8])
    for (const x of [-0.8, -0.27, 0.27, 0.8]) {
      const end = pose.position.map(
        (v, i) => v + depth * (f[i] + r[i] * x * th + u[i] * y * tv),
      ) as Vec3;
      const hit = raycast(world, pose.position, end, 'occlude', skip);
      if (hit && hit.t < 0.85) hits++;
    }
  return hits / 16;
}
