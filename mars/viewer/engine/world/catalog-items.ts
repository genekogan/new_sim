// Tables and small hand-held items (owner feedback §12, ITEMS.md). Registered into CATALOG by one
// line in catalog.ts (`...ITEM_ASSETS`). Kept in its own file so the construction catalog and this
// one can change independently.
//
// - `table-6ft`: a fixture (walking obstacle at its box) whose top carries `surfaceSlots`, a 3 × 6
//   lattice 0.3 m apart where items rest (support `resting-on { on: table, slot }`).
// - Small items (`bowl`, `spoon`, `plate`, `cup`, `pot`): `handling.hands = 1`, `small: true`. They are
//   carried in one hand (support `in-hand { by, hand }`, engine/items). The single grip slot
//   `handling.grips[1][0].local` is where the hand holds the item in the item's local frame (base
//   centre origin), so item pose = hand point − rot(grip.local, yaw): the renderer attaches the item
//   to the hand bone with the same offset.
// - Containers (`CONTAINERS`) may carry `entity.contents = { food, fraction 0..1 }`.
// All dimensions are provisional (generic camp kitchenware), not measured Mars objects.
import { FT } from '../core/math.ts';
import type { AssetDef, Handling } from './catalog.ts';

/** A place on a fixture's top where one item can rest; local x/z in the fixture frame, y = top height. */
export type SurfaceSlotDef = { id: string; local: [x: number, y: number, z: number] };

export const TABLE_TOP = 0.75; // m, 6 ft folding table top height
export const TABLE_SLOT_PITCH = 0.3; // m between surface slots

const provisional = (note: string) => ({ confidence: 'provisional' as const, note });

const tableSlots = (): SurfaceSlotDef[] => {
  const out: SurfaceSlotDef[] = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 6; c++) out.push({ id: `r${r}c${c}`, local: [(c - 2.5) * TABLE_SLOT_PITCH, TABLE_TOP, (r - 1) * TABLE_SLOT_PITCH] });
  return out;
};

const hand1 = (grip: [number, number, number], carryHeight = 0.95): Handling => ({
  carryCrew: [1, 1],
  carryPose: 'flat',
  grips: { 1: [{ id: 'hand', local: grip }] },
  carryHeight,
  hands: 1,
  small: true,
});

/** Item defs that can hold food (`entity.contents`). */
export const CONTAINERS: ReadonlySet<string> = new Set(['bowl', 'plate', 'cup', 'pot']);

export const ITEM_ASSETS: AssetDef[] = [
  {
    id: 'reading-book', label: 'open reading book', category: 'item',
    size: [.24, .025, .14], massKg: .4, color: '#345a84',
    handling: hand1([0, .0125, 0]),
    capabilities: { readable: { pages: 4, maxSeatDistance: .65 } },
    dims: provisional('hypothetical open book, four compressed reading sections; not a historical Mars artifact'),
  },
  {
    id: 'table-6ft',
    label: '6 ft folding table',
    category: 'fixture',
    size: [6 * FT, TABLE_TOP, 0.75],
    massKg: 18,
    color: '#d9d4c7',
    obstacle: true,
    surfaceSlots: tableSlots(),
    capabilities: {fixtureCarry:{upright:true,handling:{carryCrew:[2,2],carryPose:'edge',carryHeight:1,grips:{2:[
      {id:'table-edge-negative',local:[0,TABLE_TOP,-.375],span:[.3,0,0]},
      {id:'table-edge-positive',local:[0,TABLE_TOP,.375],span:[.3,0,0]},
    ]}}}},
    dims: provisional('generic 6 ft folding table, 1.83 × 0.75 m top at 0.75 m; 3 × 6 item places 0.3 m apart'),
  },
  {
    id: 'bowl',
    label: 'bowl',
    category: 'item',
    size: [0.16, 0.07, 0.16],
    massKg: 0.3,
    color: '#e8e1d0',
    handling: hand1([0, 0, 0]), // palm under the base
    dims: provisional('generic enamel camp bowl, 16 cm'),
  },
  {
    id: 'spoon',
    label: 'spoon',
    category: 'item',
    size: [0.17, 0.02, 0.04],
    massKg: 0.03,
    color: '#b8b8b8',
    handling: hand1([-0.05, 0.01, 0]), // handle end (local −x); the bowl of the spoon is at +x
    dims: provisional('generic table spoon, 17 cm'),
  },
  {
    id: 'plate',
    label: 'plate',
    category: 'item',
    size: [0.26, 0.03, 0.26],
    massKg: 0.5,
    color: '#e8e1d0',
    handling: hand1([0, 0, 0]),
    dims: provisional('generic enamel camp plate, 26 cm'),
  },
  {
    id: 'cup',
    label: 'cup',
    category: 'item',
    size: [0.09, 0.1, 0.09],
    massKg: 0.25,
    color: '#c24a3a',
    handling: hand1([0, 0.05, -0.05]), // hand round the side
    dims: provisional('generic enamel mug'),
  },
  {
    id: 'pot',
    label: 'cooking pot',
    category: 'item',
    size: [0.32, 0.28, 0.32],
    massKg: 4,
    color: '#5a5a5a',
    handling: hand1([0.19, 0.24, 0], 0.8), // side handle
    dims: provisional('generic 10 l stock pot with stew, ≈ 4 kg'),
  },
];

/** Whether a def is a small one-hand item (engine/items verbs). */
export const isHandItem = (d: AssetDef | undefined) => !!d?.handling?.small && d.handling.hands === 1;
