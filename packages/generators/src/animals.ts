// animals/1: a herd of mesh-pack or kit creatures living in an area. Owner: L4 (library & creatures).
// Spec <eden4>/33 §3.2. Motion is client-side and deterministic from (seed, world tick);
// the server stores only the herd. CONTRACT STUB (L1): params final; physics has no colliders.
import { bounds2, boxOfBounds } from './geom.ts';
import type { Generator, Vec2 } from './types.ts';

export const ANIMAL_SPECIES = ['dog', 'cat', 'pug', 'duck', 'goose', 'chicken', 'sheep', 'goat', 'cow', 'horse', 'pig', 'fox', 'deer', 'rabbit', 'bird', 'crow', 'seagull', 'koi', 'fish'] as const;

export const animalsGen: Generator = {
  id: 'animals/1', form: 'area', owner: 'L4',
  doc: 'Animals living in an area: species (or a def ref of a kit creature), count, behaviour (wander, graze, swim, perch, sleep, fly). Moves on every viewer identically; no server cost.',
  params: {
    species: { type: 'enum', values: [...ANIMAL_SPECIES], default: 'dog' },
    def: { type: 'ref', doc: 'use a kit creature def instead of the species mesh (e.g. "core/dog@1")' },
    count: { type: 'int', min: 1, max: 60, default: 3 },
    behavior: { type: 'enum', values: ['wander', 'graze', 'swim', 'perch', 'sleep', 'fly', 'follow'], default: 'wander' },
    speed: { type: 'number', min: 0.1, max: 6, default: 1 },
    scale: { type: 'number', min: 0.3, max: 3, default: 1 },
  },
  physics({ shape }) { const area: Vec2[] = shape?.area ?? [[-5, -5], [5, -5], [5, 5], [-5, 5]]; return { box: boxOfBounds(bounds2(area), 1), colliders: [], slots: [], tris: 0 }; },
};
