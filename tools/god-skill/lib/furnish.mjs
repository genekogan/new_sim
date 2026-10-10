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
// earlier item are dropped and reported.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { obbOverlap } from '../../../packages/world-compiler/src/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const RECIPES = resolve(here, '../recipes/furnish');
const FRONT_YAW = { s: 0, e: Math.PI / 2, n: Math.PI, w: -Math.PI / 2 };
const FACE_YAW = { s: 0, e: Math.PI / 2, n: Math.PI, w: -Math.PI / 2 };
const r3 = (v) => Math.round(v * 1000) / 1000;

export function loadRecipe(style) {
  const file = resolve(RECIPES, `${style}.json`);
  if (!existsSync(file)) return JSON.parse(readFileSync(resolve(RECIPES, 'cottage.json'), 'utf8'));
  return JSON.parse(readFileSync(file, 'utf8'));
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
  const recipe = opts.recipe ?? loadRecipe(st);
  const th = def.make?.kind === 'gen' && def.make.gen === 'building/1' && !(b.params?.plan) ? FRONT_YAW[b.params?.front ?? def.params?.front?.default ?? 's'] ?? 0 : 0;
  const c = Math.cos(th), s = Math.sin(th);
  const R = ([x, z]) => [x * c + z * s, -x * s + z * c];         // canonical → def frame
  const Ri = ([x, z]) => [x * c - z * s, x * s + z * c];         // def frame → canonical
  const existing = new Set([...(model.children.get(b.id) ?? [])].map((id) => model.entities.get(id)?.name).filter(Boolean));
  const ops = [], placed = [], dropped = [], notes = [];
  const taken = [];   // accepted item OBBs in the def frame, with floor
  const doors = (baked.openings ?? []).filter((o) => o.kind === 'door' || o.kind === 'arch');
  const ends = (baked.links ?? []).flatMap((l) => [{ p: l.path[0], level: l.from }, { p: l.path[l.path.length - 1], level: l.to }]);
  const defOf = (alts) => (Array.isArray(alts) ? alts : [alts]).map((ref) => [ref, model.resolvedDef(ref)]).find(([, d]) => d);
  const want = opts.rooms ? new Set(opts.rooms) : null;
  // pieces already in the building's rooms are obstacles too
  for (const cid of model.children.get(b.id) ?? []) {
    const ch = model.entities.get(cid), room = baked.rooms.find((r) => r.id === ch?.in.slot);
    if (!ch || !room) continue;
    const cd = model.resolvedDef(ch.def); if (!cd || cd.layer !== 'solid') continue;
    const cb = model.bake(cd, ch.params ?? {}, ch.seed ?? 0), lp = ch.p ?? [0, 0], lx = lp[0], lz = lp[lp.length - 1];
    const yaw = typeof ch.r === 'number' ? ch.r : Array.isArray(ch.r) ? ch.r[0] : 0;
    taken.push({ floor: room.floor, solid: cb.box[1] > 0.06, box: { c: [room.origin[0] + lx, room.origin[1] + lz], half: [cb.box[0] / 2, cb.box[2] / 2], yaw, y0: room.y, y1: room.y + cb.box[1] } });
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
        ops.push({ op: 'place', def: ref, name, in: { parent: host.tmp, slot: it.slot ?? 'top' } });
        placed.push({ name, def: ref, room: room.id, on: it.on });
        continue;
      }
      const ib = model.bake(idef, {}, 0);
      const k = round ? 0.7 : 1, cxm = (x0 + x1) / 2, czm = (z0 + z1) / 2;
      const ax0 = cxm - ((cxm - x0) * k), ax1 = cxm + ((x1 - cxm) * k), az0 = czm - ((czm - z0) * k), az1 = czm + ((z1 - czm) * k);
      // candidate poses: `try` lists [fx, fz, face] in order of preference; the first clear one wins
      const tries = it.try ?? [[...(it.at ?? [0.5, 0.5]), it.face ?? 's']];
      let why = 'no pose fits', box = null, at = null, yaw = 0;
      for (const [fx, fz, face = 's'] of tries) {
        const fyaw = FACE_YAW[face] ?? 0, turned = face === 'e' || face === 'w';
        const hx = (turned ? ib.box[2] : ib.box[0]) / 2 + 0.04, hz = (turned ? ib.box[0] : ib.box[2]) / 2 + 0.04;
        if (ax1 - ax0 < 2 * hx || az1 - az0 < 2 * hz) { why = 'too big for the room'; continue; }
        const cc = [ax0 + hx + fx * (ax1 - ax0 - 2 * hx), az0 + hz + fz * (az1 - az0 - 2 * hz)];
        const p = R(cc);
        const bx = { c: p, half: [hx - 0.04, hz - 0.04], yaw: th, y0: room.y + 0.01, y1: room.y + Math.max(0.05, ib.box[1]) };
        const solid = ib.box[1] > 0.06;
        const hit = baked.colliders.find((o) => obbOverlap(bx, o));
        if (hit) { why = `would cross ${hit.tag ?? 'a wall'}`; continue; }
        // keep a clear zone 0.8 m deep either side of every doorway, and 0.5 m round the ends of the stairs
        const zone = (d) => ({ c: d.at, half: [d.width / 2 + 0.1, 0.8], yaw: d.yaw, y0: room.y, y1: room.y + 2 });
        if (solid && doors.some((d) => d.level === room.floor && obbOverlap(bx, zone(d)))) { why = 'in a doorway'; continue; }
        if (ends.some((e) => e.level === room.floor && obbOverlap(bx, { c: e.p, half: [0.5, 0.5], yaw: 0, y0: room.y, y1: room.y + 2 }))) { why = 'at the foot or head of the stairs'; continue; }
        if (solid && taken.some((t) => t.floor === room.floor && t.solid && obbOverlap(bx, t.box))) { why = 'overlaps another piece'; continue; }
        box = bx; at = p; yaw = fyaw + th; break;
      }
      if (!box) { dropped.push({ name, why }); continue; }
      taken.push({ floor: room.floor, box, solid: ib.box[1] > 0.06 });
      const tmp = `$f${ops.length}`.slice(0, 25);
      named[it.name ?? 'item'] = { tmp };
      ops.push({ op: 'place', tmp, def: ref, name, in: { parent: b.id, slot: room.id }, p: [r3(at[0] - room.origin[0]), 0, r3(at[1] - room.origin[1])], r: r3(yaw) });
      placed.push({ name, def: ref, room: room.id });
    }
  }
  notes.unshift(`furnish ${model.pathOf(b.id)} (${st}): ${placed.length} pieces in ${new Set(placed.map((p) => p.room)).size} rooms, ${dropped.length} dropped`);
  return { ops, placed, dropped, notes };
}
