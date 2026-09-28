// Engine Lab preset `hand-up`: the flagship v3 build (engine/scenarios/build-bay-v3.ts, HANDUP.md) —
// materials go up by hand and by forklift (owner feedback §5/§6): joists handed up by one giver to a
// receiver standing on beam b3, sheet s1 lifted overhead by two givers at the east edge and taken by
// two receivers on the beams (reach_up below, reach_down / take above), sheet s2 presented on the
// forks. Same world, registry, invariants and contributors as engine/test/build-bay-v3.test.ts,
// driven live by SequenceRunner exactly like build-bay.ts. Pure TS (no three.js/DOM).
import { Runtime } from '../../engine/runtime/runtime.ts';
import { Spatial } from '../../engine/spatial/service.ts';
import { WorldHistory } from '../../engine/history/store.ts';
import { emptyWorld } from '../../engine/world/factory.ts';
import { bindTemplate } from '../../engine/sequence/bind.ts';
import { SequenceRunner } from '../../engine/sequence/runner.ts';
import type { WorldState } from '../../engine/world/types.ts';
import { buildBayV3Entities, buildBayV3Regions, buildBayV3Template, buildBayV3Bindings, buildBayV3Registry, BUILD_BAY_V3_INVARIANTS, BUILD_BAY_V3_CONTRIBUTORS, type Site } from '../../engine/scenarios/build-bay-v3.ts';
import { bindRunner, buildBayGround, sequenceOf } from './build-bay.ts';
import type { Scenario } from './scenarios.ts';

export const HAND_UP_SITE: Site = { origin: [0, 0], yaw: 0 };

function stage(w: WorldState) {
  for (const e of buildBayV3Entities(HAND_UP_SITE)) w.entities[e.id] = e;
  for (const r of buildBayV3Regions(HAND_UP_SITE)) w.regions[r.id] = r;
  return w;
}

export function handUpRuntime(): Runtime {
  const base = buildBayGround();
  const h = new WorldHistory('mars-rules/lab-hand-up');
  h.publishCanonical('canon', 'Open ground (lab fixture)', stage(emptyWorld('open-ground', base)), 'lab hand-up fixture');
  const registry = buildBayV3Registry();
  const plan = bindTemplate(buildBayV3Template(HAND_UP_SITE), buildBayV3Bindings, { history: h, baseline: 'canon', registry });
  const world = structuredClone(h.read('canon'));
  const rt = new Runtime(world, registry, { spatial: new Spatial(base, { contributors: BUILD_BAY_V3_CONTRIBUTORS }) }, BUILD_BAY_V3_INVARIANTS);
  bindRunner(rt, new SequenceRunner(rt, plan.steps));
  return rt;
}

/** Steps worth capturing (e2e/poses.spec.ts): the first joist hand-up, s1 by hand, s2 off the forks. */
export const HAND_UP_MOMENTS = { joist: 'up_j1', sheet: 'up_s1', forklift: 'up_s2' } as const;

export const handUp: Scenario = {
  name: 'hand-up',
  title: 'Hand-up: deck materials go up by hand and forklift (flagship v3)',
  description:
    'HYPOTHETICAL flagship v3 (engine/scenarios/build-bay-v3.ts): after the frames are up, each joist is carried beside the bay and handed up to a builder standing on beam b3; two lift sheet s1 overhead at the east edge and two on the beams reach down, take it and lay it; the forklift presents s2 at deck height. Poses: crouch → stand with the load → reach up below, reach down / take above.',
  scene: buildBayGround,
  humans: () => [],
  build: handUpRuntime,
  start: (rt) => sequenceOf(rt)!.advance(),
  tick: (rt) => {
    const r = sequenceOf(rt)!;
    r.poll();
    r.advance();
  },
  done: (rt) => sequenceOf(rt)!.done,
  maxTicks: 20 * 60 * 20,
  focus: [0, 1.8, 8, 20],
  expect: (rt) => {
    const r = sequenceOf(rt)!;
    const bad = r.reports.filter((s) => s.status !== 'completed');
    const w = rt.world.entities;
    return [
      { ok: bad.length === 0, message: bad.length ? `${bad.length} steps not completed, first: ${bad[0].id} ${bad[0].status} ${bad[0].diagnostic?.message ?? ''}` : `all ${r.reports.length} sequence steps completed` },
      { ok: rt.violations.length === 0, message: rt.violations.length ? `${rt.violations.length} violations, first: ${rt.violations[0].message}` : 'zero violations' },
      { ok: w.s1?.phase === 'installed' && w.s2?.phase === 'installed', message: `deck sheets installed (s1 ${w.s1?.phase}, s2 ${w.s2?.phase})` },
    ];
  },
};
