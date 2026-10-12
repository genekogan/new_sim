// The relation solver (spec 33 §2 row 4, 29 WP5): turns "near the pond, facing it", "against the
// cottage's north wall", "along the road at 30 %, left side, 3 m back", "inside house/kitchen, north-
// east corner", "on the table", "a row of 5 with 4 m gaps" into concrete poses (p, r, in, shape,
// constraints). Pure: it reads a mirror view (lib/mirror.mjs) and a description of the thing to
// place (its baked box), and returns candidates in preference order with a note of what it did.
// The CLI dry-runs the first candidate on the server and walks down the list on refusal.
//
// Frame: metres; +x east, +z south; yaw about +y with a thing's front facing +z at yaw 0, so the
// yaw that faces (dx, dz) is atan2(dx, dz). North is −z.

export const COMPASS = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0], ne: [Math.SQRT1_2, -Math.SQRT1_2], nw: [-Math.SQRT1_2, -Math.SQRT1_2], se: [Math.SQRT1_2, Math.SQRT1_2], sw: [-Math.SQRT1_2, Math.SQRT1_2] };
const WORDS = { north: 'n', south: 's', east: 'e', west: 'w', northeast: 'ne', northwest: 'nw', southeast: 'se', southwest: 'sw' };
export const compassKey = (w) => { const k = String(w ?? '').toLowerCase().replace(/[^a-z]/g, ''); return COMPASS[k] ? k : WORDS[k] ?? null; };
export const yawOf = (dx, dz) => Math.atan2(dx, dz);
export const dirOfYaw = (y) => [Math.sin(y), Math.cos(y)];
export const compassOfYaw = (y) => ['s', 'se', 'e', 'ne', 'n', 'nw', 'w', 'sw'][Math.round((((y % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 4)) % 8];
const r2 = (v) => Math.round(v * 100) / 100;
/** An owner's reference flag (core/flag, dropped with `flag` or Alt+click) — not a flagpole or anything else named flag-something. */
export const isFlagDef = (def) => /^core[-/]flag@/.test(String(def ?? ''));
const rot = (yaw, x, z) => { const c = Math.cos(yaw), s = Math.sin(yaw); return [x * c + z * s, -x * s + z * c]; };     // local → world
const unrot = (yaw, x, z) => { const c = Math.cos(yaw), s = Math.sin(yaw); return [x * c - z * s, x * s + z * c]; };    // world → local
const norm = ([x, z]) => { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; };

// ---------------------------------------------------------------- references

/** A reference → a point (and what it is): "x,z", a compass word (a region of the world), "centre",
 *  an entity path/id, "flag:<name>". `offset` "dx,dz" is added. */
export function refPoint(v, spec, offset) {
  if (spec === undefined || spec === null || spec === true) throw new Error('a reference is missing (x,z | path | flag:<name> | n/e/s/w)');
  let out;
  const s = String(spec);
  if (/^-?\d/.test(s)) { const [x, z] = s.split(',').map(Number); if (!Number.isFinite(x) || !Number.isFinite(z)) throw new Error(`bad point ${s}`); out = { x, z, kind: 'point' }; }
  else if (s === 'centre' || s === 'center' || s === 'origin') out = { x: 0, z: 0, kind: 'point' };
  else if (compassKey(s) && !v.get(s)) { const d = COMPASS[compassKey(s)]; const k = v.extent * 0.32; out = { x: r2(d[0] * k), z: r2(d[1] * k), kind: 'region', word: compassKey(s) }; }
  else {
    const row = v.get(s) ?? setOf(v, s);
    if (!row) throw new Error(`no such reference: ${s} (see: map, flags)`);
    out = { ...centreOf(row), kind: 'entity', row, ref: row.path, ...(row.members ? { members: row.members.map((r) => r.id) } : {}) };
  }
  if (offset) { const [dx, dz] = String(offset).split(',').map(Number); out = { ...out, x: r2(out.x + dx), z: r2(out.z + dz) }; }
  return out;
}
/** A set made by --row/--grid/--count with --name stall: stall-1, stall-2, … (same parent). Referred to by the
 *  bare name, it acts as one thing whose footprint is the union of its members'. Null if there is none. */
export function setOf(v, name) {
  const s = String(name ?? '').replace(/^flag:/, ''); const cut = s.lastIndexOf('/');
  const parentPath = cut > 0 ? s.slice(0, cut) : null, stem = cut > 0 ? s.slice(cut + 1) : s;
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(stem)) return null;
  const parent = parentPath ? v.get(parentPath) : null; if (parentPath && !parent) return null;
  const re = new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+$`);
  const members = v.rows.filter((r) => r.name && re.test(r.name) && (parent ? r.parent === parent.id : true));
  if (members.length < 2) return null;
  const pid = members[0].parent; const same = members.filter((r) => r.parent === pid);
  if (same.length < 2) return null;
  const x0 = Math.min(...same.map((r) => r.aabb[0])), z0 = Math.min(...same.map((r) => r.aabb[1])), x1 = Math.max(...same.map((r) => r.aabb[2])), z1 = Math.max(...same.map((r) => r.aabb[3]));
  return { id: `set:${s}`, path: s, name: stem, set: true, members: same, parent: pid, def: same[0].def, form: 'set', layer: 'set', tags: [], aabb: [x0, z0, x1, z1], pose: [r2((x0 + x1) / 2), same[0].pose[1], r2((z0 + z1) / 2), 0, 1], box: [x1 - x0, 0, z1 - z0], y: same[0].y };
}
export function centreOf(row) {
  if (row.shape?.area) { const a = row.shape.area; let x = 0, z = 0; for (const p of a) { x += p[0]; z += p[1]; } return { x: r2(x / a.length), z: r2(z / a.length), y: row.pose[1], yaw: 0 }; }
  if (row.shape?.path) { const p = pointAlong(row.shape.path, 0.5).p; return { x: r2(p[0]), z: r2(p[1]), y: row.pose[1], yaw: 0 }; }
  return { x: row.pose[0], z: row.pose[2], y: row.pose[1], yaw: row.pose[3] };
}
/** The footprint of a row as an oriented box {c, half, yaw}: point forms use box × scale at the pose; shapes use their bounds. */
export function boxOf(row) {
  if (row.form === 'point' && !row.shape) return { c: [row.pose[0], row.pose[2]], half: [row.box[0] * row.pose[4] / 2, row.box[2] * row.pose[4] / 2], yaw: row.pose[3] };
  const [x0, z0, x1, z1] = row.aabb; return { c: [(x0 + x1) / 2, (z0 + z1) / 2], half: [(x1 - x0) / 2, (z1 - z0) / 2], yaw: 0 };
}
/** Half-extent of an oriented box along a unit direction (its support distance). */
export const extentAlong = (b, u) => { const X = [Math.cos(b.yaw), -Math.sin(b.yaw)], Z = [Math.sin(b.yaw), Math.cos(b.yaw)]; return b.half[0] * Math.abs(u[0] * X[0] + u[1] * X[1]) + b.half[1] * Math.abs(u[0] * Z[0] + u[1] * Z[1]); };

// ---------------------------------------------------------------- paths

/** Distance from c along unit u to where the ray leaves polygon poly (0 if c is outside). */
export function rayExit(poly, c, u) {
  let best = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j], [bx, bz] = poly[i], ex = bx - ax, ez = bz - az;
    const den = u[0] * ez - u[1] * ex; if (Math.abs(den) < 1e-12) continue;
    const t = ((ax - c[0]) * ez - (az - c[1]) * ex) / den, s = ((ax - c[0]) * u[1] - (az - c[1]) * u[0]) / den;
    if (t > 0 && s >= 0 && s <= 1) best = Math.max(best, t);
  }
  return best;
}
/** The nearest point of a polyline to q: { p, t (0…1 of its length), d }. */
export function nearestOnPath(path, q) {
  const L = polylineLength(path) || 1; let best = { p: path[0], t: 0, d: Infinity }, run = 0;
  for (let i = 1; i < path.length; i++) {
    const [ax, az] = path[i - 1], [bx, bz] = path[i], ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez, len = Math.sqrt(l2);
    const k = l2 ? Math.max(0, Math.min(1, ((q[0] - ax) * ex + (q[1] - az) * ez) / l2)) : 0;
    const p = [ax + ex * k, az + ez * k], d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d < best.d) best = { p, t: (run + len * k) / L, d };
    run += len;
  }
  return best;
}
export function polylineLength(path) { let l = 0; for (let i = 1; i < path.length; i++) l += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); return l; }
export function pointAlong(path, t) {
  const total = polylineLength(path); let want = Math.min(1, Math.max(0, t)) * total;
  for (let i = 1; i < path.length; i++) {
    const [ax, az] = path[i - 1], [bx, bz] = path[i], len = Math.hypot(bx - ax, bz - az);
    if (want <= len || i === path.length - 1) { const k = len ? Math.min(1, want / len) : 0; return { p: [ax + (bx - ax) * k, az + (bz - az) * k], dir: len ? [(bx - ax) / len, (bz - az) / len] : [1, 0] }; }
    want -= len;
  }
  return { p: path[0], dir: [1, 0] };
}
/** Left of a path = the walker's left going from its first point to its last (north when walking east). */
export const leftOf = (dir) => [dir[1], -dir[0]];
/** The compiler (compile.ts `along`) and query.ts use the walker's side since L7 patch P2, so labels pass
 *  through unchanged. True would translate for a server that still uses offsetPolyline's sign. */
export const SERVER_SIDE_MIRRORED = false;
const serverSide = (side) => (SERVER_SIDE_MIRRORED && side === 'left' ? 'right' : SERVER_SIDE_MIRRORED && side === 'right' ? 'left' : side);

// ---------------------------------------------------------------- overlap (local pre-check; the server decides)

function corners(b) { const c = Math.cos(b.yaw), s = Math.sin(b.yaw); return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [b.c[0] + i * b.half[0] * c + j * b.half[1] * s, b.c[1] - i * b.half[0] * s + j * b.half[1] * c]); }
export function obbHit(a, b, margin = 0) {
  const A = { ...a, half: [a.half[0] + margin, a.half[1] + margin] };
  const axes = [[Math.cos(A.yaw), -Math.sin(A.yaw)], [Math.sin(A.yaw), Math.cos(A.yaw)], [Math.cos(b.yaw), -Math.sin(b.yaw)], [Math.sin(b.yaw), Math.cos(b.yaw)]];
  const ca = corners(A), cb = corners(b);
  for (const [ax, az] of axes) {
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [x, z] of ca) { const p = x * ax + z * az; a0 = Math.min(a0, p); a1 = Math.max(a1, p); }
    for (const [x, z] of cb) { const p = x * ax + z * az; b0 = Math.min(b0, p); b1 = Math.max(b1, p); }
    if (a1 <= b0 + 1e-6 || b1 <= a0 + 1e-6) return false;
  }
  return true;
}
/** Which solid rows a box would touch (by their real collider boxes). `skip` ids are exempt. */
export function blockers(v, box, skip = new Set(), margin = 0.05) {
  const out = [];
  const r = Math.hypot(box.half[0], box.half[1]) + margin;
  for (const row of v.rows) {
    if (row.layer !== 'solid' || !row.obbs || skip.has(row.id)) continue;
    const [x0, z0, x1, z1] = row.aabb;
    if (box.c[0] + r < x0 || box.c[0] - r > x1 || box.c[1] + r < z0 || box.c[1] - r > z1) continue;
    // furniture and props keep their whole footprint clear (a chair is not placed between a table's legs); buildings
    // (walls with rooms inside) and plants (a bench under a tree's crown) keep only their colliders
    const whole = row.form === 'point' && !(row.slots ?? []).some((x) => x.kind === 'room') && !(row.tags ?? []).some((t) => t === 'plant' || t === 'tree');
    if (whole ? obbHit(box, boxOf(row), margin) : row.obbs.some(([cx, cz, hx, hz, yaw]) => obbHit(box, { c: [cx, cz], half: [hx, hz], yaw }, margin))) out.push(row.path);
  }
  return out;
}

// ---------------------------------------------------------------- the solver

/**
 * solve(v, thing, rel) → { candidates: [{ p, r, in?, shape?, constraints?, anchor?, note }...], group?: [[...], ...], notes }
 * thing: { def, form, layer, box: [w, h, d], s?, water? }
 * rel: { at, offset, near, dist, dir, count, facing, against, between: [a, b], along, t, side, setback,
 *        inside, corner, wall, on, row, grid, gap, float, yaw, from, to, via }
 * For multiples (count/row/grid) every element gets its own candidate list: result.items[k].candidates.
 */
export function solve(v, thing, rel) {
  const s = thing.s ?? 1, hw = (thing.box[0] * s) / 2, hd = (thing.box[2] * s) / 2;
  const notes = [];
  const mine = (x, z, yaw) => ({ c: [x, z], half: [hw, hd], yaw });
  const skip = new Set(rel.skip ?? []);
  const solid = thing.layer === 'solid';
  const free = (x, z, yaw) => !solid || blockers(v, mine(x, z, yaw), skip).length === 0;
  const baseYaw = rel.yaw !== undefined ? Number(rel.yaw) : undefined;
  const constraints = [];
  if (rel.float) constraints.push({ kind: 'float', sink: 0 });

  // facing: a ref (persistent constraint), a compass word, or a point
  const faceAt = (x, z) => {
    if (rel.facing === undefined) return undefined;
    const f = String(rel.facing);
    const away = f.startsWith('away:');
    const key = compassKey(away ? f.slice(5) : f);
    if (key && !v.get(f)) { const d = COMPASS[key]; return yawOf(away ? -d[0] : d[0], away ? -d[1] : d[1]); }
    const t = refPoint(v, away ? f.slice(5) : f);
    const y = yawOf(t.x - x, t.z - z);
    return away ? y + Math.PI : y;
  };
  const facingConstraint = () => {
    if (rel.facing === undefined) return [];
    const f = String(rel.facing); if (f.startsWith('away:')) { const row = v.get(f.slice(5)); return row ? [{ kind: 'facing', ref: row.path, offset: Math.PI }] : []; }
    const row = !compassKey(f) || v.get(f) ? v.get(f) : null;
    // the compiler aims at the ref's pose; area/path things have no pose of their own (yaw only, no constraint)
    // the compiler aims at a point thing's pose, an area's centroid, a path's midpoint (L7 patch P3, in since 8c1c497d)
    return row ? [{ kind: 'facing', ref: row.path, offset: 0 }] : [];
  };
  const pose = (x, z, yaw, extra = {}) => ({ ...extra, p: [r2(x), r2(z)], ...(yaw !== undefined ? { r: r2(yaw) } : {}), constraints: [...constraints, ...facingConstraint(), ...(extra.constraints ?? [])] });
  const finalYaw = (x, z, fallback) => { const f = faceAt(x, z); return f !== undefined ? f : baseYaw !== undefined ? baseYaw : fallback; };

  // ---- path/area forms: from/to/via, between → a shape, not a pose
  if (thing.form === 'path' && (rel.from || rel.between)) {
    const [a, b] = rel.between ?? [rel.from, rel.to];
    let A = refPoint(v, a), B = refPoint(v, b);
    // a compass word as a path end means the world's edge that way, straight from the other end ("a river to the south edge")
    const toEdge = (P, Q) => { if (P.kind !== 'region') return P; const d = norm(COMPASS[P.word]), h = v.extent / 2 - 2; const k = Math.min(...[0, 1].map((i) => (Math.abs(d[i]) < 1e-9 ? Infinity : ((Math.sign(d[i]) * h) - (i ? Q.z : Q.x)) / d[i]))); return { x: r2(Q.x + d[0] * k), z: r2(Q.z + d[1] * k), kind: 'point', ref: `the ${P.word} edge` }; };
    if (A.kind === 'region' && B.kind !== 'region') A = toEdge(A, B); else if (B.kind === 'region') B = toEdge(B, A.kind === 'region' ? { x: 0, z: 0 } : A);
    // ends at the refs' edges, never their centres: a building's door (1 m out of it, the door nearest the other
    // end), a point thing's footprint edge (+1 m), an area's boundary toward the other end (+1 m out; water areas:
    // 1 m in, so a river joins its lake), the nearest point of a road/river/path (a bridge or pier: its nearer end)
    const ENDS_ONLY = /bridge|pier|deck|dock|jetty/;
    const approach = (P) => [P.x, P.z];
    const edge = (P, Q) => {
      if (P.kind !== 'entity') return [P.x, P.z];
      const sh = P.row.shape;
      if (sh?.path) {
        const a = sh.path[0], b = sh.path[sh.path.length - 1];
        const nearerEnd = () => (Math.hypot(a[0] - Q.x, a[1] - Q.z) <= Math.hypot(b[0] - Q.x, b[1] - Q.z) ? [r2(a[0]), r2(a[1])] : [r2(b[0]), r2(b[1])]);
        if (ENDS_ONLY.test(v.def?.(P.row.def)?.ref ?? P.row.def)) return nearerEnd();
        const q = nearestOnPath(sh.path, [Q.x, Q.z]);
        if (Math.hypot(q.p[0] - a[0], q.p[1] - a[1]) < 3 || Math.hypot(q.p[0] - b[0], q.p[1] - b[1]) < 3) return nearerEnd();
        // join a road at its edge (half a metre in), a river at its middle
        const inset = P.row.layer === 'surface' ? Math.max(0, (sh.width ?? 4) / 2 - 0.5) : 0, u = norm([Q.x - q.p[0], Q.z - q.p[1]]);
        return [r2(q.p[0] + u[0] * inset), r2(q.p[1] + u[1] * inset)];
      }
      const doors = (P.row.doors ?? []).filter((d) => d.out && (d.level ?? 0) === 0);
      if (doors.length) { const d = doors.slice().sort((x, y) => Math.hypot(x.at[0] - Q.x, x.at[1] - Q.z) - Math.hypot(y.at[0] - Q.x, y.at[1] - Q.z))[0]; const f = dirOfYaw(d.yaw); doorUsed.set(P.row.path, d.id); return [r2(d.at[0] + f[0]), r2(d.at[1] + f[1])]; }
      const u = norm([Q.x - P.x, Q.z - P.z]);
      if (sh?.area) { const k = rayExit(sh.area, [P.x, P.z], u); const wet = P.row.layer === 'volume' || P.row.water !== undefined && P.row.water !== null; const d = k + (wet ? -1 : 1); return [r2(P.x + u[0] * d), r2(P.z + u[1] * d)]; }
      const e = extentAlong(boxOf(P.row), u) + 1; return [r2(P.x + u[0] * e), r2(P.z + u[1] * e)];
    };
    const doorUsed = new Map();
    const via = rel.via ? [].concat(rel.via).map((x) => { const p = refPoint(v, x); return [p.x, p.z]; }) : [];
    // the end that is not a path first (a house's door toward the road), then the path's nearest point to it
    const asQ = ([x, z]) => ({ x, z });
    const isPath = (P) => P.kind === 'entity' && !!P.row.shape?.path;
    const towardA = via.length ? asQ(via[0]) : null, towardB = via.length ? asQ(via.at(-1)) : null;
    let pa, pb;
    if (isPath(A) && !isPath(B)) { pb = edge(B, towardB ?? asQ(isPath(A) ? nearestOnPath(A.row.shape.path, approach(B)).p : approach(A))); pa = edge(A, towardA ?? asQ(pb)); }
    else { pa = edge(A, towardA ?? asQ(isPath(B) ? nearestOnPath(B.row.shape.path, approach(A)).p : approach(B))); pb = edge(B, towardB ?? asQ(pa)); }
    const path = [pa, ...via, pb];
    for (const [ref, id] of doorUsed) notes.push(`starts at ${ref}'s door ${id}`);
    notes.push(`path from ${A.ref ?? a} to ${B.ref ?? b}${via.length ? ` via ${via.length} point(s)` : ''}, ${r2(polylineLength(path))} m`);
    return { items: [{ candidates: [{ shape: { path, ...(rel.width ? { width: Number(rel.width) } : {}) }, note: notes.at(-1) }] }], notes };
  }

  // ---- across a path (a bridge over a river, a gate across a road): perpendicular at t
  if (rel.across) {
    const host = v.get(rel.across); if (!host) throw new Error(`no such path: ${rel.across}`);
    const path = host.shape?.path; if (!path) throw new Error(`${host.path} is not a path`);
    const t = rel.t !== undefined ? Number(rel.t) : 0.5;
    const { p, dir } = pointAlong(path, t), nrm = leftOf(dir);
    const half = (host.shape.width ?? 4) / 2 + Number(rel.span ?? 3);
    if (thing.form === 'path') {
      const a = [r2(p[0] - nrm[0] * half), r2(p[1] - nrm[1] * half)], b = [r2(p[0] + nrm[0] * half), r2(p[1] + nrm[1] * half)];
      return { items: [{ candidates: [{ shape: { path: [a, b], ...(rel.width ? { width: Number(rel.width) } : {}) }, note: `across ${host.path} at ${Math.round(t * 100)}%, ${r2(2 * half)} m long` }] }], notes };
    }
    return { items: [{ candidates: [pose(p[0], p[1], finalYaw(p[0], p[1], yawOf(nrm[0], nrm[1])), { note: `across ${host.path} at ${Math.round(t * 100)}%` })] }], notes };
  }

  // ---- on: a surface slot of a table, shelf, counter; several things spread over the top, clear of what is there
  if (rel.on) {
    const T = slotTarget(v, rel.on);
    if (!T) throw new Error(`no such thing to put it on: ${rel.on}`);
    const host = T.host;
    if (T.slot?.kind === 'room') return solve(v, thing, { ...rel, on: undefined, inside: rel.on });
    const listing = () => (host.slots ?? []).filter((x) => x.kind !== 'wall').map((x) => `${x.id}:${x.kind} ${x.used}/${x.capacity}`).join(', ') || 'none';
    // a named slot (pier/end, lighthouse/balcony), else the host's tops (surface, shelf), else where one stands on it
    // (a pier's end platform, a deck, a porch or balcony; never a building's whole storey floors)
    const open = (x) => x.used < x.capacity;
    let slots = T.slot ? [T.slot].filter(open) : (host.slots ?? []).filter((x) => ['surface', 'shelf'].includes(x.kind) && open(x));
    if (!T.slot && !slots.length) slots = (host.slots ?? []).filter((x) => (['stand', 'deck'].includes(x.kind) || (x.kind === 'floor' && !/^(ground|floor-\d+)$/.test(x.id))) && open(x));
    if (T.slot && !slots.length) throw new Error(`${host.path}/${T.slot.id} is full (${T.slot.used}/${T.slot.capacity})`);
    if (!slots.length) throw new Error(`${host.path} has no free slot to put things on (slots: ${listing()}); name one with --on ${host.path}/<slot>`);
    const n = Number(rel.count ?? 1);
    const items = [];
    for (const sl of slots.filter((x) => !['surface', 'shelf'].includes(x.kind))) {
      // stand/deck/floor slots: the slot origin, then steps sideways along the slot (a row across the pier end)
      if (items.length >= n) break;
      const F = frameOf(host, sl.id);
      const there = v.rows.filter((r) => r.parent === host.id && r.slot === sl.id && !skip.has(r.id)).map((r) => { const e = v.entity?.(r.id); const p = e?.p ?? [0, 0]; return [p[0], p[p.length - 1]]; });
      const sep = Math.max(hw, hd) * 2 + 0.3, side = rot(F.RY - F.PY, 1, 0);
      const offs = [0, 1, -1, 2, -2, 3, -3, 4, -4].map((k) => [r2(side[0] * k * sep) + 0, r2(side[1] * k * sep) + 0]).filter(([x, z]) => Math.hypot(x, z) <= 3.6);
      for (let k = 0; k < sl.capacity - sl.used && items.length < n; k++) {
        const q = offs.find(([x, z]) => there.every(([a, b]) => Math.hypot(a - x, b - z) >= sep * 0.9));
        if (!q) { notes.push(`${host.path}/${sl.id} has no more room for things this size`); break; }
        there.push(q);
        const [wx, wz] = toWorldIn(F, q[0], q[1]);
        const f = faceAt(wx, wz), yaw = f !== undefined ? f : baseYaw;
        items.push({ candidates: [{ in: { parent: host.path, slot: sl.id }, p: q, ...(yaw !== undefined ? { r: r2(yaw - F.RY) } : {}), constraints: [...constraints, ...facingConstraint()], note: `on ${host.path}/${sl.id}` }] });
      }
    }
    for (const sl of slots.filter((x) => ['surface', 'shelf'].includes(x.kind))) {
      if (items.length >= n) break;
      const F = frameOf(host, sl.id), HF = frameOf(host);
      const [ox, oz] = toLocal(HF, F.O[0], F.O[1]);           // the slot origin in the host's frame
      const hx = (host.box?.[0] ?? 1) / 2 - 0.06, hz = (host.box?.[2] ?? 1) / 2 - 0.06;
      const sep = Math.max(hw, hd) * 2 + 0.06;
      // what already stands there (in the slot frame); things placed without p sit at the slot origin
      const there = v.rows.filter((r) => r.parent === host.id && r.slot === sl.id && !skip.has(r.id)).map((r) => { const e = v.entity?.(r.id); const p = e?.p ?? [0, 0]; return [p[0], p[p.length - 1]]; });
      const lattice = [];
      for (let i = -8; i <= 8; i++) for (let j = -8; j <= 8; j++) { const lx = i * 0.06, lz = j * 0.06; if (Math.abs(ox + lx) + hw > hx + 0.04 || Math.abs(oz + lz) + hd > hz + 0.04) continue; lattice.push([lx, lz]); }
      const free = sl.capacity - sl.used;
      const want = Math.min(free, n - items.length);
      if (!there.length && want > 1) {
        // an empty top and several things: evenly round the middle (a pair faces across the table)
        const rr = Math.max(0, Math.min(hx - hw, hz - hd, 0.12 + 0.06 * want));
        for (let k = 0; k < want; k++) { const a = (2 * Math.PI * k) / want + Math.PI / 2; const q = [r2(Math.sin(a) * rr * (hx >= hz ? 1 : 0.6)), r2(Math.cos(a) * rr * (hz > hx ? 1 : 0.6))]; there.push(q); items.push({ candidates: [{ in: { parent: host.path, slot: sl.id }, p: q, constraints, note: `on ${host.path} (slot ${sl.id})` }] }); }
        continue;
      }
      for (let k = 0; k < free && items.length < n; k++) {
        // the lattice point farthest from everything there (the centre when the top is empty)
        let best = null, bestD = -1;
        for (const [lx, lz] of lattice) { const d = there.length ? Math.min(...there.map(([a, b]) => Math.hypot(a - lx, b - lz))) : 10 - Math.hypot(lx, lz); if (d > bestD + 1e-9) { bestD = d; best = [lx, lz]; } }
        if (!best || (there.length && bestD < sep * 0.75)) { notes.push(`${host.path}'s ${sl.id} is full for things this size`); break; }
        there.push(best);
        items.push({ candidates: [{ in: { parent: host.path, slot: sl.id }, p: [r2(best[0]), r2(best[1])], constraints, note: `on ${host.path} (slot ${sl.id})` }] });
      }
    }
    if (items.length < n) notes.push(`only ${items.length} free places on ${host.path}`);
    if (!items.length) throw new Error(`no room left on ${host.path}`);
    return { items, notes };
  }

  // ---- inside: a room of a building (house/room), optionally against a wall or in a corner
  if (rel.inside) {
    const spec = String(rel.inside);
    let host = v.get(spec), roomId = null;
    if (!host || !(host.slots ?? []).some((x) => x.kind === 'room')) {
      const cut = spec.lastIndexOf('/');
      if (cut > 0 && v.get(spec.slice(0, cut))) { host = v.get(spec.slice(0, cut)); roomId = spec.slice(cut + 1); }
    }
    if (!host) throw new Error(`no such building: ${spec}`);
    // a slot that is not a room (pier/end, lighthouse/balcony, house/porch): things stand on it
    if (roomId) { let T = null; try { T = slotTarget(v, spec); } catch { /* not a slot: a room word */ } if (T?.slot && T.slot.kind !== 'room') return solve(v, thing, { ...rel, inside: undefined, on: spec }); }
    const rooms = (host.slots ?? []).filter((x) => x.kind === 'room');
    if (!rooms.length) throw new Error(`${host.path} has no rooms (it is not a building); use --near or --on`);
    // a room by id, else by a word of it (bedroom → bedroom-1, bed → bedroom-2): the first match in the building's order
    const bare = (t) => String(t).toLowerCase().replace(/[^a-z]/g, '');
    const room = !roomId ? rooms[0] : rooms.find((x) => x.id === roomId) ?? rooms.find((x) => bare(x.id) === bare(roomId) || (x.name && bare(x.name) === bare(roomId))) ?? rooms.find((x) => bare(x.id).startsWith(bare(roomId)) || bare(roomId).startsWith(bare(x.id)) || (x.name && bare(x.name).includes(bare(roomId))));
    if (!room) throw new Error(`${host.path} has no room ${roomId}; rooms: ${rooms.map((x) => x.id).join(', ')}`);
    return solveInRoom(v, host, room, thing, rel, { hw, hd, solid, skip, constraints, faceAt, facingConstraint, baseYaw, notes });
  }

  // ---- along a path entity (road, river, wall): at t, a side and a setback; rows step along it
  if (rel.along) {
    const host = v.get(rel.along); if (!host) throw new Error(`no such path: ${rel.along}`);
    const path = host.shape?.path; if (!path) throw new Error(`${host.path} is not a path (it has no shape.path)`);
    const L = polylineLength(path), pw = (host.shape.width ?? host.box?.[0] ?? 4) / 2;
    const sides = rel.side === 'both' ? ['left', 'right'] : [rel.side ?? 'center'];
    const want = Number(rel.row ?? rel.count ?? 1);
    // --spacing: centre to centre; --gap: clear space between neighbours (edge to edge)
    const step = (rel.spacing !== undefined ? Number(rel.spacing) : 2 * hw + (rel.gap !== undefined ? Number(rel.gap) : 4)) / L;
    const tStart = rel.t !== undefined ? Number(rel.t) : null;
    // a row never piles up at the end of the path: only what fits between 2 % and 98 % is placed
    const room = tStart !== null ? 0.98 - tStart : 0.96;
    const n = want > 1 ? Math.max(1, Math.min(want, Math.floor(room / step + 1e-9) + 1)) : want;
    if (n < want) notes.push(`only ${n} of ${want} fit along ${host.path} at ${r2(step * L)} m apart (${r2(L)} m long); pass a smaller --spacing/--gap for more`);
    const t0 = tStart !== null ? tStart : n > 1 ? Math.max(0.02, 0.5 - (step * (n - 1)) / 2) : 0.5;
    const items = [];
    for (const side of sides) for (let k = 0; k < n; k++) {
      const t = Math.min(0.98, t0 + k * step);
      const { p, dir } = pointAlong(path, t);
      const left = leftOf(dir), sg = side === 'left' ? 1 : side === 'right' ? -1 : 0;
      const off = sg ? pw + hd + Number(rel.setback ?? rel.offset ?? 1) : 0;
      const x = p[0] + left[0] * sg * off, z = p[1] + left[1] * sg * off;
      const along = yawOf(dir[0], dir[1]);
      const yaw = finalYaw(x, z, sg ? yawOf(-left[0] * sg, -left[1] * sg) : along);
      const cands = [];
      // if blocked, slide a little along the path
      for (const dt of [0, 0.5, -0.5, 1, -1, 2, -2].map((m) => (m * (2 * hw + 1)) / L)) {
        const tt = Math.min(1, Math.max(0, t + dt)); const q = pointAlong(path, tt); const lf = leftOf(q.dir);
        const xx = q.p[0] + lf[0] * sg * off, zz = q.p[1] + lf[1] * sg * off;
        if (dt !== 0 && !free(xx, zz, yaw)) continue;
        cands.push(pose(xx, zz, yaw, { constraints: [{ kind: 'along', ref: host.path, t: r2(tt), side: serverSide(side), offset: r2(sg ? off - pw : 0) }], note: `along ${host.path} at ${Math.round(tt * 100)}%${sg ? `, ${side} side, ${r2(off - pw - hd)} m back from the edge` : ''}` }));
      }
      items.push({ candidates: cands });
    }
    notes.push(`${items.length} along ${host.path} (${r2(L)} m long, ${r2(2 * pw)} m wide)`);
    return { items, notes };
  }

  // ---- against a thing's side: back flush to it, front facing away
  if (rel.against) {
    const [refS, sideS] = String(rel.against).split(/\.(?=[a-z]+$)/);
    const host = v.get(refS) ?? v.get(String(rel.against)); if (!host) throw new Error(`no such thing: ${refS}`);
    const hb = boxOf(host);
    let u;
    if (sideS && compassKey(sideS)) u = COMPASS[compassKey(sideS)];
    else { const back = dirOfYaw(hb.yaw + Math.PI); u = back; }
    // snap to the host's nearest face normal
    const faces = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => rot(hb.yaw, a, b));
    const nrm = faces.sort((a, b) => (b[0] * u[0] + b[1] * u[1]) - (a[0] * u[0] + a[1] * u[1]))[0];
    const yaw = finalYaw(0, 0, yawOf(nrm[0], nrm[1]));
    const meB = mine(0, 0, yaw);
    const dist = extentAlong(hb, nrm) + extentAlong(meB, nrm) + Number(rel.gap ?? 0.05);
    const n = Number(rel.count ?? rel.row ?? 1);
    const tang = [-nrm[1], nrm[0]];
    const myW = extentAlong(meB, tang) * 2, step = myW + Number(rel.gap ?? 0.3);
    const items = [];
    for (let k = 0; k < n; k++) {
      const off = (k - (n - 1) / 2) * step;
      const x = hb.c[0] + nrm[0] * dist + tang[0] * off, z = hb.c[1] + nrm[1] * dist + tang[1] * off;
      const cands = [];
      for (const slide of [0, 1, -1, 2, -2]) { const xx = x + tang[0] * slide * (myW + 0.3), zz = z + tang[1] * slide * (myW + 0.3); if (slide && !free(xx, zz, yaw)) continue; cands.push(pose(xx, zz, yaw, { note: `against ${host.path}'s ${compassOfYaw(yawOf(nrm[0], nrm[1]))} side${slide ? ' (slid along it)' : ''}`, constraints: [{ kind: 'near', ref: host.path, dist: 0.5 }] })); }
      items.push({ candidates: cands });
    }
    return { items, notes };
  }

  // ---- between a and b (point forms): the midpoint, its width along a→b
  if (rel.between) {
    const [A, B] = rel.between.map((x) => refPoint(v, x));
    const x = (A.x + B.x) / 2, z = (A.z + B.z) / 2;
    const yaw = finalYaw(x, z, Math.atan2(-(B.z - A.z), B.x - A.x));
    return { items: [{ candidates: [pose(x, z, yaw, { note: `between ${A.ref ?? rel.between[0]} and ${B.ref ?? rel.between[1]}` })] }], notes };
  }

  // ---- near / around a ref: rings outside its footprint, preferred direction first
  if (rel.near || rel.around) {
    const R = refPoint(v, rel.near ?? rel.around);
    const rb = R.kind === 'entity' ? boxOf(R.row) : { c: [R.x, R.z], half: [0, 0], yaw: 0 };
    const n = Number(rel.count ?? 1);
    if (R.kind === 'entity') skip.add(R.row.id);
    for (const id of R.members ?? []) skip.add(id);
    const shapeOf = R.kind === 'entity' ? R.row.shape : null;
    // beside a path (a road, a river): perpendicular to it, spread along it, on the --dir side (else the left)
    if (shapeOf?.path) {
      const path = shapeOf.path, pw = (shapeOf.width ?? 4) / 2, gap = rel.dist !== undefined ? Number(rel.dist) : 1.5;
      const items = [];
      for (let k = 0; k < n; k++) {
        const t = rel.t !== undefined ? Number(rel.t) : n > 1 ? 0.1 + (0.8 * k) / (n - 1) : 0.5;
        const { p, dir } = pointAlong(path, t), left = leftOf(dir);
        const want = rel.dir && compassKey(rel.dir) ? COMPASS[compassKey(rel.dir)] : left;
        const sg = left[0] * want[0] + left[1] * want[1] >= 0 ? 1 : -1;
        const cands = [];
        for (const extra of [0, 1, 2.5, 5]) {
          const y1 = finalYaw(p[0] + left[0] * sg * (pw + gap), p[1] + left[1] * sg * (pw + gap), baseYaw ?? yawOf(-left[0] * sg, -left[1] * sg)) ?? 0;
          const d = pw + extentAlong(mine(0, 0, y1), left) + gap + extra;
          const x = p[0] + left[0] * sg * d, z = p[1] + left[1] * sg * d;
          const c = pose(x, z, y1, { note: `beside ${R.ref} at ${Math.round(t * 100)}%, ${r2(gap + extra)} m from its edge`, constraints: [{ kind: 'near', ref: R.row.path, dist: r2(pw + gap + extra + 1) }] });
          if (free(x, z, y1) || !cands.length) cands.push(c);
        }
        items.push({ candidates: cands });
      }
      return { items, notes };
    }
    // around an area (a pond, a plaza): just outside its rim, not its bounding box
    const rim = shapeOf?.area ? (u) => rayExit(shapeOf.area, [R.x, R.z], u) : null;
    const gap = rel.dist !== undefined ? Number(rel.dist) : Math.max(1.5, Math.min(6, Math.max(hw, hd)));
    const start = rel.dir && compassKey(rel.dir) ? COMPASS[compassKey(rel.dir)] : R.kind === 'entity' && R.row.form === 'point' && !isFlagDef(v.def?.(R.row.def)?.ref ?? R.row.def) ? dirOfYaw(R.yaw) : COMPASS.s;
    const a0 = Math.atan2(start[0], start[1]);
    const items = [];
    const placed = [];
    // a building's outer doorways stay clear (as --inside keeps its inner ones): the step out of each ground-floor
    // door, 2.5 m deep and 0.35 m wider either side, takes nothing — a lantern goes beside the door, not in front of it
    const doorZones = R.kind === 'entity' ? (R.row.doors ?? []).filter((d) => d.out && (d.level ?? 0) === 0).map((d) => { const f = dirOfYaw(d.yaw); return { id: d.id, c: [d.at[0] + f[0] * 1.25, d.at[1] + f[1] * 1.25], half: [d.width / 2 + 0.35, 1.25], yaw: d.yaw }; }) : [];
    const inDoorway = (x, z, yaw) => doorZones.find((dz) => obbHit(mine(x, z, yaw), dz));
    let keptDoor = null;
    const isFree = (x, z, yaw) => { const dz = inDoorway(x, z, yaw); if (dz) { keptDoor = dz.id; return false; } return free(x, z, yaw) && !placed.some((b) => obbHit(mine(x, z, yaw), b, 0.1)); };
    for (let k = 0; k < n; k++) {
      const cands = [];
      // several around a thing with a front (a door): keep a 60° cone in front of it clear
      const fronted = n > 1 && R.kind === 'entity' && (R.row.slots ?? []).some((x) => x.kind === 'stand' || x.kind === 'door' || x.kind === 'room');
      const ak = fronted ? a0 + Math.PI / 6 + ((2 * Math.PI - Math.PI / 3) * k) / Math.max(1, n - 1) : a0 + (n > 1 ? (2 * Math.PI * k) / n : 0);
      const tries = n > 1 ? [0, 0.15, -0.15, 0.3, -0.3] : [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, (3 * Math.PI) / 4, (-3 * Math.PI) / 4, Math.PI];
      let fallback = null;
      for (const ring of [0, 2, 5, 10]) for (const da of tries) {
        if (cands.length >= 4) break;
        const a = ak + da, u = [Math.sin(a), Math.cos(a)];
        // two passes: the yaw at a rough spot, then the exact distance for that yaw
        const c0 = rim ? [R.x, R.z] : rb.c, out = rim ? rim(u) : extentAlong(rb, u);
        const d0 = out + Math.max(hw, hd) + gap + ring;
        const y1 = finalYaw(c0[0] + u[0] * d0, c0[1] + u[1] * d0, baseYaw) ?? 0;
        const d = out + extentAlong(mine(0, 0, y1), u) + gap + ring;
        const x = c0[0] + u[0] * d, z = c0[1] + u[1] * d;
        const fy = finalYaw(x, z, baseYaw);
        const c = pose(x, z, fy, { note: `near ${R.ref ?? rel.near ?? rel.around}, ${compassOfYaw(a)} of it, ${r2(gap + ring)} m away`, constraints: R.kind === 'entity' && !R.members ? [{ kind: 'near', ref: R.row.path, dist: r2(gap + ring + 1) }] : [] });
        if (!inDoorway(x, z, fy ?? 0)) fallback ??= c;
        if (isFree(x, z, fy ?? 0)) cands.push(c);
      }
      if (!cands.length && fallback) cands.push(fallback);
      if (cands.length >= 4) cands.length = 4;
      if (!cands.length) throw new Error(`no free place near ${R.ref ?? rel.near} within ${gap + 10} m; try --dist or --free`);
      const c0 = cands[0]; placed.push(mine(c0.p[0], c0.p[1], c0.r ?? 0));
      items.push({ candidates: cands });
    }
    if (keptDoor) notes.push(`kept ${R.ref}'s doorway ${keptDoor} clear`);
    return { items, notes };
  }

  // ---- at a point/ref (+ row / grid around it), or on water (float)
  const at = rel.at !== undefined ? refPoint(v, rel.at, rel.offset) : { x: 0, z: 0, kind: 'point' };
  if (at.kind === 'entity' && rel.float && at.row.shape?.area) {
    // float on a lake/pond: spread inside its polygon
    const poly = at.row.shape.area, n = Number(rel.count ?? 1);
    const items = [], placed = [];
    const spacing = Math.max(1.2, 2 * Math.max(hw, hd) + 0.6);
    for (let ring = 0, k = 0; ring < 40 && items.length < n; ring++) for (let j = 0; j < Math.max(1, ring * 6) && items.length < n; j++, k++) {
      const a = (j / Math.max(1, ring * 6)) * 2 * Math.PI + ring * 0.7, x = at.x + Math.sin(a) * ring * spacing, z = at.z + Math.cos(a) * ring * spacing;
      if (!inPoly(x, z, poly) || placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < spacing)) continue;
      placed.push([x, z]);
      const yaw = finalYaw(x, z, baseYaw ?? (k * 2.4) % (2 * Math.PI));
      items.push({ candidates: [pose(x, z, yaw, { anchor: 'float', note: `floating on ${at.row.path}` })] });
    }
    return { items, notes };
  }
  if (at.kind === 'entity') skip.add(at.row.id);
  const yaw = finalYaw(at.x, at.z, baseYaw);
  const y0 = yaw ?? 0;
  const X = [Math.cos(y0), -Math.sin(y0)], Z = [Math.sin(y0), Math.cos(y0)];
  const gap = Number(rel.gap ?? 2);
  let cells = [[0, 0]];
  if (rel.row) { const n = Number(rel.row); cells = Array.from({ length: n }, (_, k) => [(k - (n - 1) / 2) * (2 * hw + gap), 0]); }
  if (rel.grid) { const [gw, gh] = String(rel.grid).split(/[x×,]/).map(Number); cells = []; for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) cells.push([(i - (gw - 1) / 2) * (2 * hw + gap), (j - (gh - 1) / 2) * (2 * hd + gap)]); }
  const items = cells.map(([a, b]) => {
    const x = at.x + X[0] * a + Z[0] * b, z = at.z + X[1] * a + Z[1] * b;
    const fy = cells.length > 1 && rel.facing !== undefined ? finalYaw(x, z, yaw) : yaw;
    const where = at.kind === 'entity' ? `at ${at.ref}` : at.kind === 'region' ? `in the ${at.word} of the world` : `at (${r2(x)}, ${r2(z)})`;
    return { candidates: [pose(x, z, fy, { note: where + (rel.row ? ` (row of ${cells.length})` : rel.grid ? ` (grid ${rel.grid})` : ''), ...(rel.float ? { anchor: 'float' } : {}) })] };
  });
  return { items, notes };
}

