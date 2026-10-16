// W7 soundscape, the pure half (no WebAudio, testable under node): which sounds a world makes and where.
//
// Three kinds of source, all procedural (no audio files, nothing to license):
//   - objects: a def's `components.sound` — one spec, plus up to 3 more in `also` (a fountain can splash *and* hum). Each instance
//     gets a variant of its kind from its id (two birdbaths need not sing the same song); `params.sound`, `params.loudness`
//     and `params.soundVariant` override per instance.
//   - ambience: the world around the listener — a wind bed always, birds by day and crickets by night (spread over a fixed
//     40 m grid so walking changes who you hear), and water/waves near the world's lakes, rivers and sea.
//   - residents: distant chatter where residents stand together, footsteps where they walk, and the visitor's own
//     footsteps when the camera walks at eye height.
// Everything is quiet by default (MASTER_DEFAULT) and ambient music is opt-in.
import type { Entity, StoredDef, WorldModel } from '@sim/world-compiler';

export type SoundKind =
  | 'water' | 'stream' | 'fire' | 'wind' | 'creak' | 'birds' | 'bell' | 'hum' | 'engine' | 'chime' | 'frogs' | 'music'
  | 'waves' | 'crickets' | 'chatter' | 'footsteps';
export type SoundSpec = { kind: SoundKind; radius: number; volume: number; when?: string; mode?: 'loop' | 'change'; variant?: number };
export type Source = 'object' | 'ambient' | 'resident' | 'visitor';
export type Emitter = { id: string; spec: SoundSpec; pts: [number, number, number][]; area: boolean; state: Record<string, unknown>; source: Source };

export const KINDS: readonly SoundKind[] = ['water', 'stream', 'fire', 'wind', 'creak', 'birds', 'bell', 'hum', 'engine', 'chime', 'frogs', 'music', 'waves', 'crickets', 'chatter', 'footsteps'];
const KIND_SET = new Set<string>(KINDS);
/** How many distinct voicings each kind has (variant = index mod this). */
export const VARIANTS: Record<SoundKind, number> = { water: 3, stream: 2, fire: 2, wind: 2, creak: 2, birds: 4, bell: 3, hum: 2, engine: 3, chime: 3, frogs: 2, music: 4, waves: 2, crickets: 2, chatter: 3, footsteps: 2 };
export const MASTER_DEFAULT = 0.32;
export const isKind = (k: unknown): k is SoundKind => typeof k === 'string' && KIND_SET.has(k);
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** FNV-1a: a stable small hash for variant choice and grid scatter. */
export function hash(s: string): number { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
export const variantOf = (kind: SoundKind, key: string, pinned?: unknown) => {
  const n = VARIANTS[kind];
  return typeof pinned === 'number' && Number.isInteger(pinned) ? ((pinned % n) + n) % n : hash(key) % n;
};

/** The condition `when` against an entity's state (with the def's state defaults): 'on', '!open'. */
export function condition(when: string | undefined, state: Record<string, unknown>): boolean {
  if (!when) return true;
  const neg = when.startsWith('!'), k = neg ? when.slice(1) : when, v = state[k];
  const truthy = typeof v === 'number' ? v > 0 : !!v;
  return neg ? !truthy : truthy;
}
/** Distance from (x, y, z) to an emitter: a point, a polyline, or a polygon (0-ish inside). */
export function distanceTo(e: Pick<Emitter, 'pts' | 'area'>, x: number, y: number, z: number): number {
  const P = e.pts;
  if (P.length === 1) return Math.hypot(P[0][0] - x, P[0][1] - y, P[0][2] - z);
  let best = Infinity, inside = false;
  const n = e.area ? P.length : P.length - 1;
  for (let i = 0; i < n; i++) {
    const a = P[i], b = P[(i + 1) % P.length], dx = b[0] - a[0], dz = b[2] - a[2], L = dx * dx + dz * dz;
    const t = L > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / L)) : 0;
    const px = a[0] + dx * t, pz = a[2] + dz * t, py = a[1] + (b[1] - a[1]) * t;
    best = Math.min(best, Math.hypot(px - x, py - y, pz - z));
    if (e.area && ((a[2] > z) !== (b[2] > z)) && x < a[0] + ((z - a[2]) / (b[2] - a[2])) * (b[0] - a[0])) inside = !inside;
  }
  return inside ? Math.abs(y - P[0][1]) * 0.25 : best;
}
/** Loudness 0..1 heard from distance d (smooth quadratic fall-off to 0 at the radius). */
export const falloff = (d: number, radius: number, volume: number) => (d >= radius ? 0 : volume * (1 - d / radius) ** 2);

