// R4-LIVE: the living-world presentation of a god (new) world — its weather and time — read from the entity world's
// state (the god's `world` op; apps/server/src/god/world-env.ts is the setter). Presentation only.
import * as THREE from 'three';
import type { SetWeather } from './WorldAtmosphere.ts';
import { setWeatherInForce } from '@sim/world-compiler/weather-rules';
import { nightOf, setClockNight, worldSeconds } from './gen-mesh/motion.ts';
import { defLights, flickers, lightPhase, PatternNightMap, paintOnlySources, setNightLightStrength, worldNightBounds, type AuthoredLight, type NightSource } from './WorldNightLights.ts';
import type { HaloSource } from './atmosphere/halos.ts';

type WorldStateLike = { weather?: { kind?: string; clouds?: number; rain?: number; wind?: number; fog?: number; intensity?: number; until?: number | null } } | null | undefined;

/** A picture's local time override, in minutes after midnight. Ordinary viewers ignore it. */
export function parseShotHour(search: string): number | null {
  const q = new URLSearchParams(search), hour = q.get('hour');
  if (!q.has('shot') || !hour || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hour)) return null;
  return Number(hour.slice(0, 2)) * 60 + Number(hour.slice(3));
}
/** Keep the world's calendar date; replace only the presentation time. The streamed clock is never edited. */
/** A world's presentation calendar: `state.time.calendar` "MM-DD" replaces the clock's month and day (the year, hour and
 *  minutes stay), so the sky, sun path and dusk follow that season (Eden 2026: early June, so 19:00 is golden hour as on
 *  old /w/eden). Presentation only: the server clock and every schedule keep the world clock. */
export function calendarClock(clock: string | null, state: unknown): string | null {
  const cal = (state as { time?: { calendar?: unknown } } | null)?.time?.calendar;
  if (!clock || typeof cal !== 'string' || !/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(cal) || !/^\d{4}-\d{2}-\d{2}T/.test(clock)) return clock;
  return `${clock.slice(0, 5)}${cal}${clock.slice(10)}`;
}
/** P7d: the world's clock when the server sent this page (apps/server/src/edge-snapshot.ts withWorldClock), as the naive
 *  local datetime the sky takes (a take's clock goes through shiftIso: no zone; the sun's position is NaN with one), or null. */
export function entryWorldClock(): string | null {
  const c = typeof window === 'undefined' ? null : (window as unknown as { __simWorldClock?: unknown }).__simWorldClock;
  return typeof c === 'string' ? c.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?/)?.[0] ?? null : null;
}
/** P7d: how many Souls the world had when the server sent this page (edge-snapshot.ts withWorldClock), or null when the page
 *  does not say. With Souls, LiveWorld stays in broadcast, which opens on the world's first landmark (WorldDirector's opening). */
export function entryWorldSouls(): number | null {
  const n = typeof window === 'undefined' ? null : (window as unknown as { __simWorldSouls?: unknown }).__simWorldSouls;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : null;
}
export function shotClockAt(clock: string | null, hour: number | null): string | null {
  if (hour === null || !clock || !Number.isInteger(hour) || hour < 0 || hour >= 1440 || !/^\d{4}-\d{2}-\d{2}T/.test(clock)) return clock;
  return `${clock.slice(0, 10)}T${String(Math.floor(hour / 60)).padStart(2, '0')}:${String(hour % 60).padStart(2, '0')}:00`;
}

/** r2.1: `?shot=1` readiness waits for the first world clock to reach the lights. Takes (and so the clock) arrive a few
 *  hundred ms after the entity layer settles; until then the sky is the no-clock midday, so `look --views/--frames
 *  --hour 21` captured day in its first views. Resolves true once `hasClock()`, false after `timeoutMs` (a world
 *  without a clock still gets its picture) or on abort. */
export function whenShotClock(hasClock: () => boolean, { timeoutMs, signal, frame = (fn: () => void) => requestAnimationFrame(fn) }: { timeoutMs: number; signal?: AbortSignal; frame?: (fn: () => void) => unknown }): Promise<boolean> {
  const until = performance.now() + timeoutMs;
  return new Promise(resolve => {
    const check = () => { if (hasClock()) resolve(true); else if (signal?.aborted || performance.now() >= until) resolve(false); else frame(check); };
    check();
  });
}

