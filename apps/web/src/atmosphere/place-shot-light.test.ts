// Gene #13 (Explore shots): a place picture is taken in one fixed late-morning, clear, dry, still light whatever the
// live world's clock and weather, and the live atmosphere comes back exactly afterwards. Offline: no browser or assets.
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
const browserGlobal = globalThis as unknown as { location?: URL };
browserGlobal.location ??= new URL('http://offline.invalid/w/fixture');
const { shotClockAt } = await import('../world-env.ts');
const { Daylight } = await import('../WorldGeometry.ts');
const { createWorldAtmosphere } = await import('../WorldAtmosphere.ts');
const { PLACE_SHOT_MINUTES } = await import('../WorldPlacePreviews.ts');
const { MIST, SHEEN, ATMOS } = await import('./chunks.ts');
const { GRADE_A, GRADE_B } = await import('./grade.ts');
hooks.deregister();

const STORM = { kind: 'storm', clouds: 1, rain: 1, wind: .9, fog: .5, intensity: 1 };
function world(clock: string, weather: typeof STORM | null) {
  const scene = new THREE.Scene(), light = new Daylight(scene), atmosphere = createWorldAtmosphere(scene), camera = new THREE.PerspectiveCamera();
  let seconds = 0;
  light.update(clock);
  for (let i = 0; i < 400; i++) { seconds += .5; atmosphere.update({ seconds, dt: .5, clock, daylight: light.daylight, camera, eden: true, profile: 'world', reducedMotion: false, weather }); }
  const sky = scene.getObjectByName('atmosphere: sky and clouds') as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  const look = () => {
    const u = sky.material.uniforms, i = atmosphere.inspect();
    return { kind: i.kind, state: { ...i.state }, lightning: i.lightning, wet: MIST.value.w, sheen: SHEEN.value.w, mist: MIST.value.x, cloudShadow: ATMOS.value.x,
      cloud: (u.uCloud.value as THREE.Vector4).x, flash: (u.uFlash.value as THREE.Vector4).x, zenith: (u.uZenith.value as THREE.Color).getHex(),
      background: (scene.background as THREE.Color).getHex(), fog: scene.fog ? (scene.fog as THREE.Fog).color.getHex() : null,
      sun: +light.sun.intensity.toFixed(6), hemi: +light.hemi.intensity.toFixed(6), daylight: light.daylight, grade: { ...GRADE_A }, gradeB: { ...GRADE_B } };
  };
  const shoot = () => { const at = shotClockAt(light.clock, PLACE_SHOT_MINUTES)!, undoLight = light.photo(at), undoAtmosphere = atmosphere.photo(at, light.daylight), shot = look(); undoLight(); undoAtmosphere(); return { at, shot }; };
  return { look, shoot };
}

test('the shot light is the same for a stormy night and a clear noon: clear, dry, still, late morning', () => {
  const night = world('2026-10-15T23:30:00', STORM), live = night.look();  // the uniforms are shared: one world at a time
  assert.ok(live.state.rain > .9 && live.state.cloud > .9 && live.wet > .5, 'the live world really is in a storm');
  assert.ok((live.daylight ?? 1) < .1, 'and at night');
  const a = night.shoot(), b = world('2026-10-15T12:00:00', null).shoot();
  assert.equal(a.at, '2026-10-15T10:30:00');
  assert.equal(a.shot.kind, 'clear');
  assert.equal(a.shot.state.rain, 0); assert.equal(a.shot.state.wet, 0); assert.equal(a.shot.state.fog, 0); assert.equal(a.shot.state.mist, 0);
  assert.equal(a.shot.wet, 0); assert.equal(a.shot.sheen, 0); assert.equal(a.shot.flash, 0); assert.equal(a.shot.lightning, 0);
  assert.ok((a.shot.daylight ?? 0) > .8, 'daylight in the shot');
  assert.deepEqual(a.shot, b.shot, 'independent of the live world weather and time');
});

test('after the shot the live storm comes back exactly (no eased drift, no flash left)', () => {
  const night = world('2026-10-15T23:30:00', STORM), before = night.look();
  night.shoot();
  assert.deepEqual(night.look(), before);
});
