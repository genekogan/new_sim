// Hypothetical finite bridge. Existing registered actions own every physical write.
import { z } from 'zod';
import type { ActionDef, Diagnostic, StepResult } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import { angleDelta, hypot } from '../core/math.ts';
import {
  tidyTable,
  tidyTableControl,
  readTidyTable,
  type TidyTableParams,
} from './table-cleanup.ts';
import {
  setupRoom,
  readRoomSetup,
  type SetupRoomParams,
} from './room-setup.ts';
import { classroomSession, readClassroom } from './classroom.ts';
import type { ClassroomParams } from './types.ts';

export interface RoomPreparationParams {
  tidy: TidyTableParams;
  setup: SetupRoomParams;
  session: ClassroomParams;
  late: { actor: string; departure: [number, number] };
}
export interface RoomPreparationControlParams {
  preparation: string;
  intent: 'pause' | 'resume' | 'end';
}
type Stage = 'clearing' | 'arranging' | 'gathering';
type Mode =
  | 'running'
  | 'pausing'
  | 'paused'
  | 'waiting'
  | 'ending'
  | 'completed';
type Exec = {
  id: string;
  p: RoomPreparationParams;
  stage: Stage;
  mode: Mode;
  child?: string;
  tidy?: string;
  setup?: string;
  session?: string;
  children: string[];
  finished: boolean;
  diagnostic?: Diagnostic;
  stored?: Record<string, string>;
  payloads: Record<string, string>;
};
const store = (rt: Runtime): Record<string, Exec> =>
  (rt.services.roomPreparations ??= {});
const find = (rt: Runtime, id: string) =>
  (rt.services.roomPreparations as Record<string, Exec> | undefined)?.[id];
