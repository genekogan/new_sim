import { z } from 'zod';
import type { ActionDef, Diagnostic, Reservation } from '../actions/types.ts';
import { DT, type Runtime } from '../runtime/runtime.ts';
import { holdingDiagnostic } from '../construction/rules.ts';
import { humanOf } from '../social/actions.ts';
import { heldBy, isItem, surfaceSlot } from '../items/model.ts';
export interface StowPlacement {
  item: string;
  surfaceSlot: string;
}
export interface StowParams {
  actor: string;
  placements: StowPlacement[];
  allowGround?: boolean;
}
export type StowPhase =
  | 'preparing'
  | 'stowing'
  | 'prepared'
  | 'stopping'
  | 'cancelled'
  | 'failed';
export interface StowReadout {
  action: string;
  actor: string;
  status: StowPhase;
  phase: StowPhase;
  current?: StowPlacement;
  completed: StowPlacement[];
  remaining: string[];
  waitingReason?: string;
  diagnostic?: Diagnostic;
}
type Program = { bindings: Record<string, string> };
type Exec = {
  startedTick: number;
  bindings: Record<string, string>;
  id: string;
  params: StowParams;
  phase: StowPhase;
  index: number;
  child?: string;
  children: string[];
  completed: StowPlacement[];
  stopping: boolean;
  error?: Diagnostic;
};
type Store = Record<string, Exec>;
const store = (rt: Runtime): Store => (rt.services.stowActivities ??= {});
const diag = (
  code: string,
  message: string,
  subjects: string[],
): Diagnostic => ({ code: `stow.${code}`, message, subjects });
function binding(rt: Runtime, slotID: string): string | Diagnostic {
  const slot = surfaceSlot(rt.world, slotID);
  if ('code' in slot) return slot;
  const owner = rt.world.entities[slot.owner];
  return JSON.stringify({ def: owner.def, pose: owner.pose, point: slot.p });
}
function placed(rt: Runtime, p: StowPlacement): boolean {
  const support = rt.world.entities[p.item]?.support,
    split = p.surfaceSlot.lastIndexOf('#');
  return (
    support?.kind === 'resting-on' &&
    support.on === p.surfaceSlot.slice(0, split) &&
    support.slot === p.surfaceSlot.slice(split + 1)
  );
}
function refresh(rt: Runtime, ex: Exec) {
  // Physical release counts even if interrupted while the hand withdraws.
  for (const p of ex.params.placements)
    if (!ex.completed.some((q) => q.item === p.item) && placed(rt, p))
      ex.completed.push({ ...p });
}
function stop(rt: Runtime, ex: Exec, error?: Diagnostic) {
  ex.stopping = true;
  ex.phase = 'stopping';
  ex.error ??= error;
  for (const id of ex.children) if (rt.isActive(id)) rt.cancel(id);
  refresh(rt, ex);
}
export function readStow(rt: Runtime, action: string): StowReadout | undefined {
  const record = rt.records.get(action),
    ex = (rt.services.stowActivities as Store | undefined)?.[action];
  if (!record || record.verb !== 'stow_items') return undefined;
  const params = record.params as StowParams;
  if (!ex) {
    const actor = typeof params?.actor === 'string' ? params.actor : '';
    const phase =
      record.status === 'completed'
        ? 'prepared'
        : record.status === 'cancelled'
          ? 'cancelled'
          : 'failed';
    const placements = Array.isArray(params?.placements)
      ? params.placements.filter(
          (p) =>
            p &&
            typeof p.item === 'string' &&
            typeof p.surfaceSlot === 'string',
        )
      : [];
    const completed = placements.filter((p) => placed(rt, p));
    return {
      action,
      actor,
      status: phase,
      phase,
      completed: completed.map((p) => ({ ...p })),
      remaining: heldBy(rt.world, actor).map(({ item }) => item.id),
      diagnostic: record.diagnostic,
    };
  }
  const phase =
    record.status === 'failed'
      ? 'failed'
      : record.status === 'cancelled'
        ? 'cancelled'
        : record.status === 'completed'
          ? 'prepared'
          : (ex?.phase ?? 'preparing');
  const released = params.placements.filter(
    (p) => ex?.completed.some((q) => q.item === p.item) || placed(rt, p),
  );
  const current = ex && !ex.stopping ? params.placements[ex.index] : undefined;
  return {
    action,
    actor: params.actor,
    status: phase,
    phase,
    current: current ? { ...current } : undefined,
    completed: released.map((p) => ({ ...p })),
    remaining: heldBy(rt.world, params.actor).map(({ item }) => item.id),
    waitingReason:
      phase === 'preparing'
        ? 'waiting to start the first physical put'
        : phase === 'stowing'
          ? `waiting for ${current?.item ?? 'item'} physical release and hand withdrawal`
          : phase === 'stopping'
            ? 'waiting for physical child stops before releasing preparation claims'
            : undefined,
    diagnostic: ex?.error ?? record.diagnostic,
  };
}
const id = z.string().min(1).max(80);
export const stowItems: ActionDef<StowParams, Program, Exec> = {
  drivesReservedHands: false,
  yieldTo: () => [],
  verb: 'stow_items',
  description:
    'Explicitly put all 1–2 held small items onto caller-approved fixed surface slots through serial ordinary put_item children. Ground and automatic next-activity transitions are unsupported.',
  schema: z.strictObject({
    actor: id,
    placements: z
      .array(z.strictObject({ item: id, surfaceSlot: id }))
      .min(1)
      .max(2),
    allowGround: z.boolean().optional(),
  }),
  reservations: (_world, p) => [
    { resource: `actor:${p.actor}`, mode: 'exclusive' },
    { resource: `hand:${p.actor}:left`, mode: 'exclusive' },
    { resource: `hand:${p.actor}:right`, mode: 'exclusive' },
    ...p.placements.flatMap((q): Reservation[] => [
      { resource: `entity:${q.item}`, mode: 'exclusive' },
      { resource: `surface-slot:${q.surfaceSlot}`, mode: 'exclusive' },
    ]),
  ],
  plan(rt, p) {
    const actor = humanOf(rt, p.actor);
    if ('code' in actor) return { ok: false, diagnostic: actor };
    const grip = holdingDiagnostic(rt.world, p.actor);
    if (grip) return { ok: false, diagnostic: grip };
    if (p.placements.some((q) => q.surfaceSlot === 'ground'))
      return {
        ok: false,
        diagnostic: diag(
          'ground-unsupported',
          `${p.actor} must choose approved surface slots; ground stow requires shared ground placement safety not yet supported`,
          [p.actor, ...p.placements.map((q) => q.item)],
        ),
      };
    if (
      !rt.services.spatial ||
      actor.human!.level !== 0 ||
      Math.abs(actor.pose.p[1]) > 0.01 ||
      rt.services.spatial.base.links.some((l: { usable: boolean }) => l.usable)
    )
      return {
        ok: false,
        diagnostic: diag(
          'ground-scope',
          `${p.actor} stow supports standing ground actors in arrangements without usable access links`,
          [p.actor],
        ),
      };
    if (actor.human!.activity !== 'idle')
      return {
        ok: false,
        diagnostic: diag(
          'not-standing',
          `${p.actor} must finish ${actor.human!.activity} and stand idle before putting belongings away`,
          [p.actor],
        ),
      };
    if (new Set(p.placements.map((q) => q.item)).size !== p.placements.length)
      return {
        ok: false,
        diagnostic: diag(
          'duplicate-item',
          `${p.actor} lists a held item twice`,
          [p.actor, ...p.placements.map((q) => q.item)],
        ),
      };
    if (
      new Set(p.placements.map((q) => q.surfaceSlot)).size !==
      p.placements.length
    )
      return {
        ok: false,
        diagnostic: diag(
          'duplicate-destination',
          `${p.actor} must choose distinct surface slots for the held items`,
          [p.actor, ...p.placements.map((q) => q.surfaceSlot)],
        ),
      };
    const bindings: Record<string, string> = {};
    for (const q of p.placements) {
      const item = rt.world.entities[q.item];
      if (!item)
        return {
          ok: false,
          diagnostic: diag(
            'item-missing',
            `${p.actor} cannot put missing item ${q.item} away`,
            [p.actor, q.item],
          ),
        };
      if (!isItem(item))
        return {
          ok: false,
          diagnostic: diag(
            'not-small-item',
            `${q.item} is not a small hand-held item for ${p.actor} to stow`,
            [p.actor, q.item],
          ),
        };
      if (item.support?.kind !== 'in-hand' || item.support.by !== p.actor)
        return {
          ok: false,
          diagnostic: diag('not-held', `${p.actor} is not holding ${q.item}`, [
            p.actor,
            q.item,
          ]),
        };
      const resolved = binding(rt, q.surfaceSlot);
      if (typeof resolved !== 'string')
        return { ok: false, diagnostic: resolved };
      bindings[q.surfaceSlot] = resolved;
    }
    const held = Object.values(rt.world.entities).filter(
      (e) => e.support?.kind === 'in-hand' && e.support.by === p.actor,
    );
    if (
      held.length !== p.placements.length ||
      held.some((e) => !p.placements.some((q) => q.item === e.id)) ||
      heldBy(rt.world, p.actor).length !== held.length
    )
      return {
        ok: false,
        diagnostic: diag(
          'incomplete-placement',
          `${p.actor} must explicitly supply exactly one destination for every held item (${held.map((e) => e.id).join(', ')})`,
          [p.actor, ...held.map((e) => e.id)],
        ),
      };
    const put = rt.registry.get('put_item');
    if (!put)
      return {
        ok: false,
        diagnostic: diag(
          'put-missing',
          `${p.actor} stow requires registered put_item`,
          [p.actor],
        ),
      };
    for (const r of stowItems.reservations(rt.world, p)) {
      const holders = rt.holder(r.resource);
      if (holders.length)
        return {
          ok: false,
          diagnostic: diag(
            'busy',
            `${p.actor} cannot prepare: ${r.resource} is held by ${holders.join(', ')}`,
            [p.actor, r.resource, ...holders],
          ),
        };
    }
    for (const q of p.placements) {
      const preview = put.plan(rt, {
        actor: p.actor,
        item: q.item,
        surfaceSlot: q.surfaceSlot,
      });
      if (!preview.ok) return preview;
    }
    return { ok: true, program: { bindings } };
  },
  start(rt, params, program, id) {
    const ex: Exec = {
      startedTick: rt.world.tick,
      bindings: program.bindings,
      id,
      params,
      phase: 'preparing',
      index: 0,
      children: [],
      completed: [],
      stopping: false,
    };
    store(rt)[id] = ex;
    return ex;
  },
  step(rt, ex) {
    refresh(rt, ex);
    if (!ex.stopping && rt.world.tick - ex.startedTick >= Math.ceil(120 / DT))
      stop(
        rt,
        ex,
        diag(
          'timeout',
          `${ex.params.actor} stow exceeded 120 simulation seconds; stopping physical children with placed items preserved`,
          [ex.params.actor, ...ex.params.placements.map((q) => q.item)],
        ),
      );
    if (ex.stopping) {
      if (ex.children.some((id) => rt.isActive(id)))
        return { status: 'running', phase: 'stopping' };
      if (ex.error) {
        ex.phase = 'failed';
        return { status: 'failed', diagnostic: ex.error };
      }
      ex.phase = 'cancelled';
      return {
        status: 'completed',
        outputs: {
          completed: ex.completed,
          remaining: heldBy(rt.world, ex.params.actor).map(
            ({ item }) => item.id,
          ),
        },
      };
    }
    if (ex.child) {
      if (rt.isActive(ex.child)) return { status: 'running', phase: 'stowing' };
      const record = rt.records.get(ex.child)!;
      if (record.status !== 'completed') {
        stop(
          rt,
          ex,
          record.diagnostic ??
            diag(
              'child-stopped',
              `${ex.params.actor} physical put ${ex.child} ended ${record.status}`,
              [ex.params.actor, ex.child],
            ),
        );
        return { status: 'running', phase: 'stopping' };
      }
      if (!placed(rt, ex.params.placements[ex.index])) {
        stop(
          rt,
          ex,
          diag(
            'support-changed',
            `${ex.params.placements[ex.index].item} did not remain on approved destination ${ex.params.placements[ex.index].surfaceSlot}`,
            [ex.params.actor, ex.params.placements[ex.index].item],
          ),
        );
        return { status: 'running', phase: 'stopping' };
      }
      ex.index++;
      ex.child = undefined;
    }
    if (ex.index === ex.params.placements.length) {
      const changed = ex.params.placements.find((p) => !placed(rt, p));
      if (changed) {
        stop(
          rt,
          ex,
          diag(
            'support-changed',
            `${changed.item} no longer rests on approved destination ${changed.surfaceSlot} at final preparation check`,
            [ex.params.actor, changed.item, changed.surfaceSlot],
          ),
        );
        return { status: 'running', phase: 'stopping' };
      }
      const remaining = heldBy(rt.world, ex.params.actor).map(
        ({ item }) => item.id,
      );
      if (remaining.length) {
        stop(
          rt,
          ex,
          diag(
            'hands-not-empty',
            `${ex.params.actor} still holds ${remaining.join(', ')} after preparation`,
            [ex.params.actor, ...remaining],
          ),
        );
        return { status: 'running', phase: 'stopping' };
      }
      ex.phase = 'prepared';
      return {
        status: 'completed',
        outputs: { completed: ex.completed, remaining },
      };
    }
    const q = ex.params.placements[ex.index];
    const resolved = binding(rt, q.surfaceSlot);
    if (
      typeof resolved !== 'string' ||
      resolved !== ex.bindings[q.surfaceSlot]
    ) {
      stop(
        rt,
        ex,
        typeof resolved !== 'string'
          ? resolved
          : diag(
              'destination-changed',
              `${q.surfaceSlot} changed before ${ex.params.actor} could put ${q.item} away`,
              [ex.params.actor, q.item, q.surfaceSlot],
            ),
      );
      return { status: 'running', phase: 'stopping' };
    }
    const child = rt.submit(
      'put_item',
      { actor: ex.params.actor, item: q.item, surfaceSlot: q.surfaceSlot },
      { parent: ex.id, preempt: false },
    );
    ex.children.push(child.id);
    ex.child = child.id;
    ex.phase = 'stowing';
    if (child.status === 'failed') stop(rt, ex, child.diagnostic);
    return { status: 'running', phase: ex.phase };
  },
  cancel(rt, ex) {
    stop(rt, ex);
    return { ok: true, deferred: true };
  },
  resumable:
    'active stow preparation is not resumable until child cancellation and partial-state snapshots are verified',
};
export const STOW_ACTIONS: ActionDef[] = [stowItems];
