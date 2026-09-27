export type Vec3 = [number, number, number];
export type Motion = {
  path: Vec3[];
  started: number;
  speed: number;
  loop: boolean;
  yaw: number;
  activity: 'wander' | 'idle' | 'wave' | 'talk' | 'gather';
};
export type Weather = {
  clouds: number;
  rain: number;
  wind: number;
  dust: number;
  windDirection: number;
};
export const clearWeather: Weather = {
  clouds: 0.35,
  rain: 0,
  wind: 0.15,
  dust: 0,
  windDirection: 45,
};
export type CameraRoute = {
  points: { position: Vec3; target: Vec3 }[];
  started: number;
  duration: number;
  loop: boolean;
};
export type RiderMission = {
  approach?: Motion;
  motion: Motion;
  action: 'circle' | 'return' | 'stop' | 'dismount';
  dismount: boolean;
};
export type ScreenState = {
  enabled: boolean;
  program: 'art' | 'talk' | 'test';
  brightness: number;
  title: string;
};
export const screenIds = [
  'hall-projector',
  'gallery-upper-1',
  'gallery-upper-2',
  'gallery-upper-3',
  'gallery-lower-1',
  'gallery-lower-2',
  'gallery-lower-3',
] as const;
export type SimState = {
  clock?: { real: number; virtual: number; rate: number };
  weather?: Weather;
  riders?: Record<string, RiderMission>;
  screens?: Record<string, ScreenState>;
  revision: number;
  epoch: number;
  motionEpoch: number;
  pausedAt: number | null;
  people: Record<string, Motion>;
  environment: { hour: number; cycle: boolean; daySeconds?: number };
  fire: 'auto' | 'on' | 'off';
  euc: {
    count: number;
    speed: number;
    enabled: boolean;
    distance: number;
    at: number;
  };
  camera: {
    position: Vec3;
    target: Vec3;
    revision: number;
    route?: CameraRoute;
  } | null;
  activity: { name: string; people: string[]; target: Vec3 | null } | null;
};
export type SimSnapshot = {
  state: SimState;
  now: number;
  catalog: { id: string; position: Vec3; canWalk: boolean }[];
  units: string;
  limitations: string[];
};
export function simTime(s: SimState, now: number) {
  return s.clock
    ? s.clock.virtual +
        (s.pausedAt !== null
          ? 0
          : Math.max(0, now - s.clock.real) * s.clock.rate)
    : (s.pausedAt ?? now);
}
// Paths are immutable within a snapshot. Cache segment metrics, including shared EUC loops.
const pathMetrics = new WeakMap<Vec3[], { lengths: number[]; total: number }>();
export function motionPose(m: Motion, now: number) {
  let metrics = pathMetrics.get(m.path);
  if (!metrics) {
    const lengths = m.path
      .slice(1)
      .map((p, i) =>
        Math.hypot(
          p[0] - m.path[i][0],
          p[1] - m.path[i][1],
          p[2] - m.path[i][2],
        ),
      );
    metrics = { lengths, total: lengths.reduce((a, b) => a + b, 0) };
    pathMetrics.set(m.path, metrics);
  }
  const { lengths, total } = metrics;
  let d = Math.max(0, ((now - m.started) / 1000) * m.speed);
  const moving = total > 0 && (m.loop || d < total);
  d = m.loop && total > 0 ? d % total : Math.min(d, total);
  for (let i = 0; i < lengths.length; i++) {
    if (d <= lengths[i] && lengths[i] > 0) {
      const a = m.path[i],
        b = m.path[i + 1],
        t = d / lengths[i];
      return {
        position: a.map((v, j) => v + (b[j] - v) * t) as Vec3,
        yaw: Math.atan2(b[0] - a[0], b[2] - a[2]),
        moving,
      };
    }
    d -= lengths[i];
  }
  let yaw = m.yaw;
  for (let i = lengths.length - 1; i >= 0; i--)
    if (lengths[i] > 0) {
      const a = m.path[i],
        b = m.path[i + 1];
      yaw = Math.atan2(b[0] - a[0], b[2] - a[2]);
      break;
    }
  return {
    position: m.path.at(-1) || ([0, -0.16, 0] as Vec3),
    yaw,
    moving: false,
  };
}
export function hourAt(s: SimState, now: number) {
  return (
    (((s.environment.hour +
      (s.environment.cycle
        ? (simTime(s, now) - s.epoch) /
          (((s.environment.daySeconds ?? 480) * 1000) / 24)
        : 0)) %
      24) +
      24) %
    24
  );
}
/** Rounded rectangle outside all model bounds: the entire replica is inside it. */
export function perimeter(bounds: number[][]): Vec3[] {
  const [a, b] = bounds,
    r = 10,
    x0 = a[0] - 16,
    x1 = b[0] + 16,
    z0 = a[2] - 16,
    z1 = b[2] + 16,
    points: Vec3[] = [];
  const corners = [
    [x1, z1],
    [x1, z0],
    [x0, z0],
    [x0, z1],
  ];
  corners.forEach(([x, z], i) => {
    const center = [x + (i < 2 ? -r : r), z + (i === 0 || i === 3 ? -r : r)];
    const angles = [Math.PI / 2, 0, -Math.PI / 2, -Math.PI];
    for (let k = 0; k <= 12; k++) {
      const angle = angles[i] - ((k / 12) * Math.PI) / 2;
      points.push([
        center[0] + Math.cos(angle) * r,
        -0.16,
        center[1] + Math.sin(angle) * r,
      ]);
    }
  });
  // Traversal above rounds inward by r. Expand margin to retain 3 m clearance at corners.
  return [...points, points[0]];
}

