// furnish: expand a building's rooms into a batch of furniture placements from data recipes
// (tools/god-skill/recipes/furnish/<style>.json). Pure: reads the world model, returns ops + notes;
// L7 wires it into the CLI (`god furnish <house> [--style]`, dry-run first). Owner: L2 (buildings).
//
// Recipe format (furnish/1):
//   { "schema": "furnish/1", "style": "cottage",
//     "rooms": { "<room kind>": [ { "name": "bed", "def": ["core/bed@1", "core/bench-seat@1"], "at": [fx, fz], "face": "s", "on": "<item>" } ] },
//     "default": [ … ] }
// `at` is a fraction of the room's free range in the building's CANONICAL frame (front door = +z):
// fx 0 = against the west wall … 1 = against the east wall; fz 0 = against the back wall … 1 = the
// front wall (so [0.5, 0] is centred against the back). `face` is where the item's front points
// (s = toward the building front, n, e, w). `def` lists alternatives; the first def the world has is
// used. `on: "<name>"` puts a small item on an earlier item's `top` slot. Items that would cross a
// wall, the stairs or a rail, stand in a doorway or at the foot/head of the stairs, or overlap an
// earlier item, or cut the way between a room's doors, stair ends and the pieces' own approaches (a body 0.34 m round),
// are dropped and reported.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { obbOverlap } from '../../../packages/world-compiler/src/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const RECIPES = resolve(here, '../recipes/furnish');
const FRONT_YAW = { s: 0, e: Math.PI / 2, n: Math.PI, w: -Math.PI / 2 };
const FACE_YAW = { s: 0, e: Math.PI / 2, n: Math.PI, w: -Math.PI / 2 };
const r3 = (v) => Math.round(v * 1000) / 1000;
const itemBoxes = (baked, p, y, yaw) => {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const boxes = baked.colliders ?? [{ c: [0, 0], half: [baked.box[0] / 2, baked.box[2] / 2], yaw: 0, y0: 0, y1: baked.box[1] }];
  return boxes.map(b => ({ c: [p[0] + b.c[0] * c + b.c[1] * s, p[1] - b.c[0] * s + b.c[1] * c], half: b.half, yaw: b.yaw + yaw, y0: y + b.y0, y1: y + b.y1 }));
};

