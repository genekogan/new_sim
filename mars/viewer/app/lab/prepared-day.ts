import { Runtime } from '../../engine/runtime/runtime.ts';
import { createRegistry, ENGINE_INVARIANTS, servicesFor } from '../../engine/api/registry.ts';
import { PREPARED_DAY_NAMES, preparedDayWorld, preparedDayScene, type PreparedDayScenario } from '../../engine/scenarios/prepared-day.ts';
import type { Scenario } from './scenarios.ts';

const preset = (name: PreparedDayScenario): Scenario => ({
  name,
  title: `Prepared continuing day · ${name === 'prepared-day-studio' ? 'independent studio' : name === 'prepared-day-8' ? '8-guest room' : '4-guest room'} (hypothetical)`,
  description: 'Start notes, interrupt after progress and wait for stand-up. Start session, then Start purposeful routine during presentations: gathering, a companion walk, two finite ingredients prepared into a cold shared dish, a meal, supported ground sleep and return to the same unfinished notes. Independent attendee follow-ups remain separate commitments. One fixed authored arrangement; no historical claims, autonomous schedule or active reload guarantee.',
  scene: () => preparedDayScene(name), humans: () => [],
  build: () => {
    const world = preparedDayWorld(name), scene = preparedDayScene(name);
    return new Runtime(world, createRegistry(), servicesFor({ [world.base.campus]: scene })(world), ENGINE_INVARIANTS);
  },
  start: () => {}, continuous: true, maxTicks: 20 * 1800,
  focus: [1, 1, 19, 105],
  expect: rt => [{ ok: rt.violations.length === 0, message: `authoritative invariant violations: ${rt.violations.length}` }],
});
export const PREPARED_DAY_SCENARIOS = PREPARED_DAY_NAMES.map(preset);
