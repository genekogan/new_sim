// Mars construction vocabulary (spec §6). Dimensions are data with their own
// confidence: Gene confirmed rack sizes 8/9/12/19 ft and that an "upright" is
// the tall blue two-column braced frame; beams are the orange horizontals.
// Other values are industry-typical and marked provisional until checked
// against photos or the 2026 component catalog.
import { FT, IN, type Vec3 } from '../core/math.ts';
import type { Confidence } from './types.ts';

export type GripSlot = { id: string; local: Vec3 };
export type Socket = { id: string; kind: 'beam-seat' | 'beam-end' | 'joist-seat' | 'deck-seat' | 'stair-top' | 'stair-bottom'; local: Vec3; face?: 'front' | 'back' };

export type Handling = {
  /** Crew sizes allowed to carry (spec §11). */
  carryCrew: [min: number, max: number];
  /** Orientation carried in: 'flat' = long axis horizontal, broad face horizontal. */
  carryPose: 'flat' | 'edge';
  /** Grip slots in local coordinates; carriers are assigned in slot order for a given crew size. */
  grips: Record<number, GripSlot[]>;
  /** Minimum crew to raise from horizontal to standing, if raisable. */
  raiseCrew?: number;
  /** Minimum humans holding while standing unsupported by connections. */
  holdCrew?: number;
  /** Hand height while carrying (m). */
  carryHeight: number;
};

export type AssetDef = {
  id: string;
  label: string;
  category: 'rack-upright' | 'rack-beam' | 'timber' | 'plywood' | 'stair' | 'human' | 'vehicle' | 'fixture' | 'test-block';
  /** Local axis-aligned box: x = width/length, y = height, z = depth/thickness (m). */
  size: Vec3;
  massKg: number;
  color?: string;
  handling?: Handling;
  sockets?: Socket[];
  dims: { confidence: Confidence; note: string };
};

const provisional = (note: string) => ({ confidence: 'provisional' as const, note });

/** Beam-seat holes every 2 in are typical; we expose seats every 6 in for planning. */
function uprightSockets(height: number, depth: number): Socket[] {
  const out: Socket[] = [];
  for (let y = 12 * IN, i = 0; y < height - 3 * IN; y += 6 * IN, i++)
    for (const face of ['front', 'back'] as const)
      for (const side of [-1, 1])
        out.push({ id: `${face}-${side < 0 ? 'l' : 'r'}-${i}`, kind: 'beam-seat', local: [(side * depth) / 2, y, 0], face });
  return out;
}

// Library frames in the stock GLBs: upright_frame_{8ft_4ft,12ft_4ft,16ft_3ft,19ft_3ft} (AUDIT.md §2).
const UPRIGHT_DEPTH_FT: Record<number, number> = { 8: 4, 9: 4, 12: 4, 16: 3, 19: 3 };

function upright(ft: number): AssetDef {
  const h = ft * FT, depth = (UPRIGHT_DEPTH_FT[ft] ?? 4) * FT, t = 3 * IN;
  const tall = ft >= 12;
  return {
    id: `upright-${ft}ft`,
    label: `${ft} ft pallet-rack upright (blue two-column frame)`,
    category: 'rack-upright',
    // local x = depth between the two columns, y = height, z = column face thickness
    size: [depth, h, t],
    massKg: Math.round(ft * 3.2), // ~3.2 kg/ft for a light-duty frame: provisional
    color: '#1f5fbf',
    handling: {
      carryCrew: tall ? [2, 4] : [1, 3],
      carryPose: 'flat',
      // grips along the height axis (lying flat, height becomes the long axis)
      grips: {
        1: [{ id: 'mid', local: [0, h / 2, 0] }],
        2: [{ id: 'g0', local: [0, h * 0.18, 0] }, { id: 'g1', local: [0, h * 0.82, 0] }],
        3: [{ id: 'g0', local: [0, h * 0.12, 0] }, { id: 'g1', local: [0, h * 0.5, 0] }, { id: 'g2', local: [0, h * 0.88, 0] }],
        4: [
          { id: 'g0', local: [-depth / 2, h * 0.2, 0] }, { id: 'g1', local: [depth / 2, h * 0.2, 0] },
          { id: 'g2', local: [-depth / 2, h * 0.8, 0] }, { id: 'g3', local: [depth / 2, h * 0.8, 0] },
        ],
      },
      raiseCrew: ft >= 19 ? 3 : tall ? 2 : 1,
      holdCrew: ft >= 19 ? 2 : 1,
      carryHeight: 0.8,
    },
    sockets: uprightSockets(h, depth),
    dims: {
      confidence: ft === 9 ? 'provisional' : 'participant',
      note: ft === 9
        ? '9 ft named by Gene but no 9 ft frame exists in the model library; depth assumed 4 ft'
        : `height ${ft} ft; depth ${UPRIGHT_DEPTH_FT[ft]} ft from the stock library frame; 3 in columns provisional`,
    },
  };
}

