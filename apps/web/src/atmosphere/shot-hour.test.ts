// Offline presentation checks; no browser, service or asset requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import ts from 'typescript';
import * as THREE from 'three';
import { installNightLighting, nightLightStrength, windowsLitAt } from '../WorldNightLights.ts';

// These two existing modules use TS parameter properties. Compile the actual modules with
// the already-installed TypeScript compiler so the focused test also runs in Node's strip-only mode.
const transform = new Set(['../world-env.ts', '../WorldGeometry.ts'].map(path => new URL(path, import.meta.url).href));
const hooks = registerHooks({ load(url, context, next) {
  if (!transform.has(url)) return next(url, context);
  return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText };
} });
const browserGlobal = globalThis as unknown as { location?: URL };
browserGlobal.location ??= new URL('http://offline.invalid/w/fixture');
const { parseShotHour, shotClockAt, GodWorldLiving, whenShotClock } = await import('../world-env.ts');
const { Daylight } = await import('../WorldGeometry.ts');
const { createWorldAtmosphere } = await import('../WorldAtmosphere.ts');
const { skyBodies } = await import('./astro.ts');
hooks.deregister();

test('shot hours require shot mode and strict HH:MM; invalid/missing values retain the original clock', () => {
  assert.equal(parseShotHour('?shot=1&hour=21:35&weather=rain'), 1295);
  assert.equal(parseShotHour('?shot&hour=00:00'), 0); assert.equal(parseShotHour('?shot&hour=23:59'), 1439);
  for (const q of ['?hour=21:00', '?shot', '?shot&hour=24:00', '?shot&hour=21:60', '?shot&hour=9:00', '?shot&hour=21', '?shot&hour=12:30:00', '?shot&hour=NaN']) assert.equal(parseShotHour(q), null);
  const iso = '2026-10-15T12:34:56.789Z';
  assert.equal(shotClockAt(iso, 1295), '2026-10-15T21:35:00');
  assert.equal(shotClockAt(iso, 0), '2026-10-15T00:00:00');
  assert.equal(shotClockAt(iso, null), iso); assert.equal(shotClockAt(null, 1295), null);
  assert.equal(shotClockAt(iso, 1440), iso); assert.equal(shotClockAt(iso, NaN), iso);
});

test('the same world at shot noon/night changes real sun, ambient, sky bodies, pools, halos and window schedules without changing world state', () => {
  const global = globalThis as unknown as { location?: URL };
  const previous = global.location; global.location = new URL('http://offline.invalid/w/fixture?shot=1&hour=21:00&weather=clear');
  installNightLighting();
  const scene = new THREE.Scene(), light = new Daylight(scene), atmosphere = createWorldAtmosphere(scene), camera = new THREE.PerspectiveCamera();
  const model = { state: { datetime: '2026-10-15T12:00:00', weather: { kind: 'clear' }, sky: { palette: 'day' } },
    entities: new Map([['lamp', { id: 'lamp', def: 'lamp@1' }]]), resolvedDef: () => ({ components: { light: { color: '#ffe9c4', range: 8 } } }), worldPose: () => ({ x: 0, y: 3, z: 0 }) };
  const layer = { active: true, group: new THREE.Group(), groundAt: () => 0, model };
  const living = new GodWorldLiving(layer); scene.add(living.group);
  const originalState = structuredClone(model.state);
  light.setNightLighting(true);
  try {
    const sample = (hour: number, seconds: number) => {
      const clock = shotClockAt(model.state.datetime, hour)!;
      light.update(clock); living.update(seconds * 1000, light.daylight);
      atmosphere.update({ seconds, dt: 1 / 30, clock, daylight: light.daylight, camera, eden: true, profile: 'world', reducedMotion: true, ...living.atmosphere() });
      const sky = scene.getObjectByName('atmosphere: sky and clouds') as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
      const sun = sky.material.uniforms.uSun.value as THREE.Vector4;
      const bodies = skyBodies(clock)!;
      const halos = scene.getObjectByName('atmosphere: lamp glow') as THREE.InstancedMesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
      assert.ok(new THREE.Vector3(sun.x, sun.y, sun.z).distanceTo(bodies.sun) < 1e-8);
      assert.equal(THREE.ShaderLib.standard.uniforms.uEdenWindows.value.x, windowsLitAt(hour / 60));
      return { daylight: light.daylight!, sun: light.sun.intensity, ambient: light.hemi.intensity, direction: light.sun.position.clone(), sky: sky.material.uniforms.uZenith.value.clone() as THREE.Color,
        pools: nightLightStrength(), bodiesY: bodies.sun.y, windows: THREE.ShaderLib.standard.uniforms.uEdenWindows.value.x, halos: halos.visible, haloStrength: halos.material.uniforms.uHalo.value.x };
    };
    const noon = sample(720, 0), night = sample(parseShotHour(global.location.search)!, 2);
    assert.ok(noon.daylight > 0.95 && night.daylight < 0.01);
    assert.ok(noon.sun > night.sun && noon.ambient > night.ambient); assert.ok(noon.direction.distanceTo(night.direction) > 1);
    assert.ok(noon.sky.r + noon.sky.g + noon.sky.b > night.sky.r + night.sky.g + night.sky.b);
    assert.ok(noon.bodiesY > 0 && night.bodiesY < 0); assert.ok(noon.pools < 0.01 && night.pools > 0.99);
    assert.equal(noon.halos, false); assert.equal(night.halos, true); assert.ok(night.haloStrength > noon.haloStrength);
    assert.ok(night.windows > noon.windows);
    assert.deepEqual(model.state, originalState); assert.equal(model.state.datetime, '2026-10-15T12:00:00');
    assert.equal(atmosphere.inspect().kind, 'clear');
    const dawn = sample(5 * 60 + 30, 4); assert.ok(dawn.daylight < noon.daylight);
    assert.deepEqual(model.state, originalState);
  } finally { atmosphere.dispose(); living.dispose(); light.dispose(); global.location = previous; }
});

