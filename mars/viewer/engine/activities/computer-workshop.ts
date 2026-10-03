// Future hypothetical bridge. Registered classroom/work/walk children own all physical state.
import { z } from 'zod';
import type {
  ActionDef,
  ActionRecord,
  Diagnostic,
  StepResult,
} from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import { hashOf } from '../core/hash.ts';
import { heldBy } from '../items/model.ts';
import {
  workAt,
  readWorkstation,
  type WorkAtParams,
} from '../objects/workstation.ts';
import { classroomSession, readClassroom } from './classroom.ts';
import type { ClassroomParams, ClassroomReadout } from './types.ts';
export interface ComputerWorkshopParams {
  facilitator: string;
  learners: [WorkAtParams, WorkAtParams];
  demonstration: ClassroomParams;
  review: ClassroomParams;
}
export interface ComputerWorkshopControlParams {
  workshop: string;
  intent:
    | 'pause'
    | 'resume'
    | 'end'
    | 'pause-learner'
    | 'resume-learner'
    | 'leave'
    | 'join'
    | 'question'
    | 'advance';
  actor?: string;
}
type Stage = 'demonstration' | 'practice' | 'review';
type Mode =
  | 'running'
  | 'pausing'
  | 'paused'
  | 'waiting'
  | 'ending'
  | 'completed'
  | 'ended';
type Learner = {
  actor: string;
  paused: boolean;
  elapsed: number;
  completed: boolean;
  child?: string;
  actions: string[];
  receipt?: {
    action: string;
    station: string;
    seat: string;
    task: string;
    duration: number;
    elapsed: number;
    completed: boolean;
  };
  diagnostic?: Diagnostic;
};
type Exec = {
  id: string;
  p: ComputerWorkshopParams;
  stage: Stage;
  mode: Mode;
  binding: string;
  members: { actor: string; present: boolean; reason?: string }[];
  learners: Learner[];
  session?: string;
  demo?: string;
  review?: string;
  history: {
    stage: 'demonstration' | 'review';
    session: string;
    readout: ClassroomReadout;
    status: string;
  }[];
  children: string[];
  resources: string[];
  departures: Record<string, string>;
  finished: boolean;
  diagnostic?: Diagnostic;
};
const store = (rt: Runtime): Record<string, Exec> =>
  (rt.services.computerWorkshops ??= {});
const find = (rt: Runtime, id: string) =>
  (rt.services.computerWorkshops as Record<string, Exec> | undefined)?.[id];
const issue = (
  code: string,
  message: string,
  subjects: string[],
): Diagnostic => ({ code: `computer_workshop.${code}`, message, subjects });
const id = z.string().min(1).max(80);
const params = z.strictObject({
  facilitator: id,
  learners: z.tuple([workAt.schema, workAt.schema]),
  demonstration: classroomSession.schema,
  review: classroomSession.schema,
});
const allActors = (p: ComputerWorkshopParams) => [
  p.facilitator,
  ...p.learners.map((l) => l.actor),
];
function structure(p: ComputerWorkshopParams): Diagnostic | undefined {
  const people = allActors(p);
  if (
    new Set(people).size !== 3 ||
    new Set(p.learners.map((l) => l.station)).size !== 2 ||
    new Set(p.learners.map((l) => l.seat)).size !== 2 ||
    new Set(p.learners.map((l) => l.task)).size !== 2 ||
    p.learners.some((l) => !l.task || l.resume || l.duration > 60)
  )
    return issue(
      'roles',
      'Workshop requires a distinct facilitator/two learners, two distinct computers/chairs and two named bounded tasks (no initial resume)',
      people,
    );
  for (const s of [p.demonstration, p.review]) {
    const actors = [s.host, ...s.presenters, ...s.audience];
    if (
      actors.length !== 3 ||
      new Set(actors).size !== 3 ||
      actors.some((a) => !people.includes(a))
    )
      return issue(
        'session-binding',
        'Demonstration/review must bind exactly the same three declared people in distinct classroom roles',
        actors,
      );
  }
}
function fixtures(p: ComputerWorkshopParams) {
  return [
    ...new Set([
      ...p.learners.flatMap((l) => [l.station, l.seat.split('#')[0]]),
      ...[p.demonstration, p.review].flatMap((s) => [
        s.presenterStation.split('#')[0],
        ...s.seats.map((q) => q.split('#')[0]),
        ...(s.displayId ? [s.displayId] : []),
      ]),
    ]),
  ];
}
const stamp = (rt: Runtime, p: ComputerWorkshopParams) =>
  hashOf(
    fixtures(p).map((id) => ({
      id,
      pose: rt.world.entities[id]?.pose,
      support: rt.world.entities[id]?.support,
    })),
  );
