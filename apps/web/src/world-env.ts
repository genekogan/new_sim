// R4-LIVE: the living-world presentation of a god (new) world — its weather and time — read from the entity world's
// state (the god's `world` op; apps/server/src/god/world-env.ts is the setter). Presentation only.
import * as THREE from 'three';
import type { SetWeather } from './WorldAtmosphere.ts';
import { setClockNight } from './gen-mesh/motion.ts';
import { paintOnlySources, setNightLightStrength, type NightSource } from './WorldNightLights.ts';

type WorldStateLike = { weather?: { kind?: string; clouds?: number; rain?: number; wind?: number; fog?: number; intensity?: number } } | null | undefined;

/** The god's set weather, or null when the world follows the scheduled weather ('auto', the default). */
export function setWeatherOf(state: WorldStateLike): SetWeather | null {
  const w = state?.weather;
  if (!w || !w.kind || w.kind === 'auto') return null;
  const n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : d);
  return { kind: w.kind, clouds: n(w.clouds, 0.1), rain: n(w.rain, 0), wind: n(w.wind, 0.1), fog: n(w.fog, 0), intensity: n(w.intensity, 1) };
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
  constructor(private roots: () => THREE.Object3D[]) { this.ray.far = 40; }
  test(x: number, y: number, z: number): boolean {
    const now = performance.now();
    if (now - this.last < 400 && this.at.distanceToSquared(_p.set(x, y, z)) < 1) return this.covered;
    this.last = now; this.at.set(x, y, z);
    this.ray.set(this.at, this.up);
    const roots = this.roots();
    this.covered = roots.length > 0 && this.ray.intersectObjects(roots, true).some((h) => h.object.visible && !(h.object.userData as { cameraTransparent?: boolean }).cameraTransparent);
    return this.covered;
  }
}
const _p = new THREE.Vector3();

// ---------------------------------------------------------------- the living view of a god world

type ModelLike = {
  entities: Map<string, { id: string; def: string; state?: Record<string, unknown> }>;
  resolvedDef(ref: string): { components?: { light?: { color?: string; range?: number; on?: boolean } }; tags?: string[] } | undefined;
  worldPose(e: unknown): { x: number; y: number; z: number };
  editSeq?: number;
};
type LayerLike = { active: boolean; groundAt(x: number, z: number): number | null; group: THREE.Object3D };

/** God worlds get Eden's living presentation: lamps that light at dusk with warm pools and halos, the sky, weather
 *  (scheduled, or the god's), and rain that stays out of god-built rooms. One per live view. */
export class GodWorldLiving {
  /** Carries the god's lamps as `edenLightSources` for the atmosphere's halos and fireflies (found by its scene scan). */
  readonly group = new THREE.Group();
  private signature = '';
  private checkedAt = -Infinity;
  private readonly cover: CoverProbe;
  lights = 0;
  constructor(private layer: LayerLike) {
    this.group.name = 'god-world lights (presentation)'; this.group.userData.cameraTransparent = true;
    this.cover = new CoverProbe(() => (this.layer.active ? [this.layer.group] : []));
  }
  private get model(): ModelLike | null { return (this.layer as unknown as { model?: ModelLike | null }).model ?? null; }
  /** Every frame: lamps follow the world clock; the night map is repainted when the god's lights change (checked 2×/s). */
  update(nowMs: number, daylight: number | null) {
    if (!this.layer.active) { setClockNight(null); return; }
    setClockNight(daylight === null ? null : 1 - Math.max(0, Math.min(1, daylight)));
    setNightLightStrength(daylight);
    if (nowMs - this.checkedAt < 500) return;
    this.checkedAt = nowMs;
    const m = this.model; if (!m) return;
    const sources: NightSource[] = [], marks: [number, number, number, string, number][] = [];
    for (const e of m.entities.values()) {
      const light = m.resolvedDef(e.def)?.components?.light;
      if (!light || light.on === false || e.state?.on === false) continue;
      const p = m.worldPose(e), base = this.layer.groundAt(p.x, p.z) ?? 0, range = Math.max(2, Math.min(14, light.range ?? 8));
      const fire = /fire|hearth|brazier|campfire|torch/.test(e.def);
      sources.push({ x: p.x, z: p.z, base, radius: range * (fire ? 0.55 : 0.42), intensity: fire ? 1.3 : 1.2, color: light.color ?? '#ffe9c4', halo: range * 1.25 });
      marks.push([p.x, base, p.z, fire ? 'fire' : 'lamp', range / 8]);
    }
    const sig = JSON.stringify(sources.map((s) => [s.x.toFixed(1), s.z.toFixed(1), s.color, s.radius.toFixed(1)]));
    if (sig === this.signature) return;
    this.signature = sig; this.lights = sources.length;
    paintOnlySources(sources);
    this.group.userData.edenLightSources = marks;
  }
  /** For the atmosphere: the god's weather (null = scheduled) and "under a roof" for camera-local rain. */
  atmosphere(): { weather: SetWeather | null; indoors: (x: number, y: number, z: number) => boolean } {
    return { weather: setWeatherOf(entityWorldState(this.layer)), indoors: (x, y, z) => this.cover.test(x, y, z) };
  }
  dispose() { setClockNight(null); this.group.removeFromParent(); }
}

