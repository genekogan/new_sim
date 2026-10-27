// Test/benchmark instrumentation only: the existing profiler's call counters with a zero clock.
import assert from 'node:assert/strict';
import { stress, buildRuntime } from '../../app/lab/scenarios.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Spatial } from '../spatial/service.ts';
export type Planner = 'exact' | 'corridor';
export type Work = Record<string, { total: number; peak: number }>;
export const WORK_KEYS = ['spatial.route', 'spatial.routeAround', 'spatial.gridsAround', 'spatial.sync', 'spatial.sync.rebuild', 'spatial.sync.grids', 'walk_to.plan', 'walk_to.step'] as const;

export function totals(rt: Runtime): Record<string, number> {
  return Object.fromEntries(WORK_KEYS.map((key) => [key, rt.prof?.stats.get(key)?.calls ?? 0]));
}
export function stressWork(planner: Planner, profile = true) {
  const scenario = stress(30), rt = buildRuntime(scenario);
  (rt.services.spatial as Spatial).planner = planner;
  rt.profile = profile;
  if (rt.prof) rt.prof.now = () => 0;
  const work: Work = Object.fromEntries(WORK_KEYS.map((key) => [key, { total: 0, peak: 0 }]));
  let previous = totals(rt);
  const sample = () => {
    const next = totals(rt);
    for (const key of WORK_KEYS) {
      work[key].peak = Math.max(work[key].peak, next[key] - previous[key]);
      work[key].total = next[key];
    }
    previous = next;
  };
  scenario.start(rt);
  sample();
  for (let i = 0; i < 1200; i++) { rt.step(); scenario.tick!(rt); sample(); }
  return { rt, work, sample };
}

// Original stress-30 ceilings: 60deba6 (REPORT/PLANNING_BUDGET).
// 2026-10-27 physical landing safety: a refused crowd landing starts the ordinary
// plus squeezed replan fallbacks at tick 971 (exact) instead of admitting a
// 0.25 m corridor for a 0.28 m body. Both versions complete 45 of 75 actions with
// zero violations. This is an explicit safety/work tradeoff, not neutral work:
// exact routeAround 9→14 (peak 1→2), gridsAround 18→20, sync 37097→37099;
// corridor routeAround 5→8 (peak 1→2). All other ceilings stay unchanged.
// link-reversible.test.ts fixes the actual occupied landing and its reopening.
// These are ceilings, so an optimization can do less work without an arbitrary percentage allowance.
export const STRESS_WORK_BUDGET: Record<Planner, Work> = {
  exact: {
    'spatial.route': { total: 75, peak: 27 },
    'spatial.routeAround': { total: 14, peak: 2 },
    'spatial.gridsAround': { total: 20, peak: 2 },
    'spatial.sync': { total: 37099, peak: 58 },
    'spatial.sync.rebuild': { total: 1, peak: 1 },
    'spatial.sync.grids': { total: 1, peak: 1 },
    'walk_to.plan': { total: 75, peak: 27 },
    'walk_to.step': { total: 35724, peak: 30 },
  },
  corridor: {
    'spatial.route': { total: 75, peak: 27 },
    'spatial.routeAround': { total: 8, peak: 2 },
    'spatial.gridsAround': { total: 10, peak: 2 },
    'spatial.sync': { total: 37087, peak: 58 },
    'spatial.sync.rebuild': { total: 1, peak: 1 },
    'spatial.sync.grids': { total: 1, peak: 1 },
    'walk_to.plan': { total: 75, peak: 27 },
    'walk_to.step': { total: 35722, peak: 30 },
  },
};
export function assertStressWork(planner: Planner, work: Work) {
  const ceiling = STRESS_WORK_BUDGET[planner];
  for (const key of WORK_KEYS) {
    assert.ok(work[key].total <= ceiling[key].total, `${planner} ${key} total ${work[key].total} exceeds ${ceiling[key].total}`);
    assert.ok(work[key].peak <= ceiling[key].peak, `${planner} ${key} per-tick peak ${work[key].peak} exceeds ${ceiling[key].peak}`);
  }
}
