// A single bounded seated computer task. Equipment config stores unfinished work;
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
import { add2, angleDelta, dist2, rot2 } from '../core/math.ts';
import { CATALOG } from '../world/catalog.ts';
import type { Entity } from '../world/types.ts';
import { humanOf } from '../social/actions.ts';
import { isFree, slotById, type Slot } from '../social/slots.ts';
import { holdingDiagnostic } from '../construction/rules.ts';

export interface WorkAtParams {
  actor: string;
  station: string;
  seat: string;
  duration: number;
  task?: string;
  resume?: boolean;
}
export interface WorkstationReadout {
  id: string;
  available: boolean;
  status: 'idle' | 'active' | 'unfinished' | 'completed';
  task?: string;
  user?: string;
  elapsed: number;
  duration: number;
  progress: number;
  action?: string;
  seat?: string;
  phase?: 'arriving' | 'working' | 'stopping';
}
type Config = Record<string, string | number | boolean>;
type Program = {
  slot: Slot;
  stationPose: [number, number, number, number];
  elapsed: number;
};
type Exec = {
  id: string;
  p: WorkAtParams;
  program: Program;
  seatAction: string;
  elapsed: number;
  startedTick: number;
  stopping: boolean;
  error?: Diagnostic;
};
const planned = new WeakMap<WorkAtParams, Program>();
const diag = (
  code: string,
  message: string,
  subjects: string[],
): Diagnostic => ({ code: `workstation.${code}`, message, subjects });
const config = (e: Entity): Config =>
  e.equipment?.kind === 'workstation' ? e.equipment.config : {};
