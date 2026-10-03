import type { Scenario } from './scenarios.ts';
import { Runtime } from '../../engine/runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../../engine/runtime/invariants.ts';
import { Spatial } from '../../engine/spatial/service.ts';
import { createRegistry } from '../../engine/api/registry.ts';
import { groundSleepFixture } from '../../engine/scenarios/sleep.ts';
import { readSleep } from '../../engine/activities/sleep.ts';
import type { Vec2 } from '../../engine/core/math.ts';
export function sleepReadout(rt: Runtime) {
  const record = [...rt.records.values()].filter(r => r.verb === 'sleep').at(-1);
  return record ? readSleep(rt, record.id) : undefined;
}
const preset = (name: string, title: string, centre: Vec2, yaw: number): Scenario => ({
  name, title,
  description: 'Hypothetical free-handed rest on one grounded mat. Ordinary walking approaches and returns; Pause wakes safely and retains elapsed rest, Resume finishes the same purpose. No bed, active reload restoration, historical placement or new character rig.',
  scene: () => groundSleepFixture(centre, yaw).scene, humans: () => [],
  build: () => { const f = groundSleepFixture(centre, yaw); return new Runtime(f.world, createRegistry(), { spatial: new Spatial(f.scene) }, DEFAULT_INVARIANTS); },
  start: () => {}, continuous: true, maxTicks: 36000,
  focus: [centre[0], centre[1], 5, 120],
  hud: rt => { const s = sleepReadout(rt); return [s ? `Rest: ${s.mode} · ${s.elapsed.toFixed(1)}/${s.bindings.duration}s` : 'Choose Start sleep, then Play.']; },
  expect: rt => [{ ok: rt.violations.length === 0, message: `authoritative violations: ${rt.violations.length}` }],
});
export const SLEEP_SCENARIOS = [
  preset('ground-sleep', 'Supported ground sleep · retained purpose (hypothetical)', [0, 0], 0),
  preset('ground-sleep-rotated', 'Supported ground sleep · rotated mat (hypothetical)', [2, 1], 0.63),
];
