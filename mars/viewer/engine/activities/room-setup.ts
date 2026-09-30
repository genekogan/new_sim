import { z } from 'zod';
import type {
  ActionDef,
  ActionStatus,
  Diagnostic,
  StepResult,
} from '../actions/types.ts';
import { DT, type Runtime } from '../runtime/runtime.ts';
import type { Pose } from '../world/types.ts';
import { CATALOG } from '../world/catalog.ts';
import { angleDelta, hypot } from '../core/math.ts';
import {
  moveFixture,
  readFixtureMove,
  type MoveFixtureParams,
  type FixtureMoveReadout,
} from '../carry/fixture.ts';
export interface SetupRoomParams {
  layout: 'default' | 'side';
  moves: MoveFixtureParams[];
}
export interface RoomSetupPlacement {
  move: MoveFixtureParams;
  atTarget: boolean;
  support?: string;
  position?: number[];
  yaw?: number;
}
export interface RoomSetupReadout {
  action: string;
  layout: SetupRoomParams['layout'];
  status: ActionStatus;
  phase: string;
  targets: MoveFixtureParams[];
  current?: FixtureMoveReadout;
  completed: MoveFixtureParams[];
  placements: RoomSetupPlacement[];
  ready: boolean;
  partial: boolean;
  stopping: boolean;
  waitingReason?: string;
  diagnostic?: Diagnostic;
}
type Exec = {
  id: string;
  params: SetupRoomParams;
  startedTick: number;
  origins: Record<string, Pose>;
  index: number;
  child?: string;
  children: string[];
  completed: MoveFixtureParams[];
  stopping: boolean;
  error?: Diagnostic;
};
type Store = Record<string, Exec>;
const store = (rt: Runtime): Store => (rt.services.roomSetups ??= {});
const diag = (
  code: string,
  message: string,
  subjects: string[],
  cause?: Diagnostic,
): Diagnostic => ({
  code: `setup_room.${code}`,
  message,
  subjects,
  ...(cause ? { details: { cause } } : {}),
});
const copy = (m: MoveFixtureParams): MoveFixtureParams => ({
  ...m,
  to: { ...m.to },
  ...(m.helpers ? { helpers: [...m.helpers] } : {}),
});
function atTarget(rt: Runtime, m: MoveFixtureParams) {
  const e = rt.world.entities[m.fixture];
  return (
    !!e &&
    e.kind === 'fixture' &&
    e.support?.kind === 'ground' &&
    Math.abs(e.pose.pitch ?? 0) < 1e-6 &&
    Math.abs(e.pose.roll ?? 0) < 1e-6 &&
    hypot(e.pose.p[0] - m.to.x, e.pose.p[1], e.pose.p[2] - m.to.z) < 1e-6 &&
    Math.abs(angleDelta(e.pose.yaw, m.to.yaw)) < 1e-6
  );
}
function stop(rt: Runtime, ex: Exec, error?: Diagnostic) {
  ex.stopping = true;
  ex.error ??= error;
  if (ex.child && rt.isActive(ex.child)) rt.cancel(ex.child);
}
function childError(rt: Runtime, ex: Exec) {
  return ex.child ? rt.records.get(ex.child)?.diagnostic : undefined;
}
export function readRoomSetup(
  rt: Runtime,
  action: string,
): RoomSetupReadout | undefined {
  const rec = rt.records.get(action);
  if (!rec || rec.verb !== 'setup_room') return;
  const p = rec.params as SetupRoomParams;
  if (
    !Array.isArray(p?.moves) ||
    !p.moves.every((m) => m?.to && typeof m.fixture === 'string')
  )
    return;
  const ex = (rt.services.roomSetups as Store | undefined)?.[action],
    active = rt.isActive(action);
  const completed = p.moves.filter(
    (m) =>
      ex?.completed.some((c) => c.fixture === m.fixture) ||
      [...rt.records.values()].some(
        (c) =>
          c.parent === action &&
          c.verb === 'move_fixture' &&
          c.status === 'completed' &&
          (c.params as MoveFixtureParams).fixture === m.fixture,
      ),
  );
  const placements = p.moves.map((move) => {
    const e = rt.world.entities[move.fixture];
    return {
      move: copy(move),
      atTarget: atTarget(rt, move),
      support: e?.support?.kind,
      position: e ? [...e.pose.p] : undefined,
      yaw: e?.pose.yaw,
    };
  });
  const ready =
    rec.status === 'completed' && placements.every((m) => m.atTarget);
  const current =
    active && ex?.child ? readFixtureMove(rt, ex.child) : undefined;
  const changed = placements.find((p) => !p.atTarget);
  const diagnostic =
    current?.diagnostic ??
    ex?.error ??
    rec.diagnostic ??
    (rec.status === 'completed' && changed
      ? diag(
          'layout-changed',
          `${changed.move.fixture} changed after completed room setup`,
          [changed.move.fixture],
        )
      : undefined);
  const moved = p.moves.some((m) => {
    const origin = ex?.origins[m.fixture],
      e = rt.world.entities[m.fixture];
    return (
      origin &&
      e &&
      (hypot(
        e.pose.p[0] - origin.p[0],
        e.pose.p[1] - origin.p[1],
        e.pose.p[2] - origin.p[2],
      ) > 1e-6 ||
        Math.abs(angleDelta(e.pose.yaw, origin.yaw)) > 1e-6)
    );
  });
  return {
    action,
    layout: p.layout,
    status: rec.status,
    phase: active
      ? ex?.stopping
        ? 'stopping'
        : ex?.child
          ? 'moving'
          : 'preparing'
      : rec.status === 'completed'
        ? ready
          ? 'ready'
          : 'changed'
        : rec.status,
    targets: p.moves.map(copy),
    current,
    completed: completed.map(copy),
    placements,
    ready,
    partial: (completed.length > 0 || moved) && !ready,
    stopping: active && (ex?.stopping ?? false),
    waitingReason:
      diagnostic?.message ??
      (active
        ? ex?.stopping
          ? 'waiting for physical children to stop on safe ground'
          : current
            ? 'waiting for actual fixture set-down and release'
            : 'waiting to start physical setup'
        : undefined),
    diagnostic,
  };
}
export const setupRoom: ActionDef<
  SetupRoomParams,
  Record<string, never>,
  Exec