export function inPoly(px, pz, poly) { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside; } return inside; }

// ---------------------------------------------------------------- shape helpers (terrain, areas)

/** "cx,cz,w,d" → rectangle polygon; "cx,cz,r[,n]" → n-gon (default 10) with a little seeded wobble so it reads natural. */
export function rectArea(spec) { const [cx, cz, w, d] = String(spec).split(',').map(Number); return [[cx - w / 2, cz - d / 2], [cx + w / 2, cz - d / 2], [cx + w / 2, cz + d / 2], [cx - w / 2, cz + d / 2]].map(([x, z]) => [r2(x), r2(z)]); }
export function circleArea(spec, wobble = 0.12) {
  const [cx, cz, r, n0] = String(spec).split(',').map(Number); const n = n0 || 10;
  let seed = Math.round(cx * 31 + cz * 17 + r * 7) | 0 || 1; const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) % 1000) / 1000; };
  return Array.from({ length: n }, (_, k) => { const a = (k / n) * 2 * Math.PI, rr = r * (1 - wobble / 2 + rnd() * wobble); return [r2(cx + Math.sin(a) * rr), r2(cz + Math.cos(a) * rr)]; });
}

// ---------------------------------------------------------------- frames: a parent's children live in its frame

/** The frame a parent gives its children (model.ts worldPose): origin = the slot's origin (or the parent's
 *  position); positions rotate by the parent's world yaw; a child's yaw adds to the slot's world yaw. */
