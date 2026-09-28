// Bill of materials + material piles for a year build (owner feedback 2026-09-28 §7, §9; phase A).
//
// billOfMaterials(graph): what the reconstruction of the chosen assemblies is made of, in stock terms.
//   * phase A (skeleton): one line per catalog def the graph classified (reconstruction frames,
//     beams) — exact counts from the canonical scene.
//   * phase B estimates (not built yet, flagged `estimate`): Kit deck strips and plywood walls in
//     4x8 sheets with the cut list (a strip longer than 8 ft = full sheets + one sheet cut to the
//     rest; a wall panel = sheets stood up, cut to its height), solar panels by size (their own
//     pile, §9; the def is W8's `solar-panel-<size>`).
//   * unresolved: feature classes with no material rule yet (stairs, railings, roofs, doors,
//     windows, fixtures) — counted and named, never guessed.
// stockPiles(bom): the lines packed into strapped bundles / stacks (catalog-stock.ts BUNDLES).
// placePiles(...): deterministic placement on open ground near the building: outside its work zone
// (footprint + room to lay frames out and raise them), each pile with its take-out strip and an
// access margin clear of every ground-blocking obstacle of the scene and of the other piles; the
// margins are the yard's aisles (the walkways piles must not sit in). No room → a reported refusal.
import { obbOverlap, rot2, type OBB2, type Vec2 } from '../core/math.ts';
import { CATALOG, def } from '../world/catalog.ts';
import { BUNDLES } from '../world/catalog-stock.ts';
import type { AsmNode, AssemblyGraph, CompBox, FeatureClass } from './assembly.ts';
import type { CampusObstacle } from './types.ts';
import type { PartsB } from './parts-b.ts';
import { cutPlan } from '../construction/cut.ts';

const SHEET_L = 8 * 0.3048, SHEET_W = 4 * 0.3048;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

export type BomLine = { item: string; count: number; phase: 'A' | 'B'; source: 'kit' | 'estimate'; for: string; note?: string };
/** One kind of cut: `count` × (stock → `to` + offcut). Sizes in metres (length × width). */
export type CutLine = { stock: string; to: string; offcut: string; count: number; for: string; def?: string };
export type Unresolved = { feature: FeatureClass; count: number; reason: string };
export type Bom = { year: number; assemblies: string[]; lines: BomLine[]; cuts: CutLine[]; unresolved: Unresolved[] };

const UNRESOLVED_WHY: Partial<Record<FeatureClass, string>> = {
  'stair-part': 'Kit stairs are treads/risers/rails with no stringers and no catalog flight of that width; material rule deferred to phase B',
  railing: 'railing lumber not modelled yet (phase B)',
  roof: 'roof build-up not modelled yet (phase B)',
  door: 'doors not modelled yet (phase B)',
  window: 'windows / glazing not modelled yet (phase B)',
  fixture: 'furniture, kitchen and interior fixtures are placed items, not construction stock (phase B)',
  vehicle: 'vehicles are driven in, not built',
  context: 'context object, not built',
};

/** Sheets needed to cover a length with 8 ft sheets: full sheets + the cut remainder (m), if any. */
function sheetRun(len: number): { full: number; rest: number } {
  const full = Math.floor((len + 0.005) / SHEET_L);
  const rest = r3(len - full * SHEET_L);
  return { full, rest: rest > 0.01 ? rest : 0 };
}

