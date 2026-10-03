// Finite coordination only. Registered ordinary actions own all physical/material writes.
import { z } from 'zod';
import type { ActionDef, Diagnostic, StepResult } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import {
  prepareFood,
  readFoodPreparation,
  type PrepareFoodParams,
} from './prepare-food.ts';
import {
  sharedFoodBreak,
  readSharedFoodBreak,
  type SharedFoodBreakParams,
} from './shared-food-break.ts';
import {
  tidyTable,
  tidyTableControl,
  readTidyTable,
  type TidyTableParams,
} from './table-cleanup.ts';
import { stowItems, type StowParams } from './stow.ts';
import { heldBy, surfaceSlot } from '../items/model.ts';
export interface CommunalSupperParams {
  preparation: PrepareFoodParams;
  meal: SharedFoodBreakParams;
  cleanup: [TidyTableParams, TidyTableParams];
}
export interface CommunalSupperControlParams {
  supper: string;
  intent: 'pause' | 'resume' | 'end';
}
type Mode =
  | 'running'
  | 'pausing'
  | 'paused'
  | 'waiting'
  | 'ending'
  | 'completed';
type Exec = {
  id: string;
  p: CommunalSupperParams;
  stage: 0 | 1 | 2 | 3;
  mode: Mode;
  child?: string;
  children: string[];
  prepared: boolean;
  mealComplete: boolean;
  finished: boolean;
  diagnostic?: Diagnostic;
  binding: string;
  identities: string;
  payloads?: string;
  returns: string[];
  returnCursor: number;
  materialTotal: number;
  ingredientFoods: string;
  stored: Record<string, string>;
};
const store = (rt: Runtime): Record<string, Exec> =>
  (rt.services.communalSuppers ??= {});
const find = (rt: Runtime, id: string) =>
  (rt.services.communalSuppers as Record<string, Exec> | undefined)?.[id];
const issue = (
  code: string,
  message: string,
  subjects: string[],
  cause?: Diagnostic,
): Diagnostic => ({
  code: `communal_supper.${code}`,
  message,
  subjects,
  ...(cause ? { details: { cause } } : {}),
});
const items = (p: CommunalSupperParams) => [
  p.preparation.pot,
  ...p.preparation.ingredients,
  ...p.meal.participants.flatMap((q) => [q.bowl, q.spoon]),
];
const ids = (p: CommunalSupperParams) => [...new Set(items(p))];
const identity = (rt: Runtime, p: CommunalSupperParams) =>
  JSON.stringify(
    ids(p).map((id) => {
      const e = rt.world.entities[id];
      return e && { id, def: e.def, provenance: e.provenance };
    }),
  );
const payload = (rt: Runtime, p: CommunalSupperParams) =>
  JSON.stringify(
    ids(p).map((id) => {
      const e = rt.world.entities[id];
      return (
        e && { id, def: e.def, contents: e.contents, equipment: e.equipment }
      );
    }),
  );
