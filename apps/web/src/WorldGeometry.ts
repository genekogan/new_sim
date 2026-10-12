import {parseBackdropHide,applyBackdropVisibility,type BackdropHide} from './WorldBackdropVisibility.ts';
// Static parts of the live world view: the camp's ground, walls and stairs straight from the engine's
// SpatialScene (doors are the gaps the engine leaves), optional decorative building GLBs, the daylight
// that follows the world clock, and the small pure helpers the live view uses to pick recorded chunks
// and keep the rewind buffer bounded. Nothing here runs the engine.
import * as THREE from 'three';
import {ownedLiveChunk} from './owned-live-chunks.ts';
import {parsePlatformFloors,type PlatformFloor} from '../../../mars/viewer/lib/platform-floor.ts';
import {parseWorldShore,type WorldShore} from './WorldShore.ts';
import {createConnectedNativeShore} from '../../../mars/viewer/app/engine-view/content/environment/connected-native-shore.ts';
import {shoreBankEdgePositions} from './WorldShoreBankEdges.ts';
import {groundOutsideTerrain,type GroundRectangle} from './WorldGround.ts';
import {createCapturedShoreEnvironment,type CapturedShoreView} from '../../../mars/viewer/app/engine-view/content/environment/captured-shore.ts';
import { commonsSceneMetadataV1Schema, type CommonsSceneMetadataV1 } from '@sim/engine-contract';
import { authoredCommons, commonsFixtureAtRoot } from './WorldCommons.ts';
import type { SampledEntity } from '../../../mars/viewer/engine/take/replay.ts';
import { createEdenCommonsEnvironment, type ContentView } from '../../../mars/viewer/app/engine-view/content/environment/commons.ts';
import { createCommonsPaths } from '../../../mars/viewer/app/engine-view/content/environment/commons-paths.ts';
import { createCommonsMeadow } from '../../../mars/viewer/app/engine-view/content/environment/commons-meadow.ts';
import { createPavilionVines } from '../../../mars/viewer/app/engine-view/content/assets/pavilion-vines.ts';
import { recordedTakeSchema, recordedTakeChunkSchema } from '@sim/protocol';
import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {StaticRootRegistry} from './rendering/StaticRootRegistry.ts';
import {dequantizeBackdrop} from './WorldBackdropDequantize.ts';
import {backdropCandidates} from './mars-fork.ts';
/** Lane BLOBS: legacy backdrop URL (pinned in the server's scene) -> the same campus re-encoded smaller (quantized +
 * WebP + meshopt filters; tools/blobs/shrink-campus.mjs, checked by tools/blobs/compare-campus.mjs), content-addressed
 * and immutable at /blobs/assets/<sha[0:2]>/<sha>.glb on sim.eden.art. */
export const BACKDROP_BLOBS:Readonly<Record<string,string>>=Object.freeze({
  '/browser/campus.glb?v=20260922b':'/blobs/assets/64/64b8838cdc76a048843ab293f3d74ad985293ad621ea7587e092098117bd1034.glb',
});
import type { Link, Obstacle, SpatialScene } from '../../../mars/viewer/engine/spatial/types.ts';
import type { KinPlacement } from '../../../mars/viewer/app/engine-view/floaters.ts';
import type { Take } from '../../../mars/viewer/engine/take/types.ts';
import { solarPosition } from '../../../mars/viewer/engine/env/sun.ts';
import { siteNorthOffset } from './site-north.ts';
import {createEdenDaylight} from './atmosphere/visual-transitions.ts';
import { daylightFactors } from '../../../mars/viewer/engine/env/daylight.ts';
import { fitNearPlane } from '../../../mars/viewer/lib/depth-fit.ts';
import { isMarsCamp, MarsDesert } from './WorldMarsDesert.ts';

