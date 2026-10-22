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
// a seat's or bed's standing spot (lane FUZZ2) is where the use-check stands a body: on the walk raster where the building
// stands, the cell it is in must be free; laid out in the def frame (no world pose: library contents), a free cell of the
// exact-clearance grid within the conservative raster's slop of it (the spot has a body's room, PLAN_R, beside it)
const SPOT_R = 0.071;
const sits = (b) => (b.slots ?? []).some((x) => x.kind === 'seat' || x.kind === 'bed' || x.kind === 'berth');
const itemBoxes = (baked, p, y, yaw) => {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const boxes = baked.colliders ?? [{ c: [0, 0], half: [baked.box[0] / 2, baked.box[2] / 2], yaw: 0, y0: 0, y1: baked.box[1] }];
  return boxes.map(b => ({ c: [p[0] + b.c[0] * c + b.c[1] * s, p[1] - b.c[0] * s + b.c[1] * c], half: b.half, yaw: b.yaw + yaw, y0: y + b.y0, y1: y + b.y1 }));
};

// A room's ways through (lane SEALED, 2026-10-21): every doorway and stair end on a room's floor, and every piece's own
// approach (in front of each seat, else the free spot nearest the piece), must stay reachable from the others. A piece whose
// pose cuts them apart (a stool in the gap between a counter and a shelf that leaves the storeroom door in a nook) tries its
// next pose or is dropped. The rule (how much room a body needs past a wall or a piece, as the walk raster sees it) is the
// shared one in packages/generators/src/clearance.ts (lane BS1): 0.43 m from a wall piece, 0.50 m from a piece of furniture.
export { roomKeys, approachOf, approachKeys, wayLabels, connectedPairs } from '../../../packages/generators/src/clearance.ts';
import { roomKeys, approachKeys, wayGrid, pairsOf, seatSlides, seatSlidesLeft, SEAT_FAR, RASTER_SLOP } from '../../../packages/generators/src/clearance.ts';

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
  // the ways are checked on the walk raster where the building stands (lane BS1): what passes here is what the planner walks
  const wp = model.worldPose?.(b), way = wp && b.in?.parent === 'world' ? { pose: { x: wp.x, z: wp.z, yaw: wp.yaw, s: wp.s } } : {};
  if (!baked.rooms?.length) return { ops: [], placed: [], dropped: [], notes: [`${buildingId} has no rooms`] };
  const args = def.make?.args ?? {};
  const st = style ?? args.furnish ?? args.style ?? b.params?.style ?? 'cottage';   // args.furnish: a def may borrow another style's recipe (roundhouse → cottage)
  const recipe = opts.recipe ?? loadRecipe(st, { strict: style != null });
  const th = def.make?.kind === 'gen' && def.make.gen === 'building/1' && !(b.params?.plan) ? FRONT_YAW[b.params?.front ?? def.params?.front?.default ?? 's'] ?? 0 : 0;
  const c = Math.cos(th), s = Math.sin(th);
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
  const ways = new Map();   // room id -> { n: standing pieces in grid, grid, keys, was: their labels, at: where they stood }
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
    taken.push({ floor: room.floor, solid: cb.box[1] > 0.06, boxes: itemBoxes(cb, at0, y0, yaw), foot: { c: at0, half: [cb.box[0] / 2, cb.box[2] / 2], yaw, y0, y1: y0 + cb.box[1] }, approach: approachKeys(cb, at0, yaw, SEAT_FAR), sit: sits(cb) ? { ib: cb, at: at0, yaw, y: room.y } : null, room: room.id, name: ch.name });
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
      let why = 'no pose fits', box = null, boxes = [], at = null, yaw = 0, placedSlides = null;
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
        // each seat and bed must be got on and off as the use-check does it (lane FUZZ2): from a standing spot beside it, on a
        // free cell of the walk raster reached from a door, a body slides onto it clear of the walls, rails, stairs and other
        // pieces. That holds for this piece and still for every seat and bed already placed (a chest at a cabin bed's only
        // free side, a chair at a stairwell rail facing it).
        let slides = [], held = [];
        if (solid) {
          const others = (except) => taken.filter((t) => t.floor === room.floor && t.solid && t !== except).flatMap((t) => t.boxes);
          if (sits(ib)) slides = seatSlides(ib, pose, r3(fyaw + th), room.y, [...baked.colliders, ...others(null)]);
          if (slides.some((pts) => !pts.length)) { why = 'no way on or off its seat or bed'; continue; }
          // a placed seat's spots only ever shrink as pieces are added: keep those this pose leaves (the same candidates,
          // tested against its boxes alone), for the seats near enough to be touched
          const near = (t) => Math.hypot(t.sit.at[0] - pose[0], t.sit.at[1] - pose[1]) < Math.hypot(hx, hz) + Math.hypot(t.sit.ib.box[0], t.sit.ib.box[2]) / 2 + 1.2;
          held = taken.filter((t) => t.room === room.id && t.sit).map((t) => {
            t.sit.slides ??= seatSlides(t.sit.ib, t.sit.at, t.sit.yaw, t.sit.y, [...baked.colliders, ...others(t)]);
            if (!near(t)) return { t, slides: t.sit.slides };
            return { t, slides: seatSlidesLeft(t.sit.ib, t.sit.at, t.sit.yaw, t.sit.y, actual, t.sit.slides) };
          });
          const shut = held.find((h) => h.slides.some((pts) => !pts.length));
          if (shut) { why = `would shut the way on or off ${shut.t.name}`; continue; }
        }
        if (solid && keysOf(room).length) {
          // the doors, stair ends and standing pieces' approaches keep every way they had, and this piece's own approach
          // is reached from a door
          // one grid per room past its walls and the standing pieces' footprints (as the walk grid sees them), grown piece by
          // piece (taken only grows); each pose adds its own box to it
          const standing = taken.filter((t) => t.floor === room.floor && t.solid);
          let w = ways.get(room.id);
          if (!w) ways.set(room.id, w = { n: 0, grid: wayGrid(room, baked.colliders.filter((o) => o.y0 < room.y + 1.6 && o.y1 > room.y + 0.15), way) });
          if (!w.keys || w.n !== standing.length) {
            for (const t of standing.slice(w.n)) w.grid = w.grid.plus(t.foot);
            w.n = standing.length; w.keys = [...keysOf(room), ...standing.flatMap((t) => t.approach)]; w.was = w.grid.labels(w.keys, w.at = { cells: [] });
          }
          const own = approachKeys(ib, pose, r3(fyaw + th)), seats = [...slides, ...held.flatMap((h) => h.slides)];
          const spotR = way.pose ? SPOT_R : SPOT_R + RASTER_SLOP.conservative, spots = seats.flat().map((q) => ({ pts: [q], r: spotR }));
          const { keys, was } = w, now = w.grid.plus(bx).labels([...keys, ...own, ...spots], { cells: w.at.cells });
          const doorLabel = new Set(keysOf(room).map((_, i) => now[i]));
          // a piece is reached at its approach (the free spot nearest its front), where the walk audit sends a Soul; laid out
          // with no world pose (library contents, vocab-w3 layOut) a seat or a bed is reached at its standing spots (below)
          // instead: the exact-clearance grid's front key there dropped every dining and school chair. (Placed in the world,
          // the relaxed rule put 166 more pieces in the fuzz walk world, 65 of them bad: chapel pews, office and townhouse
          // seats and beds whose front stands in a pocket; the engine's seatApproach stands a body at the first clear spot.)
          const doorsReach = (sits(ib) && !way.pose) || now.slice(keys.length, keys.length + own.length).every((l) => doorLabel.has(l));
          if (pairsOf(now, keys.length) < pairsOf(was) || !doorsReach) { why = doorsReach ? 'would cut the way to its doors or another piece' : 'no way to it from the doors'; continue; }
          const owner = [...slides.map(() => null), ...held.flatMap((h) => h.slides.map(() => h.t.name))];
          let k = keys.length + own.length;
          const stranded = seats.findIndex((pts) => { const ok = pts.some((_, j) => doorLabel.has(now[k + j])); k += pts.length; return !ok; });
          if (stranded >= 0) { why = owner[stranded] ? `would shut the way on or off ${owner[stranded]}` : 'no way on or off its seat or bed'; continue; }
        }
        for (const h of held) h.t.sit.slides = h.slides;
        box = bx; boxes = candidate; at = p; yaw = fyaw + th; placedSlides = slides; break;
      }
      if (!box) { dropped.push({ name, why }); continue; }
      const at1 = [room.origin[0] + r3(at[0] - room.origin[0]), room.origin[1] + r3(at[1] - room.origin[1])];
      taken.push({ floor: room.floor, boxes, solid: ib.box[1] > 0.06, foot: box, approach: approachKeys(ib, at1, r3(yaw), SEAT_FAR), sit: sits(ib) && ib.box[1] > 0.06 ? { ib, at: at1, yaw: r3(yaw), y: room.y, slides: placedSlides ?? undefined } : null, room: room.id, name });
      const tmp = `$f${ops.length}`.slice(0, 25);
      named[it.name ?? 'item'] = { tmp };
      ops.push({ op: 'place', tmp, def: ref, name, in: { parent: b.id, slot: room.id }, p: [r3(at[0] - room.origin[0]), 0, r3(at[1] - room.origin[1])], r: r3(yaw), ...(it.params ? { params: it.params } : {}), ...(it.price ? { price: it.price } : {}) });
      placed.push({ name, def: ref, room: room.id });
    }
  }
  notes.unshift(`furnish ${model.pathOf(b.id)} (${st}): ${placed.length} pieces in ${new Set(placed.map((p) => p.room)).size} rooms, ${dropped.length} dropped`);
  return { ops, placed, dropped, notes };
}
