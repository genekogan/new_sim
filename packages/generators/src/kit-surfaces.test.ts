// Y1 / XP7: the kit/2 `pattern` field is contract-2 presentation data. Offline; no renderer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { kitArgs, kitGen, kitPhysics, KIT_PATTERNS, setKitViewerContract } from './kit.ts';
import { expandKitProgram } from './kit-program.ts';

const kit = (shape: Record<string, unknown>, v = 2) => ({ v, shapes: [{ kind: 'box', at: [0, 0.5, 0], size: [1, 1, 1], ...shape }] });

test('v2 shapes accept every pattern; unknown values refuse with the field path', () => {
  for (const pattern of KIT_PATTERNS) assert.equal(kitArgs.safeParse(kit({ material: 'stone', pattern })).success, true, pattern);
  const r = kitArgs.safeParse(kit({ pattern: 'tartan' }));
  assert.equal(r.success, false);
  if (!r.success) assert.deepEqual(r.error.issues[0].path, ['shapes', 0, 'pattern']);
});

test('a pattern on glass, water, emissive or a glowing shape refuses with a fix; none is harmless', () => {
  for (const shape of [{ material: 'glass' }, { material: 'water' }, { material: 'emissive' }, { glow: 0.5 }]) {
    const r = kitArgs.safeParse(kit({ ...shape, pattern: 'stripes' }));
    assert.equal(r.success, false, JSON.stringify(shape));
    if (!r.success) { assert.deepEqual(r.error.issues[0].path, ['shapes', 0, 'pattern']); assert.match(r.error.issues[0].message, /fix: remove pattern/); }
    assert.equal(kitArgs.safeParse(kit({ ...shape, pattern: 'none' })).success, true);
  }
});

test('definition refuses a pattern on a legacy kit; retained legacy data still parses and bakes the same', () => {
  setKitViewerContract({ 'kit/2': 2 });
  const r = kitGen.args!.safeParse(kit({ material: 'stone', pattern: 'marble' }, 1));
  assert.equal(r.success, false);
  if (!r.success) { assert.deepEqual(r.error.issues[0].path, ['shapes', 0, 'pattern']); assert.match(r.error.issues[0].message, /requires kit contract 2; fix: set make.args.v to 2/); }
  assert.equal(kitGen.args!.safeParse(kit({ material: 'stone', pattern: 'marble' })).success, true);
  const legacy = kitArgs.parse(kit({ material: 'stone', pattern: 'marble' }, 1));
  assert.deepEqual(kitPhysics(legacy), kitPhysics(kitArgs.parse(kit({ material: 'stone' }, 1))));
});

test('presentation only: a pattern changes no bounds, colliders, slots or triangle estimate', () => {
  const shapes = [{ kind: 'box', at: [0, 0.5, 0], size: [2, 1, 1] }, { kind: 'cyl', at: [2, 1, 0], r: 0.4, h: 2 }, { kind: 'wedge', at: [0, 1.5, 0], size: [2, 1, 1] }];
  for (const pattern of KIT_PATTERNS) {
    const plain = kitPhysics(kitArgs.parse({ v: 2, shapes }));
    const patterned = kitPhysics(kitArgs.parse({ v: 2, shapes: shapes.map(s => ({ ...s, material: 'stone', pattern })) }));
    assert.deepEqual(patterned, kitPhysics(kitArgs.parse({ v: 2, shapes: shapes.map(s => ({ ...s, material: 'stone' })) })), pattern);
    assert.deepEqual({ ...patterned }, plain, pattern);
  }
});

test('kit programs carry pattern through repeats, mirrors and repeat-step overrides', () => {
  const out = expandKitProgram({ v: 2, shapes: [{ kind: 'box', at: [0, 0.5, 0], size: [0.5, 1, 0.5], material: 'fabric', pattern: 'stripes', mirror: 'x', repeat: { n: 3, step: { at: [1, 0, 0], pattern: 'none' } } }] });
  assert.equal(out.shapes.length, 6);
  assert.deepEqual(out.shapes.map(s => s.pattern), ['stripes', 'stripes', 'none', 'none', 'none', 'none']);
});