// ------------------------------------------------------------------ wire shapes
export type Chunk = { fromTick: number; toTick: number; take: Take };
export type RawChunk = { fromTick: number; toTick: number; take: unknown };
/** What the server streams over the socket (useSim keeps the latest). `receivedAt` is performance.now(). */
export type LiveTakes = { serverTick: number; chunks: RawChunk[]; receivedAt: number };
export type BuildingPlacement = { file: string; p: [number, number, number]; yaw?: number;scale?:number|[number,number,number] };
export type MarsBackdrop={contract:'mars-campus-backdrop/1';url:string;at:[number,number,number];hide?:BackdropHide};
export type SceneInfo = { scene: SpatialScene | null; buildings: BuildingPlacement[]; kin: KinPlacement[]; backdrop?:MarsBackdrop;assetRoot?:string;platforms?:PlatformFloor[]; clock?: { origin: number; dayTicks: number } | null; ground?: 'grass'; commons?: CommonsSceneMetadataV1; shore?:WorldShore };

const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const obj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const vec3 = (x: unknown): x is [number, number, number] => Array.isArray(x) && x.length === 3 && x.every(num);

/** Enough of a recorded take to replay without throwing in the render loop. */
export function isTake(x: unknown): x is Take {
  return recordedTakeSchema.safeParse(x).success;
}

/** Chunks that can be drawn, sorted by start tick, one per start tick. Malformed ones are dropped. */
export function validChunks(list: unknown): Chunk[] {
  if (!Array.isArray(list)) return [];
  const byStart = new Map<number, Chunk>();
  for (const raw of list) {
    const retained=ownedLiveChunk(raw);
    if(retained){byStart.set(retained.fromTick,retained as unknown as Chunk);continue;}
    const parsed = recordedTakeChunkSchema.safeParse(raw);
    if (parsed.success) byStart.set(parsed.data.fromTick, parsed.data as unknown as Chunk);
  }
  return [...byStart.values()].sort((a, b) => a.fromTick - b.fromTick);
}

// Defensive renderer decoding only; these checks do not establish physical validity.
const vec2 = (x: unknown): x is [number, number] => Array.isArray(x) && x.length === 2 && x.every(num);
const id = (x: unknown): x is string => typeof x === 'string' && x.length > 0;
const obb = (x: unknown) => obj(x) && vec2(x.c) && vec2(x.half) && x.half.every(n => n > 0) && num(x.yaw);
const endpoint = (x: unknown) => obj(x) && num(x.level) && vec2(x.p) && num(x.y);
const surface = (x: unknown): x is SpatialScene['surfaces'][number] => obj(x) && id(x.id) && num(x.level) && num(x.y) && obb(x.obb);
const obstacle = (x: unknown): x is Obstacle => obj(x) && id(x.id) && obb(x.obb) && num(x.y0) && num(x.y1) && x.y1 >= x.y0 && (x.kind === undefined || ['wall','solid','glass','component','vehicle','fixture'].includes(String(x.kind)));
const link = (x: unknown): x is Link => obj(x) && id(x.id) && ['stairs','ladder','ramp','climb','beam'].includes(String(x.kind)) && endpoint(x.from) && endpoint(x.to) && num(x.width) && x.width > 0 && num(x.heading) && typeof x.usable === 'boolean' && Array.isArray(x.path) && x.path.every(vec3);
const level = (x: unknown): x is SpatialScene['levels'][number] => obj(x) && num(x.id) && num(x.y) && (x.label === undefined || typeof x.label === 'string');
const entries = <T,>(x: unknown, accepts: (entry: unknown) => entry is T): T[] => Array.isArray(x) ? x.filter(accepts) : [];

