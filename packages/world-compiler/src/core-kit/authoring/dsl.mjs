// Authoring DSL for core-kit families (L4). Each family module exports defs built with these
// helpers; build.mjs writes the JSON the server loads. Shapes are kit/2 primitives (rounded
// low-poly: capsules, spheres, rounded boxes, lathes), coordinates in metres, +z is the front,
// y = 0 is the ground. Colours default to the def palette via `tint` keys so instances recolour.
import { kitArgs, kitPhysics } from '../../../../generators/src/kit.ts';

const r3 = (v) => Math.round(v * 1000) / 1000;
const v = (a) => a.map(r3);

/** Rounded box centred at `at`. */
export const rbox = (at, size, c, o = {}) => ({ kind: 'rbox', at: v(at), size: v(size), ...col(c), ...o });
/**
 * Chamfered box (28 tris, vs 108 for a RoundedBox): an extruded rectangle whose top and bottom
 * edges are bevelled by the kit's `round` (kit.mesh bevels extrudes by min(round, 0.03)). The
 * workhorse of the Eden look. Resolved in kitDef once the kit round is known; parts thinner than
 * three bevels become plain boxes; pitch/roll fall back to rbox (extrudes pivot at their base).
 */
export const cbox = (at, size, c, o = {}) => ({ __cbox: true, at, size, c, o });
function resolveCbox(sh, kitRound) {
  if (!sh.__cbox) return sh;
  const { at, size, c } = sh, [w, h, d] = size, { round: _r, ...o } = sh.o;
  if (o.pitch || o.roll) return rbox(at, size, c, { round: Math.min(0.03, kitRound), ...o });
  if (Math.min(w, h, d) < 0.012) return box(at, size, c, o);
  const b = Math.min(kitRound, 0.03);
  if (b < 0.004 || Math.min(w, h, d) < b * 2.2) return box(at, size, c, o);
  const hw = w / 2 - b, hd = d / 2 - b;
  return { kind: 'extrude', at: v([at[0], at[1] - h / 2 + b, at[2]]), polygon: [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(v), h: r3(h - 2 * b), ...col(c), ...o };
}
/** Sharp box (12 tris): thin boards, slats, legs. Use rbox for the main masses. */
export const box = (at, size, c, o = {}) => ({ kind: 'box', at: v(at), size: v(size), round: 0, ...col(c), ...o });
export const sph = (at, r, c, o = {}) => ({ kind: 'sphere', at: v(at), r: r3(r), segments: o.seg ?? 8, ...col(c), ...strip(o) });
export const cyl = (at, r, h, c, o = {}) => ({ kind: 'cyl', at: v(at), r: r3(r), h: r3(h), segments: o.seg ?? 8, ...(o.r2 !== undefined ? { r2: r3(o.r2) } : {}), ...col(c), ...strip(o, ['r2']) });
export const cone = (at, r, h, c, o = {}) => ({ kind: 'cone', at: v(at), r: r3(r), h: r3(h), segments: o.seg ?? 8, ...col(c), ...strip(o) });
export const cap = (at, r, h, c, o = {}) => ({ kind: 'capsule', at: v(at), r: r3(r), h: r3(Math.max(0.001, h)), segments: o.seg ?? 6, ...col(c), ...strip(o) });
export const tor = (at, r, r2, c, o = {}) => ({ kind: 'torus', at: v(at), r: r3(r), r2: r3(r2), segments: o.seg ?? 12, ...col(c), ...strip(o) });
export const ring = (at, r, r2, c, o = {}) => ({ kind: 'ring', at: v(at), r: r3(r), r2: r3(r2), segments: o.seg ?? 12, ...col(c), ...strip(o) });
export const lathe = (at, profile, c, o = {}) => ({ kind: 'lathe', at: v(at), profile: profile.map(v), segments: o.seg ?? 10, ...col(c), ...strip(o) });
export const wedge = (at, size, c, o = {}) => ({ kind: 'wedge', at: v(at), size: v(size), ...col(c), ...o });
export const arch = (at, size, c, o = {}) => ({ kind: 'arch', at: v(at), size: v(size), ...col(c), ...strip(o) , segments: o.seg ?? 8 });
export const extrude = (at, polygon, h, c, o = {}) => ({ kind: 'extrude', at: v(at), polygon: polygon.map(v), h: r3(h), ...col(c), ...strip(o) });
export const sweep = (at, path, r, c, o = {}) => ({ kind: 'sweep', at: v(at), path: path.map(v), r: r3(r), segments: o.seg ?? 6, ...col(c), ...strip(o) });

/** A capsule (or cylinder) spanning from a to b. */
export function limb(a, b, r, c, o = {}) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], len = Math.hypot(...d) || 1e-3;
  const pitch = Math.acos(Math.max(-1, Math.min(1, d[1] / len))), yaw = Math.atan2(d[0], d[2]);
  const at = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const rot = { ...(Math.abs(pitch) > 1e-4 ? { pitch: r3(pitch) } : {}), ...(Math.abs(yaw) > 1e-4 && Math.abs(pitch) > 1e-4 ? { yaw: r3(yaw) } : {}) };
  const { kind, ...rest } = o;
  if (kind === 'cyl') return cyl(at, r, len, c, { ...rot, ...rest });
  if (kind === 'cone') return cone(at, r, len, c, { ...rot, ...rest });
  return cap(at, r, Math.max(0.001, len - 2 * r), c, { ...rot, ...rest });
}

