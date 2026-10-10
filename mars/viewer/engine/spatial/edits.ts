// Static design edits are checkpoint data, never mutations of the shared campus.
import { hashOf } from '../core/hash.ts';
import {dcos,dsin} from '../core/math.ts';
import {officeStairGuardsV1Schema} from '../../../../packages/engine-contract/src/office-stair-guards-v1.ts';
import {authoredBoundariesV1Schema,type AuthoredBoundariesV1} from '../../../../packages/engine-contract/src/authored-boundaries-v1.ts';
import type { WorldState } from '../world/types.ts';
import type { Level, Link, Obstacle, SpatialScene, Surface } from './types.ts';

/**
 * entity-physics/1 (logged `world-edit` events; packages/engine-mars/src/entity-physics.ts, lane L9): walkable floors,
 * solids, stairs and closed doors derived from the entities of a god-built world, per entity id, plus the extra levels
 * (upper floors) they stand on and the engine asset defs of its fixtures. World-state data like nav/1: every Spatial
 * built for this world (live, restored, rehearsal) agrees, and replay re-derives it from the log alone.
 * Only the levels and the raster bounds are part of the static base (they change rarely: a new floor height, a
 * building beyond the field); floors, solids and links enter as a scene contribution, so an edit patches the grids
 * incrementally (grid.ts updateGrids) instead of re-basing.
 */
export type EntityPhysicsV1 = {
  version: 'entity-physics/1';
  /** Entity-world edit seq of the last applied world-edit. */
  seq: number;
  /** hashOf({levels, byEntity, assets}): the identity of this physics (physicalView). */
  hash: string;
  /** hashOf({levels, bounds}): the part of the static base it changes (worldBaseId). */
  baseKey: string;
  levels: Level[];
  /** Integer raster bounds covering every floor, or null (the source bounds suffice). */
  bounds: [number, number, number, number] | null;
  byEntity: Record<string, { surfaces?: Surface[]; solids?: Obstacle[]; links?: Link[] }>;
  /** Engine AssetDefs (world/catalog.ts) of god-placed fixtures and items, by asset id; registered into CATALOG on load. */
  assets: Record<string, unknown>;
};

/** entity-physics/1 over a static base: its extra levels and the raster bounds widened to its floors. */
export function withEntityPhysics(scene: SpatialScene, ep: EntityPhysicsV1): SpatialScene {
  if (!ep.levels.length && !ep.bounds) return scene;
  const levels = [...scene.levels];
  for (const l of ep.levels) if (!levels.some((x) => x.id === l.id)) levels.push(l);
  levels.sort((a, b) => a.id - b.id);
  const b = ep.bounds ? [Math.min(scene.bounds[0], ep.bounds[0]), Math.min(scene.bounds[1], ep.bounds[1]), Math.max(scene.bounds[2], ep.bounds[2]), Math.max(scene.bounds[3], ep.bounds[3])] as SpatialScene['bounds'] : scene.bounds;
  return { ...scene, bounds: b, levels };
}

/** entity-physics/1 as a scene contribution (floors, solids, links in entity-id order); memoised per physics hash. */
let contributionMemo: { hash: string; value: { surfaces: Surface[]; obstacles: Obstacle[]; links: Link[] } } | null = null;
export function entityPhysicsContribution(world: WorldState): { surfaces?: Surface[]; obstacles?: Obstacle[]; links?: Link[] } {
  const ep = world.entityPhysicsV1; if (!ep) return {};
  if (contributionMemo?.hash === ep.hash) return contributionMemo.value;
  const surfaces: Surface[] = [], obstacles: Obstacle[] = [], links: Link[] = [];
  for (const id of Object.keys(ep.byEntity).sort()) { const b = ep.byEntity[id]; if (b.surfaces) surfaces.push(...b.surfaces); if (b.solids) obstacles.push(...b.solids); if (b.links) links.push(...b.links); }
  contributionMemo = { hash: ep.hash, value: { surfaces, obstacles, links } };
  return contributionMemo.value;
}

/**
 * nav/1 (logged rules fact `navV1`): extra level-0 walking ground and solid footprints (buildings, water) laid over
 * the source scene. World-state data, so every Spatial built for this world (live, restored, rehearsal) agrees.
 */
export type NavV1 = { version: 'nav/1'; ground: Surface[]; solids: Obstacle[] };
const immutableAuthoredFacts=new WeakSet<object>();
const authoredIdentities=new WeakMap<object,{source:string;identity:string}>();
/** Validation/freeze changes only JS ownership descriptors, never canonical
 * bytes. Restore and configure both establish the same static fact contract. */
export function immutableAuthoredBoundaryFact<T extends AuthoredBoundariesV1>(fact:T):T{
 if(immutableAuthoredFacts.has(fact))return fact;
 authoredBoundariesV1Schema.parse(fact);
 for(const box of fact.boxes){Object.freeze(box.c);Object.freeze(box.half);Object.freeze(box);}
 Object.freeze(fact.boxes);Object.freeze(fact);immutableAuthoredFacts.add(fact);return fact;
}

