// The generator registry: one id → one physics half (+ one mesh half in apps/web/src/gen-mesh).
// Owner: L1. Lanes add generators by editing their own files; this list is the only shared line.
import { AREA_GENERATORS } from './areas.ts';
import { animalsGen } from './animals.ts';
import { boxGen, lakeGen, landformGen, scatterGen } from './basic.ts';
import { buildingGen, stairsGen } from './building.ts';
import { DESERT_GENERATORS } from './desert.ts';
import { kitGen } from './kit.ts';
import { PATH_GENERATORS } from './paths.ts';
import type { Generator } from './types.ts';

export const GENERATORS: Record<string, Generator> = Object.fromEntries(
  [boxGen, landformGen, lakeGen, scatterGen, kitGen, buildingGen, stairsGen, animalsGen, ...PATH_GENERATORS, ...AREA_GENERATORS, ...DESERT_GENERATORS].map((g) => [g.id, g]),
);
export function registerGenerator(g: Generator) { GENERATORS[g.id] = g; }
export function generator(id: string): Generator | undefined { return GENERATORS[id]; }
/** For the god's schema browser: id, form, doc, owner, params (with defaults/ranges/docs). */
export function describeGenerators() {
  return Object.values(GENERATORS).map((g) => ({ id: g.id, form: g.form, doc: g.doc, owner: g.owner ?? 'L1', params: g.params, hasArgs: !!g.args }));
}
