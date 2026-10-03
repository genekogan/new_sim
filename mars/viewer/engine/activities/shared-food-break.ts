// Bounded two-person shared food, coordinated through ordinary physical actions.
import { z } from 'zod';
import type { ActionDef, ActionStatus, Diagnostic } from '../actions/types.ts';
import { DT, type Runtime } from '../runtime/runtime.ts';
import { heldBy, surfaceSlot, slotOccupant, isItem } from '../items/model.ts';
import { humanOf } from '../social/actions.ts';
import { holdingDiagnostic } from '../construction/rules.ts';
import { q6 } from '../core/math.ts';
import { stableStringify } from '../core/hash.ts';
import { SERVING, SPOONFUL } from '../items/actions.ts';
import { createTurns, stepTurns, type TurnState } from './turns.ts';
import type { Vec2 } from '../core/math.ts';
import type { StowPlacement } from './stow.ts';

export interface SharedFoodParticipant {
  actor: string;
  bowl: string;
  spoon: string;
  service: Vec2;
  returns: StowPlacement[];
}
export interface SharedFoodBreakParams {
  pot: string;
  participants: [SharedFoodParticipant, SharedFoodParticipant];
  at: Vec2;
  resumeFrom?: string;
}
/** Retained own-leaf material receipts, in bowl fractions (pot serving remains 1/4). */
export interface SharedFoodReceipt {
  actor: string;
  bowl: string;
  spoon: string;
  food?: string;
  served: boolean;
  portion: number;
  remaining: number;
  consumed: number;
  consumptionCompleted: boolean;
  serves: string[];
  eats: string[];
}
type Checkpoint = {
  receipts: SharedFoodReceipt[];
  items: Record<string, string>;
  surfaces: Record<string, string>;
  records: string[];
};
type Program = { source?: string };
export interface SharedFoodBreakReadout {
  action: string;
  purpose?: string;
  resumeFrom?: string;
  continuedBy?: string;
  receipts?: SharedFoodReceipt[];
  status: ActionStatus;
  phase: string;
  current?: string;
  group?: string;
  floorHolder?: string;
  attentionTarget?: { actor: string; position: number[] };
  participants: {
    actor: string;
    held: string[];
    food: number;
    returned: string[];
  }[];
  stopping: boolean;
  waitingReason?: string;
  diagnostic?: Diagnostic;
}
type Step = { verb: string; params: Record<string, unknown>; phase: string };
type Exec = {
  id: string;
  p: SharedFoodBreakParams;
  started: number;
  phase: string;
  queue: Step[];
  index: number;
  child?: string;
  children: string[];
  group?: string;
  eats: string[];
  eatStarted: boolean;
  prior: string[];
  groupEnding: boolean;
  turns: TurnState;
  stopping: boolean;
  error?: Diagnostic;
  purpose: string;
  baseReceipts: SharedFoodReceipt[];
  potContents?: { food: string; fraction: number };
  checkpoint?: Checkpoint;
  checkpointIssue?: Diagnostic;
  continuedBy?: string;
};
type Store = Record<string, Exec>;
const store = (rt: Runtime): Store => (rt.services.sharedFoodBreaks ??= {});
const diag = (
  code: string,
  message: string,
  subjects: string[],
  cause?: Diagnostic,
): Diagnostic => ({
  code: `shared_food.${code}`,
  message,
  subjects,
  ...(cause ? { details: { cause } } : {}),
});
const placed = (rt: Runtime, p: StowPlacement) => {
  const support = rt.world.entities[p.item]?.support,
    split = p.surfaceSlot.lastIndexOf('#');
  return (
    support?.kind === 'resting-on' &&
    support.on === p.surfaceSlot.slice(0, split) &&
    support.slot === p.surfaceSlot.slice(split + 1)
  );
};
const fixedBinding = (p: SharedFoodBreakParams) => {
  const { resumeFrom: _source, ...fixed } = p;
  return stableStringify(fixed);
};
const utensils = (p: SharedFoodBreakParams) => [
  p.pot,
  ...p.participants.flatMap((m) => [m.bowl, m.spoon]),
];
// Held poses legitimately follow an independent player walk. Anchored material
// must retain its exact placement; ownership/hand and all other payload stay fixed.
function itemCheckpoint(rt: Runtime, id: string) {
  const e = rt.world.entities[id];
  if (!e) return JSON.stringify(null);
  const { pose, phase: _phase, reservedBy: _reserved, ...payload } = e;
  return JSON.stringify({
    ...payload,
    ...(e.support?.kind === 'in-hand' ? {} : { pose }),
  });
}
function surfaceCheckpoints(rt: Runtime, p: SharedFoodBreakParams) {
  const owners = new Set(
    p.participants.flatMap((m) =>
      m.returns.map((q) => q.surfaceSlot.split('#')[0]),
    ),
  );
  const pot = rt.world.entities[p.pot];
  if (pot?.support?.kind === 'resting-on') owners.add(pot.support.on);
  return Object.fromEntries(
    [...owners].map((id) => {
      const e = rt.world.entities[id];
      return [
        id,
        JSON.stringify(
          e && {
            id: e.id,
            def: e.def,
            kind: e.kind,
            pose: e.pose,
            support: e.support,
          },
        ),
      ];
    }),
  );
}
function ownReceipts(rt: Runtime, ex: Exec): SharedFoodReceipt[] {
  if (ex.checkpoint) return structuredClone(ex.checkpoint.receipts);
  return ex.baseReceipts.map((base) => {
    const receipt = structuredClone(base);
    for (const id of ex.children) {
      const r = rt.records.get(id),
        p = r?.params as { actor?: string; bowl?: string } | undefined;
      if (!r || p?.actor !== receipt.actor || p.bowl !== receipt.bowl) continue;
      if (r.verb === 'serve' && r.history.some((h) => h.phase === 'back')) {
        receipt.served = true;
        receipt.portion = receipt.remaining = 1;
        receipt.food = ex.potContents?.food;
        receipt.serves.push(id);
      }
      if (r.verb === 'eat') {
        let phase: string | undefined;
        for (const h of r.history) {
          // Ordinary eat commits only on dip→lift. Repeated cancellation/status
          // entries at the same phase are not another spoonful.
          if (h.phase === 'lift' && phase !== 'lift')
            receipt.remaining = Math.max(0, q6(receipt.remaining - SPOONFUL));
          phase = h.phase;
        }
        if (r.history.some((h) => h.status === 'executing'))
          receipt.eats.push(id);
      }
    }
    receipt.consumed = q6(receipt.portion - receipt.remaining);
    receipt.consumptionCompleted = receipt.served && receipt.remaining <= 1e-9;
    return receipt;
  });
}
function receiptIssue(
  rt: Runtime,
  ex: Exec,
  receipts: SharedFoodReceipt[],
): Diagnostic | undefined {
  for (const r of receipts) {
    const e = rt.world.entities[r.bowl];
    if (
      !e ||
      e.contents?.fraction !== r.remaining ||
      (r.served && e.contents?.food !== r.food)
    )
      return diag(
        'resume-material',
        `${r.bowl} no longer matches its own committed serving/consumption receipt`,
        [r.actor, r.bowl, ex.p.pot],
      );
  }
  const served = receipts.reduce(
      (n, r, i) => n + r.serves.length - ex.baseReceipts[i].serves.length,
      0,
    ),
    pot = rt.world.entities[ex.p.pot]?.contents;
  if (
    pot &&
    (!Number.isFinite(pot.fraction) || pot.fraction < 0 || pot.fraction > 1)
  )
    return diag(
      'resume-material',
      `${ex.p.pot} has invalid retained food material`,
      [ex.p.pot, ex.id],
    );
  if (
    JSON.stringify(pot) !==
    JSON.stringify(
      ex.potContents && {
        food: ex.potContents.food,
        fraction: q6(ex.potContents.fraction - served * SERVING),
      },
    )
  )
    return diag(
      'resume-material',
      `${ex.p.pot} changed outside this meal's committed servings`,
      [ex.p.pot, ex.id],
    );
}
function sealCheckpoint(rt: Runtime, ex: Exec) {
  if (ex.checkpoint) return;
  const receipts = ownReceipts(rt, ex);
  ex.checkpointIssue = receiptIssue(rt, ex, receipts);
  ex.checkpoint = {
    receipts,
    items: Object.fromEntries(
      utensils(ex.p).map((id) => [id, itemCheckpoint(rt, id)]),
    ),
    surfaces: surfaceCheckpoints(rt, ex.p),
    records: [...rt.records.keys()],
  };
}
function continuationIssue(
  rt: Runtime,
  p: SharedFoodBreakParams,
): Diagnostic | undefined {
  if (!p.resumeFrom) return;
  const source = (rt.services.sharedFoodBreaks as Store | undefined)?.[
      p.resumeFrom
    ],
    record = rt.records.get(p.resumeFrom);
  if (!source || record?.verb !== 'shared_food_break')
    return diag(
      'resume-missing',
      `${p.resumeFrom} is not an existing same-Runtime shared food checkpoint`,
      [p.resumeFrom],
    );
  if (
    rt.isActive(p.resumeFrom) ||
    record.status !== 'cancelled' ||
    !source.checkpoint
  )
    return diag(
      'resume-not-cancelled',
      `${p.resumeFrom} must finish safe cancellation before continuation`,
      [p.resumeFrom],
    );
  if (source.continuedBy)
    return diag(
      'resume-superseded',
      `${p.resumeFrom} already continued as ${source.continuedBy}; use the latest safely cancelled checkpoint`,
      [p.resumeFrom, source.continuedBy],
    );
  if (fixedBinding(p) !== fixedBinding(source.p))
    return diag(
      'resume-binding',
      `${p.resumeFrom} requires the exact ordered participants, utensils, pot, service and return binding`,
      [p.resumeFrom, p.pot],
    );
  if (source.checkpointIssue) return source.checkpointIssue;
  for (const [id, expected] of Object.entries(source.checkpoint.items))
    if (itemCheckpoint(rt, id) !== expected)
      return diag(
        'resume-material',
        `${id}'s material, identity or physical support changed after ${p.resumeFrom}`,
        [id, p.resumeFrom],
      );
  if (
    JSON.stringify(surfaceCheckpoints(rt, p)) !==
    JSON.stringify(source.checkpoint.surfaces)
  )
    return diag(
      'resume-support',
      `${p.resumeFrom}'s declared supporting fixtures moved or changed`,
      [p.resumeFrom, p.pot],
    );
  const known = new Set(source.checkpoint.records),
    ids = new Set(utensils(p));
  for (const r of rt.records.values()) {
    if (
      known.has(r.id) ||
      owned(rt, r.id, p.resumeFrom) ||
      !r.history.some((h) => h.status === 'executing' || h.status === 'blocked')
    )
      continue;
    const q = r.params as {
      pot?: string;
      bowl?: string;
      spoon?: string;
      item?: string;
      placements?: StowPlacement[];
      participants?: SharedFoodParticipant[];
    };
    if (
      [
        q.pot,
        q.bowl,
        q.spoon,
        q.item,
        ...(q.placements ?? []).map((q) => q.item),
        ...(q.participants ?? []).flatMap((q) => [q.bowl, q.spoon]),
      ].some((id) => !!id && ids.has(id))
    )
      return diag(
        'resume-reused',
        `${r.verb} ${r.id} used this meal's retained material after ${p.resumeFrom}`,
        [p.resumeFrom, r.id, p.pot],
      );
  }
}
function stop(rt: Runtime, ex: Exec, error?: Diagnostic) {
  ex.stopping = true;
  ex.phase = 'stopping';
  ex.error ??= error;
  stepTurns(ex.turns, [], false, DT);
  for (const id of ex.children) if (rt.isActive(id)) rt.cancel(id);
}
function owned(rt: Runtime, action: string, parent: string): boolean {
  for (
    let rec = rt.records.get(action);
    rec;
    rec = rec.parent ? rt.records.get(rec.parent) : undefined
  )
    if (rec.id === parent) return true;
  return false;
}
function intervention(rt: Runtime, ex: Exec): Diagnostic | undefined {
  const actors = ex.p.participants.map((p) => p.actor);
  for (const rec of rt.records.values()) {
    if (
      ex.prior.includes(rec.id) ||
      !rec.history.some(
        (h) => h.status === 'executing' || h.status === 'blocked',
      ) ||
      rec.id === ex.id ||
      rec.verb === 'hold_items' ||
      (rec.verb === 'walk_to' && rec.internalCause === 'traffic.make-way') ||
      owned(rt, rec.id, ex.id)
    )
      continue;
    const p = rec.params as {
      actor?: string;
      actors?: string[];
      intent?: { actor?: string };
    };
    const actor = actors.find(
      (a) =>
        p.actor === a ||
        (Array.isArray(p.actors) && p.actors.includes(a)) ||
        p.intent?.actor === a,
    );
    if (actor)
      return diag(
        'interrupted',
        `${actor} received independent ${rec.verb} ${rec.id}; stopping this break without cancelling that command`,
        [actor, rec.id],
      );
  }
}
function dispatch(rt: Runtime, ex: Exec, step: Step) {
  const rec = rt.submit(step.verb, step.params, {
    parent: ex.id,
    preempt: false,
  });
  ex.children.push(rec.id);
  ex.child = rec.id;
  ex.phase = step.phase;
  if (rec.status === 'failed')
    stop(
      rt,
      ex,
      diag(
        'child-refused',
        `${step.verb} ${rec.id} refused: ${rec.diagnostic?.message}`,
        [rec.id],
        rec.diagnostic,
      ),
    );
  return rec;
}
function childProblem(rt: Runtime, ex: Exec): Diagnostic | undefined {
  for (const id of ex.children) {
    const rec = rt.records.get(id)!;
    if (
      rec.status === 'failed' ||
      (rec.status === 'cancelled' && !(id === ex.group && ex.groupEnding))
    )
      return diag(
        'child-stopped',
        `${rec.verb} ${id} ended ${rec.status}; partial food and held items are preserved`,
        [id],
        rec.diagnostic,
      );
  }
}
export function readSharedFoodBreak(
  rt: Runtime,
  action: string,
): SharedFoodBreakReadout | undefined {
  const rec = rt.records.get(action);
  if (!rec || rec.verb !== 'shared_food_break') return;
  const parsed = sharedFoodBreak.schema.safeParse(rec.params);
  if (!parsed.success) return;
  const p = parsed.data,
    ex = (rt.services.sharedFoodBreaks as Store | undefined)?.[action];
  const group = ex?.group ? rt.records.get(ex.group) : undefined;
  const members =
    group && rt.isActive(group.id)
      ? p.participants
          .map((person) => person.actor)
          .filter((actor) => rt.holder(`actor:${actor}`).includes(group.id))
      : [];
  const activeIssue = [...rt.records.values()]
    .reverse()
    .find(
      (child) =>
        rt.isActive(child.id) &&
        owned(rt, child.id, action) &&
        child.diagnostic,
    )?.diagnostic;
  const floor =
    rt.isActive(action) &&
    !ex?.stopping &&
    !ex?.groupEnding &&
    members.length >= 2 &&
    group?.phase === 'talking' &&
    rt.isActive(group.id) &&
    ex?.turns.floorHolder &&
    rt.holder(`actor:${ex.turns.floorHolder}`).includes(group.id)
      ? ex.turns.floorHolder
      : undefined;
  const diagnostic =
    activeIssue ??
    ex?.error ??
    ex?.checkpointIssue ??
    (ex?.child ? rt.records.get(ex.child)?.diagnostic : undefined) ??
    (group && rt.isActive(group.id) ? group.diagnostic : undefined) ??
    rec.diagnostic;
  const participants = p.participants.map((person) => ({
    actor: person.actor,
    held: heldBy(rt.world, person.actor).map((q) => q.item.id),
    food: rt.world.entities[person.bowl]?.contents?.fraction ?? 0,
    returned: person.returns.filter((q) => placed(rt, q)).map((q) => q.item),
  }));
  return {
    action,
    purpose: ex?.purpose,
    resumeFrom: p.resumeFrom,
    continuedBy: ex?.continuedBy,
    receipts: ex ? ownReceipts(rt, ex) : undefined,
    status: rec.status,
    phase: ex?.phase ?? rec.phase ?? rec.status,
    current: ex?.child,
    group: group ? group.id : undefined,
    floorHolder: floor,
    ...(floor && rt.world.entities[floor]
      ? {
          attentionTarget: {
            actor: floor,
            position: [...rt.world.entities[floor].pose.p],
          },
        }
      : {}),
    participants,
    stopping: ex?.stopping ?? false,
    diagnostic,
    ...(ex?.stopping
      ? {
          waitingReason: rt.isActive(action)
            ? (activeIssue?.message ??
              'Waiting for owned physical children to stop; partial items remain supported')
            : participants.some((p) => p.held.length)
              ? 'Held utensils remain; explicitly return them or retry this break'
              : 'Partial food and placements preserved',
        }
      : diagnostic && rt.isActive(action)
        ? { waitingReason: diagnostic.message }
        : {}),
  };
}
const id = z.string().min(1).max(160),
  xz = z.tuple([z.number(), z.number()]);