export function billOfMaterials(g: AssemblyGraph, assemblies: string[]): Bom {
  const set = new Set(assemblies);
  const nodes = g.nodes.filter((n) => set.has(n.assembly));
  const lines = new Map<string, BomLine>();
  const add = (item: string, count: number, phase: 'A' | 'B', source: 'kit' | 'estimate', what: string, note?: string) => {
    const k = `${phase}|${item}|${what}`;
    const l = lines.get(k);
    if (l) l.count += count; else lines.set(k, { item, count, phase, source, for: what, ...(note ? { note } : {}) });
  };
  const cuts = new Map<string, CutLine>();
  const cut = (stock: string, to: string, offcut: string, what: string, n = 1) => {
    const k = `${stock}|${to}|${offcut}|${what}`;
    const c = cuts.get(k);
    if (c) c.count += n; else cuts.set(k, { stock, to, offcut, count: n, for: what });
  };
  const un = new Map<FeatureClass, number>();
  for (const n of nodes) {
    if (n.kind === 'upright') add(n.def!, 1, 'A', 'kit', 'rack frames');
    else if (n.kind === 'beam') add(n.def!, 1, 'A', 'kit', 'rack beams');
    else if (n.feature === 'deck-sheet') deckSheets(n.box, add, cut);
    else if (n.feature === 'wall' && /plywood/.test(n.kitDef)) wallSheets(n.box, add, cut);
    else if (n.feature === 'solar' && /solar panel/.test(n.kitDef)) {
      const s = `${n.box.size[0].toFixed(2)}x${n.box.size[2].toFixed(2)}`;
      add(`solar-panel-${s}`, 1, 'B', 'kit', 'solar panels (own pile, §9)', CATALOG[`solar-panel-${s}`] ? undefined : 'def pending W8 (construction/solar.ts, §9)');
    } else if (n.feature === 'solar') { /* photovoltaic-cell overlays are part of a panel */ }
    else un.set(n.feature!, (un.get(n.feature!) ?? 0) + 1);
  }
  const lineList = [...lines.values()].sort((a, b) => (a.phase < b.phase ? -1 : a.phase > b.phase ? 1 : a.item < b.item ? -1 : a.item > b.item ? 1 : a.for < b.for ? -1 : 1));
  const cutList = [...cuts.values()].map((c) => ({ ...c, ...(defFor(c.to) ? { def: defFor(c.to)! } : {}) })).sort((a, b) => (a.for + a.to < b.for + b.to ? -1 : 1));
  const unresolved = [...un.entries()].map(([feature, count]) => ({ feature, count, reason: UNRESOLVED_WHY[feature] ?? `no material rule for ${feature}` })).sort((a, b) => (a.feature < b.feature ? -1 : 1));
  return { year: g.year, assemblies: [...set].sort(), lines: lineList, cuts: cutList, unresolved };
}

/** Catalog def whose plywood / lumber size matches a cut size string, if one exists. */
function defFor(size: string): string | null {
  const m = /^plywood (\d+\.\d+)x(\d+\.\d+)$/.exec(size);
  if (!m) return null;
  const [l, w] = [Number(m[1]), Number(m[2])];
  const hit = Object.values(CATALOG).find((d) => d.category === 'plywood' && Math.abs(d.size[0] - l) < 0.01 && Math.abs(d.size[2] - w) < 0.01);
  return hit ? hit.id : null;
}

type Add = (item: string, count: number, phase: 'A' | 'B', source: 'kit' | 'estimate', what: string, note?: string) => void;
type Cut = (stock: string, to: string, offcut: string, what: string, n?: number) => void;

/** A Kit deck strip (width ≤ 4 ft, any length) in 4x8 sheets laid end to end, the last one cut. */
function deckSheets(b: CompBox, add: Add, cut: Cut) {
  const len = b.size[0], wid = b.size[2];
  const { full, rest } = sheetRun(len);
  add('plywood-4x8', full + (rest ? 1 : 0), 'B', 'estimate', 'deck strips (Kit plywood deck sheet)');
  if (rest) cut('plywood-4x8', `plywood ${rest.toFixed(3)}x${SHEET_W.toFixed(3)}`, `plywood ${r3(SHEET_L - rest).toFixed(3)}x${SHEET_W.toFixed(3)}`, 'deck strips');
  if (wid < SHEET_W - 0.02) cut('plywood-4x8', `rip to ${wid.toFixed(3)} wide`, `strip ${r3(SHEET_W - wid).toFixed(3)} wide`, 'deck strips', full + (rest ? 1 : 0));
}

