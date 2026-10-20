import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WorldTour, makeMove, openingMove, type TourView } from './WorldTour.ts';

const views: TourView[] = [
  { id: 'a', label: 'A', p: [0, 10, 30], target: [0, 2, 0] },
  { id: 'b', label: 'B', p: [50, 12, 20], target: [40, 2, 0] },
];

test('lane W1: an arriving page takes the authored push without any ray check; later moves are checked again', () => {
  const tour = new WorldTour(views, 7); let checks = 0;
  const count = () => { checks++; return true; };
  const first = tour.pose(0, { daylight: 1, quick: true, clear: count, sight: count, open: count });
  assert.equal(checks, 0, 'no checks while arriving');
  assert.match(first.id, /^push:(a|b)$/, 'a push');
  const push = makeMove(views.find((v) => first.id === 'push:' + v.id)!, 'push', 14, 1).at(0);
  assert.deepEqual(first.position.map((v) => Math.round(v * 1000)), push.position.map((v) => Math.round(v * 1000)), 'the push of an authored view');
  tour.pose(15, { daylight: 1, clear: count, sight: count, open: count });
  assert.ok(checks > 0, 'the next move (after the arrival) is checked');
});

test('WorldBroadcast asks for the quick move only while the arrival is not over, or for the arrival camera\'s opening view', () => {
  const src = readFileSync(new URL('./WorldBroadcast.ts', import.meta.url), 'utf8');
  assert.match(src, /tour\.pose\(wallSeconds, \{ daylight, prefer, quick: opening \|\| !arrivalOver\(\),/);
});

test('P7f: the opening move is the authored view itself at k = 0 (the arrival poster\'s camera), then a gentle push', () => {
  const m = openingMove(views[1]);
  assert.equal(m.type, 'push');
  assert.deepEqual(m.at(0), { position: [...views[1].p], target: [...views[1].target], fov: 45 });
  const tour = new WorldTour(views, 3);
  const first = tour.pose(100, { daylight: 1, prefer: views[1], quick: true, clear: () => false, sight: () => false });
  assert.deepEqual([first.position, first.target, first.id], [[...views[1].p], [...views[1].target], 'push:b']);
});
