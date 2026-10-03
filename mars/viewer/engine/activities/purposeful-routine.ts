// Directed, bounded continuity: one committed gathering, then one existing task.
// This coordinator holds a logical intention only. Ordinary children own physics.
import { z } from 'zod';
import type { ActionDef, ActionRecord, ActionStatus, Diagnostic, StepResult } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Vec2 } from '../core/math.ts';
import { stableStringify } from '../core/hash.ts';
import { readClassroom, classroomControl } from './classroom.ts';
import { sharedFoodBreak } from './shared-food-break.ts';
import { pairedWalk, readPairedWalk, type PairedWalkParams, type PairedWalkReadout } from './paired-walk.ts';
import type { SharedFoodBreakParams } from './shared-food-break.ts';
import { readWorkstation } from '../objects/workstation.ts';
import { heldBy } from '../items/model.ts';
import { slotById } from '../social/slots.ts';
import { prepareFood, readFoodPreparation, type PrepareFoodParams, type FoodPreparation } from './prepare-food.ts';
import { sleep, readSleep, type SleepParams } from './sleep.ts';

export interface PurposefulRoutineParams {
  actor: string;
  session: string;
  work: { station: string; seat: string; task: string; duration: number };
  food: SharedFoodBreakParams;
  trip?: PairedWalkParams;
  preparation?: PrepareFoodParams;
  sleep?: SleepParams;
  rest: { seat: string; seconds: number };
  departure: Vec2;
}
export type RoutineMode = 'running' | 'draining' | 'paused' | 'waiting' | 'ending' | 'completed';
export interface PurposefulRoutineReadout {
  action: string;
  status: ActionStatus;
  mode: RoutineMode;
  obligation: 'gathering' | 'finish-work';
  phase: string;
  bindings: PurposefulRoutineParams;
  child?: string;
  waitingReason?: string;
  diagnostic?: Diagnostic;
  progress: {
    questionAsked: boolean;
    presenters: string[];
    conversationSeen: boolean;
    meal: { actor: string; served: boolean; consumed: boolean; returned: boolean; fraction: number }[];
    restSeconds: number;
    workElapsed: number;
  };
  ownedActions: string[];
  trip?: PairedWalkReadout;
  preparation?: FoodPreparation;
  sleep?: ReturnType<typeof readSleep>;
}
export interface PurposefulRoutineControlParams { routine: string; intent: 'pause' | 'resume' | 'end' }
type Meal = { actor: string; served: boolean; consumed: boolean; returned: boolean; fraction: number };
type Exec = {
  id: string; p: PurposefulRoutineParams; mode: RoutineMode; phase: 'classroom' | 'trip' | 'preparation' | 'food' | 'rest' | 'sleep' | 'work';
  child?: string; trip?: string; sleep?: string; preparation?: FoodPreparation; children: string[]; departureChild?: string; cleanupChild?: string; error?: Diagnostic;
  questionQueued: boolean; questionAsked: boolean; presenters: string[]; conversationSeen: boolean;
  foodStarted: boolean; foodGroup?: string; foodEats: string[]; foodReleasing: boolean;
  meal: Meal[]; restSeconds: number; restSit?: string; standing?: string; workElapsed: number;
  ending: boolean; departureRequested: boolean; mealObservedTick: number; foodCheckpoint: Record<string, string>;
};
type Store = Record<string, Exec>;
const store = (rt: Runtime): Store => (rt.services.purposefulRoutines ??= {});
const lookup = (rt: Runtime, id: string): Exec | undefined => (rt.services.purposefulRoutines as Store | undefined)?.[id];
function boundWorkElapsed(rt: Runtime, ex: Exec): number | undefined {
  const work = readWorkstation(rt, ex.p.work.station);
  return !('code' in work) && work.user === ex.p.actor && work.task === ex.p.work.task && work.duration === ex.p.work.duration
    ? work.elapsed : undefined;
}
const diagnostic = (code: string, message: string, subjects: string[], cause?: Diagnostic): Diagnostic => ({
  code: `routine.${code}`, message, subjects, ...(cause ? { details: { cause } } : {}),
});
function owned(rt: Runtime, action: string, parent: string) {
  for (let rec = rt.records.get(action); rec; rec = rec.parent ? rt.records.get(rec.parent) : undefined)
    if (rec.id === parent) return true;
  return false;
}
const running = (rec: ActionRecord | undefined) => !!rec && rec.history.some(h => h.status === 'executing' || h.status === 'blocked');
const fraction = (rt: Runtime, bowl: string) => rt.world.entities[bowl]?.contents?.fraction ?? 0;
function returned(rt: Runtime, p: PurposefulRoutineParams['food']['participants'][number]) {
  return p.returns.every(q => {
    const support = rt.world.entities[q.item]?.support, split = q.surfaceSlot.lastIndexOf('#');
    return support?.kind === 'resting-on' && support.on === q.surfaceSlot.slice(0, split) && support.slot === q.surfaceSlot.slice(split + 1);
  });
}
function observeMeal(rt: Runtime, ex: Exec) {
  for (let i = 0; i < ex.meal.length; i++) {
    const m = ex.meal[i], person = ex.p.food.participants[i], amount = fraction(rt, person.bowl);
    const descendants = [...rt.records.values()].filter(r => owned(rt, r.id, ex.id) && (r.params as { bowl?: string }).bowl === person.bowl && running(r) && (rt.isActive(r.id) || (r.endedTick ?? -1) >= ex.mealObservedTick));
    const serving = descendants.some(r => r.verb === 'serve'), eating = descendants.some(r => r.verb === 'eat');
    if (Math.abs(amount - m.fraction) > 1e-9 && !(amount > m.fraction ? serving : eating)) {
      ex.error = diagnostic('food-changed', `${person.bowl} changed outside owned serving/eating; retained fraction ${m.fraction}, actual ${amount}`, [person.actor, person.bowl]);
      continue;
    }
    if (serving && amount > 1e-9) m.served = true;
    if (eating && m.served && amount <= 1e-9) m.consumed = true;
    m.fraction = amount;
    m.returned = returned(rt, person);
  }
  ex.mealObservedTick = rt.tick;
}
function actorReady(rt: Runtime, actor: string): Diagnostic | undefined {
  const e = rt.world.entities[actor];
  if (!e?.human || e.human.level !== 0 || Math.abs(e.pose.p[1]) > 0.01)
    return diagnostic('actor', `${actor} must be a ground-level person`, [actor]);
  const holders = rt.holder(`actor:${actor}`);
  if (holders.length || e.human.activity !== 'idle')
    return diagnostic('actor-busy', `${actor} is not physically free and idle; held by ${holders.join(', ') || e.human.activity}`, [actor, ...holders]);
}
function checkpointIssue(rt: Runtime, ex: Exec): Diagnostic | undefined {
  const work = readWorkstation(rt, ex.p.work.station);
  if ('code' in work) return diagnostic('work', work.message, [ex.p.work.station], work);
  if (!work.available) return diagnostic('work-unavailable', `${ex.p.work.station} is unavailable for ${ex.p.actor}'s committed notes`, [ex.p.actor, ex.p.work.station]);
  if (work.user !== ex.p.actor || work.task !== ex.p.work.task || work.duration !== ex.p.work.duration || work.seat !== ex.p.work.seat || !['unfinished', 'completed'].includes(work.status))
    return diagnostic('work-changed', `${ex.p.work.station} no longer holds ${ex.p.actor}'s committed ${ex.p.work.task} (${ex.p.work.duration}s)`, [ex.p.actor, ex.p.work.station]);
  if (ex.phase === 'preparation' && ex.preparation && stableStringify(readFoodPreparation(rt, ex.p.preparation!.pot)) !== stableStringify(ex.preparation))
    return diagnostic('preparation-changed', 'The retained dish preparation changed outside this routine while paused', [ex.p.preparation!.pot, ex.id]);
  if (ex.phase === 'food' && ex.foodStarted) {
    for (const [item, expected] of Object.entries(ex.foodCheckpoint)) {
      const e = rt.world.entities[item];
      if (stableStringify({ def: e?.def, support: e?.support, food: e?.contents?.food }) !== expected)
        return diagnostic('food-changed', `${item}'s committed support/type/food changed while ${ex.id} was paused`, [item, ex.id]);
    }
    for (let i = 0; i < ex.meal.length; i++) {
      const person = ex.p.food.participants[i], m = ex.meal[i], e = rt.world.entities[person.bowl];
      if (!e || e.def !== 'bowl' || !rt.world.entities[person.spoon] || Math.abs(fraction(rt, person.bowl) - m.fraction) > 1e-9)
        return diagnostic('food-changed', `${person.bowl} or ${person.spoon} changed outside ${ex.id}; retained portion ${m.fraction} cannot be replaced`, [person.actor, person.bowl, person.spoon]);
      for (const item of [person.bowl, person.spoon]) {
        const support = rt.world.entities[item]?.support;
        if (support?.kind === 'in-hand' && support.by !== person.actor)
          return diagnostic('food-owned', `${item} is held by ${support.by}, not committed participant ${person.actor}`, [item, support.by, person.actor]);
      }
    }
  }
}
function afterTrip(ex: Exec) { return ex.p.preparation ? 'preparation' as const : 'food' as const; }
function afterMeal(ex: Exec) { return ex.p.sleep ? 'sleep' as const : 'rest' as const; }
function observePreparation(rt: Runtime, ex: Exec) {
  if (!ex.p.preparation || ex.phase !== 'preparation' || !ex.child) return;
  const child = rt.records.get(ex.child);
  if (child?.verb !== 'prepare_food' || !running(child)) return;
  const state = readFoodPreparation(rt, ex.p.preparation.pot);
  if (state) ex.preparation = structuredClone(state);
}
function beginDrain(ex: Exec, end: boolean, error?: Diagnostic) {
  ex.ending ||= end;
  ex.mode = end ? 'ending' : 'draining';
  ex.error = error ?? ex.error;
}
function dispatch(rt: Runtime, ex: Exec, verb: string, params: unknown, phase?: string) {
  const rec = rt.submit(verb, params, { parent: ex.id, preempt: false });
  ex.children.push(rec.id);
  ex.child = rec.id;
  if (rec.status === 'failed') beginDrain(ex, false, diagnostic('child-refused', `${ex.id} ${phase ?? ex.phase}: ${verb} ${rec.id} refused: ${rec.diagnostic?.message}`, [ex.id, rec.id], rec.diagnostic));
  return rec;
}
function wait(ex: Exec, issue: Diagnostic): StepResult {
  ex.mode = 'waiting'; ex.error = issue;
  return { status: 'blocked', diagnostic: issue };
}
function drain(rt: Runtime, ex: Exec): StepResult {
  // Classroom children are owned by the unrelated session: leave only this member.
  const session = readClassroom(rt, ex.p.session);
  const member = session?.participants.find(p => p.actor === ex.p.actor && p.state === 'participating');
  if (member && rt.isActive(ex.p.session) && !ex.departureRequested) {
    const rec = rt.submit('classroom_control', { session: ex.p.session, intent: { kind: 'depart', actor: ex.p.actor } }, { parent: ex.id, preempt: false });
    ex.children.push(rec.id); ex.departureChild = rec.id; ex.departureRequested = true;
    if (rec.status === 'failed') ex.error = diagnostic('departure-refused', `Cannot leave ${ex.p.actor} from ${ex.p.session}: ${rec.diagnostic?.message}`, [ex.p.actor, ex.p.session], rec.diagnostic);
  }
  // A paused trip retains its logical commitment, while its ordinary walks drain.
  // End cancels the trip; Pause never recreates it at the original rendezvous.
  const trip = ex.trip ? readPairedWalk(rt, ex.trip) : undefined;
  if (!ex.ending && ex.trip && rt.isActive(ex.trip) && trip && ['regrouping', 'walking'].includes(trip.mode)) {
    const rec = rt.submit('paired_walk_control', { walk: ex.trip, intent: 'pause' }, { parent: ex.id, preempt: false });
    ex.children.push(rec.id);
    if (rec.status === 'failed') ex.error = diagnostic('trip-pause', rec.diagnostic?.message ?? 'Trip pause refused', [ex.trip], rec.diagnostic);
  }
  const sleeping = ex.sleep ? readSleep(rt, ex.sleep) : undefined;
  if (!ex.ending && ex.sleep && rt.isActive(ex.sleep) && sleeping && !['paused', 'waiting', 'draining'].includes(sleeping.mode)) {
    const rec = rt.submit('sleep_control', { sleep: ex.sleep, intent: 'pause' }, { parent: ex.id, preempt: false });
    ex.children.push(rec.id);
    if (rec.status === 'failed') ex.error = diagnostic('sleep-pause', rec.diagnostic?.message ?? 'Sleep pause refused', [ex.sleep], rec.diagnostic);
  }
  for (const id of ex.children) {
    if (id === ex.departureChild || id === ex.cleanupChild || !rt.isActive(id) || ((id === ex.trip || id === ex.sleep) && !ex.ending)) continue;
    if (!ex.ending && ['paired_walk_control', 'sleep_control'].includes(rt.records.get(id)?.verb ?? '')) continue;
    rt.cancel(id);
  }
  const currentTrip = ex.trip ? readPairedWalk(rt, ex.trip) : undefined;
  const tripDrained = !ex.trip || !rt.isActive(ex.trip) || (!!currentTrip && ['paused', 'waiting'].includes(currentTrip.mode) && currentTrip.ownedActions.every(id => !rt.isActive(id)));
  const currentSleep = ex.sleep ? readSleep(rt, ex.sleep) : undefined;
  const sleepDrained = !ex.sleep || !rt.isActive(ex.sleep) || (!!currentSleep && ['paused', 'waiting'].includes(currentSleep.mode) && currentSleep.ownedActions.every(id => !rt.isActive(id)));
  observePreparation(rt, ex);
  observeMeal(rt, ex);
  if (!sleepDrained || !tripDrained || ex.children.some(id => id !== ex.cleanupChild && rt.isActive(id) && ((id !== ex.trip && id !== ex.sleep) || ex.ending)) || (member && rt.isActive(ex.p.session)))
    return { status: 'running', phase: ex.ending ? 'ending' : 'draining' };
  ex.child = undefined; ex.restSit = undefined; ex.standing = undefined;
  ex.foodGroup = undefined; ex.foodEats = []; ex.foodReleasing = false;
  ex.questionAsked ||= rt.events.some(e => e.type === 'mark' && e.name === 'classroom.question' && (e.data as { session?: string; actor?: string })?.session === ex.p.session && (e.data as { actor?: string })?.actor === ex.p.actor);
  if (!ex.questionAsked) ex.questionQueued = false;
  // Safe cleanup can leave the committed person physically departing under the session's directive.
  if (ex.ending) {
    // Preparation Pause retains its spoon. Terminal End returns only the spoon
    // actually acquired by this routine, through the ordinary physical put action.
    const spoon = ex.p.preparation?.spoon;
    const acquired = spoon && [...rt.records.values()].some(r =>
      owned(rt, r.id, ex.id) && r.verb === 'take_item' && running(r) && (r.params as { item?: string }).item === spoon);
    if (ex.cleanupChild && rt.isActive(ex.cleanupChild)) {
      const child = rt.records.get(ex.cleanupChild)!;
      return child.diagnostic ? { status: 'blocked', diagnostic: diagnostic('end-return', child.diagnostic.message, [ex.p.actor, child.id], child.diagnostic) }
        : { status: 'running', phase: 'ending-return' };
    }
    if (ex.phase === 'preparation' && acquired && heldBy(rt.world, ex.p.actor).some(h => h.item.id === spoon)) {
      const target = ex.p.food.participants.find(p => p.actor === ex.p.actor)?.returns.find(q => q.item === spoon);
      const params = { actor: ex.p.actor, item: spoon, surfaceSlot: target?.surfaceSlot };
      if (!target) {
        ex.error = diagnostic('end-return', `No declared return slot for ${spoon}`, [ex.id, spoon]);
        return { status: 'blocked', diagnostic: ex.error };
      }
      const def = rt.registry.get('put_item')!, parsed = def.schema.parse(params);
      const plan = def.plan(rt, parsed);
      const reserved = def.reservations(rt.world, parsed).find(c => rt.holder(c.resource).some(id => !owned(rt, id, ex.id)));
      if (!plan.ok || reserved) {
        ex.error = !plan.ok ? diagnostic('end-return', plan.diagnostic.message, [ex.id, spoon, target.surfaceSlot], plan.diagnostic)
          : diagnostic('end-return', `${spoon} waits for ${reserved!.resource} before returning to ${target.surfaceSlot}`, [ex.id, spoon, reserved!.resource]);
        return { status: 'blocked', diagnostic: ex.error };
      }
      const rec = rt.submit('put_item', params, { parent: ex.id, preempt: false });
      ex.children.push(rec.id); ex.cleanupChild = rec.id;
      if (rec.diagnostic) { ex.error = diagnostic('end-return', rec.diagnostic.message, [ex.id, spoon, rec.id], rec.diagnostic); return { status: 'blocked', diagnostic: ex.error }; }
      ex.error = undefined;
      return { status: 'running', phase: 'ending-return' };
    }
    ex.mode = 'completed'; return { status: 'completed', outputs: { ended: true } };
  }
  if (ex.phase === 'food') ex.foodCheckpoint = Object.fromEntries(ex.p.food.participants.flatMap(p => [p.bowl, p.spoon]).map(item => {
    const e = rt.world.entities[item]; return [item, stableStringify({ def: e?.def, support: e?.support, food: e?.contents?.food })];
  }));
  ex.mode = ex.error ? 'waiting' : 'paused';
  return ex.error ? { status: 'blocked', diagnostic: ex.error } : { status: 'running', phase: 'paused' };
}
function continuation(rt: Runtime, ex: Exec): StepResult {
  // Do not resubmit the whole break: an empty bowl after our eating is already consumed.
  observeMeal(rt, ex);
  if (ex.error?.code === 'routine.food-changed') { beginDrain(ex, false, ex.error); return drain(rt, ex); }
  if (!ex.foodGroup && !ex.foodReleasing) {
    for (let i = 0; i < ex.meal.length; i++) {
      const person = ex.p.food.participants[i], m = ex.meal[i];
      if (m.consumed) continue;
      const busy = actorReady(rt, person.actor); if (busy) return wait(ex, busy);
      const held = heldBy(rt.world, person.actor);
      if (held.some(h => ![person.bowl, person.spoon].includes(h.item.id)))
        return wait(ex, diagnostic('hands-full', `${person.actor} holds unrelated utensils`, [person.actor, ...held.map(h => h.item.id)]));
      for (const [item, preferred] of [[person.bowl, 'left'], [person.spoon, 'right']] as const) {
        if (held.some(h => h.item.id === item)) continue;
        const used = new Set(held.map(h => h.hand)), hand = used.has(preferred) ? (preferred === 'left' ? 'right' : 'left') : preferred;
        dispatch(rt, ex, 'take_item', { actor: person.actor, item, hand }); return { status: 'running', phase: 'food-taking' };
      }
      if (!m.served) {
        const [x, , z] = rt.world.entities[person.actor].pose.p;
        if (Math.abs(x - person.service[0]) > 0.12 || Math.abs(z - person.service[1]) > 0.12) {
          dispatch(rt, ex, 'walk_to', { actor: person.actor, x: person.service[0], z: person.service[1] }); return { status: 'running', phase: 'food-serving-route' };
        }
        dispatch(rt, ex, 'serve', { actor: person.actor, pot: ex.p.food.pot, bowl: person.bowl }); return { status: 'running', phase: 'food-serving' };
      }
      if (fraction(rt, person.bowl) <= 1e-9)
        return wait(ex, diagnostic('food-depleted', `${person.bowl} was served but no owned eating completed its retained portion`, [person.actor, person.bowl]));
    }
    if (ex.meal.some(m => !m.consumed)) {
      const rec = dispatch(rt, ex, 'converse', { actors: ex.p.food.participants.map(p => p.actor), at: ex.p.food.at });
      ex.foodGroup = rec.id; ex.child = undefined;
      return { status: 'running', phase: 'food-gathering' };
    }
    ex.foodReleasing = true;
  }
  if (ex.foodGroup && !ex.foodReleasing) {
    const group = rt.records.get(ex.foodGroup)!;
    if (!rt.isActive(group.id)) { beginDrain(ex, false, diagnostic('group-stopped', `${group.id} ended before the retained meal`, [group.id], group.diagnostic)); return drain(rt, ex); }
    if (group.status === 'blocked' && group.diagnostic) return { status: 'blocked', diagnostic: diagnostic('food-group-wait', group.diagnostic.message, [group.id], group.diagnostic) };
    if (group.phase !== 'talking') return { status: 'running', phase: 'food-gathering' };
    for (let i = 0; i < ex.meal.length; i++) {
      if (ex.meal[i].consumed) continue;
      const person = ex.p.food.participants[i];
      const ownEat = ex.foodEats.map(id => rt.records.get(id)!).find(r => (r.params as { actor?: string }).actor === person.actor);
      if (!ownEat) {
        const rec = dispatch(rt, ex, 'eat', { actor: person.actor, bowl: person.bowl, spoon: person.spoon });
        ex.foodEats.push(rec.id); ex.child = undefined;
        return { status: 'running', phase: 'food-eating' };
      }
      if (!rt.isActive(ownEat.id) && ownEat.status !== 'completed') { beginDrain(ex, false, diagnostic('eat-stopped', `${ownEat.id} ended ${ownEat.status}; retained portion needs explicit resume`, [person.actor, ownEat.id], ownEat.diagnostic)); return drain(rt, ex); }
    }
    if (!ex.meal.every(m => m.consumed) || ex.foodEats.some(id => rt.isActive(id))) return { status: 'running', phase: 'food-eating' };
    rt.cancel(group.id); ex.foodReleasing = true;
    return { status: 'running', phase: 'food-releasing' };
  }
  if (ex.foodGroup && rt.isActive(ex.foodGroup)) return { status: 'running', phase: 'food-releasing' };
  for (const person of ex.p.food.participants) {
    const placements = person.returns.filter(q => heldBy(rt.world, person.actor).some(h => h.item.id === q.item));
    if (placements.length) { dispatch(rt, ex, 'stow_items', { actor: person.actor, placements }); return { status: 'running', phase: 'food-returning' }; }
    if (!returned(rt, person)) return wait(ex, diagnostic('return-changed', `${person.actor}'s consumed meal utensils are not at their committed return slots`, [person.actor, person.bowl, person.spoon]));
  }
  ex.phase = afterMeal(ex); return { status: 'running', phase: ex.phase };
}

