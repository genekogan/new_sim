import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { expandKitProgram, kitNumber, KitProgramError, CREATION_LIMITS as L, kitPhysics, kitArgs } from './index.ts';

const box = { kind: 'box', at: [1, 1, 0], size: [1, 2, 1] };
const expand = (s: unknown, params = {}) => expandKitProgram({ shapes: [s] }, params);
function refusal(s: unknown, field: string, params = {}) {
  assert.throws(() => expand(s, params), e => e instanceof KitProgramError && e.field.includes(field) && !!e.fix);
}
test('ordinary kits retain defaults and input is never mutated', () => {
  const input = { shapes: [box] }, original = structuredClone(input);
  assert.deepEqual(expandKitProgram(input), kitArgs.parse(input));
  assert.deepEqual(input, original);
});
test('safe arithmetic has precedence, unary signs, brackets and declared numeric params', () => {
  assert.equal(kitNumber('($height-1)*0.6 + -2/4', { height: 6 }), 2.5);
  assert.equal(kitNumber('$leg-length/2', { 'leg-length': 3 }), 1.5);
  assert.equal(kitNumber('1e-3 + .5', {}), .501);
  for (const text of ['$missing', '$height.x', '$height.constructor()', 'globalThis', '1/0', '0/0', '1e999', '2**4', '1;2', '('.repeat(30) + '1' + ')'.repeat(30)]) {
    assert.throws(() => kitNumber(text, { height: 2 }), KitProgramError, text);
  }
  assert.throws(() => kitNumber('$height', { height: '2' }), KitProgramError);
  assert.throws(() => kitNumber('$toString', {}), KitProgramError);
});
test('$params affect numeric fields and nested geometry, leaving text fields intact', () => {
  const s = expand({ kind: 'sweep', at: [0, '$height/2', 0], path: [[0, 0, 0], ['$height-1', 2, 0]], r: '$height*.1', tint: 'height', when: 'height>1' }, { height: 4 }).shapes[0];
  assert.deepEqual(s.at, [0, 2, 0]); assert.deepEqual(s.path, [[0, 0, 0], [3, 2, 0]]); assert.equal(s.r, .4);
  assert.equal(s.when, 'height>1'); assert.equal(s.tint, 'height');
  refusal({ ...box, size: [1, '$missing', 1] }, 'size.1');
});
test('repeat translates parts and pivots; radial and mirror compose in a fixed order', () => {
  const a = expand({ ...box, pivot: [1, 2, 0], repeat: { n: 3, step: [2, 0, 0] } });
  assert.deepEqual(a.shapes.map(s => s.at), [[1, 1, 0], [3, 1, 0], [5, 1, 0]]);
  assert.deepEqual(a.shapes[2].pivot, [5, 2, 0]);
  const b = expand({ ...box, radial: { n: 4, r: 2, face: 'out' }, mirror: true });
  assert.equal(b.shapes.length, 8); assert.equal(b.shapes[2].yaw, Math.PI / 2);
  assert.ok(Math.abs(b.shapes[2].at[0] - 3) < 1e-12);
  assert.deepEqual(expandKitProgram({ shapes: [box] }), expandKitProgram({ shapes: [box] }));
});
test('radial partial arcs include both ends, while a full circle has no duplicate seam', () => {
  const a = expand({ ...box, radial: { n: 5, r: 2, start: -Math.PI / 2, arc: Math.PI, face: 'in' } });
  assert.ok(Math.abs(a.shapes[0].at[0] + 1) < 1e-12); assert.ok(Math.abs(a.shapes[4].at[0] - 3) < 1e-12);
  assert.equal(a.shapes[0].yaw, Math.PI / 2);
  assert.equal(expand({ ...box, radial: { n: 1, r: 0, face: 'none' } }).shapes[0].yaw, undefined);
  const full = expand({ ...box, radial: { n: 4, r: 2, arc: -2 * Math.PI } });
  assert.ok(Math.hypot(...full.shapes[3].at.map((v, k) => v - full.shapes[0].at[k])) > 1);
  const pivot = expand({ ...box, at: [0, 0, 0], pivot: [0, 0, 1], radial: { n: 4, r: 2 } }).shapes[1].pivot!;
  assert.ok(Math.abs(pivot[0] - 3) < 1e-10 && Math.abs(pivot[2]) < 1e-10);
});
test('mirror reflects geometry, pivots, rotations and all left/right role spellings', () => {
  for (const [a, b] of [['arm.l', 'arm.r'], ['leg.fl', 'leg.fr'], ['leg.bl', 'leg.br']]) {
    const s = expand({ ...box, role: a, yaw: .4, roll: .2, pivot: [2, 3, 4], mirror: true }).shapes[1];
    assert.equal(s.role, b); assert.deepEqual(s.at, [-1, 1, 0]); assert.deepEqual(s.pivot, [-2, 3, 4]);
    assert.equal(s.yaw, -.4); assert.equal(s.roll, -.2); assert.deepEqual(s.scale, [-1, 1, 1]);
  }
  assert.equal(expand({ ...box, mirror: ['x', 'y', 'z'] }).shapes.length, 8);
  refusal({ ...box, mirror: ['x', 'x'] }, 'mirror');
});
test('numeric delta steps and n−1 delta lists encode finite variants without a generator script', () => {
  const a = expand({ ...box, repeat: { n: 2, step: { at: [2, 0, 0], size: [1, 0, 0], color: '#abcdef', collide: false } } });
  assert.deepEqual(a.shapes[1].size, [2, 2, 1]); assert.equal(a.shapes[1].color, '#abcdef'); assert.equal(a.shapes[1].collide, false);
  const b = expand({ ...box, repeat: { n: 3, step: [{ at: [2, 0, 0] }, { at: [0, 3, 0] }] } });
  assert.deepEqual(b.shapes[2].at, [3, 4, 0]);
  refusal({ ...box, repeat: { n: 3, step: [{ at: [1, 0, 0] }] } }, 'repeat.step');
  refusal({ ...box, repeat: { n: 2, step: { code: 'oops' } } }, 'repeat.step.code');
});
test('from/to aligns +y to both endpoints; capsule length includes its caps', () => {
  for (const to of [[3, 2, 4], [2, 0, 0], [0, 0, 2], [0, -2, 0]]) {
    const s = expand({ kind: 'cyl', from: [0, 0, 0], to, r: .1 }).shapes[0];
    const p = s.pitch!, y = s.yaw!, len = s.h!;
    const axis = [-Math.sin(y) * Math.sin(p), Math.cos(p), -Math.cos(y) * Math.sin(p)];
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(axis[k] * len - to[k]) < 1e-10);
  }
  assert.equal(expand({ kind: 'capsule', from: [0, 0, 0], to: [0, 2, 0], r: .2 }).shapes[0].h, 1.6);
  assert.deepEqual(expand({ kind: 'box', from: [0, 0, 0], to: [0, 2, 0], size: [.1, 9, .2] }).shapes[0].size, [.1, 2, .2]);
  refusal({ kind: 'cyl', from: [0, 0, 0], to: [0, 0, 0] }, 'to');
  refusal({ ...box, from: [0, 0, 0], to: [0, 2, 0] }, 'from');
  refusal({ kind: 'capsule', from: [0, 0, 0], to: [0, .1, 0], r: 1 }, 'to');
});
test('pointed arches and filled lancet outlines expand to ordinary kit shapes', () => {
  const a = expand({ kind: 'arch.pointed', at: [0, 2, 0], size: [2, 4, .3], segments: 8 });
  assert.equal(a.shapes[0].kind, 'arch'); assert.ok(a.shapes[0].polygon!.length < 64);
  assert.deepEqual(kitPhysics(a).box, [2, 4, .3]); assert.equal(kitPhysics(a).colliders.length, 0);
  assert.deepEqual(expand({ kind: 'arch', outline: 'lancet', at: [0, 2, 0], size: [2, 4, .3], segments: 8 }), a);
  assert.deepEqual(kitPhysics({ shapes: [{ kind: 'arch.pointed', at: [0, 1.5, 0] }] }).box, [2, 3, .2]);
  const b = expand({ kind: 'extrude', at: [0, 0, 0], outline: 'lancet', size: [2, 4, .1], segments: 5 });
  assert.equal(b.shapes[0].polygon!.length, 13); assert.equal(Math.max(...b.shapes[0].polygon!.map(p => p[1])), 4);
  refusal({ kind: 'extrude', at: [0, 0, 0], outline: 'lancet', size: [4, 1, .1] }, 'shapes.0');
  refusal({ ...box, outline: 'lancet' }, 'outline');
});
test('96 authored entries and 512 expanded primitives have separate hard limits', () => {
  assert.equal(expand({ ...box, repeat: { n: L.kitExpandedShapes, step: [1, 0, 0] } }).shapes.length, 512);
  assert.throws(() => expandKitProgram({ shapes: Array.from({ length: 97 }, () => box) }));
  refusal({ ...box, repeat: { n: 512, step: [1, 0, 0] }, mirror: true }, 'shapes.0');
  refusal({ ...box, repeat: { n: 1e9, step: [1, 0, 0] } }, 'repeat.n');
  for (const n of [0, -1, .5]) refusal({ ...box, repeat: { n, step: [1, 0, 0] } }, 'repeat.n');
  assert.equal(kitPhysics({ shapes: [{ ...box, repeat: { n: 100, step: [1, 0, 0] } }] }).tris, 4400);
});
test('expanded numeric validation still points at the authored entry', () => {
  assert.throws(() => expandKitProgram({ shapes: [{ ...box, repeat: { n: 100, step: [1, 0, 0] } }, { kind: 'cyl', at: [0, 0, 0], r: '$r' }] }, { r: -1 }), e => e instanceof z.ZodError && JSON.stringify(e.issues).includes('"shapes",1,"r"'));
});
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/kit-programs/${name}.json`, import.meta.url), 'utf8'));
const colliderKey = (o: unknown) => JSON.stringify(o, (_k, v) => typeof v === 'number' ? Math.round(v * 1e8) / 1e8 : v);
for (const name of ['m4-gatehouse', 'm2-tower']) test(`${name}: declarative rewrite ≤25 entries, matching bake within 1 mm`, () => {
  const original = fixture(`${name}.original`), { box: _box, ...program } = fixture(`${name}.kit`), expanded = expandKitProgram(program);
  const a = kitPhysics(original), b = kitPhysics(program);
  assert.ok(program.shapes.length <= 25); assert.equal(expanded.shapes.length, original.shapes.length);
  assert.equal(a.tris, b.tris); assert.deepEqual(a.slots, b.slots);
  a.box.forEach((v, i) => assert.ok(Math.abs(v - b.box[i]) <= .001));
  assert.deepEqual(a.colliders.map(colliderKey).sort(), b.colliders.map(colliderKey).sort());
});