// A room's ways through (lane SEALED, 2026-10-21): every doorway and stair end on a room's floor must stay reachable from
// the others for a body BODY_R round, past the walls and the pieces already standing. A piece whose pose cuts them apart
// (a stool in the gap between a counter and a shelf that leaves the storeroom door in a nook) tries its next pose or is
// dropped. 0.1 m grid over the room; keys are 0.45 m inside each doorway and the planner's step-off point 0.7 m beyond
// each stair end.
// The walk grid marks every 0.1 m world-aligned cell a piece or wall touches and measures room from cell centres, so a box
// reads up to a cell bigger there than it is, more in a building turned off the grid (a cell's reach across a box edge at
// angle a is 0.05 (|cos a| + |sin a|)): the check keeps that slack, 0.1 m square to the grid up to 0.15 m at 45 deg
// (lane WALK2, 2026-10-21: a 0.96 m gap between a table and a sofa in hillside-home-4, turned 39 deg, passed here with
// one cell to spare but had 0.31 m of room on the walk grid, where 0.34 is needed, and sealed half the living room).
const BODY_R = 0.34, CELL = 0.1;
export const gridSlack = (yaw = 0) => { const a = Math.abs(yaw) % (Math.PI / 2); return 0.1 + (0.05 * (Math.cos(a) + Math.sin(a) - 1)) / (Math.SQRT2 - 1); };
const inPoly = (poly, x, z) => { let k = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) k = !k; } return k; };
const inBox = (b, x, z, r) => { const c = Math.cos(b.yaw), s = Math.sin(b.yaw), dx = x - b.c[0], dz = z - b.c[1]; return Math.abs(dx * c - dz * s) < b.half[0] + r && Math.abs(dx * s + dz * c) < b.half[1] + r; };
export function roomKeys(room, doors, links) {
  const keys = [];
  for (const d of doors) {
    if (d.level !== room.floor || (d.from !== room.id && d.to !== room.id)) continue;
    const n = [Math.sin(d.yaw), Math.cos(d.yaw)];
    for (const k of [0.45, -0.45]) { const p = [d.at[0] + n[0] * k, d.at[1] + n[1] * k]; if (inPoly(room.polygon, p[0], p[1])) { keys.push(p); break; } }
  }
  for (const l of links) for (const [end, next, level] of [[l.path[0], l.path[1], l.from], [l.path[l.path.length - 1], l.path[l.path.length - 2], l.to]]) {
    if (level !== room.floor || !next) continue;
    // straight on 0.7 m, else sideways (a flight that starts against a wall), else the end itself
    const dx = end[0] - next[0], dz = end[1] - next[1], m = Math.hypot(dx, dz) || 1, u = [dx / m, dz / m];
    const p = [[u[0], u[1]], [-u[1], u[0]], [u[1], -u[0]], [0, 0]].map(([a, b]) => [end[0] + a * 0.7, end[1] + b * 0.7]).find(([x, z]) => inPoly(room.polygon, x, z));
    if (p) keys.push(p);
  }
  return keys;
}
// ... and every piece's own approach (where a Soul sent to it stands: in front of each seat, else the free spot nearest the
// piece) stays reachable from the doors: a display may not stand in front of a shelf (lane SEALED, 2026-10-21).
// A key is a point (the free cell within 0.3 m) or { pts, r } (the free cell nearest any of pts within r: 1.5 m round a
// seat's front, as the walk goal searches).
export function approachOf(baked, at, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw), w = ([x, z]) => [at[0] + x * c + z * s, at[1] - x * s + z * c];
  const seats = (baked.slots ?? []).filter((x) => x.kind === 'seat');
  if (seats.length) return { pts: seats.map((x) => w([x.p[0] + Math.sin(x.yaw) * 0.75, x.p[2] + Math.cos(x.yaw) * 0.75])), r: 1.5 };
  return { pts: [at], r: Math.hypot(baked.box[0], baked.box[2]) / 2 + 1.5 };
}
/** The group each key falls in (a body BODY_R round walking inside `room` past `blockers`); a key with no room is in none. */
export function wayLabels(room, keys, blockers, slack = gridSlack(0)) {
  const R = BODY_R + slack;
  const xs = room.polygon.map((p) => p[0]), zs = room.polygon.map((p) => p[1]);
  const x0 = Math.min(...xs), z0 = Math.min(...zs), nx = Math.ceil((Math.max(...xs) - x0) / CELL), nz = Math.ceil((Math.max(...zs) - z0) / CELL);
  const near = blockers.filter((b) => b.c[0] + Math.hypot(...b.half) + R > x0 && b.c[0] - Math.hypot(...b.half) - R < x0 + nx * CELL && b.c[1] + Math.hypot(...b.half) + R > z0 && b.c[1] - Math.hypot(...b.half) - R < z0 + nz * CELL);
  const free = new Uint8Array(nx * nz), lab = new Int32Array(nx * nz).fill(-1);
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) { const x = x0 + (i + 0.5) * CELL, z = z0 + (j + 0.5) * CELL; free[i * nz + j] = inPoly(room.polygon, x, z) && !near.some((b) => inBox(b, x, z, R)) ? 1 : 0; }
  const cellOf = (key) => {   // the free cell nearest the key
    const { pts, r } = Array.isArray(key) ? { pts: [key], r: 0.3 } : key;
    let best = -1, bd = Infinity;
    for (const [x, z] of pts)
      for (let i = Math.max(0, Math.floor((x - x0 - r) / CELL)); i <= Math.min(nx - 1, Math.floor((x - x0 + r) / CELL)); i++)
        for (let j = Math.max(0, Math.floor((z - z0 - r) / CELL)); j <= Math.min(nz - 1, Math.floor((z - z0 + r) / CELL)); j++) {
          const d = Math.hypot(x0 + (i + 0.5) * CELL - x, z0 + (j + 0.5) * CELL - z); if (free[i * nz + j] && d <= r && d < bd) { bd = d; best = i * nz + j; }
        }
    return best;
  };
  let next = 0; const labels = keys.map((k) => {
    const c0 = cellOf(k); if (c0 < 0) return -1 - next++;   // a key with no room to stand: in no group
    if (lab[c0] < 0) { const L = next++, st = [c0]; lab[c0] = L; while (st.length) { const c = st.pop(), i = Math.floor(c / nz), j = c % nz; for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) { if (a < 0 || b < 0 || a >= nx || b >= nz) continue; const q = a * nz + b; if (free[q] && lab[q] < 0) { lab[q] = L; st.push(q); } } } }
    return lab[c0];
  });
  return labels;
}
const pairsOf = (labels, n = labels.length) => { let k = 0; for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) if (labels[a] === labels[b]) k++; return k; };
/** How many pairs of `keys` a body can walk between inside `room` past `blockers` (OBBs, room frame = def frame). */
export function connectedPairs(room, keys, blockers, slack) { return keys.length < 2 ? 0 : pairsOf(wayLabels(room, keys, blockers, slack)); }