/** The god's set weather, or null when the world follows the scheduled weather ('auto', the default, or a rain/storm
 *  past its end tick: WEATHER-RULES; `tick` NaN = unknown, trusts a stamped end). */
export function setWeatherOf(state: WorldStateLike, tick = NaN): SetWeather | null {
  const w = state?.weather;
  if (!w || !setWeatherInForce(w, tick)) return null;
  const n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : d);
  return { kind: w.kind!, clouds: n(w.clouds, 0.1), rain: n(w.rain, 0), wind: n(w.wind, 0.1), fog: n(w.fog, 0), intensity: n(w.intensity, 1) };
}

/** The entity layer's world state (its model is private to the layer; read-only here). */
export const entityWorldState = (layer: unknown): WorldStateLike => (layer as { model?: { state?: WorldStateLike } | null }).model?.state ?? null;

/** "Is this point under a god-built roof?" — one upward ray into the god's things, at most every 400 ms per point
 *  (rain, leaves and motes are camera-local: they must not fall through a ceiling). */
export class CoverProbe {
  private ray = new THREE.Raycaster();
  private up = new THREE.Vector3(0, 1, 0);
  private at = new THREE.Vector3(Infinity, 0, 0);
  private last = 0;
  private covered = false;
  // a camera for sprites (labels) in the god's layer: three's Sprite.raycast needs one; label hits are skipped below
  private roots: () => THREE.Object3D[];
  constructor(roots: () => THREE.Object3D[]) { this.roots = roots; this.ray.far = 40; this.ray.camera = new THREE.PerspectiveCamera(); }
  test(x: number, y: number, z: number): boolean {
    const now = performance.now();
    if (now - this.last < 400 && this.at.distanceToSquared(_p.set(x, y, z)) < 1) return this.covered;
    this.last = now; this.at.set(x, y, z);
    this.ray.set(this.at, this.up);
    const roots = this.roots();
    this.covered = roots.length > 0 && this.ray.intersectObjects(roots, true).some((h) => h.object.visible && !(h.object as THREE.Sprite).isSprite && !(h.object.userData as { cameraTransparent?: boolean }).cameraTransparent);
    return this.covered;
  }
}
const _p = new THREE.Vector3();
/** One cover probe per root group, shared by everything that asks about the camera (the atmosphere's rain and motes,
 *  the sound's muffling): P1 phones - each asked its own probe, so the camera's upward ray into the whole layer (~9,000
 *  objects, several ms on a phone) ran twice; now the second asker within 400 ms and 1 m gets the same answer. */
const SHARED_COVER = new WeakMap<THREE.Object3D, CoverProbe>();
export function sharedCoverProbe(root: THREE.Object3D): CoverProbe {
  let p = SHARED_COVER.get(root);
  if (!p) SHARED_COVER.set(root, (p = new CoverProbe(() => [root])));
  return p;
}

// ---------------------------------------------------------------- the living view of a god world

type ModelLike = {
  entities: Map<string, { id: string; def: string; state?: Record<string, unknown> }>;
  resolvedDef(ref: string): { components?: { light?: AuthoredLight; lights?: AuthoredLight[] }; tags?: string[]; size?: { box?: readonly number[] } } | undefined;
  worldPose(e: unknown): { x: number; y: number; z: number; yaw?: number; s?: number };
  readPass?<T>(fn: () => T): T;
  constants?: { extent?: number };
  ground?(): { extent?: readonly number[] };
  editSeq?: number;
};
type LayerLike = { active: boolean; groundAt(x: number, z: number): number | null; group: THREE.Object3D };

/** God worlds get Eden's living presentation: lamps that light at dusk with warm pools and halos, the sky, weather
 *  (scheduled, or the god's), and rain that stays out of god-built rooms. One per live view. */
/** W2 darker night: a pool's radius and its soft outer halo, per metre of light range (were 0.42 / 1.25: Eden 2026's 800
 *  lamps' halos summed into a wash that lit whole lawns; fires were 0.55). `?poolr=` / `?poolhalo=` are shot dials. */
