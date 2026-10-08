// perception/1 geometry (EDGE-CONTRACT-v1 §8): compass headings, bearings relative to a Soul's heading, and the
// sightline rule. Pure and deterministic; never part of the world's logged state.
//
// World frame (engine): x = east, z = south (map seen from above, north up). A body's yaw points along
// (cos yaw, sin yaw). Compass headings are degrees clockwise from north: 0 = N, 90 = E, 180 = S, 270 = W.
type V2 = [number, number];
export type Solid = {id: string; label?: string; c: V2; half: V2; yaw: number; height?: number};

const DEG = 180 / Math.PI;
const wrap360 = (d: number) => ((d % 360) + 360) % 360;
/** Compass heading (deg) of a direction vector in world x/z. */
export const compassOf = (dx: number, dz: number) => wrap360(Math.round(wrap360(Math.atan2(dx, -dz) * DEG)));
/** Compass heading (deg) of a body yaw. */
export const headingOfYaw = (yaw: number) => compassOf(Math.cos(yaw), Math.sin(yaw));
/** Body yaw for a compass heading (deg). */
export const yawOfHeading = (deg: number) => {const r = deg / DEG; return Math.round(Math.atan2(-Math.cos(r), Math.sin(r)) * 1000) / 1000;};
/** Body yaw that faces from a point towards another. */
export const yawTowards = (from: V2, to: V2) => Math.round(Math.atan2(to[1] - from[1], to[0] - from[0]) * 1000) / 1000;

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
/** Compass point (N, NE, …) of a heading. */
export const compassPoint = (deg: number) => POINTS[Math.round(wrap360(deg) / 45) % 8];

const BEARINGS = ['ahead', 'front-right', 'right', 'behind-right', 'behind', 'behind-left', 'left', 'front-left'];
/** Signed angle (deg, −180..180) from my heading to a target; positive = to my right. */
export function relativeAngle(myHeading: number, from: V2, to: V2): number {
  const a = compassOf(to[0] - from[0], to[1] - from[1]) - myHeading;
  return ((a + 540) % 360) - 180;
}
/** One of ahead / front-right / right / behind-right / behind / behind-left / left / front-left. */
export const bearingWord = (rel: number) => BEARINGS[Math.round(wrap360(rel) / 45) % 8];
export const bearingOf = (myHeading: number, from: V2, to: V2) => bearingWord(relativeAngle(myHeading, from, to));

/** Is `who` (at `at`, looking along heading `facing`) facing `me`: within 35° of the line towards me. */
export function facingPoint(at: V2, facing: number, me: V2): boolean {
  return Math.abs(relativeAngle(facing, at, me)) <= 35;
}

/** Height (m) a solid must reach to block a standing Soul's sight: buildings, walls and kiosks do; rails,
 *  fences, benches, furniture and water edges (≤ 1.5 m) do not. A solid with no height is a building. */
export const SIGHT_BLOCK_HEIGHT = 1.5;
const inside = (p: V2, s: Solid, pad = 0) => {
  const dx = p[0] - s.c[0], dz = p[1] - s.c[1], c = Math.cos(s.yaw), n = Math.sin(s.yaw), lx = dx * c + dz * n, lz = -dx * n + dz * c;
  return Math.abs(lx) <= s.half[0] + pad && Math.abs(lz) <= s.half[1] + pad;
};
/** Does the segment a→b pass through the oriented box (slab test in the box frame)? */
function segmentHits(a: V2, b: V2, s: Solid): boolean {
  const c = Math.cos(s.yaw), n = Math.sin(s.yaw), loc = (p: V2): V2 => {const dx = p[0] - s.c[0], dz = p[1] - s.c[1]; return [dx * c + dz * n, -dx * n + dz * c];};
  const p = loc(a), q = loc(b), d: V2 = [q[0] - p[0], q[1] - p[1]];
  let t0 = 0, t1 = 1;
  for (let k = 0; k < 2; k++) {
    if (Math.abs(d[k]) < 1e-9) {if (Math.abs(p[k]) > s.half[k]) return false; continue;}
    let u = (-s.half[k] - p[k]) / d[k], v = (s.half[k] - p[k]) / d[k]; if (u > v) [u, v] = [v, u];
    t0 = Math.max(t0, u); t1 = Math.min(t1, v); if (t0 > t1) return false;
  }
  return true;
}
/**
 * Sightline rule (perception/1): a clear line between two points unless it crosses a nav/1 solid at least
 * SIGHT_BLOCK_HEIGHT tall that contains neither end point (so a seated body's own bench or a wall it leans on never
 * hides it). Buildings are solid boxes (or wall shells with door gaps when their interior is admitted), so you see
 * into a building only through its doorway. Enclosure is checked separately (same enclosed place, or both outdoors).
 */
export function clearSight(a: V2, b: V2, solids: readonly Solid[]): {clear: true} | {clear: false; by: string} {
  const minX = Math.min(a[0], b[0]), maxX = Math.max(a[0], b[0]), minZ = Math.min(a[1], b[1]), maxZ = Math.max(a[1], b[1]);
  for (const s of solids) {
    if ((s.height ?? 3) < SIGHT_BLOCK_HEIGHT) continue;
    const r = Math.abs(s.half[0]) + Math.abs(s.half[1]);
    if (s.c[0] + r < minX || s.c[0] - r > maxX || s.c[1] + r < minZ || s.c[1] - r > maxZ) continue;
    if (inside(a, s, 0.05) || inside(b, s, 0.05)) continue;
    if (segmentHits(a, b, s)) return {clear: false, by: s.label ?? s.id};
  }
  return {clear: true};
}

const r1 = (n: number) => Math.round(n * 10) / 10;
export const dist2 = (a: V2, b: V2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const round1 = r1;

/** A spoken-style duration: 40s, 3m, 1h20m. */
export function durationWord(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 90) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return m ? `${h}h${m}m` : `${h}h`;
}
/** Walking ETA (seconds) for a route length: bodies walk at about 1.35 m/s, ~1.15 m/s with turns and yielding. */
export const walkSeconds = (metres: number) => Math.round(metres / 1.15);
