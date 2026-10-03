// Bodies of the entities in a recorded take, for renderers that draw from sampled TakeState frames
// (SampledEntity carries pose and discrete state, not the body). Pure; reads the take only.
import type { Take } from '../take/types.ts';
import type { Body } from '../world/types.ts';

/** Floater bodies by entity id: the take's first-seen entities (mars-take/4), then its final state. */
export function floaterBodiesOfTake(take: Pick<Take, 'entities0' | 'finalState'>): Map<string, Body> {
  const out = new Map<string, Body>();
  for (const src of [take.finalState?.entities, take.entities0]) {
    if (!src) continue;
    for (const [id, e] of Object.entries(src)) if (e.body?.family === 'floater') out.set(id, { ...e.body });
  }
  return new Map([...out].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
