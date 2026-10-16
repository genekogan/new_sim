// XP8 admission: faces and decals show only this world's image assets; decals name a wall slot of their building.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WorldModel, CORE_KIT, applyBatch, type Failure } from './index.ts';

const fixtures = JSON.parse(readFileSync(new URL('../../generators/src/fixtures/faces-kits.json', import.meta.url), 'utf8'));
const sha = 'a'.repeat(64), image = `/assets/${sha}.png`, glb = 'd'.repeat(64);
function world() {
  const w = new WorldModel({ constants: { ground: 'land', extent: 200 }, seed: 'faces-test', assets: hash => hash === sha ? { tris: 0, bytes: 80, textures: 1, box: [1, 1, 0], image: { ext: 'png' } } : hash === glb ? { tris: 10, bytes: 80, textures: 0, box: [1, 1, 1] } : undefined });
  for (const d of CORE_KIT) w.defineDef(d, 'core', 0);
  return w;
}
let tick = 1;
const act = (w: WorldModel, ops: unknown[]) => applyBatch(w, { ops }, 'god', tick++);
function refused(w: WorldModel, ops: unknown[], field: RegExp, fix: RegExp = /Upload the image to this world with POST \/v1\/god\/assets/): Failure {
  const before = w.snapshot(), r = act(w, ops).result;
  assert.equal(r.accepted, false, JSON.stringify(r)); if (r.accepted) throw Error('expected refusal');
  const f = r.failures[0];
  assert.equal(f.code, 'params.invalid', JSON.stringify(f)); assert.match(f.field ?? '', field, JSON.stringify(f)); assert.match(f.fix ?? '', fix, JSON.stringify(f));
  assert.deepEqual(w.snapshot(), before, 'a refused face edits nothing');
  return f;
}
const kit = (name: string, face: Record<string, unknown>, shape: Record<string, unknown> = {}) => ({ op: 'define', def: { schema: 'def/1', name, layer: 'decor', size: { box: [1.2, 1, 0.2] },
  make: { kind: 'gen', gen: 'kit/2', args: { v: 2, shapes: [{ kind: 'box', at: [0, 0.5, 0], size: [1.2, 0.8, 0.05], faces: [face], ...shape }] } } } });

test('the menu board, stained-glass window and mosaic define and place as ordinary kits', () => {
  const w = world();
  for (const [i, def] of [fixtures.menuBoard, fixtures.stainedGlassWindow, fixtures.mosaicMedallion].entries()) {
    const r = act(w, [{ op: 'define', def }, { op: 'place', def: `${def.name}@1`, at: [i * 5, 0], name: def.name }]).result;
    assert.equal(r.accepted, true, `${def.name}: ${JSON.stringify(r)}`);
  }
  assert.ok(w.get('menu-board') && w.get('stained-glass-window') && w.get('mosaic-medallion'));
});

test('a face image of this world is admitted; external, inline, other-world and mismatched images refuse with params.invalid', () => {
  assert.equal(act(world(), [kit('poster', { image })]).result.accepted, true);
  const bad = ['https://example.invalid/tracker.png', '//example.invalid/a.png', 'data:image/png;base64,AAAA', `/assets/${'b'.repeat(64)}.png`, `/assets/${sha}.jpg`, `/assets/${glb}.png`, `/w/other${image}`, `${image}?x=1`];
  for (const media of bad) {
    const f = refused(world(), [kit('poster', { image: media })], /^make\.args\.shapes\.0\.faces\.0\.image$/);
    assert.equal(f.measured, media);
  }
  // Program shapes are checked as authored, before they expand.
  refused(world(), [{ op: 'define', def: { schema: 'def/1', name: 'posters', layer: 'decor', size: { box: [4, 1, 0.2] },
    make: { kind: 'gen', gen: 'kit/2', args: { v: 2, box: [4, 1, 0.2], shapes: [{ kind: 'box', at: [0, 0.5, 0], size: [0.6, 0.8, 0.05], repeat: { n: 3, step: [1, 0, 0] }, faces: [{ image: 'https://example.invalid/a.png' }] }] } } } }], /shapes\.0\.faces\.0\.image/);
});

