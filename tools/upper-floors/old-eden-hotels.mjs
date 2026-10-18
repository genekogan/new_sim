// Old Eden's seafront hotels 1-3 inside, as upper-floors/1 facts plus their activity spots (lane L4b, 2026-10-17; Gene's
// decision #5). Geometry: the hotels resort-lake.ts draws (hotel-core.ts SEAFRONT_HOTELS; buildings.ts house({hotelCore})).
// Each fact carries the building's ground-floor lobby (open front door: two authored front-wall bands opened, their
// remainders as solids), the walkway strip in front of it (z 126.15..127.9; hotel 1's starts at a side path down from the
// road behind the hotels, the others' at the previous hotel's crop: the resort has no level-0 floor of its own), the stair core
// (one dog-leg flight per storey in the east-most balcony column), every upper floor round the well, one balcony per column,
// the guest rooms' beds and desks, and rooms as places. Hotel 4 keeps its drawn shell: the carousel stands across its door.
// Pure and deterministic: node tools/upper-floors/old-eden-hotels.mjs <out-dir> writes hotels.fact.json (an array of three
// facts, installed in order) + hotels.spots.json.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { SEAFRONT_HOTELS, HOTEL_Z, HOTEL_DEPTH, hotelColumns, hotelCoreLayout, hotelFlight, hotelFloorYs } from '../../mars/viewer/app/engine-view/content/assets/eden-regions/hotel-core.ts';

const r3 = (v) => Math.round(v * 1000) / 1000;
const ORD = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh'];
/** Hotels 1-3 get insides; the walkway (reached by a side path from the road behind them) runs along their fronts. */
export const HOTELS = SEAFRONT_HOTELS.slice(0, 3).map((h, i) => ({ ...h, n: i + 1, id: `eden-hotel-${i + 1}`, label: `Seafront hotel ${i + 1}` }));
const WALK = { z0: 126.15, z1: 127.9 }, THRESHOLD = [125.75, 126.2];
/** The side path west of hotel 1 (between the sports-court fence at x 106 and the hotel's west wall at x 114): from the
 *  road behind the hotels (level-0 floor at z 110-111) down to the walkway; the court fence closes the walkway's west end. */
export const ALLEY = { x0: 107.2, x1: 109.2, z0: 110.6, z1: 126.3 };
export const hotelCrop = (h) => [h.n === 1 ? 105.5 : r3(h.cx - h.w / 2 - 0.5), h.n === 1 ? ALLEY.z0 : 115.5, r3(h.cx + h.w / 2 + 0.5), 130.5];
/** Engine levels: 13-17 (hotel 1), 18-20 (hotel 2), 8-10 (hotel 3): walk_to and every level-taking action address levels
 *  0..20 only, and the office has 11-12; placeLevel = the floor number. */
const LEVEL0 = { 1: 13, 2: 18, 3: 8 };
export const hotelLevels = (h) => hotelFloorYs(h.floors).map((y, f) => ({ id: LEVEL0[h.n] + f, y: r3(y), label: `${h.label}, ${ORD[f]} floor`, placeLevel: f + 1 }));
/** The authored ground-floor front-wall bands the door [-0.6, 0.6] cuts (resort-lake.ts house(): bands between the column
 *  door edges; y 0.35..3.12, z 125.82..126.0), with the wall's remainder either side of the doorway (local x). */
export function hotelOpenings(h) {
  const xs = [-h.w / 2, ...hotelColumns(h.w).flatMap((c) => [c - 0.6, c + 0.6]), h.w / 2], bid = `region-house:${h.cx.toFixed(3)}:0.000:${HOTEL_Z.toFixed(3)}`;
  const ids = [], rest = [], bands = [];
  for (let k = 0; k + 1 < xs.length; k++) if (xs[k] < 0.6 && xs[k + 1] > -0.6) {
    ids.push(`${bid}:front:${k}:0`); bands.push({ id: `${bid}:front:${k}:0`, x0: r3(h.cx + xs[k]), x1: r3(h.cx + xs[k + 1]) });
    if (xs[k] < -0.6) rest.push([xs[k], -0.6]);
    if (xs[k + 1] > 0.6) rest.push([0.6, xs[k + 1]]);
  }
  return { ids, rest, bands };
}

