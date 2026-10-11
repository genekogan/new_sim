#!/usr/bin/env node
// Build the Mars 2026 campus as library defs (Gene 2026-10-11: everything compositional, reusable by any god).
//
//   node tools/god-skill/scripts/mars-two/build.mjs [--only <regex>]
//
// Source: the private V3 campus GLB from Codex's Mars handover (team/pm-integration/mars-handover-20261010/), which
// carries Gene's corrected Mimos / Chiba kitchen layout (USER-MARS-CORRECTION-20261010.md) and the furnished 2026 recipe
// that sim.mars.college shows. Output (deterministic):
//   worlds/core-assets/mars/<name>.glb (+ <name>.footprint.json)   — one per building, furniture kind, item, site object
//   worlds/core-assets/mars/index.part.json                           — merged into worlds/core-assets/index.json by import-packs
//   packages/world-compiler/src/core-kit/mars.json                    — the defs: core-mars-<name> → core/mars-<name>@1
//   worlds/core-assets/mars/placements.json                           — where each piece stood (the mars-two template uses it)
//
// Pieces
// - Buildings: Mimos, the Chiba kitchen + dining hall, the two northeast shower bays (Gene's corrections; rooms, walls,
//   doors and stairs authored in layout.mjs), the rest of Chiba (hall + auditorium), the Dojo, Tool camp, Freeside
//   compound and the west rack building. Each building's remaining contents stay in its mesh (exactly as the reference
//   draws them) and become obstacles in its footprint.
// - Furniture and items: every seat, table, counter and appliance of Mimos, the kitchen, the diner, the auditorium and the
//   field, cut out as its own def (seat / surface slots, carryable bowls and pots), deduplicated by shape, turned so
//   its front faces +z, and placed back where it stood.
// - Site objects: everything else on the campus (vans, buses, trailers, RVs, toilets, the forklift, OG, tents…) as one
//   def per connected object, deduplicated by shape.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT, readV3, indexNodes, cut, v3ToLocal, mul, rotY, translate, xz, X0, minRect, nodePoints, rectOverlap, NORTH, EAST, O, core, ext, MeshoptEncoder } from './v3.mjs';
import { ROOMS, WALLS, DOORS, STAIRS, RAISED, ENTRANCES, TERRACES, ROOM_AT, LOFTS, LOFT_Y, FIXTURES, STAIR_RUN, REPLACED } from './layout.mjs';

const { measureGlb, footprintToBaked } = await import(join(ROOT, 'apps/server/src/god/assets.ts'));
const OUT = join(ROOT, 'worlds/core-assets/mars');
const KIT = join(ROOT, 'packages/world-compiler/src/core-kit/mars.json');
const only = (() => { const i = process.argv.indexOf('--only'); return i > 0 ? new RegExp(process.argv[i + 1]) : null; })();
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const r3 = (v) => Math.round(v * 1000) / 1000;
const r4 = (v) => Math.round(v * 10000) / 10000;
const LICENSE = 'Mars College (Gene Kogan); campus CAD and the 2026 photographic recipe; private to this project';
const SOURCE = 'V3 Mars 2026 campus (scene_7d4cac4a…glb, Codex Mars handover 2026-10-10, Gene\'s Oct 10 corrections)';
const RAW_FLOOR = 0.53;

console.time('read');
const src = await readV3();
const rows = indexNodes(src);
console.timeEnd('read');
const byI = new Map(rows.map((r) => [r.i, r]));
const NODES = src.doc.getRoot().listNodes();
const ptsCache = new Map();
const pts = (r) => { let p = ptsCache.get(r.i); if (!p) { p = nodePoints(NODES[r.i]); ptsCache.set(r.i, p); } return p; };
const rectOf = (r) => (r.rect ??= minRect(pts(r)));
const groupRect = (rs) => minRect(rs.flatMap((r) => { const q = rectOf(r), c = Math.cos(q.yaw), s = Math.sin(q.yaw); return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [q.c[0] + i * q.half[0] * c + j * q.half[1] * s, q.c[1] - i * q.half[0] * s + j * q.half[1] * c]); }));
// mars-two coordinates of a row's box (yaw-0 frame): x = E + X0, z = −N
const X = (r) => [r.e0 + X0, r.e1 + X0], Z = (r) => [-r.n1, -r.n0];

// ------------------------------------------------------------------ who belongs where
const TOP = { 2: 'chiba', 8158: 'chiba', 2724: 'dojo', 3014: 'tool-camp', 4047: 'freeside', 7962: 'west-racks', 6121: 'people' };
const topOf = (r) => { for (const a of r.anc) if (TOP[a]) return TOP[a]; return TOP[r.i] ?? 'site'; };
const inRect = (r, n0, n1, e0, e1) => r.cn >= n0 && r.cn <= n1 && r.ce >= e0 && r.ce <= e1;
function buildingOf(r) {
  const t = topOf(r);
  if (t !== 'chiba') return t;
  const a = r.asm ?? '';
  if (a.startsWith('mimos-northeast-shower')) return 'showers';
  if (a === 'kitchen-details') return 'kitchen';
  if (a.startsWith('mimos-')) return a === 'mimos-open-l' && r.ce < -4.73 ? 'kitchen' : 'mimos';
  if (inRect(r, -1.85, 5.95, -4.73, 3.7)) return 'mimos';
  if (inRect(r, -1.85, 5.95, -11.8, -4.73)) return 'kitchen';
  return 'chiba';
}

// ------------------------------------------------------------------ furniture and items
// Assemblies whose things are furniture / items Souls use (the rest of those assemblies stays in the building mesh).
const FURN_ASM = /^(mimos-home|mimos-details|mimos-source-west-entry-sofa|mimos-source-east-back-sofa|mimos-cream-recliner|kitchen-details|auditorium-2026-furnishings|chiba-gallery-life|chiba-field-seating|field-chair|field-teal-sofa)/;
const STRUCT = /wall|door|partition|jamb|header|window|glazing|pier|sill|hatch|fascia|cable|bulb|socket|globe|festoon|string|cleat|patch|pegboard|gong|sign|gallery|screen|panel|batten|seam|drape|runner|installation|portrait|projector|partition|rug|whiteboard|marker|bracket|backing|lens|light/i;
const SEAT = /chair|stool|sofa|recliner|papasan|bus seat|bus cushion|box seat|tier cushion|floor cushion|mattress|seat/i;
const TABLE = /table ?top|tabletop|counter|prep top|desk|worktop|serving shelf|long shelf|sink counter|dinner table|folding table|DJ table|bench|timber shelf/i;
const COLD = /refrigerator|freezer|fridge/i;
const ITEM = /mixing bowl|stock pot|table cup|table kettle|kettle handle|ceramic mug|ceramic cup|study mug|chopping board|electric kettle/i;