const issue = (
  code: string,
  message: string,
  subjects: string[],
  cause?: Diagnostic,
): Diagnostic => ({
  code: `room_preparation.${code}`,
  message,
  subjects,
  ...(cause ? { details: { cause } } : {}),
});
function waiting(ex: Exec, d: Diagnostic): StepResult {
  ex.mode = 'waiting';
  ex.diagnostic = d;
  return { status: 'blocked', diagnostic: d };
}
function atTarget(rt: Runtime, m: SetupRoomParams['moves'][number]) {
  const e = rt.world.entities[m.fixture];
  return (
    !!e &&
    e.support?.kind === 'ground' &&
    !e.pose.pitch &&
    !e.pose.roll &&
    hypot(e.pose.p[0] - m.to.x, e.pose.p[1], e.pose.p[2] - m.to.z) < 1e-6 &&
    Math.abs(angleDelta(e.pose.yaw, m.to.yaw)) < 1e-6
  );
}
const remainingSetup = (rt: Runtime, ex: Exec): SetupRoomParams => ({
  layout: ex.p.setup.layout,
  moves: ex.p.setup.moves.filter((m) => !atTarget(rt, m)),
});
function storedView(rt: Runtime, item: string) {
  const e = rt.world.entities[item];
  return JSON.stringify(
    e
      ? {
          id: e.id,
          def: e.def,
          provenance: e.provenance,
          pose: e.pose,
          support: e.support,
          contents: e.contents,
          equipment: e.equipment,
        }
      : null,
  );
}
function payloadView(rt: Runtime, item: string) {
  const e = rt.world.entities[item];
  return JSON.stringify(
    e
      ? {
          id: e.id,
          def: e.def,
          provenance: e.provenance,
          contents: e.contents,
          equipment: e.equipment,
        }
      : null,
  );
}
function retainedIssue(rt: Runtime, ex: Exec) {
  const payload = Object.entries(ex.payloads).find(
    ([id, value]) => payloadView(rt, id) !== value,
  );
  if (payload)
    return issue(
      'item-payload-changed',
      `${payload[0]} changed identity/material after admission; restore the same actual payload`,
      [payload[0]],
    );
  const changed = Object.entries(ex.stored ?? {}).find(
    ([id, binding]) => storedView(rt, id) !== binding,
  );
  return changed
    ? issue(
        'stored-item-changed',
        `${changed[0]} changed after supported storage; restore the same actual item before continuing`,
        [changed[0]],
      )
    : undefined;
}
function stageAdmission(rt: Runtime, ex: Exec): Diagnostic | undefined {
  const retained = retainedIssue(rt, ex);
  if (retained) return retained;
  if (ex.stage === 'clearing') {
    if (ex.tidy) {
      if (
        !rt.isActive(ex.tidy) &&
        rt.records.get(ex.tidy)?.status === 'completed' &&
        readTidyTable(rt, ex.tidy)?.finished
      ) {
        return readTidyTable(rt, ex.tidy)!.items.every((i) => i.atDestination)
          ? undefined
          : issue(
              'storage-not-ready',
              'Completed tidy items must retain their actual declared destination support before setup',
              ex.p.tidy.transfers.map((t) => t.item),
            );
      }
      if (!rt.isActive(ex.tidy))
        return issue(
          'cleanup-stopped',
          `${ex.tidy} ended before full storage; End is available, but cancelled cleanup is not silently recreated`,
          [ex.tidy],
        );
      const plan = tidyTableControl.plan(rt, {
        task: ex.tidy,
        intent: 'resume',
      });
      return plan.ok ? undefined : plan.diagnostic;
    }
    const plan = tidyTable.plan(rt, ex.p.tidy);
    return plan.ok ? undefined : plan.diagnostic;
  }
  if (ex.stage === 'arranging') {
    const p = remainingSetup(rt, ex);
    if (!p.moves.length) return;
    const plan = setupRoom.plan(rt, p);
    return plan.ok
      ? undefined
      : issue(
          'setup-unavailable',
          plan.diagnostic.message,
          plan.diagnostic.subjects ?? [],
          plan.diagnostic,
        );
  }
  if (ex.session)
    return issue(
      'session-stopped',
      `${ex.session} cannot be restarted as a retained classroom; End remains available`,
      [ex.session],
    );
  const plan = classroomSession.plan(rt, ex.p.session);
  return plan.ok
    ? undefined
    : issue(
        'session-unavailable',
        plan.diagnostic.message,
        plan.diagnostic.subjects ?? [],
        plan.diagnostic,
      );
}
function pause(rt: Runtime, ex: Exec) {
  if (ex.mode === 'pausing' || ex.mode === 'paused') return;
  ex.mode = 'pausing';
  if (ex.child && rt.isActive(ex.child)) {
    if (ex.stage === 'clearing') {
      const p = { task: ex.child, intent: 'pause' as const };
      const plan = tidyTableControl.plan(rt, p);
      if (plan.ok) {
        const r = rt.submit('tidy_table_control', p, {
          parent: ex.id,
          preempt: false,
        });
        ex.children.push(r.id);
      } else ex.diagnostic = plan.diagnostic;
    } else rt.cancel(ex.child);
  }
}
function end(rt: Runtime, ex: Exec) {
  if (ex.mode === 'ending') return;
  ex.mode = 'ending';
  for (const id of ex.children) if (rt.isActive(id)) rt.cancel(id);
}
function definition(p: RoomPreparationParams): Diagnostic | undefined {
  const table = p.setup.moves.find((m) =>
    p.tidy.transfers.every((t) => t.from.split('#')[0] === m.fixture),
  );
  const other = p.setup.moves.find((m) => m !== table);
  const people = [
    p.session.host,
    ...p.session.presenters,
    ...p.session.audience,
  ];
  const all = new Set([
    ...people,
    p.tidy.actor,
    p.late.actor,
    ...p.setup.moves.flatMap((m) => [m.actor, ...(m.helpers ?? [])]),
  ]);
  if (
    p.tidy.transfers.length !== 2 ||
    p.setup.moves.length !== 2 ||
    !table ||
    !other ||
    p.tidy.transfers.some((t) =>
      p.setup.moves.some((m) => m.fixture === t.to.split('#')[0]),
    ) ||
    !p.session.seats.includes(`${other.fixture}#seat`) ||
    people.includes(p.late.actor) ||
    p.session.presenters.length > 2 ||
    p.session.audience.length > 4 ||
    all.size > 9
  )
    return issue(
      'definition',
      'Preparation requires two stored items, one source table and one classroom candidate chair, at most nine declared people, and one optional late visitor',
      [...all],
    );
}
export const roomPreparation: ActionDef<RoomPreparationParams, null, Exec> = {
  verb: 'room_preparation',
  description:
    'Finite same-object cleanup, safe physical room setup, then existing classroom; explicit interruption without replacement movers.',
  schema: z.strictObject({
    tidy: tidyTable.schema,
    setup: setupRoom.schema,
    session: classroomSession.schema,
    late: z.strictObject({
      actor: z.string().min(1).max(80),
      departure: z.tuple([
        z.number().min(-500).max(500),
        z.number().min(-500).max(500),
      ]),
    }),
  }),
  reservations: () => [{ resource: 'room-preparation', mode: 'exclusive' }],
  yieldTo: () => [],
  drivesReservedHands: false,
  plan(rt, p) {
    const structural = definition(p);
    if (structural) return { ok: false, diagnostic: structural };
    for (const verb of [
      'tidy_table',
      'tidy_table_control',
      'setup_room',
      'move_fixture',
      'classroom_session',
      'classroom_control',
    ])
      if (!rt.registry.has(verb))
        return {
          ok: false,
          diagnostic: issue(
            'action-missing',
            `Preparation requires registered ${verb}`,
            [verb],
          ),
        };
    const table = p.setup.moves.find(
      (m) => rt.world.entities[m.fixture]?.def === 'table-6ft',
    );
    const chair = p.setup.moves.find(
      (m) => rt.world.entities[m.fixture]?.def === 'camp-chair',
    );
    if (
      !table ||
      !chair ||
      !p.tidy.transfers.every((t) => t.from.split('#')[0] === table.fixture)
    )
      return {
        ok: false,
        diagnostic: issue(
          'fixtures',
          'Setup must move the actual tidy source table and one existing classroom chair',
          p.setup.moves.map((m) => m.fixture),
        ),
      };
    if (!rt.world.entities[p.late.actor]?.human)
      return {
        ok: false,
        diagnostic: issue(
          'late-missing',
          `Declared late visitor ${p.late.actor} is unavailable`,
          [p.late.actor],
        ),
      };
    const plan = tidyTable.plan(rt, p.tidy);
    return plan.ok
      ? { ok: true, program: null }
      : { ok: false, diagnostic: plan.diagnostic };
  },
  start(rt, p, _program, id) {
    const ex: Exec = {
      id,
      p: structuredClone(p),
      stage: 'clearing',
      mode: 'running',
      children: [],
      finished: false,
      payloads: Object.fromEntries(
        p.tidy.transfers.map((t) => [t.item, payloadView(rt, t.item)]),
      ),
    };
    store(rt)[id] = ex;
    return ex;
  },
  step(rt, ex): StepResult {
    if (ex.mode === 'ending') {
      if (ex.children.some((id) => rt.isActive(id)))
        return { status: 'running', phase: 'ending' };
      ex.mode = 'completed';
      return {
        status: 'completed',
        outputs: { finished: false, stage: ex.stage },
      };
    }
    if (ex.mode === 'pausing') {
      const quiet =
        !ex.child ||
        !rt.isActive(ex.child) ||
        (ex.stage === 'clearing' &&
          ['paused', 'waiting'].includes(
            readTidyTable(rt, ex.child)?.mode ?? '',
          ));
      if (!quiet) return { status: 'running', phase: 'pausing' };
      ex.mode = ex.diagnostic ? 'waiting' : 'paused';
      return { status: 'running', phase: ex.mode };
    }
    if (ex.mode === 'paused' || ex.mode === 'waiting')
      return ex.diagnostic
        ? { status: 'blocked', diagnostic: ex.diagnostic }
        : { status: 'running', phase: ex.mode };
    const changed = retainedIssue(rt, ex);
    if (changed) {
      ex.diagnostic = changed;
      pause(rt, ex);
      return { status: 'running', phase: 'pausing' };
    }
    if (ex.child) {
      const rec = rt.records.get(ex.child)!;
      if (rt.isActive(ex.child)) {
        if (ex.stage === 'clearing') {
          const tidy = readTidyTable(rt, ex.child);
          if (tidy && ['paused', 'waiting'].includes(tidy.mode))
            return waiting(
              ex,
              tidy.diagnostic ??
                issue('cleanup-paused', `${ex.child} awaits explicit Resume`, [
                  ex.child,
                ]),
            );
        }
        return { status: 'running', phase: ex.stage };
      }
      if (rec.status !== 'completed')
        return waiting(
          ex,
          issue(
            'child-stopped',
            `${rec.verb} ${rec.id} ended ${rec.status}; retained physical placements require explicit control`,
            [rec.id],
            rec.diagnostic,
          ),
        );
      if (ex.stage === 'clearing') {
        if (!readTidyTable(rt, ex.child)?.finished)
          return waiting(
            ex,
            issue(
              'cleanup-ended',
              `${ex.child} did not finish all supported transfers`,
              [ex.child],
            ),
          );
        if (!readTidyTable(rt, ex.child)!.items.every((i) => i.atDestination))
          return waiting(
            ex,
            issue(
              'storage-not-ready',
              'Completed tidy items must retain their actual declared destination support before setup',
              ex.p.tidy.transfers.map((t) => t.item),
            ),
          );
        ex.stored = Object.fromEntries(
          [
            ...new Set(
              ex.p.tidy.transfers.flatMap((t) => [t.item, t.to.split('#')[0]]),
            ),
          ].map((id) => [id, storedView(rt, id)]),
        );
        ex.stage = 'arranging';
      } else if (ex.stage === 'arranging') {
        if (!ex.p.setup.moves.every((m) => atTarget(rt, m)))
          return waiting(
            ex,
            issue(
              'layout-not-ready',
              'Actual ground placements differ from the authored usable room',
              ex.p.setup.moves.map((m) => m.fixture),
            ),
          );
        ex.stage = 'gathering';
      } else {
        ex.finished =
          readClassroom(rt, ex.child)?.phase === 'ended' && !rec.diagnostic;
        ex.mode = 'completed';
        return {
          status: 'completed',
          outputs: { finished: ex.finished, session: ex.child },
        };
      }
      ex.child = undefined;
    }
    if (ex.stage === 'arranging' && !remainingSetup(rt, ex).moves.length)
      ex.stage = 'gathering';
    const refused = stageAdmission(rt, ex);
    if (refused) return waiting(ex, refused);
    const verb =
      ex.stage === 'clearing'
        ? 'tidy_table'
        : ex.stage === 'arranging'
          ? 'setup_room'
          : 'classroom_session';
    const p =
      ex.stage === 'clearing'
        ? ex.p.tidy
        : ex.stage === 'arranging'
          ? remainingSetup(rt, ex)
          : ex.p.session;
    const child = rt.submit(verb, p, { parent: ex.id, preempt: false });
    ex.child = child.id;
    ex.children.push(child.id);
    if (ex.stage === 'clearing') ex.tidy = child.id;
    else if (ex.stage === 'arranging') ex.setup = child.id;
    else ex.session = child.id;
    if (child.status === 'failed')
      return waiting(
        ex,
        issue(
          'child-refused',
          child.diagnostic?.message ?? `${verb} refused`,
          [child.id],
          child.diagnostic,
        ),
      );
    return { status: 'running', phase: ex.stage };
  },
  cancel(rt, ex) {
    end(rt, ex);
    return { ok: true, deferred: true };
  },
  resumable:
    'Same-Runtime retained tidy continuation and explicit safe-ground setup retry; active reload and classroom Pause/Resume unsupported.',
};
export const roomPreparationControl: ActionDef<
  RoomPreparationControlParams,
  null,
  null