/** A plywood wall panel: sheets stood up side by side, cut to the wall height (rows if taller than 8 ft). */
function wallSheets(b: CompBox, add: Add, cut: Cut) {
  const w = b.size[0], h = b.size[1];
  const cols = Math.ceil(w / SHEET_W - 0.01);
  const { full, rest } = sheetRun(h);
  add('plywood-4x8', cols * (full + (rest ? 1 : 0)), 'B', 'estimate', 'plywood walls (Kit plywood wall)');
  if (rest) cut('plywood-4x8', `plywood ${rest.toFixed(3)}x${SHEET_W.toFixed(3)}`, `plywood ${r3(SHEET_L - rest).toFixed(3)}x${SHEET_W.toFixed(3)}`, 'plywood walls', cols);
}

// ---------------------------------------------------------------- piles

export type PileSpec = { id: string; def: string; piece: string; count: number; capacity: number; phase: 'A' | 'B' };

/** Stock → bundles: phase A pieces fill stacks of their def; plywood estimates fill 24-sheet bundles. */
export function stockPiles(bom: Bom): PileSpec[] {
  const need = new Map<string, { count: number; phase: 'A' | 'B' }>();
  for (const l of bom.lines) {
    if (!CATALOG[l.item]) continue; // e.g. solar panels without a def yet
    const n = need.get(l.item);
    need.set(l.item, { count: (n?.count ?? 0) + l.count, phase: n?.phase === 'A' || l.phase === 'A' ? 'A' : 'B' });
  }
  const out: PileSpec[] = [];
  for (const [piece, { count, phase }] of [...need.entries()].sort()) {
    const b = Object.entries(BUNDLES).filter(([, s]) => s.piece === piece).sort()[0];
    if (!b) throw new Error(`stockPiles: no bundle / stack holds ${piece}`);
    const [bid, spec] = b;
    for (let k = 0, left = count; left > 0; k++, left -= spec.capacity)
      out.push({ id: `pile-${piece}-${k + 1}`, def: bid, piece, count: Math.min(spec.capacity, left), capacity: spec.capacity, phase });
  }
  return out;
}

export type PilePlacement = PileSpec & {
  /** Pile base centre (ground) and yaw (local x = the stock's length). */
  x: number; z: number; yaw: number;
  /** Where a piece taken from it is laid (centre, long-axis heading): the take-out strip beside it. */
  out: { x: number; z: number; yaw: number };
};
export type Yard = { piles: PilePlacement[]; station: { x: number; z: number; yaw: number } | null; workZone: OBB2; refused: { id: string; reason: string }[]; extra?: { id: string; def: string; x: number; z: number; yaw: number }[] };

/** Room around the building for laying frames out and raising them (m, beyond the footprint). */
export const WORK_MARGIN = { ends: 6.0, sides: 3.0 };
export const PILE_ACCESS = 1.0; // m clear all round a pile + its take-out strip (the yard's aisles)
export const OUT_GAP = 0.8; // m between a pile and the piece laid beside it (a carrier stands there)

/** Footprint OBB of the building's frames and beams, in the frames' yaw. */
export function buildingFootprint(nodes: AsmNode[]): OBB2 {
  const rack = nodes.filter((n) => n.kind === 'upright' || n.kind === 'beam');
  if (!rack.length) throw new Error('buildingFootprint: no frames or beams');
  const yaw = rack.find((n) => n.kind === 'upright')!.box.yaw;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const o: Vec2 = [rack[0].box.c[0], rack[0].box.c[2]];
  for (const n of rack) for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const w = rot2([sx * n.box.size[0] / 2, sz * n.box.size[2] / 2], n.box.yaw);
    const l = rot2([n.box.c[0] + w[0] - o[0], n.box.c[2] + w[1] - o[1]], -yaw);
    x0 = Math.min(x0, l[0]); x1 = Math.max(x1, l[0]); z0 = Math.min(z0, l[1]); z1 = Math.max(z1, l[1]);
  }
  const c = rot2([(x0 + x1) / 2, (z0 + z1) / 2], yaw);
  return { c: [r3(o[0] + c[0]), r3(o[1] + c[1])], half: [r3((x1 - x0) / 2), r3((z1 - z0) / 2)], yaw };
}