// Furniture parity with sim.mars.college (its add2026Details recipe is in V3): the rest of the campus's furnished rooms —
// CoLab, Freeside's open-mic room and hydro cart, the OG clubhouse / east table / kitchen, the Tool library and workshop,
// Mimos's west coffee table — are cut out as library defs too (not left inside the building and site meshes).
const MORE_ASM = /^(colab-2026-roof-access|freeside-2026-observed-details|freeside-north-hydro-cart|og-clubhouse-details|og-east-life|og-kitchen-details|og-ground-details|tool-2026-library)$/;
const MORE_KIND = /sofa|chair|table|stool|cushion|mattress|shel(f|ves)|bench|stove|sink|speaker|lamp|spool|cart|vise|net pot|griddle|counter|DJ|laptop|cup|book|basin|worktop/i;
// FURN: the auditorium's projector table with its projector and purple runner is a table Souls can use (STRUCT's
// projector / runner / drape words had left it inside Chiba's mesh)
const KEEP = /auditorium projector table|auditorium white projector|projector lens facing existing screen|auditorium purple (table runner|runner drape)/i;
function furnitureRows() {
  return rows.filter((r) => r.asm && (!STRUCT.test(r.kind ?? '') || KEEP.test(r.kind ?? '')) && r.y1 > 0.02 && topOf(r) !== 'people' && FURN_ASM.test(r.asm));
}
const isMore = (r) => r.asm && r.y1 > 0.02 && topOf(r) !== 'people' && (!STRUCT.test(r.kind ?? '') || /table panel/i.test(r.kind ?? ''))
  && ((MORE_ASM.test(r.asm) && r.layer === 'Interior details' && MORE_KIND.test(`${r.kind ?? ''} ${r.name ?? ''}`))
    || (r.asm === 'mimos-open-l' && /west coffee table|coffee tablet/i.test(`${r.kind ?? ''} ${r.name ?? ''}`)));
// connected objects: boxes that overlap (2 cm tolerance), never across buildings
function clusters(list, tol = 0.02, key = () => '', oriented = false) {
  const parent = list.map((_, i) => i), find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j]; if (key(a) !== key(b)) continue;
    if (a.n0 - tol < b.n1 && b.n0 - tol < a.n1 && a.e0 - tol < b.e1 && b.e0 - tol < a.e1 && a.y0 - tol < b.y1 && b.y0 - tol < a.y1 && (!oriented || rectOverlap(rectOf(a), rectOf(b), tol))) parent[find(i)] = find(j);
  }
  const g = new Map(); list.forEach((r, i) => { const k = find(i); if (!g.has(k)) g.set(k, []); g.get(k).push(r); });
  return [...g.values()];
}
const boxOf = (rs) => ({ n0: Math.min(...rs.map((r) => r.n0)), n1: Math.max(...rs.map((r) => r.n1)), e0: Math.min(...rs.map((r) => r.e0)), e1: Math.max(...rs.map((r) => r.e1)), y0: Math.min(...rs.map((r) => r.y0)), y1: Math.max(...rs.map((r) => r.y1)) });

// The 29 numbered objects (handover) → their stable component ids and names
const REF = JSON.parse(readFileSync('<team>/pm-integration/mars-handover-20261010/MIMOS-ASSET-PLACE-REFERENCES.json', 'utf8'));
const NUMBERED = new Map(REF.numberedObjects.map((o) => [o.componentId, o]));
const NUMBER_NAMES = { 1: 'coffee-counter', 2: 'tea-table', 3: 'study-table', 4: 'study-chair', 5: 'study-chair', 6: 'study-chair', 7: 'study-chair', 8: 'papasan', 9: 'tea-stool', 10: 'tea-stool', 11: 'tea-stool', 12: 'red-sofa', 13: 'honey-sofa', 14: 'cream-recliner', 15: 'prep-table', 16: 'sink', 17: 'sink', 18: 'commercial-fridge', 19: 'chest-freezer', 20: 'bus-seat', 21: 'bus-seat', 22: 'bus-seat', 23: 'bus-seat', 24: 'bus-seat', 25: 'bus-seat', 26: 'diner-table', 27: 'diner-table', 28: 'diner-table', 29: 'white-fridge' };

