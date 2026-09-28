// Engine Lab preset `body` (POSES.md "Body model"): a still scene to measure the rendered body against
// BODY_MODEL (app/engine-view/rig.ts). Three people stand at the east edge of the proving ground's 3 m
// deck facing out over it (one per rig template: ids hash to casual / punk / woman), three stand on the
// ground below facing the deck. Nothing runs; the lab hook `probe(id, { activity, hands })` sets a
// person's activity and hand points directly (renderer-only: the engine never produces this state) and
// returns their `bones()` once the pose layers have settled — e2e/poses.spec.ts sweeps targets
// overhead (standing flat, heels up) and below the deck edge (kneel) to measure reach.
import { provingGround, DECK_Y } from '../../engine/scenes/proving-ground.ts';
import { human } from '../../engine/world/factory.ts';
import type { Scenario } from './scenarios.ts';

/** Deck edge (x) and the people's feet 0.2 m inside it. */
export const BODY_EDGE_X = 14;
const ZS = [8.5, 10, 11.5];
// templateFor(id) = hash(id) % 3 over [casual, punk, woman]: 'b1' casual, 'b2' punk, 'b0' woman
const IDS = ['b1', 'b2', 'b0'];

export const body: Scenario = {
  name: 'body',
  title: 'Body model probe (reach)',
  description: 'Still scene for measuring the rendered body against the body model (rig.ts BODY_MODEL): b0–b2 at the east deck edge (3 m) facing out, g0–g2 on the ground below facing the deck. The lab hook probe() poses them against synthetic hand targets (renderer only).',
  scene: () => provingGround(),
  humans: () => [
    ...IDS.map((id, i) => human(id, BODY_EDGE_X - 0.2, ZS[i], { level: 1, y: DECK_Y, yaw: 0 })),
    ...IDS.map((id, i) => human(`g${id.slice(1)}`, BODY_EDGE_X + 1.2, ZS[i], { yaw: Math.PI })),
  ],
  start: () => {},
  done: () => true,
  maxTicks: 20,
  focus: [14, 10, 7, 20],
  expect: () => [],
};
