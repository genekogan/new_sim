// Bounded seated reading of a supported book. Equipment config retains the bookmark;
// the Runtime's physical seat action remains the only controller of the actor.
import { z } from 'zod';
import type {
  ActionDef,
  Diagnostic,
  Reservation,
  StepResult,
} from '../actions/types.ts';
import { TERMINAL } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import { angleDelta, dist2, heading, sub2 } from '../core/math.ts';
import { CATALOG } from '../world/catalog.ts';
import type { Entity } from '../world/types.ts';
import { humanOf } from '../social/actions.ts';
import { isFree, slotById, type Slot } from '../social/slots.ts';
import { holdingDiagnostic } from '../construction/rules.ts';
import { heldBy, surfaceSlot } from '../items/model.ts';

export interface ReadBookParams {
  actor: string;
  book: string;
  seat: string;
  duration: number;
  task?: string;
  resume?: boolean;
}
export interface ReadingReadout {
  id: string;
  available: boolean;
  status: 'idle' | 'active' | 'unfinished' | 'completed';
  task?: string;
  user?: string;
  elapsed: number;
  duration: number;
  progress: number;
  page: number;
  pages: number;
  action?: string;
  seat?: string;
  phase?: 'arriving' | 'reading' | 'stopping';
}
type Config = Record<string, string | number | boolean>;
type Program = {
  slot: Slot;
  bookPose: [number, number, number, number];
  table: string;
  supportSlot: string;
  elapsed: number;
};
type Exec = {
  id: string;
  p: ReadBookParams;
  program: Program;
  seatAction: string;
  elapsed: number;
  startedTick: number;
  stopping: boolean;
  error?: Diagnostic;
};
const planned = new WeakMap<ReadBookParams, Program>();
const diag = (
  code: string,
  message: string,
  subjects: string[],
): Diagnostic => ({ code: `reading.${code}`, message, subjects });
const config = (e: Entity): Config =>
  e.equipment?.kind === 'reading' ? e.equipment.config : {};