> = {
  verb: 'room_preparation_control',
  description:
    'Explicit safe local preparation Pause/Resume, or End draining existing physical children.',
  schema: z.strictObject({
    preparation: z.string().min(1).max(80),
    intent: z.enum(['pause', 'resume', 'end']),
  }),
  reservations: () => [],
  plan(rt, p) {
    const ex = find(rt, p.preparation);
    if (!ex || !rt.isActive(ex.id) || ['ending', 'completed'].includes(ex.mode))
      return {
        ok: false,
        diagnostic: issue(
          'inactive',
          `${p.preparation} is not accepting ${p.intent}`,
          [p.preparation],
        ),
      };
    if (p.intent === 'pause' && ex.stage === 'gathering' && !!ex.session)
      return {
        ok: false,
        diagnostic: issue(
          'session-pause-unsupported',
          'Global Pause freezes the world; ordinary session controls remain available; End drains. Classroom local Pause/Resume is unsupported.',
          [ex.session ?? ex.id],
        ),
      };
    if (p.intent === 'resume') {
      if (!['paused', 'waiting'].includes(ex.mode))
        return {
          ok: false,
          diagnostic: issue(
            'not-paused',
            'Wait for actual safe physical release before explicit Resume',
            [ex.id],
          ),
        };
      const d = stageAdmission(rt, ex);
      if (d) return { ok: false, diagnostic: d };
    }
    return { ok: true, program: null };
  },
  start(rt, p) {
    const ex = find(rt, p.preparation)!;
    if (p.intent === 'end') rt.cancel(ex.id);
    else if (p.intent === 'pause') pause(rt, ex);
    else {
      if (ex.stage === 'clearing' && ex.tidy && rt.isActive(ex.tidy)) {
        const r = rt.submit(
          'tidy_table_control',
          { task: ex.tidy, intent: 'resume' },
          { parent: ex.id, preempt: false },
        );
        ex.children.push(r.id);
      } else if (
        ex.child &&
        !rt.isActive(ex.child) &&
        (rt.records.get(ex.child)?.status !== 'completed' ||
          (ex.stage === 'arranging' && remainingSetup(rt, ex).moves.length > 0))
      )
        ex.child = undefined;
      ex.diagnostic = undefined;
      ex.mode = 'running';
    }
    return null;
  },
  step: () => ({ status: 'completed' }),
  cancel: () => ({ ok: true }),
  resumable: true,
};
export function readRoomPreparation(rt: Runtime, action: string) {
  const ex = find(rt, action),
    rec = rt.records.get(action);
  if (!ex || !rec) return;
  return structuredClone({
    preparation: action,
    status: rec.status,
    stage: ex.stage,
    mode: ex.mode,
    finished: ex.finished,
    bindings: structuredClone(ex.p),
    child: ex.child,
    ownedActions: [...ex.children],
    tidy: ex.tidy ? readTidyTable(rt, ex.tidy) : undefined,
    setup: ex.setup ? readRoomSetup(rt, ex.setup) : undefined,
    session: ex.session ? readClassroom(rt, ex.session) : undefined,
    placements: ex.p.setup.moves.map((m) => ({
      fixture: m.fixture,
      target: { ...m.to },
      atTarget: atTarget(rt, m),
      pose: structuredClone(rt.world.entities[m.fixture]?.pose),
      support: structuredClone(rt.world.entities[m.fixture]?.support),
    })),
    storedItems: ex.p.tidy.transfers.map((t) => ({
      ...t,
      actual: structuredClone(rt.world.entities[t.item]),
    })),
    waitingReason: ex.diagnostic?.message,
    diagnostic: ex.diagnostic ? structuredClone(ex.diagnostic) : undefined,
  });
}
export const ROOM_PREPARATION_ACTIONS: ActionDef[] = [
  roomPreparation,
  roomPreparationControl,
];
