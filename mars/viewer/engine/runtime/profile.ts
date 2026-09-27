// Opt-in wall-clock profiler (`rt.profile = true`). Measurement only: nothing
// in the simulation reads these numbers, so determinism is unaffected. The
// clock is the host's `performance.now()` (the one sanctioned wall-clock read
// in engine code, and only while profiling is switched on).
export type ProfileStat = { calls: number; ms: number; max: number };

const hostNow = (): number => (globalThis as { performance?: { now(): number } }).performance?.now() ?? 0;

export class Profiler {
  readonly stats = new Map<string, ProfileStat>();
  now: () => number;
  constructor(now: () => number = hostNow) {
    this.now = now;
  }

  add(key: string, ms: number) {
    const s = this.stats.get(key);
    if (s) {
      s.calls++;
      s.ms += ms;
      if (ms > s.max) s.max = ms;
    } else this.stats.set(key, { calls: 1, ms, max: ms });
  }

  time<T>(key: string, fn: () => T): T {
    const t0 = this.now();
    try {
      return fn();
    } finally {
      this.add(key, this.now() - t0);
    }
  }

  /** Rows sorted by total ms, descending. Keys nest (spatial.route includes its spatial.sync). */
  report(): ({ key: string } & ProfileStat)[] {
    return [...this.stats].map(([key, s]) => ({ key, ...s })).sort((a, b) => b.ms - a.ms || (a.key < b.key ? -1 : 1));
  }

  reset() {
    this.stats.clear();
  }
}
