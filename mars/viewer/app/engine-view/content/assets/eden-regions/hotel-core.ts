// Old Eden's seafront hotels inside (lane L4b, 2026-10-17; Gene's decision #5): an open ground-floor lobby behind the front
// door and a dog-leg stair core in the east-most balcony column, shared by the drawing (buildings.ts house({hotelCore}))
// and the upper-floors/1 facts (tools/upper-floors/old-eden-hotels.mjs). Pure, no imports, no randomness: local building
// metres (origin at the building centre on the ground, +z towards the sea front, the door at x 0).

/** The four seafront hotels resort-lake.ts draws (rng 3101), west to east: centre x (z 121, yaw 0), width, storeys. */
export const SEAFRONT_HOTELS: readonly {cx: number; w: number; floors: number}[] = [
  {cx: 121.20613304758444, w: 14.412266095168889, floors: 6},
  {cx: 136.92117107205559, w: 11.017809953773394, floors: 4},
  {cx: 150.77461292035878, w: 10.689073742832989, floors: 4},
  {cx: 164.21800767316017, w: 10.197715762769803, floors: 6},
];
export const HOTEL_Z = 121, HOTEL_DEPTH = 10, HOTEL_FH = 3.1, HOTEL_WALL = .18;
/** Balcony (room) column centres resort-lake.ts lays out: one per 3.3 m, first 1.7 m in from the west wall. */
export const hotelColumns = (w: number) => Array.from({length: Math.floor(w / 3.3)}, (_, i) => -w / 2 + 1.7 + i * 3.3);
/** Rendered upper-floor heights (top of the floor slab), first floor up. */
export const hotelFloorYs = (floors: number) => Array.from({length: floors - 1}, (_, f) => (f + 1) * HOTEL_FH + .02);

export type HotelCoreLayout = {
  /** inside faces of the shell [x0, z0, x1, z1] */
  inner: [number, number, number, number];
  /** the stair well [x0, z0, x1, z1]: open on every upper floor; its flights rise north in lane L, turn, rise south in lane U */
  well: [number, number, number, number];
  laneL: number; laneU: number; laneWidth: number;
  /** the front door's opening in the ground-floor front wall [x0, x1], its head height */
  door: [number, number]; doorHead: number;
  /** balcony column centres; the last one is the stair hall (no guest room furniture), the others are guest rooms */
  columns: number[]; guestColumns: number[]; stairColumn: number;
  /** a guest room's x range on its floor */
  roomX: (bx: number) => [number, number];
  /** lobby furniture (decorative drawing; the facts give them solids) */
  sofa: {x0: number; z0: number; z1: number; depth: number}; table: [number, number, number, number]; reception: [number, number, number, number];
};

export function hotelCoreLayout(w: number, d = HOTEL_DEPTH, t = HOTEL_WALL): HotelCoreLayout {
  const inner: [number, number, number, number] = [-w / 2 + t, -d / 2 + t, w / 2 - t, d / 2 - t];
  const columns = hotelColumns(w), stairColumn = columns[columns.length - 1];
  const x1 = inner[2], well: [number, number, number, number] = [x1 - 1.8, -1.4, x1, 1.6];
  return {
    inner, well, laneL: x1 - 1.4, laneU: x1 - .4, laneWidth: .8, door: [-.6, .6], doorHead: 2.45,
    columns, guestColumns: columns.slice(0, -1), stairColumn,
    roomX: (bx) => [Math.max(inner[0], bx - 1.65), bx + 1.65],
    sofa: {x0: inner[0], z0: -.2, z1: 1.8, depth: .85}, table: [inner[0] + 1.25, .3, inner[0] + 1.85, 1.3], reception: [-1, -4.3, 1, -3.7],
  };
}

/** One storey's flight from floor height `base` to `top` as tread-centre points [x, y, z] (local): eight treads north in
 *  lane L, the turn landing, seven treads south in lane U, the exit landing onto the floor above. */
export function hotelFlight(c: HotelCoreLayout, base: number, top: number): [number, number, number][] {
  const r = (top - base) / 16, z1 = c.well[3], z0 = c.well[1], pts: [number, number, number][] = [];
  for (let i = 0; i < 8; i++) pts.push([c.laneL, base + (i + 1) * r, z1 - .3 - i * .28]);
  pts.push([c.laneL, base + 8 * r, z0 + .3], [c.laneU, base + 8 * r, z0 + .3]);
  for (let i = 0; i < 7; i++) pts.push([c.laneU, base + 8 * r + (i + 1) * r, z1 - .3 - 7 * .28 + i * .28]);
  pts.push([c.laneU, top, z1 - .22]);
  return pts;
}
