// TakeRecorder: a RuntimeObserver that captures a compact Take.
// Pose tracks are quantised (1 mm / 1 mrad) and simplified online: a sample
// is dropped when linear interpolation (shortest-arc for angles, exactly as
// replay does it) between its neighbours reproduces every dropped sample within
// `tol` quanta. Static entities cost nothing after their first sample; a moving
// entity gets a forced keyframe at least every `keyframeEvery` ticks.
// mars-take/3: the `hands` / `speed` changes (INTERP_FIELDS) are thinned the same way when the take is finished
// (`thinChanges`): keyframes, linear in between, each recorded tick reproduced within the field's tolerance.
import { hashOf, stableStringify } from '../core/hash.ts';
import { DT, type Runtime, type RuntimeObserver } from '../runtime/runtime.ts';
import type { Entity } from '../world/types.ts';
import { ANG_Q, INTERP_FIELDS, POS_Q, SPEED_Q, TAKE_SCHEMA, type ChangeEvent, type PoseSample, type Take, type TakeEvent, type TakeHands } from './types.ts';
import { interpSample } from './replay.ts';

export type RecorderOptions = {
  planHash?: string;
  baselineCheckpoint?: string;
  rulesVersion: string;
  keyframeEvery?: number;
  /** Simplification tolerance in quanta (mm / mrad). 0 keeps every changed sample. */
  tol?: number;
  /** Tolerances of the thinned change fields (quanta; default INTERP_FIELDS: hands 5 mm, speed 1 cm/s). 0 = exact. */
  fieldTol?: Record<string, number>;
};

type TrackState = { committed: PoseSample; pending: PoseSample[]; out: PoseSample[] };

const q = (x: number, k: number) => Math.round(x * k) || 0;
const mm = (v: readonly number[]) => [q(v[0], POS_Q), q(v[1], POS_Q), q(v[2], POS_Q)];

/** Hand points quantised like pose tracks: integer millimetres, `{ left?: [x, y, z], right?: [x, y, z] }` (TakeHands). */
function takeHands(e: Entity): TakeHands | undefined {
  const h = e.human?.hands;
  if (!h || (!h.left && !h.right)) return undefined;
  return { ...(h.left ? { left: mm(h.left) } : {}), ...(h.right ? { right: mm(h.right) } : {}) } as TakeHands;
}

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
  ['paint', (e) => e.paint], // work/paint.ts: colour / texture, coverage (0.01 steps), per band
  // mars-take/2 (BODY_MODEL.md "take fields"): what a replay needs to pose people exactly as the engine did
  ['hands', takeHands], // human.hands, integer mm (hand-up, items, eating, paint)
  ['baseActivity', (e) => e.human?.baseActivity], // the activity an overlay (eat) is layered on: 'sit' = seated
  ['on', (e) => e.human?.on], // the rack link (beam:… / climb:…) someone stands on
  ['speed', (e) => (e.human?.speed === undefined ? undefined : q(e.human.speed, SPEED_Q))], // integer cm/s (walk_to)
  ['contents', (e) => e.contents], // bowl / pot / cup fill (items)
];

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
      changes: thinChanges(dedupeChanges(this.changes), { ...INTERP_FIELDS, ...this.opts.fieldTol }),
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

/** Longest run of recorded points one keyframe pair may cover (bounds the simplifier's work per point). */
const THIN_MAX_PENDING = 256;

type Pt = { t: number; v: number[]; value: unknown };
const vecOf = (field: string, v: unknown): { shape: string; v: number[] } | null => {
  if (v === null || v === undefined) return null;
  if (field === 'speed') return typeof v === 'number' ? { shape: 's', v: [v] } : null;
  const h = v as { left?: number[]; right?: number[] };
  if (!h.left && !h.right) return null;
  return { shape: (h.left ? 'L' : '') + (h.right ? 'R' : ''), v: [...(h.left ?? []), ...(h.right ?? [])] };
};
/** Does the line A→B reproduce the recorded point p within eps? Per 3-vector (a hand point) Euclidean, a scalar
 *  absolute. Same arithmetic as `interpChange` (x + (y − x)·u), so the check is what sampleTake will return. */