export function hotelFact(h) {
  const c = hotelCoreLayout(h.w, HOTEL_DEPTH), X = (x) => r3(h.cx + x), Z = (z) => r3(HOTEL_Z + z), levels = hotelLevels(h), top = levels[levels.length - 1].id;
  const [ix0, iz0, ix1, iz1] = c.inner, [wx0, wz0, wx1, wz1] = c.well, crop = hotelCrop(h);
  const obb = (x0, z0, x1, z1) => ({ c: [r3((x0 + x1) / 2), r3((z0 + z1) / 2)], half: [r3((x1 - x0) / 2), r3((z1 - z0) / 2)], yaw: 0 });
  const surfaces = [], solids = [];
  const surf = (id, level, y, x0, z0, x1, z1, label) => surfaces.push({ id, level, y, obb: obb(x0, z0, x1, z1), label });
  /** a solid from local building coordinates */
  const box = (id, x0, z0, x1, z1, y0, y1, label, kind = 'fixture') => solids.push({ id, obb: obb(X(x0), Z(z0), X(x1), Z(z1)), y0: r3(y0), y1: r3(y1), kind, label });
  // ground floor: the lobby, the door threshold, the walkway along the front (from the previous crop, or hotel 1's side path)
  surf('lobby', 0, 0, X(ix0), Z(iz0), X(ix1), Z(iz1), `${h.label} lobby`);
  surf('threshold', 0, 0, X(c.door[0]), THRESHOLD[0], X(c.door[1]), THRESHOLD[1], `${h.label} front door`);
  const prev = HOTELS[h.n - 2];
  surf('walkway', 0, 0, prev ? hotelCrop(prev)[2] : ALLEY.x0, WALK.z0, crop[2], WALK.z1, `Walkway in front of ${h.label.toLowerCase()}`);
  if (!prev) surf('side-path', 0, 0, ALLEY.x0, ALLEY.z0, ALLEY.x1, ALLEY.z1, `Path beside ${h.label.toLowerCase()}`);
  const open = hotelOpenings(h);
  for (const [k, [a, b]] of open.rest.entries()) box(`door-jamb-${k + 1}`, a, iz1, b, iz1 + 0.18, 0, 3.12, 'Front wall', 'solid');
  box('lobby-sofa', ix0, c.sofa.z0, ix0 + 0.22, c.sofa.z1, 0, 0.9, 'Lobby sofa');
  box('lobby-table', ...c.table, 0, 0.44, 'Low table');
  box('reception', ...c.reception, 0, 1.1, 'Reception desk');
  box('stair-well-0', wx0, wz0, wx1, wz1 - 0.1, 0, 3.0, 'Stair flight', 'solid');
  const regions = [{ id: `${h.id}-lobby`, label: `${h.label} lobby`, level: 0, polygon: rect(X(ix0), Z(iz0), X(ix1), Z(iz1)) }];
  for (const l of levels) {
    const y = l.y, f = l.placeLevel;
    // the floor slab round the open well; the south part runs through the front wall's thickness to the balconies
    surf(`f${l.id}-north`, l.id, y, X(ix0), Z(iz0), X(ix1), Z(wz0), `${l.label} (north)`);
    surf(`f${l.id}-south`, l.id, y, X(ix0), Z(wz1), X(ix1), Z(HOTEL_DEPTH / 2), `${l.label} (south)`);
    surf(`f${l.id}-west`, l.id, y, X(ix0), Z(wz0), X(wx0), Z(wz1), `${l.label} (west)`);
    for (const [k, bx] of c.columns.entries()) surf(`f${l.id}-balcony-${k + 1}`, l.id, y, X(bx - 1.3), Z(HOTEL_DEPTH / 2), X(bx + 1.3), Z(HOTEL_DEPTH / 2 + 1.1), `${l.label} balcony ${k + 1}`);
    if (l.id !== top) box(`stair-well-${l.id}`, wx0, wz0, wx1, wz1 - 0.1, y, y + 2.9, 'Stair flight', 'solid');
    regions.push({ id: `${h.id}-floor-${f}`, label: l.label, level: l.id, polygon: rect(X(-h.w / 2), Z(-HOTEL_DEPTH / 2), X(h.w / 2), Z(HOTEL_DEPTH / 2 + 1.15)) });
    for (const [j, bx] of c.guestColumns.entries()) {
      // the guest room's bed and writing desk (buildings.ts furnishBalconyRooms); the chair in front of the desk stays free
      box(`bed-${l.id}-${j + 1}`, bx - 1.3, -HOTEL_DEPTH / 2 + 0.67, bx - 0.6, -HOTEL_DEPTH / 2 + 2.73, y, y + 0.6, 'Bed');
      box(`desk-${l.id}-${j + 1}`, bx + 0.73, -HOTEL_DEPTH / 2 + 1.8, bx + 1.37, -HOTEL_DEPTH / 2 + 2.4, y, y + 0.8, 'Writing desk');
      const [rx0, rx1] = c.roomX(bx);
      regions.push({ id: `${h.id}-room-${f}0${j + 1}`, label: `Room ${f}0${j + 1}, ${h.label.toLowerCase()}`, level: l.id, polygon: rect(X(rx0), Z(iz0), X(rx1), Z(HOTEL_DEPTH / 2 + 1.15)) });
    }
  }
  const floorY = [0, ...levels.map((l) => l.y)], levelIds = [0, ...levels.map((l) => l.id)], links = [];
  for (let k = 0; k + 1 < floorY.length; k++) links.push({
    id: `stairs-${k}-${k + 1}`, kind: 'stairs', from: { level: levelIds[k], p: [X(c.laneL), Z(2.0)], y: floorY[k] }, to: { level: levelIds[k + 1], p: [X(c.laneU), Z(2.0)], y: floorY[k + 1] },
    width: 0.8, heading: -Math.PI / 2, path: hotelFlight(c, floorY[k], floorY[k + 1]).map(([x, y, z]) => [X(x), r3(y), Z(z)]), usable: true, faceAlong: true,
    // both ends are entered heading north into the well (a dog-leg): the top is approached from the south
    approach: { from: [X(c.laneL), Z(2.7)], to: [X(c.laneU), Z(2.7)] },
  });
  return { version: 'upper-floors/1', building: { id: h.id, label: h.label, crop, levels, surfaces, solids, links, regions, openings: open.ids } };
}
function rect(x0, z0, x1, z1) { return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]; }

