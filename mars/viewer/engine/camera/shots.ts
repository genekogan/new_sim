// Shot specs as data + a stateless evaluator. `evaluateShot(spec, sampler, t)`
// depends only on (spec, sampler, t): it works identically against a live
// runtime or a recorded take, and any t can be evaluated in any order.
import { datan, dcos, dexp, dsin, dtan, type Vec3, hypot } from '../core/math.ts';
import type { OccBox } from './occluders.ts';

/** What the camera needs to know about a subject at time t. */
export type SubjectPose = {
  p: Vec3; // base (feet) position
  yaw: number;
  height?: number; // default 1.75
  /** Readability points in world space (head, torso, hands, load ends, receiving socket…). */
  points?: Vec3[];
  /** Camera-only full visual envelope for sizing shots. Visibility still uses points. */
  framingPoints?: Vec3[];
  /** Relative importance in group scoring (default 1). */
  weight?: number;
  /** 'human' subjects are soft occluders (capsule) for everyone else's readability. */
  kind?: 'human' | 'component';
  /** Ids that count as part of this subject for occlusion (a carried part's carriers, a human's co-workers). */
  crew?: string[];
  /** A component's sight-blocking boxes (occluders.ts `partOccluders`): they hide every other subject's points. */
  occluders?: OccBox[];
  /** A human's grip / contact points: as another subject's crew it is see-through only within CONTACT_RADIUS of these. */
  contacts?: Vec3[];
};
export type Sampler = (t: number) => Record<string, SubjectPose>;

export type CameraPose = { position: Vec3; target: Vec3; fov: number };

type Common = { fov?: number; cutaway?: boolean; subjects?: string[] };
export type Key = { t: number; position: Vec3; target: Vec3 };
export type Region = { min: [number, number]; max: [number, number]; y?: number };

export type ShotSpec = Common & (
  | { kind: 'fixed'; position: Vec3; target: Vec3 }
  /** offset in the subject's frame (x forward, y up, z left-hand side per yaw convention) unless frame='world'. */
  | { kind: 'follow'; subject: string; offset: Vec3; frame?: 'subject' | 'world'; lookHeight?: number; damping?: number }
  /** radius/height are the minimum: the orbit pulls out along its own ray until every point of `subjects` fits (sphere about the target + padding). */
  | { kind: 'orbit'; center?: Vec3; subject?: string; radius: number; height: number; period: number; phase?: number; lookHeight?: number; padding?: number; aspect?: number }
  | { kind: 'frameGroup'; subjects: string[]; padding?: number; azimuth: number; elevation: number; aspect?: number }
  | { kind: 'path'; keys: Key[] }
  | { kind: 'reveal'; subject?: string; center?: Vec3; azimuth: number; from: { distance: number; elevation: number }; to: { distance: number; elevation: number }; t0: number; t1: number; lookHeight?: number }
  | { kind: 'establishing'; region: Region; azimuth?: number; elevation?: number; aspect?: number }
);

export const DEFAULT_FOV = 50; // vertical, degrees
export const DEFAULT_ASPECT = 16 / 9;
const DEG = Math.PI / 180;

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** Unit direction from azimuth (heading in x/z, radians) and elevation (radians above horizon). */
export function dirFrom(azimuth: number, elevation: number): Vec3 {
  const ce = dcos(elevation);
  return [ce * dcos(azimuth), dsin(elevation), ce * dsin(azimuth)];
}

/** Default readability points for a standing human: feet, torso, head, both hands. */
export function subjectPoints(s: SubjectPose): Vec3[] {
  if (s.points && s.points.length) return s.points;
  const h = s.height ?? 1.75;
  const lx = -dsin(s.yaw) * 0.25, lz = dcos(s.yaw) * 0.25; // lateral (rot2([0,1], yaw))
  return [
    [s.p[0], s.p[1] + 0.15, s.p[2]],
    [s.p[0], s.p[1] + h * 0.6, s.p[2]],
    [s.p[0], s.p[1] + h - 0.1, s.p[2]],
    [s.p[0] + lx, s.p[1] + h * 0.5, s.p[2] + lz],
    [s.p[0] - lx, s.p[1] + h * 0.5, s.p[2] - lz],
  ];
}

function subjectOf(sampler: Sampler, id: string, t: number): SubjectPose {
  const s = sampler(t)[id];
  if (!s) throw new Error(`camera: subject '${id}' not present at t=${t.toFixed(2)}`);
  return s;
}

/** Subjects a shot is about (for readability scoring). */
export function shotSubjects(spec: ShotSpec): string[] {
  if (spec.subjects) return spec.subjects;
  switch (spec.kind) {
    case 'follow': return [spec.subject];
    case 'orbit': return spec.subject ? [spec.subject] : [];
    case 'frameGroup': return spec.subjects;
    case 'reveal': return spec.subject ? [spec.subject] : [];
    default: return [];
  }
}

