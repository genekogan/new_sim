import test from 'node:test';
import assert from 'node:assert/strict';
import { kitArgs, kitGen, kitPhysics, setKitViewerContract } from './kit.ts';
import { CREATION_LIMITS } from './creation-limits.ts';

const square = [[-2, -2], [2, -2], [2, 2], [-2, 2]];
const hole = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const parse = (shape: Record<string, unknown>, v = 2) => kitArgs.safeParse({ v, shapes: [{ at: [0, 0, 0], ...shape }] });

test('omitted contract means legacy; unsupported versions and new fields on legacy refuse', () => {
  assert.equal(kitArgs.parse({ shapes: [{ kind: 'sphere', at: [0, 0, 0] }] }).v, 1);
  for (const v of [0, 3, '2']) assert.equal(kitArgs.safeParse({ v, shapes: [{ kind: 'box', at: [0, 0, 0] }] }).success, false);
  for (const shape of [{ kind: 'extrude', holes: [hole] }, { kind: 'loft', polygon: square, top: square }, { kind: 'sweep', profile: hole }]) {
    const r = parse(shape, 1); assert.equal(r.success, false);
    if (!r.success) assert.match(r.error.issues[0].message, /fix: set make.args.v to 2/);
  }
});

test('admission refuses new contracts until the served viewer supports them; retained data still bakes', () => {
  try {
    for (const manifest of [null, {}, { 'kit/2': 1 }, { 'kit/2': 99 }]) {
      assert.equal(setKitViewerContract(manifest), 1);
      const r = kitGen.args!.safeParse({ v: 2, shapes: [{ kind: 'box', at: [0, 0, 0] }] }); assert.equal(r.success, false);
      if (!r.success) { assert.deepEqual(r.error.issues[0].path, ['v']); assert.match(r.error.issues[0].message, /fix: build and serve/); }
      assert.ok(kitPhysics(kitArgs.parse({ v: 2, shapes: [{ kind: 'box', at: [0, 0, 0] }] })).tris > 0);
    }
    setKitViewerContract({ 'kit/2': 2 }); assert.equal(kitGen.args!.safeParse({ v: 2, shapes: [{ kind: 'box', at: [0, 0, 0] }] }).success, true);
  } finally { setKitViewerContract({ 'kit/2': 2 }); }
});

test('unused fields are refused at their field with an actionable fix in contract 2', () => {
  for (const shape of [{ kind: 'sphere', h: 3 }, { kind: 'cone', r2: 1 }, { kind: 'box', segments: 12 }, { kind: 'arch', round: 0.1 }, { kind: 'sphere', pivot: [0, 0, 0] }, { kind: 'box', mystery: 1 }, { kind: 'sweep', profile: hole, segments: 8 }, { kind: 'capsule', segments: 12 }]) {
    const r = parse(shape); assert.equal(r.success, false, JSON.stringify(shape));
    if (!r.success) { assert.equal(r.error.issues[0].path[0], 'shapes'); assert.match(r.error.issues[0].message, /fix:/); }
  }
  assert.equal(parse({ kind: 'arch', arc: Math.PI + 0.01 }).success, false);
  assert.equal(parse({ kind: 'lathe', profile: [[-1, 0], [1, 2]] }).success, false);
  assert.equal(parse({ kind: 'sweep', path: [[0, 0, 0], [0, 0, 0]] }).success, false);
});

test('holes are strictly interior, simple and disjoint; loft outlines correspond', () => {
  assert.equal(parse({ kind: 'extrude', polygon: square, holes: [hole] }).success, true);
  for (const holes of [[square], [[[1, 1], [3, 1], [3, 3], [1, 3]]], [hole, hole], [[[0, 0], [1, 1], [0, 1], [1, 0]]], [hole, hole.map(p => p.map(n => n / 2))]]) assert.equal(parse({ kind: 'extrude', polygon: square, holes }).success, false);
  assert.equal(parse({ kind: 'loft', polygon: square, top: hole, h: 3 }).success, true);
  assert.equal(parse({ kind: 'loft', polygon: square }).success, false);
  assert.equal(parse({ kind: 'loft', polygon: square, top: hole.slice(0, 3) }).success, false);
  assert.equal(parse({ kind: 'loft', polygon: square, top: [...hole].reverse() }).success, false);
});

test('triangle admission includes holes, smooth boxes and path subdivisions', () => {
  const large = Array.from({ length: 40 }, (_, i) => [Math.cos(i / 40 * Math.PI * 2), Math.sin(i / 40 * Math.PI * 2)]);
  const shape = { kind: 'sweep', at: [0, 0, 0], profile: large, path: Array.from({ length: 64 }, (_, i) => [i, 0, 0]) };
  const r = kitArgs.safeParse({ v: 2, shapes: Array(4).fill(shape) });
  assert.equal(r.success, false);
  if (!r.success) assert.match(r.error.issues[0].message, new RegExp(`triangle estimate.*${CREATION_LIMITS.defTris}.*fix:`));
  const small = kitArgs.parse({ v: 2, shapes: [{ kind: 'extrude', at: [0, 0, 0], polygon: square, holes: [hole], h: 0.3, round: 0 }] });
  assert.ok(kitPhysics(small).tris >= 32); assert.equal(kitPhysics(small).colliders.length, 1);
  assert.deepEqual(kitPhysics(small).colliders[0].half, [2, 2]);
});
