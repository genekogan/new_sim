// Three separate evaluators (SPEC §18, RESEARCH §9):
//   placement validity — camera not inside / too close to collision solids,
//                        and a moving camera never crosses one between samples;
//   readability        — the action's subject points are in frame, unoccluded
//                        (occlusion set only; glass is see-through), large enough;
//   temporal coherence — angular velocity/acceleration, oscillation between alternatives.
import { dacos, dtan, type Vec3 } from '../core/math.ts';
import { CameraWorld, nearestSolid, raycast, solidName, type Solid } from './geom.ts';
import { segmentBox } from './occluders.ts';
import { DEFAULT_ASPECT, subjectPoints, type CameraPose, type SubjectPose } from './shots.ts';

export const MIN_CLEARANCE = 0.3; // m
const DEG = Math.PI / 180;

export type Placement = { valid: boolean; clearance: number; blocker?: string; reason?: string };

export function placement(world: CameraWorld, p: Vec3, minClear = MIN_CLEARANCE): Placement {
  if (p[1] < 0.05) return { valid: false, clearance: p[1], reason: `camera below ground (y=${p[1].toFixed(2)})` };
  const n = nearestSolid(world, p, 'collide', minClear + 0.5);
  if (!n) return { valid: true, clearance: Infinity };
  if (n.d < 0) return { valid: false, clearance: n.d, blocker: n.solid.o.id, reason: `camera inside ${solidName(n.solid)}` };
  if (n.d < minClear) return { valid: false, clearance: n.d, blocker: n.solid.o.id, reason: `camera ${n.d.toFixed(2)} m from ${solidName(n.solid)} (< ${minClear} m)` };
  return { valid: true, clearance: n.d, blocker: n.solid.o.id };
}

/** Does the straight camera move a→b cross (or touch) a collision solid? */
export function sweepCrossing(world: CameraWorld, a: Vec3, b: Vec3): Solid | null {
  const h = raycast(world, a, b, 'collide');
  return h ? h.solid : null;
}

/** People as soft occluders (readability only, never camera collision): vertical capsule at the sampled pose. */
export const PERSON_RADIUS = 0.2; // m (0.28 over-occluded rays passing beside the skinned body: CAMERA_VERIFY.md)
export const PERSON_HEIGHT = 1.7; // m, total capsule height from the feet
/** A crew member (or another subject) is see-through only for subject points this close to one of its grip/contact points. */
export const CONTACT_RADIUS = 0.6; // m

/**
 * Does segment a→b pass within `r` of the vertical capsule axis standing at `base`
 * (axis from base.y + r to base.y + h − r)? Returns the segment parameter of the
 * closest approach (used to order it against solid hits), or null.
 */
export function capsuleHit(a: Vec3, b: Vec3, base: Vec3, r = PERSON_RADIUS, h = PERSON_HEIGHT): number | null {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  // x/z broadphase: horizontal distance from the axis to the segment's footprint
  const ex = base[0] - a[0], ez = base[2] - a[2];
  const hh = dx * dx + dz * dz;
  const s2 = hh > 1e-12 ? Math.min(1, Math.max(0, (ex * dx + ez * dz) / hh)) : 0;
  if (Math.hypot(ex - dx * s2, ez - dz * s2) > r) return null;
  // closest points between the segment and the vertical axis segment (Ericson §5.1.9)
  const y0 = base[1] + r, L = Math.max(0, h - 2 * r);
  const rx = a[0] - base[0], ry = a[1] - y0, rz = a[2] - base[2];
  const A = dx * dx + dy * dy + dz * dz, E = L * L, F = ry * L;
  const C = dx * rx + dy * ry + dz * rz, B = dy * L;
  let s = 0, u = 0;
  if (A <= 1e-12) { u = E > 1e-12 ? Math.min(1, Math.max(0, F / E)) : 0; }
  else if (E <= 1e-12) { s = Math.min(1, Math.max(0, -C / A)); }
  else {
    const den = A * E - B * B;
    s = den > 1e-12 ? Math.min(1, Math.max(0, (B * F - C * E) / den)) : 0;
    u = (B * s + F) / E;
    if (u < 0) { u = 0; s = Math.min(1, Math.max(0, -C / A)); }
    else if (u > 1) { u = 1; s = Math.min(1, Math.max(0, (B - C) / A)); }
  }
  const px = a[0] + dx * s - base[0], py = a[1] + dy * s - (y0 + L * u), pz = a[2] + dz * s - base[2];
  return px * px + py * py + pz * pz < r * r ? s : null;
}