/** GET /v1/scene. Malformed render entries are omitted, never repaired into supports. */
export function parseSceneInfo(x: unknown): SceneInfo {
  const o = obj(x) ? x : {};
  const s = o.scene;
  const scene = obj(s) && Array.isArray(s.bounds) && s.bounds.length === 4 && s.bounds.every(num) && s.bounds[0] < s.bounds[2] && s.bounds[1] < s.bounds[3]
    ? { bounds: s.bounds as SpatialScene['bounds'], levels: entries(s.levels, level), surfaces: entries(s.surfaces, surface), obstacles: entries(s.obstacles, obstacle), links: entries(s.links, link) }
    : null;
  const assetRoot=typeof o.assetRoot==='string'?o.assetRoot:obj(o.worldmeta)&&typeof o.worldmeta.assetRoot==='string'?o.worldmeta.assetRoot:undefined;
  const safeRoot=assetRoot&&/^\/world-assets\/[a-z0-9][a-z0-9_-]{0,63}$/.test(assetRoot)?assetRoot:undefined;
  const buildings = (Array.isArray(o.buildings) ? o.buildings : []).filter((b): b is BuildingPlacement => obj(b) && typeof b.file === 'string' && vec3(b.p) && (b.yaw === undefined || num(b.yaw))&&(b.scale===undefined||num(b.scale)&&b.scale>0&&b.scale<=100||vec3(b.scale)&&b.scale.every(x=>x>0&&x<=100)));
  const kin = (Array.isArray(o.kin) ? o.kin : []).filter((k): k is KinPlacement => obj(k) && typeof k.model === 'string' && vec3(k.p));
  const clock = obj(o.clock) && num(o.clock.origin) && num(o.clock.dayTicks) && o.clock.dayTicks > 0 ? { origin: o.clock.origin, dayTicks: o.clock.dayTicks } : null;
  const commons=obj(s)?commonsSceneMetadataV1Schema.safeParse(s.commons):null;
  const b=obj(s)?s.backdrop:null;
  const backdrop=obj(b)&&b.contract==='mars-campus-backdrop/1'&&typeof b.url==='string'&&/^\/browser\/campus\.glb(?:\?[a-zA-Z0-9=._-]+)?$/.test(b.url)&&vec3(b.at)?{contract:b.contract,url:b.url,at:b.at,hide:parseBackdropHide(b.hide)} as MarsBackdrop:undefined;
  const platforms=obj(s)&&Array.isArray(s.platforms)?parsePlatformFloors(s.platforms):undefined;
  return { scene, buildings, kin, backdrop,assetRoot:safeRoot,...(platforms?{platforms}:{}),clock,ground:o.ground==='grass'?'grass':undefined, commons:commons?.success?commons.data:undefined, ...(o.shore===undefined?{}:{shore:parseWorldShore(o.shore,scene)}) };
}

/** URL of a decorative building GLB, or null for a name that is not a plain file name. */
export function buildingUrl(file: string,assetRoot='/world-assets/littlemartians'): string | null {
  const name = file.replace(/\.glb$/, '');
  return /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(name)&&/^\/world-assets\/[a-z0-9][a-z0-9_-]{0,63}$/.test(assetRoot)?`${assetRoot}/buildings/${name}.glb`:null;
}

// ------------------------------------------------------------------ chunks and the rewind window
/** Latest-start chunk covering `tick` (the new era owns a shared endpoint),
 * else the nearest one before it (a gap), else the first. */
export function chunkAt(chunks: readonly Chunk[], tick: number): { chunk: Chunk; exact: boolean } | null {
  if (!chunks.length) return null;
  let before: Chunk | null = null, covering: Chunk | null = null;
  for (const c of chunks) {
    if (c.fromTick <= tick && tick <= c.toTick && (!covering || c.fromTick > covering.fromTick)) covering = c;
    if (c.toTick < tick && (!before || c.toTick > before.toTick)) before = c;
  }
  if (covering) return { chunk: covering, exact: true };
  return { chunk: before ?? chunks[0], exact: false };
}

