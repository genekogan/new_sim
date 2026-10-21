import test from 'node:test';
import assert from 'node:assert/strict';
import { keySeen, shapeWedgeDistance, viewFirst, viewWedge, wedgeDistance } from './arrival-view.ts';

// a portrait phone (390x844) looking down -z from 14 m up at a target 50 m ahead
const wedge = () => viewWedge([0, 14, 0], [0, 0, -50], 45, 390 / 844)!;

test('a portrait camera sees a narrow ground wedge ahead of it, widest at its bottom corners', () => {
  const w = wedge();
  assert.ok(w); assert.deepEqual([w.ax, w.az], [0, 0]); assert.ok(Math.abs(w.dx) < 1e-9 && Math.abs(w.dz + 1) < 1e-9);
  const half = Math.acos(w.cos) * 180 / Math.PI;
  assert.ok(half > 10 && half < 25, `half angle ${half}`);
  assert.equal(wedgeDistance(w, 0, -50), 0);                 // the target
  assert.ok(wedgeDistance(w, 0, 30) > 25);                    // behind the eye: its distance to the apex
  assert.ok(wedgeDistance(w, 40, -50) > 10);                  // beside the view
  assert.equal(viewWedge([0, 50, 0], [0, 0, -1], 45, 0.5), null);   // looking almost straight down: no wedge
  assert.equal(viewWedge([0, 0, 0], [0, 0, 0], 45, 0.5), null);
});

test('a path or area counts as soon as any part of it reaches the wedge, or the wedge lies inside it', () => {
  const w = wedge();
  assert.equal(shapeWedgeDistance(w, [[-100, -40], [100, -40]], false), 0);                 // a road across the view
  assert.ok(shapeWedgeDistance(w, [[40, 10], [40, 20]], false) > 30);                       // a path behind and beside
  assert.equal(shapeWedgeDistance(w, [[-500, -500], [500, -500], [500, 500], [-500, 500]], true), 0);   // the eye stands in it
  assert.ok(shapeWedgeDistance(w, [[30, 0], [40, 0], [40, 10], [30, 10]], true) > 20);
});

test('keySeen: a margin widens the view; unknown keys always count', () => {
  const w = wedge(), d = wedgeDistance(w, 30, -50);
  assert.ok(d > 5);
  assert.equal(keySeen(w, [30, -50], d - 1), false);
  assert.equal(keySeen(w, [30, -50], d + 1), true);
  assert.equal(keySeen(w, null, 0), true);
  assert.equal(keySeen(w, { area: [[28, -52], [32, -52], [32, -48], [28, -48]] }, d - 1), true);   // its near edge
});

test('viewFirst: seen near things first, then the seen ones just beyond, then the unseen near ones, then the rest', () => {
  const list = ['a', 'B', 'c', 'D', 'E', 'f', 'G', 'h'], seen = (s: string) => s === s.toUpperCase();
  assert.deepEqual(viewFirst(list, 4, seen), { list: ['B', 'D', 'a', 'c', 'E', 'f', 'G', 'h'], first: 2 });
  assert.deepEqual(viewFirst(list, 4, seen, 3), { list: ['B', 'D', 'E', 'G', 'a', 'c', 'f', 'h'], first: 2 });
  assert.deepEqual(viewFirst(list, 4, seen, 100).list.length, list.length);
});
