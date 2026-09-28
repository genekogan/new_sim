// Replay: pure functions over a Take. Never imports the runtime, registry,
// planner or history — watching a take cannot reserve actors, mutate a room or
// re-plan anything (spec §22 replay isolation).
import { hashOf } from '../core/hash.ts';
import type { Vec3 } from '../core/math.ts';
import type { WorldState } from '../world/types.ts';
import { ANG_Q, INTERP_FIELDS, POS_Q, SPEED_Q, type ChangeEvent, type PoseSample, type Take, type TakeEvent } from './types.ts';

export type SampledEntity = {
  p: Vec3;
  yaw: number;
  pitch: number;
  roll: number;
  activity?: string;
  level?: number;
  phase?: string;
  /** Hand points (metres, world): the engine's human.hands at t, within 5.5 mm (mars-take/3 keyframes, interpolated
   *  also between ticks; absent = hands free, exact at its tick). */
  hands?: { left?: Vec3; right?: Vec3 };
  /** Ground speed (m/s) published by walk_to at t, within 1.5 cm/s (mars-take/3 keyframes, interpolated). */
  speed?: number;
  /** Other discrete fields (task, grip, support, reservedBy, connections, equipment, paint, baseActivity, on,
   *  contents) as last recorded. */
  state: Record<string, unknown>;
};

const fromMm = (v: number[] | undefined): Vec3 | undefined => (v ? [v[0] / POS_Q, v[1] / POS_Q, v[2] / POS_Q] : undefined);
export type TakeFrame = { t: number; tick: number; entities: Record<string, SampledEntity> };

const TWO_PI_Q = Math.round(2 * Math.PI * ANG_Q);

/** Shortest-arc difference b − a in quantised angle units. */
function arcQ(a: number, b: number) {
  let d = (b - a) % TWO_PI_Q;
  if (d > TWO_PI_Q / 2) d -= TWO_PI_Q;
  if (d < -TWO_PI_Q / 2) d += TWO_PI_Q;
  return d;
}

/** Interpolate two quantised samples at (fractional) tick t: linear positions, shortest-arc angles. */
export function interpSample(a: PoseSample, b: PoseSample, t: number): PoseSample {
  const span = b[0] - a[0];
  const u = span > 0 ? Math.min(1, Math.max(0, (t - a[0]) / span)) : 1;
  const n = Math.max(a.length, b.length);
  const out: PoseSample = [t];
  for (let i = 1; i < n; i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0;
    out.push(i >= 4 ? x + arcQ(x, y) * u : x + (y - x) * u);
  }
  return out;
}

function bracket(s: PoseSample[], tick: number): [PoseSample, PoseSample] | null {
  if (!s.length || tick < s[0][0]) return null;
  if (tick >= s[s.length - 1][0]) return [s[s.length - 1], s[s.length - 1]];
  let lo = 0, hi = s.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (s[mid][0] <= tick) lo = mid;
    else hi = mid;
  }
  return [s[lo], s[hi]];
}

const wrap = (a: number) => {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
};

/** A thinned field's value as numbers + a shape key (which hands are present); null = cleared. */
function fieldVec(field: string, v: unknown): { shape: string; v: number[] } | null {
  if (v === null || v === undefined) return null;
  if (field === 'speed') return typeof v === 'number' ? { shape: 's', v: [v] } : null;
  const h = v as { left?: number[]; right?: number[] };
  if (!h.left && !h.right) return null;
  return { shape: (h.left ? 'L' : '') + (h.right ? 'R' : ''), v: [...(h.left ?? []), ...(h.right ?? [])] };
}
function fromVec(field: string, shape: string, v: number[]): unknown {
  if (field === 'speed') return v[0];
  const out: { left?: number[]; right?: number[] } = {};
  let k = 0;
  if (shape.includes('L')) out.left = v.slice(k, (k += 3));
  if (shape.includes('R')) out.right = v.slice(k, (k += 3));
  return out;
}

/**
 * The value of an INTERP_FIELDS field at (fractional) `tick` between its keyframes a (at ta ≤ tick) and b (at tb > tick,
 * or none): linear when both are non-null and of the same shape, else a (held). Quantised units (mm, cm/s), floats.
 */
