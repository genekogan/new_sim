import {test} from 'node:test';
import assert from 'node:assert/strict';
import {weatherKindAt,targetFor,easeWeather,copyWeather,parseWeatherOverride,clockMs,regimeOf,WEATHER_KINDS,type WeatherState} from '../src/atmosphere/weather.ts';
import {windModeOf} from '../src/atmosphere/wind.ts';

const DAY=86_400_000,HOUR=3_600_000,T0=Date.UTC(2026,9,7);

test('same world clock always gives the same weather', () => {
  for (let h = 0; h < 24 * 30; h += 1.25) {
    const ms = T0 + h * HOUR;
    assert.equal(weatherKindAt(ms), weatherKindAt(ms));
    assert.equal(weatherKindAt(ms), weatherKindAt(ms + 1));
  }
  assert.equal(clockMs('2026-10-07T13:20:00.000'), clockMs('2026-10-07T13:20:00'));
  assert.equal(clockMs('2026-10-07T13:20:00'), Date.UTC(2026, 9, 7, 13, 20));
  assert.equal(clockMs('nonsense'), null);
});

test('weather varies across days and every kind occurs, clear most often', () => {
  const counts: Record<string, number> = {};
  for (let d = 0; d < 400; d++) for (let s = 0; s < 8; s++) {
    const k = weatherKindAt(T0 + d * DAY + (s * 3 + 1) * HOUR); counts[k] = (counts[k] ?? 0) + 1;
  }
  for (const k of WEATHER_KINDS) assert.ok((counts[k] ?? 0) > 40, `${k} occurs (${counts[k]})`);
  assert.ok(counts.clear > counts.rain && counts.clear > counts.fog, JSON.stringify(counts));
  const regimes = new Set(Array.from({length: 60}, (_, d) => regimeOf(20000 + d)));
  assert.ok(regimes.size >= 3);
});

test('rain is rare (~5% of the time), storms rarer still (Gene 2026-10-07)', () => {
  const counts: Record<string, number> = {};let n = 0;
  for (let i = 0; i < 365 * 48; i++) { const k = weatherKindAt(T0 + i * 30 * 60_000); counts[k] = (counts[k] ?? 0) + 1; n++; }
  const wet = ((counts.rain ?? 0) + (counts.storm ?? 0)) / n, storm = (counts.storm ?? 0) / n;
  assert.ok(wet > .03 && wet < .07, `rain+storm ${wet}`);
  assert.ok(storm > .002 && storm < .02 && storm < wet / 2, `storm ${storm}`);
});

test('rendered weather eases gradually (minutes) and never jumps', () => {
  const state: WeatherState = copyWeather({cloud:0,rain:0,wind:0,fog:0,mist:0,wet:0}, targetFor('clear', 12));
  const rain = targetFor('rain', 12);
  let worstStep = 0, t = 0, reached = -1;
  while (t < 900) {
    const before = {...state}; easeWeather(state, rain, 1 / 30); t += 1 / 30;
    for (const k of Object.keys(state) as (keyof WeatherState)[]) worstStep = Math.max(worstStep, Math.abs(state[k] - before[k]));
    if (reached < 0 && state.rain > .9) reached = t;
  }
  assert.ok(worstStep < .002, `per-frame step ${worstStep}`);
  assert.ok(reached > 60 && reached < 180, `rain fully in after ${reached}s`);
  // A huge dt (tab in background) is clamped and still finite.
  easeWeather(state, targetFor('clear', 12), 1e6);
  assert.ok(Object.values(state).every(v => Number.isFinite(v) && v >= 0 && v <= 1));
  // Ground dries much more slowly than rain stops.
  const wet = copyWeather({cloud:0,rain:0,wind:0,fog:0,mist:0,wet:0}, rain);
  for (let i = 0; i < 60; i++) easeWeather(wet, targetFor('clear', 12), 1);
  assert.ok(wet.rain < .25 && wet.wet > .75, JSON.stringify(wet));
});

test('morning mist only around dawn; targets stay in range', () => {
  assert.ok(targetFor('fog', 6.5).mist > .7 && targetFor('clear', 6.5).mist > .3);
  assert.equal(targetFor('clear', 14).mist, 0);
  assert.equal(targetFor('clear', null).mist, 0);
  for (const k of WEATHER_KINDS) for (const h of [0, 6, 12, 18]) assert.ok(Object.values(targetFor(k, h)).every(v => v >= 0 && v <= 1));
});

