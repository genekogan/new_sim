import { z } from 'zod';
import type {
  ActionDef,
  Diagnostic,
  Reservation,
  StepResult,
} from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import { DT } from '../runtime/runtime.ts';
import { hashOf } from '../core/hash.ts';
import type { Vec3 } from '../core/math.ts';
import { REACH_TIME } from '../items/actions.ts';
import { bodyFrame, carryHand, lerp3, smooth } from '../items/body.ts';
import {
  BODY_REACH,
  followHand,
  heldBy,
  reachOf,
  reachStation,
  surfaceSlot,
} from '../items/model.ts';
import {
  DRAWING_TOTAL_TICKS,
  drawingConfig,
  drawingDiagnostic as diag,
  drawingIssue,
  drawingPoint,
} from '../objects/drawing.ts';
export interface DrawingWorkParams {
  actor: string;
  pad: string;
  pencil: string;
  returnSlot: string;
  task?: string;
  resume?: boolean;
}
type Program = { binding: string; drawTicks: number };
type Exec = Program & {
  id: string;
  p: DrawingWorkParams;
  phase: string;
  child?: string;
  ticks: number;
  from?: Vec3;
  stopping: boolean;
  error?: Diagnostic;
  started: number;
};
const REACH_TICKS = Math.round(REACH_TIME / DT);
const binding = (rt: Runtime, p: DrawingWorkParams) =>
  hashOf({
    pad: {
      pose: rt.world.entities[p.pad]?.pose,
      support: rt.world.entities[p.pad]?.support,
    },
    slot: surfaceSlot(rt.world, p.returnSlot),
  });
