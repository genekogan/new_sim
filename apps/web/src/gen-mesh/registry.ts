// Mesh halves of generators: one id → one builder. Files named `*.mesh.ts` anywhere under
// gen-mesh/ register themselves (Vite glob), so lanes add files without touching this one.
// Owner: L1. Spec <eden4>/33 §4.3.
import type * as THREE from 'three';
import type { Baked, Value } from '@sim/generators';
import type { Entity, StoredDef, WorldModel } from '@sim/world-compiler';
import type { MaterialLib } from './materials.ts';

export type MeshCtx = {
  def: StoredDef;
  entity: Entity;
  /** Instance params with generator and def defaults filled. */
  params: Record<string, Value>;
  /** Def-level `make.args`. */
  args: Record<string, unknown>;
  baked: Baked;
  model: WorldModel;
  materials: MaterialLib;
  /** Colour for a tint key: instance param → def palette → fallback. */
  tint(key: string | undefined, fallback: string): string;
};

export type MeshBuilder = {
  /** Generator id (e.g. 'kit/2'), or `tag:<name>` to match defs by tag before the generator (flags, signs). */
  gen: string;
  /** Build the picture in the entity's local frame (origin at its base, +z front). Null = nothing to draw. */
  build(ctx: MeshCtx): THREE.Object3D | null;
  /** Entities with the same key share geometry/materials and may be instanced (L1). Null = unique. */
  instanceKey?(ctx: MeshCtx): string | null;
  /** True if the builder places things in world coordinates (path/area forms that drape on terrain). */
  world?: boolean;
};

const builders = new Map<string, MeshBuilder>();
export function registerMesh(b: MeshBuilder) { builders.set(b.gen, b); }
export function meshFor(def: StoredDef): MeshBuilder | undefined {
  // tag builders (creature, flag, sign-text) draw generated shapes; a stored model is always drawn by `mesh`
  if (def.make.kind !== 'mesh') for (const t of def.tags) { const byTag = builders.get(`tag:${t}`); if (byTag) return byTag; }
  return def.make.kind === 'gen' ? builders.get(def.make.gen) : def.make.kind === 'mesh' ? builders.get('mesh') : undefined;
}
export function registeredMeshes() { return [...builders.keys()].sort(); }