/** A def's sound specs: `components.sound` and its `also` list (at most 4 in all). Unknown kinds are dropped. */
export function specsOf(def: Pick<StoredDef, 'components'> | undefined): SoundSpec[] {
  const raw = (def?.components as { sound?: unknown } | undefined)?.sound;
  const list = Array.isArray(raw) ? raw.slice(0, 4) : raw ? [raw, ...(Array.isArray((raw as { also?: unknown }).also) ? ((raw as { also: unknown[] }).also).slice(0, 3) : [])] : [];
  const out: SoundSpec[] = [];
  for (const s of list as Partial<SoundSpec>[]) {
    if (!s || !isKind(s.kind)) continue;
    out.push({ kind: s.kind, radius: Math.max(1, Math.min(120, num(s.radius, 14))), volume: Math.max(0, Math.min(1, num(s.volume, 0.5))), when: typeof s.when === 'string' ? s.when : undefined, mode: s.mode === 'change' ? 'change' : 'loop', ...(typeof s.variant === 'number' ? { variant: s.variant } : {}) });
  }
  return out;
}

/** Every entity's sounds in the model, with position(s), current state (def defaults filled) and a chosen variant. */
export function emittersOf(model: WorldModel): Emitter[] {
  const out: Emitter[] = [];
  for (const e of model.entities.values()) {
    const def = model.resolvedDef(e.def), specs = specsOf(def);
    if (!def || !specs.length) continue;
    const state: Record<string, unknown> = {};
    for (const [k, f] of Object.entries(def.state ?? {})) state[k] = (f as { default?: unknown }).default;
    Object.assign(state, e.state ?? {});
    const p = e.params ?? {}, place = placeOf(model, e, def);
    specs.forEach((spec, i) => {
      // the first spec may be re-voiced per instance (params `sound`, `loudness`, `soundVariant`)
      const kind = i === 0 && isKind(p.sound) ? p.sound : spec.kind;
      const volume = i === 0 && typeof p.loudness === 'number' ? Math.max(0, Math.min(1, p.loudness)) : spec.volume;
      const id = specs.length > 1 ? `${e.id}#${i}` : e.id;
      out.push({ id, source: 'object', state, ...place, spec: { ...spec, kind, volume, variant: variantOf(kind, id, i === 0 ? p.soundVariant ?? spec.variant : spec.variant) } });
    });
  }
  return out;
}
function placeOf(model: WorldModel, e: Entity, def: StoredDef): Pick<Emitter, 'pts' | 'area'> {
  const g = (x: number, z: number) => { try { return model.terrain.sample(x, z); } catch { return 0; } };
  if (def.form !== 'point' && e.in.parent === 'world' && e.shape) {
    const raw = 'path' in e.shape ? e.shape.path : e.shape.area;
    const step = Math.max(1, Math.floor(raw.length / 64));
    const pts = raw.filter((_, i) => i % step === 0).map(([x, z]) => [x, g(x, z), z] as [number, number, number]);
    return { pts, area: 'area' in e.shape };
  }
  const p = model.worldPose(e), h = (def.size?.box?.[1] ?? 1) * p.s * 0.5;
  return { pts: [[p.x, p.y + h, p.z]], area: false };
}

// ---------------------------------------------------------------- ambience

