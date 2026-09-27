// Helpers to construct world states (tests, proving ground, forks of campuses).
import { seedRng } from '../core/rng.ts';
import { hashOf } from '../core/hash.ts';
import type { Entity, Provenance, WorldState } from './types.ts';
import { WORLD_SCHEMA } from './types.ts';
import type { SpatialScene } from '../spatial/types.ts';

export const FIXTURE: Provenance = { origin: 'test-fixture', confidence: 'hypothetical' };

export function emptyWorld(campus: string, base: SpatialScene, seed = campus): WorldState {
  return {
    schema: WORLD_SCHEMA,
    base: { campus, staticHash: hashOf(base) },
    tick: 0,
    entities: {},
    regions: {},
    env: { datetime: '2026-03-01T16:00', weather: { clouds: 0, rain: 0, wind: 0, dust: 0, wet: 0 } },
    inventory: 'finite',
    rng: seedRng(seed),
  };
}

export function human(id: string, x: number, z: number, opts: { level?: number; y?: number; yaw?: number; label?: string; provenance?: Provenance } = {}): Entity {
  return {
    id,
    def: 'human',
    kind: 'human',
    label: opts.label ?? id,
    pose: { p: [x, opts.y ?? 0, z], yaw: opts.yaw ?? 0 },
    provenance: opts.provenance ?? FIXTURE,
    human: { activity: 'idle', level: opts.level ?? 0 },
  };
}

export function component(id: string, defId: string, p: [number, number, number], yaw = 0, opts: Partial<Entity> = {}): Entity {
  return {
    id,
    def: defId,
    kind: 'component',
    pose: { p, yaw, pitch: opts.pose?.pitch, roll: opts.pose?.roll },
    provenance: FIXTURE,
    phase: 'stored',
    support: { kind: 'ground' },
    ...opts,
  };
}

export function addAll(w: WorldState, ...es: Entity[]) {
  for (const e of es) w.entities[e.id] = e;
  return w;
}