/**
 * Distance at which a sphere of radius r fits the frustum (min of vertical/horizontal half-angles).
 * `safeBottom` (fraction of frame height hidden by UI at the bottom) shrinks the usable vertical half-angle.
 */
export function fitDistance(r: number, fovDeg: number, aspect = DEFAULT_ASPECT, safeBottom = 0): number {
  const tv = dtan((fovDeg * DEG) / 2);
  const v = datan(tv * (1 - safeBottom));
  const h = datan(tv * aspect);
  return r / dsin(Math.min(v, h));
}

/** Framing context for subject/region shots: the viewport's aspect and the bottom band covered by UI. */
export type FrameOpts = { aspect?: number; safeBottom?: number };

/**
 * Tilt the view down so the old target lands at the centre of the usable band
 * (NDC y = safeBottom, the middle of [−1 + 2·safeBottom, 1]). Position is unchanged.
 */
export function aimForSafeArea(pose: CameraPose, safeBottom: number): CameraPose {
  if (!(safeBottom > 0)) return pose;
  const d: Vec3 = [pose.target[0] - pose.position[0], pose.target[1] - pose.position[1], pose.target[2] - pose.position[2]];
  const l = hypot(d[0], d[1], d[2]);
  if (l < 1e-9) return pose;
  const f: Vec3 = [d[0] / l, d[1] / l, d[2] / l];
  const rl = hypot(f[0], f[2]);
  if (rl < 1e-9) return pose; // looking straight up/down: no defined screen-up
  const r: Vec3 = [-f[2] / rl, 0, f[0] / rl];
  const u: Vec3 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const k = safeBottom * dtan((pose.fov * DEG) / 2) * l;
  return { ...pose, target: [pose.target[0] - u[0] * k, pose.target[1] - u[1] * k, pose.target[2] - u[2] * k] };
}

/** Catmull-Rom (non-uniform times, Hermite form) through keyed positions. */
export function catmullRom(keys: Key[], t: number, field: 'position' | 'target'): Vec3 {
  if (keys.length === 0) throw new Error('camera: path shot has no keys');
  if (keys.length === 1 || t <= keys[0].t) return keys[0][field];
  const n = keys.length;
  if (t >= keys[n - 1].t) return keys[n - 1][field];
  let i = 0;
  while (i < n - 2 && t > keys[i + 1].t) i++;
  const k0 = keys[Math.max(0, i - 1)], k1 = keys[i], k2 = keys[i + 1], k3 = keys[Math.min(n - 1, i + 2)];
  const dt = k2.t - k1.t;
  const u = (t - k1.t) / dt;
  const tan = (a: Key, b: Key): Vec3 => {
    const d = b.t - a.t;
    return d > 1e-9 ? scale(add(b[field], scale(a[field], -1)), dt / d) : [0, 0, 0];
  };
  const m1 = tan(k0, k2), m2 = tan(k1, k3);
  const u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
  const p1 = k1[field], p2 = k2[field];
  return [0, 1, 2].map((j) => h00 * p1[j] + h10 * m1[j] + h01 * p2[j] + h11 * m2[j]) as Vec3;
}

function followRaw(spec: Extract<ShotSpec, { kind: 'follow' }>, sampler: Sampler, t: number): { position: Vec3; target: Vec3 } {
  const s = subjectOf(sampler, spec.subject, t);
  const [ox, oy, oz] = spec.offset;
  const off: Vec3 = spec.frame === 'world' ? [ox, oy, oz] : [ox * dcos(s.yaw) - oz * dsin(s.yaw), oy, ox * dsin(s.yaw) + oz * dcos(s.yaw)];
  const target: Vec3 = [s.p[0], s.p[1] + (spec.lookHeight ?? 1.3), s.p[2]];
  return { position: add(s.p, off), target };
}

/**
 * Evaluate a shot at time t. Follow damping is stateless: an exponentially
 * weighted average of the undamped pose over the past 3·damping seconds
 * (clamped at t = 0), so random access and replay give identical results.
 */
export function evaluateShot(spec: ShotSpec, sampler: Sampler, t: number, frame: FrameOpts = {}): CameraPose {
  const sb = frame.safeBottom ?? 0;
  if (sb < 0 || sb >= 0.5) throw new Error(`camera: safe-area bottom ${sb} must be in [0, 0.5)`);
  const pose = evaluateRaw(spec, sampler, t, frame.aspect, sb);
  // authored poses (fixed, path) are kept as given; subject/region shots aim above the UI band
  return spec.kind === 'fixed' || spec.kind === 'path' ? pose : aimForSafeArea(pose, sb);
}