function classify(rs) {
  const kinds = rs.map((r) => r.kind ?? r.name ?? '').join(' | ');
  const nums = rs.map((r) => NUMBERED.get(r.comp) ?? NUMBERED.get(r.asm)).filter(Boolean).map((o) => o.number);
  if (rs.every((r) => ITEM.test(r.kind ?? ''))) return { cat: 'item', kinds, nums };
  if (COLD.test(kinds)) return { cat: 'cold', kinds, nums };
  if (SEAT.test(kinds) && !/table ?top|tabletop|prep top/i.test(kinds)) return { cat: 'seat', kinds, nums };
  if (TABLE.test(kinds) || /table/i.test(kinds)) return { cat: 'table', kinds, nums };
  // a free-standing thing that is none of those (a floor lamp, a speaker on its tripod, the hydro cart, a camp stove)
  if (/lamp|speaker|cart|stove|vise|spool|net pot/i.test(kinds)) return { cat: 'prop', kinds, nums };
  return { cat: 'decor', kinds, nums };
}
// facing of a seat: from its back toward its middle
function facingOf(rs) {
  const b = boxOf(rs), c = [(b.n0 + b.n1) / 2, (b.e0 + b.e1) / 2];
  const back = rs.filter((r) => /back|backrest|slat|upright|rim/i.test(r.kind ?? '') && !/backsplash/i.test(r.kind ?? ''));
  if (!back.length) return 0;
  const bb = boxOf(back), bc = [(bb.n0 + bb.n1) / 2, (bb.e0 + bb.e1) / 2];
  const dN = c[0] - bc[0], dE = c[1] - bc[1];
  if (Math.hypot(dN, dE) < 0.03) return 0;
  // world direction (x = E, z = −N); yaw that faces (dx, dz) = atan2(dx, dz); snap to 1°
  return Math.round(Math.atan2(dE, -dN) * 180 / Math.PI) * Math.PI / 180;
}
// a name for a cluster: the numbered object's, else a cleaned kind
function nameOf(rs, cat) {
  const num = rs.map((r) => NUMBERED.get(r.comp) ?? NUMBERED.get(r.asm)).find(Boolean);
  if (num) return NUMBER_NAMES[num.number];
  const re = cat === 'seat' ? SEAT : cat === 'table' ? TABLE : cat === 'cold' ? COLD : cat === 'prop' ? /lamp|speaker|cart|stove|vise|spool|net pot/i : ITEM;
  // the part that names the object: a top / seat / body before a leg or a foot
  const cand = rs.filter((r) => re.test(r.kind ?? '')), main = cand.find((r) => /top|seat|base|body|shade|cushion|mattress/i.test(r.kind ?? '') && !/leg|foot|feet/i.test(r.kind ?? '')) ?? cand[0] ?? rs[0];
  if (cat === 'table' && /west coffee table|shared coffee tablet/i.test(main.kind ?? '')) return 'mimos-coffee-table';
  if (cat === 'table' && /projector table/i.test(main.kind ?? '')) return 'projector-table';
  let n = (main.kind ?? main.name).toLowerCase().replace(/\b(mimos|kitchen|diner|auditorium|chiba|source|photographed|commissary|native|fitted|loose|adjacent|continued|upper|northwest|west|left|right|rear|front|study|shared|photo|observed|occupied|separate|grounded|slender|short|performer|open mic|portable|draped|black|pale|brown|white|side)\b/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  for (let i = 0; i < 3; i++) n = n.replace(/-(top|cabinet|carcass|cushion|base|seat|back|plinth|tabletop|body|leg|legs|foot|feet|arm|core|rail|upright|frame|crossed|mast|shade|stand|panel|edge|support|bottom|side)$/g, '');
  if (/floor-cushion|floor$/.test(n) && /cushion/i.test(main.kind ?? '')) n = n.replace(/-floor$/, '-floor-cushion');
  if (n.length > 30) n = n.slice(0, 30).replace(/-[^-]*$/, '');
  return n || cat;
}

// A shape signature in an object's own frame (dedups repeated chairs, stools, bus seats, tables, vans), tolerant to
// small yaw estimation differences; also tried turned half a turn (a van parked the other way round).
const MESHES = src.doc.getRoot().listMeshes();
const sigOf = (g, frame) => sha256(JSON.stringify(g.map((r) => { const n = NODES[r.i], m = mul(frame, n.getWorldMatrix()); return [MESHES.indexOf(n.getMesh()), m.slice(0, 12).map((v) => Math.round(v * 10) / 10), m.slice(12, 15).map((v) => Math.round(v * 5) / 5)]; }).map((x) => JSON.stringify(x)).sort()));

// ------------------------------------------------------------------ footprints
const wallObb = (id, n0, n1, e0, e1, y0, y1, o) => ({ id, kind: 'wall', obb: { c: [r4((e0 + e1) / 2 + X0 - o[0]), r4(-(n0 + n1) / 2 - o[2])], half: [r4(Math.max(0.03, (e1 - e0) / 2)), r4(Math.max(0.03, (n1 - n0) / 2))], yaw: 0 }, y0: r4(y0 - o[1]), y1: r4(y1 - o[1]) });
// obstacles from mesh contents: things standing on the floor a body could walk into (not roofs, floors, high beams)
function contentObstacles(rs, o, floorY = 0) {
  const out = [];
  // (floors, treads and thresholds are walked: the footprint's floors and links carry them; an open door leaf swings: people push past it, so it is drawn but never an obstacle — the diner's blue door leaf
  // and bus seat #20 otherwise sealed the dining hall off from its own door)
  const solid = rs.filter((r) => r.y0 < floorY + 1.7 && r.y1 > floorY + 0.25 && !/Roofs and upper floors|Timber, floors and stairs/.test(r.layer ?? '') && !/rug|mat floor|floor slab|plywood floor|cable|bulb|globe|festoon|string|lens/i.test(r.kind ?? '') && !/door.*leaf|open .*door|door open/i.test(`${r.name ?? ''} ${r.kind ?? ''}`) && (r.n1 - r.n0) * (r.e1 - r.e0) < 40);
  for (const [k, g] of clusters(solid, 0.03, () => '', true).entries()) {
    const R = groupRect(g); if (R.half[0] < 0.02 && R.half[1] < 0.02) continue;
    // a sparse cluster (a fence line, a rack bay's posts and beams with an open door leaf against them): one box per
    // member instead — merged, Mimos's rear alcove became a 1.9 × 1 m block across its own door
    const area = 4 * R.half[0] * R.half[1], sum = g.reduce((s, r) => s + Math.max(0.01, 4 * rectOf(r).half[0] * rectOf(r).half[1]), 0);
    const parts = area > 0.6 && sum < area * 0.5 ? g.map((r) => [rectOf(r), r.y0, r.y1]) : [[R, Math.min(...g.map((r) => r.y0)), Math.max(...g.map((r) => r.y1))]];
    parts.forEach(([q, y0, y1], j) => out.push({ id: `obj-${k}${parts.length > 1 ? '.' + j : ''}`, kind: 'solid', obb: { c: [r4(q.c[0] - o[0]), r4(q.c[1] - o[2])], half: [r4(Math.max(0.03, q.half[0])), r4(Math.max(0.03, q.half[1]))], yaw: r4(-q.yaw) }, y0: r4(Math.max(floorY, y0) - o[1]), y1: r4(Math.min(y1, floorY + 2.2) - o[1]) }));
  }
  return out;
}
function authoredFootprint(b, o, box, contents) {
  const rect = ([id, label, n0, n1, e0, e1, y]) => ({ id, label, level: y > 0.35 ? 1 : 0, y0: y, y1: y + 2.4, polygon: [[e0, -n1], [e1, -n1], [e1, -n0], [e0, -n0]].map(([e, z]) => [r4(e + X0 - o[0]), r4(z - o[2])]) });
  const rooms = (ROOMS[b] ?? []).map(rect).map((r) => ({ ...r, y0: r4(r.y0 - o[1]), y1: r4(r.y1 - o[1]) }));
  const obstacles = [...(WALLS[b] ?? []).map(([id, ...a]) => wallObb(id, ...a, o)), ...contents];
  const portals = (DOORS[b] ?? []).map(([id, n, e, nn, ne_, w, y0, y1]) => ({ id, kind: y0 > 1 ? 'window' : 'door', level: y0 > 0.35 && y0 < 1 ? 1 : 0, center: [r4(e + X0 - o[0]), r4((y0 + y1) / 2 - o[1]), r4(-n - o[2])], normal: [ne_, 0, -nn], width: w, y0: r4(y0 - o[1]), y1: r4(y1 - o[1]) }));
  const links = (STAIRS[b] ?? []).map(([id, a, z, w]) => ({ id, kind: 'stairs', width: w, from: { level: a[2] > 0.35 ? 1 : 0, y: r4(a[2] - o[1]) }, to: { level: z[2] > 0.35 ? 1 : 0, y: r4(z[2] - o[1]) }, path: [a, z].map(([n, e, y]) => [r4(e + X0 - o[0]), r4(y - o[1]), r4(-n - o[2])]) }));
  const terraces = (TERRACES[b] ?? []).map(([id, n0, n1, e0, e1, y]) => ({ id, level: y > 0.35 ? 1 : 0, y: r4(y - o[1]), polygon: [[e0, -n1], [e1, -n1], [e1, -n0], [e0, -n0]].map(([e, z]) => [r4(e + X0 - o[0]), r4(z - o[2])]) }));
  // MARSLIVED: rack-deck floors (the Tool library loft), turned with the rack grid, in mars-two coordinates
  for (const [id, c, [hu, hv], yaw, y] of LOFTS[b] ?? []) {
    const u = [Math.cos(yaw), -Math.sin(yaw)], v = [Math.sin(yaw), Math.cos(yaw)];
    terraces.push({ id, level: 2, y: r4(y - o[1]), polygon: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [r4(c[0] + i * hu * u[0] + j * hv * v[0] - o[0]), r4(c[1] + i * hu * u[1] + j * hv * v[1] - o[2])]) });
  }
  const levels = [{ id: 0, y: 0 }, { id: 1, y: RAISED }, ...(LOFTS[b]?.length ? [{ id: 2, y: LOFT_Y }] : [])];
  return { schema: 'lm-building-footprint/1', id: `mars-${b}`, name: b, bounds: { min: [-box[0] / 2, 0, -box[2] / 2], max: [box[0] / 2, box[1], box[2] / 2] }, levels, rooms, obstacles, portals, links, ...(terraces.length ? { terraces } : {}) };
}

// ------------------------------------------------------------------ build
mkdirSync(OUT, { recursive: true });
const index = {}, defs = [], placements = [], written = new Set();
// FURN: worlds made from a released mars-two keep their defs (name@version) and the asset shas those name; a rebuilt
// piece must not orphan them (Gene's my-mars-college-2026, made at e6613f11, names three footprints MARSLIVED rebuilt
// under the same names). versions.json lists the released commits: every asset of theirs this build no longer writes
// is kept byte-exact under legacy/ and stays in the index.
const VER = join(OUT, 'versions.json');
const ledger = existsSync(VER) ? JSON.parse(readFileSync(VER, 'utf8')) : { schema: 'mars-def-versions/1', releases: [], defs: {} };
const record = (bytes, file, kind, extra) => {
  const sha = sha256(bytes), path = relative(ROOT, file);
  writeFileSync(file, bytes); written.add(file);
  if (kind === 'footprint') index[sha] = { ext: 'json', kind, path, tris: 0, bytes: bytes.byteLength, textures: 0, texPx: 0, box: extra.baked.box, baked: extra.baked, name: extra.name, license: LICENSE, source: SOURCE };
  else { const m = measureGlb(bytes); index[sha] = { ext: 'glb', kind: 'mesh', path, tris: m.tris, bytes: m.bytes, textures: m.textures, texPx: m.texPx, box: m.box, min: m.min, animations: [], nodes: [], extensions: m.extensions, name: extra.name, license: LICENSE, source: SOURCE, ...(extra.footprint ? { footprint: extra.footprint } : {}) }; }
  return sha;
};
const def = (name, d) => ({
  schema: 'def/1', name: `core-mars-${name}`, version: 1,
  description: `${d.description} Licence: ${LICENSE}. Source: ${SOURCE}.`,
  tags: [...new Set(['mars', 'mars-campus', 'mesh', ...d.tags])].slice(0, 32), form: 'point',
  make: { kind: 'mesh', asset: d.asset, collide: d.layer === 'decor' ? 'none' : 'box', ...(d.footprint ? { footprint: d.footprint } : {}) },
  size: { box: d.box.map((v) => Math.max(0.05, r3(v))), scale: d.scale ?? [0.5, 2] },
  layer: d.layer ?? 'solid', anchor: 'base',
  ...(d.slots ? { slots: d.slots } : {}),
  // placed where the reference has it, at its own height (footings below the ground stay below it: no terrain pad)
  components: { ...(d.components ?? {}), foundation: { kind: 'none' } },
  ...(d.overlaps ? { overlaps: d.overlaps } : {}),
});