test('decals on a shop: wall slots and this world\'s images only; refusals name the decal field', () => {
  const w = world();
  const ok = act(w, [{ op: 'place', def: 'core/shop@1', name: 'bakery', at: [0, 0], params: { decals: fixtures.shopDecals } }]).result;
  assert.equal(ok.accepted, true, JSON.stringify(ok));
  assert.equal(act(w, [{ op: 'set', id: 'bakery', params: { decals: [{ slot: 'facade-f0-s-1', w: 1, h: 1, image }] } }]).result.accepted, true);
  refused(w, [{ op: 'set', id: 'bakery', params: { decals: [{ slot: 'facade-f0-s-1', w: 1, h: 1, image: 'https://example.invalid/a.png' }] } }], /^params\.decals\.0\.image$/);
  const slot = refused(w, [{ op: 'set', id: 'bakery', params: { decals: [{ slot: 'facade-f9-s-1', w: 1, h: 1, text: 'X' }] } }], /^params\.decals\.0\.slot$/, /wall slots.*facade-f0-s-1/);
  assert.equal(slot.measured, 'facade-f9-s-1');
  refused(w, [{ op: 'set', id: 'bakery', params: { decals: [{ slot: 'ridge', w: 1, h: 1, text: 'X' }] } }], /^params\.decals\.0\.slot$/, /wall slots/);
  refused(w, [{ op: 'set', id: 'bakery', params: { decals: [{ slot: 'facade-f0-s-1', h: 1, text: 'X' }] } }], /^params\.decals\.0\.w$/, /slot, w, h/);
  refused(w, [{ op: 'set', id: 'bakery', params: { decals: [{ slot: 'facade-f0-s-1', w: 1, h: 1, text: 'X', pattern: 'mosaic' }] } }], /^params\.decals\.0\.pattern$/, /split it into two faces/);
  refused(w, [{ op: 'set', id: 'bakery', params: { decals: { slot: 'facade-f0-s-1' } } }], /^params\.decals$/, /JSON list/);
  refused(w, [{ op: 'set', id: 'bakery', params: { decals: Array.from({ length: 17 }, () => ({ slot: 'facade-f0-s-1', w: 1, h: 1, text: 'X' })) } }], /^params\.decals$/, /JSON list/);
});