function binding(rt: Runtime, p: CommunalSupperParams) {
  const fixtures = [
    ...new Set(
      p.cleanup.flatMap((q) =>
        q.transfers.flatMap((t) => [t.from.split('#')[0], t.to.split('#')[0]]),
      ),
    ),
  ];
  return JSON.stringify([p, fixtures.map((id) => rt.world.entities[id])]);
}
function latestMeal(rt: Runtime, ex: Exec) {
  return [...ex.children]
    .reverse()
    .map((id) => readSharedFoodBreak(rt, id))
    .find(Boolean);
}
function materialTotal(rt: Runtime, p: CommunalSupperParams, consumed = 0) {
  return (
    (p.preparation.ingredients.reduce(
      (n, id) => n + (rt.world.entities[id]?.contents?.fraction ?? 0),
      0,
    ) +
      p.meal.participants.reduce(
        (n, q) => n + (rt.world.entities[q.bowl]?.contents?.fraction ?? 0),
        0,
      ) +
      consumed) /
      4 +
    (rt.world.entities[p.preparation.pot]?.contents?.fraction ?? 0)
  );
}
function storedView(rt: Runtime, id: string) {
  const e = rt.world.entities[id];
  return JSON.stringify(
    e && { id: e.id, def: e.def, pose: e.pose, support: e.support },
  );
}
function tidyReady(rt: Runtime, id: string) {
  const t = readTidyTable(rt, id);
  return !!t && t.finished && t.items.every((q) => q.atDestination);
}
function retained(rt: Runtime, ex: Exec) {
  const changed = Object.entries(ex.stored).find(
    ([id, snapshot]) => storedView(rt, id) !== snapshot,
  );
  if (changed)
    return issue(
      'stored-item-changed',
      'Completed storage must retain the same actual supported vessel and pose',
      [changed[0]],
    );
  const consumed =
    latestMeal(rt, ex)?.receipts?.reduce((n, q) => n + q.consumed, 0) ?? 0;
  const total = materialTotal(rt, ex.p, consumed);
  if (!Number.isFinite(total) || Math.abs(total - ex.materialTotal) > 1e-9)
    return issue(
      'material-conservation-changed',
      'Finite original ingredient, pot, serving and consumed receipt quantities changed; restore exact retained material before continuation',
      ids(ex.p),
    );
  if (
    JSON.stringify(
      ex.p.preparation.ingredients.map(
        (id) => rt.world.entities[id]?.contents?.food,
      ),
    ) !== ex.ingredientFoods ||
    (readFoodPreparation(rt, ex.p.preparation.pot) &&
      rt.world.entities[ex.p.preparation.pot]?.contents?.food !==
        'hypothetical cold shared dish') ||
    ex.p.meal.participants.some(
      (q) =>
        (rt.world.entities[q.bowl]?.contents?.fraction ?? 0) > 0 &&
        rt.world.entities[q.bowl]?.contents?.food !==
          'hypothetical cold shared dish',
    )
  )
    return issue(
      'material-label-changed',
      'Original ingredient labels and actual prepared dish must be retained',
      ids(ex.p),
    );
  if (binding(rt, ex.p) !== ex.binding)
    return issue(
      'binding-changed',
      'Declared fixture/binding changed; restore original supported arrangement before explicit continuation',
      [ex.id],
    );
  if (identity(rt, ex.p) !== ex.identities)
    return issue(
      'identity-changed',
      'Same seven original vessel identities must remain available',
      ids(ex.p),
    );
  if (ex.payloads && payload(rt, ex.p) !== ex.payloads)
    return issue(
      'material-changed',
      'Stored cleanup material changed after the completed meal',
      ids(ex.p),
    );
}
function params(ex: Exec) {
  if (ex.stage === 0) return ex.p.preparation;
  if (ex.stage === 1)
    return { ...ex.p.meal, ...(ex.child ? { resumeFrom: ex.child } : {}) };
  return ex.p.cleanup[ex.stage - 2];
}
const verb = (stage: number) =>
  stage === 0
    ? 'prepare_food'
    : stage === 1
      ? 'shared_food_break'
      : 'tidy_table';