const id = z.string().min(1).max(160);
export const purposefulRoutine: ActionDef<PurposefulRoutineParams, null, Exec> = {
  verb: 'purposeful_routine',
  description: 'Join one explicit live gathering, take one shared meal/rest and finish the same unfinished notes; explicit pause/resume/end through ordinary actions.',
  schema: z.strictObject({ actor: id, session: id,
    work: z.strictObject({ station: id, seat: id, task: id, duration: z.number().positive().max(3600) }),
    food: sharedFoodBreak.schema, trip: pairedWalk.schema.optional(), preparation: prepareFood.schema.optional(), sleep: sleep.schema.optional(), rest: z.strictObject({ seat: id, seconds: z.number().positive().max(300) }),
    departure: z.tuple([z.number(), z.number()]),
  }),
  reservations: (_w, p) => [{ resource: `routine:${p.actor}`, mode: 'exclusive' }],
  drivesReservedHands: false,
  plan(rt, p) {
    const issue = actorReady(rt, p.actor);
    if (issue) return { ok: false, diagnostic: issue };
    if (heldBy(rt.world, p.actor).length) return { ok: false, diagnostic: diagnostic('hands-full', `${p.actor} must return held objects before this routine`, [p.actor]) };
    const work = readWorkstation(rt, p.work.station);
    if ('code' in work) return { ok: false, diagnostic: diagnostic('work', work.message, [p.work.station], work) };
    if (!work.available) return { ok: false, diagnostic: diagnostic('work-unavailable', `${p.work.station} is unavailable for ${p.actor}`, [p.actor, p.work.station]) };
    if (work.status !== 'unfinished' || work.user !== p.actor || work.task !== p.work.task || work.duration !== p.work.duration || work.seat !== p.work.seat)
      return { ok: false, diagnostic: diagnostic('unfinished-task', `${p.work.station} must retain ${p.actor}'s existing unfinished ${p.work.task} (${p.work.duration}s)`, [p.actor, p.work.station]) };
    const session = readClassroom(rt, p.session);
    if (!session || !rt.isActive(p.session) || !['presenting', 'question'].includes(session.phase))
      return { ok: false, diagnostic: diagnostic('session', `${p.session} must be the explicit live gathering while talks accept joining`, [p.session]) };
    const join = classroomControl.plan(rt, { session: p.session, intent: { kind: 'join', actor: p.actor, departure: p.departure } });
    if (!join.ok) return { ok: false, diagnostic: diagnostic('join', join.diagnostic.message, [p.actor, p.session], join.diagnostic) };
    if (p.food.participants[0].actor !== p.actor)
      return { ok: false, diagnostic: diagnostic('food-binding', `${p.actor} must be the first explicit food participant`, [p.actor]) };
    if (p.trip && (p.trip.actors[0] !== p.actor || p.trip.actors[1] !== p.food.participants[1]?.actor || p.food.participants.length !== 2))
      return { ok: false, diagnostic: diagnostic('trip-binding', 'The explicit pair must be this worker and the same second food participant', [p.actor, ...p.trip.actors]) };
    if (p.preparation && (p.preparation.actor !== p.actor || p.preparation.pot !== p.food.pot || p.preparation.spoon !== p.food.participants[0].spoon))
      return { ok: false, diagnostic: diagnostic('preparation-binding', 'Preparation must use this worker, shared pot and committed meal spoon', [p.actor, p.food.pot, p.food.participants[0].spoon]) };
    if (p.sleep && p.sleep.actor !== p.actor)
      return { ok: false, diagnostic: diagnostic('sleep-binding', 'Sleep must belong to the same committed worker', [p.actor, p.sleep.actor]) };
    // The empty future dish is not an available meal. Validate real preparation
    // now, and let the unchanged food action validate actual output at dispatch.
    const food = p.preparation ? prepareFood.plan(rt, p.preparation) : sharedFoodBreak.plan(rt, p.food);
    if (!food.ok) return { ok: false, diagnostic: diagnostic('food', food.diagnostic.message, [p.food.pot], food.diagnostic) };
    const seat = slotById(rt, p.rest.seat);
    if (!p.sleep && ('code' in seat || seat.kind !== 'seat')) return { ok: false, diagnostic: diagnostic('rest-seat', `${p.rest.seat} is not an available seat binding`, [p.rest.seat], 'code' in seat ? seat : undefined) };
    if (p.sleep) {
      const result = sleep.plan(rt, p.sleep);
      if (!result.ok) return { ok: false, diagnostic: diagnostic('sleep', result.diagnostic.message, [p.actor, p.sleep.mat], result.diagnostic) };
    }
    return { ok: true, program: null };
  },
  start(rt, p, _program, action) {
    const work = readWorkstation(rt, p.work.station);
    const ex: Exec = { id: action, p: structuredClone(p), mode: 'running', phase: 'classroom', children: [],
      questionQueued: false, questionAsked: false, presenters: [], conversationSeen: false,
      foodStarted: false, foodEats: [], foodReleasing: false,
      meal: p.food.participants.map(person => ({ actor: person.actor, served: fraction(rt, person.bowl) > 1e-9, consumed: false, returned: false, fraction: fraction(rt, person.bowl) })),
      restSeconds: 0, workElapsed: 'code' in work ? 0 : work.elapsed,
      ending: false, departureRequested: false, mealObservedTick: rt.tick, foodCheckpoint: {} };
    store(rt)[action] = ex; return ex;
  },
  onDirective(_rt, ex, by, claims, ancestors) {
    if (ex.mode !== 'running' || ancestors.includes(ex.id) || ancestors.includes(ex.p.session) || ['purposeful_routine_control', 'hold_items'].includes(by.verb)) return;
    const actors = ['food', 'trip'].includes(ex.phase) ? ex.p.food.participants.map(p => p.actor) : [ex.p.actor];
    const params = by.params as { actor?: string; intent?: { actor?: string } };
    if (claims.some(c => actors.some(a => c.resource === `actor:${a}`)) || actors.includes(params.actor ?? params.intent?.actor ?? ''))
      beginDrain(ex, false, diagnostic('directed-away', `${by.verb} ${by.id} takes priority over ${ex.id}; drain owned children before explicit resume`, [ex.p.actor, by.id, ex.id]));
  },
  step(rt, ex, dt) {
    // Retain actual bound-task progress before cleanup or completion releases it.
    const elapsed = boundWorkElapsed(rt, ex);
    if (elapsed !== undefined) ex.workElapsed = elapsed;
    observePreparation(rt, ex);
    if (ex.mode === 'draining' || ex.mode === 'ending') return drain(rt, ex);
    if (ex.mode === 'paused' || ex.mode === 'waiting') return ex.error ? { status: 'blocked', diagnostic: ex.error } : { status: 'running', phase: 'paused' };
    if (ex.child) {
      const child = rt.records.get(ex.child)!;
      observeMeal(rt, ex);
      if (ex.error?.code === 'routine.food-changed') { beginDrain(ex, false, ex.error); return drain(rt, ex); }
      if (rt.isActive(child.id)) {
        const trip = child.id === ex.trip ? readPairedWalk(rt, child.id) : undefined;
        const sleeping = child.id === ex.sleep ? readSleep(rt, child.id) : undefined;
        if (sleeping && ['paused', 'waiting'].includes(sleeping.mode)) return wait(ex, diagnostic('sleep-wait', sleeping.diagnostic?.message ?? 'Sleep is paused; Resume continues remaining rest', [child.id], sleeping.diagnostic));
        if (trip && ['paused', 'waiting'].includes(trip.mode)) return wait(ex, diagnostic('trip-wait', trip.waitingReason ?? 'Trip is paused; Resume continues from actual positions', [child.id], trip.diagnostic));
        if (child.status === 'blocked' && child.diagnostic) return { status: 'blocked', diagnostic: diagnostic('child-wait', `${child.verb} ${child.id}: ${child.diagnostic.message}`, [child.id], child.diagnostic) };
        return { status: 'running', phase: child.phase ?? ex.phase };
      }
      ex.child = undefined;
      if (child.status !== 'completed') { beginDrain(ex, false, diagnostic('child-stopped', `${child.verb} ${child.id} ended ${child.status}; explicit resume required`, [child.id], child.diagnostic)); return drain(rt, ex); }
      if (child.verb === 'paired_walk') {
        if (child.outputs?.arrived !== true) return wait(ex, diagnostic('trip-ended', 'The committed trip ended without joint arrival; it cannot be silently replaced', [child.id], child.diagnostic));
        ex.phase = afterTrip(ex);
      }
      if (child.verb === 'prepare_food') {
        if (!ex.preparation?.complete) return wait(ex, diagnostic('preparation-incomplete', 'Preparation ended without a completed dish; output cannot be substituted', [ex.p.food.pot, child.id]));
        ex.phase = 'food';
      }
      if (child.verb === 'shared_food_break') { ex.phase = afterMeal(ex); }
      if (child.verb === 'sleep') {
        const state = readSleep(rt, child.id);
        if (!state || state.elapsed < ex.p.sleep!.duration - 1e-8 || child.outputs?.ended === true) return wait(ex, diagnostic('sleep-ended', 'Committed sleep ended before its duration; it cannot be silently replaced', [child.id]));
        ex.phase = 'work';
      }
      if (child.verb === 'work_at') { ex.mode = 'completed'; return { status: 'completed', outputs: { task: ex.p.work.task, session: ex.p.session } }; }
    }
    if (ex.phase === 'classroom') {
      const session = readClassroom(rt, ex.p.session), record = rt.records.get(ex.p.session);
      const attending = session?.participants.find(p => p.actor === ex.p.actor && p.state === 'participating' && p.arrival !== 'joining');
      if (attending && session?.presenter && !ex.presenters.includes(session.presenter)) ex.presenters.push(session.presenter);
      ex.conversationSeen ||= !!session?.groups.some(g => g.status === 'talking' && g.members.includes(ex.p.actor));
      ex.questionAsked ||= rt.events.some(e => e.type === 'mark' && e.name === 'classroom.question' && (e.data as { session?: string; actor?: string })?.session === ex.p.session && (e.data as { actor?: string })?.actor === ex.p.actor);
      if (!session || !record || record.status === 'failed' || record.status === 'cancelled') return wait(ex, diagnostic('session-ended', `${ex.p.session} no longer offers this committed gathering`, [ex.p.session], record?.diagnostic));
      if (record.status === 'completed') {
        if (!ex.questionAsked || ex.presenters.length < 2 || !ex.conversationSeen) return wait(ex, diagnostic('gathering-incomplete', `${ex.p.session} ended before ${ex.p.actor}'s committed question, presenter rotation or conversation`, [ex.p.actor, ex.p.session]));
        ex.phase = ex.p.trip ? 'trip' : afterTrip(ex); return { status: 'running', phase: ex.phase };
      }
      const member = session.participants.find(p => p.actor === ex.p.actor && p.state === 'participating');
      if (!member) {
        if (!session.controls.includes('join')) return wait(ex, diagnostic('join-wait', `${ex.p.actor} cannot rejoin ${ex.p.session} during ${session.phase}`, [ex.p.actor, ex.p.session]));
        dispatch(rt, ex, 'classroom_control', { session: ex.p.session, intent: { kind: 'join', actor: ex.p.actor, departure: ex.p.departure } }); ex.departureRequested = false;
      } else if (member.arrival !== 'joining' && !ex.questionQueued && session.controls.includes('question')) {
        dispatch(rt, ex, 'classroom_control', { session: ex.p.session, intent: { kind: 'question', actor: ex.p.actor } }); ex.questionQueued = true;
      }
      if (session.waitingReason) return { status: 'blocked', diagnostic: diagnostic('session-wait', `${ex.p.session}: ${session.waitingReason}`, [ex.p.session], session.diagnostic) };
      return { status: 'running', phase: `classroom-${session.phase}` };
    }
    if (ex.phase === 'trip') {
      if (!ex.trip) { const rec = dispatch(rt, ex, 'paired_walk', ex.p.trip); ex.trip = rec.id; return { status: 'running', phase: 'walk-to-lunch' }; }
      const record = rt.records.get(ex.trip)!;
      if (!rt.isActive(ex.trip)) {
        if (record.status === 'completed' && record.outputs?.arrived === true) { ex.phase = afterTrip(ex); return { status: 'running', phase: ex.phase }; }
        return wait(ex, diagnostic('trip-ended', 'The committed trip ended without joint arrival; it cannot be silently replaced', [ex.trip], record.diagnostic));
      }
      const trip = readPairedWalk(rt, ex.trip)!;
      if (['paused', 'waiting'].includes(trip.mode)) {
        const rec = rt.submit('paired_walk_control', { walk: ex.trip, intent: 'resume' }, { parent: ex.id, preempt: false });
        ex.children.push(rec.id);
        if (rec.status === 'failed') return wait(ex, diagnostic('trip-resume', rec.diagnostic?.message ?? 'Trip resume refused', [ex.trip], rec.diagnostic));
      }
      ex.child = ex.trip;
      return { status: 'running', phase: 'walk-to-lunch' };
    }
    if (ex.phase === 'preparation') {
      const issue = actorReady(rt, ex.p.actor); if (issue) return wait(ex, issue);
      if (readFoodPreparation(rt, ex.p.preparation!.pot)?.complete) {
        // Only our retained completed preparation authorizes transition.
        if (!ex.preparation?.complete) return wait(ex, diagnostic('preparation-changed', 'The dish completed outside this routine; explicit output cannot be substituted', [ex.p.food.pot]));
        ex.phase = 'food'; return { status: 'running', phase: 'food' };
      }
      dispatch(rt, ex, 'prepare_food', ex.p.preparation);
      return { status: 'running', phase: 'preparing-food' };
    }
    if (ex.phase === 'sleep') {
      if (!ex.sleep) { const rec = dispatch(rt, ex, 'sleep', ex.p.sleep); ex.sleep = rec.id; return { status: 'running', phase: 'sleep-approaching' }; }
      const record = rt.records.get(ex.sleep)!;
      const state = readSleep(rt, ex.sleep)!;
      if (!rt.isActive(ex.sleep)) {
        if (record.status === 'completed' && record.outputs?.ended !== true && state.elapsed >= ex.p.sleep!.duration - 1e-8) { ex.phase = 'work'; return { status: 'running', phase: 'finish-work' }; }
        return wait(ex, diagnostic('sleep-ended', 'Committed sleep ended before routine continuation; it cannot be silently replaced', [ex.sleep], record.diagnostic));
      }
      if (['paused', 'waiting'].includes(state.mode)) {
        const rec = rt.submit('sleep_control', { sleep: ex.sleep, intent: 'resume' }, { parent: ex.id, preempt: false });
        ex.children.push(rec.id);
        if (rec.status === 'failed') return wait(ex, diagnostic('sleep-resume', rec.diagnostic?.message ?? 'Sleep resume refused', [ex.sleep], rec.diagnostic));
      }
      ex.child = ex.sleep;
      return { status: 'running', phase: 'sleeping' };
    }
    if (ex.phase === 'food') {
      if (!ex.foodStarted) {
        const rec = dispatch(rt, ex, 'shared_food_break', ex.p.food); ex.foodStarted = rec.status !== 'failed';
        return { status: 'running', phase: 'shared-food' };
      }
      return continuation(rt, ex);
    }
    if (ex.phase === 'rest') {
      if (!ex.restSit) {
        const issue = actorReady(rt, ex.p.actor); if (issue) return wait(ex, issue);
        if (heldBy(rt.world, ex.p.actor).length) return wait(ex, diagnostic('hands-full', `${ex.p.actor} must return utensils before quiet rest`, [ex.p.actor]));
        const rec = dispatch(rt, ex, 'sit', { actor: ex.p.actor, slot: ex.p.rest.seat }); ex.restSit = rec.id; ex.child = undefined;
        return { status: 'running', phase: 'rest-arriving' };
      }
      const sit = rt.records.get(ex.restSit)!;
      if (!ex.standing && rt.isActive(sit.id) && sit.phase === 'occupied') ex.restSeconds = Math.min(ex.p.rest.seconds, ex.restSeconds + dt);
      if (!ex.standing && ex.restSeconds >= ex.p.rest.seconds) { const rec = dispatch(rt, ex, 'stand', { actor: ex.p.actor }); ex.standing = rec.id; return { status: 'running', phase: 'rest-standing' }; }
      if (ex.standing && !rt.isActive(ex.standing) && !rt.isActive(sit.id)) { ex.phase = 'work'; ex.child = undefined; return { status: 'running', phase: 'finish-work' }; }
      if (!ex.standing && !rt.isActive(sit.id)) { beginDrain(ex, false, diagnostic('rest-stopped', `${sit.id} ended before rest finished`, [ex.p.actor, sit.id], sit.diagnostic)); return drain(rt, ex); }
      return { status: 'running', phase: sit.phase === 'occupied' ? 'resting' : 'rest-arriving' };
    }
    const issue = actorReady(rt, ex.p.actor) ?? checkpointIssue(rt, ex); if (issue) return wait(ex, issue);
    const work = readWorkstation(rt, ex.p.work.station);
    if (!('code' in work) && work.status === 'completed') { ex.mode = 'completed'; return { status: 'completed' }; }
    dispatch(rt, ex, 'work_at', { ...ex.p.work, actor: ex.p.actor, resume: true });
    return { status: 'running', phase: 'finish-work' };
  },
  cancel(_rt, ex) { beginDrain(ex, true); return { ok: true, deferred: true }; },
  resumable: 'Directed routine live snapshots are deferred; pause preserves live intention only, reset replaces it.',
};