function write(rt: Runtime, ex: Exec, finished = false) {
  const pad = rt.world.entities[ex.p.pad];
  if (
    !pad ||
    pad.def !== 'drawing-pad' ||
    (pad.equipment && pad.equipment.kind !== 'drawing')
  )
    return;
  pad.equipment = {
    kind: 'drawing',
    config: {
      ...drawingConfig(pad),
      drawTicks: ex.drawTicks,
      pencil: ex.p.pencil,
      user: ex.p.actor,
      task: ex.p.task ?? 'shelter-study',
      status: finished
        ? ex.drawTicks === DRAWING_TOTAL_TICKS
          ? 'completed'
          : 'unfinished'
        : 'active',
      action: finished ? '' : ex.id,
      phase: finished ? '' : ex.phase,
    },
  };
}
function clearHand(rt: Runtime, ex: Exec) {
  const a = rt.world.entities[ex.p.actor];
  if (!a?.human) return;
  if (a.human.activity === 'reach') a.human.activity = 'idle';
  if (a.human.hands) delete a.human.hands.right;
}
function stop(rt: Runtime, ex: Exec, error?: Diagnostic) {
  ex.stopping = true;
  ex.error ??= error;
  if (ex.child && rt.isActive(ex.child)) rt.cancel(ex.child);
}
function dispatch(
  rt: Runtime,
  ex: Exec,
  verb: string,
  params: unknown,
  phase: string,
) {
  const r = rt.submit(verb, params, { parent: ex.id, preempt: false });
  ex.child = r.id;
  ex.phase = phase;
  return r;
}
function point(rt: Runtime, ex: Exec, p: Vec3) {
  const a = rt.world.entities[ex.p.actor],
    pencil = rt.world.entities[ex.p.pencil];
  a.human!.activity = 'reach';
  a.human!.hands = { ...a.human!.hands, right: p };
  followHand(pencil, p, a.pose.yaw);
}
function withdrawn(rt: Runtime, ex: Exec) {
  const a = rt.world.entities[ex.p.actor],
    pencil = rt.world.entities[ex.p.pencil];
  if (pencil?.support?.kind !== 'in-hand' || pencil.support.by !== ex.p.actor) {
    clearHand(rt, ex);
    return true;
  }
  ex.from ??= a.human!.hands?.right ?? carryHand(bodyFrame(a), 'right');
  ex.ticks++;
  point(
    rt,
    ex,
    lerp3(
      ex.from,
      carryHand(bodyFrame(a), 'right'),
      smooth(ex.ticks / REACH_TICKS),
    ),
  );
  if (ex.ticks < REACH_TICKS) return false;
  clearHand(rt, ex);
  return true;
}
function finish(rt: Runtime, ex: Exec): StepResult {
  const pencil = rt.world.entities[ex.p.pencil];
  if (pencil?.support?.kind === 'in-hand' && pencil.support.by === ex.p.actor) {
    const plan = rt.registry
      .get('put_item')!
      .plan(rt, {
        actor: ex.p.actor,
        item: ex.p.pencil,
        surfaceSlot: ex.p.returnSlot,
      });
    if (!plan.ok) return { status: 'blocked', diagnostic: plan.diagnostic };
    const r = dispatch(
      rt,
      ex,
      'put_item',
      { actor: ex.p.actor, item: ex.p.pencil, surfaceSlot: ex.p.returnSlot },
      'putting',
    );
    if (r.status === 'failed') {
      ex.child = undefined;
      ex.phase = 'returning';
      return { status: 'blocked', diagnostic: r.diagnostic! };
    }
    return { status: 'running', phase: 'putting' };
  }
  if (
    pencil?.support?.kind !== 'resting-on' ||
    `${pencil.support.on}#${pencil.support.slot}` !== ex.p.returnSlot
  )
    return {
      status: 'blocked',
      diagnostic: diag(
        'return-support',
        `${ex.p.pencil} must be supported at ${ex.p.returnSlot} before releasing drawing`,
        [ex.p.pencil, ex.p.returnSlot],
      ),
    };
  clearHand(rt, ex);
  write(rt, ex, true);
  return ex.error
    ? { status: 'failed', diagnostic: ex.error }
    : {
        status: 'completed',
        outputs: {
          pad: ex.p.pad,
          pencil: ex.p.pencil,
          drawTicks: ex.drawTicks,
          finished: ex.drawTicks === DRAWING_TOTAL_TICKS,
        },
      };
}
const id = z.string().min(1).max(80);
export const drawingWork: ActionDef<DrawingWorkParams, Program, Exec> = {
  verb: 'drawing_work',
  description:
    'Make a bounded shelter study using the same physical pencil and supported pad, retaining committed marks and partial stroke progress through explicit continuation.',
  schema: z.strictObject({
    actor: id,
    pad: id,
    pencil: id,
    returnSlot: id,
    task: id.optional(),
    resume: z.boolean().optional(),
  }),
  drivesReservedHands: (rec) =>
    ['reaching', 'drawing', 'withdrawing'].includes(rec.phase ?? ''),
  reservations(_w, p) {
    return [
      `actor:${p.actor}`,
      `hand:${p.actor}:right`,
      `entity:${p.pad}`,
      `entity:${p.pencil}`,
      `entity:${p.returnSlot.split('#')[0]}`,
      `surface:${p.returnSlot}`,
    ].map((resource) => ({ resource, mode: 'exclusive' }) as Reservation);
  },
  yieldTo: (_rt, self) => [self.id],
  plan(rt, p) {
    const fail = (code: string, message: string, subjects: string[]) => ({
      ok: false as const,
      diagnostic: diag(code, message, subjects),
    });
    const issue = drawingIssue(rt, p.pad);
    if (issue) return { ok: false, diagnostic: issue };
    const pad = rt.world.entities[p.pad],
      a = rt.world.entities[p.actor],
      pencil = rt.world.entities[p.pencil],
      c = drawingConfig(pad);
    if (
      !a?.human ||
      a.human.level !== 0 ||
      a.human.activity !== 'idle' ||
      a.human.grip
    )
      return fail(
        'actor',
        `${p.actor} must stand idle on ground for ${p.pad}`,
        [p.actor, p.pad],
      );
    if (
      heldBy(rt.world, p.actor).some(
        (q) => q.item.id !== p.pencil || q.hand !== 'right',
      )
    )
      return fail(
        'hands-occupied',
        `${p.actor} needs free hands or only ${p.pencil} in the right hand`,
        [p.actor, ...heldBy(rt.world, p.actor).map((q) => q.item.id)],
      );
    if (
      !pencil ||
      pencil.def !== 'drawing-pencil' ||
      pencil.kind !== 'component'
    )
      return fail(
        'missing-pencil',
        `${p.pencil} must be an existing drawing-pencil`,
        [p.pencil],
      );
    const slot = surfaceSlot(rt.world, p.returnSlot);
    if ('code' in slot) return { ok: false, diagnostic: slot };
    if (
      pad.support?.kind !== 'resting-on' ||
      slot.owner !== pad.support.on ||
      slot.slot === pad.support.slot
    )
      return fail(
        'return-scope',
        `${p.pencil} must return to a separate slot on ${pad.support?.kind === 'resting-on' ? pad.support.on : p.pad}`,
        [p.pencil, p.returnSlot, p.pad],
      );
    const occ = Object.values(rt.world.entities).find(
      (q) =>
        q.id !== p.pencil &&
        q.support?.kind === 'resting-on' &&
        q.support.on === slot.owner &&
        q.support.slot === slot.slot,
    );
    if (occ)
      return fail('return-occupied', `${occ.id} occupies ${p.returnSlot}`, [
        occ.id,
        p.returnSlot,
      ]);
    if (
      !(
        pencil.support?.kind === 'resting-on' &&
        `${pencil.support.on}#${pencil.support.slot}` === p.returnSlot &&
        hashOf(pencil.pose.p) === hashOf(slot.p)
      ) &&
      !(
        pencil.support?.kind === 'in-hand' &&
        pencil.support.by === p.actor &&
        pencil.support.hand === 'right'
      )
    )
      return fail(
        'pencil-support',
        `${p.pencil} must rest at ${p.returnSlot} or be held by ${p.actor}'s right hand`,
        [p.pencil, p.actor, p.returnSlot],
      );
    if (
      !rt.services.spatial ||
      rt.services.spatial.base.links.some((l: { usable: boolean }) => l.usable)
    )
      return fail('scope', `${p.pad} requires a ground-only authored scene`, [
        p.pad,
      ]);
    const station = reachStation(
      rt,
      a,
      pad.pose.p,
      rt.world.entities[slot.owner],
      p.pad,
    );
    if ('code' in station) return { ok: false, diagnostic: station };
    for (const verb of ['take_item', 'put_item', 'walk_to'])
      if (!rt.registry.has(verb))
        return fail('missing-action', `${p.pad} requires registered ${verb}`, [
          p.pad,
          verb,
        ]);
    for (const q of drawingWork.reservations(rt.world, p))
      if (rt.holder(q.resource).length)
        return fail(
          'occupied',
          `${q.resource} is held by ${rt.holder(q.resource).join(', ')}`,
          [q.resource, ...rt.holder(q.resource)],
        );
    if (c.status === 'active')
      return fail('active-state', `${p.pad} has an active drawing task`, [
        p.pad,
      ]);
    if (c.status === 'completed')
      return fail(
        'completed-pad',
        `${p.pad} already holds a completed study; drawing cannot erase it`,
        [p.pad],
      );
    if (
      c.status === 'unfinished' &&
      (!p.resume ||
        c.user !== p.actor ||
        c.task !== (p.task ?? 'shelter-study') ||
        c.pencil !== p.pencil)
    )
      return fail(
        'unfinished-task',
        `${p.pad} requires explicit same-user/task/pencil continuation`,
        [p.pad, p.actor, p.pencil],
      );
    if (p.resume && c.status !== 'unfinished')
      return fail('nothing-to-resume', `${p.pad} has no unfinished study`, [
        p.pad,
      ]);
    const drawTicks =
      p.resume && typeof c.drawTicks === 'number' ? c.drawTicks : 0;
    if (
      !Number.isInteger(drawTicks) ||
      drawTicks < 0 ||
      drawTicks > DRAWING_TOTAL_TICKS
    )
      return fail(
        'invalid-progress',
        `${p.pad} has invalid progress ${drawTicks}`,
        [p.pad],
      );
    return { ok: true, program: { binding: binding(rt, p), drawTicks } };
  },
  start: (rt, p, program, id) => ({
    ...program,
    id,
    p,
    phase: 'starting',
    ticks: 0,
    stopping: false,
    started: rt.tick,
  }),
  step(rt, ex) {
    if (!ex.stopping && ex.phase !== 'putting' && ex.phase !== 'returning') {
      const issue = drawingIssue(rt, ex.p.pad);
      if (issue) stop(rt, ex, issue);
      else if (binding(rt, ex.p) !== ex.binding)
        stop(
          rt,
          ex,
          diag(
            'support-changed',
            `${ex.p.pad} or ${ex.p.returnSlot} moved during drawing`,
            [ex.p.pad, ex.p.returnSlot],
          ),
        );
      else if (rt.tick - ex.started > 2400)
        stop(
          rt,
          ex,
          diag('timeout', `${ex.p.actor}'s drawing exceeded 120 seconds`, [
            ex.p.actor,
            ex.p.pad,
          ]),
        );
    }
    if (ex.child) {
      if (rt.isActive(ex.child)) {
        write(rt, ex);
        return {
          status: 'running',
          phase: ex.stopping ? 'stopping' : ex.phase,
        };
      }
      const child = rt.records.get(ex.child)!;
      ex.child = undefined;
      if (child.status !== 'completed' && !ex.stopping)
        stop(
          rt,
          ex,
          child.diagnostic ??
            diag(
              'child',
              `${child.verb} stopped before drawing could continue`,
              [child.id],
            ),
        );
      if (ex.phase === 'taking' && !ex.stopping) ex.phase = 'approaching';
      else if (ex.phase === 'walking' && !ex.stopping) {
        ex.phase = 'reaching';
        ex.ticks = 0;
        ex.from = carryHand(bodyFrame(rt.world.entities[ex.p.actor]), 'right');
      } else if (ex.phase === 'putting') ex.phase = 'returning';
    }
    if (ex.stopping && ex.phase !== 'withdrawing' && ex.phase !== 'returning') {
      ex.phase = 'withdrawing';
      ex.ticks = 0;
      ex.from = undefined;
    }
    if (ex.phase === 'withdrawing') {
      if (!withdrawn(rt, ex)) {
        write(rt, ex);
        return { status: 'running', phase: ex.phase };
      }
      ex.phase = 'returning';
    }
    if (ex.phase === 'returning') {
      write(rt, ex);
      return finish(rt, ex);
    }
    if (ex.phase === 'starting') {
      if (rt.world.entities[ex.p.pencil].support?.kind !== 'in-hand')
        dispatch(
          rt,
          ex,
          'take_item',
          { actor: ex.p.actor, item: ex.p.pencil, hand: 'right' },
          'taking',
        );
      else ex.phase = 'approaching';
    } else if (ex.phase === 'approaching') {
      const pad = rt.world.entities[ex.p.pad];
      const st = reachStation(
        rt,
        rt.world.entities[ex.p.actor],
        pad.pose.p,
        rt.world.entities[ex.p.returnSlot.split('#')[0]],
        ex.p.pad,
      );
      if ('code' in st) stop(rt, ex, st);
      else
        dispatch(
          rt,
          ex,
          'walk_to',
          { actor: ex.p.actor, x: st.p[0], z: st.p[1], face: st.yaw },
          'walking',
        );
    } else {
      const a = rt.world.entities[ex.p.actor],
        pencil = rt.world.entities[ex.p.pencil],
        pad = rt.world.entities[ex.p.pad],
        target = drawingPoint(pad, ex.drawTicks);
      if (
        pencil?.support?.kind !== 'in-hand' ||
        pencil.support.by !== ex.p.actor ||
        pencil.support.hand !== 'right' ||
        reachOf(a, target) > BODY_REACH
      ) {
        stop(
          rt,
          ex,
          diag(
            'reach-lost',
            `${ex.p.actor} must hold ${ex.p.pencil} within reach of ${ex.p.pad}`,
            [ex.p.actor, ex.p.pencil, ex.p.pad],
          ),
        );
      } else if (ex.phase === 'reaching') {
        ex.ticks++;
        point(rt, ex, lerp3(ex.from!, target, smooth(ex.ticks / REACH_TICKS)));
        if (ex.ticks >= REACH_TICKS) ex.phase = 'drawing';
      } else if (ex.phase === 'drawing') {
        ex.drawTicks = Math.min(DRAWING_TOTAL_TICKS, ex.drawTicks + 1);
        point(rt, ex, drawingPoint(pad, ex.drawTicks));
        if (ex.drawTicks === DRAWING_TOTAL_TICKS) {
          ex.phase = 'withdrawing';
          ex.ticks = 0;
          ex.from = undefined;
        }
      }
    }
    write(rt, ex);
    return { status: 'running', phase: ex.phase };
  },
  cancel(rt, ex) {
    stop(rt, ex);
    return { ok: true, deferred: true };
  },
  resumable:
    'Explicit same-pad/pencil/user/task continuation after ordinary release; active coordinator reload is deferred.',
};
export const DRAWING_ACTIONS: ActionDef[] = [drawingWork];
