// Stock, piles and site equipment for year builds (owner feedback 2026-09-28 §7, phase A;
// evidence photos docs/engineering/evidence/2026-09-28-material-piles-*.jpg).
//
// * Reconstruction frames `upright-<ft>ft-kit`: the stock upright of that height with extra beam
//   seats at the levels the procedural reconstruction (app/history/kit.ts `Kit.frame`) hangs its
//   beams: 0.22 m, 2.48 m (frames with an upper deck) and height − 0.12 m, beam centres above the
//   post base. Real frames have holes on a ~2 in pitch; the Kit's levels are photo estimates that
//   sit on no uniform pitch (0.22 is below the stock planning seats, 2.48 / 4.757 are 4.2 / 3.2 cm
//   off the nearest 6 in seat). The variant keeps every stock seat and adds the Kit levels, so the
//   engine can hang beams exactly where the canonical scene has them (provisional; Questions for
//   Gene in PROGRESS.md).
// * Lumber: 2x4 / 2x6 in every whole foot 1–16 ft the stock catalog lacks, and 4x1…4x7 plywood panels,
//   so stock, cut pieces and offcuts are all real catalog pieces.
// * Bundles and stacks: ONE static obstacle entity each (kind fixture, `obstacle`), sized for its
//   full capacity; the entity's `contents` carries `{ food: 'stock:<piece def>', fraction, count }`
//   (count = pieces left; fraction = count / capacity for renderers). `take_from_bundle`
//   (construction/bundle.ts) unbundles one piece at a time. Capacities are chosen to look like the
//   photos (plywood ~24 sheets per strapped stack, long lumber in strapped units), not documented.
// * `cutting-station`: a sawhorse + chop-saw bench; `cut` (construction/cut.ts) works there.
// Solar panels are W8's (§9 solar.ts): the bill of materials names them but defines no def here.
import { FT, IN } from '../core/math.ts';
import type { AssetDef } from './catalog.ts';
import { phaseBAssets } from './catalog-phase-b.ts';

const provisional = (note: string) => ({ confidence: 'provisional' as const, note });

/** Beam levels (beam centre above the post base) of `Kit.frame` in app/history/kit.ts. */
export function kitSeatLevels(heightM: number): number[] {
  const out = [0.22];
  if (heightM - 0.12 - 2.48 > 0.3) out.push(2.48);
  out.push(Math.round((heightM - 0.12) * 1e4) / 1e4);
  return out;
}
export const KIT_UPRIGHT_FT = [8, 12, 16, 19] as const;
export const kitUprightId = (ft: number) => `upright-${ft}ft-kit`;

/** Bundle / stack capacity and the piece it holds (stock bookkeeping lives in the entity's contents). */
export type BundleSpec = { piece: string; capacity: number; note: string };
export const BUNDLES: Record<string, BundleSpec> = {};

function lumber(id: string, label: string, lengthFt: number, wIn: number, tIn: number, kgPerM: number): AssetDef {
  const l = lengthFt * FT;
  return {
    id,
    label,
    category: 'timber',
    size: [l, wIn * IN, tIn * IN],
    massKg: Math.round(l * kgPerM * 10) / 10,
    color: '#c9a36b',
    handling: {
      carryCrew: [1, 2],
      carryPose: 'edge',
      grips: { 1: [{ id: 'mid', local: [0, 0, 0] }], 2: [{ id: 'g0', local: [-l * 0.4, 0, 0] }, { id: 'g1', local: [l * 0.4, 0, 0] }] },
      carryHeight: 0.9,
      ...(l * kgPerM <= 10 ? { smallLoad: true as const } : {}),
    },
    dims: { confidence: 'documented', note: `nominal ${label}` },
  };
}

function plywoodPanel(ft: number): AssetDef {
  const l = ft * FT;
  return {
    id: `plywood-4x${ft}`,
    label: `4x${ft} ft plywood panel (3/4 in; cut from a 4x8 sheet)`,
    category: 'plywood',
    size: [l, 0.75 * IN, 4 * FT],
    massKg: Math.round(27 * ft / 8 * 10) / 10,
    color: '#d8b98a',
    handling: {
      carryCrew: [1, 2],
      carryPose: 'edge',
      grips: { 1: [{ id: 'mid', local: [0, 0, 0] }], 2: [{ id: 'g0', local: [-l * 0.35, 0, 0] }, { id: 'g1', local: [l * 0.35, 0, 0] }] },
      carryHeight: 0.75,
    },
    dims: { confidence: 'documented', note: `4x8 sheet cut to ${ft} ft` },
  };
}

