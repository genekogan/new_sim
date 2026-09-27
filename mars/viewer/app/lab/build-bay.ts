// Engine Lab preset for the flagship "build a rack bay" sequence
// (engine/scenarios/build-bay.ts): the same world, registry, invariants and
// Spatial contributors as engine/test/build-bay.test.ts, driven live by
// SequenceRunner one fixed tick at a time. The lab loop does exactly what
// SequenceRunner.run() does per iteration — advance() once before the first
// tick, then rt.step() → poll() → advance() — so the final state is the
// rehearsal's. Pure TS (no three.js/DOM).
import { Runtime } from '../../engine/runtime/runtime.ts';
import { Spatial } from '../../engine/spatial/service.ts';
import { WorldHistory } from '../../engine/history/store.ts';
import { emptyWorld, addAll } from '../../engine/world/factory.ts';
import { bindTemplate } from '../../engine/sequence/bind.ts';
import { SequenceRunner } from '../../engine/sequence/runner.ts';
import { buildBayEntities, buildBayTemplate, buildBayBindings, buildBayRegistry, BUILD_BAY_INVARIANTS, BUILD_BAY_CONTRIBUTORS, type Site } from '../../engine/scenarios/build-bay.ts';
import type { SpatialScene } from '../../engine/spatial/types.ts';
import type { Scenario } from './scenarios.ts';

export const BUILD_BAY_SITE: Site = { origin: [0, 0], yaw: 0 };
export const BUILD_BAY_RULES = 'mars-rules/lab-build-bay';

/** Open ground, identical to the engine test's `ground()`. */
export const buildBayGround = (): SpatialScene => ({
  bounds: [-20, -15, 15, 15],
  levels: [{ id: 0, y: 0, label: 'ground' }],
  surfaces: [{ id: 'ground', level: 0, y: 0, obb: { c: [-2.5, 0], half: [17.5, 15], yaw: 0 } }],
  obstacles: [],
  links: [],
});

const runners = new WeakMap<Runtime, SequenceRunner>();
/** The live sequence driving a runtime (build-bay only). */
export const sequenceOf = (rt: Runtime) => runners.get(rt);

export function buildBayRuntime(): Runtime {
  const base = buildBayGround();
  const h = new WorldHistory(BUILD_BAY_RULES);
  h.publishCanonical('canon', 'Open ground (lab fixture)', addAll(emptyWorld('open-ground', base), ...buildBayEntities(BUILD_BAY_SITE)), 'lab build-bay fixture');
  const registry = buildBayRegistry();
  const plan = bindTemplate(buildBayTemplate(BUILD_BAY_SITE), buildBayBindings, { history: h, baseline: 'canon', registry });
  const world = structuredClone(h.read('canon'));
  const rt = new Runtime(world, registry, { spatial: new Spatial(base, { contributors: BUILD_BAY_CONTRIBUTORS }) }, BUILD_BAY_INVARIANTS);
  runners.set(rt, new SequenceRunner(rt, plan.steps));
  return rt;
}

/** Steps whose completion marks the capture moments (e2e + README). */
export const BUILD_BAY_MOMENTS = {
  held: ['raiseA', 'raiseB'],
  beams: ['releaseA', 'releaseB'],
  joists: ['fix_j5'],
  deck: ['deck_s2'],
  stair: ['stair'],
  visitor: ['visit'],
} as const;

export const buildBay: Scenario = {
  name: 'build-bay',
  title: 'Build a rack bay (flagship sequence)',
  description:
    'HYPOTHETICAL flagship build (engine/scenarios/build-bay.ts): six people carry two 12 ft uprights and four 9 ft beams from the piles, raise and hold the frames, seat beams at 0.5 m and 1.8 m, release, fix five 2x4 joists, deck two 4x6 sheets, set the stair flight and its ten treads; then the visitor climbs onto the new deck. 43 sequence steps, driven live by SequenceRunner.',
  scene: buildBayGround,
  humans: () => [],
  build: buildBayRuntime,
  start: (rt) => runners.get(rt)!.advance(),
  tick: (rt) => {
    const r = runners.get(rt)!;
    r.poll();
    r.advance();
  },
  done: (rt) => runners.get(rt)!.done,
  maxTicks: 20 * 60 * 20,
  focus: [-3.5, 0, 9, 55],
  expect: (rt) => {
    const r = runners.get(rt)!;
    const bad = r.reports.filter((s) => s.status !== 'completed');
    const w = rt.world.entities;
    return [
      { ok: bad.length === 0, message: bad.length ? `${bad.length} steps not completed, first: ${bad[0].id} ${bad[0].status} ${bad[0].diagnostic?.message ?? ''}` : `all ${r.reports.length} sequence steps completed` },
      { ok: rt.violations.length === 0, message: rt.violations.length ? `${rt.violations.length} violations, first: ${rt.violations[0].message}` : 'zero violations' },
      { ok: w.A.phase === 'installed' && w.B.phase === 'installed', message: `uprights installed (A ${w.A.phase}, B ${w.B.phase})` },
      { ok: w.s1.phase === 'installed' && w.s2.phase === 'installed', message: `deck sheets installed (s1 ${w.s1.phase}, s2 ${w.s2.phase})` },
      { ok: w.visitor.human!.level === 4, message: `visitor on level ${w.visitor.human!.level} (deck = 4)` },
    ];
  },
};