type SharedFoodDefinition = ActionDef<SharedFoodBreakParams, Program, Exec>;
export const sharedFoodBreak: SharedFoodDefinition = {
  verb: 'shared_food_break',
  description:
    'Two explicit people take their own utensils, serve only empty bowls, converse/eat, release the group and return utensils through ordinary actions. Safe interruption preserves partial food/items; work resume is separate.',
  schema: z.strictObject({
    pot: id,
    participants: z.tuple([
      z.strictObject({
        actor: id,
        bowl: id,
        spoon: id,
        service: xz,
        returns: z
          .array(z.strictObject({ item: id, surfaceSlot: id }))
          .length(2),
      }),
      z.strictObject({
        actor: id,
        bowl: id,
        spoon: id,
        service: xz,
        returns: z
          .array(z.strictObject({ item: id, surfaceSlot: id }))
          .length(2),
      }),
    ]),
    at: xz,
    resumeFrom: id.optional(),
  }),
  drivesReservedHands: false,
  yieldTo: (_rt, self) => [self.id],
  reservations: (_world, p) => [
    { resource: `shared-food:${p.pot}`, mode: 'exclusive' },
  ],
  plan(rt, p) {
    const reject = (
      code: string,
      message: string,
      subjects: string[],
      cause?: Diagnostic,
    ) => ({
      ok: false as const,
      diagnostic: diag(code, message, subjects, cause),
    });
    if (
      !rt.services.spatial ||
      rt.services.spatial.base.links.some((l: { usable: boolean }) => l.usable)
    )
      return reject(
        'ground-scope',
        'Shared food supports ground-only arrangements without usable access links',
        p.participants.map((q) => q.actor),
      );
    const badContinuation = continuationIssue(rt, p);
    if (badContinuation) return { ok: false, diagnostic: badContinuation };
    const source = p.resumeFrom
        ? (rt.services.sharedFoodBreaks as Store)[p.resumeFrom]
        : undefined,
      receipts = source?.checkpoint?.receipts;
    const seen = new Set<string>(),
      destinations = new Set<string>();
    let need = 0;
    for (const person of p.participants) {
      for (const key of [person.actor, person.bowl, person.spoon]) {
        if (seen.has(key))
          return reject(
            'duplicate',
            `${key} appears twice in shared food roles/items`,
            [key],
          );
        seen.add(key);
      }
      const actor = humanOf(rt, person.actor);
      if ('code' in actor)
        return reject('actor', actor.message, [person.actor], actor);
      const grip = holdingDiagnostic(rt.world, person.actor);
      if (grip) return reject('actor', grip.message, [person.actor], grip);
      if (
        actor.human!.level !== 0 ||
        Math.abs(actor.pose.p[1]) > 0.01 ||
        actor.human!.activity !== 'idle' ||
        rt.holder(`actor:${person.actor}`).length
      )
        return reject(
          'actor-busy',
          `${person.actor} must be unowned and standing idle on the ground`,
          [person.actor],
        );
      const held = heldBy(rt.world, person.actor);
      if (held.some((q) => ![person.bowl, person.spoon].includes(q.item.id)))
        return reject(
          'hands-full',
          `${person.actor} holds unrelated ${held.map((q) => q.item.id).join(', ')}`,
          [person.actor, ...held.map((q) => q.item.id)],
        );
      for (const [item, def] of [
        [person.bowl, 'bowl'],
        [person.spoon, 'spoon'],
      ]) {
        const e = rt.world.entities[item];
        if (!e || e.def !== def || !isItem(e))
          return reject(
            'utensil',
            `${person.actor} needs ${item} to be an available ${def}`,
            [person.actor, item],
          );
        if (e.support?.kind === 'in-hand' && e.support.by !== person.actor)
          return reject('foreign-item', `${item} is held by ${e.support.by}`, [
            person.actor,
            item,
            e.support.by,
          ]);
        if (
          !e.support ||
          !['in-hand', 'resting-on', 'ground'].includes(e.support.kind)
        )
          return reject(
            'support',
            `${item} has no supported accessible source`,
            [item],
          );
        for (const resource of [`entity:${item}`])
          if (rt.holder(resource).length)
            return reject(
              'resource-busy',
              `${resource} is held by ${rt.holder(resource).join(', ')}`,
              [item],
            );
      }
      for (const hand of ['left', 'right'])
        if (rt.holder(`hand:${person.actor}:${hand}`).length)
          return reject(
            'hands-busy',
            `${person.actor}'s ${hand} hand is reserved`,
            [person.actor],
          );
      const fraction = rt.world.entities[person.bowl].contents?.fraction ?? 0;
      if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1)
        return reject(
          'food-state',
          `${person.bowl} has invalid food fraction ${fraction}`,
          [person.bowl],
        );
      if (
        fraction <= 1e-9 &&
        !receipts?.find((r) => r.actor === person.actor)?.served
      )
        need += SERVING;
      if (
        new Set(person.returns.map((q) => q.item)).size !== 2 ||
        ![person.bowl, person.spoon].every((item) =>
          person.returns.some((q) => q.item === item),
        )
      )
        return reject(
          'returns',
          `${person.actor}'s approved returns must cover exactly ${person.bowl} and ${person.spoon}`,
          [person.actor, person.bowl, person.spoon],
        );
      for (const placement of person.returns) {
        if (
          placement.surfaceSlot === 'ground' ||
          destinations.has(placement.surfaceSlot)
        )
          return reject(
            'returns',
            `${placement.surfaceSlot} must be a distinct approved surface slot`,
            [placement.item, placement.surfaceSlot],
          );
        destinations.add(placement.surfaceSlot);
        const slot = surfaceSlot(rt.world, placement.surfaceSlot);
        if ('code' in slot)
          return reject(
            'returns',
            slot.message,
            [placement.item, placement.surfaceSlot],
            slot,
          );
        if (Math.abs(rt.world.entities[slot.owner].pose.p[1]) > 0.01)
          return reject(
            'returns-elevated',
            `${placement.surfaceSlot} requires an elevated return surface outside this ground-only break`,
            [placement.item, placement.surfaceSlot, slot.owner],
          );
        const occupant = slotOccupant(rt.world, slot.owner, slot.slot);
        if (occupant && occupant.id !== placement.item)
          return reject(
            'returns-occupied',
            `${placement.surfaceSlot} is occupied by ${occupant.id}`,
            [placement.item, placement.surfaceSlot, occupant.id],
          );
        if (rt.holder(`surface-slot:${placement.surfaceSlot}`).length)
          return reject(
            'resource-busy',
            `${placement.surfaceSlot} is reserved`,
            [placement.surfaceSlot],
          );
      }
    }
    const pot = rt.world.entities[p.pot];
    if (!pot || !isItem(pot) || pot.def !== 'pot' || seen.has(p.pot))
      return reject('pot', `${p.pot} must be a distinct supported shared pot`, [
        p.pot,
      ]);
    if (
      pot.support?.kind !== 'resting-on' ||
      rt.holder(`entity:${p.pot}`).length
    )
      return reject(
        'pot-unavailable',
        `${p.pot} must rest unreserved on a serving surface`,
        [p.pot],
      );
    if (
      need &&
      (!pot.contents ||
        !Number.isFinite(pot.contents.fraction) ||
        pot.contents.fraction + 1e-9 < need)
    )
      return reject(
        'food-unavailable',
        `${p.pot} needs ${need} remaining servings for empty bowls; has ${pot.contents?.fraction ?? 0}`,
        [p.pot, ...p.participants.map((q) => q.bowl)],
      );
    return { ok: true, program: { source: p.resumeFrom } };
  },
  start(rt, p, program, action) {
    const source = program.source
      ? (rt.services.sharedFoodBreaks as Store)[program.source]
      : undefined;
    const baseReceipts = source
      ? structuredClone(source.checkpoint!.receipts)
      : p.participants.map((person) => {
          const bowl = rt.world.entities[person.bowl],
            remaining = bowl.contents?.fraction ?? 0;
          return {
            actor: person.actor,
            bowl: person.bowl,
            spoon: person.spoon,
            food: bowl.contents?.food,
            served: remaining > 1e-9,
            portion: remaining,
            remaining,
            consumed: 0,
            consumptionCompleted: false,
            serves: [],
            eats: [],
          } satisfies SharedFoodReceipt;
        });
    const queue: Step[] = [];
    for (const person of p.participants) {
      const held = heldBy(rt.world, person.actor),
        bowl = held.find((q) => q.item.id === person.bowl),
        spoon = held.find((q) => q.item.id === person.spoon);
      if (!bowl)
        queue.push({
          verb: 'take_item',
          params: {
            actor: person.actor,
            item: person.bowl,
            hand: spoon?.hand === 'left' ? 'right' : 'left',
          },
          phase: 'taking',
        });
      if (!spoon)
        queue.push({
          verb: 'take_item',
          params: {
            actor: person.actor,
            item: person.spoon,
            hand: bowl?.hand === 'right' ? 'left' : 'right',
          },
          phase: 'taking',
        });
      if (
        (rt.world.entities[person.bowl].contents?.fraction ?? 0) <= 1e-9 &&
        !baseReceipts.find((r) => r.actor === person.actor)!.served
      ) {
        queue.push({
          verb: 'walk_to',
          params: {
            actor: person.actor,
            x: person.service[0],
            z: person.service[1],
          },
          phase: 'approaching',
        });
        queue.push({
          verb: 'serve',
          params: { actor: person.actor, pot: p.pot, bowl: person.bowl },
          phase: 'serving',
        });
      }
    }
    const ex: Exec = {
      id: action,
      p,
      started: rt.tick,
      phase: 'preparing',
      queue,
      index: 0,
      children: [],
      eats: [],
      eatStarted: false,
      prior: [...rt.records.keys()],
      groupEnding: false,
      turns: createTurns(0),
      stopping: false,
      purpose: source?.purpose ?? action,
      baseReceipts,
      potContents: structuredClone(rt.world.entities[p.pot].contents),
    };
    if (source) source.continuedBy = action;
    store(rt)[action] = ex;
    return ex;
  },
  step(rt, ex, dt) {
    if (!ex.stopping) {
      const bad =
        (ex.p.resumeFrom
          ? receiptIssue(rt, ex, ownReceipts(rt, ex))
          : undefined) ??
        intervention(rt, ex) ??
        childProblem(rt, ex);
      if (bad) stop(rt, ex, bad);
      else if ((rt.tick - ex.started) * DT >= 180)
        stop(
          rt,
          ex,
          diag(
            'timeout',
            'Shared food exceeded 180 simulation seconds; draining owned children safely',
            [ex.id],
          ),
        );
    }
    if (ex.stopping) {
      for (const id of ex.children) if (rt.isActive(id)) rt.cancel(id);
      if (ex.children.some((id) => rt.isActive(id)))
        return { status: 'running', phase: 'stopping' };
      sealCheckpoint(rt, ex);
      return ex.error
        ? { status: 'failed', diagnostic: ex.error }
        : { status: 'completed', outputs: { partial: true } };
    }
    if (ex.group && !ex.groupEnding && rt.isActive(ex.group)) {
      const talking = rt.records.get(ex.group)?.phase === 'talking';
      const members = ex.p.participants
        .map((p) => p.actor)
        .filter((actor) => rt.holder(`actor:${actor}`).includes(ex.group!));
      if (stepTurns(ex.turns, members, talking, dt))
        rt.mark('shared_food.floor-changed', {
          action: ex.id,
          group: ex.group,
          floorHolder: ex.turns.floorHolder,
        });
    }
    if (ex.groupEnding && ex.group && rt.isActive(ex.group))
      return { status: 'running', phase: 'releasing' };
    if (ex.child) {
      if (rt.isActive(ex.child)) return { status: 'running', phase: ex.phase };
      ex.child = undefined;
      ex.index++;
    }
    if (ex.index < ex.queue.length) {
      dispatch(rt, ex, ex.queue[ex.index]);
      return { status: 'running', phase: ex.phase };
    }
    if (!ex.group) {
      ex.group = dispatch(rt, ex, {
        verb: 'converse',
        params: {
          actors: ex.p.participants.map((p) => p.actor),
          at: ex.p.at,
        },
        phase: 'gathering',
      }).id;
      ex.child = undefined;
      return { status: 'running', phase: ex.phase };
    }
    if (!ex.eatStarted && !ex.groupEnding) {
      if (rt.records.get(ex.group)?.phase !== 'talking')
        return { status: 'running', phase: 'gathering' };
      ex.eatStarted = true;
      for (const person of ex.p.participants) {
        if (ex.stopping) break;
        if ((rt.world.entities[person.bowl]?.contents?.fraction ?? 0) > 1e-9)
          ex.eats.push(
            dispatch(rt, ex, {
              verb: 'eat',
              params: {
                actor: person.actor,
                bowl: person.bowl,
                spoon: person.spoon,
              },
              phase: 'eating',
            }).id,
          );
      }
      ex.child = undefined;
      if (!ex.stopping) ex.phase = 'eating';
      return { status: 'running', phase: ex.phase };
    }
    if (!ex.groupEnding) {
      if (ex.eats.some((id) => rt.isActive(id)))
        return { status: 'running', phase: 'eating' };
      ex.groupEnding = true;
      ex.phase = 'releasing';
      rt.cancel(ex.group);
      stepTurns(ex.turns, [], false, dt);
      ex.queue = ex.p.participants.map((person) => ({
        verb: 'stow_items',
        params: { actor: person.actor, placements: person.returns },
        phase: 'stowing',
      }));
      ex.index = 0;
      return { status: 'running', phase: ex.phase };
    }
    if (rt.isActive(ex.group)) return { status: 'running', phase: 'releasing' };
    const changed = ex.p.participants
      .flatMap((p) => p.returns)
      .find((p) => !placed(rt, p));
    if (changed) {
      stop(
        rt,
        ex,
        diag(
          'return-changed',
          `${changed.item} no longer rests on ${changed.surfaceSlot}`,
          [changed.item, changed.surfaceSlot],
        ),
      );
      return { status: 'running', phase: 'stopping' };
    }
    ex.phase = 'completed';
    sealCheckpoint(rt, ex);
    return {
      status: 'completed',
      outputs: {
        returned: ex.p.participants.flatMap((p) => p.returns),
        group: ex.group,
        purpose: ex.purpose,
        receipts: structuredClone(ex.checkpoint!.receipts),
      },
    };
  },
  cancel(rt, ex) {
    stop(rt, ex);
    return { ok: true, deferred: true };
  },
  resumable:
    'Active reload is unsupported; explicit resumeFrom continues only the latest safely cancelled same-Runtime material checkpoint.',
};
export const SHARED_FOOD_ACTIONS: ActionDef[] = [sharedFoodBreak];
