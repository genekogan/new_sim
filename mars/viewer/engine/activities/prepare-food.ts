// Hypothetical cold two-ingredient dish. Quantity commits only at a supported deposit.
import { z } from 'zod';
import type { ActionDef, Diagnostic, Reservation } from '../actions/types.ts';
import type { Entity } from '../world/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import { DT } from '../runtime/runtime.ts';
import { REACH_TIME } from '../items/actions.ts';
import { hashOf } from '../core/hash.ts';
import { rot2, type Vec3 } from '../core/math.ts';
import {
  heldBy,
  reachStation,
  reachOf,
  BODY_REACH,
  followHand,
  surfaceSlot,
} from '../items/model.ts';
import { bodyFrame, carryHand, lerp3, smooth } from '../items/body.ts';

export interface FoodPreparation {
  kind: 'cold-two-ingredient-v1';
  ingredients: [
    { item: string; food: string; initial: number; deposited: number },
    { item: string; food: string; initial: number; deposited: number },
  ];
  mixedTicks: number;
  complete: boolean;
}
// Integration adds this optional property to Entity; keeping this new module independent.
type FoodEntity = Entity & { foodPreparation?: FoodPreparation };
export interface PrepareFoodParams {
  actor: string;
  spoon: string;
  pot: string;
  ingredients: [string, string];
}
type Program = { table: string; binding: string; state: FoodPreparation };
type Exec = Program & {
  id: string;
  p: PrepareFoodParams;
  phase: string;
  ticks: number;
  index: number;
  child?: string;
  stopping: boolean;
  error?: Diagnostic;
  from?: Vec3;
  started: number;
  initialized: boolean;
  afterReturn?: 'to-pot' | 'starting' | 'completed' | 'stopped';
};
const SCOOP_TICKS = 20,
  DEPOSIT_TICKS = 20;
export const PREPARATION_MIX_TICKS = 60;
const RETURN_TICKS = Math.ceil(REACH_TIME / DT);
const QUANTITY = 0.25; // quarter bowl per spoon cycle; full bowl = quarter pot.
const diag = (
  code: string,
  message: string,
  subjects: string[],
): Diagnostic => ({ code: `prepare_food.${code}`, message, subjects });
const foodEntity = (rt: Runtime, id: string): FoodEntity | undefined =>
  rt.world.entities[id];
export const readFoodPreparation = (rt: Runtime, pot: string) =>
  foodEntity(rt, pot)?.foodPreparation;
