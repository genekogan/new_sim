// entity-physics/1: the `world-edit` engine fact (spec eden4/31 B2/B3, lane L9). One logged event per committed
// entity-world batch carries, per changed entity, the physics the engine needs — floors (surfaces on levels),
// solids (wall segments, closed doors), stairs (links) — and the fixtures/items it registers with the same ids.
// The fold applies it to plain world state (`world.entityPhysicsV1` + `world.entities`), so live, restored and
// replayed engines agree without ever reading the entity model.
import { hashOf } from '../../../mars/viewer/engine/core/hash.ts';
import type { EntityPhysicsV1 } from '../../../mars/viewer/engine/spatial/edits.ts';
import type { Level, Link, Obstacle, Surface } from '../../../mars/viewer/engine/spatial/types.ts';
import type { Entity, WorldState } from '../../../mars/viewer/engine/world/types.ts';
import { registerAssets } from './catalog-adapter.ts';

export type { EntityPhysicsV1 };
export type EntityPartV1 = { surfaces?: Surface[]; solids?: Obstacle[]; links?: Link[] };
/** A god-placed fixture or item as the engine holds it (same id as the entity-world entity). */
export type FixtureSpecV1 = {
  def: string; kind: 'fixture' | 'item'; label: string;
  p: [number, number, number]; yaw: number;
  support?: { kind: 'ground' } | { kind: 'resting-on'; on: string; slot: string };
};
export type WorldEditV1 = {
  contract: 'world-edit/1';
  /** Entity-world edit seq this event mirrors (0 = boot reconciliation). */
  seq: number;
  /** hashOf the resulting entity-physics (levels, byEntity, assets): replay checks it re-derived the same. */
  hash: string;
  /** Upper-floor levels (ids 1..20) the parts stand on; the full list after this edit. */
  levels: Level[];
  /** Changed entities: their physics and fixture, or null when removed. */
  set: Record<string, (EntityPartV1 & { fixture?: FixtureSpecV1 }) | null>;
  /** Engine assets first used by this edit (catalog-adapter.ts). */
  assets?: Record<string, unknown>;
};

export const emptyEntityPhysics = (): EntityPhysicsV1 => ({ version: 'entity-physics/1', seq: 0, hash: '', baseKey: '', levels: [], bounds: null, byEntity: {}, assets: {} });
export const entityPhysicsHash = (ep: Pick<EntityPhysicsV1, 'levels' | 'byEntity' | 'assets'>) => hashOf({ levels: ep.levels, byEntity: sortKeys(ep.byEntity), assets: sortKeys(ep.assets) });
function sortKeys<T>(r: Record<string, T>): Record<string, T> { const o: Record<string, T> = {}; for (const k of Object.keys(r).sort()) o[k] = r[k]; return o; }

const RASTER_HALF = 64;
/** Integer bounds covering every floor (and solid) of the physics, or null when there is none. */
function floorBounds(ep: EntityPhysicsV1): [number, number, number, number] | null {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  const add = (c: [number, number], h: [number, number], yaw: number) => { const ca = Math.abs(Math.cos(yaw)), sa = Math.abs(Math.sin(yaw)), hx = h[0] * ca + h[1] * sa, hz = h[0] * sa + h[1] * ca; x0 = Math.min(x0, c[0] - hx); z0 = Math.min(z0, c[1] - hz); x1 = Math.max(x1, c[0] + hx); z1 = Math.max(z1, c[1] + hz); };
  for (const b of Object.values(ep.byEntity)) for (const s of b.surfaces ?? []) add(s.obb.c, s.obb.half, s.obb.yaw);
  if (x0 === Infinity) return null;
  // round out to 8 m so a small move does not re-base the raster; never beyond ±64 m (one flat 0.1 m raster per level;
  // a wider world waits for L8's tiled Spatial — floors beyond it are simply not walkable yet)
  const c = (v: number) => Math.max(-RASTER_HALF, Math.min(RASTER_HALF, v));
  return [c(Math.floor(x0 / 8) * 8), c(Math.floor(z0 / 8) * 8), c(Math.ceil(x1 / 8) * 8), c(Math.ceil(z1 / 8) * 8)];
}

/** The physics state a world-edit produces from `prev` (pure). */
export function nextEntityPhysics(prev: EntityPhysicsV1 | undefined, e: WorldEditV1): EntityPhysicsV1 {
  const cur = prev ? structuredClone(prev) : emptyEntityPhysics();
  for (const id of Object.keys(e.set).sort()) {
    const v = e.set[id];
    if (!v) { delete cur.byEntity[id]; continue; }
    const part: EntityPartV1 = {};
    if (v.surfaces?.length) part.surfaces = v.surfaces;
    if (v.solids?.length) part.solids = v.solids;
    if (v.links?.length) part.links = v.links;
    if (part.surfaces || part.solids || part.links) cur.byEntity[id] = structuredClone(part); else delete cur.byEntity[id];
  }
  for (const [id, a] of Object.entries(e.assets ?? {})) cur.assets[id] ??= structuredClone(a);
  cur.levels = structuredClone(e.levels).sort((a, b) => a.id - b.id);
  cur.seq = Math.max(cur.seq, e.seq);
  cur.byEntity = sortKeys(cur.byEntity); cur.assets = sortKeys(cur.assets);
  cur.bounds = floorBounds(cur);
  cur.hash = entityPhysicsHash(cur);
  cur.baseKey = hashOf({ levels: cur.levels, bounds: cur.bounds });
  return cur;
}

/**
 * Apply a world-edit to world state: physics + fixture entities. Returns the ids of fixtures it could not update
 * because a body holds them (the server refuses such edits first; this is the engine's own guard).
 */
export function applyWorldEdit(world: WorldState, e: WorldEditV1): { physics: EntityPhysicsV1; kept: string[] } {
  const physics = nextEntityPhysics(world.entityPhysicsV1, e);
  registerAssets(physics.assets);
  world.entityPhysicsV1 = physics;
  const kept: string[] = [];
  for (const id of Object.keys(e.set).sort()) {
    const v = e.set[id], cur = world.entities[id];
    const heldByBody = cur?.support?.kind === 'in-hand' || cur?.support?.kind === 'held';
    if (!v?.fixture) {
      if (cur && cur.tags?.includes('entity-world')) { if (heldByBody) kept.push(id); else delete world.entities[id]; }
      continue;
    }
    if (heldByBody) { kept.push(id); continue; }
    const f = v.fixture;
    const next: Entity = {
      id, def: f.def, kind: f.kind === 'item' ? 'component' : 'fixture', label: f.label, tags: ['entity-world'],
      pose: { p: [f.p[0], f.p[1], f.p[2]], yaw: f.yaw },
      provenance: { origin: 'design-edit', confidence: 'hypothetical', note: 'placed by the world\'s god (entity world, world-edit/1)' },
      ...(f.support ? { support: structuredClone(f.support) } : {}),
      ...(f.kind === 'item' && f.support?.kind === 'ground' ? { phase: 'staged' as const } : {}),
      ...(cur?.contents ? { contents: cur.contents } : {}),
    };
    world.entities[id] = next;
  }
  return { physics, kept };
}