const POOL_HALO = (() => { const v = typeof location !== 'undefined' ? Number(new URLSearchParams(location.search).get('poolhalo')) : NaN; return Number.isFinite(v) && v > 0 && v < 4 ? v : 0.4; })();
/** W2: a lamp pool's peak (was 1.2: pools saturated to full-day grass, lime discs at night). `?poollamp=` dial. */
/** W2: a lamp pool's peak (was 1.2: pools saturated to full-day grass, lime discs at night). `?poollamp=` dial. */
const POOL_LAMP = (() => { const v = typeof location !== 'undefined' ? Number(new URLSearchParams(location.search).get('poollamp')) : NaN; return Number.isFinite(v) && v > 0 && v < 4 ? v : 0.8; })();
const POOL_RADIUS = (() => { const v = typeof location !== 'undefined' ? Number(new URLSearchParams(location.search).get('poolr')) : NaN; return Number.isFinite(v) && v > 0 && v < 4 ? v : 0.3; })();
type SkyModel = Pick<ModelLike, 'entities' | 'resolvedDef' | 'worldPose' | 'readPass' | 'constants'> & { ground?(): { waters?: { area?: [number, number][]; level?: number }[] } };
/** W2b: the balloons' loops ([cx, cz, rx, rz] × 4, or null for none) and the fog band ([x0, z0, x1, z1] over the largest
 *  water at least ~120 m across, and its level; or null). Loops spread over the bounds of the world's top-level things. */