function fits(A: Pt, B: Pt, p: Pt, eps: number): boolean {
  const u = (p.t - A.t) / (B.t - A.t);
  const n = p.v.length;
  if (n < 3) return Math.abs(A.v[0] + (B.v[0] - A.v[0]) * u - p.v[0]) <= eps;
  for (let i = 0; i + 2 < n; i += 3) {
    const dx = A.v[i] + (B.v[i] - A.v[i]) * u - p.v[i];
    const dy = A.v[i + 1] + (B.v[i + 1] - A.v[i + 1]) * u - p.v[i + 1];
    const dz = A.v[i + 2] + (B.v[i + 2] - A.v[i + 2]) * u - p.v[i + 2];
    if (dx * dx + dy * dy + dz * dz > eps * eps) return false;
  }
  return true;
}

/**
 * mars-take/3 thinning of the INTERP_FIELDS changes (`tol`: field → quanta). Per entity and field the recorded changes
 * are a step signal (a value holds until the next change); it is split into runs of one shape (the same hands present)
 * and each run is simplified like a pose track: a point is dropped when linear interpolation between the kept
 * neighbours (`interpChange`, exactly as sampleTake does it) reproduces it within `tol`. A hold contributes its first
 * and last tick (the error of a line against a constant is largest at the ends, so every tick of it is covered).
 * Clearing (null) and shape changes are kept at their exact tick. Other fields pass through unchanged, in order;
 * added keyframes (a hold's last tick) are placed after the other changes of their tick.
 */
export function thinChanges(changes: ChangeEvent[], tol: Record<string, number>): ChangeEvent[] {
  const series = new Map<string, ChangeEvent[]>();
  const rest: ChangeEvent[] = [];
  for (const c of changes) {
    if (!(c[2] in tol)) { rest.push(c); continue; }
    const k = `${c[1]}\u0000${c[2]}`;
    const l = series.get(k);
    if (l) l.push(c); else series.set(k, [c]);
  }
  const kept: ChangeEvent[] = [];
  for (const l of series.values()) {
    const [, id, field] = l[0];
    const eps = tol[field];
    let run: Pt[] = [];
    let shape = '';
    const flush = () => {
      if (!run.length) return;
      let A = run[0];
      kept.push([A.t, id, field, A.value]);
      let pending: Pt[] = [];
      for (let i = 1; i < run.length; i++) {
        const s = run[i];
        if (pending.length < THIN_MAX_PENDING && pending.every((p) => fits(A, s, p, eps))) { pending.push(s); continue; }
        const B = pending[pending.length - 1];
        if (B) {
          kept.push([B.t, id, field, B.value]);
          A = B;
          pending = [s];
        } else {
          kept.push([s.t, id, field, s.value]);
          A = s;
        }
      }
      const B = pending[pending.length - 1];
      if (B) kept.push([B.t, id, field, B.value]);
      run = [];
    };
    for (let i = 0; i < l.length; i++) {
      const [t, , , value] = l[i];
      const v = vecOf(field, value);
      if (!v || v.shape !== shape) flush();
      if (!v) { kept.push(l[i]); shape = ''; continue; }
      shape = v.shape;
      run.push({ t, v: v.v, value });
      // the hold's last tick, when the next change continues this run later (a line must not smear the hold; at a
      // run's end sampleTake holds the last keyframe anyway)
      const n = l[i + 1];
      if (n && n[0] - 1 > t && vecOf(field, n[3])?.shape === shape) run.push({ t: n[0] - 1, v: v.v, value: structuredClone(value) });
    }
    flush();
  }
  // stable by tick: the other fields keep their order, thinned keyframes follow them within a tick
  const out: ChangeEvent[] = [];
  kept.sort((a, b) => a[0] - b[0]);
  let j = 0;
  for (let i = 0; i < rest.length; i++) {
    while (j < kept.length && kept[j][0] < rest[i][0]) out.push(kept[j++]);
    out.push(rest[i]);
  }
  while (j < kept.length) out.push(kept[j++]);
  return out;
}