function preview(
  rt: Runtime,
  verb: string,
  p: unknown,
): Diagnostic | undefined {
  const d = rt.registry.get(verb);
  if (!d) return issue('action-missing', `${verb} must be registered`, [verb]);
  const plan = d.plan(rt, p);
  if (!plan.ok) return plan.diagnostic;
  const occupied = d
    .reservations(rt.world, p)
    .find((q) => rt.holder(q.resource).length);
  if (occupied)
    return issue(
      'occupied',
      `${occupied.resource} must be released before ${verb}`,
      [occupied.resource],
    );
}
function dispatch(
  rt: Runtime,
  ex: Exec,
  verb: string,
  p: unknown,
): { record?: ActionRecord; diagnostic?: Diagnostic } {
  const d = preview(rt, verb, p);
  if (d) return { diagnostic: d };
  const def = rt.registry.get(verb)!;
  ex.resources = [
    ...new Set([
      ...ex.resources,
      ...def.reservations(rt.world, p).map((q) => q.resource),
    ]),
  ];
  const r = rt.submit(verb, p, { parent: ex.id, preempt: false });
  ex.children.push(r.id);
  return {
    record: r,
    ...(r.status === 'failed' ? { diagnostic: r.diagnostic } : {}),
  };
}
function wait(ex: Exec, d: Diagnostic): StepResult {
  ex.mode = 'waiting';
  ex.diagnostic = d;
  return { status: 'blocked', diagnostic: d };
}
function present(ex: Exec, actor: string) {
  return ex.members.find((m) => m.actor === actor)!.present;
}
function activeChildren(rt: Runtime, ex: Exec) {
  return ex.children.some((id) => rt.isActive(id));
}
function foreignActor(rt: Runtime, ex: Exec, actor: string) {
  return rt.holder(`actor:${actor}`).some((h) => !ex.children.includes(h));
}
function retainedWorkDiagnostic(
  rt: Runtime,
  ex: Exec,
  l: Learner,
): Diagnostic | undefined {
  if (!l.actions.length || l.completed) return;
  const p = ex.p.learners.find((p) => p.actor === l.actor)!;
  const w = readWorkstation(rt, p.station);
  if ('code' in w) return w;
  // work_at clears its live action field after safe stop. Its actual started
  // record remains authoritative evidence of which task last used the station.
  const lastWork = [...rt.records.values()].findLast(
    (r) =>
      r.verb === 'work_at' &&
      (r.params as WorkAtParams).station === p.station &&
      r.history.some((h) => h.status === 'executing'),
  );
  if (
    !lastWork ||
    !l.actions.includes(lastWork.id) ||
    w.user !== p.actor ||
    w.task !== p.task ||
    w.duration !== p.duration ||
    w.seat !== p.seat ||
    w.elapsed !== l.elapsed ||
    w.status !== 'unfinished'
  )
    return issue(
      'retained-task-replaced',
      `${p.station} no longer retains ${l.actor}'s exact unfinished ${p.task}; workshop Resume cannot overwrite another task receipt`,
      [l.actor, p.station, ...l.actions],
    );
}
function captureWork(rt: Runtime, ex: Exec, l: Learner) {
  if (!l.child) return;
  const p = ex.p.learners.find((p) => p.actor === l.actor)!,
    r = rt.records.get(l.child)!;
  let elapsed: number | undefined;
  if (r.outputs && typeof r.outputs.workedSeconds === 'number')
    elapsed = r.outputs.workedSeconds;
  else {
    const w = readWorkstation(rt, p.station);
    if (
      !('code' in w) &&
      w.action === l.child &&
      w.user === p.actor &&
      w.task === p.task &&
      w.duration === p.duration &&
      w.seat === p.seat
    )
      elapsed = w.elapsed;
  }
  if (elapsed !== undefined) {
    l.elapsed = elapsed;
    l.receipt = {
      action: r.id,
      station: p.station,
      seat: p.seat,
      task: p.task!,
      duration: p.duration,
      elapsed,
      completed: elapsed === p.duration,
    };
  }
  if (!rt.isActive(r.id)) {
    l.completed =
      r.status === 'completed' &&
      r.outputs?.finished === true &&
      l.elapsed === p.duration;
    l.child = undefined;
    if (!l.completed) {
      l.paused = true;
      l.diagnostic =
        r.diagnostic ??
        issue(
          'practice-stopped',
          `${l.actor}'s ${p.task} remains at ${l.elapsed}/${p.duration}s; explicit learner Resume required`,
          [l.actor, p.station, r.id],
        );
    }
  }
}
function safeStop(rt: Runtime, ex: Exec, end: boolean) {
  if (['ending', 'completed', 'ended'].includes(ex.mode)) return;
  const already = ['pausing', 'ending'].includes(ex.mode);
  ex.mode = end ? 'ending' : 'pausing';
  if (!already) {
    if (ex.session && rt.isActive(ex.session)) rt.cancel(ex.session);
    for (const l of ex.learners) {
      l.paused = true;
      if (l.child && rt.isActive(l.child)) rt.cancel(l.child);
    }
  }
}
function controlledSession(
  rt: Runtime,
  ex: Exec,
  kind: 'question' | 'advance' | 'join' | 'depart',
  actor?: string,
) {
  if (!ex.session || !rt.isActive(ex.session))
    return {
      diagnostic: issue(
        'session-inactive',
        'No actual current workshop gathering accepts that control',
        [ex.id],
      ),
    };
  const intent = kind === 'advance' ? { kind } : { kind, actor: actor! };
  return dispatch(rt, ex, 'classroom_control', { session: ex.session, intent });
}
function departure(
  rt: Runtime,
  ex: Exec,
  actor: string,
): Diagnostic | undefined {
  const prior = ex.departures[actor];
  if (prior) {
    const r = rt.records.get(prior)!;
    if (rt.isActive(prior))
      return issue(
        'departing',
        `${actor} is completing ordinary departure ${prior}`,
        [actor, prior],
      );
    if (r.status !== 'completed')
      return issue(
        'departure-stopped',
        `${prior} stopped; restore route and explicitly retry Leave/End`,
        [actor, prior],
      );
    return;
  }
  if (foreignActor(rt, ex, actor))
    return issue(
      'actor-directed',
      `${actor} must finish the accepted ordinary directive before workshop departure`,
      [actor],
    );
  const p = ex.p.review.departure[actor],
    r = dispatch(rt, ex, 'walk_to', { actor, x: p[0], z: p[1] });
  if (r.diagnostic) return r.diagnostic;
  ex.departures[actor] = r.record!.id;
  return issue(
    'departing',
    `${actor} is walking to declared departure ${r.record!.id}`,
    [actor, r.record!.id],
  );
}
function rememberSession(rt: Runtime, ex: Exec) {
  if (!ex.session || rt.isActive(ex.session)) return;
  const rec = rt.records.get(ex.session)!;
  const read = readClassroom(rt, ex.session)!;
  if (!ex.history.some((h) => h.session === ex.session))
    ex.history.push({
      stage: ex.stage as 'demonstration' | 'review',
      session: ex.session,
      readout: structuredClone(read),
      status: rec.status,
    });
}
function stopped(rt: Runtime, ex: Exec): StepResult {
  if (activeChildren(rt, ex)) return { status: 'running', phase: ex.mode };
  rememberSession(rt, ex);
  for (const a of allActors(ex.p)) {
    if (foreignActor(rt, ex, a))
      return {
        status: 'blocked',
        diagnostic: issue(
          'actor-directed',
          `${a} must finish the accepted ordinary directive before safe release`,
          [a],
        ),
      };
    if (heldBy(rt.world, a).length)
      return {
        status: 'blocked',
        diagnostic: issue(
          'hands-occupied',
          `${a} must ordinarily return held items before workshop release`,
          [a],
        ),
      };
  }
  if (ex.mode === 'pausing') {
    ex.mode = 'paused';
    return { status: 'running', phase: 'paused' };
  }
  if (ex.stage === 'practice')
    for (const m of ex.members.filter((m) => m.present)) {
      const d = departure(rt, ex, m.actor);
      if (d) return { status: 'blocked', diagnostic: d };
    }
  ex.mode = 'ended';
  return {
    status: 'completed',
    outputs: { ended: true, learners: structuredClone(ex.learners) },
  };
}
export const computerWorkshop: ActionDef<
  ComputerWorkshopParams,
  { binding: string },
  Exec