function evaluateRaw(spec: ShotSpec, sampler: Sampler, t: number, frameAspect: number | undefined, sb: number): CameraPose {
  const fov = spec.fov ?? DEFAULT_FOV;
  switch (spec.kind) {
    case 'fixed':
      return { position: spec.position, target: spec.target, fov };
    case 'follow': {
      const tau = spec.damping ?? 0;
      if (tau <= 0) return { ...followRaw(spec, sampler, t), fov };
      const steps = 12, h = (3 * tau) / steps;
      let wsum = 0, pos: Vec3 = [0, 0, 0], tgt: Vec3 = [0, 0, 0];
      for (let k = 0; k <= steps; k++) {
        const tk = Math.max(0, t - k * h);
        const w = dexp((-k * h) / tau);
        const r = followRaw(spec, sampler, tk);
        pos = add(pos, scale(r.position, w)); tgt = add(tgt, scale(r.target, w)); wsum += w;
      }
      // target tracks the subject undamped (keeps it centred), position lags
      return { position: scale(pos, 1 / wsum), target: followRaw(spec, sampler, t).target, fov };
    }
    case 'orbit': {
      const c: Vec3 = spec.subject ? subjectOf(sampler, spec.subject, t).p : spec.center ?? [0, 0, 0];
      const a = (spec.phase ?? 0) + (2 * Math.PI * t) / spec.period;
      const target: Vec3 = [c[0], c[1] + (spec.lookHeight ?? 1.2), c[2]];
      let off: Vec3 = [spec.radius * dcos(a), spec.height - (spec.lookHeight ?? 1.2), spec.radius * dsin(a)];
      // framing radius: every point of the shot's subjects (a lying frame's corners, a crew member at the edge)
      const all = sampler(t);
      let r = 0;
      for (const id of shotSubjects(spec)) for (const q of all[id] ? (all[id].framingPoints?.length ? all[id].framingPoints! : subjectPoints(all[id])) : []) r = Math.max(r, hypot(q[0] - target[0], q[1] - target[1], q[2] - target[2]));
      const d0 = hypot(off[0], off[1], off[2]);
      if (r > 0 && d0 > 1e-9) {
        const d = fitDistance(r + (spec.padding ?? 0.5), fov, spec.aspect ?? frameAspect, sb);
        if (d > d0) off = scale(off, d / d0);
      }
      return { position: add(target, off), target, fov };
    }
    case 'frameGroup': {
      const all = sampler(t);
      const pts: Vec3[] = [];
      for (const id of spec.subjects) {
        const s = all[id];
        if (!s) throw new Error(`camera: subject '${id}' not present at t=${t.toFixed(2)}`);
        pts.push(...(s.framingPoints?.length ? s.framingPoints : subjectPoints(s)));
      }
      const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
      for (const p of pts) for (let j = 0; j < 3; j++) { lo[j] = Math.min(lo[j], p[j]); hi[j] = Math.max(hi[j], p[j]); }
      const centre = lerp3(lo, hi, 0.5);
      const r = hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2 + (spec.padding ?? 0.5);
      const d = fitDistance(r, fov, spec.aspect ?? frameAspect, sb);
      return { position: add(centre, scale(dirFrom(spec.azimuth, spec.elevation), d)), target: centre, fov };
    }
    case 'path':
      return { position: catmullRom(spec.keys, t, 'position'), target: catmullRom(spec.keys, t, 'target'), fov };
    case 'reveal': {
      const base: Vec3 = spec.subject ? subjectOf(sampler, spec.subject, t).p : spec.center ?? [0, 0, 0];
      const target: Vec3 = [base[0], base[1] + (spec.lookHeight ?? 1.2), base[2]];
      const u = smooth((t - spec.t0) / Math.max(1e-6, spec.t1 - spec.t0));
      const dist = spec.from.distance + (spec.to.distance - spec.from.distance) * u;
      const el = spec.from.elevation + (spec.to.elevation - spec.from.elevation) * u;
      return { position: add(target, scale(dirFrom(spec.azimuth, el), dist)), target, fov };
    }
    case 'establishing': {
      const { min, max } = spec.region;
      const y = spec.region.y ?? 0;
      const target: Vec3 = [(min[0] + max[0]) / 2, y, (min[1] + max[1]) / 2];
      const r = hypot(max[0] - min[0], max[1] - min[1]) / 2;
      const d = fitDistance(r, fov, spec.aspect ?? frameAspect, sb);
      return { position: add(target, scale(dirFrom(spec.azimuth ?? -Math.PI / 2, spec.elevation ?? 35 * DEG), d)), target, fov };
    }
  }
}