/** The furnish styles (recipe files), sorted. */
export const furnishStyles = () => readdirSync(RECIPES).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
const hasRecipe = (style) => /^[a-z0-9][a-z0-9-]*$/.test(String(style)) && existsSync(resolve(RECIPES, `${style}.json`));
/** A style's recipe. `strict` (an explicit --style): an unknown style throws with the list of styles instead of
 *  silently furnishing as a cottage; otherwise (a building's own style) it falls back to cottage. */
export function loadRecipe(style, { strict = false } = {}) {
  if (!hasRecipe(style)) {
    if (strict) throw new Error(`furnish has no style "${style}"; styles: ${furnishStyles().join(', ')}`);
    return JSON.parse(readFileSync(resolve(RECIPES, 'cottage.json'), 'utf8'));
  }
  return JSON.parse(readFileSync(resolve(RECIPES, `${style}.json`), 'utf8'));
}

/** Kind of a room from its id: `bedroom-2` → `bedroom`. */
const kindOf = (id) => id.replace(/-\d+$/, '').replace(/-room$/, '');

/**
 * Ops that furnish `buildingId` (id or path). Options: `style` (recipe; default the building's style),
 * `rooms` (only these room ids), `recipe` (an object instead of a file). Returns { ops, placed, dropped, notes }.
 */
