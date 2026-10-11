// MARSLAND: the mars-two world frame vs the V3 build frame.
//
// The V3 campus (and everything build.mjs / layout.mjs / placements.json say) uses the "Mimos frame": x = E + 48, z = −N,
// where N/E are Gene's Mimos-plan directions. That plan's "north" is not geographic north: the 2026 drone video
// (team/lanes/marsland-frames, DJI telemetry) shows Chiba's solar slope facing true SOUTH, while V3 has it facing +x
// ("east"); the old viewer's own drone fit says the same (mars/viewer/engine/env/sun.ts: the 2026 CAD's north is −X turned
// 33° toward −Z, i.e. the Mimos plan's north points to true bearing ≈ 82°).
//
// The world (template) frame is geographic, as the engine's god tools and Souls read it: north = −z, east = +x, metres,
// origin = the Mimos origin (V3 x 48, z 0). Every root-level placement is turned by YAW about that origin and shifted to
// (0, 0); things inside a parent (rooms, tables) are parent-local and unchanged, so all of Gene's Mimos / kitchen /
// shower corrections and every internal relation stay exactly as built.
//
// Yaw convention (engine rotY): a local direction (x, z) turns to (x cos + z sin, −x sin + z cos); an entity's r adds YAW.
// The drone fits give 75–86° (DJI_0012 / DJI_0033 FlightYaw, ±5° and the compass's declination; the old viewer's fit 82°).
// 90 is inside that, makes Chiba's panels face due south as Gene says, and keeps every wall on the engine's axes: at 75°
// the Souls' navigation fails on the turned Mimos stairs and floors (reach from the raised main: route.unreachable;
// exact quarter turns are fine), which is an engine limit to fix before a non-right angle is used.
export const BEARING = Number(process.env.MARS_BEARING ?? 90);   // true compass bearing (°) of the Mimos plan's "north" (V3 −z); env only for experiments
export const YAW = -BEARING * Math.PI / 180;     // the turn that brings it to true north
export const OLD_ORIGIN = [48, 0];               // Mimos origin in the V3 build frame (x, z)
const c = Math.cos(YAW), s = Math.sin(YAW);
const r3 = (v) => Math.round(v * 1000) / 1000;

/** Build-frame (x, z) → world (x, z). */
export const toWorld = (x, z) => { const dx = x - OLD_ORIGIN[0], dz = z - OLD_ORIGIN[1]; return [r3(dx * c + dz * s), r3(-dx * s + dz * c)]; };
/** World (x, z) → build frame (x, z). */
export const toBuild = (x, z) => [r3(x * c - z * s + OLD_ORIGIN[0]), r3(x * s + z * c + OLD_ORIGIN[1])];
/** A 3-vector [x, y, z] in the build frame → world. */
export const toWorld3 = (p) => { const [x, z] = toWorld(p[0], p[2]); return [x, p[1], z]; };
/** Mimos-plan (N, E) → world (x, z). */
export const neToWorld = (n, e) => toWorld(e + OLD_ORIGIN[0], -n + OLD_ORIGIN[1]);
/** A root-level place op's pose, build frame → world (p is [x, z] or [x, y, z]; r a number, [yaw, pitch, roll] or absent). */
export function orientOp(op) {
  if (op.in || !op.p) return op;
  const p = op.p.length === 3 ? toWorld3(op.p) : toWorld(op.p[0], op.p[1]);
  const r0 = Array.isArray(op.r) ? op.r[0] : (op.r ?? 0), r = r3(r0 + YAW);
  return { ...op, p, r: Array.isArray(op.r) ? [r, ...op.r.slice(1)] : r };
}
/** The 2026 drone's take-off point (its telemetry's home) in the world frame: fitted by matching DJI_0012 (EXIF GPS and
 *  FlightYaw) and the video frames against renders (drone.mjs). */
export const HOME_WORLD = [7.6, -5.3];
/** A build-frame offset (dx, dz) turned into the world frame (no translation). */
export const rot = (dx, dz) => [r3(dx * c + dz * s), r3(-dx * s + dz * c)];
/** World point p [x, y, z] plus a build-frame offset [dx, dy, dz] (cameras placed "east of" a Soul in Gene's plan terms). */
export const offset = (p, d) => { const [x, z] = rot(d[0], d[2]); return [p[0] + x, p[1] + d[1], p[2] + z]; };