export const hotelsFacts = () => HOTELS.map(hotelFact);
export const hotelsRemoveFacts = () => HOTELS.map((h) => ({ version: 'upper-floors/1', remove: h.id }));

/** First-floor and lobby spots: write at each guest room's desk, look out over the sea from its balcony, read on the lobby
 *  sofa. Places are the facts' own rooms (they exist once the hotel is installed). */
export function hotelsSpots() {
  const spots = [];
  for (const h of HOTELS) {
    const c = hotelCoreLayout(h.w, HOTEL_DEPTH), X = (x) => r3(h.cx + x), Z = (z) => r3(HOTEL_Z + z), l = hotelLevels(h)[0], x0 = c.inner[0];
    for (const [k, z] of [0.3, 1.3].entries()) spots.push({ id: `hotel-${h.n}-lobby-sofa-${k + 1}`, place: `${h.id}-lobby`, activity: 'read', base: 'sit', at: [X(x0 + 0.62), Z(z)], faceTo: [X(x0 + 1.6), Z(z)], seatHeight: 0.45, level: 0, label: `${h.label} lobby sofa` });
    for (const [j, bx] of c.guestColumns.entries()) {
      const room = `${h.id}-room-10${j + 1}`;
      spots.push({ id: `hotel-${h.n}-room-10${j + 1}-desk`, place: room, activity: 'write', base: 'sit', at: [X(bx + 1.05), Z(-2.0)], faceTo: [X(bx + 1.05), Z(-2.9)], seatHeight: 0.48, level: l.id, label: `Room 10${j + 1} desk, ${h.label.toLowerCase()}` },
        { id: `hotel-${h.n}-room-10${j + 1}-balcony`, place: room, activity: 'drink', base: 'idle', title: 'Look out over the sea', at: [X(bx), Z(5.6)], faceTo: [X(bx), Z(8)], level: l.id, label: `Room 10${j + 1} balcony, ${h.label.toLowerCase()}` });
    }
  }
  return spots;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2]; if (!out) { console.error('usage: old-eden-hotels.mjs <out-dir>'); process.exit(2); }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'hotels.fact.json'), JSON.stringify(hotelsFacts(), null, 1) + '\n');
  writeFileSync(join(out, 'hotels.spots.json'), JSON.stringify(hotelsSpots(), null, 1) + '\n');
  console.log(join(out, 'hotels.fact.json'), join(out, 'hotels.spots.json'));
}