function bundle(id: string, label: string, size: [number, number, number], piece: string, capacity: number, massKg: number, note: string): AssetDef {
  BUNDLES[id] = { piece, capacity, note };
  return { id, label, category: 'fixture', size, massKg, color: '#b89160', obstacle: true, dims: provisional(note) };
}

/** Everything this file adds to CATALOG; `upright` is catalog.ts's stock frame builder. */
export function stockAssets(make: { upright: (ft: number) => AssetDef }): AssetDef[] {
  const out: AssetDef[] = [];
  for (const ft of KIT_UPRIGHT_FT) {
    const base = make.upright(ft);
    const h = base.size[1], d = base.size[0];
    const extra = kitSeatLevels(h).flatMap((y, i) => (['front', 'back'] as const).flatMap((face) => [-1, 1].map((side) => ({
      id: `kit-${face}-${side < 0 ? 'l' : 'r'}-${i}`, kind: 'beam-seat' as const, local: [(side * d) / 2, y, 0] as [number, number, number], face,
    }))));
    out.push({
      ...base,
      id: kitUprightId(ft),
      label: `${ft} ft pallet-rack upright (reconstruction beam levels ${kitSeatLevels(h).map((y) => y.toFixed(2)).join(' / ')} m)`,
      sockets: [...(base.sockets ?? []), ...extra],
      dims: provisional(`${base.dims.note}; extra seats at the procedural reconstruction's beam levels (Kit.frame), not a real hole pitch`),
    });
  }
  // whole-foot lumber the stock catalog lacks (cut pieces and offcuts are real catalog pieces)
  for (let ft = 1; ft <= 16; ft++) {
    if (![4, 6, 8, 12].includes(ft)) out.push(lumber(`2x4-${ft}ft`, `${ft} ft 2x4`, ft, 3.5, 1.5, 1.9));
    out.push(lumber(`2x6-${ft}ft`, `${ft} ft 2x6`, ft, 5.5, 1.5, 2.9));
  }
  // plywood panels cut from a 4x8 sheet across its length (4x6 and 4x8 are stock catalog defs)
  for (const ft of [1, 2, 3, 4, 5, 7]) out.push(plywoodPanel(ft));
  const sheetT = 0.75 * IN, dunnage = 0.1;
  out.push(
    bundle('bundle-plywood-4x8', 'strapped plywood bundle (24 × 4x8 sheets on dunnage)', [8 * FT, dunnage + 24 * sheetT, 4 * FT], 'plywood-4x8', 24, 24 * 27,
      '24 sheets of 3/4 in on 2 dunnage runners, like the strapped stacks in the pile photos (~20–30 sheets)'),
    bundle('bundle-2x4-16ft', 'strapped 2x4 unit (48 × 16 ft)', [16 * FT, dunnage + 6 * 1.5 * IN, 8 * 3.5 * IN], '2x4-16ft', 48, 48 * 9,
      '8 wide × 6 high, flat, strapped; a site-sized unit, not a mill unit (those are ~200 pieces)'),
    bundle('bundle-2x6-16ft', 'strapped 2x6 unit (36 × 16 ft)', [16 * FT, dunnage + 6 * 1.5 * IN, 6 * 5.5 * IN], '2x6-16ft', 36, 36 * 14,
      '6 wide × 6 high, flat, strapped'),
    bundle('stack-beam-12ft', 'stack of 12 ft rack beams (20)', [12 * FT, dunnage + 4 * 4 * IN, 5 * 2 * IN + 0.2], 'beam-12ft', 20, 20 * 25,
      '5 wide × 4 high on dunnage; how Mars stores beams is not documented'),
  );
  for (const ft of KIT_UPRIGHT_FT) {
    const u = make.upright(ft);
    out.push(bundle(`stack-upright-${ft}ft-kit`, `stack of ${ft} ft uprights (6, lying flat)`, [u.size[1], dunnage + 6 * u.size[2], u.size[0]], kitUprightId(ft), 6, 6 * u.massKg,
      'frames lying flat, 6 high on dunnage; not documented'));
  }
  out.push({
    id: 'cutting-station',
    label: 'cutting station (chop saw on a bench, in / out tables)',
    category: 'fixture',
    size: [3.0, 0.9, 1.0],
    massKg: 60,
    color: '#6d6d6d',
    obstacle: true,
    dims: provisional('generic site cutting bench: 3 m of in-feed / saw / out-feed at 0.9 m; Mars has cutting equipment on site (owner, 2026-09-28), its layout is not documented'),
  });
  // phase B (W13): notched deck pieces, wall panels, Kit stair lumber, the Kit 2022 solar module, their piles
  out.push(...phaseBAssets({ bundle }));
  return out;
}
