// Explicit object transfers; ordinary item actions own all manipulation and walking.
import { z } from 'zod';
import type {
  ActionDef,
  Diagnostic,
  Reservation,
  StepResult,
} from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Entity } from '../world/types.ts';
import { hashOf } from '../core/hash.ts';
import { obbOverlap, rot2, sub2, type Vec2 } from '../core/math.ts';
import { CATALOG } from '../world/catalog.ts';
import { HUMAN_PROFILE } from '../spatial/types.ts';
import type { Spatial } from '../spatial/service.ts';
import { entityCorners, entityFootprint } from '../spatial/service.ts';
import {
  heldBy,
  isItem,
  reachStation,
  surfaceSlot,
  type SurfaceSlot,
} from '../items/model.ts';
export interface TableTransfer {
  item: string;
  from: string;
  to: string;
}
export interface TidyTableParams {
  actor: string;
  transfers: TableTransfer[];
}
export interface TidyTableControlParams {
  task: string;
  intent: 'pause' | 'resume' | 'end';
}
interface PhysicalParams extends TableTransfer {
  actor: string;
}
type Binding = {
  surfaces: Record<string, string>;
  payloads: Record<string, string>;
};
type PhysicalExec = {
  id: string;
  p: PhysicalParams;
  binding: Binding;
  phase: 'starting' | 'taking' | 'putting' | 'releasing' | 'returned';
  child?: string;
  children: string[];
  stopping: boolean;
  error?: Diagnostic;
  returnSlot?: string;
  started: number;
};
type Mode =
  | 'tidying'
  | 'draining'
  | 'paused'
  | 'waiting'
  | 'ending'
  | 'completed';
type Exec = {
  id: string;
  p: TidyTableParams;
  binding: Binding;
  mode: Mode;
  index: number;
  completed: TableTransfer[];
  child?: string;
  children: string[];
  error?: Diagnostic;
  finished: boolean;
  ending: boolean;
};
const store = (rt: Runtime): Record<string, Exec> =>
  (rt.services.tableCleanup ??= {});
const physical = (rt: Runtime): Record<string, PhysicalExec> =>
  (rt.services.tableCleanupTransfers ??= {});
