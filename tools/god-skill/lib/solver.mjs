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
    const row = v.get(s);
    if (!row) throw new Error(`no such reference: ${s} (see: map, flags)`);
    out = { ...centreOf(row), kind: 'entity', row, ref: row.path };
  }
  if (offset) { const [dx, dz] = String(offset).split(',').map(Number); out = { ...out, x: r2(out.x + dx), z: r2(out.z + dz) }; }
  return out;
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
/** The compiler (L1, compile.ts) re-places `along` things itself with generators' offsetPolyline, whose
 *  positive side is (−dz, +dx): the walker's RIGHT in this frame (+z is south). Until that is flipped
 *  server-side, the solver translates the walker's side into the server's label so both agree on the
 *  spot. Set to false when compile.ts uses the walker's-left convention. */
export const SERVER_SIDE_MIRRORED = true;
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
    if (row.obbs.some(([cx, cz, hx, hz, yaw]) => obbHit(box, { c: [cx, cz], half: [hx, hz], yaw }, margin))) out.push(row.path);
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
    return row && row.form === 'point' && !row.shape ? [{ kind: 'facing', ref: row.path, offset: 0 }] : [];
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
    // start and end at the edges of entity refs, not their centres (a road from the plaza to the bridge)
    const edge = (P, Q) => { if (P.kind !== 'entity' || P.row.form !== 'point') return [P.x, P.z]; const u = norm([Q.x - P.x, Q.z - P.z]); const e = extentAlong(boxOf(P.row), u) + 1; return [r2(P.x + u[0] * e), r2(P.z + u[1] * e)]; };
    const via = rel.via ? [].concat(rel.via).map((x) => { const p = refPoint(v, x); return [p.x, p.z]; }) : [];
    const path = [edge(A, via.length ? { x: via[0][0], z: via[0][1] } : B), ...via, edge(B, via.length ? { x: via.at(-1)[0], z: via.at(-1)[1] } : A)];
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

  // ---- on: a surface slot of a table, shelf, counter
  if (rel.on) {
    const host = v.get(rel.on); if (!host) throw new Error(`no such thing to put it on: ${rel.on}`);
    const slots = (host.slots ?? []).filter((x) => ['surface', 'shelf'].includes(x.kind) && x.used < x.capacity);
    if (!slots.length) throw new Error(`${host.path} has no free surface slot (slots: ${(host.slots ?? []).map((x) => `${x.id}:${x.kind} ${x.used}/${x.capacity}`).join(', ') || 'none'})`);
    const n = Number(rel.count ?? 1);
    const items = [];
    let k = 0;
    for (const sl of slots) for (let u = sl.used; u < sl.capacity && items.length < n; u++) items.push({ candidates: [{ in: { parent: host.path, slot: sl.id }, constraints, note: `on ${host.path} (slot ${sl.id})` }] }), k++;
    if (items.length < n) notes.push(`only ${items.length} free surface places on ${host.path}`);
    return { items, notes };
  }

  // ---- inside: a room of a building (house/room), optionally a corner or against a wall
  if (rel.inside) {
    const spec = String(rel.inside);
    let host = v.get(spec), roomId = null;
    if (!host || !(host.slots ?? []).some((x) => x.kind === 'room')) {
      const cut = spec.lastIndexOf('/');
      if (cut > 0 && v.get(spec.slice(0, cut))) { host = v.get(spec.slice(0, cut)); roomId = spec.slice(cut + 1); }
    }
    if (!host) throw new Error(`no such building: ${spec}`);
    const rooms = (host.slots ?? []).filter((x) => x.kind === 'room');
    if (!rooms.length) throw new Error(`${host.path} has no rooms (it is not a building); use --near or --on`);
    // a room by id, else by a word of it (bedroom → bedroom-1, bed → bedroom-2): the first match in the building's order
    const bare = (t) => String(t).toLowerCase().replace(/[^a-z]/g, '');
    const room = !roomId ? rooms[0] : rooms.find((x) => x.id === roomId) ?? rooms.find((x) => bare(x.id) === bare(roomId) || (x.name && bare(x.name) === bare(roomId))) ?? rooms.find((x) => bare(x.id).startsWith(bare(roomId)) || bare(roomId).startsWith(bare(x.id)) || (x.name && bare(x.name).includes(bare(roomId))));
    if (!room) throw new Error(`${host.path} has no room ${roomId}; rooms: ${rooms.map((x) => x.id).join(', ')}`);
    const RY = room.yaw, O = room.p;
    const local = room.local ?? [[-2, -2], [2, -2], [2, 2], [-2, 2]];
    const lx0 = Math.min(...local.map((p) => p[0])), lx1 = Math.max(...local.map((p) => p[0])), lz0 = Math.min(...local.map((p) => p[1])), lz1 = Math.max(...local.map((p) => p[1]));
    const m = 0.15;
    const siblings = new Set(v.rows.filter((x) => x.parent !== host.id || x.slot !== room.id).map((x) => x.id));
    const roomSkip = new Set([...skip, host.id, ...[...v.rows].filter((x) => x.parent !== host.id).map((x) => x.id)]);
    void siblings;
    const toW = (lx, lz) => { const [dx, dz] = rot(RY, lx, lz); return [O[0] + dx, O[2] + dz]; };
    const freeIn = (lx, lz, ly) => { const [x, z] = toW(lx, lz); return !solid || blockers(v, mine(x, z, RY + ly), roomSkip).length === 0; };
    const ext = (ly) => [hw * Math.abs(Math.cos(ly)) + hd * Math.abs(Math.sin(ly)), hw * Math.abs(Math.sin(ly)) + hd * Math.abs(Math.cos(ly))];
    const toLocalYaw = (wy) => wy - RY;
    const label = `${host.path}/${room.id}`;
    const at = (lx, lz, ly, how) => {
      const [wx, wz] = toW(lx, lz);
      const f = faceAt(wx, wz); const yl = f !== undefined ? toLocalYaw(f) : ly;
      return { in: { parent: host.path, slot: room.id }, p: [r2(lx), r2(lz)], r: r2(yl), constraints: [...constraints, ...facingConstraint(), { kind: 'inside', ref: label }], note: `inside ${label}${how ? ', ' + how : ''}` };
    };
    const n = Number(rel.count ?? 1);
    if (rel.corner || rel.wall) {
      const key = compassKey(rel.corner ?? rel.wall); if (!key) throw new Error(`corner/wall must be a compass word (n, ne, e, …), got ${rel.corner ?? rel.wall}`);
      const d = COMPASS[key]; const [dl0, dl1] = unrot(RY, d[0], d[1]);
      if (rel.wall) {
        // against the wall: back to the wall, facing into the room
        const alongX = Math.abs(dl0) >= Math.abs(dl1);
        const ly = alongX ? yawOf(-Math.sign(dl0), 0) : yawOf(0, -Math.sign(dl1));
        const [ex, ez] = ext(ly);
        const items = [];
        const span = alongX ? [lz0 + ez + m, lz1 - ez - m] : [lx0 + ex + m, lx1 - ex - m];
        const step = (alongX ? 2 * ez : 2 * ex) + Number(rel.gap ?? 0.3);
        const total = step * (n - 1), mid = (span[0] + span[1]) / 2;
        for (let k = 0; k < n; k++) {
          const t = mid - total / 2 + k * step;
          const lx = alongX ? (dl0 > 0 ? lx1 - ex - m : lx0 + ex + m) : t, lz = alongX ? t : (dl1 > 0 ? lz1 - ez - m : lz0 + ez + m);
          items.push({ candidates: [at(lx, lz, ly, `against the ${key} wall`)] });
        }
        return { items, notes };
      }
      const ly = baseYaw !== undefined ? baseYaw - RY : yawOf(-Math.sign(dl0) || 0, -Math.sign(dl1) || 1);
      const [ex, ez] = ext(ly);
      const lx = Math.abs(dl0) < 0.3 ? (lx0 + lx1) / 2 : dl0 > 0 ? lx1 - ex - m : lx0 + ex + m;
      const lz = Math.abs(dl1) < 0.3 ? (lz0 + lz1) / 2 : dl1 > 0 ? lz1 - ez - m : lz0 + ez + m;
      return { items: [{ candidates: [at(lx, lz, ly, `${key} corner`)] }], notes };
    }
    // free spots on a lattice, centre first
    const ly = baseYaw !== undefined ? baseYaw - RY : 0;
    const [ex, ez] = ext(ly);
    const cx = (lx0 + lx1) / 2, cz = (lz0 + lz1) / 2;
    const spots = [];
    for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) {
      const lx = cx + i * 0.5, lz = cz + j * 0.5;
      if (lx - ex < lx0 + m || lx + ex > lx1 - m || lz - ez < lz0 + m || lz + ez > lz1 - m) continue;
      spots.push([lx, lz, Math.hypot(i, j)]);
    }
    spots.sort((a, b) => a[2] - b[2]);
    const items = [];
    const taken = [];
    for (const [lx, lz] of spots) {
      if (items.length >= n) break;
      if (!freeIn(lx, lz, ly)) continue;
      if (taken.some(([a, b]) => Math.abs(a - lx) < 2 * ex + 0.2 && Math.abs(b - lz) < 2 * ez + 0.2)) continue;
      taken.push([lx, lz]); items.push({ candidates: [at(lx, lz, ly, 'a free spot')] });
    }
    if (!items.length) throw new Error(`no free spot for a ${r2(2 * hw)}×${r2(2 * hd)} m thing in ${label} (room ${r2(lx1 - lx0)}×${r2(lz1 - lz0)} m)`);
    return { items, notes };
  }

  // ---- along a path entity (road, river, wall): at t, a side and a setback; rows step along it
  if (rel.along) {
    const host = v.get(rel.along); if (!host) throw new Error(`no such path: ${rel.along}`);
    const path = host.shape?.path; if (!path) throw new Error(`${host.path} is not a path (it has no shape.path)`);
    const L = polylineLength(path), pw = (host.shape.width ?? host.box?.[0] ?? 4) / 2;
    const sides = rel.side === 'both' ? ['left', 'right'] : [rel.side ?? 'center'];
    const n = Number(rel.row ?? rel.count ?? 1);
    const gap = rel.gap !== undefined ? Number(rel.gap) : 4;
    const step = (2 * hw + gap) / L;
    const t0 = rel.t !== undefined ? Number(rel.t) : n > 1 ? Math.max(0.02, 0.5 - (step * (n - 1)) / 2) : 0.5;
    const items = [];
    for (const side of sides) for (let k = 0; k < n; k++) {
      const t = Math.min(1, t0 + k * step);
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
    const gap = rel.dist !== undefined ? Number(rel.dist) : Math.max(1.5, Math.min(6, Math.max(hw, hd)));
    const start = rel.dir && compassKey(rel.dir) ? COMPASS[compassKey(rel.dir)] : R.kind === 'entity' && R.row.form === 'point' && !R.row.def.includes('flag') ? dirOfYaw(R.yaw) : COMPASS.s;
    const a0 = Math.atan2(start[0], start[1]);
    const items = [];
    const placed = [];
    const isFree = (x, z, yaw) => free(x, z, yaw) && !placed.some((b) => obbHit(mine(x, z, yaw), b, 0.1));
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
        const d0 = extentAlong(rb, u) + Math.max(hw, hd) + gap + ring;
        const y1 = finalYaw(rb.c[0] + u[0] * d0, rb.c[1] + u[1] * d0, baseYaw) ?? 0;
        const d = extentAlong(rb, u) + extentAlong(mine(0, 0, y1), u) + gap + ring;
        const x = rb.c[0] + u[0] * d, z = rb.c[1] + u[1] * d;
        const fy = finalYaw(x, z, baseYaw);
        const c = pose(x, z, fy, { note: `near ${R.ref ?? rel.near ?? rel.around}, ${compassOfYaw(a)} of it, ${r2(gap + ring)} m away`, constraints: R.kind === 'entity' ? [{ kind: 'near', ref: R.row.path, dist: r2(gap + ring + 1) }] : [] });
        fallback ??= c;
        if (isFree(x, z, fy ?? 0)) cands.push(c);
      }
      if (!cands.length && fallback) cands.push(fallback);
      if (cands.length >= 4) cands.length = 4;
      if (!cands.length) throw new Error(`no free place near ${R.ref ?? rel.near} within ${gap + 10} m; try --dist or --free`);
      const c0 = cands[0]; placed.push(mine(c0.p[0], c0.p[1], c0.r ?? 0));
      items.push({ candidates: cands });
    }
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
