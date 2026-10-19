// Harvest fix kitlenient: define-kit carries every def/1 field, names the kit keys it ignores, and prints the
// server's kit corrections in one short line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { kitDefinition, kitIgnoredKeys } from './kit.mjs';
import { correctedLine } from '../cli.mjs';

const box = { kind: 'box', at: [0, .5, 0], size: [1, 1, 1] };
test('kitDefinition carries actions and other def/1 fields; unknown kit keys are reported, not dropped silently', () => {
  const actions = [{ name: 'poke', label: 'poke', then: [{ op: 'toggle', field: 'lit' }] }];
  const k = { name: 'lamp', shapes: [box], actions, state: { lit: { type: 'bool', default: false } }, palette: { glass: '#ffeeaa' }, category: 'object.light', frobnicate: 3, form: 'path' };
  const def = kitDefinition(k);
  assert.deepEqual(def.actions, actions); assert.deepEqual(def.palette, k.palette); assert.equal(def.category, 'object.light');
  assert.equal(def.frobnicate, undefined); assert.equal(def.form, 'point');
  assert.deepEqual(kitIgnoredKeys(k), ['frobnicate', 'form']);
  assert.deepEqual(kitIgnoredKeys({ name: 'x', shapes: [box], v: 2, gait: 'none', slots: [], box: [1, 1, 1], scale: [1, 1] }), []);
  assert.deepEqual(kitIgnoredKeys(def), []);
});
test('a program without box leaves size.box to the server; a plain kit is still measured locally', () => {
  const program = kitDefinition({ name: 'row', shapes: [{ ...box, repeat: { n: 3, step: [2, 0, 0] } }] });
  assert.equal(program.size.box, undefined); assert.deepEqual(program.size.scale, [.5, 2]);
  assert.ok(kitDefinition({ name: 'one', shapes: [box] }).size.box.every(Number.isFinite)); // unchanged local estimate
});
test('correctedLine prints the corrections as one short line', () => {
  const w = ['kit.corrected: t@1 make.args.shapes.0.h removed (no effect on ring)', 'kit.corrected: t@1 size.box computed [2,0.2,2] from the shapes', 'not a kit warning'];
  assert.equal(correctedLine(w), 'corrected t@1: shapes.0.h removed (no effect on ring); size.box computed [2,0.2,2] from the shapes');
  assert.equal(correctedLine([], ['frobnicate']), 'corrected: ignored kit keys: frobnicate');
  assert.equal(correctedLine(['other']), ''); assert.equal(correctedLine(undefined), '');
  const many = Array.from({ length: 8 }, (_, i) => `kit.corrected: t@1 make.args.shapes.${i}.r removed (no effect on box)`);
  const line = correctedLine(many);
  assert.ok(!line.includes('\n')); assert.match(line, /; \+3 more$/);
  assert.match(correctedLine(['kit.corrected: a@1 make.args.shapes.0.h removed (x)', 'kit.corrected: b@1 make.args.shapes.0.h removed (x)']), /^corrected: a@1 shapes\.0\.h removed \(x\); b@1 shapes/);
});
