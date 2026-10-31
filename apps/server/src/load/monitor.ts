// LOAD-CONTRACT §1: the in-world load sensor. Samples every 250 ms on the main thread (cheap: a few reads, one sort of
// <= 400 tick times), decides the level with hysteresis, publishes the numbers into the shared array the watchdog
// thread reads (shared.ts), and tells the registered dials the level. It only sets levels; every dial lives in the file
// that owns the cost and documents its own green/amber/red/black values.
import {monitorEventLoopDelay, PerformanceObserver, type IntervalHistogram} from 'node:perf_hooks';
import v8 from 'node:v8';
import {LEVELS, S, sharedLoad, type Level} from './shared.ts';

export type Signals = {service: number; loopP99Ms: number; heapFrac: number; gcFrac: number; oldestMs: number};
const RANK: Record<Level, number> = {green: 0, amber: 1, red: 2, black: 3};
export const STEP_DOWN_MS = 30_000, BLACK_SERVICE_MS = 30_000;

/** Enter on any condition; step down one level after 30 s with every signal below the current level's lower band. */
export class LevelState {
  level: Level = 'green';
  private calmSince: number | null = null;
  private starvedSince: number | null = null;   // tick service < 0.2 since
  enterOf(s: Signals, now: number): Level {
    if (s.service < 0.2) this.starvedSince ??= now; else this.starvedSince = null;
    if ((s.heapFrac > 0.92 && s.gcFrac > 0.40) || (this.starvedSince !== null && now - this.starvedSince >= BLACK_SERVICE_MS)) return 'black';
    if (s.service < 0.5 || s.loopP99Ms > 1000 || s.heapFrac > 0.85 || s.oldestMs > 6000) return 'red';
    if (s.service < 0.8 || s.loopP99Ms > 200 || s.heapFrac > 0.70 || s.oldestMs > 2000) return 'amber';
    return 'green';
  }
  static below(level: Level, s: Signals): boolean {
    switch (level) {
      case 'black': return s.service >= 0.4 && s.heapFrac < 0.85;
      case 'red': return s.service >= 0.7 && s.loopP99Ms < 400 && s.heapFrac < 0.75 && s.oldestMs < 3000;
      case 'amber': return s.service >= 0.9 && s.loopP99Ms < 100 && s.heapFrac < 0.60 && s.oldestMs < 1000;
      default: return true;
    }
  }
  update(s: Signals, now: number): Level {
    const enter = this.enterOf(s, now);
    if (RANK[enter] > RANK[this.level]) { this.level = enter; this.calmSince = null; return this.level; }
    if (this.level === 'green' || !LevelState.below(this.level, s)) { this.calmSince = null; return this.level; }
    this.calmSince ??= now;
    if (now - this.calmSince >= STEP_DOWN_MS) { this.level = LEVELS[RANK[this.level] - 1]; this.calmSince = null; }
    return this.level;
  }
}

/** What the monitor reads from the world (WorldHost satisfies it). */
export type HostLike = {engine: {world: {tick: number}}; tickMs: number[]; paused: boolean; pace: number; baseRate: number; readonly running: boolean; readonly clockAvailable: boolean};
export type Dial = (level: Level) => void;
export type MonitorOpts = {
  host: HostLike;
  queue?: () => {depth: number; oldestMs: number};
  shed?: () => {reads: number; acts: number};
  souls?: () => {awake: number; waiting: number; connected: number};
  onLevel?: (from: Level, to: Level, s: Signals) => void;
  /** Black for this long → planned restart (main.ts: snapshot, exit 75). */
  onBlackTooLong?: () => void; blackLimitMs?: number;
  shared?: Float64Array; now?: () => number; sampleMs?: number;
};

const TICK_MS = 50;
export class LoadMonitor {
  readonly state = new LevelState();
  get level(): Level { return this.state.level; }
  signals: Signals = {service: 1, loopP99Ms: 0, heapFrac: 0, gcFrac: 0, oldestMs: 0};
  tickStats = {avg: 0, max: 0, n: 0, p99: 0};
  private dials = new Map<string, Dial>();
  private hist: IntervalHistogram | null = null;
  private prevLoopP99 = 0;
  private histAt = 0;
  private gc: {at: number; ms: number}[] = [];
  private obs: PerformanceObserver | null = null;
  private ticks: {at: number; tick: number; due: number}[] = [];   // due = ticks owed since the previous sample
  private timer: NodeJS.Timeout | null = null;
  private blackSince: number | null = null;
  private soulsAt = 0;
  private souls = {awake: 0, waiting: 0, connected: 0};
  private a: Float64Array;
  private now: () => number;
  private o: MonitorOpts;
  constructor(o: MonitorOpts) { this.o = o; this.a = o.shared ?? sharedLoad; this.now = o.now ?? Date.now; }

  /** The dial registry (LOAD-CONTRACT §1). A dial is told the current level at once and on every change. */
  register(name: string, dial: Dial) { this.dials.set(name, dial); try { dial(this.level); } catch (e) { console.error(`[load] dial ${name} failed`, e); } }
  start() {
    if (this.timer) return;
    this.hist = monitorEventLoopDelay({resolution: 10}); this.hist.enable(); this.histAt = this.now();
    try { this.obs = new PerformanceObserver(list => { for (const e of list.getEntries()) this.gc.push({at: this.now(), ms: e.duration}); }); this.obs.observe({entryTypes: ['gc']}); } catch { this.obs = null; }
    this.timer = setInterval(() => this.sample(), this.o.sampleMs ?? 250); this.timer.unref();
    this.sample();
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; this.hist?.disable(); this.obs?.disconnect(); }

