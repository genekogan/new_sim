import { Runtime } from '../../engine/runtime/runtime.ts';
import { createRegistry, ENGINE_INVARIANTS, servicesFor } from '../../engine/api/registry.ts';
import { designStudioScene, designStudioWorld } from '../../engine/scenarios/design-studio.ts';
import type { Scenario } from './scenarios.ts';

export const DESIGN_STUDIO: Scenario = {
  name: 'design-studio', title: 'Independent design studio · critique and continuing projects (hypothetical)',
  description: 'A non-Mars room with its own people, furniture and project bindings. Interrupt project notes, start the critique, then commit a purposeful routine and attendee follow-ups. The same authoritative activities handle questions, discussion, lunch, quiet rest and returning to work. Authored roles and one fixed usable arrangement; no historical claims or autonomous choices.',
  scene: designStudioScene, humans: () => [],
  build: () => { const world = designStudioWorld(); return new Runtime(world, createRegistry(), servicesFor({ 'design-studio': designStudioScene() })(world), ENGINE_INVARIANTS); },
  start: () => {}, continuous: true, maxTicks: 20 * 1800, focus: [-1, -1, 15, 105],
  expect: rt => [{ ok: rt.violations.length === 0, message: `authoritative invariant violations: ${rt.violations.length}` }],
};