> = {
  verb: 'computer_workshop',
  description:
    'Hypothetical demonstration, independent same-computer learner practice and shared review; ordinary classroom/work/walk children only.',
  schema: params,
  drivesReservedHands: false,
  reservations: (_w, p) => [
    { resource: `computer-workshop:${p.facilitator}`, mode: 'exclusive' },
  ],
  plan(rt, p) {
    const d = structure(p);
    if (d) return { ok: false, diagnostic: d };
    for (const w of p.learners) {
      const d = preview(rt, 'work_at', w);
      if (d) return { ok: false, diagnostic: d };
    }
    for (const s of [p.demonstration, p.review]) {
      const d = preview(rt, 'classroom_session', s);
      if (d) return { ok: false, diagnostic: d };
    }
    if (rt.holder(`computer-workshop:${p.facilitator}`).length)
      return {
        ok: false,
        diagnostic: issue(
          'occupied',
          `${p.facilitator} already coordinates another workshop`,
          [p.facilitator],
        ),
      };
    return { ok: true, program: { binding: stamp(rt, p) } };
  },
  start(rt, p, program, id) {
    const ex: Exec = {
      id,
      p: structuredClone(p),
      ...program,
      stage: 'demonstration',
      mode: 'running',
      members: allActors(p).map((actor) => ({ actor, present: true })),
      learners: p.learners.map((p) => ({
        actor: p.actor,
        paused: false,
        elapsed: 0,
        completed: false,
        actions: [],
      })),
      children: [],
      resources: [`computer-workshop:${p.facilitator}`],
      departures: {},
      history: [],
      finished: false,
    };
    store(rt)[id] = ex;
    return ex;
  },
  onDirective(rt, ex, by, claims, ancestors) {
    if (
      ancestors.includes(ex.id) ||
      by.verb === 'computer_workshop_control' ||
      ['ending', 'ended', 'completed'].includes(ex.mode)
    )
      return;
    for (const m of ex.members)
      if (claims.some((q) => q.resource === `actor:${m.actor}`)) {
        m.present = false;
        m.reason = `directed by ${by.id}`;
        const l = ex.learners.find((l) => l.actor === m.actor);
        if (l) {
          l.paused = true;
          if (l.child && rt.isActive(l.child)) rt.cancel(l.child);
        }
        ex.diagnostic = issue(
          'directed',
          `${m.actor} follows ${by.id}; explicit declared Join and learner Resume retain unfinished work`,
          [m.actor, by.id],
        );
      }
  },
  step(rt, ex) {
    for (const l of ex.learners) captureWork(rt, ex, l);
    if (ex.mode === 'pausing' || ex.mode === 'ending') return stopped(rt, ex);
    if (ex.mode === 'paused') return { status: 'running', phase: 'paused' };
    if (ex.session) {
      if (rt.isActive(ex.session))
        return { status: 'running', phase: ex.stage };
      const rec = rt.records.get(ex.session)!;
      rememberSession(rt, ex);
      ex.session = undefined;
      if (rec.status !== 'completed')
        return wait(
          ex,
          issue(
            'session-stopped',
            `${rec.id} did not finish ordinary gathering/departure; classroom partial session restart is unsupported. End preserves its history.`,
            [rec.id],
          ),
        );
      if (ex.stage === 'demonstration') {
        ex.stage = 'practice';
        ex.mode = 'running';
      } else {
        if (!ex.members.every((m) => m.present))
          return wait(
            ex,
            issue(
              'insufficient-audience',
              'Shared review lost a declared participant; End retains the review history',
              [
                ex.id,
                ...ex.members.filter((m) => !m.present).map((m) => m.actor),
              ],
            ),
          );
        ex.finished = true;
        ex.mode = 'completed';
        return {
          status: 'completed',
          outputs: {
            learners: structuredClone(ex.learners),
            sessions: ex.history.map((h) => h.session),
          },
        };
      }
    }
    if (ex.mode === 'waiting')
      return { status: 'blocked', diagnostic: ex.diagnostic! };
    if (stamp(rt, ex.p) !== ex.binding)
      return wait(
        ex,
        issue(
          'binding-changed',
          'Restore original supported computers, chairs and gathering fixtures before Resume',
          fixtures(ex.p),
        ),
      );
    if (ex.stage !== 'practice') {
      if (ex.history.some((h) => h.stage === ex.stage))
        return wait(
          ex,
          issue(
            'session-stopped',
            'A completed/cancelled gathering is never recreated; End preserves original history',
            [ex.id],
          ),
        );
      if (!ex.members.every((m) => m.present))
        return wait(
          ex,
          issue(
            'insufficient-audience',
            'Workshop gathering requires all three declared people; explicit Join after departure or End',
            [
              ex.id,
              ...ex.members.filter((m) => !m.present).map((m) => m.actor),
            ],
          ),
        );
      const r = dispatch(rt, ex, 'classroom_session', ex.p[ex.stage]);
      if (r.diagnostic) return wait(ex, r.diagnostic);
      ex.session = r.record!.id;
      if (ex.stage === 'demonstration') ex.demo = ex.session;
      else ex.review = ex.session;
      return { status: 'running', phase: ex.stage };
    }
    // Independent work records own their own clocks; one stopped learner never cancels a peer.
    for (const m of ex.members.filter(
      (m) => !m.present && m.reason === 'left',
    )) {
      const l = ex.learners.find((l) => l.actor === m.actor);
      if (l?.child && rt.isActive(l.child)) continue;
      const d = departure(rt, ex, m.actor);
      if (d) ex.diagnostic = d;
    }
    for (const l of ex.learners) {
      if (l.child || l.completed || l.paused || !present(ex, l.actor)) continue;
      const p = ex.p.learners.find((p) => p.actor === l.actor)!;
      const w = readWorkstation(rt, p.station);
      if ('code' in w) {
        l.paused = true;
        l.diagnostic = w;
        continue;
      }
      const retained = retainedWorkDiagnostic(rt, ex, l);
      if (retained) {
        l.paused = true;
        l.diagnostic = retained;
        continue;
      }
      const r = dispatch(rt, ex, 'work_at', {
        ...p,
        ...(w.status === 'unfinished' ? { resume: true } : {}),
      });
      if (r.diagnostic) {
        l.paused = true;
        l.diagnostic = r.diagnostic;
      } else {
        l.child = r.record!.id;
        l.actions.push(r.record!.id);
        l.diagnostic = undefined;
      }
    }
    if (ex.learners.every((l) => l.completed) && !activeChildren(rt, ex)) {
      if (!ex.members.every((m) => m.present))
        return wait(
          ex,
          issue(
            'insufficient-audience',
            'Both retained tasks are complete; shared review waits for explicit Join of withdrawn people',
            [
              ex.id,
              ...ex.members.filter((m) => !m.present).map((m) => m.actor),
            ],
          ),
        );
      ex.stage = 'review';
      ex.diagnostic = undefined;
      return { status: 'running', phase: 'review' };
    }
    const halted = ex.learners.find((l) => !l.completed && !l.child);
    if (halted)
      return {
        status: 'blocked',
        diagnostic:
          halted.diagnostic ??
          issue(
            'learner-paused',
            `${halted.actor}'s unfinished task waits for explicit Join/learner Resume; peer work proceeds independently`,
            [halted.actor],
          ),
      };
    return { status: 'running', phase: 'practice' };
  },
  cancel(rt, ex) {
    safeStop(rt, ex, true);
    return { ok: true, deferred: true };
  },
  resumable:
    'Same-runtime explicit continuation only; active workshop reload is deferred.',
};
export const computerWorkshopControl: ActionDef<
  ComputerWorkshopControlParams,
  null,
  null