/**
 * Place piles (largest first) and the cutting station on free ground beside the building, as one
 * yard on one side of its work zone. `obstacles` = the build scene's obstacles (the building itself
 * removed). Deterministic: for each side (local −x, +x, −z, +z of the frames' yaw) a 0.5 m lattice
 * (≤ `radius` m from the building) is searched nearest-to-that-side's-anchor first (ties by x, z);
 * the side where everything fits with the least total distance to the building wins (ties: side order).
 */
export function placePiles(piles: PileSpec[], nodes: AsmNode[], obstacles: CampusObstacle[], groundY: number, opts: { radius?: number; station?: boolean; extra?: { id: string; def: string }[]; more?: PileSpec[]; phaseB?: boolean } = {}): Yard {
  const fp = buildingFootprint(nodes);
  // frames stand in lines along the frames' normal (local z): the ends are where frames are laid out
  const workZone: OBB2 = { c: fp.c, half: [fp.half[0] + WORK_MARGIN.sides, fp.half[1] + WORK_MARGIN.ends], yaw: fp.yaw };
  const R = opts.radius ?? 30;
  const near = obstacles.filter((o) => o.y1 > groundY + 0.22 && o.y0 < groundY + 1.8 && dist(o.obb.c, fp.c) < R + 20 + Math.max(o.obb.half[0], o.obb.half[1]));
  const lattice: Vec2[] = [];
  for (let i = -R * 2; i <= R * 2; i++) for (let j = -R * 2; j <= R * 2; j++) {
    const p: Vec2 = [fp.c[0] + i * 0.5, fp.c[1] + j * 0.5];
    if (dist(p, fp.c) <= R + Math.max(workZone.half[0], workZone.half[1])) lattice.push(p);
  }
  let best: Yard | null = null, bestCost = Infinity;
  const sides: Vec2[] = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (const sd of sides) {
    const a = rot2([sd[0] * (workZone.half[0] + 4), sd[1] * (workZone.half[1] + 4)], fp.yaw);
    const anchor: Vec2 = [fp.c[0] + a[0], fp.c[1] + a[1]];
    const cands = lattice.map((p) => ({ p, d: dist(p, anchor) })).sort((x, y) => x.d - y.d || x.p[0] - y.p[0] || x.p[1] - y.p[1]).map((x) => x.p);
    const yard = placeOn(cands, piles, workZone, near, fp, R, opts.station !== false, opts.extra ?? [], opts.more ?? [], opts.phaseB ?? false);
    const cost = yard.refused.length * 1e6 + yard.piles.reduce((s, p) => s + dist([p.x, p.z], fp.c), 0) + (yard.station ? dist([yard.station.x, yard.station.z], fp.c) : 0);
    if (cost < bestCost - 1e-9) { best = yard; bestCost = cost; }
  }
  return best!;
}