function beam(ft: number): AssetDef {
  const l = ft * FT;
  return {
    id: `beam-${ft}ft`,
    label: `${ft} ft pallet-rack beam (orange)`,
    category: 'rack-beam',
    size: [l, 4 * IN, 2 * IN],
    massKg: Math.round(ft * 2.1),
    color: '#e86a1a',
    handling: {
      carryCrew: ft >= 12 ? [2, 2] : [1, 2],
      carryPose: 'edge',
      grips: {
        1: [{ id: 'mid', local: [0, 0, 0] }],
        2: [{ id: 'g0', local: [-l * 0.4, 0, 0] }, { id: 'g1', local: [l * 0.4, 0, 0] }],
      },
      holdCrew: 2,
      carryHeight: 0.85,
    },
    sockets: [
      { id: 'end-l', kind: 'beam-end', local: [-l / 2, 0, 0] },
      { id: 'end-r', kind: 'beam-end', local: [l / 2, 0, 0] },
    ],
    dims: { confidence: 'participant', note: `length ${ft} ft from Gene's size list; 4x2 in section provisional` },
  };
}

function timber(ft: number): AssetDef {
  const l = ft * FT;
  return {
    id: `2x4-${ft}ft`,
    label: `${ft} ft 2x4`,
    category: 'timber',
    size: [l, 3.5 * IN, 1.5 * IN],
    massKg: Math.round(l * 1.9 * 10) / 10,
    color: '#c9a36b',
    handling: {
      carryCrew: [1, 2],
      carryPose: 'edge',
      grips: { 1: [{ id: 'mid', local: [0, 0, 0] }], 2: [{ id: 'g0', local: [-l * 0.4, 0, 0] }, { id: 'g1', local: [l * 0.4, 0, 0] }] },
      carryHeight: 0.9,
    },
    dims: { confidence: 'documented', note: 'nominal 2x4 = 1.5 x 3.5 in' },
  };
}

export const CATALOG: Record<string, AssetDef> = Object.fromEntries(
  [
    ...[8, 9, 12, 16, 19].map(upright),
    ...[8, 9, 12].map(beam),
    ...[8, 12].map(timber),
    {
      id: 'plywood-4x8',
      label: '4x8 ft plywood sheet (3/4 in)',
      category: 'plywood',
      size: [8 * FT, 0.75 * IN, 4 * FT],
      massKg: 27,
      color: '#d8b98a',
      handling: {
        carryCrew: [1, 2],
        carryPose: 'edge',
        grips: { 1: [{ id: 'mid', local: [0, 0, 0] }], 2: [{ id: 'g0', local: [-1.0, 0, 0] }, { id: 'g1', local: [1.0, 0, 0] }] },
        carryHeight: 0.75,
      },
      dims: { confidence: 'documented', note: 'standard sheet' },
    } satisfies AssetDef,
    {
      id: 'human',
      label: 'person',
      category: 'human',
      size: [0.5, 1.75, 0.35],
      massKg: 70,
      dims: provisional('generic adult; collision radius 0.28 m'),
    } satisfies AssetDef,
    {
      id: 'test-wall',
      label: 'proving-ground wall block',
      category: 'test-block',
      size: [1, 2.4, 1],
      massKg: 0,
      dims: { confidence: 'hypothetical', note: 'test fixture, scaled per instance' },
    } satisfies AssetDef,
  ].map((d) => [d.id, d]),
);

export function def(id: string): AssetDef {
  const d = CATALOG[id];
  if (!d) throw new Error(`unknown asset definition "${id}"`);
  return d;
}

export const HUMAN_RADIUS = 0.28;