/** Subject ids plus their crews (carriers of a carried part etc.): see-through only near their contact points. */
export function subjectGroup(subjects: Record<string, SubjectPose>, ids: string[]): Set<string> {
  const g = new Set(ids);
  for (const id of ids) for (const c of subjects[id]?.crew ?? []) g.add(c);
  return g;
}

export type SubjectReadability = {
  id: string;
  score: number;
  visible: number; // fraction of points in frame and unoccluded
  inFrame: number; // fraction of points inside the frustum
  size: number; // projected world extent (height or bbox diagonal) as fraction of frame height
  occluders: { id: string; label: string; fraction: number }[];
};
export type Readability = { score: number; subjects: SubjectReadability[]; reasons: string[] };

export type ReadOpts = {
  aspect?: number;
  minSize?: number; // min projected subject extent, fraction of frame height (default 0.08)
  safeBottom?: number; // fraction of frame height covered by UI at the bottom: points there are 'outside frame' (default 0)
  cutaway?: boolean; // inspection mode: ignore occluders (solids and people) entirely
  near?: number;
};

type Basis = { f: Vec3; r: Vec3; u: Vec3; tv: number; th: number };
function basis(cam: CameraPose, aspect: number): Basis {
  const d: Vec3 = [cam.target[0] - cam.position[0], cam.target[1] - cam.position[1], cam.target[2] - cam.position[2]];
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  const f: Vec3 = [d[0] / l, d[1] / l, d[2] / l];
  // right = f × up(0,1,0)
  let r: Vec3 = [-f[2], 0, f[0]];
  const rl = Math.hypot(r[0], r[2]);
  r = rl > 1e-9 ? [r[0] / rl, 0, r[2] / rl] : [1, 0, 0];
  const u: Vec3 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const tv = dtan((cam.fov * DEG) / 2);
  return { f, r, u, tv, th: tv * aspect };
}

/** Camera-space (x right, y up, z depth) of p. */
function toCam(cam: CameraPose, b: Basis, p: Vec3): Vec3 {
  const d: Vec3 = [p[0] - cam.position[0], p[1] - cam.position[1], p[2] - cam.position[2]];
  return [d[0] * b.r[0] + d[1] * b.r[1] + d[2] * b.r[2], d[0] * b.u[0] + d[1] * b.u[1] + d[2] * b.u[2], d[0] * b.f[0] + d[1] * b.f[1] + d[2] * b.f[2]];
}

/**
 * Readability of the named subjects from `cam`. Each subject's points are
 * ray-cast from the camera against the occlusion set, every other component's
 * part boxes (`SubjectPose.occluders`, per tick) and every other human's capsule.
 * A human of the subjects' group (another subject or a crew member) is see-through
 * only for points within CONTACT_RADIUS of its contact points (a hand on its own
 * load); a subject is never occluded by its own geometry. A point counts if it is
 * inside the frustum (5 % safe margin, above the `safeBottom` UI band) and unoccluded. Subject score =
 * visible fraction × min(1, size / minSize); aggregate = weighted mean.
 */