// 1. furniture and items (cut first: the buildings exclude them)
const taken = new Set(), furnBoxes = [];
const furn = furnitureRows();
const SEATF = /chair|stool|sofa|recliner|papasan|bus seat|bus cushion|seat|tier cushion|throw cushion|floor cushion|mattress|box seat/i;
const TOPF = /table ?top|tabletop|counter top|counter return|counter lip|prep top|desk$|long shelf|serving shelf|inside counter/i;
const groups = [];
// the rest of the campus's furniture: parts of one object (a folding chair's seat, back and crossed legs; a table's legs,
// inset panels and the books on it) lie a few cm apart in the recipe, so they are joined with a wider tolerance
// the rest of the campus's furniture: parts of one object lie a few cm apart (a folding chair's seat, back and crossed
// legs; a table's legs, inset panels and the books on it), and neighbouring objects touch (three chairs in a row by a
// folding table). Join by overlap with a wider tolerance, split seats from tables, then split each family at its
// anchors (a chair's seat, a sofa's base, a table's top, a mattress, a speaker…): every other part goes to the nearest.
const ANCHOR = /chair seat|sofa seat|sofa base|tabletop|table top|\bmattress\b|floor cushion|speaker$|lamp shade|vise base|dinner table$|folding table$|camp stove/i;
const more = rows.filter(isMore);
for (const g0 of clusters(more, 0.15, (r) => `${buildingOf(r)}|${ITEM.test(r.kind ?? '') ? 'item' : ''}`)) {
  const fam = (r) => (SEATF.test(r.kind ?? '') ? 's' : 't');
  for (const f of ['s', 't']) {
    const g = g0.filter((r) => fam(r) === f); if (!g.length) continue;
    const anchors = g.filter((r) => ANCHOR.test(r.kind ?? ''));
    if (anchors.length < 2) { groups.push(g); continue; }
    const by = new Map(anchors.map((t) => [t.i, [t]]));
    for (const r of g) { if (by.has(r.i)) continue; let best = anchors[0], bd = Infinity; for (const t of anchors) { const d = Math.hypot(t.cn - r.cn, t.ce - r.ce); if (d < bd) { bd = d; best = t; } } by.get(best.i).push(r); }
    groups.push(...by.values());
  }
}
for (const g0 of clusters(furn, 0.05, (r) => `${buildingOf(r)}|${ITEM.test(r.kind ?? '') ? 'item' : ''}`)) {
  // a chair tucked under a table: split seats from the rest, then re-cluster each
  const fam = (r) => (SEATF.test(r.kind ?? '') || /chair|sofa|recliner|papasan|stool|bus seat/i.test(r.asm ?? '') ? 's' : 't');
  // (a row of folding chairs touching: split at the chair seats, every other part to the nearest seat)
  const anchorSplit = (g) => { const an = g.filter((r) => /chair seat/i.test(r.kind ?? '')); if (an.length < 2) return null; const by = new Map(an.map((t) => [t.i, [t]])); for (const r of g) { if (by.has(r.i)) continue; let best = an[0], bd = Infinity; for (const t of an) { const d = Math.hypot(t.cn - r.cn, t.ce - r.ce); if (d < bd) { bd = d; best = t; } } by.get(best.i).push(r); } return [...by.values()]; };
  const parts = anchorSplit(g0.filter((r) => fam(r) === 's')) && new Set(g0.map(fam)).size === 1 ? anchorSplit(g0)
    : new Set(g0.map(fam)).size > 1 ? ['s', 't'].flatMap((f) => (f === 's' && anchorSplit(g0.filter((r) => fam(r) === 's'))) || clusters(g0.filter((r) => fam(r) === f), 0.05, () => '', true)) : [g0];
  for (const g of parts) {
    // a U of counters (west, north and south runs): one piece per top, each with what stands under / on it
    const tops = g.filter((r) => TOPF.test(r.kind ?? ''));
    const R = g.length > 1 ? groupRect(g) : null, fill = R ? g.reduce((a, r) => a + 4 * rectOf(r).half[0] * rectOf(r).half[1], 0) / (4 * R.half[0] * R.half[1] + 1e-9) : 1;
    if (tops.length >= 2 && fill < 0.45) {
      const by = new Map(tops.map((t) => [t.i, [t]]));
      for (const r of g) { if (by.has(r.i)) continue; let best = tops[0], bd = Infinity; for (const t of tops) { const q = rectOf(t), c = rectOf(r).c, d = rectOverlap(q, rectOf(r), 0.06) ? 0 : Math.hypot(q.c[0] - c[0], q.c[1] - c[1]); if (d < bd) { bd = d; best = t; } } by.get(best.i).push(r); }
      groups.push(...by.values());
    } else groups.push(g);
  }
}
const kinds = new Map(); // signature → def name
let nFurn = 0;
for (const g of groups) {
  const c = classify(g); if (c.cat === 'decor') continue;
  const b = boxOf(g); if (b.y1 - b.y0 < 0.03) continue;
  const yaw = c.cat === 'seat' ? facingOf(g) : 0;
  const cx = (b.e0 + b.e1) / 2 + X0, cz = -(b.n0 + b.n1) / 2;
  const frame = mul(rotY(-yaw), mul(translate(-cx, 0, -cz), v3ToLocal(0, 0)));
  // shape signature: the source meshes and their frames (dedups the repeated chairs, stools, bus seats, tables)
  // (identical small items — the cups on a table — are one kind however they are turned)
  const sig = c.cat === 'item' ? sha256(JSON.stringify(['item', g.map((r) => (r.kind ?? '').replace(/[-_ ]?\d+$/, '')).sort(), [b.e1 - b.e0, b.y1 - b.y0, b.n1 - b.n0].map((v) => Math.round(v * 50)).sort()])) : sigOf(g, frame);
  let base = nameOf(g, c.cat);
  let dname = kinds.get(sig);
  const piece = await cut(src, g.map((r) => r.i), { name: base, frame, tex: 256, maxTris: 4000 });
  const p = [cx + Math.cos(yaw) * piece.shift[0] + Math.sin(yaw) * piece.shift[2], piece.shift[1], cz - Math.sin(yaw) * piece.shift[0] + Math.cos(yaw) * piece.shift[2]];
  if (!dname) {
    dname = base; let k = 2; while (defs.some((d) => d.name === `core-mars-${dname}`)) dname = `${base}-${k++}`;
    kinds.set(sig, dname);
    if (!only || only.test(dname)) {
      const file = join(OUT, `${dname}.glb`), asset = record(piece.bytes, file, 'mesh', { name: `mars-${dname}` });
      const [w, h, d] = piece.box;
      // (FURN: only parts that match; none matching → 0, never "0 − the piece's floor height": the Tool library low
      // table's top read −2.857 m and the auditorium cloth −1.127 m, so things put on them sank through the floor)
      const top = (re) => { const ys = g.filter((r) => re.test(r.kind ?? '')).map((r) => r.y1 - b.y0); return ys.length ? Math.max(0, ...ys) : 0; };
      // (seats keep their released heights: Souls' routes around the tea stools and the booths were planned with them)
      const seatTop = (re) => Math.max(...g.filter((r) => re.test(r.kind ?? '')).map((r) => r.y1), 0) - b.y0;
      let slots, components, tags = [], description, layer = 'solid';
      const numbered = c.nums.length ? ` Mars number #${c.nums.join(', #')} (handover stable ids).` : '';
      if (c.cat === 'seat') {
        const sh = r3(Math.min(h, Math.max(0.3, seatTop(/seat|cushion|plinth|base|pedestal|rim/i) || 0.45)));
        const n = /sofa|bench|bus/i.test(c.kinds) ? Math.max(1, Math.min(4, Math.round(w / 0.65))) : 1;
        slots = Array.from({ length: n }, (_, i) => ({ id: n === 1 ? 'seat' : `seat-${i + 1}`, kind: 'seat', p: [r3((i - (n - 1) / 2) * (w / n)), sh, r3(Math.min(0.1, d / 4))], yaw: 0, height: sh, accepts: { tags: ['body'] }, capacity: 1 }));
        components = { seat: { height: sh } }; tags = ['furniture', 'seat', ...(/sofa/i.test(c.kinds) ? ['sofa', 'couch'] : /stool/i.test(c.kinds) ? ['stool'] : /bus/i.test(c.kinds) ? ['bench', 'booth', 'diner'] : ['chair'])];
        description = `${dname.replace(/-/g, ' ')} from the Mars 2026 campus: ${n} seat${n > 1 ? 's' : ''} at ${sh} m.${numbered}`;
      } else if (c.cat === 'table') {
        const th = r3(Math.min(h, top(TABLE) || h));
        slots = [{ id: 'top', kind: 'surface', p: [0, th, 0], yaw: 0, height: th, accepts: { maxSize: [1.0, 0.6, 1.0], maxMass: 20 }, capacity: Math.max(4, Math.min(48, Math.round(w * d * 10))) }];
        components = { surface: { height: th } }; tags = ['furniture', 'table', 'surface', ...(/counter|prep|sink/i.test(c.kinds) ? ['kitchen', 'counter'] : [])];
        description = `${dname.replace(/-/g, ' ')} from the Mars 2026 campus: a ${r3(w)} × ${r3(d)} m top at ${th} m Souls put things on.${numbered}`;
      } else if (c.cat === 'cold') {
        components = { container: { capacity: 20 } }; tags = ['kitchen', 'fridge', 'cold', 'container'];
        description = `${dname.replace(/-/g, ' ')} from the Mars 2026 kitchen.${numbered}`;
      } else if (c.cat === 'prop') {
        components = {}; tags = ['furniture', 'prop', ...(/lamp/i.test(c.kinds) ? ['lamp', 'light'] : /speaker/i.test(c.kinds) ? ['speaker', 'music'] : /stove/i.test(c.kinds) ? ['kitchen', 'stove'] : /cart|net pot/i.test(c.kinds) ? ['garden', 'hydroponics', 'cart'] : [])];
        description = `${dname.replace(/-/g, ' ')} from the Mars 2026 campus.${numbered}`;
      } else {
        components = { carryable: { mass: 0.6, grips: 1 }, container: { capacity: 1 } }; tags = ['kitchen', 'item', ...(/bowl/i.test(c.kinds) ? ['bowl', 'food'] : /pot/i.test(c.kinds) ? ['pot'] : /cup|mug/i.test(c.kinds) ? ['cup', 'mug'] : /kettle/i.test(c.kinds) ? ['kettle'] : ['board'])]; layer = 'decor';
        description = `${dname.replace(/-/g, ' ')} from the Mars 2026 campus (carryable).${numbered}`;
      }
      defs.push(def(dname, { description, tags, asset, box: piece.box, slots, components, layer, overlaps: c.cat === 'item' ? undefined : ['mars-campus'], scale: [0.5, 2] }));
    }
  }
  for (const r of g) taken.add(r.i);
  furnBoxes.push(b);
  placements.push({ def: `core/mars-${dname}@1`, cat: c.cat, building: buildingOf(g[0]), nums: c.nums, ids: g.map((r) => r.comp).filter(Boolean).slice(0, 12), p: p.map(r3), r: r4(yaw), floorY: r3(b.y0) });
  nFurn++;
}
console.log(`furniture/items: ${nFurn} placed, ${kinds.size} kinds`);