  /** One sample: read, decide, publish. Public for tests (which pass signals straight to state.update instead). */
  sample(): Level {
    const now = this.now(), h = this.o.host, a = this.a;
    a[S.lastTurnAt] = now;
    // tick service over 5 s: ticks run / ticks owed at the admin rate and the attention pace (dilation counts as missed)
    const prev = this.ticks.at(-1), owing = h.running && !h.paused && h.clockAvailable;
    const due = prev && owing ? (Math.min(1000, now - prev.at) * h.baseRate * h.pace) / TICK_MS : 0;
    this.ticks.push({at: now, tick: h.engine.world.tick, due});
    while (this.ticks.length > 2 && now - this.ticks[1].at > 5000) this.ticks.shift();
    let owed = 0; for (let i = 1; i < this.ticks.length; i++) owed += this.ticks[i].due;
    const ran = this.ticks.at(-1)!.tick - this.ticks[0].tick;
    const service = owed >= 2 ? Math.min(1, ran / owed) : 1;
    // event-loop delay p99 over the last ~5 s (two rotating windows)
    let loopP99 = this.prevLoopP99;
    if (this.hist) {
      if (this.hist.count > 0) loopP99 = Math.max(loopP99, this.hist.percentile(99) / 1e6);
      if (now - this.histAt >= 5000) { this.prevLoopP99 = this.hist.count > 0 ? this.hist.percentile(99) / 1e6 : 0; this.hist.reset(); this.histAt = now; }
    }
    const hs = v8.getHeapStatistics(), heapFrac = hs.heap_size_limit ? hs.used_heap_size / hs.heap_size_limit : 0;
    while (this.gc.length && now - this.gc[0].at > 10_000) this.gc.shift();
    let gcMs = 0; for (const g of this.gc) gcMs += g.ms;
    const q = this.o.queue?.() ?? {depth: 0, oldestMs: 0};
    this.signals = {service, loopP99Ms: loopP99, heapFrac, gcFrac: gcMs / 10_000, oldestMs: q.oldestMs};
    // tick times (the last ~20 s, as /healthz has always reported them)
    const ms = h.tickMs; let sum = 0, max = 0; for (const x of ms) { sum += x; if (x > max) max = x; }
    const sorted = ms.length ? [...ms].sort((x, y) => x - y) : [];
    this.tickStats = {avg: ms.length ? Math.round(10 * sum / ms.length) / 10 : 0, max: Math.round(10 * max) / 10, n: ms.length, p99: sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(0.99 * sorted.length))] : 0};
    if (this.o.souls && now - this.soulsAt >= 2000) { this.soulsAt = now; try { this.souls = this.o.souls(); } catch { /* presence is best effort */ } }
    const from = this.level, to = this.state.update(this.signals, now);
    if (to !== from) this.changed(from, to);
    if (to === 'black') {
      this.blackSince ??= now;
      if (now - this.blackSince >= (this.o.blackLimitMs ?? 60_000)) { this.blackSince = null; try { this.o.onBlackTooLong?.(); } catch (e) { console.error('[load] planned restart failed', e); } }
    } else this.blackSince = null;
    const shed = this.o.shed?.() ?? {reads: 0, acts: 0};
    a[S.worldTick] = h.engine.world.tick; a[S.service5s] = service; a[S.tickP99Ms] = this.tickStats.p99; a[S.loopP99Ms] = loopP99;
    a[S.heapUsedMb] = hs.used_heap_size / 1048576; a[S.heapLimitMb] = hs.heap_size_limit / 1048576; a[S.gcPct10s] = 100 * gcMs / 10_000;
    a[S.level] = LEVELS.indexOf(to); a[S.queueDepth] = q.depth; a[S.queueOldestMs] = q.oldestMs;
    a[S.awake] = this.souls.awake; a[S.waiting] = this.souls.waiting; a[S.connected] = this.souls.connected;
    a[S.shedReads] = shed.reads; a[S.shedActs] = shed.acts; a[S.sampledAt] = now;
    return to;
  }
  /** Mark a main-thread turn without a full sample (after a tick). */
  turn() { this.a[S.lastTurnAt] = this.now(); }
  private changed(from: Level, to: Level) {
    const s = this.signals;
    console.log(`[load] ${from}→${to}: service ${s.service.toFixed(2)}, loop p99 ${Math.round(s.loopP99Ms)} ms, heap ${Math.round(100 * s.heapFrac)}%, gc ${Math.round(100 * s.gcFrac)}%, queue ${(s.oldestMs / 1000).toFixed(1)} s`);
    this.o.onLevel?.(from, to, s);
    for (const [name, dial] of this.dials) { try { dial(to); } catch (e) { console.error(`[load] dial ${name} failed`, e); } }
  }
  /** The /healthz `load` block: O(1), from the last sample. */
  health() {
    const s = this.signals;
    return {level: this.level, service5s: Math.round(100 * s.service) / 100, loopP99Ms: Math.round(s.loopP99Ms), heapPct: Math.round(100 * s.heapFrac), gcPct10s: Math.round(100 * s.gcFrac),
      tickP99Ms: Math.round(10 * this.tickStats.p99) / 10, queue: this.o.queue?.() ?? {depth: 0, oldestMs: 0}, souls: this.souls};
  }
}