export function skyThingsOf(m: SkyModel, balloons: unknown): { tracks: number[][] | null; band: number[] | null } {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, has = false;
  const scan = () => { for (const e of m.entities.values()) {
    if ((e as { in?: { parent?: string } }).in?.parent !== 'world') continue;
    const d = m.resolvedDef(e.def); if (d?.tags?.includes('balloon')) has = true;
    if (d?.tags?.some((t) => /^(terrain|landform|ground|lake|sea|ocean|zone|land-use|boundary)$/.test(t))) continue;
    const p = m.worldPose(e); if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
  } };
  if (m.readPass) m.readPass(scan); else scan();
  let tracks: number[][] | null = null;
  if (balloons !== false && (balloons === true || has) && Number.isFinite(x0)) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, w = Math.max(60, (x1 - x0) / 2), dd = Math.max(60, (z1 - z0) / 2), k = Math.min(1, Math.min(w, dd) / 250);
    tracks = [[cx - 0.35 * w, cz - 0.1 * dd, 70 * k, 40 * k], [cx + 0.3 * w, cz - 0.35 * dd, 55 * k, 35 * k], [cx - 0.05 * w, cz + 0.25 * dd, 24 * k, 20 * k], [cx + 0.15 * w, cz + 0.05 * dd, 60 * k, 50 * k]];
  }
  let band: number[] | null = null, best = 0;
  for (const wtr of m.ground?.().waters ?? []) {
    const a = wtr.area; if (!a || a.length < 3) continue;
    const xs = a.map((q) => q[0]), zs = a.map((q) => q[1]), bx0 = Math.min(...xs), bx1 = Math.max(...xs), bz0 = Math.min(...zs), bz1 = Math.max(...zs);
    const area = Math.abs(a.reduce((s, [px, pz], i) => { const [qx, qz] = a[(i + 1) % a.length]; return s + px * qz - qx * pz; }, 0)) / 2;
    if (Math.min(bx1 - bx0, bz1 - bz0) < 120 || area < 20000 || area <= best) continue;
    best = area; band = [bx0, bz0, bx1, bz1, wtr.level ?? 0];
  }
  return { tracks, band };
}
export class GodWorldLiving {
  /** Carries the god's lamps as `edenLightSources` for the atmosphere's halos and fireflies (found by its scene scan). */
  readonly group = new THREE.Group();
  private signature = '';
  private checkedAt = -Infinity;
  /** P1 phones: the light scan's inputs (the layer's model and its diff seq); unchanged inputs skip the scan. */
  private scanned: { model: unknown; seq: number; at: number } | null = null;
  private patterns: PatternNightMap | null = null;
  private reduced = false;
  private clockless = false;
  lights = 0;
  // explicit fields (not parameter properties): lane bugs' tests load this file under Node's strip-only TypeScript
  private layer: LayerLike;
  private renderer?: THREE.WebGLRenderer;
  /** Look pass: pool radius scale and pool brightness at night (1, 1 = the 3.2 look). */
  private pools: { radius: number; gain: number };
  constructor(layer: LayerLike, renderer?: THREE.WebGLRenderer, pools: { radius: number; gain: number } = { radius: 1, gain: 1 }) {
    this.layer = layer; this.renderer = renderer; this.pools = pools;
    this.group.name = 'god-world lights (presentation)'; this.group.userData.cameraTransparent = true;
  }
  private get model(): ModelLike | null { return (this.layer as unknown as { model?: ModelLike | null }).model ?? null; }
  /** Every frame: lamps follow the world clock; the night map is repainted when the god's lights change (checked 2×/s). */
  update(nowMs: number, daylight: number | null, reducedMotion = false) {
    if (!this.layer.active) { setClockNight(null); return; }
    setClockNight(daylight === null ? null : 1 - Math.max(0, Math.min(1, daylight)));
    setNightLightStrength(daylight, this.pools.gain);
    if (this.patterns && this.renderer && (!reducedMotion || reducedMotion !== this.reduced)) this.patterns.render(this.renderer, worldSeconds(nowMs / 1000), reducedMotion);
    this.reduced = reducedMotion;
    if (daylight !== null && this.clockless) { this.clockless = false; this.checkedAt = -Infinity; }
    if (nowMs - this.checkedAt < 500) return;
    this.checkedAt = nowMs;
    // MARSLAND-FAR: the sky palette, for the atmosphere's scene scan (atmosphere/palettes.ts)
    this.group.userData.edenSkyPalette = (entityWorldState(this.layer) as { sky?: { palette?: string } } | null)?.sky?.palette ?? null;
    const m = this.model; if (!m) return;
    this.skyThings(m);
    // P7b: before the first clock a world whose sky palette is not night shows no lamp pools, so the scan of every entity
    // (~0.14 s of a 4x phone) waits for the clock (a phone's early arrival draws the world before its first take)
    if (daylight === null && nightOf(m as unknown as Parameters<typeof nightOf>[0]) <= 0) { this.clockless = true; return; }
    // P1 phones: the model changes only with a world diff (the layer's seq) or a resync (a new model), so the scan of
    // every entity (~4,900 on Eden 2026, ~4% of a phone frame) runs only then (and every 10 s, to be safe)
    const seq = (this.layer as unknown as { seq?: unknown }).seq, s = this.scanned;
    if (typeof seq === 'number' && s && s.model === m && s.seq === seq && nowMs - s.at < 10_000) return;
    this.scanned = typeof seq === 'number' ? { model: m, seq, at: nowMs } : null;
    const sources: NightSource[] = [], marks: HaloSource[] = [], beacons: [number, number, number][] = [];
    const scan = () => { for (const e of m.entities.values()) {
      if (e.state?.on === false) continue;
      const def = m.resolvedDef(e.def), components = def?.components, lights = defLights(components);
      // W2: any lighthouse sweeps its beams at night from its lantern room (near the top of its box)
      if (def?.tags?.includes('lighthouse')) { const p = m.worldPose(e), h = (def.size?.box?.[1] ?? 16) * (p.s ?? 1); beacons.push([p.x, p.y + h * 0.83, p.z]); }
      if (!lights.length) continue;
      const p = m.worldPose(e), yaw = p.yaw ?? 0, scale = p.s ?? 1, cos = Math.cos(yaw), sin = Math.sin(yaw);
      const fire = /fire|hearth|brazier|campfire|torch/.test(e.def);
      const flame = flickers(e.def); // W2: fire pools and halos flicker (an authored pattern wins)
      for (const [i, light] of lights.entries()) {
        if (light.on === false) continue;
        const at = light.at, dx = (at?.[0] ?? 0) * scale, dz = (at?.[at.length - 1] ?? 0) * scale;
        const x = p.x + dx * cos + dz * sin, z = p.z - dx * sin + dz * cos;
        const base = this.layer.groundAt(x, z) ?? 0, range = Math.max(2, Math.min(14, light.range ?? 8));
        const pattern = light.pattern ?? (flame ? 'flicker' as const : undefined);
        const phase = lightPhase(e.id, i, lights.length, pattern);
        sources.push({ x, z, base, radius: range * (fire ? 0.4 : POOL_RADIUS) * this.pools.radius, intensity: fire ? 1.1 : POOL_LAMP, color: light.color ?? '#ffe9c4', halo: range * POOL_HALO * this.pools.radius, pattern, phase });
        marks.push([x, at ? p.y + (at.length === 3 ? at[1] * scale : 0) : base, z, at ? 'festoon' : fire ? 'fire' : 'lamp', range / 8, pattern, phase, at || light.pattern || components?.lights ? light.color : undefined]);
      }
    } };
    if (m.readPass) m.readPass(scan); else scan();
    const bounds = worldNightBounds(m.constants?.extent, m.ground?.().extent);
    const sig = JSON.stringify([sources, marks, bounds, beacons]);
    if (sig === this.signature) return;
    this.signature = sig; this.lights = sources.length;
    if (this.renderer && sources.some(s => s.pattern && s.pattern !== 'steady')) {
      this.patterns ??= new PatternNightMap(); this.patterns.setSources(sources, bounds);
      this.patterns.render(this.renderer, worldSeconds(nowMs / 1000), reducedMotion);
    } else { this.patterns?.dispose(); this.patterns = null; paintOnlySources(sources, bounds); }
    this.group.userData.edenLightSources = marks;
    this.group.userData.edenLighthouses = beacons;
  }
  private skyKey = '';
  /** W2b: drifting hot-air balloons (a world with balloons of its own, or `state.sky.balloons: true`; `false` = none) on
   *  loops over what the god built, and the sea fog band over its largest water. Recomputed only when the world changes. */
  private skyThings(m: ModelLike) {
    const sky = (entityWorldState(this.layer) as { sky?: { balloons?: unknown } } | null)?.sky;
    const key = `${m.editSeq ?? ''}:${m.entities.size}:${String(sky?.balloons)}`;
    if (key === this.skyKey) return; this.skyKey = key;
    const { tracks, band } = skyThingsOf(m as unknown as SkyModel, sky?.balloons);
    this.group.userData.edenBalloonTracks = tracks; this.group.userData.edenFogBand = band;
  }
  /** For the atmosphere: the god's weather (null = scheduled) and "under a roof" for camera-local rain. */
  atmosphere(tick = NaN): { weather: SetWeather | null; indoors: (x: number, y: number, z: number) => boolean } {
    return { weather: setWeatherOf(entityWorldState(this.layer), tick), indoors: (x, y, z) => this.layer.active && sharedCoverProbe(this.layer.group).test(x, y, z) };
  }
  dispose() { setClockNight(null); this.patterns?.dispose(); this.patterns = null; this.group.removeFromParent(); }
}