test('LiveWorld sends the shot clock to lighting/atmosphere and the real clock to world-time labels', () => {
  const source = readFileSync(new URL('../LiveWorld.tsx', import.meta.url), 'utf8');
  assert.match(source, /light\.update\(shotClockAt\(/);
  // 3.2: a visitor's time-of-day preview (visitor-hour.ts, view only) stands in for the shot hour when no shot hour is set
  // P7d: before its first take, an adopted early renderer's clock (the page's HTML clock, early-render.ts) stands in
  assert.match(source, /clock:shotClockAt\(shown\.current\?\.datetime\?\?adopted\?\.clock\?\?null,shotHour\?\?visitorPreviewHour\(\)\)/);
  assert.match(source, /sites\.setWorldClock\(datetime,dayTicks\?86400\/\(dayTicks\*dt\):1\)/);
  assert.match(source, /shown\.current = \{ tick: depictedTick, datetime, take, entities: sampled\.entities \}/);
});

test('r2.1 shot readiness waits for the first world clock, gives up at its bound, and stops on abort', async () => {
  let frames = 0, clock = false; const frame = (fn: () => void) => { frames++; if (frames === 3) clock = true; setImmediate(fn); };
  assert.equal(await whenShotClock(() => clock, { timeoutMs: 5000, frame }), true); assert.equal(frames, 3, 'ready only once the lights have a clock');
  frames = 0; assert.equal(await whenShotClock(() => true, { timeoutMs: 5000, frame }), true); assert.equal(frames, 0, 'no wait when the clock is already there');
  const t0 = performance.now(); assert.equal(await whenShotClock(() => false, { timeoutMs: 30, frame: fn => setTimeout(fn, 5) }), false);
  assert.ok(performance.now() - t0 < 1000, 'a clockless world still becomes ready');
  const abort = new AbortController(); abort.abort(); assert.equal(await whenShotClock(() => false, { timeoutMs: 5000, signal: abort.signal, frame }), false);
});

test('a world calendar dates the sky (Eden 2026: early June) and leaves the hour, year and bad values alone', async () => {
  const { calendarClock } = await import('../world-env.ts');
  const at = '2026-10-03T19:00:00.000Z', june = { time: { calendar: '06-05' } };
  assert.equal(calendarClock(at, june), '2026-06-05T19:00:00.000Z');
  assert.equal(calendarClock(at, null), at);
  assert.equal(calendarClock(at, { time: { calendar: '13-01' } }), at);
  assert.equal(calendarClock(null, june), null);
  const { solarPosition } = await import('../../../../mars/viewer/engine/env/sun.ts');
  assert.ok(solarPosition(calendarClock('2026-10-03T19:00:00', june)!).elevationDeg > solarPosition('2026-10-03T19:00:00').elevationDeg + 8, 'the June sun stands higher at 19:00');
});


test('switching a published light updates halos before the next expensive atmosphere scan', () => {
 const scene=new THREE.Scene(), camera=new THREE.PerspectiveCamera(), source=new THREE.Group();
 source.userData.edenLightSources=[[0,0,0,'lamp',1],[3,0,0,'lamp',1]];scene.add(source);
 const atmosphere=createWorldAtmosphere(scene);
 const frame=(seconds:number)=>atmosphere.update({seconds,dt:1/30,clock:'2026-10-15T21:00:00',daylight:0,camera,eden:true,profile:'world',reducedMotion:true});
 try {
  frame(0);const halos=scene.getObjectByName('atmosphere: lamp glow') as THREE.InstancedMesh;
  assert.equal(halos.count,2);const scans=atmosphere.inspect().scans;
  source.userData.edenLightSources=[[0,0,0,'lamp',1]];frame(.01);assert.equal(halos.count,1,'off removes only that halo on the next frame');
  source.userData.edenLightSources=[];frame(.02);assert.equal(halos.count,0,'all lights off clears halos');
  source.userData.edenLightSources=[[3,0,0,'lamp',1]];frame(.03);assert.equal(halos.count,1,'on returns without a structural rescan');
  frame(.04);assert.equal(halos.count,1,'unchanged publications stay stable');assert.equal(atmosphere.inspect().scans,scans,'light changes do not trigger expensive scene scans');
 } finally {atmosphere.dispose();}
});