function stationOf(rt: Runtime, id: string): Entity | Diagnostic {
  const e = rt.world.entities[id];
  if (!e) return diag('unknown', `no workstation entity "${id}"`, [id]);
  if (e.kind !== 'fixture' || !CATALOG[e.def]?.capabilities?.workstation)
    return diag(
      'no-capability',
      `${id} (${e.def}, ${e.kind}) has no usable computer workstation capability`,
      [id],
    );
  if (
    Math.abs(e.pose.p[1]) > 0.01 ||
    Math.abs(e.pose.pitch ?? 0) > 0.01 ||
    Math.abs(e.pose.roll ?? 0) > 0.01 ||
    e.phase === 'carried' ||
    e.phase === 'raising'
  )
    return diag(
      'not-grounded',
      `${id} must be upright on the ground before seated computer work`,
      [id],
    );
  if (e.equipment && e.equipment.kind !== 'workstation')
    return diag(
      'state-kind',
      `${id} equipment state is ${e.equipment.kind}, not workstation`,
      [id],
    );
  return e;
}
/** Read-only; merely inspecting an unused station does not invent task state. */
export function readWorkstation(
  rt: Runtime,
  id: string,
): WorkstationReadout | Diagnostic {
  const e = stationOf(rt, id);
  if ('code' in e) return e;
  const c = config(e),
    elapsed = typeof c.workSeconds === 'number' ? c.workSeconds : 0,
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
    ...(typeof c.task === 'string' && c.task ? { task: c.task } : {}),
    ...(typeof c.user === 'string' && c.user ? { user: c.user } : {}),
    ...(typeof c.action === 'string' && c.action ? { action: c.action } : {}),
    ...(typeof c.seat === 'string' && c.seat ? { seat: c.seat } : {}),
    ...(c.phase === 'arriving' ||
    c.phase === 'working' ||
    c.phase === 'stopping'
      ? { phase: c.phase }
      : {}),
  };
}
function write(
  rt: Runtime,
  ex: Exec,
  phase: 'arriving' | 'working' | 'stopping',
  finished = false,
) {
  const e = rt.world.entities[ex.p.station];
  if (
    !e ||
    !CATALOG[e.def]?.capabilities?.workstation ||
    (e.equipment && e.equipment.kind !== 'workstation')
  )
    return;
  const c = config(e);
  e.equipment = {
    kind: 'workstation',
    config: {
      ...c,
      task: ex.p.task ?? 'computer-task',
      user: ex.p.actor,
      durationSeconds: ex.p.duration,
      workSeconds: ex.elapsed,
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
  const e = stationOf(rt, ex.p.station);
  if ('code' in e) return e;
  if (config(e).available === false)
    return diag('unavailable', `${e.id} became unavailable during ${ex.id}`, [
      e.id,
      ex.id,
    ]);
  const now = [...e.pose.p, e.pose.yaw];
  if (now.some((n, i) => Math.abs(n - ex.program.stationPose[i]) > 1e-6))
    return diag(
      'station-moved',
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
      `${ex.p.seat} moved during ${ex.id}; stop before continuing work`,
      [ex.p.seat, e.id],
    );
  return null;
}
export const workAt: ActionDef<WorkAtParams, Program, Exec> = {
  verb: 'work_at',
  description:
    'Sit at a compatible real chair and perform a bounded computer task; interrupted progress remains available for explicit same-user/task continuation.',
  schema: z.strictObject({
    actor: z.string().min(1).max(80),
    station: z.string().min(1).max(80),
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
      { resource: `workstation:${p.station}`, mode: 'exclusive' },
      { resource: `entity:${p.station}`, mode: 'exclusive' },
      ...(owner
        ? [{ resource: `entity:${owner}`, mode: 'exclusive' as const }]
        : []),
    ];
  },
  plan(rt, p) {
    const e = stationOf(rt, p.station);
    if ('code' in e) return { ok: false, diagnostic: e };
    const c = config(e);
    if (c.available === false)
      return {
        ok: false,
        diagnostic: diag('unavailable', `${p.station} is unavailable`, [
          p.station,
        ]),
      };
    const busyStation = rt.holder(`workstation:${p.station}`);
    if (busyStation.length)
      return {
        ok: false,
        diagnostic: diag(
          'busy',
          `${p.station} is reserved by ${busyStation.join(', ')}`,
          [p.station, ...busyStation],
        ),
      };
    const actor = humanOf(rt, p.actor);
    if ('code' in actor) return { ok: false, diagnostic: actor };
    const holding = holdingDiagnostic(rt.world, p.actor);
    if (holding) return { ok: false, diagnostic: holding };
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
          `${p.station} requires the registered sit action`,
          [p.station],
        ),
      };
    const links = rt.services.spatial?.base?.links as
      | { id: string; usable: boolean }[]
      | undefined;
    if (
      !rt.services.spatial ||
      actor.human!.level !== 0 ||
      Math.abs(e.pose.p[1]) > 0.01 ||
      links?.some((l) => l.usable)
    )
      return {
        ok: false,
        diagnostic: diag(
          'ground-only',
          `${p.actor} at ${p.station} requires ground spatial planning without usable access links`,
          [
            p.actor,
            p.station,
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
          `${p.seat} must be a real ground fixture seat for ${p.station}`,
          [p.seat, p.station],
        ),
      };
    const cap = CATALOG[e.def].capabilities!.workstation!;
    const wanted = add2(
      [e.pose.p[0], e.pose.p[2]],
      rot2(cap.seatPoint, e.pose.yaw),
    );
    const distance = dist2(slot.p, wanted);
    if (
      distance > cap.seatTolerance ||
      Math.abs(angleDelta(slot.yaw, e.pose.yaw + cap.facingYaw)) >
        cap.facingTolerance
    )
      return {
        ok: false,
        diagnostic: diag(
          'seat-incompatible',
          `${p.seat} is ${distance.toFixed(2)} m from ${p.station}'s chair point (${wanted.join(', ')}), allowed ${cap.seatTolerance} m, and must face the workstation`,
          [p.seat, p.station],
        ),
      };
    if (!isFree(rt.world, slot, new Set([p.actor])))
      return {
        ok: false,
        diagnostic: diag(
          'seat-occupied',
          `${p.seat} is claimed or occupied and cannot serve ${p.actor} at ${p.station}`,
          [p.seat, p.actor, p.station],
        ),
      };
    const task = p.task ?? 'computer-task';
    if (c.status === 'active')
      return {
        ok: false,
        diagnostic: diag(
          'active-state',
          `${p.station} has active task ${String(c.task)} for ${String(c.user)}; finish its owning action first`,
          [p.station],
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
            `${p.station} holds unfinished task ${String(c.task)} for ${String(c.user)} (${String(c.durationSeconds)} s); explicit resume with the same user/task/total duration is required`,
            [p.station, p.actor],
          ),
        };
    } else if (p.resume)
      return {
        ok: false,
        diagnostic: diag(
          'nothing-to-resume',
          `${p.station} has no unfinished task for ${p.actor}`,
          [p.station, p.actor],
        ),
      };
    const elapsed =
      p.resume && typeof c.workSeconds === 'number' ? c.workSeconds : 0;
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= p.duration)
      return {
        ok: false,
        diagnostic: diag(
          'invalid-progress',
          `${p.station} has invalid unfinished progress ${elapsed} for ${p.duration} s task`,
          [p.station],
        ),
      };
    const seatPlan = rt.registry
      .get('sit')!
      .plan(rt, { actor: p.actor, slot: p.seat });
    if (!seatPlan.ok) return seatPlan;
    const program: Program = {
      slot,
      stationPose: [...e.pose.p, e.pose.yaw],
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
              station: ex.p.station,
              task: ex.p.task ?? 'computer-task',
              workedSeconds: ex.elapsed,
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
            `${ex.p.actor} lost its seated hold ${seat.id} at ${ex.p.station}`,
            [ex.p.actor, ex.p.station, ex.p.seat],
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
          `${ex.p.actor} could not occupy ${ex.p.seat} at ${ex.p.station} within 120 s`,
          [ex.p.actor, ex.p.seat, ex.p.station],
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
    write(rt, ex, 'working');
    if (ex.elapsed >= ex.p.duration - 1e-9) {
      stopping(rt, ex);
      return { status: 'running', phase: 'stopping' };
    }
    return { status: 'running', phase: 'working' };
  },
  cancel(rt, ex) {
    stopping(rt, ex);
    return { ok: true, deferred: true };
  },
  yieldTo: (_rt, self) => [self.id],
  resumable:
    'workstation live snapshots await focused continuation proof; explicit unfinished-task continuation is supported after safe stop',
};
export const WORKSTATION_ACTIONS: ActionDef[] = [workAt];
