/**
 * Kit authoring snippets: served at <world>/god/examples/kit-helpers.mjs.
 * The existing limb/mirror helpers below are copied from
 * packages/world-compiler/src/core-kit/authoring/dsl.mjs (tested against that source).
 *
 * import { limb, mirror } from './kit-helpers.mjs';
 * const left = [limb([-.4,1,0],[-.7,.2,.1],.08,'#665544',{role:'arm.l'})];
 * const arms = [...left, ...mirror(left)];
 *
 * Prefer data-only kit programs for new work: no generator script is needed.
 * define-kit JSON needs a declared box:[width,height,depth] for programs.
 * A def/1 uses make.args.shapes and the def's declared numeric params/defaults.
 *
 * {"name":"posts","box":[5,3,1],"params":{"height":{"type":"number","default":3}},
 *  "shapes":[{"kind":"box","at":[0,"$height/2",0],"size":[1,"$height",1],
 *             "repeat":{"n":3,"step":[2,0,0]}}]}
 *
 * Expansion order: numeric $params; endpoints/outline; repeat; radial; mirror.
 * - repeat:{n,step:[dx,dy,dz]} includes the original. Pivots travel with copies.
 *   step can also be a numeric shape-delta object, or a list of n-1 such deltas;
 *   color/material/collide/tint in a delta replace that value. Array lengths match.
 * - radial:{n,r,face:'out'|'in'|'none',start?:radians,arc?:radians} uses at as centre,
 *   angle zero along +z. Full circles omit the seam; partial arcs include both ends.
 * - mirror:true adds an x reflection; 'y', 'z', or ['x','z'] add other combinations.
 *   Parts, rotations, geometry and pivots reflect; x swaps .l/.r and leg.fl/fr/bl/br.
 * - from/to:[x,y,z] span cyl/cone/capsule or a box/rbox's y axis; omit at/rotation/scale.
 *   Capsule endpoints include its end caps, so their distance must exceed 2*r.
 * - kind:'arch.pointed',size:[w,h,d] is an open two-centred lancet arch, centred at at.
 *   kind:'arch',outline:'lancet' is the same arch.
 *   segments:3..14 samples each arc. Existing round arches keep their geometry.
 * - kind:'extrude',outline:'lancet',size:[w,h,d] makes a filled panel, based at y=0.
 *   h (if set) is extrusion depth; segments:3..30; outlineAxis:'yx' swaps polygon axes.
 *   pitch:-1.5708 stands the default polygon upright. Height >= sqrt(3)/2 * width.
 * - Numeric shape fields accept expressions like "$height*0.6" or "($height-1)/2".
 *   Only declared numeric params, finite literals, + - * / and parentheses; no JS.
 * Limits: 96 authored entries, 512 expanded primitives, existing 80k triangle budget.
 * Refusals name make.args.<field> and a fix. Defaults/ordinary kits retain their look.
 */
const r3 = v => Math.round(v * 1000) / 1000;
const v = a => a.map(r3);
function col(c) { if (!c) return {}; return c.startsWith('#') ? { color: c } : { tint: c }; }
function strip(o, extra = []) { const { seg: _s, ...rest } = o; for (const k of extra) delete rest[k]; return rest; }
const cyl = (at, r, h, c, o = {}) => ({ kind: 'cyl', at: v(at), r: r3(r), h: r3(h), segments: o.seg ?? 8, ...(o.r2 !== undefined ? { r2: r3(o.r2) } : {}), ...col(c), ...strip(o, ['r2']) });
const cone = (at, r, h, c, o = {}) => ({ kind: 'cone', at: v(at), r: r3(r), h: r3(h), segments: o.seg ?? 8, ...col(c), ...strip(o) });
const cap = (at, r, h, c, o = {}) => ({ kind: 'capsule', at: v(at), r: r3(r), h: r3(Math.max(.001, h)), segments: o.seg ?? 6, ...col(c), ...strip(o) });
export function limb(a, b, r, c, o = {}) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], len = Math.hypot(...d) || 1e-3;
  const pitch = Math.acos(Math.max(-1, Math.min(1, d[1] / len))), yaw = Math.atan2(d[0], d[2]);
  const at = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const rot = { ...(Math.abs(pitch) > 1e-4 ? { pitch: r3(pitch) } : {}), ...(Math.abs(yaw) > 1e-4 && Math.abs(pitch) > 1e-4 ? { yaw: r3(yaw) } : {}) };
  const { kind, ...rest } = o;
  if (kind === 'cyl') return cyl(at, r, len, c, { ...rot, ...rest });
  if (kind === 'cone') return cone(at, r, len, c, { ...rot, ...rest });
  return cap(at, r, Math.max(.001, len - 2 * r), c, { ...rot, ...rest });
}
export function mirror(shapes) {
  return shapes.map(s => {
    const m = { ...s, at: [r3(-s.at[0]), s.at[1], s.at[2]] };
    if (s.yaw !== undefined) m.yaw = r3(-s.yaw);
    if (s.roll !== undefined) m.roll = r3(-s.roll);
    if (s.pivot) m.pivot = [r3(-s.pivot[0]), s.pivot[1], s.pivot[2]];
    if (s.role) m.role = s.role.replace(/\.(l|r)$/, (_, x) => x === 'l' ? '.r' : '.l').replace(/^leg\.f(l|r)$/, (_, x) => `leg.f${x === 'l' ? 'r' : 'l'}`).replace(/^leg\.b(l|r)$/, (_, x) => `leg.b${x === 'l' ? 'r' : 'l'}`);
    return m;
  });
}