// 1b. FURN: things sim.mars.college shows that V3 lost or never cut out.
// - The old kitchen's rice cooker and two-tier water urn (the sim.mars.college kitchen, the raw 2026 campus CAD). Gene's
//   kitchen correction rebuilt the counters and left them out; they go back on the corrected west perimeter counter.
const RAW_GLB = '<mars-campus-repo>/viewer/public/browser/campus.glb';   // sha 675f4beb… (read-only)
const RAW_SOURCE = 'raw Mars 2026 campus CAD (campus.glb sha 675f4beb…, ~/Mars campus-2026-reconstruction), the sim.mars.college kitchen';
async function extraPiece(dname, d, get) {
  // rebuild from the source when it is here; else keep the bytes already built (the raw CAD is not in the repo)
  const file = join(OUT, `${dname}.glb`);
  let piece = await get();
  if (!piece && existsSync(file)) { const bytes = readFileSync(file); const m = measureGlb(bytes); piece = { bytes, box: [m.box[0], m.box[1], m.box[2]], tris: m.tris }; }
  if (!piece) throw new Error(`${dname}: no source and no previous build`);
  const asset = record(piece.bytes, file, 'mesh', { name: `mars-${dname}` });
  defs.push(def(dname, { ...d, asset, box: piece.box }));
  console.log(`extra ${dname}: ${piece.tris} tris, box ${piece.box.map(r3).join(' × ')}`);
  return piece;
}
{
  let raw = null;
  if (existsSync(RAW_GLB)) {
    const mo = await import(join(ROOT, 'node_modules/.pnpm/meshoptimizer@1.3.0/node_modules/meshoptimizer/index.js')); await mo.MeshoptDecoder.ready;
    const io = new core.NodeIO().registerExtensions(ext.ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': mo.MeshoptDecoder });
    raw = { doc: await io.read(RAW_GLB) };
    raw.byId = new Map(raw.doc.getRoot().listNodes().map((n, i) => [n.getExtras()?.component_id ?? n.getName(), i]));
  }
  const ids = (list) => list.map((n) => raw.byId.get(`cad_component-${n}`)).filter((i) => i !== undefined);
  const crushIt = { ratio: 0.035, error: 0.3, minTris: 60 };
  const APPLIANCES = [
    // (the CAD's screws, rivets, feet and trims — hundreds of triangles each — are left out; each part is crushed to its share of ≤ 400)
    ['rice-cooker', '0831 0834 0835 0838 0839 0847 2941', 'A stainless rice cooker with its black lid (the Mars kitchen, 2026).', ['rice', 'cooker', 'appliance'], 3.0, [36.6, -0.25], 0.09],
    ['water-urn', '0854 0859 0860 0861', 'The two-tier water urn with its tap the Mars kitchen kept on the counter (2026).', ['water', 'urn', 'dispenser', 'drink'], 4.0, [36.6, 0.45], 0.03],
  ];
  const counter = placements.find((q) => q.building === 'kitchen' && q.def === 'core/mars-perimeter-counter@1');
  const cdef = defs.find((x) => x.name === 'core-mars-perimeter-counter'), topY = counter.p[1] + cdef.slots[0].p[1];
  for (const [dname, list, description, tags, mass, [x, z], ratio] of APPLIANCES) {
    await extraPiece(dname, { description: `${description} Carryable; it stands on a counter's top slot. Source: ${RAW_SOURCE}.`, tags: ['kitchen', 'item', ...tags], layer: 'decor', components: { carryable: { mass, grips: 2 }, container: { capacity: 1 } }, scale: [0.5, 2] },
      async () => raw && cut(raw, ids(list.split(' ')), { name: dname, tex: 128, maxTris: 400, maxError: 0.05, simplify: { ...crushIt, ratio } }));
    placements.push({ def: `core/mars-${dname}@1`, cat: 'item', building: 'kitchen', nums: [], ids: [], p: [x, r3(topY), z], r: 0, floorY: RAW_FLOOR });
  }
}

// 2. buildings
const BUILDINGS = {
  mimos: { label: 'Mimos', tags: ['building', 'cafe', 'lounge', 'tea', 'study', 'mimos'], desc: 'Mimos, the 2026 Mars College café and lounge as Gene corrected it (north up): an L of Mimos main (the west longitudinal section; its northern part a raised wooden floor at 0.53 m with the coffee counter on the west wall and the study table at the north wall, its southern part at ground level) and Mimos floor, the short southeast arm with flooring throughout, the honey sofa beneath the posters on its north wall and the low tea table near its south wall. The pallet racks between main and floor are pass-through; the northeast of the L is outdoors. Rear alcove door with a stair at the north; three risers from main south up to the raised floor.', authored: true },
  kitchen: { label: 'Chiba kitchen and dining hall', tags: ['building', 'kitchen', 'diner', 'dining', 'chiba'], desc: 'The Chiba kitchen and dining hall, immediately west of Mimos main and as long as it (Gene\'s correction): the west bay is the working kitchen (perimeter counters along the west wall returning on the north and south, the sinks in the north counter, the long stainless prep table in the middle, the food-service window on the south edge), the east bay is the dining hall with the blue wall and the bus seats along its east wall. Raised plywood floor at 0.53 m; steps up to the blue entry door.', authored: true },
  showers: { label: 'Mimos showers', tags: ['building', 'shower', 'bath', 'mimos'], desc: 'The two wooden shower bays offset diagonally northeast of Mimos main, touching at a corner (Gene\'s correction; no rear deck).', authored: true },
  chiba: { label: 'Chiba', tags: ['building', 'auditorium', 'hall', 'gallery', 'chiba', 'venue'], desc: 'Chiba, the big rack-and-plywood building of the Mars College campus: the auditorium with solar panels and the mural, the gallery hall and its stairs, as the 2026 reference draws them.' },
  dojo: { label: 'Dojo', tags: ['building', 'dojo', 'gym', 'rack'], desc: 'The north rack building, the Dojo, with its 2026 interior.' },
  'tool-camp': { label: 'Tool camp', tags: ['building', 'workshop', 'library', 'tools'], desc: 'The north workshops: Tool camp and the northeast library, with their benches and stock.' },
  freeside: { label: 'Freeside compound', tags: ['building', 'compound', 'freeside', 'colab', 'workshop'], desc: 'The northeast compound: Freeside, the living house with the reused LIBRARY facade, its completed kitchen enclosure, Bodywork/CoLab with the roof access.' },
  'west-racks': { label: 'West rack building', tags: ['building', 'rack', 'shelter'], desc: 'The west rack building at the far west of the campus.' },
};
// The `roof` group hides in the roofs-off view and while the camera is inside the building (mesh.mesh.ts). FURN: only
// what is really above the rooms people use: Chiba's roof (not its gallery floor at 3–3.5 m, the gallery's furniture,
// its string lights and screens), the Tool library loft's roof (not the loft floor, whiteboard and books at 2.86 m),
// Mimos's and the kitchen's low ceilings. Lights, facade ornaments and anything named after an assembly that merely
// contains the word "roof" (CoLab's whole front, `colab-2026-roof-access`) stay in the body.
const ROOF_Y = { chiba: 5.9, 'tool-camp': 4.4, dojo: 4.3, freeside: 2.45, 'west-racks': 2.9, mimos: 3.1, kitchen: 3.1, showers: 2.3 };
const NEVER_ROOF = /globe|bulb|festoon|string|light cable|socket|lamp|facade|wheel|triangle|ornament|sign/i;
function isRoof(b, r) {
  const k = `${r.kind ?? ''} ${r.name ?? ''}`;
  if (NEVER_ROOF.test(k)) return false;
  const roofish = /Roofs and upper floors/.test(r.layer ?? '') || /roof|ceiling|canopy|rafter/i.test(k);
  return r.y0 >= (ROOF_Y[b] ?? 2.5) - (roofish ? 0.15 : 0);
}
// FURN: per-node corrections to the reference. Mimos's Portuguese love posters (the poster wall Gene placed on the tea
// room's north side) read mirrored from the room: V3 carries their texture upside down, so the quad is flipped top to bottom.
const WORLD_FIX = { mimos: new Map() };
for (const r of rows) if (/Portuguese love posters/.test(r.kind ?? '')) WORLD_FIX.mimos.set(r.i, mul(NODES[r.i].getWorldMatrix(), [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
// The burgundy rug of the study corner: V3's correction stood it on its edge (a 2.8 m tall carpet, which the row filter
// then dropped as "below ground"). Laid flat in Mimos's mesh, long side east–west, under the study table #3 and its
// chairs (mars-two x 46.62, z −4.75 on the raised floor). Part of the floor, not a thing: as an entity it changed Souls'
// routes through main (mars-lived D3).
for (const r of rows) if (/burgundy floor rug/i.test(r.kind ?? '')) {
  const N = 4.75, E = 46.62 - X0, at = [O[0] + N * NORTH[0] + E * EAST[0], O[1] + N * NORTH[1] + E * EAST[1]];
  WORLD_FIX.mimos.set(r.i, [EAST[0], 0, EAST[1], 0, NORTH[0], 0, NORTH[1], 0, 0, 1, 0, 0, at[0], 0.385, at[1], 1]);
}
const byB = new Map();
for (const r of rows) { if (taken.has(r.i)) continue; const b = buildingOf(r); if (b === 'people' || b === 'site') continue; if ((r.y1 < 0.02 || r.y0 < -0.3) && !WORLD_FIX[b]?.has(r.i)) continue; if (!byB.has(b)) byB.set(b, []); byB.get(b).push(r); }
for (const [b, rs] of byB) {
  if (only && !only.test(b)) continue;
  const B = BUILDINGS[b];
  const piece = await cut(src, rs.filter((r) => Math.max(r.n1 - r.n0, r.e1 - r.e0, r.y1 - r.y0) > 0.08 || r.tris < 200).map((r) => r.i), { name: b, tex: 512, maxTris: 70000, simplify: { ratio: 0.25, error: 0.02, minTris: 150 }, roof: (i) => isRoof(b, byI.get(i)), world: WORLD_FIX[b] });
  const o = piece.shift;   // mars-two position of the def's base centre
  const floorY = B.authored ? 0 : 0;
  // Chiba's contents never reach into Mimos, the kitchen or the showers (their own footprints say what is there)
  const own = (r) => (b !== 'chiba' || !(inRect(r, -1.95, 6.0, -11.8, 3.7) || inRect(r, 5.9, 10.9, -0.1, 4.95)))
    // what stands on or against a cut-out piece of furniture (the espresso machine on the counter) is that furniture's business
    && !furnBoxes.some((f) => r.n0 < f.n1 + 0.08 && f.n0 - 0.08 < r.n1 && r.e0 < f.e1 + 0.08 && f.e0 - 0.08 < r.e1 && r.y0 < f.y1 + 0.3 && f.y0 < r.y1);
  const replaced = (r) => (REPLACED[b] ?? []).some(([n0, n1, e0, e1]) => inRect(r, n0, n1, e0, e1));
  const contents = contentObstacles(rs.filter((r) => own(r) && !replaced(r) && (!/Walls and screens/.test(r.layer ?? '') || !B.authored)), o, floorY).filter((ob) => !B.authored || ob.y1 > RAISED + 0.3);
  const fp = authoredFootprint(b, o, piece.box, contents);
  const fpBytes = Buffer.from(JSON.stringify(fp, null, 1) + '\n');
  const baked = footprintToBaked(fp);
  const fpSha = record(fpBytes, join(OUT, `${b}.footprint.json`), 'footprint', { baked, name: `mars-${b}-footprint` });
  const asset = record(piece.bytes, join(OUT, `${b}.glb`), 'mesh', { name: `mars-${b}`, footprint: fpSha });
  const d = def(b, { overlaps: ['mars-campus'], description: `${B.desc} ${baked.rooms.length} rooms, ${baked.colliders.length} wall/solid colliders, ${baked.links.length} stairs. ${piece.tris} triangles.`, tags: B.tags, asset, footprint: fpSha, box: piece.box, scale: [1, 1] });
  if (baked.slots.length) d.slots = baked.slots.map((sl) => {
    const at = ROOM_AT[b]?.[sl.id]; if (!at || sl.kind !== 'room') return sl;
    // re-anchor the room slot at its standing point; its outline stays where it is (relative to the new origin)
    const p = [r3(at[1] + X0 - o[0]), sl.p[1], r3(-at[0] - o[2])], dx = p[0] - sl.p[0], dz = p[2] - sl.p[2];
    return { ...sl, p, polygon: sl.polygon.map(([x, z]) => [r4(x - dx), r4(z - dz)]) };
  });
  if (ENTRANCES[b]) { const [id, n, e, label] = ENTRANCES[b]; d.slots = [...(d.slots ?? []), { id, kind: 'stand', p: [r3(e + X0 - o[0]), r3(-o[1]), r3(-n - o[2])], yaw: 0, accepts: {}, capacity: 8, label }]; }
  d.components = { ...d.components, place: { kind: 'building', enclosed: !!B.authored } };
  defs.push(d);
  placements.push({ def: `core/mars-${b}@1`, cat: 'building', building: b, p: o.map(r3), r: 0 });
  console.log(`building ${b}: ${rs.length} nodes, ${piece.trisBefore}→${piece.tris} tris, ${(piece.bytes.byteLength / 1024).toFixed(0)} KB, ${baked.rooms.length} rooms, ${baked.colliders.length} colliders`);
}

// 3. site objects (vehicles, trailers, toilets, OG, forklift, tents…)
const site = rows.filter((r) => !taken.has(r.i) && buildingOf(r) === 'site' && r.y1 > 0.05 && r.y0 > -0.3 && (r.n1 - r.n0) < 40 && (r.e1 - r.e0) < 40);
const objs = clusters(site, 0.03, () => '', true).filter((g) => { const b = boxOf(g); return b.y1 - b.y0 > 0.15 || (b.n1 - b.n0) * (b.e1 - b.e0) > 1; });
const siteKinds = new Map(), siteSig = new Map();
let nSite = 0;
for (const g of objs.sort((a, b) => a[0].i - b[0].i)) {
  const b = boxOf(g), R = groupRect(g), cx = R.c[0], cz = R.c[1];
  // the object's own axes: its long side along local x when it is the longer one (a van, a trailer, a bus)
  let yaw = R.half[0] >= R.half[1] ? R.yaw : R.yaw + Math.PI / 2;
  let frame = mul(rotY(-yaw), mul(translate(-cx, 0, -cz), v3ToLocal(0, 0)));
  // same source meshes and the same overall size = the same object (the identical trailers parked in a row)
  const loose = sha256(JSON.stringify([g.length, g.reduce((s, r) => s + r.tris, 0), [Math.max(R.half[0], R.half[1]), Math.min(R.half[0], R.half[1]), b.y1 - b.y0].map((v) => Math.round(v * 5))]));
  let sig = sigOf(g, frame);
  if (siteKinds.has(loose)) {
    // pick the half turn that matches the first instance's frame
    const f2 = mul(rotY(-(yaw + Math.PI)), mul(translate(-cx, 0, -cz), v3ToLocal(0, 0)));
    if (sigOf(g, f2) === siteSig.get(loose)) { yaw += Math.PI; frame = f2; }
    sig = loose;
  } else { siteSig.set(loose, sig); sig = loose; }
  const asm = g.map((r) => r.asm).find((a) => a && a !== 'site-context') ?? '';
  const big = (b.n1 - b.n0) * (b.e1 - b.e0);
  const word = /toilet/.test(asm) ? 'toilet' : /forklift/.test(asm) ? 'forklift' : /bus/.test(asm) ? 'short-bus' : /boat/.test(asm) ? 'boat' : /og-/.test(asm) ? asm.replace(/-details|-2026/g, '') : /colab/.test(asm) ? 'colab-hut' : /field-chair/.test(asm) ? 'field-chair' : b.y1 > 2.4 && big > 12 ? 'vehicle' : b.y1 > 1.8 ? 'shelter' : 'site-object';
  let dname = siteKinds.get(sig);
  const piece = await cut(src, g.filter((r) => Math.max(r.n1 - r.n0, r.e1 - r.e0, r.y1 - r.y0) > 0.08 || r.tris < 200).map((r) => r.i), { name: word, frame, tex: 256, maxTris: 12000, simplify: { ratio: 0.25, error: 0.02, minTris: 150 } });
  if (!dname) {
    let k = 1; dname = `${word}-${k}`; while (defs.some((d) => d.name === `core-mars-${dname}`)) dname = `${word}-${++k}`;
    siteKinds.set(sig, dname);
    if (!only || only.test(dname)) {
      const asset = record(piece.bytes, join(OUT, `${dname}.glb`), 'mesh', { name: `mars-${dname}` });
      defs.push(def(dname, { overlaps: ['mars-campus'], description: `A ${word.replace(/-/g, ' ')} on the Mars 2026 campus (${r3(piece.box[0])} × ${r3(piece.box[2])} m, ${r3(piece.box[1])} m high), as the reference draws it.`, tags: ['site', word.replace(/-\d+$/, ''), ...(word === 'vehicle' || /bus|forklift/.test(word) ? ['vehicle', 'transport'] : [])], asset, box: piece.box, layer: piece.box[1] < 0.3 ? 'decor' : 'solid' }));
    }
  }
  placements.push({ def: `core/mars-${dname}@1`, cat: 'site', building: 'site', p: [cx + Math.cos(yaw) * piece.shift[0] + Math.sin(yaw) * piece.shift[2], piece.shift[1], cz - Math.sin(yaw) * piece.shift[0] + Math.cos(yaw) * piece.shift[2]].map(r3), r: r4(yaw) });
  nSite++;
}
console.log(`site: ${nSite} objects, ${siteKinds.size} kinds`);

// 4. MARSLIVED: authored fixtures the reference lacks (layout.mjs FIXTURES), as generated defs
const glass = (x, w) => ({ kind: 'box', at: [x, 1.31, 0], size: [w, 2.46, 0.02], material: 'glass', collide: false });
const timber = (at, size) => ({ kind: 'box', at, size, tint: 'frame', collide: false });
const FIXTURE_DEFS = {
  'tool-library-stair': { schema: 'def/1', name: 'core-mars-tool-library-stair', version: 1, description: `A timber flight (${STAIR_RUN} m, 16 risers) from the ground up to the Tool library's east terrace and loft (${LOFT_Y} m): the reference draws the loft but no way up. Souls climb it to the library's cushions.`, tags: ['mars', 'mars-campus', 'stairs', 'access', 'library', 'tool-camp'], form: 'point', make: { kind: 'gen', gen: 'stairs/1' }, params: { rise: { type: 'number', default: LOFT_Y }, run: { type: 'number', default: STAIR_RUN }, width: { type: 'number', default: 0.9 }, material: { type: 'string', default: 'wood' } }, size: { box: [0.9, LOFT_Y, STAIR_RUN] }, layer: 'solid', overlaps: ['mars-campus'], category: 'component.access' },
  'mimos-front-glazing': { schema: 'def/1', name: 'core-mars-mimos-front-glazing', version: 1, description: 'Mimos main south\'s glazed front: timber-framed glass either side of a glass door (open, swung in), 3.9 m along the south wall west of the sloping plexiglass. The reference left this front open.', tags: ['mars', 'mars-campus', 'glazing', 'window', 'door', 'mimos'], form: 'point', make: { kind: 'gen', gen: 'kit/2', args: { round: 0.01, shapes: [
    glass(-1.225, 1.37), glass(1.225, 1.37),
    ...[-1.95, -0.5, 0.5, 1.95].map((x) => timber([x, 1.3, 0], [0.08, 2.6, 0.1])), timber([-1.225, 1.3, 0], [0.04, 2.5, 0.06]), timber([1.225, 1.3, 0], [0.04, 2.5, 0.06]),
    timber([0, 2.57, 0], [3.98, 0.08, 0.12]), timber([-1.225, 0.04, 0], [1.45, 0.08, 0.12]), timber([1.225, 0.04, 0], [1.45, 0.08, 0.12]),
    // the door leaf, open: hinged on the east jamb, swung in (north = local −z) against the glass
    { kind: 'box', at: [0.47, 1.25, -0.47], size: [0.02, 2.3, 0.88], material: 'glass', collide: false }, timber([0.47, 1.25, -0.92], [0.05, 2.36, 0.05]), timber([0.47, 2.41, -0.47], [0.05, 0.05, 0.9]),
  ] } }, params: { frame: { type: 'color', default: '#7a5536', doc: 'timber frame colour' } }, palette: { frame: '#7a5536' }, size: { box: [4, 2.62, 1.0] }, layer: 'decor', overlaps: ['mars-campus'], category: 'building.part' },
};
for (const [name, defName, building, p, r] of FIXTURES) {
  const d = FIXTURE_DEFS[defName]; if (!d) throw new Error(`fixture ${name}: no def ${defName}`);
  if (!defs.some((x) => x.name === d.name)) defs.push(d);
  placements.push({ def: `core/mars-${defName}@1`, cat: 'fixture', building, name, p: p.map(r3), r: r4(r) });
}

if (!only) {
  // legacy assets (see VER above): byte-exact under legacy/<sha16>.<ext>, listed in legacy/index.json and merged here
  const LEG = join(OUT, 'legacy'), legFile = join(LEG, 'index.json');
  mkdirSync(LEG, { recursive: true });
  const had = existsSync(legFile) ? JSON.parse(readFileSync(legFile, 'utf8')).assets : {}, legacy = {};
  const git = (ref, path) => execFileSync('git', ['-C', ROOT, 'show', `${ref}:${path}`], { maxBuffer: 1 << 28 });
  for (const ref of ledger.releases ?? []) {
    const rel = JSON.parse(git(ref, relative(ROOT, join(OUT, 'index.part.json'))).toString()).assets;
    for (const [sha, m] of Object.entries(rel)) {
      if (index[sha] || legacy[sha] || /^worlds\/core-assets\/mars\/legacy\//.test(m.path)) continue;
      const f = join(LEG, `${sha.slice(0, 16)}.${m.ext}`);
      if (!(had[sha] && existsSync(f))) { const bytes = git(ref, m.path); if (sha256(bytes) !== sha) throw new Error(`legacy ${m.path}@${ref}: sha mismatch`); writeFileSync(f, bytes); }
      legacy[sha] = { ...m, path: relative(ROOT, f) };
    }
  }
  for (const f of readdirSync(LEG)) if (f !== 'index.json' && !Object.values(legacy).some((m) => m.path.endsWith(`/${f}`))) rmSync(join(LEG, f));
  for (const [sha, m] of Object.entries(legacy)) if (!index[sha]) index[sha] = m;
  writeFileSync(legFile, JSON.stringify({ schema: 'core-assets-part/1', note: 'Mars assets earlier mars-two releases name and the current build no longer writes; generated by build.mjs; never delete an entry a released world may still name', assets: Object.fromEntries(Object.entries(legacy).sort()) }, null, 1) + '\n');
  // def versions (versions.json): a def whose content differs from every version a world may already hold gets a new
  // version, so old worlds keep theirs and the template places the new one. Released versions are never reused;
  // the newest unreleased version is overwritten while the content keeps changing between releases.
  const canon = (d) => sha256(JSON.stringify({ ...d, description: undefined, version: undefined }));
  const vOf = new Map();
  for (const d of defs) {
    const h = canon(d), list = (ledger.defs[d.name] ??= []);
    let e = list.find((x) => x.hash === h);
    if (!e) { const last = list[list.length - 1]; if (last && !last.released) { last.hash = h; e = last; } else { e = { v: Math.max(0, ...list.map((x) => x.v)) + 1, hash: h }; list.push(e); } }
    d.version = e.v; vOf.set(d.name, e.v);
  }
  for (const pl of placements) { const n = pl.def.replace(/^core\//, 'core-').replace(/@\d+$/, ''); pl.def = pl.def.replace(/@\d+$/, `@${vOf.get(n) ?? 1}`); }
  writeFileSync(VER, JSON.stringify(ledger, null, 1) + '\n');
  for (const f of readdirSync(OUT)) { const p = join(OUT, f); if (/\.(glb|json)$/.test(f) && !written.has(p) && !/^(index\.part|placements|versions)\.json$/.test(f)) rmSync(p); }
  writeFileSync(join(OUT, 'index.part.json'), JSON.stringify({ schema: 'core-assets-part/1', note: 'Mars 2026 campus pieces; generated by tools/god-skill/scripts/mars-two/build.mjs; merged into worlds/core-assets/index.json by import-packs.mjs', assets: index }, null, 1) + '\n');
  writeFileSync(KIT, JSON.stringify(defs, null, 1) + '\n');
  writeFileSync(join(OUT, 'placements.json'), JSON.stringify({ schema: 'mars-two-placements/1', frame: 'mars-two: x = east, z = south (north up), metres; Mimos origin at x 48, z 0', placements }, null, 1) + '\n');
}
const bytes = [...written].reduce((s, f) => s + readFileSync(f).byteLength, 0);
console.log(`${defs.length} defs, ${Object.keys(index).length} assets, ${(bytes / 1048576).toFixed(1)} MB in ${relative(ROOT, OUT)}`);