export type Water = { area?: [number, number][]; path?: [number, number][]; w?: number; level: number };
export type Listener = { x: number; y: number; z: number; ground: number | null; night: number; covered: boolean; waters: readonly Water[]; seaLevel?: number };
const CELL = 40;

/** The world around the listener: wind always, birds (day) or crickets (night) scattered on a fixed grid, water near
 *  water. Indoors (under a roof) the ambience drops to a murmur. Deterministic in position and time of day. */
export function ambienceAt(L: Listener): Emitter[] {
  const out: Emitter[] = [], indoor = L.covered ? 0.25 : 1, hy = L.ground ?? L.y;
  const at = (x: number, z: number, y = hy) => [[x, y, z]] as [number, number, number][];
  // a wind bed that follows the listener, louder high up
  const lift = Math.max(0, Math.min(1, (L.y - hy) / 40));
  out.push({ id: 'amb:wind', source: 'ambient', state: {}, area: false, pts: at(L.x, L.z, L.y), spec: { kind: 'wind', radius: 10, volume: (0.07 + 0.1 * lift) * indoor, variant: lift > 0.5 ? 1 : 0 } });
  // creatures on a 40 m grid: each cell may hold one singer; day birds and night crickets crossfade at dusk
  const day = 1 - L.night, cx = Math.floor(L.x / CELL), cz = Math.floor(L.z / CELL);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const key = `${cx + i},${cz + j}`, h = hash(key);
    if (h % 3 === 0) continue;   // a third of cells are quiet
    const x = (cx + i + ((h >>> 4) % 97) / 97) * CELL, z = (cz + j + ((h >>> 12) % 89) / 89) * CELL;
    if (day > 0.15) out.push({ id: `amb:birds:${key}`, source: 'ambient', state: {}, area: false, pts: at(x, z, hy + 5), spec: { kind: 'birds', radius: 38, volume: 0.22 * day * indoor, variant: variantOf('birds', key) } });
    if (L.night > 0.3) out.push({ id: `amb:crickets:${key}`, source: 'ambient', state: {}, area: false, pts: at(x, z), spec: { kind: 'crickets', radius: 42, volume: 0.18 * L.night * indoor, variant: variantOf('crickets', key) } });
  }
  // the nearest water shore (lakes, rivers) and the sea
  for (const [k, w] of L.waters.entries()) {
    if (w.area && w.area.length > 2) out.push({ id: `amb:water:${k}`, source: 'ambient', state: {}, area: true, pts: w.area.map(([x, z]) => [x, w.level, z] as [number, number, number]), spec: { kind: 'waves', radius: 26, volume: 0.2 * indoor, variant: 1 } });
    else if (w.path && w.path.length > 1) out.push({ id: `amb:water:${k}`, source: 'ambient', state: {}, area: false, pts: w.path.map(([x, z]) => [x, w.level, z] as [number, number, number]), spec: { kind: 'stream', radius: 18 + (w.w ?? 2), volume: 0.2 * indoor, variant: variantOf('stream', `amb:water:${k}`) } });
  }
  if (L.seaLevel !== undefined && hy - L.seaLevel < 3) out.push({ id: 'amb:sea', source: 'ambient', state: {}, area: false, pts: at(L.x, L.z, L.seaLevel), spec: { kind: 'waves', radius: 10, volume: 0.22 * indoor * Math.max(0, 1 - (hy - L.seaLevel) / 3), variant: 0 } });
  return out;
}

// ---------------------------------------------------------------- residents and the visitor

export type Resident = { id: string; p: readonly [number, number, number] };
type Track = { p: readonly [number, number, number]; t: number; speed: number };

/** Footsteps where residents walk and chatter where two or more stand within 4 m of each other; the visitor's own
 *  footsteps when the camera moves at walking speed within 2.6 m of the ground. Keeps a short motion memory. */