export function frameOf(parent, slotId) {
  const sl = slotId ? (parent.slots ?? []).find((x) => x.id === slotId) ?? null : null;
  return { O: sl ? [sl.p[0], sl.p[2]] : [parent.pose[0], parent.pose[2]], PY: parent.pose[3] ?? 0, RY: sl ? sl.yaw : parent.pose[3] ?? 0, s: parent.pose[4] ?? 1, slot: sl };
}
export const toLocal = (F, wx, wz) => { const [x, z] = unrot(F.PY, wx - F.O[0], wz - F.O[1]); return [x / F.s, z / F.s]; };
export const toWorldIn = (F, lx, lz) => { const [dx, dz] = rot(F.PY, lx * F.s, lz * F.s); return [F.O[0] + dx, F.O[1] + dz]; };

/** "host" or "host/slot" → { host, slot|null }: the slot by id, else by a word of it (balcony, end). Null if no host. */
export function slotTarget(v, spec) {
  const s = String(spec ?? ''); const whole = v.get(s);
  if (whole) return { host: whole, slot: null };
  const cut = s.lastIndexOf('/'); if (cut <= 0) return null;
  const host = v.get(s.slice(0, cut)); if (!host) return null;
  const want = s.slice(cut + 1), bare = (t) => String(t).toLowerCase().replace(/[^a-z0-9]/g, '');
  const sl = (host.slots ?? []).find((x) => x.id === want) ?? (host.slots ?? []).find((x) => bare(x.id) === bare(want)) ?? (host.slots ?? []).find((x) => bare(x.id).startsWith(bare(want)));
  if (!sl) throw new Error(`${host.path} has no slot ${want}; its slots: ${(host.slots ?? []).filter((x) => x.kind !== 'wall').map((x) => `${x.id} (${x.kind})`).join(', ') || 'none'}`);
  return { host, slot: sl };
}
/** The room (of any building) a world point is in: { host, slot } candidates, the given floor first. */
export function roomsAt(v, wx, wz, exclude = new Set()) {
  const out = [];
  for (const r of v.rows) { if (exclude.has(r.id)) continue; for (const sl of r.slots ?? []) if (sl.kind === 'room' && sl.polygon && inPoly(wx, wz, sl.polygon)) out.push({ host: r, slot: sl }); }
  return out;
}
/** The room a thing is in now (its own room slot, or the room of the table/shelf it stands on). */
export function roomOf(v, row) {
  for (let r = row, k = 0; r && r.parent !== 'world' && k < 16; k++) {
    const p = v.byId?.get(r.parent) ?? v.get(r.parent); if (!p) return null;
    const sl = (p.slots ?? []).find((x) => x.id === r.slot && x.kind === 'room');
    if (sl) return { host: p, slot: sl };
    r = p;
  }
  return null;
}
/**
 * Where a thing that lives inside something ends up when it moves to world point (wx, wz) with world yaw wy:
 * still on its table if the point is on the table's top, else the room the point is in (its own room
 * first, then the same floor), else the world root. Returns { in, p, r, note } in the parent's frame.
 */
