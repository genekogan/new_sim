// Stock and parts for year builds, phase B (owner feedback 2026-09-28 §7, §9; W13). Registered through
// catalog-stock.ts `stockAssets` (so catalog.ts is unchanged). Every size here is PROVISIONAL: the
// procedural reconstruction (app/history/kit.ts) draws decks, stairs, walls and solar as plain boxes;
// these defs are the lumber / sheet goods a Mars crew would plausibly build them from.
//
// * Deck pieces. A Kit deck strip is 4 ft × 15 ft across a whole rack house (three rows of 3 ft frames
//   and two 3 ft aisles: beams every 0.914 m). 8 ft + 7 ft cannot work: a joint between two beams leaves
//   one piece cantilevering 0.61 m past its last beam (deck.ts allows 12 in). With the joints ON beams
//   the strip is 6 ft + 6 ft + 3 ft (4x6 / 4x3 cut from 4x8 sheets). Strips whose long edge lies on a
//   frame line are drawn by the Kit through the frame (half its 3 in thickness): those pieces are
//   NOTCHED at the cutting station around the columns / bracing (`plywood-4x6n`, `plywood-4x3n`; NOTCH
//   below: access.ts lets a notched part share up to that depth of its long edges with a Kit frame).
// * Kit stair (2022 rack-house template: 8 treads, 4.452 m wide, going 0.457 m, rise 0.2775 m, top at the
//   2.48 m deck): six 2x12 stringers cut to `stair-stringer-kit8` (their top ends bolted to the end frame),
//   each Kit tread = two 2x10 boards cut to the stair width (`stair-tread-board-kit`; the top tread's back
//   board notched at the end frame), risers = 2x12 cut to the width, rail posts = 2x4 cut to 0.85 m,
//   handrails = 2x4 cut to the rail length (their top ends notched into the end frame).
// * Wall panels: 4x8 sheets stood up and cut to the Kit wall heights (2.23 / 2.20 m); a 3 ft wide panel
//   ripped from a sheet closes a 15 ft end wall (cut.ts rips, W13).
// * Solar: the Kit's 2022 roof module is 1.625 × 1.072 m (drawn as `cw − 0.025` × `rh − 0.025` of its
//   10 × 1 array on 3 bays): `solar-panel-107x163` (W8's catalog-solar.ts is W12's; this size lives here),
//   with a pallet stack of 10 and a bundle of rails.
import { datan, FT, IN } from '../core/math.ts';
import type { AssetDef } from './catalog.ts';
import { PANEL_MAX_TILT } from './catalog-solar.ts';

const provisional = (note: string) => ({ confidence: 'provisional' as const, note });

/** Notch depth (m) of a notched part's edges: access.ts tests it against reconstruction frames with its footprint shrunk by this. */
export const NOTCH: Record<string, number> = {};
/** Cut-to-order sizes (this file's parts, not stock): cut.ts never makes them offcuts. */
export const CUT_TO_ORDER = new Set<string>();

/** Kit stair template of the 2022 rack houses (app/history/scenes.ts: k.stairs(stair, d − .12, BAY, 2.22, 0, 0, 8)). */
export const KIT_STAIR_2022 = { treads: 8, width: 4.572 - 0.12, run: 12 * FT, rise: 2.22 } as const;
/** Stringer section and the tread-board section. */
export const STRINGER_H = 11.25 * IN, BOARD_T = 1.5 * IN, TREAD_BOARD_W = 9.25 * IN, TREAD_BACK_W = 7.25 * IN;
/** A Kit tread = a 2x10 (front) + a 2x8 (back), 0.419 m, centred on the Kit tread (two 2x10 = 0.470 m would overlap the next tread in plan). */
export const TREAD_PAIR = TREAD_BOARD_W + TREAD_BACK_W;
/** End-frame half thickness (3 in columns): where the stringers' top ends bear. */
const FRAME_HALF = 1.5 * IN;

/**
 * Length of a straight 2x12 stringer under the Kit treads: its top edge through the back-bottom edges of
 * the tread boards (two 2x10 per tread, centred on the Kit tread), its lower corner on the ground, its top
 * end against the end frame's outer face (Kit tread 8's back edge lies on the frame line). Derivation in
 * YEAR_BUILD.md "Stair".
 */
