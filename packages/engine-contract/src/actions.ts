// Action contract, mirroring Mars viewer/engine/actions/types.ts.
import type { z } from 'zod';
import type { WorldState } from './world.ts';
import type { Runtime } from './runtime.ts';

export type ActionStatus =
  | 'requested' | 'validated' | 'reserved' | 'executing'
  | 'completed' | 'blocked' | 'paused' | 'failed' | 'cancelled';
export const TERMINAL: ReadonlySet<ActionStatus> = new Set(['completed', 'failed', 'cancelled']);

export type Diagnostic = {
  code: string;
  message: string;
  subjects?: string[];
  at?: [number, number, number];
  details?: Record<string, unknown>;
};
export type Reservation = { resource: string; mode: 'exclusive' | 'shared' };
export type StepResult =
  | { status: 'running'; phase?: string }
  | { status: 'completed'; outputs?: Record<string, unknown> }
  | { status: 'blocked'; diagnostic: Diagnostic }
  | { status: 'failed'; diagnostic: Diagnostic };
export type PlanResult<Program> =
  | { ok: true; program: Program; notes?: string[] }
  | { ok: false; diagnostic: Diagnostic };
export type CancelResult = { ok: true; deferred?: boolean } | { ok: false; diagnostic: Diagnostic };

export interface ActionDef<Params = any, Program = any, Exec = any> {
  verb: string;
  description: string;
  schema: z.ZodType<Params>;
  reservations(world: WorldState, params: Params): Reservation[];
  plan(rt: Runtime, params: Params): PlanResult<Program>;
  start(rt: Runtime, params: Params, program: Program, actionId: string): Exec;
  step(rt: Runtime, exec: Exec, dt: number): StepResult;
  cancel(rt: Runtime, exec: Exec): CancelResult;
  /** Required here (a scaffold demand on the real engine): in-flight state must be serializable at any tick. */
  serializeExec(exec: Exec): unknown;
  restoreExec(rt: Runtime, params: Params, data: unknown, actionId: string): Exec;
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
  parent?: string;
  outputs?: Record<string, unknown>;
};
