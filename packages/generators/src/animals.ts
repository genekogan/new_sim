// animals/1: a herd of mesh-pack or kit creatures living in an area. Owner: L4 (library & creatures).
// Spec <eden4>/33 §3.2. Motion is client-side and deterministic from (seed, world tick);
// the server stores only the herd. Also: what a kit creature's roles let it do (for `describe`).
import { bounds2, boxOfBounds } from './geom.ts';
import type { Generator, Vec2 } from './types.ts';

export const ANIMAL_SPECIES = ['dog', 'cat', 'pug', 'duck', 'goose', 'chicken', 'sheep', 'goat', 'cow', 'horse', 'pig', 'fox', 'deer', 'rabbit', 'bird', 'crow', 'seagull', 'koi', 'fish'] as const;
export const BEHAVIORS = ['wander', 'graze', 'swim', 'perch', 'sleep', 'fly', 'follow', 'idle'] as const;

/**
 * The gait and behaviours a kit/2 creature supports, from its roles: legs walk, wings fly, a tail swims.
 * `refusals` names the missing part for each unsupported behaviour ("wander needs legs (leg.fl…)").
 */
export function creatureAbilities(args: { gait?: string; shapes?: { role?: string }[] }): { gait: string; roles: string[]; behaviors: string[]; refusals: Record<string, string> } {
  const roles = [...new Set((args.shapes ?? []).map((s) => s.role).filter((r): r is string => !!r))].sort();
  const has = (...r: string[]) => r.every((x) => roles.includes(x));
  const legs4 = has('leg.fl', 'leg.fr', 'leg.bl', 'leg.br'), legs2 = has('leg.l', 'leg.r'), wings = has('wing.l', 'wing.r'), tail = has('tail');
  const gait = args.gait ?? 'none';
  const can: Record<string, string | null> = {
    idle: null, sleep: null, follow: legs4 || legs2 ? null : 'follow needs legs',
    wander: legs4 || legs2 ? null : 'wander needs legs (leg.fl/fr/bl/br or leg.l/r)',
    graze: legs4 || legs2 ? (has('head') ? null : 'graze needs a head role') : 'graze needs legs',
    swim: gait === 'fish-swim' ? (tail ? null : 'swim needs a tail role') : legs2 || legs4 ? null : 'swim needs legs or a fish tail',
    fly: wings ? null : 'fly needs wings (wing.l, wing.r)', perch: legs2 ? null : 'perch needs two legs (leg.l, leg.r)',
  };
  return { gait, roles, behaviors: Object.keys(can).filter((k) => !can[k]), refusals: Object.fromEntries(Object.entries(can).filter(([, v]) => v)) as Record<string, string> };
}

export const animalsGen: Generator = {
  id: 'animals/1', form: 'area', owner: 'L4',
  doc: 'Animals living in an area: species (or a def ref of a kit creature), count, behaviour (wander, graze, swim, perch, sleep, fly). Moves on every viewer identically; no server cost. Water areas always swim.',
  params: {
    species: { type: 'enum', values: [...ANIMAL_SPECIES], default: 'dog' },
    def: { type: 'ref', doc: 'use a kit creature def instead of the species mesh (e.g. "core/dog@1")' },
    count: { type: 'int', min: 1, max: 60, default: 3 },
    behavior: { type: 'enum', values: ['wander', 'graze', 'swim', 'perch', 'sleep', 'fly', 'follow'], default: 'wander' },
    speed: { type: 'number', min: 0.1, max: 6, default: 1 },
    scale: { type: 'number', min: 0.3, max: 3, default: 1 },
  },
  physics({ shape, params }) {
    const area: Vec2[] = shape?.area ?? [[-5, -5], [5, -5], [5, 5], [-5, 5]];
    return { box: boxOfBounds(bounds2(area), 1), colliders: [], slots: [], tris: 0, notes: [`${params.count ?? 3} × ${params.def || params.species || 'dog'}, ${params.behavior ?? 'wander'} (client-side, deterministic)`] };
  },
};