export function kitStringerGeometry(t: { treads: number; run: number; rise: number } = KIT_STAIR_2022) {
  const going = t.run / t.treads, riser = t.rise / t.treads;
  const tan = riser / going;
  const c = 1 / Math.sqrt(1 + tan * tan), s = tan * c;
  // s-axis: horizontal from tread 1's front edge toward the top; tread i (1-based) centre at (i − 0.5)·going
  const treadDepth = going - 0.009; // the Kit's tread box depth
  const frontEdge = (going - treadDepth) / 2; // Kit tread 1 front edge from its slot start
  const sA = 0.5 * going + TREAD_PAIR / 2 - frontEdge; // back edge of tread 1's boards (centred pair)
  const yA = 0.24 + 0.03 + riser - BOARD_T; // Kit tread 1 top (0.24 + rise/n + 0.03) − board thickness
  const sFrame = t.treads * going - frontEdge - FRAME_HALF; // the end frame's outer face (stair side)
  const h = STRINGER_H;
  const L = (sFrame - sA - h * s - (h * c - yA) / tan) / c;
  return { L, tan, cos: c, sin: s, sA, yA, sFrame, going, riser };
}

function board(id: string, label: string, lengthM: number, wIn: number, tIn: number, kgPerM: number, note: string, notch?: number, flat = false): AssetDef {
  const l = lengthM;
  if (notch) NOTCH[id] = notch;
  return {
    id,
    label,
    category: 'timber',
    // lumber convention (catalog.ts, catalog-stock.ts): on edge, y = width, z = thickness; `flat` boards (treads) lie on their face
    size: flat ? [l, tIn * IN, wIn * IN] : [l, wIn * IN, tIn * IN],
    massKg: Math.round(l * kgPerM * 10) / 10,
    color: '#c9a36b',
    handling: {
      carryCrew: [1, 2],
      carryPose: 'edge',
      grips: { 1: [{ id: 'mid', local: [0, 0, 0] }], 2: [{ id: 'g0', local: [-l * 0.4, 0, 0] }, { id: 'g1', local: [l * 0.4, 0, 0] }] },
      carryHeight: 0.9,
      ...(l * kgPerM <= 10 ? { smallLoad: true as const } : {}),
    },
    dims: provisional(note),
  };
}

function sheet(id: string, label: string, lengthM: number, widthM: number, note: string, notch?: number): AssetDef {
  if (notch) NOTCH[id] = notch;
  const l = lengthM;
  return {
    id,
    label,
    category: 'plywood',
    size: [l, 0.75 * IN, widthM],
    massKg: Math.round(27 * (l * widthM) / (8 * FT * 4 * FT) * 10) / 10,
    color: '#d8b98a',
    handling: {
      carryCrew: [1, 2],
      carryPose: 'edge',
      grips: { 1: [{ id: 'mid', local: [0, 0, 0] }], 2: [{ id: 'g0', local: [-l * 0.35, 0, 0] }, { id: 'g1', local: [l * 0.35, 0, 0] }] },
      carryHeight: 0.75,
    },
    paintable: { faces: ['front', 'back'] },
    dims: provisional(note),
  };
}

export type PhaseBMake = { bundle: (id: string, label: string, size: [number, number, number], piece: string, capacity: number, massKg: number, note: string) => AssetDef };

