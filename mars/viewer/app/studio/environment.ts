import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { ThreeResources } from '../../lib/three-resources';
import { clearWeather, type Weather } from '../../simulation/shared';
import {
  BOMBAY_BEACH,
  DEFAULT_SCENE_DATE,
  solarPosition,
} from '../../engine/env/sun';
import { daylightFactors } from '../../engine/env/daylight';

/** Weather plus the optional `wet` surface-wetness field the new engine's
 * `Environment.weather` shape carries (world/types.ts) — the live MCP/DO
 * `Weather` type (simulation/shared.ts) does not yet expose it, so it is
 * treated as an additive optional passthrough here, computed locally from
 * rain when absent (see the wetness estimator in `update()`). */
type WeatherWithWetness = Weather & { wet?: number };

/** Local ISO datetime for solarPosition(): a calendar date (default
 * DEFAULT_SCENE_DATE, spec §19 "a plausible season date") combined with the
 * studio's hour-of-day, which stays independent of that date and of
 * simulation elapsed time (spec §19). */
function localDateTimeAt(date: string, hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const hh = Math.floor(h),
    mm = Math.floor((h - hh) * 60),
    ss = Math.round((((h - hh) * 60 - mm) * 60));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date}T${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

/** Presentation environment; soil is a licensed material, not surveyed terrain. */
export function createEnvironment(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  /** The year scene's site bearing (engine/env/sun.ts YEAR_NORTH_AZIMUTH_OFFSET; W51); omitted = the global. */
  opts: { northAzimuthOffset?: number } = {},
) {
  const sky = new Sky();
  sky.scale.setScalar(1200);
  const uniforms = sky.material.uniforms;
  uniforms.turbidity.value = 1.6;
  uniforms.rayleigh.value = 2.4;
  uniforms.mieCoefficient.value = 0.002;
  uniforms.mieDirectionalG.value = 0.8;
  uniforms.cloudCoverage.value = 0.48;
  uniforms.cloudDensity.value = 0.55;
  uniforms.cloudScale.value = 0.001;
  // The atmosphere needs its own exposure: scene lighting otherwise washes it white.
  uniforms.dayBlend = { value: 1 };
  sky.material.fragmentShader =
    'uniform float dayBlend;\n' +
    sky.material.fragmentShader.replace(
      'vec4( texColor, 1.0 )',
      'vec4( mix(vec3(0.004,0.009,0.025),texColor * 0.22,dayBlend), 1.0 )',
    );
  // Initial sun direction; update() keeps the disc and shadows in sync.
  const direction = new THREE.Vector3(-0.43, 0.819, -0.38).normalize();
  uniforms.showSunDisc.value = 1;
  uniforms.sunPosition.value.copy(direction).multiplyScalar(450000);
  scene.add(sky);
  scene.fog = new THREE.Fog(0xc6d7dc, 180, 650);
  const hemi = new THREE.HemisphereLight(0xc8e2ff, 0xa69b83, 1.7);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.8);
  sun.position.copy(direction).multiplyScalar(100);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -65,
    right: 65,
    top: 65,
    bottom: -65,
    near: 1,
    far: 230,
  });
  sun.shadow.bias = -0.00015;
  sun.shadow.normalBias = 0.07;
  sun.shadow.autoUpdate = false;
  scene.add(sun);
  renderer.shadowMap.enabled = true;
  // Soft (blurred) PCF so cloud cover can widen shadow.radius below; the plain
  // PCFShadowMap ignores that property entirely.
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const moon = new THREE.DirectionalLight(0x9bb7ff, 0.15);
  moon.position.set(40, 75, 20);
  scene.add(moon);
  const starGeometry = new THREE.BufferGeometry(),
    starPositions = [];
  let starSeed = 742;
  const starRandom = () => {
    starSeed = (Math.imul(starSeed, 1664525) + 1013904223) >>> 0;
    return starSeed / 4294967296;
  };
  for (let i = 0; i < 850; i++) {
    const y = 0.04 + starRandom() * 0.96,
      a = starRandom() * Math.PI * 2,
      r = Math.sqrt(1 - y * y);
    starPositions.push(Math.cos(a) * r * 480, y * 480, Math.sin(a) * r * 480);
  }
  starGeometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(starPositions, 3),
  );
  const starMaterial = new THREE.PointsMaterial({
    color: 0xdde8ff,
    size: 0.65,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
  });
  const stars = new THREE.Points(starGeometry, starMaterial);
  scene.add(stars);
  const moonDisc = new THREE.Mesh(
    new THREE.SphereGeometry(2.2, 20, 12),
    new THREE.MeshBasicMaterial({ color: 0xd8e5ee, fog: false }),
  );
  moonDisc.position.set(180, 320, -210);
  scene.add(moonDisc);
  const loader = new THREE.TextureLoader(),
    textures: THREE.Texture[] = [];
  function texture(file: string, color = false) {
    const t = loader.load(`/modular/environment/${file}`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(650 / 4, 650 / 4);
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    if (color) t.colorSpace = THREE.SRGBColorSpace;
    textures.push(t);
    return t;
  }
  const soil = new THREE.MeshStandardMaterial({
    color: 0xfff6e6,
    roughness: 1,
    map: texture('ground-color.jpg', true),
    normalMap: texture('ground-normal.jpg'),
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughnessMap: texture('ground-roughness.jpg'),
  });
  // A second, broad sample breaks up the otherwise obvious repeating material.
  soil.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
   #ifdef USE_MAP
    vec3 broadSoil=texture2D(map,vMapUv*.071+vec2(.31,.67)).rgb;
    diffuseColor.rgb=mix(diffuseColor.rgb,vec3(dot(diffuseColor.rgb,vec3(.2126,.7152,.0722))),.45)*1.22;
    diffuseColor.rgb*=mix(vec3(.95),vec3(1.22),broadSoil);
   #endif`,
    );
  };
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(650, 650), soil);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.16;
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new THREE.GridHelper(360, 120, 0x766f62, 0xa59d8e);
  grid.position.y = -0.12;
  grid.visible = false;
  scene.add(grid);
  let lastShadow = -1;
  const owned = new ThreeResources();
  [sky, hemi, sun, moon, stars, moonDisc, ground, grid].forEach((o) =>
    owned.object(o),
  );
  const warmSun = new THREE.Color(0xff9854),
    blueSky = new THREE.Color(0xc8e2ff),
    mixedFog = new THREE.Color();
  const dayFog = new THREE.Color(0xc6d7dc),
    nightFog = new THREE.Color(0x101c31),
    sunsetFog = new THREE.Color(0xb1a093);
  const blueHourColor = new THREE.Color(0x1a2540);
  let wetness = 0;
  let lastWetTime = -1;
  function update(
    hour: number,
    time: number,
    moving: boolean,
    weather: WeatherWithWetness = clearWeather,
    date: string = DEFAULT_SCENE_DATE,
  ) {
    // Real NOAA solar position (engine/env/sun.ts), season-aware — see
    // NORTH_AZIMUTH_OFFSET there for the site bearing (−X north). Date
    // and hour are independent inputs, and both stay independent of
    // simulation elapsed time `time` (spec §19).
    const sun_ = solarPosition(localDateTimeAt(date, hour), BOMBAY_BEACH.lat, BOMBAY_BEACH.lon, opts.northAzimuthOffset);
    const direction = new THREE.Vector3(...sun_.direction);
    const state = daylightFactors(sun_.elevationDeg);
    uniforms.sunPosition.value.copy(direction).multiplyScalar(450000);
    uniforms.dayBlend.value = state.daylight;
    uniforms.time.value = time * (2 + weather.wind * 16);
    uniforms.cloudCoverage.value = 0.15 + weather.clouds * 0.8;
    uniforms.cloudDensity.value = 0.25 + weather.clouds * 0.65;
    uniforms.turbidity.value = 1.6 + weather.dust * 8;
    // Surface wetness: an exponential moving average of rain intensity (rises
    // over ~10s, dries over ~90s) so puddles linger visually after rain stops,
    // matching spec §19's "wet/muddy ground appearance". `weather.wet` (the
    // Environment.weather.wet field in the new engine's world/types.ts) is used
    // directly when present; otherwise it is estimated from `weather.rain`
    // because the live studio's remote Weather (simulation/shared.ts) does not
    // carry `wet` yet.
    if (lastWetTime >= 0) {
      const dt = Math.max(0, Math.min(5, time - lastWetTime));
      const target = weather.wet ?? weather.rain;
      const tau = target > wetness ? 10 : 90;
      wetness += (target - wetness) * (1 - Math.exp(-dt / tau));
    } else {
      wetness = weather.wet ?? weather.rain;
    }
    lastWetTime = time;
    soil.color.set(0xfff6e6).multiplyScalar(1 - weather.rain * 0.3 - wetness * 0.25);
    soil.roughness = 1 - weather.rain * 0.45 - wetness * 0.35;
    soil.metalness = wetness * 0.12; // faint puddle-ish sheen, not a literal water shader
    (scene.fog as THREE.Fog).near =
      180 - weather.dust * 160 - weather.rain * 70;
    (scene.fog as THREE.Fog).far =
      650 - weather.dust * 520 - weather.rain * 190;
    sun.position.copy(direction).multiplyScalar(100);
    sun.intensity = 2.8 * state.daylight * Math.max(0, direction.y) * 1.2;
    // Cloud cover dims and diffuses the sun: less direct intensity, softer
    // (wider) shadow penumbra, and more of the light effectively comes from
    // the sky/hemisphere term below instead of the direct lamp.
    sun.intensity *= 1 - weather.clouds * 0.65;
    sun.shadow.radius = 1.2 + weather.clouds * 7;
    sun.color.set(0xfff0d8).lerp(warmSun, state.warmth * 0.7);
    hemi.intensity = 0.22 + 1.48 * state.daylight + weather.clouds * 0.35 * state.daylight;
    hemi.color
      .set(0x9bb7e8)
      .lerp(blueSky, state.daylight)
      .lerp(blueHourColor, state.blueHour * 0.5);
    moon.intensity = 0.22 * state.night;
    moonDisc.visible = state.night > 0.15;
    starMaterial.opacity = state.night * 0.85 * (1 - weather.clouds);
    (scene.fog as THREE.Fog).color
      .copy(nightFog)
      .lerp(
        mixedFog.copy(dayFog).lerp(sunsetFog, state.warmth),
        state.daylight,
      )
      .lerp(blueHourColor, state.blueHour * 0.6);
    (scene.fog as THREE.Fog).color
      .lerp(new THREE.Color(0xa99678), weather.dust * 0.65)
      .lerp(new THREE.Color(0x8997a3), weather.rain * 0.35);
    // Wall-time budget remains 4 Hz even at 8× simulation speed.
    const shadowNow = performance.now() / 1000;
    if (
      (Math.abs(hour - lastShadow) > 0.025 || moving) &&
      shadowNow - lastShadowTime >= 0.25
    ) {
      sun.shadow.needsUpdate = true;
      lastShadow = hour;
      lastShadowTime = shadowNow;
    }
    return state.night;
  }
  let lastShadowTime = -1;
  update(16, 0, false);
  return {
    grid,
    update,
    invalidate: () => {
      sun.shadow.needsUpdate = true;
    },
    dispose: () => {
      owned.dispose();
      [sky, hemi, sun, moon, stars, moonDisc, ground, grid].forEach((o) =>
        scene.remove(o),
      );
      scene.fog = null;
    },
  };
}
