// Gene 2026-10-24: rainbows showed at night and never went away. A rainbow (the sky bow and any god-built rainbow
// thing) is only for a short daylight window after a real shower, fades out completely and comes back only with another
// shower. Offline: the real Daylight and atmosphere, no browser or assets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import ts from 'typescript';
import * as THREE from 'three';

const transform = new Set(['../world-env.ts', '../WorldGeometry.ts'].map(path => new URL(path, import.meta.url).href));
const hooks = registerHooks({ load(url, context, next) {
  if (!transform.has(url)) return next(url, context);
  return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText };
} });
(globalThis as unknown as { location?: URL }).location ??= new URL('http://offline.invalid/w/fixture');
const { Daylight } = await import('../WorldGeometry.ts');
const { createWorldAtmosphere } = await import('../WorldAtmosphere.ts');
const { holdRainbow, isRainbowDef } = await import('./rainbow-things.ts');
hooks.deregister();

const STORM = { kind: 'storm', clouds: 1, rain: 1, wind: .9, fog: .5, intensity: 1 };
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19);
/** A world with a god-built rainbow thing in it; `step` advances world and viewing time together. */
function world(start: string, reducedMotion = false) {
  const scene = new THREE.Scene(), light = new Daylight(scene), atm = createWorldAtmosphere(scene), camera = new THREE.PerspectiveCamera();
  const thing = new THREE.Group(), band = new THREE.Mesh(new THREE.TorusGeometry(100, 1, 4, 16, Math.PI), new THREE.MeshStandardMaterial({ color: 'red' }));
  thing.add(band); holdRainbow(thing); scene.add(thing);
  let t = Date.parse(start + 'Z'), seconds = 0;
  const w = {
    atm, band, light,
    jump(s: number) { t += s * 1000; },
    /** Run `s` seconds; returns the largest sky bow and rainbow-thing strength seen, and whether the thing was drawn. */
    step(s: number, weather: typeof STORM | null, hold = false) {
      let bow = 0, shown = 0, drawn = false;
      for (let i = 0; i < s * 2; i++) {
        seconds += .5; if (!hold) t += 500; const clock = iso(t); light.update(clock);
        atm.update({ seconds, dt: .5, clock, daylight: light.daylight, camera, eden: true, profile: 'world', reducedMotion, weather });
        const ins = atm.inspect(); bow = Math.max(bow, ins.bow); shown = Math.max(shown, ins.rainbowThing); drawn ||= band.visible;
      }
      return { bow, shown, drawn };
    },
  };
  return w;
}

test('a rainbow thing is a def named or tagged rainbow', () => {
  for (const name of ['rainbow', 'double-rainbow', 'sky-rainbows']) assert.ok(isRainbowDef({ name, tags: [] }), name);
  assert.ok(isRainbowDef({ name: 'arc', tags: ['sky', 'rainbow'] }));
  for (const name of ['rainbow-trout', 'rainbowfish', 'lamp']) assert.equal(isRainbowDef({ name, tags: ['sky', 'decor'] }), false, name);
});

test('no rainbow in clear weather without a shower before it', () => {
  const w = world('2026-10-24T16:30:00');
  assert.deepEqual(w.step(600, null), { bow: 0, shown: 0, drawn: false });
  assert.equal(w.atm.inspect().rainbowThings, 1);
});

test('no rainbow after a shower that ends at night', () => {
  for (const start of ['2026-10-24T22:00:00', '2026-10-24T02:00:00', '2026-10-24T18:40:00']) {
    const w = world(start);
    w.step(120, STORM);
    assert.deepEqual(w.step(900, null), { bow: 0, shown: 0, drawn: false }, start);
  }
});

for (const reducedMotion of [false, true]) test(`after a daylight shower: a short rainbow, then gone for good until the next shower (reduced motion ${reducedMotion})`, () => {
  const w = world('2026-10-24T17:00:00', reducedMotion);
  assert.equal(w.step(120, STORM).shown, 0, 'none while it pours');
  const after = w.step(60, null);
  assert.ok(after.bow > .1 && after.shown > .1 && after.drawn, `post-rain bow ${after.bow} thing ${after.shown}`);
  w.step(180, null);
  assert.equal(w.atm.inspect().rainbowThing, 0, 'faded out within 4 minutes of the shower');
  assert.equal(w.band.visible, false);
  assert.deepEqual(w.step(1200, null), { bow: 0, shown: 0, drawn: false }, 'does not come back on its own');
  w.step(120, STORM);
  assert.ok(w.step(60, null).shown > .1, 'the next shower brings it back');
});

test('a clock jump or a held clock does not keep a rainbow up', () => {
  const jump = world('2026-10-24T16:00:00');
  jump.step(120, STORM);
  assert.ok(jump.step(40, null).shown > .1);
  jump.jump(3600);
  assert.equal(jump.step(2, null).shown, 0, 'an hour later in world time it is gone at once');
  jump.jump(-3600);
  assert.equal(jump.step(2, null).shown, 0, 'rewinding the world clock cannot resurrect an expired rainbow');
  const held = world('2026-10-24T16:00:00');
  held.step(120, STORM, true);
  assert.ok(held.step(40, null, true).shown > .1);
  held.step(240, null, true);
  assert.deepEqual(held.step(600, null, true), { bow: 0, shown: 0, drawn: false }, 'a held clock still ages it in viewing time');
});

test('a place shot taken while a shower dries off does not cancel or restart the rainbow', () => {
  const w = world('2026-10-24T17:00:00');
  w.step(120, STORM);
  // the rain eases out over a few seconds after a god clears it; shoot while it is still falling lightly
  for (let i = 0; i < 20 && w.atm.inspect().state.rain > .3; i++) w.step(.5, null);
  const rain = w.atm.inspect().state.rain;
  assert.ok(rain < .35 && rain > .08, `light rain ${rain}`);
  w.atm.photo('2026-10-24T10:30:00', 1)();
  assert.ok(w.step(60, null).shown > .1, 'the post-rain rainbow still comes');
});
