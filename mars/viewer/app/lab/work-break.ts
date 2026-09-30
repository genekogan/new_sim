import { Runtime } from '../../engine/runtime/runtime.ts';
import { createRegistry, ENGINE_INVARIANTS, servicesFor } from '../../engine/api/registry.ts';
import { classroomScene } from '../../engine/scenarios/classroom.ts';
import { workBreakWorld } from '../../engine/scenarios/work-break.ts';
import type { Scenario } from './scenarios.ts';

const preset = (count: 4 | 8): Scenario => ({
  name: `work-break-${count}`, title: `Work → shared food break · ${count}-guest room (hypothetical)`,
  description: 'Keep one world: interrupt unfinished notes, serve stew with a companion, gather and eat, return utensils, then resume the same notes. Explicit live commands; no automatic day schedule or historical claims.',
  scene: classroomScene, humans: () => [],
  build: () => { const world = workBreakWorld(count); return new Runtime(world, createRegistry(), servicesFor({ classroom: classroomScene() })(world), ENGINE_INVARIANTS); },
  start: () => {}, continuous: true, maxTicks: 20 * 1800, focus: [-3, -2, 14, 105],
  expect: (rt) => [{ ok: rt.violations.length === 0, message: `authoritative invariant violations: ${rt.violations.length}` }],
});
export const WORK_BREAK_SCENARIOS = [preset(4), preset(8)];