test('decals stay on their wall: refused when they hang off its ends, float above the roof, sink below the ground or outgrow it', () => {
  const w = world(), set = (decal: Record<string, unknown>) => [{ op: 'set', id: 'bakery', params: { decals: [{ text: 'X', ...decal }] } }];
  assert.equal(act(w, [{ op: 'place', def: 'core/shop@1', name: 'bakery', at: [0, 0], params: { decals: fixtures.shopDecals } }]).result.accepted, true);
  // The reviewer's probe: a 20 m panel 1000 km above the shop.
  const float = refused(w, set({ slot: 'facade-f0-s-1', w: 20, h: 20, at: [0, 1e6], text: 'FLOAT' }), /^params\.decals\.0\.w$/, /Shrink w to at most 8\.26/);
  assert.equal(float.measured, 20);
  refused(w, set({ slot: 'facade-f0-s-1', w: 2, h: 1, at: [0, 1e6] }), /^params\.decals\.0\.at$/, /Keep at\[1\] between -0\.9 and 6\.42/);
  refused(w, set({ slot: 'facade-f0-s-1', w: 2, h: 0.5, at: [3.5, 0] }), /^params\.decals\.0\.at$/, /Keep at\[0\] between -3\.13 and 3\.13/);
  refused(w, set({ slot: 'facade-f0-s-1', w: 2, h: 9 }), /^params\.decals\.0\.h$/, /Shrink h to at most 8\.32/);
  refused(w, set({ slot: 'opening-front-door', w: 1, h: 0.4, at: [0, -0.5] }), /^params\.decals\.0\.at$/, /Keep at\[1\]/);
  refused(w, set({ slot: 'gable-s', w: 0.9, h: 0.9, at: [0, 1.5] }), /^params\.decals\.0\.at$/, /Keep at\[1\]/);
  // Whole facades are fair game: the shop front (8 m wall) edge to edge, and a gable sign up to the roof top.
  for (const decal of [{ slot: 'facade-f0-s-1', w: 8.2, h: 0.5, at: [0, 1.1] }, { slot: 'facade-f1-s-1', w: 1, h: 0.5, at: [5.5, 0] }, { slot: 'gable-s', w: 1, h: 0.4, at: [0, 0] }, { slot: 'wall-w-1', w: 8.8, h: 0.4, at: [-0.57, 0] }])
    assert.equal(act(w, set(decal)).result.accepted, true, JSON.stringify(decal));
  // A turned shop measures along its own front.
  const turned = world();
  assert.equal(act(turned, [{ op: 'place', def: 'core/shop@1', name: 'bakery', at: [0, 0], params: { front: 'e', decals: [{ slot: 'opening-front-door', w: 2.2, h: 0.3, at: [0, 2.75], text: 'BAKERY' }] } }]).result.accepted, true);
  refused(turned, set({ slot: 'opening-front-door', w: 2.2, h: 0.3, at: [4, 2.75] }), /^params\.decals\.0\.at$/, /Keep at\[0\]/);
  // A round tower's walls are flat chords: a decal fits one chord, never wraps the curve.
  const tower = world();
  assert.equal(act(tower, [{ op: 'place', def: 'core/lighthouse@1', name: 'light', at: [0, 0], params: { decals: [{ slot: 'facade-f0-s-1', w: 1.2, h: 0.4, text: 'PIER' }] } }]).result.accepted, true);
  const wrap = refused(tower, [{ op: 'set', id: 'light', params: { decals: [{ slot: 'facade-f0-s-1', w: 3, h: 0.4, text: 'HARBOUR LIGHT' }] } }], /^params\.decals\.0\.w$/, /Shrink w to at most 1\.59/);
  assert.match(wrap.detail ?? '', /wider than the wall it sits on/);
});

test('decal edits undo; a building definition cannot smuggle an external decal default into instances', () => {
  const w = world();
  assert.equal(act(w, [{ op: 'place', def: 'core/shop@1', name: 'bakery', at: [0, 0], params: { decals: fixtures.shopDecals } }]).result.accepted, true);
  const r = applyBatch(w, { ops: [{ op: 'set', id: 'bakery', params: { decals: [] } }] }, 'god', tick++);
  assert.equal(r.result.accepted, true); assert.deepEqual(w.get('bakery')!.params!.decals, []);
  assert.equal(applyBatch(w, { ops: r.inverse! }, 'god', tick++, { trusted: true }).result.accepted, true);
  assert.deepEqual(w.get('bakery')!.params!.decals, fixtures.shopDecals);
  refused(world(), [{ op: 'define', def: { schema: 'def/1', name: 'tracking-shop', extends: 'core/shop@1', make: { kind: 'none' }, size: { box: [8, 9, 9] }, params: { decals: { type: 'json', default: [{ slot: 'facade-f0-s-1', w: 1, h: 1, image: 'https://example.invalid/t.png' }] } } } }], /^params\.decals\.0\.image$/);
  refused(world(), [{ op: 'define', def: { schema: 'def/1', name: 'lost-shop', extends: 'core/shop@1', make: { kind: 'none' }, size: { box: [8, 9, 9] }, params: { decals: { type: 'json', default: [{ slot: 'nowhere', w: 1, h: 1, text: 'X' }] } } } }], /^params\.decals\.0\.slot$/, /wall slots/);
});