export function furnishBatch(model, buildingId, style, opts = {}) {
  const b = model.get(buildingId);
  if (!b) return { ops: [], placed: [], dropped: [], notes: [`no such building ${buildingId}`] };
  const def = model.resolvedDef(b.def);
  const baked = model.bake(def, b.params ?? {}, b.seed ?? 0, b.shape);
  if (!baked.rooms?.length) return { ops: [], placed: [], dropped: [], notes: [`${buildingId} has no rooms`] };
  const args = def.make?.args ?? {};
  const st = style ?? args.furnish ?? args.style ?? b.params?.style ?? 'cottage';   // args.furnish: a def may borrow another style's recipe (roundhouse → cottage)
  const recipe = opts.recipe ?? loadRecipe(st, { strict: style != null });
  const th = def.make?.kind === 'gen' && def.make.gen === 'building/1' && !(b.params?.plan) ? FRONT_YAW[b.params?.front ?? def.params?.front?.default ?? 's'] ?? 0 : 0;
  const c = Math.cos(th), s = Math.sin(th);
  const slack = gridSlack(model.worldPose?.(b)?.yaw ?? (typeof b.r === 'number' ? b.r : 0));   // the building's turn off the walk grid
  const R = ([x, z]) => [x * c + z * s, -x * s + z * c];         // canonical → def frame
  const Ri = ([x, z]) => [x * c - z * s, x * s + z * c];         // def frame → canonical
  const existing = new Set([...(model.children.get(b.id) ?? [])].map((id) => model.entities.get(id)?.name).filter(Boolean));
  const ops = [], placed = [], dropped = [], notes = [];
  if (!opts.recipe && style == null && !hasRecipe(st)) notes.push(`no "${st}" furnish recipe; furnished as a cottage (pass --style: ${furnishStyles().join(', ')})`);
  const taken = [];   // accepted item OBBs in the def frame, with floor
  const doors = (baked.openings ?? []).filter((o) => o.kind === 'door' || o.kind === 'arch');
  // the ends of each flight: the walk planner steps on and off 0.7 m beyond them (sideways where a flight starts against a
  // wall), so keep 0.9 m round each end clear
  const ends = (baked.links ?? []).flatMap((l) => [{ p: l.path[0], level: l.from }, { p: l.path[l.path.length - 1], level: l.to }]);
  const keyCache = new Map(), keysOf = (room) => keyCache.get(room.id) ?? keyCache.set(room.id, roomKeys(room, doors, baked.links ?? [])).get(room.id);
  const defOf = (alts) => (Array.isArray(alts) ? alts : [alts]).map((ref) => [ref, model.resolvedDef(ref)]).find(([, d]) => d);
  const want = opts.rooms ? new Set(opts.rooms) : null;
  // pieces already in the building's rooms are obstacles too
  for (const cid of model.children.get(b.id) ?? []) {
    const ch = model.entities.get(cid), room = baked.rooms.find((r) => r.id === ch?.in.slot);
    if (!ch || !room) continue;
    const cd = model.resolvedDef(ch.def); if (!cd || cd.layer !== 'solid') continue;
    const cb = model.bake(cd, ch.params ?? {}, ch.seed ?? 0), lp = ch.p ?? [0, 0], lx = lp[0], lz = lp[lp.length - 1];
    const yaw = typeof ch.r === 'number' ? ch.r : Array.isArray(ch.r) ? ch.r[0] : 0;
    const at0 = [room.origin[0] + lx, room.origin[1] + lz], y0 = room.y + (lp.length === 3 ? lp[1] : 0);
    taken.push({ floor: room.floor, solid: cb.box[1] > 0.06, boxes: itemBoxes(cb, at0, y0, yaw), foot: { c: at0, half: [cb.box[0] / 2, cb.box[2] / 2], yaw, y0, y1: y0 + cb.box[1] }, approach: approachOf(cb, at0, yaw) });
  }
  for (const room of baked.rooms) {
    if (want && !want.has(room.id)) continue;
    const items = recipe.rooms?.[kindOf(room.id)] ?? recipe.default ?? [];
    if (!items.length) continue;
    const canon = room.polygon.map((p) => Ri(p));
    const x0 = Math.min(...canon.map((p) => p[0])), x1 = Math.max(...canon.map((p) => p[0])), z0 = Math.min(...canon.map((p) => p[1])), z1 = Math.max(...canon.map((p) => p[1]));
    const round = room.polygon.length > 4;
    const named = {};
    for (const it of items) {
      const name = `${room.id}-${it.name ?? 'item'}`.slice(0, 48);
      if (existing.has(name)) { notes.push(`${name} already there`); continue; }
      const found = defOf(it.def);
      if (!found) { dropped.push({ name, why: `no def among ${[].concat(it.def).join(', ')}` }); continue; }
      const [ref, idef] = found;
      if (it.on) {
        const host = named[it.on];
        if (!host) { dropped.push({ name, why: `no ${it.on} to put it on` }); continue; }
        ops.push({ op: 'place', def: ref, name, in: { parent: host.tmp, slot: it.slot ?? 'top' }, ...(it.params ? { params: it.params } : {}), ...(it.price ? { price: it.price } : {}) });
        placed.push({ name, def: ref, room: room.id, on: it.on });
        continue;
      }
      const ib = model.bake(idef, it.params ?? {}, 0);
      const k = round ? 0.7 : 1, cxm = (x0 + x1) / 2, czm = (z0 + z1) / 2;
      const ax0 = cxm - ((cxm - x0) * k), ax1 = cxm + ((x1 - cxm) * k), az0 = czm - ((czm - z0) * k), az1 = czm + ((z1 - czm) * k);
      // candidate poses: `try` lists [fx, fz, face] in order of preference; the first clear one wins
      const tries = it.try ?? [[...(it.at ?? [0.5, 0.5]), it.face ?? 's']];
      let why = 'no pose fits', box = null, boxes = [], at = null, yaw = 0;
      for (const [fx, fz, face = 's'] of tries) {
        const fyaw = FACE_YAW[face] ?? 0, turned = face === 'e' || face === 'w';
        const hx = (turned ? ib.box[2] : ib.box[0]) / 2 + 0.04, hz = (turned ? ib.box[0] : ib.box[2]) / 2 + 0.04;
        if (ax1 - ax0 < 2 * hx || az1 - az0 < 2 * hz) { why = 'too big for the room'; continue; }
        const cc = [ax0 + hx + fx * (ax1 - ax0 - 2 * hx), az0 + hz + fz * (az1 - az0 - 2 * hz)];
        const p = R(cc);
        const bx = { c: p, half: [hx - 0.04, hz - 0.04], yaw: th, y0: room.y + 0.01, y1: room.y + Math.max(0.05, ib.box[1]) };
        // Admission rotates the actual collider offsets too. Round the pose exactly as the returned op
        // so a recipe cannot pass here then overlap when re-admitted (e.g. asymmetric pew backs).
        const pose = [room.origin[0] + r3(p[0] - room.origin[0]), room.origin[1] + r3(p[1] - room.origin[1])];
        const actual = itemBoxes(ib, pose, room.y, r3(fyaw + th)), candidate = [...actual, bx];
        const solid = ib.box[1] > 0.06;
        const hit = baked.colliders.find((o) => actual.some(a => obbOverlap(a, o)));
        if (hit) { why = `would cross ${hit.tag ?? 'a wall'}`; continue; }
        // keep a clear zone 0.8 m deep either side of every doorway, and 0.9 m round the ends of the stairs
        const zone = (d) => ({ c: d.at, half: [d.width / 2 + 0.1, 0.8], yaw: d.yaw, y0: room.y, y1: room.y + 2 });
        if (solid && doors.some((d) => d.level === room.floor && obbOverlap(bx, zone(d)))) { why = 'in a doorway'; continue; }
        if (ends.some((e) => e.level === room.floor && obbOverlap(bx, { c: e.p, half: [0.9, 0.9], yaw: 0, y0: room.y, y1: room.y + 2 }))) { why = 'at the foot or head of the stairs'; continue; }
        if (solid && taken.some((t) => t.floor === room.floor && t.solid && candidate.some(a => t.boxes.some(b => obbOverlap(a, b))))) { why = 'overlaps another piece'; continue; }
        if (solid && keysOf(room).length) {
          // the doors, stair ends and standing pieces' approaches keep every way they had, and this piece's own approach
          // is reached from a door
          const walls = baked.colliders.filter((o) => o.y0 < room.y + 1.6 && o.y1 > room.y + 0.15);
          const standing = taken.filter((t) => t.floor === room.floor && t.solid);
          const keys = [...keysOf(room), ...standing.map((t) => t.approach)], blockers = [...walls, ...standing.map((t) => t.foot)];   // footprints, as the walk grid sees them
          const was = wayLabels(room, keys, blockers, slack), now = wayLabels(room, [...keys, approachOf(ib, pose, r3(fyaw + th))], [...blockers, bx], slack);
          const own = now[now.length - 1], doorsReach = keysOf(room).some((_, i) => now[i] === own);
          if (pairsOf(now, keys.length) < pairsOf(was) || !doorsReach) { why = doorsReach ? 'would cut the way to its doors or another piece' : 'no way to it from the doors'; continue; }
        }
        box = bx; boxes = candidate; at = p; yaw = fyaw + th; break;
      }
      if (!box) { dropped.push({ name, why }); continue; }
      taken.push({ floor: room.floor, boxes, solid: ib.box[1] > 0.06, foot: box, approach: approachOf(ib, [room.origin[0] + r3(at[0] - room.origin[0]), room.origin[1] + r3(at[1] - room.origin[1])], r3(yaw)) });
      const tmp = `$f${ops.length}`.slice(0, 25);
      named[it.name ?? 'item'] = { tmp };
      ops.push({ op: 'place', tmp, def: ref, name, in: { parent: b.id, slot: room.id }, p: [r3(at[0] - room.origin[0]), 0, r3(at[1] - room.origin[1])], r: r3(yaw), ...(it.params ? { params: it.params } : {}), ...(it.price ? { price: it.price } : {}) });
      placed.push({ name, def: ref, room: room.id });
    }
  }
  notes.unshift(`furnish ${model.pathOf(b.id)} (${st}): ${placed.length} pieces in ${new Set(placed.map((p) => p.room)).size} rooms, ${dropped.length} dropped`);
  return { ops, placed, dropped, notes };
}
