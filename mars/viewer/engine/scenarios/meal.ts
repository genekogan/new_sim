// Meal scenario (owner feedback §12, ITEMS.md): a 6 ft table with a pot of stew, four empty bowls and
// four spoons; a campfire with four camp chairs round it. Four people each take a bowl and a spoon,
// serve themselves from the pot, walk to a chair, sit (approach point → turn → sit-down) and eat until
// their bowls are empty — together round the fire. Used by engine/test/meal.test.ts; plain data +
// a tiny per-person step driver, so the Lab can replay the same thing later.
//
// HYPOTHETICAL: an illustrative camp meal on the proving ground's open lawn, not a documented event.
import type { ActionDef, ActionRecord, Diagnostic } from '../actions/types.ts';
import { dcos, dsin, rot2, type Vec2 } from '../core/math.ts';
import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { provingGround } from '../scenes/proving-ground.ts';
import { Spatial } from '../spatial/service.ts';
import type { SpatialScene } from '../spatial/types.ts';
import { walkTo } from '../locomotion/walk.ts';
import { SOCIAL_ACTIONS } from '../social/actions.ts';
import { ITEM_ACTIONS } from '../items/actions.ts';
import { itemEntity, placeOnSlot, surfaceSlot } from '../items/model.ts';
import { addAll, emptyWorld, human } from '../world/factory.ts';
import type { Entity, Provenance, WorldState } from '../world/types.ts';

const HYPO: Provenance = { origin: 'test-fixture', confidence: 'hypothetical', note: 'meal scenario (ITEMS.md) — not historical' };

export const MEAL_LAYOUT = {
  table: { id: 'table', p: [-6, -8.5] as Vec2, yaw: 0 },
  fire: { id: 'fire', p: [-6, -4] as Vec2 },
  /** Chairs on this radius round the fire, seats facing it. */
  chairRadius: 2.4,
  pot: { id: 'pot', slot: 'r1c2', food: 'stew' },
  /** Per person: start point (table frame), bowl / spoon slots, order of takes (the inner one first, so each
   * ends ≤ 0.95 m from the pot and reaches the outer one without stepping), chair. */
  people: [
    { id: 'p1', start: [-1.0, -3.0] as Vec2, bowl: 'r0c0', spoon: 'r0c1', bowlFirst: false, chair: 'chair-sw' },
    { id: 'p2', start: [1.0, -3.0] as Vec2, bowl: 'r0c4', spoon: 'r0c5', bowlFirst: true, chair: 'chair-se' },
    { id: 'p3', start: [-1.0, 2.6] as Vec2, bowl: 'r2c0', spoon: 'r2c1', bowlFirst: false, chair: 'chair-nw' },
    { id: 'p4', start: [1.0, 2.6] as Vec2, bowl: 'r2c4', spoon: 'r2c5', bowlFirst: true, chair: 'chair-ne' },
  ],
  chairs: [
    { id: 'chair-ne', angle: Math.PI / 4 },
    { id: 'chair-nw', angle: (3 * Math.PI) / 4 },
    { id: 'chair-sw', angle: (5 * Math.PI) / 4 },
    { id: 'chair-se', angle: (7 * Math.PI) / 4 },
  ],
} as const;

const fixture = (id: string, def: string, p: Vec2, yaw: number): Entity => ({ id, def, kind: 'fixture', pose: { p: [p[0], 0, p[1]], yaw }, provenance: HYPO });

export function mealRegistry(): Map<string, ActionDef> {
  return new Map<string, ActionDef>([walkTo, ...SOCIAL_ACTIONS, ...ITEM_ACTIONS].map((a) => [a.verb, a]));
}