test('review override and reduced-motion-safe parsing', () => {
  assert.deepEqual(parseWeatherOverride('?weather=rain'), {kind: 'rain'});
  assert.deepEqual(parseWeatherOverride('?x=1&weather=windy'), {kind: 'wind'});
  assert.deepEqual(parseWeatherOverride('?weather=cycle'), {kind: 'cycle'});
  assert.deepEqual(parseWeatherOverride('?weather=storm'), {kind: 'storm'});
  assert.deepEqual(parseWeatherOverride('?weather=afterrain'), {kind: 'clear', from: 'rain'});
  assert.equal(parseWeatherOverride('?weather=hail'), null);
  assert.equal(parseWeatherOverride(''), null);
});

test('wind only targets plants and hanging cloth by name', () => {
  assert.equal(windModeOf('decorative vegetation preview > vegetation:ball:leaf'), 'crown');
  assert.equal(windModeOf('decorative vegetation preview > vegetation:stem:bark'), 'trunk');
  assert.equal(windModeOf('decorative vegetation preview > vegetation:blade:grass'), 'grass');
  assert.equal(windModeOf('Original fixed square meadow > six upright grass blades'), 'grass');
  assert.equal(windModeOf('Eden street details (scenery only) > bunting-flags'), 'bunting');
  assert.equal(windModeOf('street props > lamp post banners'), 'belly');
  assert.equal(windModeOf('yard > laundry-sheets'), 'hang');
  assert.equal(windModeOf('green > village flag'), 'flag');
  for (const p of ['plaza > flagstone paving', 'yard > laundry-line-posts', 'green > flag pole', 'shed > corrugated sheet roof'])
    assert.notEqual(['hang', 'belly', 'flag'].includes(String(windModeOf(p))), true, p);
  assert.equal(windModeOf('Regions trees and far forests (scenery only) > Regions tree trunk bark'), 'trunk');
  assert.equal(windModeOf('Canal quarter (scenery only) > Regions round canopy foliage'), 'crown');
  for (const p of ['yurt > yurt-crown', 'Eden street props (scenery only) > street-props:leaves (fallen leaves and litter)', 'Eden street props (scenery only) > street-props:static foliage:clear', 'commons:bench > bench:bark', 'commons:pavilion > pavilion:bark', 'eden-pergola-1 > bark', 'market > market canopy'])
    assert.equal(windModeOf(p), null, p);
  for (const p of ['Connected Eden > Cultivated garden plot 37:44', 'eden-greenhouse-1 > leaf-olive', 'Flowering garden trellis edges / thin frame and vine stems', 'windmill > windmill-tower', 'Country and river bank stone clusters / low faceted stones', 'house > roof'])
    assert.equal(windModeOf(p), null, p);
});

import * as THREE from 'three';
import {ScaledNumber, TintedColor} from '../src/atmosphere/lighting.ts';
import {createWorldAtmosphere} from '../src/WorldAtmosphere.ts';
import {WIND} from '../src/atmosphere/wind.ts';
import {ATMOS, MIST} from '../src/atmosphere/chunks.ts';

test('scaling another owner\'s light never compounds and restores exactly', () => {
  const light = {intensity: 2};
  const s = new ScaledNumber(() => light.intensity, v => { light.intensity = v; });
  s.apply(.5); s.apply(.5); s.apply(.5);
  assert.equal(light.intensity, 1);
  light.intensity = 3; s.apply(.5);              // owner wrote a new base
  assert.equal(light.intensity, 1.5);
  s.restore(); assert.equal(light.intensity, 3);
  s.apply(.5); light.intensity = 7; s.restore();  // owner wrote after us: theirs wins
  assert.equal(light.intensity, 7);
  const c = new THREE.Color(.2, .4, .6), t = new TintedColor(() => c);
  t.sample(); t.write(new THREE.Color(.1, .1, .1)); assert.equal(t.sample()!.r, .2);
  t.restore(); assert.deepEqual(c.toArray(), [.2, .4, .6]);
});