// ---------------------------------------------------------------- broadcast: a god world's establishing views
type TourViewLike = { id: string; label: string; p: readonly [number, number, number]; target: readonly [number, number, number];
  /** Ground radius (m) around `target` that holds the whole landmark: Explore's picture of it slices this much. */
  radius?: number };
type ViewModel = {
  entities: Map<string, { id: string; name?: string; def: string; in: { parent: string }; shape?: { area?: [number, number][]; path?: [number, number][] } }>;
  resolvedDef(ref: string): { layer?: string; tags?: string[]; components?: { landform?: unknown }; make?: { kind?: string } } | undefined;
  footprint(e: unknown): { c: [number, number]; half: [number, number]; y0: number; y1: number }[];
  editSeq?: number;
};
const IGNORE_TAGS = /^(terrain|landform|ground|path|road|vegetation|tree|plant|flower|rock|creature|animal|flag|marker|lamp|light|zone|land-use|lake|sea|ocean|lawn|ground-paint|cover|ecology|boundary)$/;
/** A thing's name as a place label: "region-campus-library-annex" -> "Campus library annex", "eden-library-1" -> "Library". */
export function placeLabel(name: string): string {
  const t = name.replace(/^(?:(?:region|place|land|int|eden)-)+/, '').replace(/-1$/, '').replace(/[-_]+/g, ' ').trim() || name.replace(/[-_]+/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}
let viewsCache: { key: string; views: TourViewLike[] } | null = null;
type Box = { id: string; x0: number; z0: number; x1: number; z1: number; top: number };
/** Up to 12 establishing views of what the god built: named top-level things with some size (houses, plazas, a
 *  fountain, a tower), biggest first, each seen from a seeded side at a distance that frames it (Eden's broadcast
 *  holds these when nothing is happening, and tours them when nobody is here). Cached per edit. */
export function godTourViews(layer: unknown, groundAt: (x: number, z: number) => number | null, limit = 12): TourViewLike[] {
  const m = (layer as { model?: ViewModel | null }).model; if (!m) return [];
  const key = `${m.editSeq ?? ''}:${m.entities.size}`;
  if (viewsCache?.key === key) return viewsCache.views.slice(0, limit);
  const found: { v: TourViewLike; size: number; dist: number; a: number; box: Box }[] = [], boxes: Box[] = [];
  for (const e of m.entities.values()) {
    if (e.in.parent !== 'world' || !e.name || /^flag[-:]/.test(e.name)) continue;
    // a landform-only def (hill, cutting) is ground, not a landmark; a thing that also carves (a pool's basin) still is one
    const d = m.resolvedDef(e.def); if (!d || (d.components?.landform && (!d.make || d.make.kind === 'none')) || (d.tags ?? []).some((t) => IGNORE_TAGS.test(t))) continue;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, top = 0, high = -Infinity;
    try { for (const b of m.footprint(e)) { const r = Math.hypot(b.half[0], b.half[1]); x0 = Math.min(x0, b.c[0] - r); x1 = Math.max(x1, b.c[0] + r); z0 = Math.min(z0, b.c[1] - r); z1 = Math.max(z1, b.c[1] + r); top = Math.max(top, b.y1 - b.y0); high = Math.max(high, b.y1); } } catch { continue; }
    if (e.shape?.area) for (const [x, z] of e.shape.area) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    if (!Number.isFinite(x0)) continue;
    const size = Math.max(x1 - x0, z1 - z0, top);
    if (Math.max(x1 - x0, z1 - z0) < 3) continue;  // a landmark has some ground to it (not a lamp-post or a sign)
    if (Math.max(x1 - x0, z1 - z0) > 150) continue; // nor is it a whole region (a sea, a district outline)
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, g = groundAt(cx, cz) ?? 0;
    const dist = Math.max(10, Math.min(70, size * 1.9 + 6)), a = ((hashStr(e.id) % 360) / 360) * Math.PI * 2;
    const ex = cx + Math.cos(a) * dist, ez = cz + Math.sin(a) * dist, eg = groundAt(ex, ez) ?? g;
    const ty = g + Math.min(top, 8) * 0.45;
    const box: Box = { id: e.id, x0, z0, x1, z1, top: Number.isFinite(high) ? Math.max(high, g + top) : g + top }; boxes.push(box); // top: the highest collider, not one storey's height
    found.push({ size, dist, a, box, v: { id: `god:${e.id}`, label: placeLabel(e.name), target: [cx, ty, cz], p: [ex, Math.max(eg + 2, ty) + dist * 0.38, ez], radius: Math.min(100, Math.hypot(x1 - x0, z1 - z0) / 2 + 1.5) } });
  }
  // the cache keeps up to 120 (Explore lists them all, searchable; the broadcast tour asks for 12). A part named after a
  // bigger landmark ("Courtyard house 4 kitchen" beside "Courtyard house 4") is the same place: listed once.
  const sorted = found.sort((a, b) => b.size - a.size), kept: TourViewLike[] = [];
  for (const f of sorted) { const l = f.v.label.toLowerCase(); if (kept.some((k) => l.startsWith(k.label.toLowerCase() + ' '))) continue; kept.push(f.v); if (kept.length >= 120) break; }
  // the side a view looks from: the seeded one unless taller things stand between it and the landmark (a little café
  // behind a three-storey office); then the clearest of eight sides
  for (const v of kept) { const f = found.find((x) => x.v === v)!; const [cx, ty, cz] = v.target; let best = f.a, bestHits = Infinity;
    for (let k = 0; k < 8 && bestHits > 0; k++) { const a = f.a + (k * Math.PI) / 4, ex = cx + Math.cos(a) * f.dist, ez = cz + Math.sin(a) * f.dist, ey = (groundAt(ex, ez) ?? 0) + 2 + f.dist * 0.38;
      const bx0 = Math.min(ex, cx), bx1 = Math.max(ex, cx), bz0 = Math.min(ez, cz), bz1 = Math.max(ez, cz);
      const near = boxes.filter((b) => b !== f.box && b.x1 > bx0 && b.x0 < bx1 && b.z1 > bz0 && b.z0 < bz1);
      let hits = 0; for (let t = 0.2; t < 0.95; t += 0.1) { const x = ex + (cx - ex) * t, z = ez + (cz - ez) * t, y = ey + (ty - ey) * t; for (const b of near) if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && b.top > y) hits++; }
      if (hits < bestHits) { bestHits = hits; best = a; } }
    if (best !== f.a) { const ex = cx + Math.cos(best) * f.dist, ez = cz + Math.sin(best) * f.dist, eg = groundAt(ex, ez) ?? 0; v.p = [ex, Math.max(eg + 2, ty) + f.dist * 0.38, ez]; } }
  const views = kept;
  viewsCache = { key, views };
  return views.slice(0, limit);
}
type RoomModel = ViewModel & {
  worldPose(e: unknown): { x: number; y: number; z: number; yaw?: number; s?: number };
  slotsOf(e: unknown): { id: string; kind: string; p: number[]; polygon?: [number, number][]; label?: string; floor?: number }[];
};
let roomsCache: { key: string; views: TourViewLike[] } | null = null;
/** M2 (lane M): "go inside" views for visitors — one per labelled room of a named building (Mars: the working kitchen,
 *  the dining hall, Mimos's rooms), from the rooms' own polygons: the camera stands near one end of the room at eye
 *  height and looks down its long side. Rooms under 8 m² (a shower bay) are left out; at most 16. Explore lists them
 *  after the establishing views. Cached per edit. */