const diagnostic = (
  code: string,
  message: string,
  subjects: string[],
  cause?: Diagnostic,
): Diagnostic => ({
  code: `tidy_table.${code}`,
  message,
  subjects,
  ...(cause ? { details: { cause } } : {}),
});
const point = (e: Entity): Vec2 => [e.pose.p[0], e.pose.p[2]];
function payload(e: Entity) {
  const {
    pose: _pose,
    support: _support,
    phase: _phase,
    reservedBy: _reserved,
    ...rest
  } = e;
  return hashOf(rest);
}
function supportedSurface(rt: Runtime, id: string): SurfaceSlot | Diagnostic {
  const s = surfaceSlot(rt.world, id);
  if ('code' in s)
    return diagnostic('surface', s.message, [id, ...(s.subjects ?? [])], s);
  const e = rt.world.entities[s.owner];
  if (
    e.kind !== 'fixture' ||
    e.support?.kind !== 'ground' ||
    Math.abs(e.pose.p[1]) > 1e-9 ||
    Math.abs(e.pose.pitch ?? 0) > 1e-9 ||
    Math.abs(e.pose.roll ?? 0) > 1e-9 ||
    ['carried', 'raising'].includes(e.phase ?? '') ||
    !CATALOG[e.def]?.surfaceSlots?.length
  )
    return diagnostic(
      'table-support',
      `${s.owner} must be a flat grounded fixture with real surface slots for ${id}`,
      [s.owner, id],
    );
  return s;
}
function surfaceBinding(rt: Runtime, id: string) {
  const s = supportedSurface(rt, id);
  if ('code' in s) return s;
  const e = rt.world.entities[s.owner];
  return hashOf({ def: e.def, pose: e.pose, support: e.support, slot: s });
}
function atSlot(rt: Runtime, item: string, id: string) {
  const e = rt.world.entities[item],
    s = surfaceSlot(rt.world, id);
  return (
    !!e &&
    !('code' in s) &&
    e.support?.kind === 'resting-on' &&
    e.support.on === s.owner &&
    e.support.slot === s.slot &&
    e.pose.p.every((v, i) => Math.abs(v - s.p[i]) < 1e-9) &&
    Math.abs(e.pose.pitch ?? 0) < 1e-9 &&
    Math.abs(e.pose.roll ?? 0) < 1e-9
  );
}
function clearanceForItem(
  rt: Runtime,
  item: Entity,
  s: SurfaceSlot,
  preservePose = false,
): Diagnostic | undefined {
  const table = rt.world.entities[s.owner],
    size = CATALOG[table.def].size;
  const future: Entity = {
    ...item,
    pose: preservePose ? item.pose : { p: [...s.p], yaw: table.pose.yaw },
  };
  for (const p of entityCorners(future)) {
    const local = rot2(sub2([p[0], p[2]], point(table)), -table.pose.yaw);
    if (
      Math.abs(local[0]) > size[0] / 2 + 1e-9 ||
      Math.abs(local[1]) > size[2] / 2 + 1e-9
    )
      return diagnostic(
        'surface-capacity',
        `${item.id}'s actual footprint does not fit on ${s.id}`,
        [item.id, s.id, s.owner],
      );
  }
  for (const other of Object.values(rt.world.entities))
    if (
      other.id !== item.id &&
      other.support?.kind === 'resting-on' &&
      other.support.on === s.owner &&
      obbOverlap(entityFootprint(future).obb, entityFootprint(other).obb, 0.002)
    )
      return diagnostic(
        'destination-occupied',
        `${other.id} occupies or overlaps the approved footprint of ${item.id} at ${s.id}`,
        [item.id, s.id, other.id],
      );
}
function readyActor(
  rt: Runtime,
  actor: string,
  allowed?: string,
): Diagnostic | undefined {
  const e = rt.world.entities[actor];
  if (
    !e?.human ||
    e.human.level !== 0 ||
    Math.abs(e.pose.p[1]) > 0.01 ||
    e.human.on ||
    e.human.riding ||
    e.human.grip
  )
    return diagnostic(
      'actor-ground',
      `${actor} must be a free-standing ground person`,
      [actor],
    );
  const held = heldBy(rt.world, actor);
  if (held.some((q) => q.item.id !== allowed || q.hand !== 'right'))
    return diagnostic(
      'hands-occupied',
      `${actor} must put down ${held.map((q) => q.item.id).join(', ')} before table cleanup`,
      [actor, ...held.map((q) => q.item.id)],
    );
  const owners = rt.holder(`actor:${actor}`);
  if (owners.length || e.human.activity !== 'idle')
    return diagnostic(
      'actor-busy',
      `${actor} is held by ${owners.join(', ') || e.human.activity}`,
      [actor, ...owners],
    );
}
function routes(
  rt: Runtime,
  actor: string,
  from: SurfaceSlot,
  to: SurfaceSlot,
): Diagnostic | undefined {
  const sp = rt.services.spatial as Spatial | undefined,
    a = rt.world.entities[actor];
  if (!sp || sp.base.links.some((l) => l.usable))
    return diagnostic(
      'ground-route',
      `${actor}'s cleanup requires an authored ground scene without usable access links`,
      [actor, from.owner, to.owner],
    );
  const source = reachStation(
    rt,
    a,
    from.p,
    rt.world.entities[from.owner],
    from.id,
  );
  if ('code' in source)
    return diagnostic(
      'source-route',
      source.message,
      [actor, from.id, ...(source.subjects ?? [])],
      source,
    );
  // Detached planning pose chooses a destination edge from the actual source approach;
  // it never changes the actor or starts a second mover.
  const preview: Entity = {
    ...a,
    pose: {
      ...a.pose,
      p: [source.p[0], a.pose.p[1], source.p[1]],
      yaw: source.yaw,
    },
  };
  const dest = reachStation(
    rt,
    preview,
    to.p,
    rt.world.entities[to.owner],
    to.id,
  );
  if ('code' in dest)
    return diagnostic(
      'destination-route',
      dest.message,
      [actor, to.id, ...(dest.subjects ?? [])],
      dest,
    );
  for (const [start, end, label] of [
    [point(a), source.p, from.id],
    [source.p, dest.p, to.id],
  ] as const) {
    const r = sp.route(
      rt.world,
      HUMAN_PROFILE,
      { level: 0, p: start },
      { level: 0, p: end },
    );
    if (!r.ok)
      return diagnostic(
        'route-blocked',
        `${actor} cannot reach ${label}: ${r.diagnostic.message}`,
        [actor, label, ...(r.diagnostic.subjects ?? [])],
        r.diagnostic,
      );
    if (
      r.route.length > 30 ||
      r.route.legs.some((l) => l.kind === 'link' || l.level !== 0)
    )
      return diagnostic(
        'route-scope',
        `${actor}'s route to ${label} must remain on ground and within 30 m`,
        [actor, label],
      );
  }
}
function transferIssue(
  rt: Runtime,
  p: PhysicalParams,
  requireSource = true,
): Diagnostic | undefined {
  const e = rt.world.entities[p.item];
  if (!e)
    return diagnostic(
      'item-missing',
      `${p.actor} cannot transfer missing item ${p.item}`,
      [p.actor, p.item],
    );
  if (e.kind !== 'component' || !isItem(e))
    return diagnostic(
      'not-small-item',
      `${p.item} must be an existing one-hand carryable item`,
      [p.item],
    );
  const from = supportedSurface(rt, p.from),
    to = supportedSurface(rt, p.to);
  if ('code' in from) return from;
  if ('code' in to) return to;
  if (from.owner === to.owner)
    return diagnostic(
      'distinct-tables',
      `${p.from} and ${p.to} must name separate grounded source and destination fixtures`,
      [p.from, p.to],
    );
  if (requireSource && !atSlot(rt, p.item, p.from))
    return diagnostic(
      'item-source',
      `${p.item} must actually rest flat at declared source ${p.from}`,
      [p.item, p.from],
    );
  if (requireSource) {
    const sourceIssue = clearanceForItem(rt, e, from, true);
    if (sourceIssue)
      return diagnostic(
        'source-capacity',
        `${p.item}'s actual supported source footprint is invalid: ${sourceIssue.message}`,
        [p.item, p.from, ...(sourceIssue.subjects ?? [])],
        sourceIssue,
      );
  }
  const occupied = Object.values(rt.world.entities).find(
    (q) =>
      q.id !== p.item &&
      q.support?.kind === 'resting-on' &&
      q.support.on === to.owner &&
      q.support.slot === to.slot,
  );
  if (occupied)
    return diagnostic(
      'destination-occupied',
      `${occupied.id} occupies ${p.to} for ${p.item}`,
      [p.item, p.to, occupied.id],
    );
  return clearanceForItem(rt, e, to) ?? routes(rt, p.actor, from, to);
}
function binding(rt: Runtime, p: TidyTableParams): Binding {
  const surfaces: Record<string, string> = {},
    payloads: Record<string, string> = {};
  for (const q of p.transfers) {
    surfaces[q.from] = surfaceBinding(rt, q.from) as string;
    surfaces[q.to] = surfaceBinding(rt, q.to) as string;
    payloads[q.item] = payload(rt.world.entities[q.item]);
  }
  return { surfaces, payloads };
}
function bindingIssue(rt: Runtime, b: Binding): Diagnostic | undefined {
  for (const [id, saved] of Object.entries(b.surfaces)) {
    const now = surfaceBinding(rt, id);
    if (typeof now !== 'string') return now;
    if (now !== saved)
      return diagnostic(
        'surface-changed',
        `${id}'s approved support or position changed; explicit same-support continuation is required`,
        [id],
      );
  }
  for (const [id, saved] of Object.entries(b.payloads)) {
    const e = rt.world.entities[id];
    if (!e || payload(e) !== saved)
      return diagnostic(
        'item-changed',
        `${id}'s identity, definition, material or contents changed during table cleanup`,
        [id],
      );
  }
}
function dispatch(
  rt: Runtime,
  ex: PhysicalExec,
  verb: string,
  p: unknown,
  phase: PhysicalExec['phase'],
) {
  const r = rt.submit(verb, p, { parent: ex.id, preempt: false });
  ex.child = r.id;
  ex.children.push(r.id);
  ex.phase = phase;
  return r;
}
function stopPhysical(rt: Runtime, ex: PhysicalExec, error?: Diagnostic) {
  ex.error ??= error;
  if (ex.stopping) return;
  ex.stopping = true;
  ex.phase = 'releasing';
  if (ex.child && rt.isActive(ex.child)) rt.cancel(ex.child);
}
function released(rt: Runtime, ex: PhysicalExec): StepResult {
  const e = rt.world.entities[ex.p.item];
  if (e?.support?.kind === 'in-hand' && e.support.by === ex.p.actor) {
    const causes: Diagnostic[] = [];
    for (const id of [ex.p.from, ex.p.to]) {
      const slot = supportedSurface(rt, id);
      if ('code' in slot) {
        causes.push(slot);
        continue;
      }
      const cap = clearanceForItem(rt, e, slot);
      if (cap) {
        causes.push(cap);
        continue;
      }
      const plan = rt.registry
        .get('put_item')!
        .plan(rt, { actor: ex.p.actor, item: ex.p.item, surfaceSlot: id });
      if (!plan.ok) {
        causes.push(plan.diagnostic);
        continue;
      }
      ex.returnSlot = id;
      const child = dispatch(
        rt,
        ex,
        'put_item',
        { actor: ex.p.actor, item: ex.p.item, surfaceSlot: id },
        'releasing',
      );
      if (child.status === 'failed') {
        ex.child = undefined;
        causes.push(child.diagnostic!);
        continue;
      }
      return { status: 'running', phase: 'returning-held-item' };
    }
    const issue = diagnostic(
      'safe-return-unavailable',
      `${ex.p.actor} still holds ${ex.p.item}; both permitted supports ${ex.p.from} and ${ex.p.to} refuse safe release: ${causes.map((c) => c.message).join('; ')}`,
      [
        ex.p.actor,
        ex.p.item,
        ex.p.from,
        ex.p.to,
        ...causes.flatMap((c) => c.subjects ?? []),
      ],
      causes[0],
    );
    return { status: 'blocked', diagnostic: issue };
  }
  if (!atSlot(rt, ex.p.item, ex.p.from) && !atSlot(rt, ex.p.item, ex.p.to))
    return {
      status: 'blocked',
      diagnostic: diagnostic(
        'release-support',
        `${ex.p.item} must remain held by ${ex.p.actor} or rest on permitted ${ex.p.from}/${ex.p.to} before cleanup releases ownership`,
        [ex.p.actor, ex.p.item, ex.p.from, ex.p.to],
      ),
    };
  ex.phase = 'returned';
  return ex.error
    ? { status: 'failed', diagnostic: ex.error }
    : {
        status: 'completed',
        outputs: {
          item: ex.p.item,
          atDestination: atSlot(rt, ex.p.item, ex.p.to),
          support: structuredClone(e!.support),
        },
      };
}
const id = z.string().min(1).max(80),
  transferSchema = z.strictObject({ item: id, from: id, to: id });
