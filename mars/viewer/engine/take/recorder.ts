// TakeRecorder: a RuntimeObserver that captures a compact Take.
// Pose tracks are quantised (1 mm / 1 mrad) and simplified online: a sample
// is dropped when linear interpolation (shortest-arc for angles, exactly as
// replay does it) between its neighbours reproduces every dropped sample within
// `tol` quanta. Static entities cost nothing after their first sample; a moving
// entity gets a forced keyframe at least every `keyframeEvery` ticks.
import { hashOf, stableStringify } from '../core/hash.ts';
import { DT, type Runtime, type RuntimeObserver } from '../runtime/runtime.ts';
import type { Entity } from '../world/types.ts';
import { ANG_Q, POS_Q, TAKE_SCHEMA, type ChangeEvent, type PoseSample, type Take, type TakeEvent } from './types.ts';
import { interpSample } from './replay.ts';

export type RecorderOptions = {
  planHash?: string;
  baselineCheckpoint?: string;
  rulesVersion: string;
  keyframeEvery?: number;
  /** Simplification tolerance in quanta (mm / mrad). 0 keeps every changed sample. */
  tol?: number;
};

const FIELDS: [string, (e: Entity) => unknown][] = [
  ['activity', (e) => e.human?.activity],
  ['level', (e) => e.human?.level],
  ['task', (e) => e.human?.task],
  ['grip', (e) => e.human?.grip],
  ['phase', (e) => e.phase],
  ['support', (e) => e.support],
  ['reservedBy', (e) => e.reservedBy],
  ['connections', (e) => e.connections],
  ['equipment', (e) => e.equipment], // construction/solar.ts place_equipment (kind + config)
];

type TrackState = { committed: PoseSample; pending: PoseSample[]; out: PoseSample[] };

const q = (x: number, k: number) => Math.round(x * k) || 0;

export function quantize(e: Entity, t: number): PoseSample {
  const s = [t, q(e.pose.p[0], POS_Q), q(e.pose.p[1], POS_Q), q(e.pose.p[2], POS_Q), q(e.pose.yaw, ANG_Q)];
  const pitch = q(e.pose.pitch ?? 0, ANG_Q), roll = q(e.pose.roll ?? 0, ANG_Q);
  if (pitch || roll) s.push(pitch, roll);
  return s;
}

const sameValues = (a: PoseSample, b: PoseSample) => a.length === b.length && a.every((v, i) => i === 0 || v === b[i]);

export class TakeRecorder implements RuntimeObserver {
  readonly rt: Runtime;
  readonly opts: Required<Pick<RecorderOptions, 'keyframeEvery' | 'tol'>> & RecorderOptions;
  readonly startTick: number;
  readonly baselineStateHash: string;
  private tracks = new Map<string, TrackState>();
  private last = new Map<string, Map<string, string>>();
  private changes: ChangeEvent[] = [];
  private events: TakeEvent[] = [];
  private cursor: number;
  private finished = false;

  constructor(rt: Runtime, opts: RecorderOptions) {
    this.rt = rt;
    this.opts = { ...opts, keyframeEvery: opts.keyframeEvery ?? 20, tol: opts.tol ?? 1 };
    this.startTick = rt.tick;
    this.baselineStateHash = rt.stateHash();
    this.cursor = rt.events.length;
    this.sample();
    rt.observers.push(this);
  }

  onTick() {
    this.sample();
  }

  private sample() {
    const t = this.rt.tick - this.startTick;
    const ents = this.rt.world.entities;
    const ids = Object.keys(ents).sort();
    for (const id of ids) {
      const e = ents[id];
      const s = quantize(e, t);
      const tr = this.tracks.get(id);
      if (!tr) this.tracks.set(id, { committed: s, pending: [], out: [s] });
      else this.push(tr, s);
      let prev = this.last.get(id);
      if (!prev) {
        prev = new Map();
        this.last.set(id, prev);
        this.changes.push([t, id, 'present', true]);
      }
      for (const [f, get] of FIELDS) {
        const v = get(e);
        const k = v === undefined ? '' : stableStringify(v);
        if (prev.get(f) === k || (k === '' && !prev.has(f))) continue;
        prev.set(f, k);
        this.changes.push([t, id, f, v === undefined ? null : structuredClone(v)]);
      }
    }
    for (const id of [...this.last.keys()].sort())
      if (!ents[id]) {
        this.last.delete(id);
        const tr = this.tracks.get(id)!;
        this.flushTrack(tr);
        this.changes.push([t, id, 'present', false]);
      }
    for (; this.cursor < this.rt.events.length; this.cursor++) {
      const e = this.rt.events[this.cursor];
      const { tick, ...rest } = e;
      const ev = { t: tick - this.startTick, ...rest } as TakeEvent;
      if (ev.type === 'action' && ev.status !== 'failed' && ev.status !== 'blocked') delete ev.message;
      this.events.push(JSON.parse(JSON.stringify(ev)));
    }
  }

