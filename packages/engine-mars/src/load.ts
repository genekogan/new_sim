// The Mars engine is never copied into this repository. It is imported, read-only,
// from a local checkout of the Mars world simulator (which is not published).
// Where that checkout is absent (CI, a cloud agent), everything here is skipped.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const marsDir = () => process.env.MARS_ENGINE_DIR ?? join(homedir(), 'Mars/code/campus-2026-reconstruction/viewer/engine');
export const marsAvailable = () => existsSync(join(marsDir(), 'runtime/runtime.ts'));

/* eslint-disable @typescript-eslint/no-explicit-any */
/** The parts of the Mars engine the adapter uses. Typed loosely on purpose: the Mars types stay in Mars. */
export type Mars = {
  Runtime: any;
  canonicalEntityOrder: (w: any) => any;
  rulesVersion: string;
  createRegistry: () => Map<string, any>;
  servicesFor: (scenes: Record<string, any>) => (world: any) => Record<string, any>;
  invariants: any[];
  describeVerbs: (registry: Map<string, any>) => { verb: string; description: string; inputSchema: Record<string, unknown> }[];
  scenes: Record<string, any>;
  provingGroundWorld: () => any;
  /** One of Mars's own authored scenarios (a table, a pot of stew, four people, four chairs round a fire) and its per-person steps. */
  mealWorld: () => any;
  mealSteps: () => Record<string, { verb: string; params: Record<string, unknown>; until?: string }[]>;
  human: (id: string, x: number, z: number, opts?: Record<string, unknown>) => any;
  seedRng: (seed: string) => [number, number, number, number];
  nextRandom: (st: [number, number, number, number]) => number;
};

export async function loadMars(): Promise<Mars> {
  if (!marsAvailable()) throw new Error(`Mars engine not found at ${marsDir()} (set MARS_ENGINE_DIR)`);
  const at = (f: string) => import(pathToFileURL(join(marsDir(), f)).href);
  const [rt, reg, seeds, fac, rng, meal] = await Promise.all([at('runtime/runtime.ts'), at('api/registry.ts'), at('api/seeds.ts'), at('world/factory.ts'), at('core/rng.ts'), at('scenarios/meal.ts')]);
  return {
    Runtime: rt.Runtime, canonicalEntityOrder: rt.canonicalEntityOrder, rulesVersion: reg.ENGINE_RULES_VERSION, createRegistry: reg.createRegistry, servicesFor: reg.servicesFor,
    invariants: reg.ENGINE_INVARIANTS, describeVerbs: reg.describeVerbs, scenes: seeds.ENGINE_SCENES, provingGroundWorld: seeds.provingGroundWorld, human: fac.human, seedRng: rng.seedRng, nextRandom: rng.nextRandom, mealWorld: meal.mealWorld, mealSteps: meal.mealSteps,
  };
}
