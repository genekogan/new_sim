// Movement-quality metrics over a take or a live runtime (owner feedback 2026-09-28 §3).
//
// "Walk stalls": ticks in which a person's recorded activity is 'walk' but their ground speed
// (horizontal displacement since the previous tick / dt) is below 0.05 m/s — someone playing the Walk
// clip while pushing against something or standing still. The target is ~0 on every scenario.
// Pure functions over the take format (tracks + discrete changes), plus an equivalent observer that
// measures a runtime tick by tick without recording a take. Measurement only: never mutates state.
import { DT, type Runtime, type RuntimeObserver } from '../runtime/runtime.ts';
import { POS_Q, type Take } from './types.ts';

export const STALL_SPEED = 0.05; // m/s

export type StallReport = {
  /** Ticks examined (take ticks, or runtime ticks observed). */
  ticks: number;
  /** Person-ticks with activity 'walk' (the denominator). */
  walkTicks: number;
  /** Person-ticks with activity 'walk' and ground speed < STALL_SPEED. */
  stalls: number;
  byActor: Record<string, number>;
  /** The first few stalls, for diagnostics: [tick, actor, speed m/s]. */
  first: [number, string, number][];
};

const empty = (): StallReport => ({ ticks: 0, walkTicks: 0, stalls: 0, byActor: {}, first: [] });

function count(r: StallReport, tick: number, id: string, speed: number, threshold: number) {
  r.walkTicks++;
  if (speed >= threshold) return;
  r.stalls++;
  r.byActor[id] = (r.byActor[id] ?? 0) + 1;
  if (r.first.length < 20) r.first.push([tick, id, Math.round(speed * 1000) / 1000]);
}

/**
 * Walk stalls of a recorded take. Positions are the take's quantised tracks (1 mm), interpolated
 * between stored samples exactly as replay does; the activity is the value recorded at or before the
 * tick. `threshold` is compared against displacement/dt, so the 1 mm quantum means ±0.028 m/s noise.
 */
export function walkStallsOfTake(take: Take, threshold = STALL_SPEED): StallReport {
  const r = empty();
  r.ticks = take.ticks;
  const activity = new Map<string, unknown>();
  let ci = 0;
  const cursor = new Map<string, number>();
  const posAt = (id: string, tick: number): [number, number] | null => {
    const s = take.tracks[id];
    if (!s?.length || tick < s[0][0]) return null;
    let k = cursor.get(id) ?? 0;
    while (k + 1 < s.length && s[k + 1][0] <= tick) k++;
    cursor.set(id, k);
    const a = s[k], b = s[k + 1];
    if (!b || a[0] === tick) return [a[1], a[3]];
    const u = (tick - a[0]) / (b[0] - a[0]);
    return [a[1] + (b[1] - a[1]) * u, a[3] + (b[3] - a[3]) * u];
  };
  const prev = new Map<string, [number, number]>();
  for (let tick = 0; tick <= take.ticks; tick++) {
    while (ci < take.changes.length && take.changes[ci][0] <= tick) {
      const [, id, field, value] = take.changes[ci++];
      if (field === 'activity') activity.set(id, value);
    }
    for (const [id, act] of activity) {
      const p = posAt(id, tick);
      if (!p) continue;
      const q = prev.get(id);
      prev.set(id, p);
      if (tick === 0 || !q || act !== 'walk') continue;
      const d = Math.sqrt((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2) / POS_Q;
      count(r, tick, id, d / take.dt, threshold);
    }
  }
  return r;
}

/** Live equivalent: attach before stepping; `report` accumulates every tick (unquantised positions). */
export function walkStallMeter(rt: Runtime, threshold = STALL_SPEED): { report: StallReport; detach: () => void } {
  const report = empty();
  const prev = new Map<string, [number, number]>();
  const snap = () => {
    for (const e of Object.values(rt.world.entities)) if (e.kind === 'human') prev.set(e.id, [e.pose.p[0], e.pose.p[2]]);
  };
  snap();
  const obs: RuntimeObserver = {
    onTick(r: Runtime) {
      report.ticks++;
      for (const e of Object.values(r.world.entities)) {
        if (e.kind !== 'human' || e.human?.activity !== 'walk') continue;
        const q = prev.get(e.id);
        if (!q) continue;
        const d = Math.sqrt((e.pose.p[0] - q[0]) ** 2 + (e.pose.p[2] - q[1]) ** 2);
        count(report, r.tick, e.id, d / DT, threshold);
      }
      snap();
    },
  };
  rt.observers.push(obs);
  return { report, detach: () => { const i = rt.observers.indexOf(obs); if (i >= 0) rt.observers.splice(i, 1); } };
}