const ids = (p: PrepareFoodParams) => [p.pot, ...p.ingredients];
function binding(rt: Runtime, p: PrepareFoodParams, table: string) {
  return hashOf([
    rt.world.entities[table],
    ...ids(p).map((id) => {
      const e = rt.world.entities[id];
      return e && { id, def: e.def, pose: e.pose, support: e.support };
    }),
  ]);
}
function clearHand(rt: Runtime, ex: Exec) {
  const actor = rt.world.entities[ex.p.actor];
  if (!actor?.human) return;
  // Never erase a directive's hand expression after yielding.
  if (actor.human.activity === 'reach') actor.human.activity = 'idle';
  if (actor.human.hands) delete actor.human.hands.right;
}
function stop(rt: Runtime, ex: Exec, error?: Diagnostic) {
  ex.stopping = true;
  ex.error ??= error;
  if (ex.child && rt.isActive(ex.child)) rt.cancel(ex.child);
  // Retain the current held hand until the parent drains its child and withdraws.
}
function beginReturn(rt: Runtime, ex: Exec, after: Exec['afterReturn']) {
  const actor = rt.world.entities[ex.p.actor];
  ex.from = actor.human!.hands?.right ?? carryHand(bodyFrame(actor), 'right');
  ex.ticks = 0;
  ex.phase = 'returning';
  ex.afterReturn = after;
}
function returnHand(rt: Runtime, ex: Exec): boolean {
  const actor = rt.world.entities[ex.p.actor],
    spoon = rt.world.entities[ex.p.spoon];
  if (
    spoon?.support?.kind !== 'in-hand' ||
    spoon.support.by !== ex.p.actor ||
    spoon.support.hand !== 'right'
  ) {
    clearHand(rt, ex);
    return true;
  }
  ex.ticks++;
  handPoint(
    rt,
    ex,
    lerp3(
      ex.from!,
      carryHand(bodyFrame(actor), 'right'),
      smooth(ex.ticks / RETURN_TICKS),
    ),
  );
  if (ex.ticks < RETURN_TICKS) return false;
  // The final published hand/item position already equals ordinary carry maintenance.
  clearHand(rt, ex);
  return true;
}
function stateProblem(
  rt: Runtime,
  p: PrepareFoodParams,
  state: FoodPreparation,
): Diagnostic | undefined {
  if (
    state.kind !== 'cold-two-ingredient-v1' ||
    !Array.isArray(state.ingredients) ||
    state.ingredients.length !== 2 ||
    !Number.isInteger(state.mixedTicks) ||
    state.mixedTicks < 0 ||
    state.mixedTicks > PREPARATION_MIX_TICKS ||
    typeof state.complete !== 'boolean'
  )
    return diag('state', `${p.pot} has invalid cold preparation progress`, [
      p.pot,
    ]);
  let deposited = 0;
  for (let i = 0; i < 2; i++) {
    const s = state.ingredients[i],
      source = rt.world.entities[p.ingredients[i]];
    if (
      !s ||
      s.item !== p.ingredients[i] ||
      s.initial !== 1 ||
      !Number.isFinite(s.deposited) ||
      s.deposited < 0 ||
      s.deposited > 1 ||
      s.deposited % QUANTITY !== 0 ||
      source?.contents?.food !== s.food ||
      source.contents.fraction !== s.initial - s.deposited
    )
      return diag(
        'ingredient-changed',
        `${p.ingredients[i]} no longer matches conserved preparation in ${p.pot}`,
        [p.ingredients[i], p.pot],
      );
    deposited += s.deposited;
  }
  const pot = rt.world.entities[p.pot];
  if (
    pot.contents?.fraction !== deposited / 4 ||
    pot.contents.food !== 'hypothetical cold shared dish' ||
    (state.mixedTicks > 0 && deposited !== 2) ||
    state.complete !== (state.mixedTicks === PREPARATION_MIX_TICKS)
  )
    return diag(
      'state',
      `${p.pot} contents and completion disagree with committed ingredients/mixing`,
      [p.pot],
    );
}
function dispatch(
  rt: Runtime,
  ex: Exec,
  verb: string,
  params: unknown,
  phase: string,
) {
  const child = rt.submit(verb, params, { parent: ex.id, preempt: false });
  ex.child = child.id;
  ex.phase = phase;
  if (child.status === 'failed') stop(rt, ex, child.diagnostic);
}
function approach(rt: Runtime, ex: Exec, item: string, phase: string) {
  const actor = rt.world.entities[ex.p.actor],
    e = rt.world.entities[item];
  const station = reachStation(
    rt,
    actor,
    e.pose.p,
    rt.world.entities[ex.table],
    item,
  );
  if ('code' in station) {
    stop(rt, ex, station);
    return;
  }
  dispatch(
    rt,
    ex,
    'walk_to',
    { actor: ex.p.actor, x: station.p[0], z: station.p[1], face: station.yaw },
    phase,
  );
}
function handPoint(rt: Runtime, ex: Exec, point: Vec3) {
  const actor = rt.world.entities[ex.p.actor],
    spoon = rt.world.entities[ex.p.spoon];
  actor.human!.activity = 'reach';
  actor.human!.hands = { ...actor.human!.hands, right: point };
  followHand(spoon, point, actor.pose.yaw);
}
const id = z.string().min(1).max(80);
export const prepareFood: ActionDef<PrepareFoodParams, Program, Exec> = {
  verb: 'prepare_food',
  description:
    'Hypothetical cold dish from exactly two full supported ingredient bowls: eight held-spoon scoops/deposits, then three seconds of mixing. Partial conserved contents require explicit retry.',
  schema: z.strictObject({
    actor: id,
    spoon: id,
    pot: id,
    ingredients: z.tuple([id, id]),
  }),
  drivesReservedHands: (rec) =>
    [
      'scooping',
      'depositing',
      'mix-entry',
      'mixing',
      'returning',
      'stopping',
    ].includes(rec.phase ?? ''),
  reservations(w, p) {
    const support = w.entities[p.pot]?.support;
    return [
      { resource: `actor:${p.actor}`, mode: 'exclusive' },
      { resource: `hand:${p.actor}:right`, mode: 'exclusive' },
      ...[p.spoon, ...ids(p)].map(
        (id): Reservation => ({ resource: `entity:${id}`, mode: 'exclusive' }),
      ),
      ...(support?.kind === 'resting-on'
        ? [
            {
              resource: `entity:${support.on}`,
              mode: 'exclusive',
            } as Reservation,
          ]
        : []),
    ];
  },
  yieldTo: (_rt, self) => [self.id],
  onDirective(rt, ex, by, claims, ancestors) {
    if (
      by.id !== ex.id &&
      !ancestors.includes(ex.id) &&
      claims.some(
        (q) =>
          q.resource === `actor:${ex.p.actor}` ||
          q.resource === `hand:${ex.p.actor}:right`,
      )
    )
      stop(
        rt,
        ex,
        diag(
          'directed',
          `${ex.p.actor} received ${by.verb} ${by.id}; partial preparation retained`,
          [ex.p.actor, by.id, ex.p.pot],
        ),
      );
  },
  plan(rt, p) {
    const fail = (code: string, message: string, subjects: string[]) => ({
      ok: false as const,
      diagnostic: diag(code, message, subjects),
    });
    if (new Set([p.actor, p.spoon, ...ids(p)]).size !== 5)
      return fail(
        'duplicate',
        'Preparation roles must name five distinct objects/actor',
        [p.actor, p.spoon, ...ids(p)],
      );
    const actor = rt.world.entities[p.actor],
      spoon = rt.world.entities[p.spoon],
      pot = foodEntity(rt, p.pot);
    if (
      !actor?.human ||
      actor.human.level !== 0 ||
      actor.human.activity !== 'idle' ||
      actor.human.grip
    )
      return fail(
        'actor',
        `${p.actor} must stand idle on ground with ordinary free hands`,
        [p.actor],
      );
    if (
      heldBy(rt.world, p.actor).some(
        (q) => q.item.id !== p.spoon || q.hand !== 'right',
      )
    )
      return fail(
        'hands',
        `${p.actor} must hold only ${p.spoon} in the right hand or have empty hands`,
        [p.actor, p.spoon],
      );
    if (
      !spoon ||
      spoon.def !== 'spoon' ||
      (spoon.support?.kind === 'in-hand' &&
        (spoon.support.by !== p.actor || spoon.support.hand !== 'right'))
    )
      return fail(
        'spoon',
        `${p.spoon} must be an available spoon for ${p.actor}`,
        [p.actor, p.spoon],
      );
    if (!pot || pot.def !== 'pot' || pot.support?.kind !== 'resting-on')
      return fail('pot', `${p.pot} must be the supported serving pot`, [p.pot]);
    const table = pot.support.on,
      support = rt.world.entities[table];
    if (
      !support ||
      support.def !== 'table-6ft' ||
      support.support?.kind !== 'ground' ||
      support.pose.p[1] !== 0 ||
      !rt.services.spatial ||
      rt.services.spatial.base.links.some((q: { usable: boolean }) => q.usable)
    )
      return fail(
        'scope',
        `${table} needs a ground table in a ground-only arrangement`,
        [table, p.pot],
      );
    const slots = new Set<string>();
    for (const item of ids(p)) {
      const e = rt.world.entities[item];
      if (
        !e ||
        (item !== p.pot && e.def !== 'bowl') ||
        e.support?.kind !== 'resting-on' ||
        e.support.on !== table ||
        !e.support.slot
      )
        return fail(
          'ingredient-support',
          `${item} must rest in a slot on ${table}`,
          [item, table],
        );
      if (slots.has(e.support.slot))
        return fail(
          'slot-overlap',
          `${item} shares ${table}#${e.support.slot} with another preparation container`,
          [item, table],
        );
      slots.add(e.support.slot);
      const slot = surfaceSlot(rt.world, `${table}#${e.support.slot}`);
      if ('code' in slot || hashOf(slot.p) !== hashOf(e.pose.p))
        return fail(
          'support-position',
          `${item} no longer matches its slot on ${table}`,
          [item, table],
        );
      const station = reachStation(rt, actor, e.pose.p, support, item);
      if ('code' in station) return { ok: false, diagnostic: station };
    }
    if (
      !(
        spoon.support?.kind === 'in-hand' ||
        (spoon.support?.kind === 'resting-on' && spoon.support.on === table)
      )
    )
      return fail(
        'spoon-support',
        `${p.spoon} needs a supported slot on ${table} or ${p.actor}'s right hand`,
        [p.spoon, table],
      );
    let state = pot.foodPreparation;
    if (!state) {
      if ((pot.contents?.fraction ?? 0) !== 0)
        return fail(
          'pot-not-empty',
          `${p.pot} must be empty to begin this dish`,
          [p.pot],
        );
      if (
        p.ingredients.some(
          (item) => rt.world.entities[item].contents?.fraction !== 1,
        )
      )
        return fail(
          'ingredient',
          `${p.ingredients.join(' and ')} must each contain one finite full bowl`,
          p.ingredients,
        );
      state = {
        kind: 'cold-two-ingredient-v1',
        ingredients: p.ingredients.map((item) => ({
          item,
          food: rt.world.entities[item].contents!.food,
          initial: 1,
          deposited: 0,
        })) as FoodPreparation['ingredients'],
        mixedTicks: 0,
        complete: false,
      };
    } else {
      const problem = stateProblem(rt, p, state);
      if (problem) return { ok: false, diagnostic: problem };
      if (state.complete)
        return fail('already-complete', `${p.pot} is already prepared`, [
          p.pot,
        ]);
    }
    // A foreign lease is refused during planning; own hierarchical children inherit leases.
    for (const q of prepareFood.reservations(rt.world, p))
      if (rt.holder(q.resource).length)
        return fail(
          'owned',
          `${q.resource} is owned by ${rt.holder(q.resource).join(', ')}`,
          [p.actor, q.resource.slice(q.resource.indexOf(':') + 1)],
        );
    return {
      ok: true,
      program: {
        table,
        binding: binding(rt, p, table),
        state: structuredClone(state),
      },
    };
  },
  start(rt, p, program, action) {
    return {
      ...program,
      id: action,
      p,
      phase: 'starting',
      ticks: 0,
      index: 0,
      stopping: false,
      started: rt.tick,
      initialized: false,
    };
  },
  step(rt, ex) {
    if (!ex.stopping) {
      const pot = foodEntity(rt, ex.p.pot);
      if (!ex.initialized && pot) {
        if (!pot.foodPreparation) {
          if ((pot.contents?.fraction ?? 0) !== 0) {
            stop(
              rt,
              ex,
              diag(
                'state-changed',
                `${ex.p.pot} gained contents after admission`,
                [ex.p.pot],
              ),
            );
          } else {
            pot.foodPreparation = ex.state;
            pot.contents = {
              food: 'hypothetical cold shared dish',
              fraction: 0,
            };
          }
        }
        ex.state = pot.foodPreparation ?? ex.state;
        ex.initialized = true;
      }
      if (ex.initialized && pot?.foodPreparation !== ex.state) {
        stop(
          rt,
          ex,
          diag(
            'state-changed',
            `${ex.p.pot} preparation state was replaced or removed`,
            [ex.p.pot],
          ),
        );
      }
      if (binding(rt, ex.p, ex.table) !== ex.binding)
        stop(
          rt,
          ex,
          diag(
            'support-changed',
            `${ex.table} or its ingredient/pot supports moved during preparation`,
            [ex.table, ...ids(ex.p)],
          ),
        );
      const problem = stateProblem(rt, ex.p, ex.state);
      if (problem) stop(rt, ex, problem);
      if (rt.tick - ex.started > 2400)
        stop(
          rt,
          ex,
          diag(
            'timeout',
            `${ex.p.actor}'s bounded preparation exceeded 120 seconds`,
            [ex.p.actor, ex.p.pot],
          ),
        );
    }
    if (ex.stopping) {
      if (ex.child && rt.isActive(ex.child)) {
        rt.cancel(ex.child);
        return { status: 'running', phase: 'stopping' };
      }
      if (ex.phase !== 'returning' || ex.afterReturn !== 'stopped')
        beginReturn(rt, ex, 'stopped');
      if (!returnHand(rt, ex)) return { status: 'running', phase: 'returning' };
      return ex.error
        ? { status: 'failed', diagnostic: ex.error }
        : { status: 'completed', outputs: { partial: true } };
    }
    if (ex.phase === 'returning') {
      if (!returnHand(rt, ex)) return { status: 'running', phase: 'returning' };
      if (ex.afterReturn === 'completed')
        return { status: 'completed', outputs: { pot: ex.p.pot, servings: 2 } };
      if (ex.afterReturn === 'to-pot') {
        approach(rt, ex, ex.p.pot, 'to-pot');
        return { status: 'running', phase: ex.phase };
      }
      ex.phase = 'starting';
    }
    if (ex.child) {
      if (rt.isActive(ex.child)) return { status: 'running', phase: ex.phase };
      const child = rt.records.get(ex.child)!;
      ex.child = undefined;
      if (child.status !== 'completed') {
        stop(
          rt,
          ex,
          child.diagnostic ??
            diag('child', `${child.verb} ${child.id} stopped`, [child.id]),
        );
        return { status: 'running', phase: 'stopping' };
      }
      if (ex.phase === 'taking') ex.phase = 'starting';
      else {
        ex.phase =
          ex.phase === 'to-source'
            ? 'scooping'
            : ex.phase === 'to-pot'
              ? 'depositing'
              : 'mix-entry';
        ex.ticks = 0;
        ex.from = carryHand(bodyFrame(rt.world.entities[ex.p.actor]), 'right');
      }
    }
    if (ex.phase === 'starting') {
      if (rt.world.entities[ex.p.spoon].support?.kind !== 'in-hand')
        dispatch(
          rt,
          ex,
          'take_item',
          { actor: ex.p.actor, item: ex.p.spoon, hand: 'right' },
          'taking',
        );
      else {
        ex.index = ex.state.ingredients.findIndex((q) => q.deposited < 1);
        approach(
          rt,
          ex,
          ex.index < 0 ? ex.p.pot : ex.p.ingredients[ex.index],
          ex.index < 0 ? 'to-mix' : 'to-source',
        );
      }
      return { status: 'running', phase: ex.phase };
    }
    const target =
      rt.world.entities[
        ex.phase === 'scooping' ? ex.p.ingredients[ex.index] : ex.p.pot
      ];
    const actor = rt.world.entities[ex.p.actor],
      spoon = rt.world.entities[ex.p.spoon];
    if (
      spoon.support?.kind !== 'in-hand' ||
      spoon.support.by !== ex.p.actor ||
      spoon.support.hand !== 'right' ||
      reachOf(actor, target.pose.p) > BODY_REACH
    ) {
      stop(
        rt,
        ex,
        diag(
          'reach-lost',
          `${ex.p.actor} must hold ${spoon.id} within ordinary reach of ${target.id}`,
          [ex.p.actor, spoon.id, target.id],
        ),
      );
      return { status: 'running', phase: 'stopping' };
    }
    ex.ticks++;
    if (ex.phase === 'mixing' || ex.phase === 'mix-entry') {
      const k = (ex.state.mixedTicks % 20) / 5,
        edge = Math.floor(k),
        f = k - edge;
      const corners = [
        [0.07, 0],
        [0, 0.07],
        [-0.07, 0],
        [0, -0.07],
        [0.07, 0],
      ];
      const offset = rot2(
        [
          corners[edge][0] * (1 - f) + corners[edge + 1][0] * f,
          corners[edge][1] * (1 - f) + corners[edge + 1][1] * f,
        ],
        target.pose.yaw,
      );
      const point: Vec3 = [
        target.pose.p[0] + offset[0],
        target.pose.p[1] + 0.1,
        target.pose.p[2] + offset[1],
      ];
      if (ex.phase === 'mix-entry') {
        handPoint(
          rt,
          ex,
          lerp3(ex.from!, point, smooth(ex.ticks / RETURN_TICKS)),
        );
        if (ex.ticks === RETURN_TICKS) {
          ex.phase = 'mixing';
          ex.ticks = 0;
        }
      } else {
        handPoint(rt, ex, point);
        ex.state.mixedTicks++;
        if (ex.state.mixedTicks === PREPARATION_MIX_TICKS) {
          ex.state.complete = true;
          beginReturn(rt, ex, 'completed');
        }
      }
    } else {
      const duration = ex.phase === 'scooping' ? SCOOP_TICKS : DEPOSIT_TICKS;
      handPoint(
        rt,
        ex,
        lerp3(
          ex.from!,
          [target.pose.p[0], target.pose.p[1] + 0.1, target.pose.p[2]],
          smooth(ex.ticks / duration),
        ),
      );
      if (ex.ticks === duration) {
        if (ex.phase === 'scooping') beginReturn(rt, ex, 'to-pot');
        else {
          // Exact binary fractions: mutate both conserved quantities and progress in one tick.
          const source = rt.world.entities[ex.p.ingredients[ex.index]],
            pot = rt.world.entities[ex.p.pot];
          source.contents!.fraction -= QUANTITY;
          pot.contents!.fraction += QUANTITY / 4;
          ex.state.ingredients[ex.index].deposited += QUANTITY;
          rt.mark('prepare_food.deposit', {
            action: ex.id,
            source: source.id,
            pot: pot.id,
            bowlFraction: QUANTITY,
          });
          beginReturn(rt, ex, 'starting');
        }
      }
    }
    return { status: 'running', phase: ex.phase };
  },
  cancel(rt, ex) {
    stop(rt, ex);
    return { ok: true, deferred: true };
  },
  resumable:
    'Active preparation graph restoration is unsupported. Cancel/drain, persist quiescent object state, then explicitly retry prepare_food.',
};
export const PREPARATION_ACTIONS: ActionDef[] = [prepareFood];
