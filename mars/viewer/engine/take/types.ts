// A Take is what actually happened during one execution (spec §21–23):
// resolved motion + discrete state changes + runtime events + the final state.
// Replay reads only this — never the planner, registry or a Runtime.
// Camera tracks are separate objects that point at a take; they are not part
// of the take body, so attaching/editing them can never change the take hash.
import type { WorldState } from '../world/types.ts';

/**
 * /2 (2026-09-28, W10): changes also carry hands (integer mm), baseActivity, on, speed (integer cm/s), contents.
 * /3 (2026-09-28, W20): `hands` and `speed` changes are thinned keyframes (INTERP_FIELDS), linearly interpolated
 * between consecutive keyframes of the same entity (TAKES_AND_PLANS.md "Thinned fields"); every other field is
 * still a step (last value ≤ t). A /2 reader sees the same shapes, but holds each keyframe instead of interpolating.
 */
export const TAKE_SCHEMA = 'mars-take/3';

/** Quantised pose sample: [tick, x mm, y mm, z mm, yaw mrad] or + [pitch mrad, roll mrad] when non-zero. */
export type PoseSample = number[];

/** A `hands` change value: the engine's human.hands in integer millimetres (a missing hand is free / at rest). A keyframe
 *  since mars-take/3 (INTERP_FIELDS). */
export type TakeHands = { left?: [number, number, number]; right?: [number, number, number] };

/**
 * Discrete state change: [tick, entityId, field, value]. Fields: present, activity, level, task, grip, phase,
 * support, reservedBy, connections, equipment, paint; since mars-take/2 also hands (TakeHands, mm), baseActivity,
 * on, speed (cm/s), contents. A null value = the field was cleared.
 */
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
export const SPEED_Q = 100; // a `speed` change is integer cm/s (mm/s changed almost every walking tick: +128 KB on v3)

/**
 * mars-take/3 thinned change fields and their recording tolerance (quanta: mm per hand point, Euclidean; cm/s).
 * Their changes are keyframes: between two consecutive keyframes of one entity that are both non-null and of the
 * same shape (the same hands present) the value is linear in the tick; otherwise it holds until the next keyframe.
 * null (hands free / not walking) and shape changes are exact at their tick. TakeRecorder keeps a keyframe only
 * where that interpolation would miss a recorded tick by more than the tolerance (`thinChanges`).
 */
export const INTERP_FIELDS: Record<string, number> = { hands: 5, speed: 1 };