function placeOn(cands: Vec2[], piles: PileSpec[], workZone: OBB2, near: CampusObstacle[], fp: OBB2, R: number, withStation: boolean, extra: { id: string; def: string }[] = [], more: PileSpec[] = [], phaseB = false): Yard {
  const placed: OBB2[] = [];
  const out: PilePlacement[] = [];
  const refused: Yard['refused'] = [];
  // the pile's long axis along the building's long axis (frame normal, local z of the frames' yaw)
  const yaw = fp.yaw + Math.PI / 2;
  const fits = (plot: OBB2) => !obbOverlap(plot, workZone) && !placed.some((q) => obbOverlap(q, plot)) && !near.some((o) => obbOverlap(o.obb, plot));
  const order = [...piles].sort((a, b) => def(b.def).size[0] * def(b.def).size[2] - def(a.def).size[0] * def(a.def).size[2] || (a.id < b.id ? -1 : 1));
  const placePile = (pile: PileSpec) => {
    const d = def(pile.def), pc = def(pile.piece);
    const upright = pc.category === 'rack-upright';
    const L = Math.max(d.size[0], upright ? pc.size[1] : pc.size[0]);
    const pieceW = upright ? pc.size[0] : pc.size[2];
    // plot (pile-local): pile across [−D/2, D/2], take-out strip beyond it on +z, access margin all round
    const D = d.size[2], z0 = -D / 2 - PILE_ACCESS, z1 = D / 2 + OUT_GAP + pieceW + PILE_ACCESS;
    const mid = rot2([0, (z0 + z1) / 2], yaw);
    const c = cands.find((p) => fits({ c: [p[0] + mid[0], p[1] + mid[1]], half: [L / 2 + PILE_ACCESS, (z1 - z0) / 2], yaw }));
    if (!c) { refused.push({ id: pile.id, reason: `no free ${(L + 2 * PILE_ACCESS).toFixed(1)} × ${(z1 - z0).toFixed(1)} m plot within ${R} m of the building outside its work zone` }); return; }
    placed.push({ c: [c[0] + mid[0], c[1] + mid[1]], half: [L / 2 + PILE_ACCESS, (z1 - z0) / 2], yaw });
    const o = rot2([0, D / 2 + OUT_GAP + pieceW / 2], yaw);
    out.push({ ...pile, x: r3(c[0]), z: r3(c[1]), yaw, out: { x: r3(c[0] + o[0]), z: r3(c[1] + o[1]), yaw } });
  };
  for (const pile of order) placePile(pile);
  // phase B (cuts): the cutting station's plot includes its out-feed (up to ~4.6 m behind the bench: two pieces 0.8 m
  // apart); the phase-A yard (no cuts) keeps its own station rule
  let station: Yard['station'] = null;
  if (withStation) {
    const s = def('cutting-station').size;
    // plot: the bench + 1.5 m all round; phase B: + its out-feed behind it (local +z, 4.6 m from its centre)
    const back = phaseB ? 4.6 + 0.5 : s[2] / 2 + 1.5, front = s[2] / 2 + 1.5;
    const mid = rot2([0, (back - front) / 2], yaw);
    const plot = (p: Vec2): OBB2 => ({ c: [p[0] + mid[0], p[1] + mid[1]], half: [s[0] / 2 + 1.5, (back + front) / 2], yaw });
    const c = cands.find((p) => fits(plot(p)));
    if (c) { placed.push(plot(c)); station = { x: r3(c[0]), z: r3(c[1]), yaw }; }
    else refused.push({ id: 'cutting-station', reason: `no free plot within ${R} m for the cutting station` });
  }
  // phase B: the bundles beyond the skeleton's, after the station, largest first
  for (const pile of [...more].sort((a, b) => def(b.def).size[0] * def(b.def).size[2] - def(a.def).size[0] * def(a.def).size[2] || (a.id < b.id ? -1 : 1))) placePile(pile);
  // extra plots (phase B: the scrap pile), nearest the station when there is one
  const ex: NonNullable<Yard['extra']> = [];
  for (const x of extra) {
    const s = def(x.def).size;
    const half: Vec2 = [s[0] / 2 + 1.5, s[2] / 2 + 1.5];
    const byStation = station ? [...cands].sort((a, b) => dist(a, [station!.x, station!.z]) - dist(b, [station!.x, station!.z]) || a[0] - b[0] || a[1] - b[1]) : cands;
    const c = byStation.find((p) => fits({ c: p, half, yaw }));
    if (c) { placed.push({ c, half, yaw }); ex.push({ id: x.id, def: x.def, x: r3(c[0]), z: r3(c[1]), yaw }); }
    else refused.push({ id: x.id, reason: `no free plot within ${R} m for ${x.id}` });
  }
  out.sort((a, b) => (a.id < b.id ? -1 : 1));
  return { piles: out, station, workZone, refused, ...(extra.length ? { extra: ex } : {}) };
}

const dist = (a: Vec2, b: Vec2) => { const dx = a[0] - b[0], dz = a[1] - b[1]; return Math.sqrt(dx * dx + dz * dz); };

/** Totals for reports: pieces per item and phase, bundles per def. */
export function bomTotals(bom: Bom, piles: PileSpec[]) {
  const items: Record<string, number> = {};
  for (const l of bom.lines) items[`${l.phase}:${l.item}`] = (items[`${l.phase}:${l.item}`] ?? 0) + l.count;
  const bundles: Record<string, number> = {};
  for (const p of piles) bundles[p.def] = (bundles[p.def] ?? 0) + 1;
  return { items, cuts: bom.cuts.reduce((s, c) => s + c.count, 0), bundles, unresolved: Object.fromEntries(bom.unresolved.map((u) => [u.feature, u.count])) };
}

