// Semantic world model (spec §5, §21). Three layers are kept distinct:
//   AssetDef   — reusable description of a kind of thing (catalog.ts)
//   Entity     — a placement in one world state, with provenance
//   SimState   — transient operational state during a run (held, supported…)
// A WorldState is plain JSON: it can be hashed, checkpointed, forked, sent to
// a Durable Object and replayed without any rendering objects.
import type { Vec3 } from '../core/math.ts';
import type { RngState } from '../core/rng.ts';

export const WORLD_SCHEMA = 'mars-world/1';

/** Rotation: yaw about +Y, then pitch about local X, then roll about local Z (radians). */
export type Pose = { p: Vec3; yaw: number; pitch?: number; roll?: number };

export type Confidence = 'documented' | 'participant' | 'inferred' | 'provisional' | 'hypothetical';

/** Epistemic status is independent of dimensional precision (spec §4). */
export type Provenance = {
  /** How this placement came to exist in this state. */
  origin: 'canonical' | 'reconstruction-edit' | 'design-edit' | 'simulation' | 'test-fixture';
  confidence: Confidence;
  evidence?: string[];
  note?: string;
};

export type EntityKind = 'human' | 'component' | 'vehicle' | 'fixture' | 'marker';

/** How an entity is currently held up. `none` is only legal transiently and is a violation at tick end. */
export type Support =
  | { kind: 'ground' }
  | { kind: 'resting-on'; on: string }
  | { kind: 'held'; by: string[] }
  | { kind: 'connected'; to: string[] }
  | { kind: 'forks'; vehicle: string }
  | { kind: 'none' };

export type Connection = { socket: string; to: string; toSocket: string };

export type ComponentPhase =
  | 'stored' // in a pile/stock, stacked
  | 'reserved'
  | 'carried'
  | 'staged' // lying at a work area
  | 'raising'
  | 'placed' // in final pose, possibly still needing support
  | 'installed'; // connected and self-supporting under the assembly rules

export type HumanState = {
  activity: string; // 'idle' | 'walk' | 'carry' | 'support' | 'climb' | 'sit' | ...
  task?: string; // action id currently owning this actor
  grip?: { entity: string; slot: string };
  level: number; // walkable level index (0 = ground)
};

export type Entity = {
  id: string;
  def: string; // AssetDef id
  kind: EntityKind;
  label?: string;
  tags?: string[];
  pose: Pose;
  provenance: Provenance;
  /** Components */
  phase?: ComponentPhase;
  support?: Support;
  connections?: Connection[];
  assembly?: string;
  /** Humans */
  human?: HumanState;
  /** Owning action while reserved/held. */
  reservedBy?: string;
};

export type Region = {
  id: string;
  label: string;
  kind: 'place' | 'staging' | 'material-pile' | 'work-area' | 'walkable' | 'no-go';
  /** Ground polygon (x, z), counter-clockwise. */
  polygon: [number, number][];
  level?: number;
  provenance: Provenance;
};

/** Immutable static geometry the entity layer sits on (canonical baseline or a test fixture). */
export type BaseRef = {
  campus: string; // e.g. 'mars-2026', 'proving-ground'
  /** Content hash of the static collision/walkable description used by the runtime. */
  staticHash: string;
};

export type Environment = {
  /** ISO local date/time at the campus (visual only — independent of sim elapsed time, spec §19). */
  datetime: string;
  weather: { clouds: number; rain: number; wind: number; dust: number; wet: number };
};

export type WorldState = {
  schema: typeof WORLD_SCHEMA;
  base: BaseRef;
  tick: number;
  entities: Record<string, Entity>;
  regions: Record<string, Region>;
  env: Environment;
  inventory: 'finite' | 'unlimited';
  rng: RngState;
};

/** The portion of state that physical plans depend on (spec §16: camera/env changes must not invalidate plans). */
export function physicalView(w: WorldState) {
  const entities: Record<string, unknown> = {};
  for (const [id, e] of Object.entries(w.entities)) {
    const { label: _l, tags: _t, provenance: _p, ...rest } = e;
    entities[id] = rest;
  }
  // inventory mode and RNG state change what a run produces (finite stock, seeded
  // choices), so a plan rehearsed under one cannot be trusted under another.
  // Deliberately excluded: tick (clock only), env (visual, §19), labels/tags/provenance.
  return {
    base: w.base,
    entities,
    regions: Object.values(w.regions).map((r) => [r.id, r.kind, r.polygon, r.level ?? 0]),
    inventory: w.inventory,
    rng: w.rng,
  };
}