export function readability(world: CameraWorld, cam: CameraPose, subjects: Record<string, SubjectPose>, ids: string[], opts: ReadOpts = {}): Readability {
  const aspect = opts.aspect ?? DEFAULT_ASPECT, minSize = opts.minSize ?? 0.08, near = opts.near ?? 0.1;
  const yMin = 2 * (opts.safeBottom ?? 0) - 0.95; // lowest usable NDC y (5 % margin above the UI band)
  const b = basis(cam, aspect);
  // occluders (sorted → deterministic naming): every human's capsule, every part's boxes
  const group = subjectGroup(subjects, ids);
  const keys = opts.cutaway ? [] : Object.keys(subjects).sort();
  const people = keys.filter((k) => subjects[k].kind === 'human').map((k) => ({ id: k, p: subjects[k].p, contacts: group.has(k) ? subjects[k].contacts ?? [] : null }));
  const parts = keys.flatMap((k) => (subjects[k].occluders ?? []).map((b) => ({ id: k, b })));
  const cr2 = CONTACT_RADIUS * CONTACT_RADIUS;
  const out: SubjectReadability[] = [];
  const reasons: string[] = [];
  let wsum = 0, total = 0;
  for (const id of ids) {
    const s = subjects[id];
    if (!s) { out.push({ id, score: 0, visible: 0, inFrame: 0, size: 0, occluders: [] }); reasons.push(`subject ${id} missing`); wsum += 1; continue; }
    const pts = subjectPoints(s);
    let inFrame = 0, visible = 0;
    const occ = new Map<string, { label: string; n: number }>();
    for (const p of pts) {
      const c = toCam(cam, b, p);
      const framed = c[2] > near && Math.abs(c[0]) <= c[2] * b.th * 0.95 && c[1] <= c[2] * b.tv * 0.95 && c[1] >= c[2] * b.tv * yMin;
      if (framed) inFrame++;
      if (opts.cutaway) { if (framed) visible++; continue; }
      const dist = Math.hypot(p[0] - cam.position[0], p[1] - cam.position[1], p[2] - cam.position[2]);
      // stop 5 cm short of the point so the subject's own carried object/socket doesn't self-occlude
      const u = Math.max(0, 1 - 0.05 / Math.max(dist, 1e-6));
      const end: Vec3 = [cam.position[0] + (p[0] - cam.position[0]) * u, cam.position[1] + (p[1] - cam.position[1]) * u, cam.position[2] + (p[2] - cam.position[2]) * u];
      const h = raycast(world, cam.position, end, 'occlude');
      let hit: { t: number; id: string; label: string } | null = h ? { t: h.t, id: h.solid.o.id, label: h.solid.o.label ?? h.solid.o.id } : null;
      for (const q of parts) {
        if (q.id === id) continue; // own geometry
        const t = segmentBox(cam.position, end, q.b);
        if (t !== null && (!hit || t < hit.t)) hit = { t, id: q.id, label: `part ${q.id}` };
      }
      for (const q of people) {
        if (q.id === id) continue;
        // crew / co-subject: see-through only near its own grip (a hand on the load it carries)
        if (q.contacts && q.contacts.some((c) => (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2 <= cr2)) continue;
        const t = capsuleHit(cam.position, end, q.p);
        if (t !== null && (!hit || t < hit.t)) hit = { t, id: q.id, label: `person ${q.id}` };
      }
      if (hit) {
        const e = occ.get(hit.id) ?? { label: hit.label, n: 0 };
        e.n++;
        occ.set(hit.id, e);
      } else if (framed) visible++;
    }
    // projected size as fraction of frame height: the subject's world extent (max of its height and
    // its points' bounding-box diagonal, so a lying 12 ft upright is 3.7 m, not a default human
    // height) at the depth of its bounding-box centre (feet→head→points)
    const hgt = s.height ?? 1.75;
    const lo: Vec3 = [s.p[0], s.p[1], s.p[2]], hi: Vec3 = [s.p[0], s.p[1] + hgt, s.p[2]];
    const plo: Vec3 = [Infinity, Infinity, Infinity], phi: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const q of pts) for (let j = 0; j < 3; j++) {
      plo[j] = Math.min(plo[j], q[j]); phi[j] = Math.max(phi[j], q[j]);
      lo[j] = Math.min(lo[j], q[j]); hi[j] = Math.max(hi[j], q[j]);
    }
    const extent = Math.max(hgt, Math.hypot(phi[0] - plo[0], phi[1] - plo[1], phi[2] - plo[2]));
    const depth = Math.max(near, toCam(cam, b, [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2])[2]);
    const size = extent / (2 * depth * b.tv);
    const n = pts.length;
    const score = (visible / n) * Math.min(1, size / minSize);
    const occluders = [...occ.entries()].map(([oid, e]) => ({ id: oid, label: e.label, fraction: e.n / n })).sort((x, y) => y.fraction - x.fraction || (x.id < y.id ? -1 : 1));
    out.push({ id, score, visible: visible / n, inFrame: inFrame / n, size, occluders });
    const w = s.weight ?? 1;
    wsum += w; total += w * score;
    for (const o of occluders) reasons.push(`subject ${id} ${Math.round(o.fraction * 100)}% occluded by '${o.label}'`);
    if (inFrame < n) reasons.push(`subject ${id} ${Math.round((1 - inFrame / n) * 100)}% outside frame`);
    if (size < minSize) reasons.push(`subject ${id} too small (${(size * 100).toFixed(1)}% of frame height)`);
  }
  return { score: wsum > 0 ? total / wsum : 1, subjects: out, reasons };
}