  private push(tr: TrackState, s: PoseSample) {
    // a re-sample within the same tick (finish() after cancellations) replaces that tick's sample
    if (tr.pending.length && tr.pending[tr.pending.length - 1][0] === s[0]) tr.pending.pop();
    else if (!tr.pending.length && tr.committed[0] === s[0]) {
      tr.out[tr.out.length - 1] = s;
      tr.committed = s;
      return;
    }
    const A = tr.committed;
    // static hold: nothing changed since the committed sample → remember only the latest hold point
    if (sameValues(s, A) && tr.pending.every((p) => sameValues(p, A))) {
      tr.pending = [s];
      return;
    }
    const span = s[0] - A[0];
    const fits = span <= this.opts.keyframeEvery && tr.pending.every((p) => withinTol(interpSample(A, s, p[0]), p, this.opts.tol));
    if (fits) {
      tr.pending.push(s);
      return;
    }
    const B = tr.pending[tr.pending.length - 1];
    if (B) {
      tr.out.push(B);
      tr.committed = B;
      tr.pending = [s];
    } else {
      tr.out.push(s);
      tr.committed = s;
      tr.pending = [];
    }
  }

  private flushTrack(tr: TrackState) {
    const B = tr.pending[tr.pending.length - 1];
    if (B && !sameValues(B, tr.committed)) {
      tr.out.push(B);
      tr.committed = B;
    }
    tr.pending = [];
  }

  /** Stop observing and produce the Take (content-addressed). */
  finish(): Take {
    if (this.finished) throw new Error('TakeRecorder.finish() called twice');
    this.finished = true;
    this.sample(); // catch events emitted after the last tick (e.g. cancellations)
    this.rt.observers = this.rt.observers.filter((o) => o !== this);
    const tracks: Record<string, PoseSample[]> = {};
    for (const id of [...this.tracks.keys()].sort()) {
      const tr = this.tracks.get(id)!;
      this.flushTrack(tr);
      tracks[id] = dedupeTicks(tr.out);
    }
    const finalState = structuredClone(this.rt.world);
    const body: Omit<Take, 'id'> = {
      schema: TAKE_SCHEMA,
      planHash: this.opts.planHash,
      baselineCheckpoint: this.opts.baselineCheckpoint,
      baselineStateHash: this.baselineStateHash,
      rulesVersion: this.opts.rulesVersion,
      dt: DT,
      startTick: this.startTick,
      ticks: this.rt.tick - this.startTick,
      keyframeEvery: this.opts.keyframeEvery,
      tracks,
      changes: dedupeChanges(this.changes),
      events: this.events,
      finalStateHash: hashOf(finalState),
      finalState,
    };
    return { ...stripUndefined(body), id: takeIdOf(body) } as Take;
  }
}

/** The take's content address (every field except `id`). */
export function takeIdOf(take: Omit<Take, 'id'> | Take): string {
  const { id: _id, ...body } = take as Take;
  return hashOf(body).slice(0, 24);
}

function withinTol(pred: PoseSample, actual: PoseSample, tol: number) {
  const n = Math.max(pred.length, actual.length);
  for (let i = 1; i < n; i++) {
    const a = actual[i] ?? 0, p = pred[i] ?? 0;
    if (Math.abs(i >= 4 ? angDiffQ(a, p) : a - p) > tol) return false;
  }
  return true;
}
function angDiffQ(a: number, b: number) {
  const full = Math.round(2 * Math.PI * ANG_Q);
  let d = (a - b) % full;
  if (d > full / 2) d -= full;
  if (d < -full / 2) d += full;
  return d;
}

/** The final sample at the take end may repeat a tick when an entity is removed on the last tick. */
function dedupeTicks(s: PoseSample[]) {
  return s.filter((x, i) => i === s.length - 1 || x[0] !== s[i + 1][0]);
}
/** Several changes of one field within a tick (e.g. from the final re-sample) collapse to the last. */
function dedupeChanges(cs: ChangeEvent[]) {
  const seen = new Set<string>();
  const out: ChangeEvent[] = [];
  for (let i = cs.length - 1; i >= 0; i--) {
    const k = `${cs[i][0]}|${cs[i][1]}|${cs[i][2]}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(cs[i]);
  }
  return out.reverse();
}
function stripUndefined<T extends object>(o: T): T {
  const out = { ...o } as Record<string, unknown>;
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out as T;
}
