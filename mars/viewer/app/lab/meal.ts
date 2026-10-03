// Engine Lab preset `meal` (owner feedback §12, ITEMS.md): engine/scenarios/meal.ts live — a 6 ft
// table with a pot of stew, four bowls and spoons; four people take a bowl and a spoon each, serve
// themselves, sit on the camp chairs round the fire and eat until their bowls are empty. The per-tick
// driver is runMeal()'s loop body (submit each person's next step when the previous one is done, then
// step), split at the tick: start() = the first submits, tick() = after every rt.step(). Pure TS.
import type { ActionRecord } from '../../engine/actions/types.ts';
import type { Runtime } from '../../engine/runtime/runtime.ts';
import { MEAL_LAYOUT, mealRuntime, mealSteps } from '../../engine/scenarios/meal.ts';
import { provingGround } from '../../engine/scenes/proving-ground.ts';
import type { Scenario } from './scenarios.ts';

type Driver = { steps: ReturnType<typeof mealSteps>; recs: Record<string, ActionRecord[]>; busy: boolean; error?: string };
const drivers = new WeakMap<Runtime, Driver>();

/** One iteration of runMeal's loop before its rt.step(): submit whoever is ready for their next step. */
function advance(rt: Runtime) {
  const d = drivers.get(rt)!;
  let busy = false;
  for (const id of Object.keys(d.steps)) {
    const done = d.recs[id];
    const cur = done[done.length - 1];
    const spec = d.steps[id][done.length - 1];
    if (cur && (cur.status === 'failed' || cur.status === 'cancelled')) {
      d.error ??= `${id}: ${cur.verb} ${cur.status} ${cur.diagnostic?.code ?? ''} ${cur.diagnostic?.message ?? ''}`;
      continue;
    }
    const finished = !cur || cur.status === 'completed' || (spec?.until === 'occupied' && cur.phase === 'occupied');
    if (!finished) {
      busy = true;
      continue;
    }
    const next = d.steps[id][done.length];
    if (!next) continue;
    const r = rt.submit(next.verb, next.params);
    done.push(r);
    if (r.status === 'failed') d.error ??= `${id}: ${next.verb} refused ${r.diagnostic?.code ?? ''} ${r.diagnostic?.message ?? ''}`;
    busy = true;
  }
  d.busy = busy;
}

export const meal: Scenario = {
  name: 'meal',
  title: 'Meal round the fire (tables, bowls, eating)',
  description:
    'HYPOTHETICAL camp meal (engine/scenarios/meal.ts): four people take a bowl and a spoon from the table, serve themselves stew from the pot, walk to the camp chairs round the fire, sit (back to the chair, then down) and eat together until the bowls are empty (≈ 5 cycles of dip → lift → pause → return).',
  scene: provingGround,
  humans: () => [],
  build: () => {
    const rt = mealRuntime(provingGround());
    const steps = mealSteps();
    drivers.set(rt, { steps, recs: Object.fromEntries(Object.keys(steps).map((id) => [id, []])), busy: true });
    return rt;
  },
  start: advance,
  tick: advance,
  done: (rt) => {
    const d = drivers.get(rt)!;
    return !d.busy || !!d.error;
  },
  maxTicks: 20 * 180,
  focus: [MEAL_LAYOUT.fire.p[0], (MEAL_LAYOUT.fire.p[1] + MEAL_LAYOUT.table.p[1]) / 2, 5, 25],
  expect: (rt) => {
    const d = drivers.get(rt)!;
    const bowls = MEAL_LAYOUT.people.map((_, i) => rt.world.entities[`bowl${i + 1}`]);
    const left = bowls.map((b) => b?.contents?.fraction ?? 0);
    return [
      { ok: !d.error, message: d.error ?? 'every step accepted and completed' },
      { ok: !d.busy, message: d.busy ? 'still eating' : 'everyone finished' },
      { ok: rt.violations.length === 0, message: rt.violations.length ? `${rt.violations.length} violations, first: ${rt.violations[0].message}` : 'zero violations' },
      { ok: left.every((f) => f <= 1e-9), message: `bowls left ${left.map((f) => f.toFixed(2)).join(' / ')}` },
    ];
  },
};