/** Everything phase B adds to CATALOG (called from catalog-stock.ts stockAssets). */
export function phaseBAssets(make: PhaseBMake): AssetDef[] {
  const out: AssetDef[] = [];
  const stock = new Set(['2x12-14ft', '2x12-16ft', '2x10-16ft', '2x8-16ft', 'solar-panel-107x163']);
  const notch = 2 * IN; // around 3 in columns: half the frame (1.5 in) + clearance
  // deck pieces (notched variants of the 4x6 / 4x3 cut from a 4x8)
  out.push(sheet('plywood-4x6n', '4x6 ft plywood, notched along a long edge for a rack frame (3/4 in)', 6 * FT, 4 * FT, 'a 4x8 cut to 6 ft and notched 2 in deep around the frame columns / bracing its edge lies on (the Kit draws deck sheets through the frame plane)', notch));
  out.push(sheet('plywood-4x3n', '4x3 ft plywood, notched along a long edge for a rack frame (3/4 in)', 3 * FT, 4 * FT, 'a 4x8 cut to 3 ft and notched 2 in deep around a frame', notch));
  // wall panels (a 4x8 stood up, cut to the Kit wall height; one ripped to 3 ft to close a 15 ft wall)
  out.push(sheet('plywood-4x2230mm', 'plywood wall panel 4 ft × 2.23 m (3/4 in)', 2.23, 4 * FT, 'a 4x8 cut to the Kit ground-floor wall height (0.25–2.48 m)'));
  out.push(sheet('plywood-4x2200mm', 'plywood wall panel 4 ft × 2.20 m (3/4 in)', 2.2, 4 * FT, 'a 4x8 cut to the Kit upper wall height (2.56–4.76 m)'));
  out.push(sheet('plywood-3x2230mm', 'plywood wall panel 3 ft × 2.23 m (3/4 in, ripped)', 2.23, 3 * FT, 'a 4x8 cut to 2.23 m and ripped to 3 ft (closes a 15 ft wall: 3 × 4 ft + 3 ft)'));
  // stair lumber: stock + Kit cut sizes
  const g = kitStringerGeometry();
  out.push(board('2x12-14ft', '14 ft 2x12', 14 * FT, 11.25, 1.5, 5.4, 'nominal 2x12 = 1.5 x 11.25 in'));
  out.push(board('2x12-16ft', '16 ft 2x12', 16 * FT, 11.25, 1.5, 5.4, 'nominal 2x12 = 1.5 x 11.25 in'));
  out.push(board('2x10-16ft', '16 ft 2x10', 16 * FT, 9.25, 1.5, 4.4, 'nominal 2x10 = 1.5 x 9.25 in'));
  out.push(board('2x8-16ft', '16 ft 2x8', 16 * FT, 7.25, 1.5, 3.4, 'nominal 2x8 = 1.5 x 7.25 in'));
  out.push(board('stair-stringer-kit8', `2x12 stair stringer (${g.L.toFixed(3)} m, Kit 8-tread stair)`, g.L, 11.25, 1.5, 5.4,
    `a 14 ft 2x12 cut to ${g.L.toFixed(3)} m: top edge under the tread boards' back edges, foot on the ground, top end bolted to the end frame (slope ${(datan(g.tan) * 180 / Math.PI).toFixed(1)}°); the sawtooth cuts the treads sit in are not modelled`));
  out.push(board('stair-tread-board-kit', '2x10 stair tread board (4.452 m, Kit stair width)', KIT_STAIR_2022.width, 9.25, 1.5, 4.4, 'a 16 ft 2x10 cut to the Kit stair width, laid flat; two boards per Kit tread (0.470 m deep vs the Kit 0.448 m)', undefined, true));
  out.push(board('stair-tread-board-kit-8', '2x8 stair tread board (4.452 m, Kit stair width)', KIT_STAIR_2022.width, 7.25, 1.5, 3.4, 'a 16 ft 2x8 cut to the Kit stair width, laid flat: the back board of a Kit tread (2x10 + 2x8 = 0.419 m vs the Kit 0.448 m)', undefined, true));
  out.push(board('stair-tread-board-kit-8n', '2x8 stair tread board, notched for the end frame (4.452 m)', KIT_STAIR_2022.width, 7.25, 1.5, 3.4, 'the top tread\'s back board: the Kit draws its tread into the end frame; notched 2 in around the columns / bracing', notch, true));
  out.push(board('stair-riser-kit', '2x10 stair riser (4.452 m)', KIT_STAIR_2022.width, 9.25, 1.5, 4.4, 'a 16 ft 2x10 cut to the stair width, on edge on the tread below, under the tread above (0.235 m of the 0.239 m between the boards; the Kit riser is 0.2775 m, drawn through the treads)'));
  out.push(board('stair-post-kit', '2x4 rail post (0.85 m)', 0.85, 3.5, 1.5, 1.9, 'an 8 ft 2x4 cut to the Kit rail-post height (0.85 m); stood up, bolted to the tread ends'));
  const railL = Math.sqrt(KIT_STAIR_2022.run * KIT_STAIR_2022.run + KIT_STAIR_2022.rise * KIT_STAIR_2022.rise);
  out.push(board('stair-handrail-kit', `2x4 stair handrail (${railL.toFixed(3)} m)`, railL, 3.5, 1.5, 1.9, 'a 16 ft 2x4 cut to the Kit rail length; its top end notched 2 in into the end frame (the Kit draws it to the frame centre)', notch));
  // solar (Kit 2022 roof module) + rails in their own piles (§9)
  out.push({
    id: 'solar-panel-107x163',
    label: 'solar panel 1.07 × 1.63 m (Kit 2022 roof module)',
    category: 'solar',
    size: [1.625, 0.045, 1.0723],
    massKg: 21,
    color: '#1d2b4f',
    handling: {
      carryCrew: [2, 2],
      carryPose: 'flat',
      grips: { 2: [{ id: 'g0', local: [-1.625 * 0.4, 0, 0] }, { id: 'g1', local: [1.625 * 0.4, 0, 0] }] },
      carryHeight: 0.8,
      fragile: { maxTilt: PANEL_MAX_TILT },
    },
    dims: provisional('the Kit draws its 2022 roof arrays as 10 × 1 modules of 1.0723 × 0.045 × 1.625 m on 3 bays (app/history/kit.ts solar); mass generic; 2-person carry, fragile (≤ 30°)'),
  });
  out.push(make.bundle('stack-solar-panel-107x163', 'pallet of solar panels (10, flat)', [1.625 + 0.1, 0.12 + 10 * 0.045, 1.0723 + 0.1], 'solar-panel-107x163', 10, 10 * 21 + 20,
    'panels flat on a pallet, 10 high, strapped; not documented (§9: panels are their own pile)'));
  out.push(make.bundle('bundle-panel-rail', 'bundle of panel rails (20)', [2.1, 0.1 + 4 * 0.04, 5 * 0.04 + 0.1], 'panel-rail', 20, 20 * 2.5, 'rails 5 wide × 4 high on dunnage; not documented'));
  out.push(make.bundle('bundle-2x12-14ft', 'strapped 2x12 unit (12 × 14 ft)', [14 * FT, 0.1 + 3 * 1.5 * IN, 4 * 11.25 * IN], '2x12-14ft', 12, 12 * 23, '4 wide × 3 high; a site-sized unit'));
  out.push(make.bundle('bundle-2x12-16ft', 'strapped 2x12 unit (12 × 16 ft)', [16 * FT, 0.1 + 3 * 1.5 * IN, 4 * 11.25 * IN], '2x12-16ft', 12, 12 * 26, '4 wide × 3 high; a site-sized unit'));
  out.push(make.bundle('bundle-2x10-16ft', 'strapped 2x10 unit (24 × 16 ft)', [16 * FT, 0.1 + 4 * 1.5 * IN, 6 * 9.25 * IN], '2x10-16ft', 24, 24 * 21, '6 wide × 4 high; a site-sized unit'));
  // offcuts are stacked on a scrap pile by the station (moves-b.ts stack_offcut): one pile of mixed 1–5 ft pieces
  out.push(make.bundle('scrap-pile', 'offcut pile (plywood / lumber offcuts on dunnage)', [1.8, 0.1 + 0.6, 1.3], 'offcut', 200, 20,
    'offcuts from the cutting station stacked on dunnage beside it; not documented'));
  out.push(make.bundle('bundle-2x8-16ft', 'strapped 2x8 unit (24 × 16 ft)', [16 * FT, 0.1 + 4 * 1.5 * IN, 6 * 7.25 * IN], '2x8-16ft', 24, 24 * 17, '6 wide × 4 high; a site-sized unit'));
  out.push(make.bundle('bundle-2x4-8ft', 'strapped 2x4 unit (48 × 8 ft)', [8 * FT, 0.1 + 6 * 1.5 * IN, 8 * 3.5 * IN], '2x4-8ft', 48, 48 * 5, '8 wide × 6 high, flat, strapped'));
  for (const d of out) if (!stock.has(d.id) && (d.category === 'timber' || d.category === 'plywood')) CUT_TO_ORDER.add(d.id);
  return out;
}