export function relocate(v, row, wx, wz, wy) {
  const sub = new Set([row.id]); for (let grew = true; grew;) { grew = false; for (const r of v.rows) if (sub.has(r.parent) && !sub.has(r.id)) { sub.add(r.id); grew = true; } }
  const parent = row.parent === 'world' ? null : v.byId?.get(row.parent) ?? v.get(row.parent);
  const local = (host, slotId) => { const F = frameOf(host, slotId); const [lx, lz] = toLocal(F, wx, wz); return { F, lx, lz, r: wy === undefined ? undefined : r2(wy - F.RY) }; };
  if (parent && row.slot && !(parent.slots ?? []).some((x) => x.id === row.slot && x.kind === 'room')) {
    // on a surface (table top, shelf): stay if the point is over the host's top
    const L = local(parent, row.slot), hx = (parent.box?.[0] ?? 1) / 2, hz = (parent.box?.[2] ?? 1) / 2;
    const [ox, oz] = toLocal(frameOf(parent), L.F.O[0], L.F.O[1]);   // the slot origin in the host's frame
    if (Math.abs(ox + L.lx) <= hx && Math.abs(oz + L.lz) <= hz) return { in: { parent: parent.path, slot: row.slot }, p: [r2(L.lx), r2(L.lz)], r: L.r, note: `on ${parent.path}` };
  }
  if (row.parent !== 'world') {
    const cur = roomOf(v, row);
    const rooms = roomsAt(v, wx, wz, sub);
    const pick = (cur && rooms.find((x) => x.host.id === cur.host.id && x.slot.id === cur.slot.id)) ?? (cur && rooms.find((x) => x.host.id === cur.host.id && (x.slot.floor ?? 0) === (cur.slot.floor ?? 0))) ?? rooms.find((x) => (x.slot.floor ?? 0) === (cur?.slot.floor ?? 0)) ?? rooms[0];
    if (pick) { const L = local(pick.host, pick.slot.id); return { in: { parent: pick.host.path, slot: pick.slot.id }, p: [r2(L.lx), r2(L.lz)], r: L.r, note: `inside ${pick.host.path}/${pick.slot.id}`, room: `${pick.host.path}/${pick.slot.id}` }; }
    return { in: { parent: 'world' }, p: [r2(wx), r2(wz)], r: wy === undefined ? undefined : r2(wy), note: `out of ${parent?.path ?? 'its parent'}, now at the root`, left: true };
  }
  return { p: [r2(wx), r2(wz)], r: wy === undefined ? undefined : r2(wy) };
}