/** Proving-ground world with the table, pot, bowls, spoons, fire, chairs and four people. */
export function mealWorld(base: SpatialScene = provingGround()): WorldState {
  const L = MEAL_LAYOUT;
  const T = L.table;
  const tp = (q: Vec2): Vec2 => {
    const r = rot2(q, T.yaw);
    return [T.p[0] + r[0], T.p[1] + r[1]];
  };
  const es: Entity[] = [fixture(T.id, 'table-6ft', T.p, T.yaw), fixture(L.fire.id, 'campfire', L.fire.p, 0)];
  for (const c of L.chairs) {
    const p: Vec2 = [L.fire.p[0] + L.chairRadius * dcos(c.angle), L.fire.p[1] + L.chairRadius * dsin(c.angle)];
    // the seat faces local +z (world yaw + π/2): turn it to face the fire
    es.push(fixture(c.id, 'camp-chair', p, c.angle + Math.PI - Math.PI / 2));
  }
  for (const q of L.people) {
    const s = tp(q.start);
    es.push(human(q.id, s[0], s[1], { yaw: T.yaw + (q.start[1] < 0 ? Math.PI / 2 : -Math.PI / 2), provenance: HYPO }));
  }
  const w = addAll(emptyWorld('proving-ground', base, 'meal'), ...es);
  const put = (id: string, def: string, slot: string, contents?: { food: string; fraction: number }) => {
    const e = itemEntity(id, def, [0, 0, 0], 0, { provenance: HYPO, contents });
    w.entities[id] = e;
    const s = surfaceSlot(w, `${T.id}#${slot}`);
    if ('code' in s) throw new Error(s.message);
    placeOnSlot(e, s, T.yaw);
  };
  put(L.pot.id, 'pot', L.pot.slot, { food: L.pot.food, fraction: 1 });
  L.people.forEach((q, i) => {
    put(`bowl${i + 1}`, 'bowl', q.bowl, { food: L.pot.food, fraction: 0 });
    put(`spoon${i + 1}`, 'spoon', q.spoon);
  });
  return w;
}

export function mealRuntime(base: SpatialScene = provingGround()) {
  return new Runtime(mealWorld(base), mealRegistry(), { spatial: new Spatial(base) }, DEFAULT_INVARIANTS);
}

export type MealStep = { verb: string; params: Record<string, unknown>; /** done when (default: completed) */ until?: 'occupied' };

/** Each person's steps: take bowl + spoon (bowl left, spoon right), serve from the pot, sit, eat. */
export function mealSteps(): Record<string, MealStep[]> {
  const out: Record<string, MealStep[]> = {};
  MEAL_LAYOUT.people.forEach((q, i) => {
    const bowl = `bowl${i + 1}`, spoon = `spoon${i + 1}`;
    const takes: MealStep[] = [
      { verb: 'take_item', params: { actor: q.id, item: bowl, hand: 'left' } },
      { verb: 'take_item', params: { actor: q.id, item: spoon, hand: 'right' } },
    ];
    if (!q.bowlFirst) takes.reverse();
    out[q.id] = [
      ...takes,
      { verb: 'serve', params: { actor: q.id, pot: MEAL_LAYOUT.pot.id, bowl } },
      { verb: 'sit', params: { actor: q.id, slot: `${q.chair}#seat` }, until: 'occupied' },
      { verb: 'eat', params: { actor: q.id, bowl, spoon } },
    ];
  });
  return out;
}

/**
 * Drive the per-person steps on `rt` until everyone has finished eating (or `maxTicks`). Throws with
 * the diagnostic if any step fails. Returns the step records per person.
 */
export function runMeal(rt: Runtime, opts: { maxTicks?: number; onTick?: (rt: Runtime) => void } = {}): Record<string, ActionRecord[]> {
  const steps = mealSteps();
  const recs: Record<string, ActionRecord[]> = {};
  for (const id of Object.keys(steps)) recs[id] = [];
  const max = opts.maxTicks ?? 20 * 180;
  const failure = (r: ActionRecord): Error => {
    const d = r.diagnostic as Diagnostic | undefined;
    return new Error(`meal: ${r.verb} ${JSON.stringify(r.params)} ${r.status} at tick ${rt.tick}: ${d?.code} ${d?.message}`);
  };
  for (let n = 0; n < max; n++) {
    let busy = false;
    for (const id of Object.keys(steps)) {
      const done = recs[id];
      const cur = done[done.length - 1];
      const spec = steps[id][done.length - 1];
      if (cur && (cur.status === 'failed' || cur.status === 'cancelled')) throw failure(cur);
      const finished = !cur || cur.status === 'completed' || (spec?.until === 'occupied' && cur.phase === 'occupied');
      if (!finished) { busy = true; continue; }
      const next = steps[id][done.length];
      if (!next) continue;
      const r = rt.submit(next.verb, next.params);
      done.push(r);
      if (r.status === 'failed') throw failure(r);
      busy = true;
    }
    if (!busy) return recs;
    rt.step();
    opts.onTick?.(rt);
  }
  throw new Error(`meal: not finished after ${max} ticks`);
}
