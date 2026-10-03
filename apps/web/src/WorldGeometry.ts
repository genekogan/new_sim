// Static parts of the live world view: the camp's ground, walls and stairs straight from the engine's
// SpatialScene (doors are the gaps the engine leaves), optional decorative building GLBs, the daylight
// that follows the world clock, and the small pure helpers the live view uses to pick recorded chunks
// and keep the rewind buffer bounded. Nothing here runs the engine.
import * as THREE from 'three';
import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Link, Obstacle, SpatialScene } from '../../../mars/viewer/engine/spatial/types.ts';
import type { KinPlacement } from '../../../mars/viewer/app/engine-view/floaters.ts';
import type { Take } from '../../../mars/viewer/engine/take/types.ts';
import { solarPosition } from '../../../mars/viewer/engine/env/sun.ts';
import { daylightFactors } from '../../../mars/viewer/engine/env/daylight.ts';

// ------------------------------------------------------------------ wire shapes
export type Chunk = { fromTick: number; toTick: number; take: Take };
export type RawChunk = { fromTick: number; toTick: number; take: unknown };
/** What the server streams over the socket (useSim keeps the latest). `receivedAt` is performance.now(). */
export type LiveTakes = { serverTick: number; chunks: RawChunk[]; receivedAt: number };
export type BuildingPlacement = { file: string; p: [number, number, number]; yaw?: number };
export type SceneInfo = { scene: SpatialScene | null; buildings: BuildingPlacement[]; kin: KinPlacement[] };

const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const obj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const vec3 = (x: unknown): x is [number, number, number] => Array.isArray(x) && x.length === 3 && x.every(num);

/** Enough of a recorded take to replay without throwing in the render loop. */
export function isTake(x: unknown): x is Take {
  if (!obj(x)) return false;
  return num(x.startTick) && num(x.ticks) && num(x.dt) && x.dt > 0 && obj(x.tracks) && Array.isArray(x.changes) && obj(x.finalState) && obj((x.finalState as Record<string, unknown>).entities);
}

/** Chunks that can be drawn, sorted by start tick, one per start tick. Malformed ones are dropped. */
export function validChunks(list: unknown): Chunk[] {
  if (!Array.isArray(list)) return [];
  const byStart = new Map<number, Chunk>();
  for (const c of list) if (obj(c) && num(c.fromTick) && num(c.toTick) && c.toTick >= c.fromTick && isTake(c.take)) byStart.set(c.fromTick, c as Chunk);
  return [...byStart.values()].sort((a, b) => a.fromTick - b.fromTick);
}

/** GET /v1/scene. Anything malformed is left out rather than breaking the view. */
export function parseSceneInfo(x: unknown): SceneInfo {
  const o = obj(x) ? x : {};
  const s = o.scene;
  const scene = obj(s) && Array.isArray(s.bounds) && s.bounds.length === 4 && s.bounds.every(num)
    ? ({ bounds: s.bounds, levels: Array.isArray(s.levels) ? s.levels : [], surfaces: Array.isArray(s.surfaces) ? s.surfaces : [], obstacles: Array.isArray(s.obstacles) ? s.obstacles : [], links: Array.isArray(s.links) ? s.links : [] } as SpatialScene)
    : null;
  const buildings = (Array.isArray(o.buildings) ? o.buildings : []).filter((b): b is BuildingPlacement => obj(b) && typeof b.file === 'string' && vec3(b.p) && (b.yaw === undefined || num(b.yaw)));
  const kin = (Array.isArray(o.kin) ? o.kin : []).filter((k): k is KinPlacement => obj(k) && typeof k.model === 'string' && vec3(k.p));
  return { scene, buildings, kin };
}

/** URL of a decorative building GLB, or null for a name that is not a plain file name. */
export function buildingUrl(file: string): string | null {
  const name = file.replace(/\.glb$/, '');
  return /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(name) ? `/world-assets/littlemartians/buildings/${name}.glb` : null;
}

// ------------------------------------------------------------------ chunks and the rewind window
/** The chunk covering `tick`, else the nearest one before it (a gap), else the first. */
export function chunkAt(chunks: readonly Chunk[], tick: number): { chunk: Chunk; exact: boolean } | null {
  if (!chunks.length) return null;
  let before: Chunk | null = null;
  for (const c of chunks) {
    if (c.fromTick <= tick && tick <= c.toTick) return { chunk: c, exact: true };
    if (c.toTick < tick) before = c;
  }
  return { chunk: before ?? chunks[0], exact: false };
}

