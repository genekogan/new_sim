// Replay: pure functions over a Take. Never imports the runtime, registry,
// planner or history — watching a take cannot reserve actors, mutate a room or
// re-plan anything (spec §22 replay isolation).
import { hashOf } from '../core/hash.ts';
import type { Vec3 } from '../core/math.ts';
import type { WorldState } from '../world/types.ts';
import { ANG_Q, POS_Q, type PoseSample, type Take, type TakeEvent } from './types.ts';

export type SampledEntity = {
  p: Vec3;
  yaw: number;
  pitch: number;
  roll: number;
  activity?: string;
  level?: number;
  phase?: string;
  /** Other discrete fields (task, grip, support, reservedBy, connections) as last recorded. */
  state: Record<string, unknown>;
};
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

/** Entity poses + discrete state at time t (seconds from take start). Entities not present at t are omitted. */
export function sampleTake(take: Take, t: number): TakeFrame {
  const tick = Math.min(Math.max(0, t / take.dt), take.ticks);
  const discrete = new Map<string, Record<string, unknown>>();
  for (const [ct, id, field, value] of take.changes) {
    if (ct > tick) break;
    let m = discrete.get(id);
    if (!m) discrete.set(id, (m = {}));
    m[field] = value;
  }
  const entities: Record<string, SampledEntity> = {};
  for (const id of Object.keys(take.tracks)) {
    const st = discrete.get(id);
    if (!st || st.present !== true) continue;
    const br = bracket(take.tracks[id], tick);
    if (!br) continue;
    const s = interpSample(br[0], br[1], tick);
    const { present: _p, activity, level, phase, ...rest } = st;
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