export function interpChange(field: string, a: unknown, ta: number, b: unknown, tb: number | undefined, tick: number): unknown {
  const A = fieldVec(field, a);
  if (!A) return null;
  const B = tb === undefined ? null : fieldVec(field, b);
  if (!B || B.shape !== A.shape || tick <= ta) return a;
  const u = tick >= tb! ? 1 : (tick - ta) / (tb! - ta);
  return fromVec(field, A.shape, A.v.map((x, i) => x + (B.v[i] - x) * u));
}

type FieldIndex = { t: number[]; v: unknown[] };
type ChangeIndex = Map<string, Map<string, FieldIndex>>;
// takes are immutable (TakeLibrary freezes them): one index per changes array
const INDEX = new WeakMap<ChangeEvent[], ChangeIndex>();
function changeIndex(take: Take): ChangeIndex {
  let ix = INDEX.get(take.changes);
  if (ix) return ix;
  ix = new Map();
  for (const [t, id, field, value] of take.changes) {
    let m = ix.get(id);
    if (!m) ix.set(id, (m = new Map()));
    let f = m.get(field);
    if (!f) m.set(field, (f = { t: [], v: [] }));
    f.t.push(t);
    f.v.push(value);
  }
  INDEX.set(take.changes, ix);
  return ix;
}
/** Index of the last entry with t ≤ tick (the last one of equal ticks), or -1. */
function lastAtOrBefore(ts: number[], tick: number) {
  let lo = 0, hi = ts.length - 1;
  if (hi < 0 || ts[0] > tick) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ts[mid] <= tick) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Entity poses + discrete state at time t (seconds from take start). Entities not present at t are omitted. */
export function sampleTake(take: Take, t: number): TakeFrame {
  // round away float noise (162 * 0.05 / 0.05 = 161.99999…) so same-tick changes are included
  const tick = Math.min(Math.max(0, Math.round((t / take.dt) * 1e6) / 1e6), take.ticks);
  const ix = changeIndex(take);
  const entities: Record<string, SampledEntity> = {};
  for (const id of Object.keys(take.tracks)) {
    const fields = ix.get(id);
    if (!fields) continue;
    const st: Record<string, unknown> = {};
    for (const [field, f] of fields) {
      const k = lastAtOrBefore(f.t, tick);
      if (k < 0) continue;
      st[field] = field in INTERP_FIELDS ? interpChange(field, f.v[k], f.t[k], f.v[k + 1], f.t[k + 1], tick) : f.v[k];
    }
    if (st.present !== true) continue;
    const br = bracket(take.tracks[id], tick);
    if (!br) continue;
    const s = interpSample(br[0], br[1], tick);
    const { present: _p, activity, level, phase, hands, speed, ...rest } = st;
    const e: SampledEntity = {
      p: [s[1] / POS_Q, s[2] / POS_Q, s[3] / POS_Q],
      yaw: wrap(s[4] / ANG_Q),
      pitch: (s[5] ?? 0) / ANG_Q,
      roll: (s[6] ?? 0) / ANG_Q,
      state: structuredClone(rest),
    };
    if (typeof activity === 'string') e.activity = activity;
    if (typeof level === 'number') e.level = level;
    if (typeof phase === 'string') e.phase = phase;
    if (hands && typeof hands === 'object') {
      const h = hands as { left?: number[]; right?: number[] };
      e.hands = { ...(h.left ? { left: fromMm(h.left) } : {}), ...(h.right ? { right: fromMm(h.right) } : {}) };
    }
    if (typeof speed === 'number') e.speed = speed / SPEED_Q;
    entities[id] = e;
  }
  return { t, tick, entities };
}

export const takeDuration = (take: Take) => take.ticks * take.dt;

/** Runtime events with t0 ≤ time < t1 (seconds). */
export function takeEvents(take: Take, t0 = 0, t1 = Infinity): TakeEvent[] {
  return take.events.filter((e) => e.t * take.dt >= t0 && e.t * take.dt < t1).map((e) => structuredClone(e));
}

/** The recorded successor state (a fresh copy). Verifies it against the recorded hash. */
export function replayFinalState(take: Take): WorldState {
  const s = structuredClone(take.finalState);
  const h = hashOf(s);
  if (h !== take.finalStateHash) throw new Error(`take ${take.id} is corrupt: final state hashes to ${h}, recorded ${take.finalStateHash}`);
  return s;
}