// ---------------------------------------------------------------- broadcast: a god world's establishing views
type TourViewLike = { id: string; label: string; p: readonly [number, number, number]; target: readonly [number, number, number] };
type ViewModel = {
  entities: Map<string, { id: string; name?: string; def: string; in: { parent: string }; shape?: { area?: [number, number][]; path?: [number, number][] } }>;
  resolvedDef(ref: string): { layer?: string; tags?: string[]; components?: { landform?: unknown } } | undefined;
  footprint(e: unknown): { c: [number, number]; half: [number, number]; y0: number; y1: number }[];
  editSeq?: number;
};
const IGNORE_TAGS = /^(terrain|landform|ground|path|road|vegetation|tree|plant|flower|rock|creature|animal|flag|marker|lamp|light)$/;
let viewsCache: { key: string; views: TourViewLike[] } | null = null;
/** Up to 12 establishing views of what the god built: named top-level things with some size (houses, plazas, a
 *  fountain, a tower), biggest first, each seen from a seeded side at a distance that frames it (Eden's broadcast
 *  holds these when nothing is happening, and tours them when nobody is here). Cached per edit. */
export function godTourViews(layer: unknown, groundAt: (x: number, z: number) => number | null): TourViewLike[] {
  const m = (layer as { model?: ViewModel | null }).model; if (!m) return [];
  const key = `${m.editSeq ?? ''}:${m.entities.size}`;
  if (viewsCache?.key === key) return viewsCache.views;
  const found: { v: TourViewLike; size: number }[] = [];
  for (const e of m.entities.values()) {
    if (e.in.parent !== 'world' || !e.name || /^flag[-:]/.test(e.name)) continue;
    const d = m.resolvedDef(e.def); if (!d || d.components?.landform || (d.tags ?? []).some((t) => IGNORE_TAGS.test(t))) continue;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, top = 0;
    try { for (const b of m.footprint(e)) { const r = Math.hypot(b.half[0], b.half[1]); x0 = Math.min(x0, b.c[0] - r); x1 = Math.max(x1, b.c[0] + r); z0 = Math.min(z0, b.c[1] - r); z1 = Math.max(z1, b.c[1] + r); top = Math.max(top, b.y1 - b.y0); } } catch { continue; }
    if (e.shape?.area) for (const [x, z] of e.shape.area) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    if (!Number.isFinite(x0)) continue;
    const size = Math.max(x1 - x0, z1 - z0, top);
    if (Math.max(x1 - x0, z1 - z0) < 3) continue;  // a landmark has some ground to it (not a lamp-post or a sign)
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, g = groundAt(cx, cz) ?? 0;
    const dist = Math.max(10, Math.min(70, size * 1.9 + 6)), a = ((hashStr(e.id) % 360) / 360) * Math.PI * 2;
    const ex = cx + Math.cos(a) * dist, ez = cz + Math.sin(a) * dist, eg = groundAt(ex, ez) ?? g;
    const ty = g + Math.min(top, 8) * 0.45;
    found.push({ size, v: { id: `god:${e.id}`, label: e.name.replace(/[-_]+/g, ' '), target: [cx, ty, cz], p: [ex, Math.max(eg + 2, ty) + dist * 0.38, ez] } });
  }
  const views = found.sort((a, b) => b.size - a.size).slice(0, 12).map((f) => f.v);
  viewsCache = { key, views };
  return views;
}
function hashStr(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
