// 2x4 roof framing — the layer between the rack skeleton and the roof / ceiling sheets (owner feedback
// 2026-09-28 §7: "skeleton first … then the 2x4 framing (top plates, rafters, joists)"; evidence photo
// docs/engineering/evidence/2026-09-28-skeleton-stage-racks-2x4-frame-before-plywood.jpg). W36.
// Mars assembly model v1, approximate. Verbs and support rules: construction/framing.ts, FRAMING.md.
//
// * `2x4-top-plate-<8|12|16>ft` — a 2x4 lying FLAT (1.5 in high, 3.5 in wide): on the column tops of one frame
//   (across its two columns) or along a column line across two frames, or on top rack beams.
// * `2x4-rafter-<4…16>ft` — a 2x4 ON EDGE (3.5 in high) spanning plate to plate, flat or sloped (its pitch
//   is the plates' height difference). A flat-roof rafter IS the ceiling joist: no separate def (the Kit
//   draws no roof framing at all — its roof deck lies straight on the top rack beams, FRAMING.md).
// * `2x4-blocking-<16|24>oc` — a short 2x4 on edge fitted between two rafters at 16 / 24 in centres, over a
//   plate (the rafter's thickness and 1/8 in of play each side off the spacing).
// All are the stock 2x4's section (cut.ts sameFamily; the flat plate is the same lumber defined lying
// flat), so `cut` makes them from 16 ft stock; they are cut to order (never an offcut).
import { FT, IN } from '../core/math.ts';
import type { AssetDef } from './catalog.ts';
import { CUT_TO_ORDER } from './catalog-phase-b.ts';

export type FramingRole = 'top-plate' | 'rafter' | 'blocking';
export const PLATE_FT = [8, 12, 16] as const;
export const RAFTER_FT = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] as const;
/** Blocking: rafter centres (in) → piece length (in): spacing − 1.5 in rafter − 2 × 1/8 in play. */
export const BLOCKING_OC: Record<number, number> = { 16: 16 - 1.5 - 0.25, 24: 24 - 1.5 - 0.25 };
export const plateId = (ft: number) => `2x4-top-plate-${ft}ft`;
export const rafterId = (ft: number) => `2x4-rafter-${ft}ft`;
export const blockingId = (oc: number) => `2x4-blocking-${oc}oc`;
export const FRAMING_ROLE: Record<string, FramingRole> = {};
/** The framing role of a catalog def (undefined for anything else). */
export const framingRole = (defId: string): FramingRole | undefined => FRAMING_ROLE[defId];
const KG_PER_M = 1.9; // 2x4, as the stock catalog

function member(id: string, label: string, role: FramingRole, l: number, flat: boolean, note: string): AssetDef {
  FRAMING_ROLE[id] = role;
  CUT_TO_ORDER.add(id);
  const kg = Math.round(l * KG_PER_M * 10) / 10;
  return {
    id,
    label,
    category: 'timber',
    size: flat ? [l, 1.5 * IN, 3.5 * IN] : [l, 3.5 * IN, 1.5 * IN],
    massKg: kg,
    color: '#c9a36b',
    handling: {
      carryCrew: [1, 2],
      carryPose: flat ? 'flat' : 'edge',
      grips: { 1: [{ id: 'mid', local: [0, 0, 0] }], 2: [{ id: 'g0', local: [-l * 0.4, 0, 0] }, { id: 'g1', local: [l * 0.4, 0, 0] }] },
      carryHeight: 0.9,
      ...(l * KG_PER_M <= 10 ? { smallLoad: true as const } : {}),
    },
    dims: { confidence: 'provisional', note },
  };
}

/** Everything this file adds to CATALOG (one registration line in catalog.ts). */
export function framingAssets(): AssetDef[] {
  return [
    ...PLATE_FT.map((ft) => member(plateId(ft), `${ft} ft 2x4 top plate (flat)`, 'top-plate', ft * FT, true,
      `nominal 2x4 laid flat on the frame tops; ${ft} ft cut from 16 ft stock — the skeleton-stage framing of the owner's photo, not drawn by the Kit`)),
    ...RAFTER_FT.map((ft) => member(rafterId(ft), `${ft} ft 2x4 rafter (on edge)`, 'rafter', ft * FT, false,
      `nominal 2x4 on edge, plate to plate (flat roof: also the ceiling joist); ${ft} ft cut from 16 ft stock — hypothetical, not drawn by the Kit`)),
    ...Object.entries(BLOCKING_OC).map(([oc, len]) => member(blockingId(Number(oc)), `2x4 blocking for ${oc} in rafter centres (${len} in)`, 'blocking', len * IN, false,
      `nominal 2x4 on edge between rafters at ${oc} in centres (spacing − 1.5 in − 1/4 in play), over a plate`)),
  ];
}