export function sceneForWorld(base: SpatialScene, world: WorldState): SpatialScene {
  const edits = world.obstacleEdits;
  let scene = base;
  if (edits) {
    const sourceIds = new Set(base.obstacles.map((o) => o.id));
    const obstacles: Obstacle[] = [];
    for (const o of base.obstacles) {
      const replacement = Object.hasOwn(edits, o.id) ? edits[o.id] : o;
      if (replacement) obstacles.push(replacement);
    }
    for (const id of Object.keys(edits).sort()) {
      const o = edits[id];
      if (!sourceIds.has(id) && o) obstacles.push(o);
    }
    scene = { ...base, obstacles };
  }
  if (world.entityPhysicsV1) scene = withEntityPhysics(scene, world.entityPhysicsV1);
  const nav = world.navV1;
  if (!nav) return withAuthoredBoundaries(withOfficeGuards(scene,world),world);
  // Ground widens the raster; solids join the static obstacles (rasterised once per base, StaticRaster).
  let [x0, z0, x1, z1] = scene.bounds;
  for (const s of nav.ground) {
    const hx = Math.abs(s.obb.half[0] * dcos(s.obb.yaw)) + Math.abs(s.obb.half[1] * dsin(s.obb.yaw)), hz = Math.abs(s.obb.half[0] * dsin(s.obb.yaw)) + Math.abs(s.obb.half[1] * dcos(s.obb.yaw));
    x0 = Math.min(x0, s.obb.c[0] - hx); z0 = Math.min(z0, s.obb.c[1] - hz); x1 = Math.max(x1, s.obb.c[0] + hx); z1 = Math.max(z1, s.obb.c[1] + hz);
  }
  return withAuthoredBoundaries(withOfficeGuards({ ...scene, bounds: [Math.floor(x0), Math.floor(z0), Math.ceil(x1), Math.ceil(z1)], surfaces: [...scene.surfaces, ...nav.ground], obstacles: [...scene.obstacles, ...nav.solids] },world),world);
}

/** Identity of the static base a Spatial for `world` represents: the source id, folded with any edits (unchanged without them). */
export function worldBaseId(sourceId: string, world: WorldState): string {
  const edited = world.obstacleEdits ? hashOf({ source: sourceId, obstacleEdits: world.obstacleEdits }) : sourceId;
  const base=world.navV1 ? hashOf({ source: edited, navV1: world.navV1 }) : edited;
  const guarded0=world.officeStairGuardsV1 ? hashOf({source:base,officeStairGuardsV1:world.officeStairGuardsV1}) : base;
  const guarded=world.entityPhysicsV1 ? hashOf({source:guarded0,entityPhysicsV1:world.entityPhysicsV1.baseKey}) : guarded0;
  if(!world.authoredBoundariesV1)return guarded;
  const fact=immutableAuthoredBoundaryFact(world.authoredBoundariesV1),memo=authoredIdentities.get(fact);
  if(memo?.source===guarded)return memo.identity;
  const identity=hashOf({source:guarded,authoredBoundariesV1:fact});authoredIdentities.set(fact,{source:guarded,identity});return identity;
}

/** Same height bands as the capture/camera. Registration never adds a surface,
 * changes an obstacle's base, or extrudes an elevated wall down to ground. */
function withAuthoredBoundaries(scene:SpatialScene,world:WorldState):SpatialScene{
 if(!world.authoredBoundariesV1)return scene;const fact=authoredBoundariesV1Schema.parse(world.authoredBoundariesV1);
 const obstacles:Obstacle[]=fact.boxes.filter(b=>b.collision==='solid').map(b=>({id:'authored-boundary:'+b.id,obb:{c:[b.c[0],b.c[2]],half:[b.half[0],b.half[2]],yaw:b.yaw},y0:b.c[1]-b.half[1],y1:b.c[1]+b.half[1],kind:b.kind==='wall'?'wall':'solid',label:b.buildingId+' '+b.kind}));
 return {...scene,obstacles:[...scene.obstacles,...obstacles]};
}

/** Existing height-aware obstacle contract; never extrude upper rails down to the ground. */
function withOfficeGuards(scene:SpatialScene,world:WorldState):SpatialScene {
  const raw=world.officeStairGuardsV1;if(!raw)return scene;const fact=officeStairGuardsV1Schema.parse(raw);
  const obstacles:Obstacle[]=fact.guards.map(b=>({id:'office-guard:'+b.id,obb:{c:[(b.min[0]+b.max[0])/2,(b.min[2]+b.max[2])/2],half:[(b.max[0]-b.min[0])/2,(b.max[2]-b.min[2])/2],yaw:0},y0:b.min[1],y1:b.max[1],kind:'solid',label:'Office stair opening guard'}));
  return {...scene,obstacles:[...scene.obstacles,...obstacles]};
}