export function godRoomViews(layer: unknown, groundAt: (x: number, z: number) => number | null): TourViewLike[] {
  const m = (layer as { model?: RoomModel | null }).model; if (!m || typeof m.slotsOf !== 'function') return [];
  const key = `${m.editSeq ?? ''}:${m.entities.size}`;
  if (roomsCache?.key === key) return roomsCache.views;
  const views: TourViewLike[] = [];
  const named = [...m.entities.values()].filter((e) => e.in.parent === 'world' && e.name).sort((a, b) => a.name!.localeCompare(b.name!));
  for (const e of named) {
    let slots: ReturnType<RoomModel['slotsOf']>; try { slots = m.slotsOf(e); } catch { continue; }
    const pose = m.worldPose(e), yaw = pose.yaw ?? 0, sc = pose.s ?? 1, c = Math.cos(yaw), s = Math.sin(yaw);
    const toWorld = (x: number, z: number): [number, number] => [pose.x + x * sc * c + z * sc * s, pose.z - x * sc * s + z * sc * c];
    for (const r of slots) {
      if (r.kind !== 'room' || !Array.isArray(r.polygon) || r.polygon.length < 3 || views.length >= 16) continue;
      const poly = r.polygon, area = Math.abs(poly.reduce((a, [x0, z0], i) => { const [x1, z1] = poly[(i + 1) % poly.length]; return a + x0 * z1 - x1 * z0; }, 0)) / 2;
      if (area < 8) continue;
      const xs = poly.map((q) => q[0]), zs = poly.map((q) => q[1]), cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
      const alongX = Math.max(...xs) - Math.min(...xs) >= Math.max(...zs) - Math.min(...zs), half = (alongX ? Math.max(...xs) - Math.min(...xs) : Math.max(...zs) - Math.min(...zs)) / 2;
      const at = (k: number): [number, number] => toWorld(r.p[0] + cx + (alongX ? k * half : 0), r.p[2] + cz + (alongX ? 0 : k * half));
      // stand at the end farther from the building's origin, so the view looks in towards the building's middle
      const far = (k: number) => { const q = at(k); return Math.hypot(q[0] - pose.x, q[1] - pose.z); }, k0 = far(-0.78) >= far(0.78) ? -1 : 1;
      const [ex, ez] = at(0.78 * k0), [tx, tz] = at(-0.6 * k0), base = (groundAt(pose.x, pose.z) ?? pose.y) + (r.p[1] ?? 0) * sc;
      const spoken = (t: string) => t.replace(/[-_]+/g, ' ').trim();
      const label = (r.label ? r.label.split('(')[0].trim() : '') || `${spoken(e.name!)} ${spoken(r.id)}`;
      if (views.some((v) => v.label.toLowerCase() === `inside: ${label}`.toLowerCase())) continue;
      views.push({ id: `room:${e.id}:${r.id}`, label: `Inside: ${label}`, p: [ex, base + 1.65, ez], target: [tx, base + 1.05, tz], radius: Math.max(2, half) });
    }
  }
  roomsCache = { key, views };
  return views;
}
function hashStr(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