/**
 * Phase B bill of materials (W13): the phase-A skeleton lines plus one stock piece per phase-B part (deck pieces,
 * wall panels, stair lumber, rails, panels; parts-b.ts material rules), the cut list (stock → part + offcut or
 * waste, cut.ts cutPlan) and, as unresolved, every feature the rules could not place (with the first reason).
 */
export function billOfMaterialsB(g: AssemblyGraph, assemblies: string[], parts: PartsB): Bom {
  const a = billOfMaterials(g, assemblies);
  const lines = new Map<string, BomLine>();
  for (const l of a.lines.filter((x) => x.phase === 'A')) lines.set(`A|${l.item}|${l.for}`, { ...l });
  const cuts = new Map<string, CutLine>();
  for (const p of parts.parts) {
    const what = p.kind === 'deck' ? 'decks' : p.kind === 'wall' ? 'plywood walls' : p.kind === 'stair' ? 'Kit stair' : 'solar (own piles, §9)';
    const k = `B|${p.stock}|${what}`;
    const l = lines.get(k);
    if (l) l.count++; else lines.set(k, { item: p.stock, count: 1, phase: 'B', source: 'kit', for: what });
    if (p.cut) {
      const plan = cutPlan(p.stock, [p.def]);
      const off = plan.ok && plan.offcut ? plan.offcut.id : 'waste';
      const ck = `${p.stock}|${p.def}|${off}|${what}`;
      const c = cuts.get(ck);
      if (c) c.count++; else cuts.set(ck, { stock: p.stock, to: p.def, offcut: off, count: 1, for: what, def: p.def });
    }
  }
  const un = new Map<string, { count: number; reason: string }>();
  for (const u of parts.unplaced) { const f = u.kind.replace(/^feature:/, ''); const x = un.get(f); if (x) x.count++; else un.set(f, { count: 1, reason: u.reason }); }
  const covered = new Set(['deck-sheet', 'wall', 'stair-part', 'solar']);
  for (const r of a.unresolved.filter((x) => !covered.has(x.feature))) { const x = un.get(r.feature); if (x) x.count += r.count; else un.set(r.feature, { count: r.count, reason: r.reason }); }
  const sortL = (x: BomLine, y: BomLine) => (x.phase < y.phase ? -1 : x.phase > y.phase ? 1 : x.item < y.item ? -1 : x.item > y.item ? 1 : x.for < y.for ? -1 : 1);
  return {
    year: g.year, assemblies: a.assemblies, lines: [...lines.values()].sort(sortL),
    cuts: [...cuts.values()].sort((x, y) => (x.for + x.to + x.offcut < y.for + y.to + y.offcut ? -1 : 1)),
    unresolved: [...un.entries()].map(([feature, v]) => ({ feature: feature as FeatureClass, count: v.count, reason: v.reason })).sort((x, y) => (x.feature < y.feature ? -1 : 1)),
  };
}

/** Phase B: bundles for the stock `bom` needs beyond what `have` already holds (ids continue each piece's numbering). */
export function morePiles(bom: Bom, have: PileSpec[]): PileSpec[] {
  const want = stockPiles(bom);
  const need = new Map<string, number>();
  for (const p of want) need.set(p.piece, (need.get(p.piece) ?? 0) + p.count);
  for (const p of have) need.set(p.piece, (need.get(p.piece) ?? 0) - p.count);
  const out: PileSpec[] = [];
  for (const [piece, n] of [...need.entries()].sort()) {
    if (n <= 0) continue;
    const [bid, spec] = Object.entries(BUNDLES).filter(([, s]) => s.piece === piece).sort()[0];
    const k0 = have.filter((p) => p.piece === piece).length;
    for (let k = 0, left = n; left > 0; k++, left -= spec.capacity) out.push({ id: `pile-${piece}-${k0 + k + 1}`, def: bid, piece, count: Math.min(spec.capacity, left), capacity: spec.capacity, phase: 'B' });
  }
  return out;
}