/** A held gap frame depicts a recorded endpoint, never the missing requested tick. */
export const recordingTick = (chunk: Chunk, wanted: number) => Math.max(chunk.fromTick, Math.min(chunk.toTick, wanted));

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
export function shiftIso(iso: string, seconds: number, subsecond=false): string {
  const base=subsecond ? iso.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?/)?.[0]??iso.slice(0,19) : iso.slice(0,19);
  const d = new Date(`${base}Z`);
  if (Number.isNaN(d.getTime())||!Number.isFinite(seconds)) return iso;
  return new Date(d.getTime() + Math.round(seconds * 1000)).toISOString().slice(0, subsecond?23:19);
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
    bank: new THREE.MeshStandardMaterial({color:'#b39b78',roughness:1,side:THREE.DoubleSide,forceSinglePass:true}),
    floor: new THREE.MeshStandardMaterial({ color: '#c6b08b', roughness: 1 }),
    deck: new THREE.MeshStandardMaterial({ color: '#a8835a', roughness: 0.9 }),
    wall: new THREE.MeshStandardMaterial({ color: '#e3d6bd', roughness: 0.9 }),
    solid: new THREE.MeshStandardMaterial({ color: '#9c7a52', roughness: 0.85 }),
    glass: new THREE.MeshStandardMaterial({ color: '#9fc4d8', roughness: 0.1, transparent: true, opacity: 0.35 }),
    tread: new THREE.MeshStandardMaterial({ color: '#a8835a', roughness: 0.85 }),
  };
  private readonly prisms: THREE.Mesh[] = [];
  private readonly buildings = new THREE.Group();
  private readonly staticRoots=new StaticRootRegistry(this.group);
  staticRenderRoots(){return this.staticRoots.roots();}
  get staticRenderRevision(){return this.staticRoots.revision;}
  private disposed = false;
  private desert?: MarsDesert;
  private commons:CommonsSceneMetadataV1|null=null;
  /** Only the exact reviewed native commons gets its optional observer presentation. */
  get hasAuthoredCommons(){return !this.disposed&&this.commons!==null;}
  private scenery:ContentView[]=[];
  private shore:CapturedShoreView|null=null;
  private vines:ContentView|null=null;
  private replacements=new Map<THREE.Mesh,string>();
  /** Ground rectangle [minX, minZ, maxX, maxZ] that the camera frames. */
  readonly bounds: [number, number, number, number];

  constructor(scene: SpatialScene | null, ground?:'grass', commons?:CommonsSceneMetadataV1, shore?:WorldShore,private assetRoot='/world-assets/littlemartians') {
    if(ground==='grass'){this.materials.floor.color.set('#76a454');this.materials.outside.color.set('#639844');}
    this.group.name = 'camp';
    this.buildings.name = 'buildings';
    this.group.add(this.buildings);
    this.bounds = scene?.bounds ?? [-20, -20, 20, 20];
    if(shore){
      const {metadata,appearance}=shore;
      this.shore=shore.profile==='connected-commons-shore/1'?createConnectedNativeShore(metadata.terrain,metadata.water):createCapturedShoreEnvironment(metadata.terrain,metadata.water,appearance);
      // Transparent water is visible scenery, not a wall for camera sightlines.
      this.shore.group.traverse(o=>{if(o.name===metadata.water.id)o.userData.cameraTransparent=true;});
      this.group.add(this.shore.group);
      if(shore.profile!=='connected-commons-shore/1')return; // Isolated shore has no commons.
    }
    const [x0, z0, x1, z1] = this.bounds;
    const terrainRectangle:GroundRectangle|undefined=shore?.profile==='connected-commons-shore/1'?[-62,-12,-28,12]:undefined;
    const groundPlanes=(rectangle:GroundRectangle,y:number,material:THREE.Material,name:string)=>{
      for(const [a,b,c,d] of terrainRectangle?groundOutsideTerrain(rectangle,terrainRectangle):[rectangle]){
        const plane=new THREE.Mesh(new THREE.PlaneGeometry(c-a,d-b),material);
        plane.rotation.x=-Math.PI/2;plane.position.set((a+c)/2,y,(b+d)/2);
        plane.name=name;plane.receiveShadow=true;this.group.add(plane);
      }
    };
    // The backdrop follows the supplied ground level so it cannot cover a
    // lower native floor. Body roots and authoritative surfaces stay untouched.
    const backdropY=(scene?.levels.find(level=>level.id===0)?.y??0)-.02;
    groundPlanes([x0-80,z0-80,x1+80,z1+80],backdropY,this.materials.outside,'outside-ground');
    if(shore?.profile==='connected-commons-shore/1'){
      const edge=new THREE.BufferGeometry();edge.setAttribute('position',new THREE.Float32BufferAttribute(shoreBankEdgePositions(shore.metadata.terrain,backdropY),3));edge.computeVertexNormals();
      const banks=new THREE.Mesh(edge,this.materials.bank);banks.name='Captured shore north/south visual bank edge closure (no support)';banks.userData.cameraTransparent=true;
      // Both banks must be readable from water and land without a duplicated mesh.
      this.group.add(banks);
    }
    if (!scene) return;
    this.commons=authoredCommons(scene,commons);
    if(this.commons){
      this.scenery=[createEdenCommonsEnvironment(()=>0),createCommonsPaths(),createCommonsMeadow(()=>0)];
      for(const view of this.scenery)this.group.add(view.group);
      this.vines=createPavilionVines();this.vines.group.position.set(9,0,-5);this.vines.group.visible=false;this.group.add(this.vines.group);
    }
    for (const s of scene.surfaces) {
      const w = s.obb.half[0] * 2, d = s.obb.half[1] * 2;
      if (s.y <= 0.05) {
        if(terrainRectangle){
          // The approved combined scene has one axis-aligned native ground surface.
          // Only visual planes are partitioned; Core's complete OBB stays unchanged.
          if(s.obb.yaw!==0)throw Error('Unsupported rotated connected ground');
          groundPlanes([s.obb.c[0]-w/2,s.obb.c[1]-d/2,s.obb.c[0]+w/2,s.obb.c[1]+d/2],s.y-.01,this.materials.floor,'commons-ground');
        }else{
          const floor = new THREE.Mesh(new THREE.PlaneGeometry(w,d),this.materials.floor);
          floor.rotation.set(-Math.PI/2,0,s.obb.yaw);floor.position.set(s.obb.c[0],s.y-.01,s.obb.c[1]);
          floor.receiveShadow=true;this.group.add(floor);
        }
      } else {const deck=this.box(this.materials.deck, s.obb.c[0], s.y - 0.08, s.obb.c[1], w, 0.08, d, s.obb.yaw);this.prisms.push(deck);this.group.add(deck);if(this.commons&&s.id==='commons-deck')this.replacements.set(deck,'commons-platform');}
    }
    const linkBodies = new Set(scene.links.map((l) => `${l.id}-body`));
    for (const o of scene.obstacles) {
      // fixtures, parts and vehicles are entities, drawn from the recording
      if (linkBodies.has(o.id) || o.kind === 'fixture' || o.kind === 'component' || o.kind === 'vehicle') continue;
      const m = this.prism(o);
      this.prisms.push(m);
      this.group.add(m);
      if(this.commons)this.replacements.set(m,o.id==='commons-platform-solid'?'commons-platform':'commons-pavilion');
    }
    for (const l of scene.links) if (l.kind === 'stairs' && l.path.length > 1) this.group.add(this.stairs(l));
    // Mars only: the desert around the camp, outside its walkable ground (WorldMarsDesert.ts; Mars lane PM-R047)
    if (ground !== 'grass' && isMarsCamp(scene)) { this.desert = new MarsDesert(scene); this.group.add(this.desert.group); }
  }

  setAssetRoot(assetRoot:string){if(/^\/world-assets\/[a-z0-9][a-z0-9_-]{0,63}$/.test(assetRoot))this.assetRoot=assetRoot;}

  /** Plain campus walls hide only after the authored mesh loads; navigation remains authoritative. */
  async addBackdrop(backdrop:MarsBackdrop,loader:GLTFLoader,onProgress?:(url:string,event:ProgressEvent)=>void):Promise<boolean>{
    try{const urls=backdropCandidates(backdrop.url,BACKDROP_BLOBS[backdrop.url]);let gltf;
      // lane BLOBS: the smaller hashed copy on eden2; the legacy name is the fallback (local dev has no /blobs)
      // MARSLAND-FORK: the Mars fork tries its corrected campus first (mars-fork.ts)
      for(const url of urls.slice(0,-1)){try{gltf=await loader.loadAsync(url,event=>onProgress?.(url,event));break;}catch{gltf=undefined;}}
      gltf??=await loader.loadAsync(backdrop.url,event=>onProgress?.(backdrop.url,event));
      if(this.disposed){disposeTree(gltf.scene);return false;}const root=gltf.scene;dequantizeBackdrop(root);root.name='mars-campus-backdrop';root.position.fromArray(backdrop.at);applyBackdropVisibility(root,backdrop.hide);root.traverse(o=>{if(o instanceof THREE.Mesh)o.castShadow=o.receiveShadow=true;});this.buildings.add(root);this.staticRoots.register(root,gltf.animations);for(const m of this.prisms)if(m.name.startsWith('scene:campus:'))m.visible=false;return true;}catch{return false;}
  }

  /** Mars camp only: mark material piles and the build site once the recording supplies regions (WorldMarsDesert.ts). */
  markRegions(regions: Parameters<MarsDesert['markRegions']>[0]) { this.desert?.markRegions(regions); }

  /** Decorative water follows depicted recording time, including pause/seek. */
  setViewTime(seconds:number){if(!this.disposed&&this.shore&&Number.isFinite(seconds)&&seconds>=0)this.shore.setViewTime(seconds%86400);}

  /** Synchronize depiction to this sampled frame; never moves the native fixtures. */
  setRecordedFixtures(entities:Readonly<Record<string,SampledEntity>>,records:Readonly<Record<string,{def:string;kind:string}>>) {
    if(this.disposed||!this.commons)return;
    for(const [mesh,id] of this.replacements)mesh.visible=!commonsFixtureAtRoot(this.commons,id,entities,records);
    if(this.vines)this.vines.group.visible=commonsFixtureAtRoot(this.commons,'commons-pavilion',entities,records);
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
  async addBuildings(list: readonly BuildingPlacement[], loader: GLTFLoader,onProgress?:(url:string,event:ProgressEvent)=>void): Promise<string[]> {
    const failed: string[] = [];
    await Promise.all(list.map(async (b) => {
      const url = buildingUrl(b.file,this.assetRoot);
      if (!url) { failed.push(b.file); return; }
      try {
        const gltf = await loader.loadAsync(url,event=>onProgress?.(url,event));
        if (this.disposed) { disposeTree(gltf.scene); return; }
        const root = gltf.scene;
        root.name = `building:${b.file}`;
        root.position.set(b.p[0], b.p[1], b.p[2]);
        root.rotation.y = -(b.yaw ?? 0);
        if(typeof b.scale==='number')root.scale.multiplyScalar(b.scale);else if(b.scale)root.scale.multiply(new THREE.Vector3(...b.scale));
        root.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true; });
        this.buildings.add(root);
        this.staticRoots.register(root,gltf.animations);
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
    if(this.disposed)return;
    this.disposed = true;
    this.staticRoots.clear();
    this.desert?.dispose();
    this.shore?.dispose();this.shore=null;
    for(const view of this.scenery)view.dispose();this.scenery=[];
    this.vines?.dispose();this.vines=null;this.replacements.clear();
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
  /** Soft observer fill keeps bodies legible at night; it is not a second sun or a physical light source. */
  readonly fill = new THREE.DirectionalLight(0xb9cbea, 0.65);
  private key = '';
  private commonsReadability=false;
  private nightLighting=false;
  private readonly edenDaylight=createEdenDaylight();
  private daylightFactor:number|null=null;
  /** 0 at night .. 1 in full day; null before the first clock. */
  get daylight(){return this.daylightFactor;}
  /** With lamp/window light pools active, night drops to dim moonlight away from lights. */
  setNightLighting(enabled:boolean){
    if(this.nightLighting===enabled)return;
    this.nightLighting=enabled;this.key='';this.observerFill();
  }
  /** Presentation fill only: astronomical sun/time and physical light truth stay unchanged. */
  setCommonsReadability(enabled:boolean){
    if(this.commonsReadability===enabled)return;
    this.commonsReadability=enabled;this.observerFill();
  }
  private observerFill(){
    if(this.daylightFactor===null)return;
    const d=this.daylightFactor;
    if(this.nightLighting){
      // Same daytime fill; at night a dim blue moon instead of a bright observer fill.
      this.hemi.intensity=.3+((this.commonsReadability?1.70:1.70)-.3)*d;
      this.fill.intensity=.18*(1-d)+.2*d;
      return;
    }
    this.hemi.intensity=(this.commonsReadability?1.20:.75)+(this.commonsReadability ? .50 : .95)*d;
    this.fill.intensity=.2+(this.commonsReadability ? .7 : .45)*(1-d);
  }
  /** Sun elevation in degrees at the last update (null before the first). */
  elevation: number | null = null;

  private readonly scene: THREE.Scene;
  private readonly beforeRender: THREE.Object3D['onBeforeRender'];
  private readonly previousBeforeRender: THREE.Object3D['onBeforeRender'];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.normalBias = 0.05;
    this.fill.position.set(-12, 18, 12);
    scene.add(this.hemi, this.sun, this.sun.target, this.fill, this.fill.target);
    scene.background = DAY_SKY.clone();
    // Depth precision (flickering layered surfaces): fit every perspective camera's near plane to its height
    // above the ground just before the scene is drawn (lib/depth-fit.ts). Chained with any existing hook.
    const previous = this.previousBeforeRender = scene.onBeforeRender;
    this.beforeRender = function (this: THREE.Object3D, renderer, s, camera, geometry, material, group) { fitNearPlane(camera); previous.call(this, renderer, s, camera, geometry, material, group); };
    scene.onBeforeRender = this.beforeRender;
    this.fit([-20, -20, 20, 20]);
  }

  /** Aim the sun's shadows at the ground rectangle being shown. */
  fit([x0, z0, x1, z1]: readonly [number, number, number, number]) {
    const half = Math.max(20, Math.max(x1 - x0, z1 - z0) * 0.75);
    Object.assign(this.sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 300 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.target.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
    this.fill.target.position.copy(this.sun.target.position);
    this.fill.position.copy(this.fill.target.position).add(new THREE.Vector3(-12, 18, 12));
    // Shadow acne on tilted panels and roofs: normal offset of about one shadow-map texel (never under 5 cm).
    this.sun.shadow.normalBias = Math.max(0.05, (2 * half) / this.sun.shadow.mapSize.x);
    const key = this.key;
    this.key = '';
    this.update(key === 'none' || !key ? null : key);
  }

  /** Preserve renderer-derived millisecond precision; second bins freeze sunlight between samples. */
  update(datetime: string | null) {
    const key = datetime ? `${datetime}|${siteNorthOffset()}` : 'none';
    if (key === this.key) return;
    this.key = key;
    if (!datetime) { // no clock yet: a soft midday so the camp reads
      this.daylightFactor=null;
      this.sun.position.copy(this.sun.target.position).add(new THREE.Vector3(20, 35, 15));
      this.sun.intensity = 2; this.hemi.intensity = 1.6; this.sun.color.copy(SUN_WHITE);
      this.fill.intensity = 0.2;
      (this.scene.background as THREE.Color).copy(DAY_SKY);
      this.elevation = null;
      return;
    }
    let pos;
    try { pos = solarPosition(datetime, undefined, undefined, siteNorthOffset()); } catch { return; }
    const original = daylightFactors(pos.elevationDeg);
    const f=this.nightLighting?this.edenDaylight(datetime,original):original;
    this.daylightFactor=f.daylight;
    const dir = new THREE.Vector3(...pos.direction);
    if (dir.y < 0.05) dir.y = 0.05; // below the horizon: keep the shadow camera sane; intensity goes to ~0 anyway
    this.sun.position.copy(this.sun.target.position).addScaledVector(dir.normalize(), 80);
    this.sun.intensity = 2.6 * f.daylight;
    this.sun.color.copy(SUN_WHITE).lerp(SUN_WARM, f.warmth * 0.7);
    // night stays readable: a moonlit fill rather than black
    this.observerFill();
    this.hemi.color.set(0x9fb3d9).lerp(SUN_WHITE,f.daylight);

    (this.scene.background as THREE.Color).copy(NIGHT_SKY).lerp(DUSK_SKY, Math.max(f.warmth * f.daylight, f.blueHour * 0.4)).lerp(DAY_SKY, f.daylight * (1 - f.warmth * 0.6));
    this.elevation = pos.elevationDeg;
  }

  dispose() {
    this.sun.shadow.dispose();
    this.scene.remove(this.hemi, this.sun, this.sun.target, this.fill, this.fill.target);
    if (this.scene.onBeforeRender === this.beforeRender) this.scene.onBeforeRender = this.previousBeforeRender;
  }
}