> = {
  verb: 'setup_room',
  description:
    'Serial physical preparation of at most one empty camp-chair and one empty table to caller-authored default/side targets; no automatic pickup or classroom start.',
  schema: z.strictObject({
    layout: z.enum(['default', 'side']),
    moves: z.array(moveFixture.schema).min(1).max(2),
  }),
  drivesReservedHands: false,
  yieldTo: () => [],
  reservations: () => [{ resource: 'room-setup', mode: 'exclusive' }],
  plan(rt, p) {
    const seen = new Set<string>(),
      defs = new Set<string>();
    for (const m of p.moves) {
      const e = rt.world.entities[m.fixture];
      if (seen.has(m.fixture))
        return {
          ok: false,
          diagnostic: diag(
            'duplicate-fixture',
            `${m.fixture} appears more than once in room setup`,
            [m.fixture],
          ),
        };
      seen.add(m.fixture);
      if (
        !e ||
        !['camp-chair', 'table-6ft'].includes(e.def) ||
        !CATALOG[e.def]?.capabilities?.fixtureCarry
      )
        return {
          ok: false,
          diagnostic: diag(
            'unsupported',
            `${m.fixture} must be an existing supported camp-chair or table-6ft`,
            [m.fixture],
          ),
        };
      if (defs.has(e.def))
        return {
          ok: false,
          diagnostic: diag(
            'duplicate-kind',
            `room setup supports at most one ${e.def}`,
            [m.fixture],
          ),
        };
      defs.add(e.def);
      const result = moveFixture.plan(rt, m);
      if (!result.ok)
        return {
          ok: false,
          diagnostic: diag(
            'preflight',
            `${m.fixture} setup preflight refused: ${result.diagnostic.message}`,
            [
              m.fixture,
              m.actor,
              ...(m.helpers ?? []),
              ...(result.diagnostic.subjects ?? []),
            ],
            result.diagnostic,
          ),
        };
    }
    return { ok: true, program: {} };
  },
  start(rt, p, _program, id) {
    const ex: Exec = {
      id,
      params: { layout: p.layout, moves: p.moves.map(copy) },
      startedTick: rt.tick,
      origins: Object.fromEntries(
        p.moves.map((m) => [
          m.fixture,
          {
            ...rt.world.entities[m.fixture].pose,
            p: [...rt.world.entities[m.fixture].pose.p],
          },
        ]),
      ),
      index: 0,
      children: [],
      completed: [],
      stopping: false,
    };
    store(rt)[id] = ex;
    return ex;
  },
  step(rt, ex): StepResult {
    if (!ex.stopping && (rt.tick - ex.startedTick) * DT >= 180)
      stop(
        rt,
        ex,
        diag(
          'timeout',
          `${ex.id} room setup exceeded 180 simulation seconds; stopping physical moves with partial placements preserved`,
          ex.params.moves.map((m) => m.fixture),
        ),
      );
    if (ex.stopping) {
      if (ex.child && rt.isActive(ex.child)) {
        rt.cancel(ex.child);
        return {
          status: 'blocked',
          diagnostic:
            childError(rt, ex) ??
            ex.error ??
            diag(
              'stopping',
              `${ex.id} waits for ${ex.child} safe ground stop`,
              [ex.id, ex.child],
            ),
        };
      }
      const ungrounded = ex.children
        .map(
          (id) => rt.records.get(id)?.params as MoveFixtureParams | undefined,
        )
        .filter(
          (m) => m && rt.world.entities[m.fixture]?.support?.kind !== 'ground',
        );
      if (ungrounded.length)
        return {
          status: 'blocked',
          diagnostic: diag(
            'support-pending',
            `${ex.id} cannot end until its moved fixtures have actual ground support`,
            ungrounded.map((m) => m!.fixture),
          ),
        };
      if (ex.error) return { status: 'failed', diagnostic: ex.error };
      return {
        status: 'completed',
        outputs: { completed: ex.completed.map(copy), partial: true },
      };
    }
    if (ex.child) {
      if (rt.isActive(ex.child)) {
        const issue = childError(rt, ex);
        return issue
          ? { status: 'blocked', diagnostic: issue }
          : { status: 'running', phase: 'moving' };
      }
      const record = rt.records.get(ex.child)!,
        m = ex.params.moves[ex.index];
      if (record.status !== 'completed') {
        stop(
          rt,
          ex,
          diag(
            'child-stopped',
            `${m.fixture} physical move ${record.id} ended ${record.status}`,
            [m.fixture, record.id],
            record.diagnostic,
          ),
        );
        return { status: 'running', phase: 'stopping' };
      }
      if (!atTarget(rt, m)) {
        stop(
          rt,
          ex,
          diag(
            'layout-changed',
            `${m.fixture} no longer rests upright at its authored ${ex.params.layout} target`,
            [m.fixture],
          ),
        );
        return { status: 'running', phase: 'stopping' };
      }
      ex.completed.push(copy(m));
      ex.index++;
      ex.child = undefined;
    }
    if (ex.index === ex.params.moves.length) {
      const changed = ex.params.moves.find((m) => !atTarget(rt, m));
      if (changed) {
        stop(
          rt,
          ex,
          diag(
            'layout-changed',
            `${changed.fixture} changed after placement before room setup finished`,
            [changed.fixture],
          ),
        );
        return { status: 'running', phase: 'stopping' };
      }
      return {
        status: 'completed',
        outputs: {
          completed: ex.completed.map(copy),
          layout: ex.params.layout,
        },
      };
    }
    const child = rt.submit('move_fixture', ex.params.moves[ex.index], {
      parent: ex.id,
      preempt: false,
    });
    ex.child = child.id;
    ex.children.push(child.id);
    if (child.status === 'failed')
      stop(
        rt,
        ex,
        diag(
          'child-refused',
          `${ex.params.moves[ex.index].fixture} physical move refused: ${child.diagnostic?.message ?? child.status}`,
          [ex.params.moves[ex.index].fixture, child.id],
          child.diagnostic,
        ),
      );
    return { status: 'running', phase: ex.stopping ? 'stopping' : 'moving' };
  },
  cancel(rt, ex) {
    stop(rt, ex);
    return { ok: true, deferred: true };
  },
  resumable:
    'active room setup physical children and safe partial cancellation are not yet verified resumable',
};
export const ROOM_SETUP_ACTIONS: ActionDef[] = [setupRoom];