export class Movement {
  private tracks = new Map<string, Track>();
  private cam: Track | null = null;
  emitters(residents: readonly Resident[], cam: { x: number; y: number; z: number; ground: number | null }, t: number): Emitter[] {
    const out: Emitter[] = [], seen = new Set<string>();
    for (const r of residents) {
      seen.add(r.id);
      const prev = this.tracks.get(r.id), dt = prev ? t - prev.t : 0;
      const speed = prev && dt > 0.05 ? Math.hypot(r.p[0] - prev.p[0], r.p[2] - prev.p[2]) / dt : prev?.speed ?? 0;
      this.tracks.set(r.id, { p: r.p, t: prev && dt <= 0.05 ? prev.t : t, speed: prev && dt <= 0.05 ? prev.speed : speed });
      if (speed > 0.4 && speed < 6) out.push({ id: `res:steps:${r.id}`, source: 'resident', state: { speed }, area: false, pts: [[r.p[0], r.p[1], r.p[2]]], spec: { kind: 'footsteps', radius: 12, volume: 0.22, variant: variantOf('footsteps', r.id) } });
    }
    for (const id of [...this.tracks.keys()]) if (!seen.has(id)) this.tracks.delete(id);
    // groups: residents standing still within 4 m of another make a murmur at their centre
    const still = residents.filter((r) => (this.tracks.get(r.id)?.speed ?? 0) < 0.4), used = new Set<string>();
    for (const a of still) {
      if (used.has(a.id)) continue;
      const group = still.filter((b) => !used.has(b.id) && Math.hypot(a.p[0] - b.p[0], a.p[2] - b.p[2]) < 4);
      if (group.length < 2) continue;
      for (const g of group) used.add(g.id);
      const c = group.reduce((s, g) => [s[0] + g.p[0] / group.length, s[1] + g.p[1] / group.length, s[2] + g.p[2] / group.length], [0, 0, 0]);
      const key = group.map((g) => g.id).sort().join('+');
      out.push({ id: `res:chatter:${key}`, source: 'resident', state: { size: group.length }, area: false, pts: [[c[0], c[1] + 1.5, c[2]]], spec: { kind: 'chatter', radius: 22, volume: Math.min(0.3, 0.12 + 0.05 * group.length), variant: variantOf('chatter', key) } });
    }
    // the visitor's own feet: eye height above ground and moving at a walk
    const prev = this.cam, dt = prev ? t - prev.t : 0, cp = [cam.x, cam.y, cam.z] as const;
    const speed = prev && dt > 0.05 ? Math.hypot(cam.x - prev.p[0], cam.z - prev.p[2]) / dt : prev?.speed ?? 0;
    if (!prev || dt > 0.05) this.cam = { p: cp, t, speed };
    const low = cam.ground !== null && cam.y - cam.ground < 2.6;
    if (low && speed > 0.6 && speed < 7) out.push({ id: 'me:steps', source: 'visitor', state: { speed }, area: false, pts: [[cam.x, cam.ground!, cam.z]], spec: { kind: 'footsteps', radius: 6, volume: 0.18, variant: 1 } });
    return out;
  }
}

// ---------------------------------------------------------------- the listener's settings

export type SoundSettings = { muted: boolean; volume: number; music: boolean };
export const SETTINGS_KEY = 'sim.sound.v1';
export const DEFAULT_SETTINGS: SoundSettings = Object.freeze({ muted: false, volume: MASTER_DEFAULT, music: false });
type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void } | null | undefined;
export function loadSettings(store: Store): SoundSettings {
  try {
    const raw = store?.getItem(SETTINGS_KEY); if (!raw) return { ...DEFAULT_SETTINGS };
    const s = JSON.parse(raw) as Partial<SoundSettings>;
    return { muted: s.muted === true, volume: Math.max(0, Math.min(1, num(s.volume, MASTER_DEFAULT))), music: s.music === true };
  } catch { return { ...DEFAULT_SETTINGS }; }
}
export function saveSettings(store: Store, s: SoundSettings) { try { store?.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* private window */ } }
