// A Take is what actually happened during one execution (spec §21–23):
// resolved motion + discrete state changes + runtime events + the final state.
// Replay reads only this — never the planner, registry or a Runtime.
// Camera tracks are separate objects that point at a take; they are not part
// of the take body, so attaching/editing them can never change the take hash.
import type { WorldState } from '../world/types.ts';

export const TAKE_SCHEMA = 'mars-take/1';

/** Quantised pose sample: [tick, x mm, y mm, z mm, yaw mrad] or + [pitch mrad, roll mrad] when non-zero. */
export type PoseSample = number[];

/** Discrete state change: [tick, entityId, field, value]. Fields: present, activity, level, task, grip, phase, support, reservedBy, connections. */
export type ChangeEvent = [number, string, string, unknown];

/** Runtime event with tick relative to the take start (action lifecycle, violation, mark). */
export type TakeEvent =
  | { t: number; type: 'action'; id: string; verb: string; status: string; phase?: string; code?: string; message?: string }
  | { t: number; type: 'violation'; code: string; message: string; subjects?: string[] }
  | { t: number; type: 'mark'; name: string; data?: unknown };

export type Take = {
  schema: typeof TAKE_SCHEMA;
  /** Content address: hash of every other field. */
  id: string;
  planHash?: string;
  baselineCheckpoint?: string;
  baselineStateHash: string;
  rulesVersion: string;
  dt: number;
  /** Absolute world tick at which the take starts; all t / sample ticks are relative to it. */
  startTick: number;
  ticks: number;
  keyframeEvery: number;
  /** Per-entity pose samples, stored only on change, simplified within 1 quantum. */
  tracks: Record<string, PoseSample[]>;
  changes: ChangeEvent[];
  events: TakeEvent[];
  finalStateHash: string;
  finalState: WorldState;
};

/** Minimal attachment type; the camera module (engine/camera) owns `data`'s shape. */
export type CameraTrack = { id: string; takeId: string; kind: string; data: unknown };

export const POS_Q = 1000; // samples are integer millimetres
export const ANG_Q = 1000; // and integer milliradians
