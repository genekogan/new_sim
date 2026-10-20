// arrival-search/1 (lane ARR): where a new Soul stands when the arrival point cannot take it. Pure geometry fixtures:
// a box world with solid rectangles, water rectangles and standing bodies; clearance is the exact distance to the
// nearest solid or the world's edge, as the level-0 grid reports it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchArrival, arrivalPocket, type ArrivalGround } from './arrival-search.ts';

type Rect = [number, number, number, number];
const R = 0.28;
function ground({ size = 100, solids = [] as Rect[], water = [] as Rect[], people = [] as [number, number][] } = {}): ArrivalGround & { reads: number } {
  const h = size / 2, dRect = ([x0, z0, x1, z1]: Rect, x: number, z: number) => {
    const dx = Math.max(x0 - x, 0, x - x1), dz = Math.max(z0 - z, 0, z - z1); return Math.hypot(dx, dz);
  };
  const g = {
    reads: 0, bounds: [-h, -h, h, h] as const, people, radius: R, cos: Math.cos, sin: Math.sin,
    clear(q: [number, number]) {
      g.reads++;
      const edge = Math.min(q[0] + h, h - q[0], q[1] + h, h - q[1]); if (edge <= 0) return 0;
      return Math.min(edge, ...solids.map(s => dRect(s, q[0], q[1])), R);
    },
    medium(q: [number, number]) { return water.some(w => dRect(w, q[0], q[1]) === 0) ? 2 : 0; },
  };
  return g;
}
const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

test('a clear arrival point is its own spot, in the open area', () => {
  const s = searchArrival(ground(), [0, 0])!;
  assert.deepEqual(s.at, [0, 0]); assert.equal(s.open, true); assert.equal(s.distance, 0);
  assert.equal(arrivalPocket(ground(), [0, 0]).open, true);
});

test('a 30 m structure built over the arrival point: the nearest clear ground just outside it', () => {
  const g = ground({ solids: [[-15, -15, 15, 15]] }), s = searchArrival(g, [0, 0])!;
  assert.equal(s.open, true);
  assert.ok(g.clear(s.at) >= R, 'a body stands clear of the structure');
  assert.ok(s.distance >= 15 + R && s.distance <= 15 + R + 0.5, `just outside the 30 m footprint: ${s.distance} m`);
});

test('an arrival walled in by buildings: never the sealed courtyard, the nearest spot outside the walls', () => {
  // a 10 m courtyard (walls 1 m thick) around the arrival point; inside is clear ground but sealed
  const walls: Rect[] = [[-6, -6, 6, -5], [-6, 5, 6, 6], [-6, -6, -5, 6], [5, -6, 6, 6]];
  const g = ground({ solids: walls });
  assert.equal(arrivalPocket(g, [0, 0]).open, false, 'the courtyard is a sealed pocket');
  const s = searchArrival(g, [0, 0])!;
  assert.equal(s.open, true); assert.ok(Math.max(Math.abs(s.at[0]), Math.abs(s.at[1])) >= 6 + R, `outside the walls: ${s.at}`);
  assert.ok(s.distance < 7.5, `the nearest spot outside: ${s.distance} m`);
});

test('an arrival point in a lake: the nearest dry ground on the shore', () => {
  const g = ground({ water: [[-8, -8, 8, 8]] }), s = searchArrival(g, [0, 0])!;
  assert.equal(s.open, true); assert.equal(g.medium(s.at), 0);
  assert.ok(s.distance > 8 && s.distance <= 8.5, `on the shore: ${s.distance} m`);
});

test('a crowd on the arrival point: the nearest spot nobody stands within 0.8 m of', () => {
  const people: [number, number][] = [];
  for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) people.push([i * 0.9, j * 0.9]);
  const g = ground({ people }), s = searchArrival(g, [0, 0])!;
  assert.equal(s.open, true); assert.ok(people.every(p => dist(p, s.at) >= 0.8), 'apart from everyone');
  assert.ok(s.distance < 4.5, `close to the crowd: ${s.distance} m`);
});

test('no free walkable ground anywhere: null (the only refusal)', () => {
  assert.equal(searchArrival(ground({ size: 20, solids: [[-10, -10, 10, 10]] }), [0, 0]), null);
  assert.equal(searchArrival(ground({ size: 20, water: [[-10, -10, 10, 10]] }), [0, 0]), null);
});

test('a world that is all small sealed rooms: the nearest spot of the largest one', () => {
  // a 40 m world of rock with two rooms: 3 x 3 m round the arrival point and 6 x 6 m from x = 9 to 15
  const solids: Rect[] = [[-20, -20, -1.5, 20], [1.5, -20, 9, 20], [15, -20, 20, 20], [-1.5, -20, 1.5, -1.5], [-1.5, 1.5, 1.5, 20], [9, -20, 15, -3], [9, 3, 15, 20]];
  const s = searchArrival(ground({ size: 40, solids }), [0, 0])!;
  assert.equal(s.open, false);
  assert.ok(s.at[0] > 9, `the larger room: ${s.at}`);
  assert.ok(s.size > arrivalPocket(ground({ size: 40, solids }), [0, 0]).size);
});

test('deterministic: the same ground gives the same spot', () => {
  const a = searchArrival(ground({ solids: [[-15, -15, 15, 15]] }), [0, 0]), b = searchArrival(ground({ solids: [[-15, -15, 15, 15]] }), [0, 0]);
  assert.deepEqual(a, b);
});
