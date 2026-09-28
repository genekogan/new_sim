// Action contract (spec §13). Every verb is typed, validated against a specific
// world state, reserves resources, then advances on the fixed-step runtime.
// Natural language never reaches this layer.
import type { z } from 'zod';
import type { WorldState } from '../world/types.ts';
import type { Runtime } from '../runtime/runtime.ts';

export type ActionStatus =
  | 'requested'
  | 'validated'
  | 'reserved'
  | 'executing'
  | 'completed'
  | 'blocked' // cannot presently continue; state remains valid; will retry
  | 'paused'
  | 'failed'
  | 'cancelled';

export const TERMINAL: ReadonlySet<ActionStatus> = new Set(['completed', 'failed', 'cancelled']);

/** Machine-readable failure. `message` must name the concrete objects/geometry involved. */
export type Diagnostic = {
  code: string; // e.g. 'route.blocked', 'carry.clearance', 'support.release-premature'
  message: string;
  subjects?: string[]; // entity/actor ids involved
  at?: [number, number, number]; // world location of the conflict
  details?: Record<string, unknown>;
};

export type Reservation = { resource: string; mode: 'exclusive' | 'shared' };

export type StepResult =
  | { status: 'running'; phase?: string }
  | { status: 'completed'; outputs?: Record<string, unknown> }
  | { status: 'blocked'; diagnostic: Diagnostic }
  | { status: 'failed'; diagnostic: Diagnostic };

export type PlanResult<Program> = { ok: true; program: Program; notes?: string[] } | { ok: false; diagnostic: Diagnostic };

/**
 * `deferred`: the action accepted the cancel but needs more ticks to reach a
 * safe stop (e.g. a controlled set-down); it keeps stepping and its eventual
 * `completed` is recorded as `cancelled`.
 */
export type CancelResult = { ok: true; deferred?: boolean } | { ok: false; diagnostic: Diagnostic };

export interface ActionDef<Params = any, Program = any, Exec = any> {
  verb: string;
  description: string;
  schema: z.ZodType<Params>;
  /** Resources required (actors, entities, interaction slots, work zones). */
  reservations(world: WorldState, params: Params): Reservation[];
  /** Validate + plan against the current world. Pure w.r.t. world. */
  plan(rt: Runtime, params: Params): PlanResult<Program>;
  /** Initialise execution state. Called once after reservations succeed. */
  start(rt: Runtime, params: Params, program: Program, actionId: string): Exec;
  /** Advance one fixed tick. May mutate rt.world only through the action's reserved entities. */
  step(rt: Runtime, exec: Exec, dt: number): StepResult;
  /**
   * Bring the action to an allowed stop state. Must refuse (not silently drop)
   * when stopping would leave an unsupported load (spec §13 `cancelled`).
   */
  cancel(rt: Runtime, exec: Exec): CancelResult;
  /**
   * Resumable snapshots (runtime/snapshot.ts, spec §22). `true`: the exec is plain data (Maps, Sets,
   * aliasing and ActionRecord references are fine; closures and class instances are not) and resumes
   * tick-exact with the default graph codec. A string: why this action refuses to be snapshotted.
   * Unset: runtime/snapshot.ts RESUMABLE_VERBS / NON_RESUMABLE decide.
   */
  resumable?: true | string;
  /** Custom exec serialisation (e.g. an exec holding a class instance); must return codec-encodable data. */
  serializeExec?(rt: Runtime, exec: Exec): unknown;
  /** Inverse of serializeExec, called on the restored runtime after world, records and services are loaded. */
  restoreExec?(rt: Runtime, data: unknown): Exec;
}

export type ActionRecord = {
  id: string;
  verb: string;
  params: unknown;
  status: ActionStatus;
  phase?: string;
  diagnostic?: Diagnostic;
  history: { tick: number; status: ActionStatus; phase?: string; code?: string }[];
  requestedTick: number;
  endedTick?: number;
  /** Parent action for hierarchical tasks (children may use the parent's reservations). */
  parent?: string;
  outputs?: Record<string, unknown>;
};