export type TrackSample = { t: number; position: Vec3; target: Vec3; fov: number; key?: string; cut?: boolean };
export type Temporal = {
  maxAngVel: number; // deg/s of view direction (excluding cuts)
  maxAngAcc: number; // deg/s²
  maxLinVel: number; // m/s
  maxLinAcc: number; // m/s²
  keySwitches: number;
  oscillations: { t: number; keys: string[] }[]; // A→B→A within window
  cutsPer2s: number; // max number of cuts in any 2 s window
};

const viewDir = (s: TrackSample): Vec3 => {
  const d: Vec3 = [s.target[0] - s.position[0], s.target[1] - s.position[1], s.target[2] - s.position[2]];
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  return [d[0] / l, d[1] / l, d[2] / l];
};

/** Temporal coherence metrics over a sampled track. Cut samples reset derivatives. */
export function temporal(samples: TrackSample[], window = 2): Temporal {
  let maxAngVel = 0, maxAngAcc = 0, maxLinVel = 0, maxLinAcc = 0, keySwitches = 0;
  let prevW: number | null = null, prevV: number | null = null;
  const switches: { t: number; from: string; to: string }[] = [];
  const cutTimes: number[] = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i];
    const dt = b.t - a.t;
    if ((a.key ?? '') !== (b.key ?? '')) { keySwitches++; switches.push({ t: b.t, from: a.key ?? '', to: b.key ?? '' }); }
    if (b.cut) { cutTimes.push(b.t); prevW = prevV = null; continue; }
    if (dt <= 0) continue;
    const da = viewDir(a), db = viewDir(b);
    const w = dacos(Math.min(1, Math.max(-1, da[0] * db[0] + da[1] * db[1] + da[2] * db[2]))) / DEG / dt;
    const v = Math.hypot(b.position[0] - a.position[0], b.position[1] - a.position[1], b.position[2] - a.position[2]) / dt;
    maxAngVel = Math.max(maxAngVel, w); maxLinVel = Math.max(maxLinVel, v);
    if (prevW !== null && prevV !== null) { maxAngAcc = Math.max(maxAngAcc, Math.abs(w - prevW) / dt); maxLinAcc = Math.max(maxLinAcc, Math.abs(v - prevV) / dt); }
    prevW = w; prevV = v;
  }
  const oscillations: { t: number; keys: string[] }[] = [];
  for (let i = 1; i < switches.length; i++) {
    const p = switches[i - 1], q = switches[i];
    if (q.t - p.t <= window && q.to === p.from && q.from === p.to) oscillations.push({ t: q.t, keys: [p.from, p.to, q.to] });
  }
  let cutsPer2s = 0;
  for (let i = 0, j = 0; i < cutTimes.length; i++) {
    while (cutTimes[i] - cutTimes[j] >= 2) j++;
    cutsPer2s = Math.max(cutsPer2s, i - j + 1);
  }
  return { maxAngVel, maxAngAcc, maxLinVel, maxLinAcc, keySwitches, oscillations, cutsPer2s };
}
