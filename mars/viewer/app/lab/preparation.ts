import type { Runtime } from '../../engine/runtime/runtime.ts';
import {
  readFoodPreparation,
  PREPARATION_MIX_TICKS,
} from '../../engine/activities/prepare-food.ts';
import { preparationRuntime } from '../../engine/scenarios/preparation.ts';
import { classroomScene } from '../../engine/scenarios/classroom.ts';
import type { Scenario } from './scenarios.ts';

/** Detached, authoritative quantities and supports; no renderer-owned food state. */
export function preparationReadout(rt: Runtime) {
  const ids = ['beans', 'greens', 'pot', 'spoon'];
  if (ids.some((id) => !rt.world.entities[id])) return undefined;
  const state = readFoodPreparation(rt, 'pot');
  const record = [...rt.records.values()]
    .filter((r) => r.verb === 'prepare_food')
    .at(-1);
  return {
    preparation: state ? structuredClone(state) : null,
    phase: record?.phase ?? 'idle',
    status: record?.status ?? 'idle',
    active: !!record && rt.isActive(record.id),
    mixedTicks: state?.mixedTicks ?? 0,
    mixTicks: PREPARATION_MIX_TICKS,
    items: ids.map((id) => {
      const e = rt.world.entities[id];
      return {
        id,
        def: e.def,
        pose: structuredClone(e.pose),
        support: structuredClone(e.support),
        contents: e.contents ? { ...e.contents } : null,
      };
    }),
    claims: Object.fromEntries(
      [
        'actor:cook',
        'hand:cook:left',
        'hand:cook:right',
        'entity:table',
        'holds:cook',
        ...ids.map((id) => `entity:${id}`),
        ...['r0c1', 'r0c2', 'r0c3', 'r0c4'].map(
          (id) => `surface-slot:table#${id}`,
        ),
      ].map((key) => [key, rt.holder(key)]),
    ),
  };
}

const scenario = (
  name: string,
  title: string,
  yaw: number,
  x: number,
  z: number,
): Scenario => ({
  name,
  title,
  description:
    'Hypothetical cold dish: transfer two full ingredient bowls into the same supported pot, then mix to produce exactly two full servings. Interrupt and explicitly resume retained deposits. No heat, chopping, historical recipe or active reload restoration.',
  scene: classroomScene,
  humans: () => [],
  build: () => preparationRuntime(yaw, x, z),
  start: () => {},
  continuous: true,
  maxTicks: 36000,
  focus: [x, z, 3.6, 110],
  hud: (rt) => {
    const s = preparationReadout(rt);
    if (!s) return ['Preparation objects are unavailable.'];
    return [
      `Preparation: ${s.phase} · ${s.preparation?.complete ? `${Math.floor((rt.world.entities.pot.contents?.fraction ?? 0) * 4)} servings remain` : 'unfinished'} · mixing ${s.mixedTicks}/${s.mixTicks}`,
    ];
  },
  expect: (rt) => [
    {
      ok: rt.violations.length === 0,
      message: `authoritative violations: ${rt.violations.length}`,
    },
  ],
});

export const PREPARATION_SCENARIOS: Scenario[] = [
  scenario(
    'cold-preparation',
    'Cold meal preparation · retained quantities (hypothetical)',
    0,
    0,
    0,
  ),
  scenario(
    'cold-preparation-rotated',
    'Cold meal preparation · rotated table (hypothetical)',
    Math.PI / 2,
    4,
    3,
  ),
];