export function eucDistance(s: SimState, now: number) {
  return (
    (s.euc.distance ?? 0) +
    (Math.max(0, simTime(s, now) - (s.euc.at ?? s.motionEpoch)) / 1000) *
      (s.euc.enabled ? s.euc.speed : 0)
  );
}
/** Short EUC route segments otherwise snap the entire rider/wheel assembly's
 * heading at every vertex. Sample on both sides of the current position so
 * rounded corners turn continuously without moving the rider off the route.
 */
function smoothRiderHeading(m: Motion, now: number) {
  const pose = motionPose(m, now);
  if (!pose.moving || m.speed <= 0) return pose;
  const halfWindowMs = (0.5 / m.speed) * 1000;
  const before = motionPose(m, now - halfWindowMs).position;
  const after = motionPose(m, now + halfWindowMs).position;
  const dx = after[0] - before[0];
  const dz = after[2] - before[2];
  if (Math.hypot(dx, dz) > 0.001) pose.yaw = Math.atan2(dx, dz);
  return pose;
}
export function eucPose(path: Vec3[], distance: number, index: number) {
  return smoothRiderHeading(
    { path, started: 0, speed: 1, loop: true, yaw: 0, activity: 'idle' },
    (distance + index * 25) * 1000,
  );
}

export function cameraPose(s: SimState, now: number) {
  const shot = s.camera;
  if (!shot?.route) return shot;
  const r = shot.route,
    seconds = Math.max(0, (simTime(s, now) - r.started) / 1000);
  const fraction = r.loop
    ? (seconds % r.duration) / r.duration
    : Math.min(1, seconds / r.duration);
  const at = fraction * (r.points.length - 1),
    i = Math.min(r.points.length - 2, Math.floor(at)),
    t = at - i;
  const lerp = (a: Vec3, b: Vec3) =>
    a.map((v, k) => v + (b[k] - v) * t) as Vec3;
  return {
    position: lerp(r.points[i].position, r.points[i + 1].position),
    target: lerp(r.points[i].target, r.points[i + 1].target),
  };
}
export function riderPose(
  s: SimState,
  now: number,
  path: Vec3[],
  index: number,
) {
  const mission = s.riders?.[`euc-${index + 1}`];
  if (!mission)
    return { ...eucPose(path, eucDistance(s, now), index), dismounted: false };
  const time = simTime(s, now);
  const pose = smoothRiderHeading(
    mission.approach && time < mission.motion.started
      ? mission.approach
      : mission.motion,
    time,
  );
  return { ...pose, dismounted: mission.dismount && !pose.moving };
}
