import type { Scenario } from './scenarios.ts';
import {
  musicRuntime,
  MUSIC_BINDING,
} from '../../engine/scenarios/computer-music.ts';
import { READING_SCENE } from '../../engine/scenarios/reading.ts';
import { musicStation } from '../../engine/activities/computer-music.ts';
export const MUSIC_SCENARIO: Scenario = {
  name: 'computer-music',
  title: 'Computer music · performer and listeners (hypothetical)',
  description:
    'Make an original short electronic score at a usable computer. Enable sound, start the session and Play; listeners approach independently. Interrupt safely, resume the retained program, or direct a listener away. Current seated computer poses; no acoustic-instrument or finger choreography claim.',
  scene: () => READING_SCENE,
  humans: () => [],
  build: () => musicRuntime(),
  start: () => {},
  continuous: true,
  maxTicks: 36000,
  focus: [0, -1, 6, 100],
  hud: (rt) => {
    const s = musicStation(rt, MUSIC_BINDING.station);
    return s && !('code' in s)
      ? [
          `Music: ${s.status} · ${s.elapsed.toFixed(1)}/${s.duration}s · ${s.note === null ? 'silent' : `note ${s.note}`}`,
        ]
      : [
          'Start a computer music session. Sound is an optional browser expression.',
        ];
  },
  expect: (rt) => [
    {
      ok: rt.violations.length === 0,
      message: `authoritative violations: ${rt.violations.length}`,
    },
  ],
};
