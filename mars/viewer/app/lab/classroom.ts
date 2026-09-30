import { Runtime } from '../../engine/runtime/runtime.ts';
import { createRegistry, ENGINE_INVARIANTS, servicesFor } from '../../engine/api/registry.ts';
import { classroomParams, classroomScene, classroomSessionId, classroomWorld } from '../../engine/scenarios/classroom.ts';
import { readClassroom } from '../../engine/activities/index.ts';
import type { Scenario } from './scenarios.ts';

export function startClassroom(rt: Runtime, count: 4 | 8) {
  return rt.submit('classroom_session', classroomParams(count));
}
const preset = (count: 4 | 8): Scenario => ({
  name: `classroom-${count}`, title: `Playable classroom · ${count} guests (hypothetical)`,
  description: 'Start a live lightning-talk session. People arrive, sit, present, take questions, rotate, converse and leave. Intervene while it runs. Ground floor, fixed furniture; no historical claims.',
  scene: classroomScene, humans: () => [],
  build: () => { const w = classroomWorld(count); return new Runtime(w, createRegistry(), servicesFor({ classroom: classroomScene() })(w), ENGINE_INVARIANTS); },
  start: () => {}, continuous: true, maxTicks: 20 * 1800, focus: count === 8 ? [0, 3, 16, 105] : [0, 1, 13, 105],
  expect: (rt) => {
    const id = classroomSessionId(rt), r = id ? rt.records.get(id) : undefined;
    const state = id ? readClassroom(rt, id) : undefined;
    return [
      { ok: rt.violations.length === 0, message: `authoritative invariant violations: ${rt.violations.length}` },
      { ok: r?.status !== 'failed', message: r ? `session ${r.status} · ${state?.phase}${r.diagnostic ? ` · ${r.diagnostic.code}` : ''}` : 'Ready: start a session' },
    ];
  },
});
export const CLASSROOM_SCENARIOS = [preset(4), preset(8)];