export const purposefulRoutineControl: ActionDef<PurposefulRoutineControlParams, null, { id: string }> = {
  verb: 'purposeful_routine_control', description: 'Explicitly pause, resume/retry, or terminally end one owned logical routine.',
  schema: z.strictObject({ routine: id, intent: z.enum(['pause', 'resume', 'end']) }), reservations: () => [],
  plan(rt, p) {
    const ex = lookup(rt, p.routine);
    if (!ex || !rt.isActive(p.routine) || ex.ending) return { ok: false, diagnostic: diagnostic('inactive', `${p.routine} cannot accept ${p.intent}`, [p.routine]) };
    if (p.intent === 'resume') {
      if (!['paused', 'waiting'].includes(ex.mode)) return { ok: false, diagnostic: diagnostic('not-paused', `${p.routine} must finish cleanup before resume`, [p.routine]) };
      const issue = actorReady(rt, ex.p.actor) ?? (['food', 'trip'].includes(ex.phase) ? ex.p.food.participants.map(q => actorReady(rt, q.actor)).find(Boolean) : undefined) ?? checkpointIssue(rt, ex);
      if (issue) return { ok: false, diagnostic: issue };
    }
    return { ok: true, program: null };
  },
  start(rt, p, _program, action) {
    const ex = lookup(rt, p.routine)!;
    if (p.intent === 'end') rt.cancel(ex.id);
    else if (p.intent === 'pause') beginDrain(ex, false);
    else {
      if (ex.child === ex.trip || ex.child === ex.sleep) ex.child = undefined;
      const trip = ex.trip ? rt.records.get(ex.trip) : undefined;
      if (trip?.status === 'failed' && !running(trip)) ex.trip = undefined; // Explicit retry of admission, never replace an executed trip.
      const sleeping = ex.sleep ? rt.records.get(ex.sleep) : undefined;
      if (sleeping?.status === 'failed' && !running(sleeping)) ex.sleep = undefined; // Admission retry only; never replace executed sleep.
      ex.mode = 'running'; ex.error = undefined; ex.departureRequested = false; ex.foodCheckpoint = {}; ex.questionQueued = ex.questionAsked || !!readClassroom(rt, ex.p.session)?.queuedQuestions.includes(ex.p.actor);
    }
    return { id: action };
  },
  step: () => ({ status: 'completed' }), cancel: () => ({ ok: true }), resumable: true,
};
export function readPurposefulRoutine(rt: Runtime, action: string): PurposefulRoutineReadout | undefined {
  const ex = lookup(rt, action), record = rt.records.get(action); if (!ex || !record) return;
  const elapsed = rt.isActive(action) ? boundWorkElapsed(rt, ex) : undefined;
  return { action, status: record.status, mode: ex.mode, obligation: ex.phase === 'work' ? 'finish-work' : 'gathering', phase: record.phase ?? ex.phase,
    bindings: structuredClone(ex.p), child: ex.child,
    ...(ex.error ? { diagnostic: structuredClone(ex.error), waitingReason: ex.error.message } : record.diagnostic ? { diagnostic: structuredClone(record.diagnostic), waitingReason: record.diagnostic.message } : {}),
    progress: { questionAsked: ex.questionAsked, presenters: [...ex.presenters], conversationSeen: ex.conversationSeen,
      meal: structuredClone(ex.meal), restSeconds: ex.restSeconds, workElapsed: elapsed ?? ex.workElapsed }, ownedActions: [...ex.children], ...(ex.trip ? { trip: readPairedWalk(rt, ex.trip) } : {}),
    ...(ex.preparation ? { preparation: structuredClone(ex.preparation) } : {}), ...(ex.sleep ? { sleep: readSleep(rt, ex.sleep) } : {}) };
}
export const PURPOSEFUL_ROUTINE_ACTIONS: ActionDef[] = [purposefulRoutine, purposefulRoutineControl];