function mealReady(rt: Runtime, id: string) {
  const r = readSharedFoodBreak(rt, id);
  return (
    !!r &&
    !r.diagnostic &&
    r.receipts?.length === 2 &&
    r.receipts.every(
      (q) => q.served && q.consumptionCompleted && q.remaining === 0,
    ) &&
    r.participants.every((q) => q.returned.length === 2 && q.held.length === 0)
  );
}
function isComplete(rt: Runtime, ex: Exec) {
  const r = ex.child ? rt.records.get(ex.child) : undefined;
  return (
    !!r &&
    r.status === 'completed' &&
    (ex.stage === 0
      ? readFoodPreparation(rt, ex.p.preparation.pot)?.complete
      : ex.stage === 1
        ? mealReady(rt, r.id)
        : tidyReady(rt, r.id))
  );
}
function admission(rt: Runtime, ex: Exec): Diagnostic | undefined {
  const bad = retained(rt, ex);
  if (bad) return bad;
  if (isComplete(rt, ex)) return;
  if (ex.stage >= 2 && ex.child && rt.isActive(ex.child)) {
    const r = tidyTableControl.plan(rt, { task: ex.child, intent: 'resume' });
    return r.ok ? undefined : r.diagnostic;
  }
  if (ex.stage >= 2 && ex.child)
    return issue(
      'cleanup-stopped',
      'Stopped or incomplete actual storage cannot be silently recreated; restore original completed placements or use End',
      [ex.child],
    );
  const def = rt.registry.get(verb(ex.stage));
  if (!def)
    return issue('action-unavailable', `${verb(ex.stage)} is not registered`, [
      ex.id,
    ]);
  const r = def.plan(rt, params(ex));
  return r.ok
    ? undefined
    : issue('stage-unavailable', r.diagnostic.message, [ex.id], r.diagnostic);
}
function controlChild(
  rt: Runtime,
  ex: Exec,
  intent: 'pause' | 'resume' | 'end',
) {
  if (!ex.child || !rt.isActive(ex.child)) return;
  if (intent === 'end') {
    rt.cancel(ex.child);
    return;
  }
  if (ex.stage >= 2) {
    const p = { task: ex.child, intent };
    const plan = tidyTableControl.plan(rt, p);
    if (plan.ok) {
      const r = rt.submit('tidy_table_control', p, {
        parent: ex.id,
        preempt: false,
      });
      ex.children.push(r.id);
    }
  } else rt.cancel(ex.child);
}
function wait(ex: Exec, d: Diagnostic): StepResult {
  ex.mode = 'waiting';
  ex.diagnostic = d;
  return { status: 'blocked', diagnostic: d };
}
function returnParams(rt: Runtime, ex: Exec): StowParams[] {
  return ex.p.meal.participants
    .map((q) => ({
      actor: q.actor,
      placements: q.returns.filter((t) =>
        heldBy(rt.world, q.actor).some((h) => h.item.id === t.item),
      ),
    }))
    .filter((q) => q.placements.length > 0);
}
function actualClaims(rt: Runtime) {
  const resources = new Set<string>();
  for (const r of rt.records.values()) {
    const def = rt.registry.get(r.verb);
    if (!def) continue;
    try {
      for (const claim of def.reservations(rt.world, r.params as never))
        resources.add(claim.resource);
    } catch {
      /* A stopped/malformed record has no additional readable claims. */
    }
  }
  return [...resources]
    .sort()
    .map((resource) => ({ resource, holders: rt.holder(resource) }))
    .filter((q) => q.holders.length);
}
function placedReturn(rt: Runtime, p: StowParams['placements'][number]) {
  const e = rt.world.entities[p.item],
    i = p.surfaceSlot.lastIndexOf('#'),
    slot = surfaceSlot(rt.world, p.surfaceSlot);
  if ('code' in slot) return false;
  return (
    e?.support?.kind === 'resting-on' &&
    e.support.on === p.surfaceSlot.slice(0, i) &&
    e.support.slot === p.surfaceSlot.slice(i + 1) &&
    e.pose.p.every((value, index) => Math.abs(value - slot.p[index]) < 1e-6)
  );
}
function unresolvedReturn(rt: Runtime, ex: Exec) {
  return ex.returns.slice(ex.returnCursor).find((id) => {
    const r = rt.records.get(id);
    return (
      !r ||
      (r.params as StowParams).placements.some((p) => !placedReturn(rt, p))
    );
  });
}
function retryEndIssue(rt: Runtime, ex: Exec): Diagnostic | undefined {
  for (const id of ex.returns.slice(ex.returnCursor)) {
    const r = rt.records.get(id);
    if (!r)
      return issue(
        'return-history-unavailable',
        'Original return record must remain available before retrying End',
        [id],
      );
    const p = r.params as StowParams;
    for (const q of p.placements) {
      const e = rt.world.entities[q.item];
      if (
        !placedReturn(rt, q) &&
        !(e?.support?.kind === 'in-hand' && e.support.by === p.actor)
      )
        return issue(
          'return-not-ready',
          `${q.item} must be held by ${p.actor} or physically returned to ${q.surfaceSlot} before retrying End`,
          [q.item, p.actor, q.surfaceSlot],
        );
    }
  }
  for (const p of returnParams(rt, ex)) {
    const r = stowItems.plan(rt, p);
    if (!r.ok)
      return issue(
        'return-retry-unavailable',
        `Finish the independent directive and restore approved support before retrying End: ${r.diagnostic.message}`,
        [p.actor],
        r.diagnostic,
      );
  }
}
export function readCommunalSupper(rt: Runtime, id: string) {
  const ex = find(rt, id),
    rec = rt.records.get(id);
  if (!ex || !rec) return;
  return structuredClone({
    action: id,
    status: rec.status,
    stage: ['preparing', 'sharing', 'storing-mealware', 'storing-prepware'][
      ex.stage
    ],
    mode: ex.mode,
    finished: ex.finished,
    prepared: ex.prepared,
    mealComplete: ex.mealComplete,
    bindings: ex.p,
    current: ex.child,
    ownedActions: ex.children,
    claims: actualClaims(rt),
    returnAttempts: ex.returns.map((id) => rt.records.get(id)),
    diagnostic:
      ex.diagnostic ??
      (ex.child
        ? (readSharedFoodBreak(rt, ex.child)?.diagnostic ??
          rt.records.get(ex.child)?.diagnostic)
        : undefined) ??
      rec.diagnostic,
    waitingReason: ex.diagnostic?.message ?? rec.diagnostic?.message,
    preparation: readFoodPreparation(rt, ex.p.preparation.pot),
    meal:
      ex.stage === 1 && ex.child
        ? readSharedFoodBreak(rt, ex.child)
        : [...ex.children]
            .reverse()
            .map((c) => readSharedFoodBreak(rt, c))
            .find(Boolean),
    cleanup: ex.children.map((c) => readTidyTable(rt, c)).filter(Boolean),
    items: ids(ex.p).map((id) => rt.world.entities[id]),
    held: ex.p.meal.participants.map((q) => ({
      actor: q.actor,
      items: heldBy(rt.world, q.actor).map((h) => h.item.id),
    })),
  });
}
export const communalSupper: ActionDef<CommunalSupperParams, null, Exec> = {
  verb: 'communal_supper',
  description:
    'Hypothetical finite preparation, same two-person meal and seven-vessel storage through ordinary actions.',
  schema: z.strictObject({
    preparation: prepareFood.schema,
    meal: sharedFoodBreak.schema,
    cleanup: z.tuple([tidyTable.schema, tidyTable.schema]),
  }),
  reservations: () => [{ resource: 'communal-supper', mode: 'exclusive' }],
  plan(rt, p) {
    const actors = p.meal.participants.map((q) => q.actor),
      ware = p.cleanup.flatMap((q) => q.transfers.map((t) => t.item));
    if (
      ids(p).length !== 7 ||
      new Set(actors).size !== 2 ||
      !actors.includes(p.preparation.actor) ||
      p.meal.pot !== p.preparation.pot ||
      p.meal.resumeFrom ||
      p.cleanup[0].transfers.length !== 4 ||
      !p.cleanup[0].transfers.every((t) =>
        p.meal.participants.some((q) =>
          q.returns.some((r) => r.item === t.item && r.surfaceSlot === t.from),
        ),
      ) ||
      !p.cleanup[1].transfers.every((t) =>
        [p.preparation.pot, ...p.preparation.ingredients].includes(t.item),
      ) ||
      p.cleanup[1].transfers.length !== 3 ||
      new Set(ware).size !== 7 ||
      !ids(p).every((id) => ware.includes(id)) ||
      !p.meal.participants.some(
        (q) =>
          q.actor === p.preparation.actor && q.spoon === p.preparation.spoon,
      ) ||
      p.cleanup.some((q) => !actors.includes(q.actor)) ||
      p.meal.participants.some(
        (q) => (rt.world.entities[q.bowl]?.contents?.fraction ?? 0) !== 0,
      )
    )
      return {
        ok: false,
        diagnostic: issue(
          'definition',
          'Requires two people and exactly the same seven preparation/meal vessels in two declared storage batches',
          ware,
        ),
      };
    const r = prepareFood.plan(rt, p.preparation);
    if (!r.ok) return r;
    return { ok: true, program: null };
  },
  start(rt, p, _program, id) {
    const ex: Exec = {
      id,
      p: structuredClone(p),
      stage: 0,
      mode: 'running',
      children: [],
      prepared: false,
      mealComplete: false,
      finished: false,
      binding: binding(rt, p),
      identities: identity(rt, p),
      returns: [],
      returnCursor: 0,
      stored: {},
      materialTotal: materialTotal(rt, p),
      ingredientFoods: JSON.stringify(
        p.preparation.ingredients.map(
          (id) => rt.world.entities[id]?.contents?.food,
        ),
      ),
    };
    store(rt)[id] = ex;
    return ex;
  },
  step(rt, ex) {
    if (ex.mode === 'ending') {
      if (ex.child && rt.isActive(ex.child))
        return { status: 'running', phase: 'ending' };
      if (ex.returns.some((id) => rt.isActive(id)))
        return { status: 'running', phase: 'returning' };
      const stopped = unresolvedReturn(rt, ex);
      if (stopped)
        return {
          status: 'blocked',
          diagnostic: issue(
            'return-stopped',
            'Ordinary utensil return stopped or its placement changed; finish the independent directive, then explicitly retry End, or physically return the same utensils to approved slots',
            [stopped],
          ),
        };
      const ps = returnParams(rt, ex);
      if (ps.length) {
        const p = ps[0],
          plan = stowItems.plan(rt, p);
        if (!plan.ok)
          return {
            status: 'blocked',
            diagnostic: issue(
              'return-unavailable',
              plan.diagnostic.message,
              [p.actor],
              plan.diagnostic,
            ),
          };
        const r = rt.submit('stow_items', p, { parent: ex.id, preempt: false });
        ex.returns.push(r.id);
        ex.children.push(r.id);
        return { status: 'running', phase: 'returning' };
      }
      const busy = ex.p.meal.participants.find(
        (q) => rt.holder(`actor:${q.actor}`).length,
      );
      if (busy)
        return {
          status: 'blocked',
          diagnostic: issue(
            'return-directive-active',
            'Wait for the independent participant directive or ordinary return to finish before End releases its logical claim',
            [busy.actor],
          ),
        };
      ex.mode = 'completed';
      return { status: 'completed', outputs: { finished: false } };
    }
    if (ex.mode === 'pausing') {
      if (ex.stage < 2 && ex.child && rt.isActive(ex.child))
        return { status: 'running', phase: 'pausing' };
      if (
        ex.stage >= 2 &&
        ex.child &&
        rt.isActive(ex.child) &&
        !['paused', 'waiting'].includes(readTidyTable(rt, ex.child)?.mode ?? '')
      )
        return { status: 'running', phase: 'pausing' };
      ex.mode = 'paused';
      return { status: 'running', phase: 'paused' };
    }
    if (ex.mode === 'paused' || ex.mode === 'waiting')
      return { status: 'running', phase: ex.mode };
    const bad = retained(rt, ex);
    if (bad) {
      controlChild(rt, ex, 'pause');
      ex.diagnostic = bad;
      ex.mode = 'pausing';
      return { status: 'blocked', diagnostic: bad };
    }
    if (ex.child) {
      const rec = rt.records.get(ex.child)!;
      if (rt.isActive(ex.child)) {
        const tidy = ex.stage >= 2 ? readTidyTable(rt, ex.child) : undefined;
        if (tidy && ['paused', 'waiting'].includes(tidy.mode))
          return wait(
            ex,
            issue(
              'cleanup-waiting',
              tidy.waitingReason ??
                'Cleanup yielded; explicitly Resume retained same task',
              [ex.child],
              tidy.diagnostic,
            ),
          );
        return { status: 'running', phase: rec.phase ?? verb(ex.stage) };
      }
      const completed =
        rec.status === 'completed' &&
        (ex.stage === 0
          ? readFoodPreparation(rt, ex.p.preparation.pot)?.complete
          : ex.stage === 1
            ? mealReady(rt, rec.id)
            : tidyReady(rt, ex.child));
      if (!completed)
        return wait(
          ex,
          issue(
            'child-stopped',
            `${rec.verb} stopped ${rec.status}; explicit continuation must pass original admission`,
            [ex.child],
            (ex.stage === 1
              ? readSharedFoodBreak(rt, rec.id)?.diagnostic
              : undefined) ?? rec.diagnostic,
          ),
        );
      if (ex.stage === 0) ex.prepared = true;
      if (ex.stage === 1) {
        ex.mealComplete = true;
        ex.payloads = payload(rt, ex.p);
      }
      if (ex.stage >= 2)
        for (const t of ex.p.cleanup[ex.stage - 2].transfers)
          ex.stored[t.item] = storedView(rt, t.item);
      if (ex.stage === 3) {
        ex.finished = true;
        ex.mode = 'completed';
        return { status: 'completed', outputs: { finished: true } };
      }
      ex.stage = (ex.stage + 1) as Exec['stage'];
      ex.child = undefined;
    }
    const d = admission(rt, ex);
    if (d) return wait(ex, d);
    const r = rt.submit(verb(ex.stage), params(ex), {
      parent: ex.id,
      preempt: false,
    });
    ex.child = r.id;
    ex.children.push(r.id);
    return { status: 'running', phase: verb(ex.stage) };
  },
  cancel(rt, ex) {
    if (ex.mode !== 'ending') {
      ex.mode = 'ending';
      controlChild(rt, ex, 'end');
    }
    return { ok: true, deferred: true };
  },
  resumable:
    'Active supper graph restoration is unsupported; explicit same-runtime controls retain leaf effects.',
};
export const communalSupperControl: ActionDef<
  CommunalSupperControlParams,
  null,
  null