/** A house-relative side or corner word → a unit direction in the room frame. front = the way the house faces
 *  (its front door side); left/right = the house's own left and right, as you walk out of its front door. */
export function sideDir(word, frontL) {
  let w = String(word ?? '').toLowerCase().replace(/[^a-z]/g, '');
  const parts = { front: [1, 0], back: [-1, 0], rear: [-1, 0], left: [0, 1], right: [0, -1] };
  let a = 0, b = 0, n = 0;
  for (const k of Object.keys(parts)) if (w.includes(k)) { a += parts[k][0]; b += parts[k][1]; w = w.replace(k, ''); n++; }
  if (!n || w || (a === 0 && b === 0)) return null;
  const l = leftOf(frontL);
  return norm([a * frontL[0] + b * l[0], a * frontL[1] + b * l[1]]);
}
const steps = (max, step) => { const out = [0]; for (let k = 1; k * step <= max + 1e-9; k++) out.push(k * step, -k * step); return out; };

function solveInRoom(v, host, room, thing, rel, ctx) {
  const { hw, hd, solid, skip, constraints, faceAt, facingConstraint, baseYaw, notes } = ctx;
  const F = frameOf(host, room.id);
  const poly = room.local ?? [[-2, -2], [2, -2], [2, 2], [-2, 2]];
  const label = `${host.path}/${room.id}`;
  const m = 0.13, n = Number(rel.count ?? 1), dY = F.RY - F.PY;
  const lx0 = Math.min(...poly.map((p) => p[0])), lx1 = Math.max(...poly.map((p) => p[0])), lz0 = Math.min(...poly.map((p) => p[1])), lz1 = Math.max(...poly.map((p) => p[1]));
  const isRect = poly.length === 4 && poly.every(([x, z]) => (Math.abs(x - lx0) < 1e-3 || Math.abs(x - lx1) < 1e-3) && (Math.abs(z - lz0) < 1e-3 || Math.abs(z - lz1) < 1e-3));
  const cx = isRect ? (lx0 + lx1) / 2 : poly.reduce((a, p) => a + p[0], 0) / poly.length, cz = isRect ? (lz0 + lz1) / 2 : poly.reduce((a, p) => a + p[1], 0) / poly.length;
  const boxL = (lx, lz, ly, grow = 0) => ({ c: [lx, lz], half: [hw + grow, hd + grow], yaw: ly + dY });
  const fits = (lx, lz, ly) => corners(boxL(lx, lz, ly, 0.08)).every(([x, z]) => inPoly(x, z, poly));
  const floor = room.floor ?? 0;
  // doorways stay clear (as furnish keeps them): 0.85 m either side of every door on this floor
  const doors = (host.doors ?? []).filter((d) => (d.level ?? 0) === floor).map((d) => ({ id: d.id, zone: { c: toLocal(F, d.at[0], d.at[1]), half: [d.width / 2 + 0.15, 0.85], yaw: d.yaw - F.PY } }));
  const roomSkip = new Set([...skip, host.id, ...v.rows.filter((x) => !(x.parent === host.id && x.slot === room.id)).map((x) => x.id)]);
  const taken = [];
  const yawAt = (lx, lz, ly) => { const [wx, wz] = toWorldIn(F, lx, lz); const f = faceAt(wx, wz); return f !== undefined ? f - F.RY : ly; };
  const why = (lx, lz, ly) => {
    if (!fits(lx, lz, ly)) return 'through a wall';
    const d = solid && doors.find((x) => obbHit(boxL(lx, lz, ly), x.zone)); if (d) return `in the doorway ${d.id}`;
    if (solid) { const [x, z] = toWorldIn(F, lx, lz); const b = blockers(v, { c: [x, z], half: [hw, hd], yaw: F.RY + ly }, roomSkip); if (b.length) return `against ${b[0]}`; }
    if (taken.some((t) => obbHit(boxL(lx, lz, ly, 0.08), t))) return 'on another one';
    return null;
  };
  const at = (lx, lz, ly, how) => ({ in: { parent: host.path, slot: room.id }, p: [r2(lx), r2(lz)], r: r2(ly), constraints: [...constraints, ...facingConstraint(), { kind: 'inside', ref: label }], note: `inside ${label}${how ? ', ' + how : ''}` });
  // the farthest distance along u from c at which the thing still fits (−1 if it does not fit at c)
  const reach = (c, u, ly) => { if (!fits(c[0], c[1], ly)) return -1; let lo = 0, hi = Math.hypot(lx1 - lx0, lz1 - lz0); for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (fits(c[0] + u[0] * mid, c[1] + u[1] * mid, ly)) lo = mid; else hi = mid; } return lo; };
  const choose = (cands, what) => {
    const items = []; const skipped = new Map();
    for (const [lx, lz, ly0, how] of cands) {
      if (items.length >= n) break;
      const ly = yawAt(lx, lz, ly0);
      const w = why(lx, lz, ly); if (w) { if (!skipped.has(w)) skipped.set(w, how); continue; }
      taken.push(boxL(lx, lz, ly)); items.push({ candidates: [at(lx, lz, ly, how)] });
    }
    const door = [...skipped.keys()].find((k) => k.startsWith('in the doorway'));
    if (door && items.length) notes.push(`kept ${door.replace('in the ', '')} clear`);
    if (!items.length) throw new Error(`no room for a ${r2(2 * hw)}×${r2(2 * hd)} m thing ${what} in ${label} (${r2(lx1 - lx0)}×${r2(lz1 - lz0)} m): ${[...skipped.keys()].slice(0, 3).join('; ') || 'nothing fits'}`);
    if (items.length < n) notes.push(`only ${items.length} of ${n} fit ${what} in ${label}`);
    return { items, notes };
  };
  const fL = dirOfYaw((host.front ?? host.pose[3]) - F.PY);
  const dirWord = (w) => { const rd = sideDir(w, fL); if (rd) return rd; const k = compassKey(w); if (k) return norm(unrot(F.PY, COMPASS[k][0], COMPASS[k][1])); return null; };
  const round = !isRect;
  const R = Math.max(lx1 - lx0, lz1 - lz0) / 2;
  if (rel.corner || rel.wall) {
    const word = rel.wall ?? rel.corner;
    let u = dirWord(word);
    if (!u) throw new Error(`--${rel.wall ? 'wall' : 'corner'} takes the house's own sides: back, front, left, right (corners back-left, front-right, …; left/right as you walk out of the front door), or a world compass word (n, ne, …); got ${word}`);
    const cands = [];
    if (rel.wall) {
      if (isRect) u = Math.abs(u[0]) >= Math.abs(u[1]) ? [Math.sign(u[0]), 0] : [0, Math.sign(u[1])];
      if (!round) {
        const ly = baseYaw !== undefined ? baseYaw - F.RY : yawOf(-u[0], -u[1]) - dY, tg = [-u[1], u[0]];
        for (const t of steps(Math.abs(u[0]) ? (lz1 - lz0) / 2 : (lx1 - lx0) / 2, 0.25)) { const c0 = [cx + tg[0] * t, cz + tg[1] * t]; const d = reach(c0, u, ly); if (d >= 0) cands.push([c0[0] + u[0] * d, c0[1] + u[1] * d, ly, `against the ${word} wall${Math.abs(t) > 0.01 ? ` (${r2(Math.abs(t))} m along it)` : ''}`]); }
      } else {
        for (const a of steps(Math.PI * 0.95, 0.25 / Math.max(1, R))) { const uu = rot(a, u[0], u[1]); const ly = baseYaw !== undefined ? baseYaw - F.RY : yawOf(-uu[0], -uu[1]) - dY; const d = reach([cx, cz], uu, ly); if (d >= 0) cands.push([cx + uu[0] * d, cz + uu[1] * d, ly, `against the ${word} wall${Math.abs(a) > 0.01 ? ` (${Math.round(Math.abs(a) * 180 / Math.PI)}° round it)` : ''}`]); }
      }
      return choose(cands, `against the ${word} wall`);
    }
    const ly = (uu) => (baseYaw !== undefined ? baseYaw - F.RY : yawOf(-uu[0], -uu[1]) - dY);
    if (isRect) {
      const sx = Math.abs(u[0]) < 0.3 ? 0 : Math.sign(u[0]), sz = Math.abs(u[1]) < 0.3 ? 0 : Math.sign(u[1]);
      // back to a wall, not diagonal: the first-named side's wall (back-left → the back wall), else the nearer axis
      const first = String(word).toLowerCase().match(/front|back|rear|left|right/)?.[0];
      const fu = first ? dirWord(first) : null;
      const wallAx = fu ? (Math.abs(fu[0]) >= Math.abs(fu[1]) ? [Math.sign(fu[0]), 0] : [0, Math.sign(fu[1])]) : sz ? [0, sz] : [sx, 0];
      const y = baseYaw !== undefined ? baseYaw - F.RY : yawOf(-wallAx[0], -wallAx[1]) - dY, b = boxL(0, 0, y), ex = extentAlong(b, [1, 0]), ez = extentAlong(b, [0, 1]);
      const x = sx > 0 ? lx1 - ex - m : sx < 0 ? lx0 + ex + m : cx, z = sz > 0 ? lz1 - ez - m : sz < 0 ? lz0 + ez + m : cz;
      cands.push([x, z, y, `${word} corner`]);
      // blocked (a doorway): slide out of the corner along either wall
      for (let t = 0.25; t < Math.max(lx1 - lx0, lz1 - lz0); t += 0.25) { if (sx) cands.push([x, z - (sz || 1) * t, y, `${word} corner, ${r2(t)} m along the wall`]); if (sz) cands.push([x - (sx || 1) * t, z, y, `${word} corner, ${r2(t)} m along the wall`]); }
    } else {
      for (const a of steps(Math.PI * 0.95, 0.25 / Math.max(1, R))) { const uu = rot(a, u[0], u[1]); const d = reach([cx, cz], uu, ly(uu)); if (d >= 0) cands.push([cx + uu[0] * d, cz + uu[1] * d, ly(uu), `${word} side of the round room${Math.abs(a) > 0.01 ? ` (${Math.round(Math.abs(a) * 180 / Math.PI)}° round)` : ''}`]); }
    }
    return choose(cands, `in the ${word} corner`);
  }
  // free spots on a lattice, centre first
  const ly = baseYaw !== undefined ? baseYaw - F.RY : 0;
  const spots = [];
  for (let i = -16; i <= 16; i++) for (let j = -16; j <= 16; j++) { const lx = cx + i * 0.5, lz = cz + j * 0.5; if (lx < lx0 || lx > lx1 || lz < lz0 || lz > lz1) continue; spots.push([lx, lz, ly, 'a free spot', Math.hypot(i, j)]); }
  spots.sort((a, b) => a[4] - b[4]);
  return choose(spots, 'free');
}