/** Internal physical unit: safe preemption retains parent logical task for explicit resume. */
export const tidyTableTransfer: ActionDef<
  PhysicalParams,
  Binding,
  PhysicalExec
> = {
  verb: 'tidy_table_transfer',
  description:
    'Transfer one approved existing small item with ordinary take/put; safely return it to a declared support before any player handoff.',
  schema: transferSchema.extend({ actor: id }),
  drivesReservedHands: false,
  reservations: (_w, p) => [
    { resource: `actor:${p.actor}`, mode: 'exclusive' },
    { resource: `hand:${p.actor}:right`, mode: 'exclusive' },
    { resource: `entity:${p.item}`, mode: 'exclusive' },
  ],
  plan(rt, p) {
    const issue = readyActor(rt, p.actor) ?? transferIssue(rt, p);
    if (issue) return { ok: false, diagnostic: issue };
    for (const verb of ['take_item', 'put_item'])
      if (!rt.registry.has(verb))
        return {
          ok: false,
          diagnostic: diagnostic(
            'missing-action',
            `${p.item} requires registered ${verb}`,
            [p.item, verb],
          ),
        };
    return {
      ok: true,
      program: binding(rt, { actor: p.actor, transfers: [p] }),
    };
  },
  start(rt, p, binding, id) {
    const ex: PhysicalExec = {
      id,
      p: structuredClone(p),
      binding,
      phase: 'starting',
      children: [],
      stopping: false,
      started: rt.tick,
    };
    physical(rt)[id] = ex;
    return ex;
  },
  step(rt, ex) {
    if (!ex.stopping) {
      const issue = bindingIssue(rt, ex.binding);
      if (issue) stopPhysical(rt, ex, issue);
      else if (rt.tick - ex.started > 2400)
        stopPhysical(
          rt,
          ex,
          diagnostic(
            'transfer-timeout',
            `${ex.p.item}'s transfer exceeded 120 seconds`,
            [ex.p.actor, ex.p.item],
          ),
        );
    }
    if (ex.child) {
      if (rt.isActive(ex.child))
        return {
          status: 'running',
          phase: ex.stopping ? 'safe-release' : ex.phase,
        };
      const rec = rt.records.get(ex.child)!;
      ex.child = undefined;
      if (rec.status !== 'completed' && !ex.stopping)
        stopPhysical(
          rt,
          ex,
          rec.diagnostic ??
            diagnostic(
              'child-stopped',
              `${rec.verb} ${rec.id} stopped before ${ex.p.item} finished transferring`,
              [rec.id, ex.p.item],
            ),
        );
    }
    if (ex.stopping) return released(rt, ex);
    if (ex.phase === 'starting') {
      dispatch(
        rt,
        ex,
        'take_item',
        { actor: ex.p.actor, item: ex.p.item, hand: 'right' },
        'taking',
      );
      return { status: 'running', phase: 'taking' };
    }
    if (ex.phase === 'taking') {
      const to = supportedSurface(rt, ex.p.to);
      if ('code' in to) {
        stopPhysical(rt, ex, to);
        return released(rt, ex);
      }
      const issue = clearanceForItem(rt, rt.world.entities[ex.p.item], to);
      if (issue) {
        stopPhysical(rt, ex, issue);
        return released(rt, ex);
      }
      const child = dispatch(
        rt,
        ex,
        'put_item',
        { actor: ex.p.actor, item: ex.p.item, surfaceSlot: ex.p.to },
        'putting',
      );
      if (child.status === 'failed') stopPhysical(rt, ex, child.diagnostic);
      return { status: 'running', phase: 'putting' };
    }
    if (atSlot(rt, ex.p.item, ex.p.to)) {
      ex.phase = 'returned';
      return {
        status: 'completed',
        outputs: { item: ex.p.item, atDestination: true },
      };
    }
    stopPhysical(
      rt,
      ex,
      diagnostic(
        'destination-not-released',
        `${ex.p.item} did not physically release at ${ex.p.to}`,
        [ex.p.item, ex.p.to],
      ),
    );
    return released(rt, ex);
  },
  cancel(rt, ex) {
    stopPhysical(rt, ex);
    return { ok: true, deferred: true };
  },
  yieldTo: (_rt, self) => [self.id],
  resumable:
    'Ordinary children retain physical support; same-Runtime continuation only, active reload deferred.',
};
function refresh(rt: Runtime, ex: Exec) {
  for (const q of ex.p.transfers)
    if (
      !ex.completed.some((c) => c.item === q.item) &&
      atSlot(rt, q.item, q.to)
    ) {
      ex.completed.push({ ...q });
      rt.mark('tidy_table.transferred', {
        task: ex.id,
        actor: ex.p.actor,
        ...q,
      });
    }
  ex.index = ex.p.transfers.findIndex(
    (q) => !ex.completed.some((c) => c.item === q.item),
  );
}
function beginDrain(ex: Exec, end = false, error?: Diagnostic) {
  ex.ending ||= end;
  ex.error = error ?? ex.error;
  ex.mode = ex.ending ? 'ending' : 'draining';
}
function drain(rt: Runtime, ex: Exec): StepResult {
  if (ex.child && rt.isActive(ex.child)) {
    rt.cancel(ex.child);
    const rec = rt.records.get(ex.child)!;
    return rec.status === 'blocked' && rec.diagnostic
      ? { status: 'blocked', diagnostic: rec.diagnostic }
      : { status: 'running', phase: 'safe-release' };
  }
  refresh(rt, ex);
  ex.child = undefined;
  if (ex.ending) {
    ex.mode = 'completed';
    return {
      status: 'completed',
      outputs: {
        finished: ex.finished,
        completed: structuredClone(ex.completed),
        remaining: ex.p.transfers
          .filter((q) => !ex.completed.some((c) => c.item === q.item))
          .map((q) => q.item),
      },
    };
  }
  ex.mode = ex.error ? 'waiting' : 'paused';
  return ex.error
    ? { status: 'blocked', diagnostic: ex.error }
    : { status: 'running', phase: 'paused' };
}
function remainingIssue(rt: Runtime, ex: Exec): Diagnostic | undefined {
  const issue = readyActor(rt, ex.p.actor) ?? bindingIssue(rt, ex.binding);
  if (issue) return issue;
  for (const q of ex.p.transfers) {
    if (ex.completed.some((c) => c.item === q.item)) {
      if (!atSlot(rt, q.item, q.to))
        return diagnostic(
          'completed-transfer-changed',
          `${q.item} no longer rests at completed destination ${q.to}`,
          [q.item, q.to],
        );
      continue;
    }
    const bad = transferIssue(rt, { actor: ex.p.actor, ...q });
    if (bad) return bad;
  }
}
export const tidyTable: ActionDef<TidyTableParams, Binding, Exec> = {
  verb: 'tidy_table',
  description:
    'Move 2–4 existing loose small items from one grounded source table to explicit empty destination slots, retaining actual completed transfers through safe interruption.',
  schema: z.strictObject({
    actor: id,
    transfers: z.array(transferSchema).min(2).max(4),
  }),
  drivesReservedHands: false,
  reservations(w, p): Reservation[] {
    const owners = [
      ...new Set(
        p.transfers.flatMap((q) => [q.from.split('#')[0], q.to.split('#')[0]]),
      ),
    ];
    return [
      { resource: `tidy-task:${p.actor}`, mode: 'exclusive' },
      ...p.transfers.map((q) => ({
        resource: `entity:${q.item}`,
        mode: 'exclusive' as const,
      })),
      ...p.transfers
        .flatMap((q) => [q.from, q.to])
        .map((slot) => ({
          resource: `surface-slot:${slot}`,
          mode: 'exclusive' as const,
        })),
      ...owners
        .filter((owner) => w.entities[owner])
        .map((owner) => ({
          resource: `entity:${owner}`,
          mode: 'shared' as const,
        })),
    ];
  },
  plan(rt, p) {
    const ready = readyActor(rt, p.actor);
    if (ready) return { ok: false, diagnostic: ready };
    if (
      new Set(p.transfers.map((q) => q.item)).size !== p.transfers.length ||
      new Set(p.transfers.map((q) => q.from)).size !== p.transfers.length ||
      new Set(p.transfers.map((q) => q.to)).size !== p.transfers.length
    )
      return {
        ok: false,
        diagnostic: diagnostic(
          'duplicate-binding',
          `${p.actor}'s cleanup needs distinct items, sources and destinations`,
          [p.actor, ...p.transfers.map((q) => q.item)],
        ),
      };
    if (
      new Set(p.transfers.map((q) => q.from.split('#')[0])).size !== 1 ||
      new Set(p.transfers.map((q) => q.to.split('#')[0])).size !== 1
    )
      return {
        ok: false,
        diagnostic: diagnostic(
          'table-pair',
          `${p.actor} must declare one source fixture and one separate destination fixture`,
          [p.actor, ...p.transfers.flatMap((q) => [q.from, q.to])],
        ),
      };
    for (const q of p.transfers) {
      const bad = transferIssue(rt, { actor: p.actor, ...q });
      if (bad) return { ok: false, diagnostic: bad };
    }
    for (let i = 0; i < p.transfers.length; i++)
      for (let j = i + 1; j < p.transfers.length; j++) {
        const a = p.transfers[i],
          b = p.transfers[j],
          sa = surfaceSlot(rt.world, a.to),
          sb = surfaceSlot(rt.world, b.to);
        if ('code' in sa || 'code' in sb) continue;
        const table = rt.world.entities[sa.owner],
          ea: Entity = {
            ...rt.world.entities[a.item],
            pose: { p: sa.p, yaw: table.pose.yaw },
          },
          eb: Entity = {
            ...rt.world.entities[b.item],
            pose: { p: sb.p, yaw: table.pose.yaw },
          };
        if (obbOverlap(entityFootprint(ea).obb, entityFootprint(eb).obb, 0.002))
          return {
            ok: false,
            diagnostic: diagnostic(
              'destination-capacity',
              `${a.item} at ${a.to} overlaps ${b.item} at ${b.to}; declare distinct fitting item footprints`,
              [a.item, a.to, b.item, b.to],
            ),
          };
      }
    for (const verb of ['tidy_table_transfer', 'take_item', 'put_item'])
      if (!rt.registry.has(verb))
        return {
          ok: false,
          diagnostic: diagnostic(
            'missing-action',
            `${p.actor}'s cleanup requires registered ${verb}`,
            [p.actor, verb],
          ),
        };
    for (const claim of tidyTable.reservations(rt.world, p)) {
      const holders = rt.holder(claim.resource);
      if (claim.mode !== 'shared' && holders.length)
        return {
          ok: false,
          diagnostic: diagnostic(
            'resource-occupied',
            `${claim.resource} is held by ${holders.join(', ')}`,
            [claim.resource, ...holders],
          ),
        };
    }
    return { ok: true, program: binding(rt, p) };
  },
  start(rt, p, binding, id) {
    const ex: Exec = {
      id,
      p: structuredClone(p),
      binding,
      mode: 'tidying',
      index: 0,
      completed: [],
      children: [],
      finished: false,
      ending: false,
    };
    store(rt)[id] = ex;
    return ex;
  },
  onDirective(_rt, ex, by, claims, ancestors) {
    if (
      ex.ending ||
      !['tidying'].includes(ex.mode) ||
      ancestors.includes(ex.id) ||
      by.verb === 'tidy_table_control'
    )
      return;
    if (claims.some((c) => c.resource === `actor:${ex.p.actor}`))
      beginDrain(
        ex,
        false,
        diagnostic(
          'directed-away',
          `${by.id} (${by.verb}) takes precedence over cleanup ${ex.id}; explicit resume required`,
          [by.id, ex.p.actor, ex.id],
        ),
      );
  },
  step(rt, ex) {
    refresh(rt, ex);
    if (ex.mode === 'draining' || ex.mode === 'ending') return drain(rt, ex);
    if (ex.mode === 'paused' || ex.mode === 'waiting')
      return ex.error
        ? { status: 'blocked', diagnostic: ex.error }
        : { status: 'running', phase: 'paused' };
    if (ex.child) {
      if (rt.isActive(ex.child)) {
        const rec = rt.records.get(ex.child)!;
        return rec.status === 'blocked' && rec.diagnostic
          ? { status: 'blocked', diagnostic: rec.diagnostic }
          : { status: 'running', phase: rec.phase ?? 'transferring' };
      }
      const rec = rt.records.get(ex.child)!;
      ex.child = undefined;
      refresh(rt, ex);
      if (rec.status !== 'completed') {
        beginDrain(
          ex,
          false,
          rec.diagnostic ??
            diagnostic(
              'transfer-stopped',
              `${rec.id} stopped; completed placements remain`,
              [rec.id],
            ),
        );
        return drain(rt, ex);
      }
    }
    if (ex.index < 0) {
      ex.finished = true;
      beginDrain(ex, true);
      return drain(rt, ex);
    }
    const issue = remainingIssue(rt, ex);
    if (issue) {
      beginDrain(ex, false, issue);
      return drain(rt, ex);
    }
    const q = ex.p.transfers[ex.index],
      child = rt.submit(
        'tidy_table_transfer',
        { actor: ex.p.actor, ...q },
        { parent: ex.id, preempt: false },
      );
    ex.child = child.id;
    ex.children.push(child.id);
    if (child.status === 'failed') {
      beginDrain(ex, false, child.diagnostic);
      return drain(rt, ex);
    }
    return { status: 'running', phase: 'transferring' };
  },
  cancel(_rt, ex) {
    beginDrain(ex, true);
    return { ok: true, deferred: true };
  },
  resumable:
    'Completed transfers and same-Runtime explicit pause/resume are supported; active coordinator reload deferred.',
};
export const tidyTableControl: ActionDef<TidyTableControlParams, null, null> = {
  verb: 'tidy_table_control',
  description:
    'Pause, explicitly resume remaining same-item transfers, or end cleanup after supported safe release.',
  schema: z.strictObject({
    task: id,
    intent: z.enum(['pause', 'resume', 'end']),
  }),
  reservations: () => [],
  plan(rt, p) {
    const ex = (rt.services.tableCleanup as Record<string, Exec> | undefined)?.[
      p.task
    ];
    if (!ex || !rt.isActive(p.task) || ex.ending)
      return {
        ok: false,
        diagnostic: diagnostic(
          'inactive',
          `${p.task} cannot accept ${p.intent}`,
          [p.task],
        ),
      };
    if (p.intent === 'resume') {
      if (!['paused', 'waiting'].includes(ex.mode))
        return {
          ok: false,
          diagnostic: diagnostic(
            'not-paused',
            `${p.task} must finish safe item release before resume`,
            [p.task],
          ),
        };
      const issue = remainingIssue(rt, ex);
      if (issue) return { ok: false, diagnostic: issue };
    }
    return { ok: true, program: null };
  },
  start(rt, p) {
    const ex = store(rt)[p.task];
    if (p.intent === 'end') rt.cancel(ex.id);
    else if (p.intent === 'pause') beginDrain(ex);
    else {
      ex.mode = 'tidying';
      ex.error = undefined;
    }
    return null;
  },
  step: () => ({ status: 'completed' }),
  cancel: () => ({ ok: true }),
  resumable: true,
};
export function readTidyTable(rt: Runtime, task: string) {
  const ex = (rt.services.tableCleanup as Record<string, Exec> | undefined)?.[
      task
    ],
    rec = rt.records.get(task);
  if (!ex || !rec) return;
  const child = ex.child ? rt.records.get(ex.child) : undefined,
    unit = ex.child
      ? (
          rt.services.tableCleanupTransfers as
            | Record<string, PhysicalExec>
            | undefined
        )?.[ex.child]
      : undefined;
  return {
    task,
    actor: ex.p.actor,
    status: rec.status,
    mode: ex.mode,
    phase: ex.mode === 'completed' ? 'completed' : (rec.phase ?? ex.mode),
    bindings: structuredClone(ex.p),
    finished: ex.finished,
    completed: structuredClone(ex.completed),
    remaining: ex.p.transfers
      .filter((q) => !ex.completed.some((c) => c.item === q.item))
      .map((q) => ({ ...q })),
    child: ex.child,
    ownedActions: [...ex.children],
    current: unit
      ? {
          item: unit.p.item,
          from: unit.p.from,
          to: unit.p.to,
          phase: unit.phase,
          returnSlot: unit.returnSlot,
          held: rt.world.entities[unit.p.item]?.support?.kind === 'in-hand',
        }
      : undefined,
    items: ex.p.transfers.map((q) => ({
      item: q.item,
      def: rt.world.entities[q.item]?.def,
      support: structuredClone(rt.world.entities[q.item]?.support),
      contents: structuredClone(rt.world.entities[q.item]?.contents),
      atSource: atSlot(rt, q.item, q.from),
      atDestination: atSlot(rt, q.item, q.to),
    })),
    ...((child?.diagnostic ?? ex.error)
      ? {
          diagnostic: structuredClone(child?.diagnostic ?? ex.error),
          waitingReason: (child?.diagnostic ?? ex.error)?.message,
        }
      : {}),
  };
}
export type TidyTableReadout = NonNullable<ReturnType<typeof readTidyTable>>;
export const TABLE_CLEANUP_ACTIONS: ActionDef[] = [
  tidyTable,
  tidyTableControl,
  tidyTableTransfer,
];