> = {
  verb: 'communal_supper_control',
  description: 'Explicit safe Pause, same-purpose Resume or draining End.',
  schema: z.strictObject({
    supper: z.string(),
    intent: z.enum(['pause', 'resume', 'end']),
  }),
  reservations: () => [],
  plan(rt, p) {
    const ex = find(rt, p.supper);
    if (!ex || !rt.isActive(p.supper) || ex.mode === 'completed')
      return {
        ok: false,
        diagnostic: issue('inactive', 'Supper is no longer controllable', [
          p.supper,
        ]),
      };
    if (ex.mode === 'ending') {
      if (p.intent !== 'end')
        return {
          ok: false,
          diagnostic: issue(
            'ending',
            'Only an explicit End retry is available while draining supported returns',
            [p.supper],
          ),
        };
      if (
        (ex.child && rt.isActive(ex.child)) ||
        ex.returns.some((id) => rt.isActive(id))
      )
        return { ok: true, program: null };
      const d = retryEndIssue(rt, ex);
      return d ? { ok: false, diagnostic: d } : { ok: true, program: null };
    }
    if (p.intent === 'resume') {
      if (!['paused', 'waiting'].includes(ex.mode))
        return {
          ok: false,
          diagnostic: issue(
            'not-paused',
            'Wait for safe physical release before Resume',
            [p.supper],
          ),
        };
      const d = admission(rt, ex);
      if (d) return { ok: false, diagnostic: d };
    }
    if (p.intent === 'pause' && !['running', 'waiting'].includes(ex.mode))
      return {
        ok: false,
        diagnostic: issue(
          'not-running',
          'Supper is already draining or paused',
          [p.supper],
        ),
      };
    return { ok: true, program: null };
  },
  start(rt, p) {
    const ex = find(rt, p.supper)!;
    if (p.intent === 'end') {
      if (ex.mode === 'ending') {
        if (
          !(ex.child && rt.isActive(ex.child)) &&
          !ex.returns.some((id) => rt.isActive(id))
        ) {
          ex.returnCursor = ex.returns.length;
          ex.diagnostic = undefined;
        }
      } else rt.cancel(ex.id);
    } else if (p.intent === 'pause') {
      ex.mode = 'pausing';
      controlChild(rt, ex, 'pause');
    } else {
      if (ex.stage >= 2 && ex.child && rt.isActive(ex.child))
        controlChild(rt, ex, 'resume');
      else if (ex.child && !isComplete(rt, ex)) {
        const p = params(ex);
        const r = rt.submit(verb(ex.stage), p, {
          parent: ex.id,
          preempt: false,
        });
        ex.child = r.id;
        ex.children.push(r.id);
      }
      ex.mode = 'running';
      ex.diagnostic = undefined;
    }
    return null;
  },
  step: () => ({ status: 'completed' }),
  cancel: () => ({ ok: true }),
  resumable: true,
};
export const COMMUNAL_SUPPER_ACTIONS: ActionDef[] = [
  communalSupper,
  communalSupperControl,
];