test('atmosphere acts only in Eden and restores everything when it leaves', () => {
  const scene = new THREE.Scene();
  const atmos = createWorldAtmosphere(scene);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.6), sun = new THREE.DirectionalLight(0xffffff, 2.6);
  sun.castShadow = true; scene.add(hemi, sun, sun.target); scene.background = new THREE.Color(.5, .6, .7);
  const cam = new THREE.PerspectiveCamera(50, 1, .1, 600); cam.position.set(0, 3, 10); cam.updateMatrixWorld();
  const frame = (seconds: number, eden: boolean, reducedMotion = false) => atmos.update({seconds, dt: 1 / 30, daylight: 1, camera: cam, eden, reducedMotion, clock: '2026-10-07T13:00:00'});
  frame(0, false);
  assert.equal(scene.children.some(o => o.name.startsWith('atmosphere')), false, 'nothing added outside Eden');
  for (let i = 1; i < 40; i++) frame(i / 30, true);
  assert.ok(atmos.inspect().active);
  assert.ok(WIND.value.y > 0 && (scene.fog as THREE.FogExp2).density > 0);
  frame(2, false);
  assert.equal(sun.intensity, 2.6); assert.equal(hemi.intensity, 1.6);
  assert.deepEqual((scene.background as THREE.Color).toArray(), [.5, .6, .7]);
  assert.equal((scene.fog as THREE.FogExp2).density, 0); assert.equal(WIND.value.y, 0);
  assert.equal(ATMOS.value.x, 0); assert.equal(MIST.value.x, 0); assert.equal(MIST.value.w, 0);
  assert.equal(scene.children.find(o => o.name.startsWith('atmosphere'))?.visible, false);
  // Reduced motion: no sway, no particles.
  frame(3, true, true);
  assert.equal(WIND.value.y, 0);
  atmos.dispose(); assert.equal(scene.fog, null);
});

import {insideBuilding} from '../src/atmosphere/indoors.ts';
test('camera-local rain stays out of known interiors but not off roof decks or streets', () => {
  assert.equal(insideBuilding(34, 1.6, 15), true);    // house 1 ground floor
  assert.equal(insideBuilding(34, 8, 30), false);     // above house 3 (roof deck / sky)
  assert.equal(insideBuilding(45, 1.6, 5), false);    // residential street
  assert.equal(insideBuilding(5, 1.6, 5), false);     // commons
  assert.equal(insideBuilding(101.5, 1.6, 25), true);  // corner café (new buildings)
  assert.equal(insideBuilding(86.5, 1.6, 82), true);   // chapel
  assert.equal(insideBuilding(86.5, 6, 82), false);    // above the chapel roof line
});

test('soak: three simulated days of world clock stay finite, deterministic and restorable', () => {
  const mk = () => {
    const scene = new THREE.Scene(), atmos = createWorldAtmosphere(scene);
    const sun = new THREE.DirectionalLight(0xffffff, 2.6); sun.castShadow = true; scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.6), sun, sun.target);
    scene.background = new THREE.Color(.5, .6, .7);
    const cam = new THREE.PerspectiveCamera(50, 1, .1, 600); cam.position.set(0, 3, 10); cam.updateMatrixWorld();
    return {scene, atmos, sun, cam};
  };
  const a = mk(), b = mk(), kinds = new Set<string>();
  const t0 = Date.UTC(2026, 9, 7);
  for (let i = 0; i < 3 * 24 * 60; i += 3) {             // every 3 world minutes, 1 s of viewing apart
    const clock = new Date(t0 + i * 60_000).toISOString().slice(0, 19);
    for (const w of [a, b]) w.atmos.update({seconds: i, dt: 1, daylight: .8, camera: w.cam, eden: true, reducedMotion: false, clock});
    const ia = a.atmos.inspect(), ib = b.atmos.inspect();
    assert.equal(ia.kind, ib.kind); kinds.add(String(ia.kind));
    for (const v of Object.values(ia.state)) assert.ok(Number.isFinite(v) && v >= 0 && v <= 1);
    assert.ok(Number.isFinite(a.sun.intensity) && a.sun.intensity > 0 && a.sun.intensity <= 2.6);
  }
  assert.ok(kinds.size >= 2, [...kinds].join());
  a.atmos.update({seconds: 99999, dt: 1, daylight: .8, camera: a.cam, eden: false, reducedMotion: false});
  assert.equal(a.sun.intensity, 2.6); assert.deepEqual((a.scene.background as THREE.Color).toArray(), [.5, .6, .7]);
  a.atmos.dispose(); b.atmos.dispose();
});
