import type { Scenario } from './scenarios.ts';
import {
  readingRuntime,
  READING_SCENE,
  READING_BINDING,
} from '../../engine/scenarios/reading.ts';
import { readBook } from '../../engine/objects/reading.ts';
export const READING_SCENARIO: Scenario = {
  name: 'quiet-reading',
  title: 'Quiet reading · retained bookmark (hypothetical)',
  description:
    'Start reading at a usable table, interrupt and stand up, then explicitly resume the same bookmark. Four compressed sections; book remains supported in its original slot. No historical book or person is implied.',
  scene: () => READING_SCENE,
  humans: () => [],
  build: () => readingRuntime(),
  start: () => {},
  continuous: true,
  maxTicks: 36000,
  focus: [0, -0.5, 4, 110],
  hud: (rt) => {
    const s = readBook(rt, 'book');
    return 'code' in s
      ? [`${s.code}: ${s.message}`]
      : [
          `Reading: ${s.status} · section ${s.page}/${s.pages} · ${s.elapsed.toFixed(1)}/${READING_BINDING.duration}s`,
        ];
  },
  expect: (rt) => [
    {
      ok: rt.violations.length === 0,
      message: `authoritative violations: ${rt.violations.length}`,
    },
  ],
};