function col(c) { if (!c) return {}; if (c.startsWith('#')) return { color: c }; return { tint: c }; }
function strip(o, extra = []) { const { seg: _s, ...rest } = o; for (const k of extra) delete rest[k]; return rest; }

/** Mirror a shape list across x (left/right symmetry); role suffixes .l/.r swap. */
export function mirror(shapes) {
  return shapes.map((s) => {
    const m = { ...s, at: [r3(-s.at[0]), s.at[1], s.at[2]] };
    if (s.yaw !== undefined) m.yaw = r3(-s.yaw);
    if (s.roll !== undefined) m.roll = r3(-s.roll);
    if (s.pivot) m.pivot = [r3(-s.pivot[0]), s.pivot[1], s.pivot[2]];
    if (s.role) m.role = s.role.replace(/\.(l|r)$/, (_, x) => (x === 'l' ? '.r' : '.l')).replace(/^leg\.f(l|r)$/, (_, x) => `leg.f${x === 'l' ? 'r' : 'l'}`).replace(/^leg\.b(l|r)$/, (_, x) => `leg.b${x === 'l' ? 'r' : 'l'}`);
    return m;
  });
}
export const withRole = (role, pivot, shapes) => shapes.map((s) => ({ ...s, role, pivot: v(pivot) }));

/**
 * One def/1 for a kit/2 thing. `palette` maps tint keys → default colours; every tint key becomes a
 * colour param so instances can recolour ("a black dog": params { fur: '#222' }).
 */
export function kitDef({ name, description, tags = [], shapes: shapesIn, slots = [], components = {}, palette = {}, params = {}, state = {}, anchor, layer, gait, round, material, scale, form, tilt, actions, extraArgs = {} }) {
  const shapes = shapesIn.map((sh) => resolveCbox(sh, round ?? 0.04));
  const used = new Set(shapes.map((s) => s.tint).filter(Boolean));
  for (const k of used) if (!palette[k]) throw new Error(`${name}: tint ${k} has no palette colour`);
  const tintParams = Object.fromEntries([...used].map((k) => [k, { type: 'color', default: palette[k], doc: `${k} colour` }]));
  const args = { shapes, ...(round !== undefined ? { round } : {}), ...(gait && gait !== 'none' ? { gait } : {}), ...extraArgs };
  const parsed = kitArgs.parse(args);
  const baked = kitPhysics(parsed);
  if (parsed.shapes.length > 96) throw new Error(`${name}: ${parsed.shapes.length} shapes > 96`);
  const def = {
    schema: 'def/1', name: `core-${name}`, version: 1, description, tags: [...new Set(tags)], form: form ?? 'point',
    make: { kind: 'gen', gen: 'kit/2', args },
    params: { ...tintParams, ...params },
    ...(Object.keys(state).length ? { state } : {}),
    ...(slots.length ? { slots } : {}),
    ...(Object.keys(components).length ? { components } : {}),
    ...(actions ? { actions } : {}),
    ...(anchor ? { anchor } : {}), ...(layer ? { layer } : {}), ...(material ? { material } : {}), ...(tilt ? { tilt } : {}),
    palette,
    size: { box: baked.box.map((x) => Math.max(0.05, r3(x))), ...(scale ? { scale } : {}) },
  };
  Object.defineProperty(def, '__tris', { value: baked.tris, enumerable: false });
  return def;
}

export const seat = (id, p, yaw = 0, height = p[1]) => ({ id, kind: 'seat', p: v(p), yaw, height: r3(height), accepts: { tags: ['body'] }, capacity: 1 });
export const surface = (id, p, cap = 8, maxSize = [0.6, 0.6, 0.6]) => ({ id, kind: 'surface', p: v(p), yaw: 0, height: r3(p[1]), accepts: { maxSize, maxMass: 20 }, capacity: cap });
export const shelf = (id, p, cap = 12) => ({ id, kind: 'shelf', p: v(p), yaw: 0, height: r3(p[1]), accepts: { tags: ['item'], maxSize: [0.5, 0.4, 0.4] }, capacity: cap });
export const bedSlot = (id, p, yaw = 0) => ({ id, kind: 'bed', p: v(p), yaw, height: r3(p[1]), accepts: { tags: ['body'] }, capacity: 1 });
export const stand = (id, p, yaw = 0, cap = 1) => ({ id, kind: 'stand', p: v(p), yaw, accepts: {}, capacity: cap });
export const perch = (id, p, cap = 1) => ({ id, kind: 'perch', p: v(p), yaw: 0, accepts: { tags: ['bird'] }, capacity: cap });
export const socket = (id, p, yaw = 0, tags = []) => ({ id, kind: 'socket', p: v(p), yaw, accepts: tags.length ? { tags } : {}, capacity: 1 });
export const hang = (id, p, yaw = 0) => ({ id, kind: 'hang', p: v(p), yaw, accepts: {}, capacity: 1 });