/** Rewind buffer limit: chunks kept in memory around the moment being watched. */
export const MAX_PAST_CHUNKS = 120;

/** Merge newly fetched chunks into the buffer, keeping at most `max` around `centre` (a little history behind it). */
export function mergeWindow(buffer: readonly Chunk[], incoming: readonly Chunk[], centre: number, max = MAX_PAST_CHUNKS): Chunk[] {
  const all = validChunks([...buffer, ...incoming]);
  if (all.length <= max) return all;
  let at = all.findIndex((c) => c.toTick >= centre);
  if (at < 0) at = all.length - 1;
  const start = Math.max(0, Math.min(all.length - max, at - 10));
  return all.slice(start, start + max);
}

/** Ticks to fetch around a chosen moment: a little before it, the rest after, so playback can run on. */
export function rewindWindow(tick: number, ticksPerSecond: number): { from: number; to: number } {
  return { from: Math.max(0, Math.floor(tick - 10 * ticksPerSecond)), to: Math.ceil(tick + 110 * ticksPerSecond) };
}

// ------------------------------------------------------------------ words and time
/** A naive local ISO datetime moved by `seconds` (the world clock has no time zone). Bad input comes back unchanged. */
export function shiftIso(iso: string, seconds: number): string {
  const d = new Date(`${iso.slice(0, 19)}Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Date(d.getTime() + Math.round(seconds * 1000)).toISOString().slice(0, 19);
}
export const clockText = (iso: string | null) => (iso && /T\d\d:\d\d/.test(iso) ? iso.slice(11, 16) : '');
export function agoText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s ago`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min ${String(s % 60).padStart(2, '0')} s ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`;
}
/** 'dining-bench' / 'walk_to' → 'dining bench' / 'walk to'. */
export const plainWords = (s: string | undefined | null) => (s ?? '').replace(/^mars:/, '').replace(/[-_]+/g, ' ').trim();

/** The named place (room, yard, pile) a ground point lies in, if any. */
export function placeOf(p: readonly number[], regions: Record<string, { label?: string; kind?: string; polygon?: [number, number][] }> | undefined): string | null {
  if (!regions) return null;
  let best: { label: string; area: number } | null = null;
  for (const r of Object.values(regions)) {
    const poly = r.polygon;
    if (!r.label || !Array.isArray(poly) || poly.length < 3 || r.kind === 'no-go') continue;
    let inside = false, area = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i], [xj, zj] = poly[j];
      if (zi > p[2] !== zj > p[2] && p[0] < ((xj - xi) * (p[2] - zi)) / (zj - zi) + xi) inside = !inside;
      area += (xj + xi) * (zj - zi);
    }
    // the smallest containing region wins (a mat inside the bunk house, a corner inside the living room)
    if (inside && (!best || Math.abs(area) < best.area)) best = { label: r.label, area: Math.abs(area) };
  }
  return best?.label ?? null;
}

// ------------------------------------------------------------------ static geometry
const unit = new THREE.BoxGeometry(1, 1, 1);

function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    if (o.geometry !== unit) o.geometry.dispose();
    for (const m of [o.material].flat() as THREE.Material[]) {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose();
      m.dispose();
    }
  });
}

/**
 * Ground, walls and stairs of the world's SpatialScene. When decorative buildings are supplied, the
 * engine prisms they stand on are hidden once the building has loaded (they stay if it fails, so the
 * real geometry is never lost).
 */
export class WorldGeometry {
  readonly group = new THREE.Group();
  private readonly materials = {
    outside: new THREE.MeshStandardMaterial({ color: '#b39b78', roughness: 1 }),
    floor: new THREE.MeshStandardMaterial({ color: '#c6b08b', roughness: 1 }),
    deck: new THREE.MeshStandardMaterial({ color: '#a8835a', roughness: 0.9 }),
    wall: new THREE.MeshStandardMaterial({ color: '#e3d6bd', roughness: 0.9 }),
    solid: new THREE.MeshStandardMaterial({ color: '#9c7a52', roughness: 0.85 }),
    glass: new THREE.MeshStandardMaterial({ color: '#9fc4d8', roughness: 0.1, transparent: true, opacity: 0.35 }),
    tread: new THREE.MeshStandardMaterial({ color: '#a8835a', roughness: 0.85 }),
  };
  private readonly prisms: THREE.Mesh[] = [];
  private readonly buildings = new THREE.Group();
  private disposed = false;
  /** Ground rectangle [minX, minZ, maxX, maxZ] that the camera frames. */
  readonly bounds: [number, number, number, number];

  constructor(scene: SpatialScene | null) {
    this.group.name = 'camp';
    this.buildings.name = 'buildings';
    this.group.add(this.buildings);
    this.bounds = scene?.bounds ?? [-20, -20, 20, 20];
    const [x0, z0, x1, z1] = this.bounds;
    const outside = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 + 160, z1 - z0 + 160), this.materials.outside);
    outside.rotation.x = -Math.PI / 2;
    outside.position.set((x0 + x1) / 2, -0.02, (z0 + z1) / 2);
    outside.receiveShadow = true;
    this.group.add(outside);
    if (!scene) return;
    for (const s of scene.surfaces) {
      const w = s.obb.half[0] * 2, d = s.obb.half[1] * 2;
      if (s.y <= 0.05) {
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), this.materials.floor);
        floor.rotation.set(-Math.PI / 2, 0, s.obb.yaw);
        floor.position.set(s.obb.c[0], s.y - 0.01, s.obb.c[1]);
        floor.receiveShadow = true;
        this.group.add(floor);
      } else this.group.add(this.box(this.materials.deck, s.obb.c[0], s.y - 0.08, s.obb.c[1], w, 0.08, d, s.obb.yaw));
    }
    const linkBodies = new Set(scene.links.map((l) => `${l.id}-body`));
    for (const o of scene.obstacles) {
      // fixtures, parts and vehicles are entities, drawn from the recording
      if (linkBodies.has(o.id) || o.kind === 'fixture' || o.kind === 'component' || o.kind === 'vehicle') continue;
      const m = this.prism(o);
      this.prisms.push(m);
      this.group.add(m);
    }
    for (const l of scene.links) if (l.kind === 'stairs' && l.path.length > 1) this.group.add(this.stairs(l));
  }

  private box(mat: THREE.Material, cx: number, y0: number, cz: number, sx: number, sy: number, sz: number, yaw = 0) {
    const m = new THREE.Mesh(unit, mat);
    m.scale.set(sx, sy, sz);
    m.position.set(cx, y0 + sy / 2, cz);
    m.rotation.y = -yaw; // engine yaw turns +x toward +z; three's rotation.y turns the other way
    m.castShadow = m.receiveShadow = true;
    return m;
  }

  private prism(o: Obstacle) {
    const mat = o.kind === 'glass' ? this.materials.glass : o.kind === 'wall' || o.kind === undefined ? this.materials.wall : this.materials.solid;
    const m = this.box(mat, o.obb.c[0], o.y0, o.obb.c[1], o.obb.half[0] * 2, Math.max(0.02, o.y1 - o.y0), o.obb.half[1] * 2, o.obb.yaw);
    m.name = `scene:${o.id}`;
    return m;
  }

  private stairs(link: Link) {
    const g = new THREE.Group();
    const p = link.path, n = p.length - 1;
    const dx = p[n][0] - p[0][0], dz = p[n][2] - p[0][2];
    const run = Math.hypot(dx, dz) / n, yaw = Math.atan2(dz, dx);
    for (let i = 1; i <= n; i++) g.add(this.box(this.materials.tread, p[i][0], p[i][1] - 0.05, p[i][2], run + 0.02, 0.05, link.width, yaw));
    return g;
  }

  /**
   * Load decorative buildings (static, positioned by the world). Resolves with the files that could not be
   * shown; their engine walls stay visible instead.
   */
  async addBuildings(list: readonly BuildingPlacement[], loader: GLTFLoader): Promise<string[]> {
    const failed: string[] = [];
    await Promise.all(list.map(async (b) => {
      const url = buildingUrl(b.file);
      if (!url) { failed.push(b.file); return; }
      try {
        const gltf = await loader.loadAsync(url);
        if (this.disposed) { disposeTree(gltf.scene); return; }
        const root = gltf.scene;
        root.name = `building:${b.file}`;
        root.position.set(b.p[0], b.p[1], b.p[2]);
        root.rotation.y = -(b.yaw ?? 0);
        root.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true; });
        this.buildings.add(root);
        root.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(root).expandByVector(new THREE.Vector3(0.25, 0, 0.25));
        const at = new THREE.Vector3();
        for (const m of this.prisms) {
          at.set(m.position.x, box.min.y + 0.01, m.position.z);
          if (box.containsPoint(at)) m.visible = false; // the building shows these walls itself
        }
      } catch (e) {
        console.warn(`building ${b.file} could not be loaded; showing its plain walls`, e);
        failed.push(b.file);
      }
    }));
    return failed;
  }

  dispose() {
    this.disposed = true;
    disposeTree(this.buildings);
    this.group.removeFromParent();
    this.group.traverse((o) => { if (o instanceof THREE.Mesh && o.geometry !== unit) o.geometry.dispose(); });
    for (const m of Object.values(this.materials)) m.dispose();
  }
}

// ------------------------------------------------------------------ daylight
const DAY_SKY = new THREE.Color('#a6bed0'), NIGHT_SKY = new THREE.Color('#121a2b'), DUSK_SKY = new THREE.Color('#d99a6c');
const SUN_WHITE = new THREE.Color('#fff2dc'), SUN_WARM = new THREE.Color('#ffb36b');

/** Sky colour, sun and fill light for the world clock (Bombay Beach sun, the engine's own solar model). */
export class Daylight {
  readonly hemi = new THREE.HemisphereLight(0xffffff, 0x5b5040, 1.6);
  readonly sun = new THREE.DirectionalLight(0xffffff, 2);
  private key = '';
  /** Sun elevation in degrees at the last update (null before the first). */
  elevation: number | null = null;

  private readonly scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.normalBias = 0.05;
    scene.add(this.hemi, this.sun, this.sun.target);
    scene.background = DAY_SKY.clone();
    this.fit([-20, -20, 20, 20]);
  }

  /** Aim the sun's shadows at the ground rectangle being shown. */
  fit([x0, z0, x1, z1]: readonly [number, number, number, number]) {
    const half = Math.max(20, Math.max(x1 - x0, z1 - z0) * 0.75);
    Object.assign(this.sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 300 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.target.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const key = this.key;
    this.key = '';
    this.update(key === 'none' || !key ? null : `${key}:00`);
  }

  /** Recompute from a naive local datetime; cheap to call every frame (works only when the minute changes). */
  update(datetime: string | null) {
    const key = datetime?.slice(0, 16) ?? 'none';
    if (key === this.key) return;
    this.key = key;
    if (!datetime) { // no clock yet: a soft midday so the camp reads
      this.sun.position.copy(this.sun.target.position).add(new THREE.Vector3(20, 35, 15));
      this.sun.intensity = 2; this.hemi.intensity = 1.6; this.sun.color.copy(SUN_WHITE);
      (this.scene.background as THREE.Color).copy(DAY_SKY);
      this.elevation = null;
      return;
    }
    let pos;
    try { pos = solarPosition(datetime); } catch { return; }
    const f = daylightFactors(pos.elevationDeg);
    const dir = new THREE.Vector3(...pos.direction);
    if (dir.y < 0.05) dir.y = 0.05; // below the horizon: keep the shadow camera sane; intensity goes to ~0 anyway
    this.sun.position.copy(this.sun.target.position).addScaledVector(dir.normalize(), 80);
    this.sun.intensity = 2.6 * f.daylight;
    this.sun.color.copy(SUN_WHITE).lerp(SUN_WARM, f.warmth * 0.7);
    // night stays readable: a moonlit fill rather than black
    this.hemi.intensity = 0.75 + 0.95 * f.daylight;
    this.hemi.color.set(f.daylight > 0.5 ? 0xffffff : 0x9fb3d9);
    (this.scene.background as THREE.Color).copy(NIGHT_SKY).lerp(DUSK_SKY, Math.max(f.warmth * f.daylight, f.blueHour * 0.4)).lerp(DAY_SKY, f.daylight * (1 - f.warmth * 0.6));
    this.elevation = pos.elevationDeg;
  }

  dispose() {
    this.sun.shadow.dispose();
    this.scene.remove(this.hemi, this.sun, this.sun.target);
  }
}