function bookOf(rt: Runtime, id: string): Entity | Diagnostic {
  const e = rt.world.entities[id];
  if (!e) return diag('unknown', `no book entity "${id}"`, [id]);
  if (e.kind !== 'component' || !CATALOG[e.def]?.capabilities?.readable)
    return diag(
      'no-capability',
      `${id} (${e.def}) has no readable capability`,
      [id],
    );
  if (e.equipment && e.equipment.kind !== 'reading')
    return diag(
      'state-kind',
      `${id} has incompatible ${e.equipment.kind} state`,
      [id],
    );
  if (e.support?.kind !== 'resting-on' || !e.support.slot)
    return diag(
      'support-required',
      `${id} must rest in a real table surface slot; held or ground books are not supported by this reading interaction`,
      [id],
    );
  const table = rt.world.entities[e.support.on];
  const slot = surfaceSlot(rt.world, `${e.support.on}#${e.support.slot}`);
  if ('code' in slot) return slot;
  if (
    !table ||
    table.kind !== 'fixture' ||
    Math.abs(table.pose.p[1]) > 0.01 ||
    Math.abs(table.pose.pitch ?? 0) > 0.01 ||
    Math.abs(table.pose.roll ?? 0) > 0.01 ||
    table.phase === 'carried' ||
    table.phase === 'raising' ||
    Math.abs(e.pose.pitch ?? 0) > 0.01 ||
    Math.abs(e.pose.roll ?? 0) > 0.01 ||
    e.pose.p.some((v, i) => Math.abs(v - slot.p[i]) > 1e-6)
  )
    return diag(
      'invalid-support',
      `${id} must remain flat at its valid grounded table slot`,
      [id, e.support.on],
    );
  return e;
}
/** Read-only; merely inspecting an unused book does not invent task state. */
export function readBook(rt: Runtime, id: string): ReadingReadout | Diagnostic {
  const e = bookOf(rt, id);
  if ('code' in e) return e;
  const c = config(e),
    elapsed = typeof c.readSeconds === 'number' ? c.readSeconds : 0,
    duration = typeof c.durationSeconds === 'number' ? c.durationSeconds : 0;
  return {
    id,
    available: c.available !== false,
    status:
      c.status === 'active' ||
      c.status === 'unfinished' ||
      c.status === 'completed'
        ? c.status
        : 'idle',
    elapsed,
    duration,
    progress: duration > 0 ? Math.min(1, elapsed / duration) : 0,
    pages: CATALOG[e.def].capabilities!.readable!.pages,
    page: Math.min(
      CATALOG[e.def].capabilities!.readable!.pages,
      1 +
        Math.floor(
          (duration > 0 ? elapsed / duration : 0) *
            CATALOG[e.def].capabilities!.readable!.pages,
        ),
    ),
    ...(typeof c.task === 'string' && c.task ? { task: c.task } : {}),
    ...(typeof c.user === 'string' && c.user ? { user: c.user } : {}),
    ...(typeof c.action === 'string' && c.action ? { action: c.action } : {}),
    ...(typeof c.seat === 'string' && c.seat ? { seat: c.seat } : {}),
    ...(c.phase === 'arriving' ||
    c.phase === 'reading' ||
    c.phase === 'stopping'
      ? { phase: c.phase }
      : {}),
  };
}
function write(
  rt: Runtime,
  ex: Exec,
  phase: 'arriving' | 'reading' | 'stopping',
  finished = false,
) {
  const e = rt.world.entities[ex.p.book];
  if (
    !e ||
    !CATALOG[e.def]?.capabilities?.readable ||
    (e.equipment && e.equipment.kind !== 'reading')
  )
    return;
  const c = config(e);
  e.equipment = {
    kind: 'reading',
    config: {
      ...c,
      task: ex.p.task ?? 'reading-task',
      user: ex.p.actor,
      durationSeconds: ex.p.duration,
      readSeconds: ex.elapsed,
      status: finished
        ? ex.elapsed >= ex.p.duration - 1e-9
          ? 'completed'
          : 'unfinished'
        : 'active',
      action: finished ? '' : ex.id,
      seat: ex.p.seat,
      phase: finished ? '' : phase,
    },
  };
}
function stopping(rt: Runtime, ex: Exec, error?: Diagnostic) {
  ex.stopping = true;
  ex.error ??= error;
  if (rt.isActive(ex.seatAction)) rt.cancel(ex.seatAction);
}
function bindingDiagnostic(rt: Runtime, ex: Exec): Diagnostic | null {
  const e = bookOf(rt, ex.p.book);
  if ('code' in e) return e;
  if (config(e).available === false)
    return diag('unavailable', `${e.id} became unavailable during ${ex.id}`, [
      e.id,
      ex.id,
    ]);
  if (
    e.support?.kind !== 'resting-on' ||
    e.support.on !== ex.program.table ||
    e.support.slot !== ex.program.supportSlot
  )
    return diag('support-changed', `${e.id} changed support during ${ex.id}`, [
      e.id,
      ex.program.table,
    ]);
  const now = [...e.pose.p, e.pose.yaw];
  if (now.some((n, i) => Math.abs(n - ex.program.bookPose[i]) > 1e-6))
    return diag(
      'book-moved',
      `${e.id} moved during ${ex.id}; stop and explicitly rebind its compatible chair`,
      [e.id, ex.p.seat],
    );
  const seat = slotById(rt, ex.p.seat);
  if ('code' in seat) return seat;
  if (
    dist2(seat.p, ex.program.slot.p) > 1e-6 ||
    Math.abs(angleDelta(seat.yaw, ex.program.slot.yaw)) > 1e-6
  )
    return diag(
      'seat-moved',
      `${ex.p.seat} moved during ${ex.id}; stop before continuing reading`,
      [ex.p.seat, e.id],
    );
  return null;
}
export const readBookAction: ActionDef<ReadBookParams, Program, Exec> = {
  verb: 'read_book',
  description:
    'Sit at a usable table and read a supported book; its bookmark survives safe interruption for explicit same-reader/task continuation.',
  schema: z.strictObject({
    actor: z.string().min(1).max(80),
    book: z.string().min(1).max(80),
    seat: z.string().min(1).max(80),
    duration: z.number().positive().max(3600),
    task: z.string().min(1).max(80).optional(),
    resume: z.boolean().optional(),
  }),
  reservations(_world, p): Reservation[] {
    const owner = planned.get(p)?.slot.owner;
    return [
      { resource: `actor:${p.actor}`, mode: 'exclusive' },
      { resource: `slot:${p.seat}`, mode: 'exclusive' },
      { resource: `reading:${p.book}`, mode: 'exclusive' },
      ...(planned.get(p)?.table
        ? [
            {
              resource: `entity:${planned.get(p)!.table}`,
              mode: 'shared' as const,
            },
          ]
        : []),
      { resource: `entity:${p.book}`, mode: 'exclusive' },
      ...(owner
        ? [{ resource: `entity:${owner}`, mode: 'exclusive' as const }]
        : []),
    ];
  },
  plan(rt, p) {
    const e = bookOf(rt, p.book);
    if ('code' in e) return { ok: false, diagnostic: e };
    const c = config(e);
    if (c.available === false)
      return {
        ok: false,
        diagnostic: diag('unavailable', `${p.book} is unavailable`, [p.book]),
      };
    const busyStation = rt.holder(`reading:${p.book}`);
    if (busyStation.length)
      return {
        ok: false,
        diagnostic: diag(
          'busy',
          `${p.book} is reserved by ${busyStation.join(', ')}`,
          [p.book, ...busyStation],
        ),
      };
    const actor = humanOf(rt, p.actor);
    if ('code' in actor) return { ok: false, diagnostic: actor };
    const holding = holdingDiagnostic(rt.world, p.actor);
    if (holding) return { ok: false, diagnostic: holding };
    const items = heldBy(rt.world, p.actor).map(({ item }) => item.id);
    if (items.length)
      return {
        ok: false,
        diagnostic: diag(
          'hands-occupied',
          `${p.actor} must explicitly put down ${items.join(', ')} before reading`,
          [p.actor, ...items],
        ),
      };
    const held = rt.holder(`actor:${p.actor}`);
    if (held.length)
      return {
        ok: false,
        diagnostic: diag(
          'actor-busy',
          `${p.actor} is already held by ${held.join(', ')}`,
          [p.actor, ...held],
        ),
      };
    if (!rt.registry.has('sit'))
      return {
        ok: false,
        diagnostic: diag(
          'sit-missing',
          `${p.book} requires the registered sit action`,
          [p.book],
        ),
      };
    const links = rt.services.spatial?.base?.links as
      | { id: string; usable: boolean }[]
      | undefined;
    if (
      !rt.services.spatial ||
      actor.human!.level !== 0 ||
      links?.some((l) => l.usable)
    )
      return {
        ok: false,
        diagnostic: diag(
          'ground-only',
          `${p.actor} at ${p.book} requires ground spatial planning without usable access links`,
          [
            p.actor,
            p.book,
            ...(links?.filter((l) => l.usable).map((l) => l.id) ?? []),
          ],
        ),
      };
    const slot = slotById(rt, p.seat);
    if ('code' in slot) return { ok: false, diagnostic: slot };
    if (
      slot.kind !== 'seat' ||
      slot.level !== 0 ||
      !rt.world.entities[slot.owner]
    )
      return {
        ok: false,
        diagnostic: diag(
          'fixture-seat-required',
          `${p.seat} must be a real ground fixture seat for ${p.book}`,
          [p.seat, p.book],
        ),
      };
    const target: [number, number] = [e.pose.p[0], e.pose.p[2]];
    const distance = dist2(slot.p, target);
    const cap = CATALOG[e.def].capabilities!.readable!;
    if (
      distance < 0.35 ||
      distance > cap.maxSeatDistance ||
      Math.abs(angleDelta(slot.yaw, heading(sub2(target, slot.p)))) > 0.35
    )
      return {
        ok: false,
        diagnostic: diag(
          'seat-incompatible',
          `${p.seat} must face ${p.book} within ${cap.maxSeatDistance} m (actual ${distance.toFixed(2)} m); arrange a usable chair and table first`,
          [p.seat, p.book],
        ),
      };
    if (!isFree(rt.world, slot, new Set([p.actor])))
      return {
        ok: false,
        diagnostic: diag(
          'seat-occupied',
          `${p.seat} is claimed or occupied and cannot serve ${p.actor} at ${p.book}`,
          [p.seat, p.actor, p.book],
        ),
      };
    const task = p.task ?? 'reading-task';
    if (c.status === 'active')
      return {
        ok: false,
        diagnostic: diag(
          'active-state',
          `${p.book} has active task ${String(c.task)} for ${String(c.user)}; finish its owning action first`,
          [p.book],
        ),
      };
    if (c.status === 'unfinished') {
      if (
        !p.resume ||
        c.user !== p.actor ||
        c.task !== task ||
        c.durationSeconds !== p.duration
      )
        return {
          ok: false,
          diagnostic: diag(
            'unfinished-task',
            `${p.book} holds unfinished task ${String(c.task)} for ${String(c.user)} (${String(c.durationSeconds)} s); explicit resume with the same user/task/total duration is required`,
            [p.book, p.actor],
          ),
        };
    } else if (p.resume)
      return {
        ok: false,
        diagnostic: diag(
          'nothing-to-resume',
          `${p.book} has no unfinished task for ${p.actor}`,
          [p.book, p.actor],
        ),
      };
    const elapsed =
      p.resume && typeof c.readSeconds === 'number' ? c.readSeconds : 0;
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= p.duration)
      return {
        ok: false,
        diagnostic: diag(
          'invalid-progress',
          `${p.book} has invalid unfinished progress ${elapsed} for ${p.duration} s task`,
          [p.book],
        ),
      };
    const seatPlan = rt.registry
      .get('sit')!
      .plan(rt, { actor: p.actor, slot: p.seat });
    if (!seatPlan.ok) return seatPlan;
    const program: Program = {
      slot,
      bookPose: [...e.pose.p, e.pose.yaw],
      table: e.support!.kind === 'resting-on' ? e.support!.on : '',
      supportSlot: e.support!.kind === 'resting-on' ? e.support!.slot! : '',
      elapsed,
    };
    planned.set(p, program);
    return { ok: true, program };
  },
  start(rt, p, program, id) {
    const seat = rt.submit(
      'sit',
      { actor: p.actor, slot: p.seat },
      { parent: id, preempt: false },
    );
    return {
      id,
      p,
      program,
      seatAction: seat.id,
      elapsed: program.elapsed,
      startedTick: rt.tick,
      stopping: false,
    };
  },
  step(rt, ex, dt): StepResult {
    if (!ex.stopping) {
      const bad = bindingDiagnostic(rt, ex);
      if (bad) stopping(rt, ex, bad);
    }
    const seat = rt.records.get(ex.seatAction)!;
    if (ex.stopping) {
      write(rt, ex, 'stopping');
      if (rt.isActive(ex.seatAction))
        return { status: 'running', phase: 'stopping' };
      write(rt, ex, 'stopping', true);
      return ex.error
        ? { status: 'failed', diagnostic: ex.error }
        : {
            status: 'completed',
            outputs: {
              book: ex.p.book,
              task: ex.p.task ?? 'reading-task',
              readSeconds: ex.elapsed,
              finished: ex.elapsed >= ex.p.duration - 1e-9,
            },
          };
    }
    if (TERMINAL.has(seat.status)) {
      stopping(
        rt,
        ex,
        seat.diagnostic ??
          diag(
            'seat-released',
            `${ex.p.actor} lost its seated hold ${seat.id} at ${ex.p.book}`,
            [ex.p.actor, ex.p.book, ex.p.seat],
          ),
      );
      write(rt, ex, 'stopping');
      return { status: 'running', phase: 'stopping' };
    }
    if (seat.phase !== 'occupied' && rt.tick - ex.startedTick > 120 * 20) {
      stopping(
        rt,
        ex,
        diag(
          'arrival-timeout',
          `${ex.p.actor} could not occupy ${ex.p.seat} at ${ex.p.book} within 120 s`,
          [ex.p.actor, ex.p.seat, ex.p.book],
        ),
      );
      write(rt, ex, 'stopping');
      return { status: 'running', phase: 'stopping' };
    }
    if (seat.phase !== 'occupied') {
      write(rt, ex, 'arriving');
      return { status: 'running', phase: 'arriving' };
    }
    ex.elapsed =
      ex.elapsed + dt >= ex.p.duration - 1e-9 ? ex.p.duration : ex.elapsed + dt;
    write(rt, ex, 'reading');
    if (ex.elapsed >= ex.p.duration - 1e-9) {
      stopping(rt, ex);
      return { status: 'running', phase: 'stopping' };
    }
    return { status: 'running', phase: 'reading' };
  },
  cancel(rt, ex) {
    stopping(rt, ex);
    return { ok: true, deferred: true };
  },
  yieldTo: (_rt, self) => [self.id],
  resumable:
    'reading live snapshots await focused continuation proof; explicit unfinished-task continuation is supported after safe stop',
};
export const READING_ACTIONS: ActionDef[] = [readBookAction];