> = {
  verb: 'computer_workshop_control',
  description:
    'Explicit workshop/learner continuation and declared gathering controls; no physical writes.',
  schema: z.strictObject({
    workshop: id,
    intent: z.enum([
      'pause',
      'resume',
      'end',
      'pause-learner',
      'resume-learner',
      'leave',
      'join',
      'question',
      'advance',
    ]),
    actor: id.optional(),
  }),
  drivesReservedHands: false,
  reservations: () => [],
  plan(rt, p) {
    const ex = find(rt, p.workshop);
    if (
      !ex ||
      !rt.isActive(p.workshop) ||
      ['ended', 'completed'].includes(ex.mode)
    )
      return {
        ok: false,
        diagnostic: issue('inactive', `${p.workshop} is not active`, [
          p.workshop,
        ]),
      };
    if (ex.mode === 'ending' && p.intent !== 'end')
      return {
        ok: false,
        diagnostic: issue(
          'ending',
          'Workshop End is draining ordinary physical children; only repeated End is accepted until terminal release',
          [ex.id],
        ),
      };
    if (p.intent === 'pause' && ex.stage !== 'practice')
      return {
        ok: false,
        diagnostic: issue(
          'session-pause-unsupported',
          'Local Pause is available for learner practice only; global Pause freezes demonstration/review; ordinary classroom controls remain available and End drains',
          [ex.id],
        ),
      };
    if (
      p.intent === 'resume' &&
      (!['paused', 'waiting'].includes(ex.mode) || activeChildren(rt, ex))
    )
      return {
        ok: false,
        diagnostic: issue(
          'resume-busy',
          'Finish ordinary safe stops before workshop Resume',
          [ex.id],
        ),
      };
    if (
      p.intent === 'resume' &&
      ex.diagnostic?.code === 'computer_workshop.session-stopped'
    )
      return { ok: false, diagnostic: ex.diagnostic };
    if (['pause-learner', 'resume-learner'].includes(p.intent)) {
      const l = ex.learners.find((l) => l.actor === p.actor);
      if (
        ex.stage !== 'practice' ||
        !l ||
        l.completed ||
        ['pausing', 'ending', 'paused'].includes(ex.mode)
      )
        return {
          ok: false,
          diagnostic: issue(
            'learner-control',
            'Only declared unfinished learners in running practice accept individual Pause/Resume',
            [p.actor ?? '', ex.id],
          ),
        };
      if (
        p.intent === 'resume-learner' &&
        (!l.paused ||
          l.child ||
          !present(ex, l.actor) ||
          foreignActor(rt, ex, l.actor))
      )
        return {
          ok: false,
          diagnostic: issue(
            'learner-resume-busy',
            'Explicit Join, finished directive and safe learner stop are required before Resume',
            [l.actor],
          ),
        };
    }
    if (p.intent === 'resume' || p.intent === 'resume-learner') {
      for (const l of ex.learners.filter(
        (l) => !l.completed && (p.intent === 'resume' || l.actor === p.actor),
      )) {
        const d = retainedWorkDiagnostic(rt, ex, l);
        if (d) return { ok: false, diagnostic: d };
      }
    }
    if (
      ['leave', 'join', 'question'].includes(p.intent) &&
      !ex.members.some((m) => m.actor === p.actor)
    )
      return {
        ok: false,
        diagnostic: issue(
          'participant',
          'Only the three declared people accept workshop participation controls',
          [p.actor ?? '', ex.id],
        ),
      };
    if (
      ['join', 'leave', 'question', 'advance'].includes(p.intent) &&
      ex.session &&
      rt.isActive(ex.session)
    ) {
      const intent =
        p.intent === 'advance'
          ? { kind: 'advance' as const }
          : {
              kind:
                p.intent === 'leave'
                  ? ('depart' as const)
                  : p.intent === 'question'
                    ? ('question' as const)
                    : ('join' as const),
              actor: p.actor!,
            };
      const d = preview(rt, 'classroom_control', {
        session: ex.session,
        intent,
      });
      if (d) return { ok: false, diagnostic: d };
    } else if (['question', 'advance'].includes(p.intent))
      return {
        ok: false,
        diagnostic: issue(
          'session-inactive',
          'Questions/floor advance require an actual current gathering',
          [ex.id],
        ),
      };
    if (
      p.intent === 'join' &&
      (!p.actor ||
        foreignActor(rt, ex, p.actor) ||
        heldBy(rt.world, p.actor).length ||
        (ex.departures[p.actor] && rt.isActive(ex.departures[p.actor])))
    )
      return {
        ok: false,
        diagnostic: issue(
          'join-busy',
          'Finish ordinary departure/directive with free hands before declared Join',
          [p.actor ?? ''],
        ),
      };
    return { ok: true, program: null };
  },
  start(rt, p) {
    const ex = find(rt, p.workshop)!;
    if (p.intent === 'pause') safeStop(rt, ex, false);
    else if (p.intent === 'end') {
      if (!activeChildren(rt, ex))
        for (const [a, id] of Object.entries(ex.departures))
          if (rt.records.get(id)?.status !== 'completed')
            delete ex.departures[a];
      safeStop(rt, ex, true);
    } else if (p.intent === 'resume') {
      ex.mode = 'running';
      ex.diagnostic = undefined;
      for (const l of ex.learners)
        if (present(ex, l.actor) && !l.completed) l.paused = false;
    } else if (p.intent === 'pause-learner') {
      const l = ex.learners.find((l) => l.actor === p.actor)!;
      l.paused = true;
      if (l.child && rt.isActive(l.child)) rt.cancel(l.child);
    } else if (p.intent === 'resume-learner') {
      const l = ex.learners.find((l) => l.actor === p.actor)!;
      l.paused = false;
      l.diagnostic = undefined;
    } else if (p.intent === 'leave' || p.intent === 'join') {
      const m = ex.members.find((m) => m.actor === p.actor)!;
      const kind = p.intent === 'leave' ? 'depart' : 'join';
      if (ex.session && rt.isActive(ex.session)) {
        const r = controlledSession(rt, ex, kind, p.actor);
        if (r.diagnostic) {
          ex.diagnostic = r.diagnostic;
          return null;
        }
      }
      m.present = p.intent === 'join';
      m.reason = m.present ? undefined : 'left';
      if (m.present) {
        delete ex.departures[m.actor];
        if (
          ex.mode === 'waiting' &&
          ex.diagnostic?.code === 'computer_workshop.insufficient-audience'
        )
          ex.mode = 'running';
      } else {
        const l = ex.learners.find((l) => l.actor === m.actor);
        if (l) {
          l.paused = true;
          if (l.child && rt.isActive(l.child)) rt.cancel(l.child);
        }
        const old = ex.departures[m.actor];
        if (
          old &&
          !rt.isActive(old) &&
          rt.records.get(old)?.status !== 'completed'
        )
          delete ex.departures[m.actor];
      }
    } else
      controlledSession(
        rt,
        ex,
        p.intent === 'question' ? 'question' : 'advance',
        p.actor,
      );
    return null;
  },
  step: () => ({ status: 'completed' }),
  cancel: () => ({ ok: true }),
  resumable: true,
};
export const COMPUTER_WORKSHOP_ACTIONS: ActionDef[] = [
  computerWorkshop,
  computerWorkshopControl,
];
export function readComputerWorkshop(rt: Runtime, workshop: string) {
  const ex = find(rt, workshop),
    r = rt.records.get(workshop);
  if (!ex || !r) return;
  return structuredClone({
    workshop,
    status: r.status,
    stage: ex.stage,
    mode: ex.mode,
    finished: ex.finished,
    bindings: ex.p,
    members: ex.members,
    learners: ex.learners.map((l) => ({
      ...l,
      current: l.child ? rt.records.get(l.child) : undefined,
      workstation: readWorkstation(
        rt,
        ex.p.learners.find((p) => p.actor === l.actor)!.station,
      ),
    })),
    current: ex.session ? readClassroom(rt, ex.session) : undefined,
    sessions: { demonstration: ex.demo, review: ex.review },
    history: ex.history,
    ownedActions: ex.children,
    records: ex.children.map((id) => rt.records.get(id)),
    departures: ex.departures,
    claims: ex.resources.map((resource) => ({
      resource,
      holders: rt.holder(resource),
    })),
    diagnostic: ex.diagnostic ?? r.diagnostic,
  });
}
