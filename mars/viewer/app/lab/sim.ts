// Browser driver for the deterministic engine: one Runtime per scenario run,
// fixed-DT stepping from a real-time accumulator, per-tick cost stats and a
// human-readable action/diagnostic log.
import { DT, type Runtime, type RuntimeEvent } from '../../engine/runtime/runtime.ts';
import { TERMINAL } from '../../engine/actions/types.ts';
import type { Route } from '../../engine/spatial/path.ts';
import { buildRuntime, scenarioByName, SCENARIOS, type Check, type Scenario } from './scenarios.ts';

/** Live walk_to routes. Runtime keeps execution state private; this read-only debug access is the only such use (README). */
export function liveRoutes(rt: Runtime): { id: string; actor: string; route: Route; leg: number }[] {
  const live = (rt as unknown as { live: Map<string, { exec: { actor?: string; route?: Route; leg?: number } }> }).live;
  if (!(live instanceof Map)) return [];
  return [...live.entries()].filter(([, l]) => l.exec?.route).map(([id, l]) => ({ id, actor: l.exec.actor!, route: l.exec.route!, leg: l.exec.leg ?? 0 }));
}

export type LogLine = { tick: number; level: 'info' | 'warn' | 'error'; text: string };

export class LabSim {
  scenario: Scenario = SCENARIOS[0];
  rt!: Runtime;
  log: LogLine[] = [];
  /** Blocked waits, failures and violations only (kept longer than the log; sequence HUD). */
  diagnostics: LogLine[] = [];
  paused = false;
  speed = 1;
  /** Changes on every successful world load, including same-id/same-tick resets. */
  scenarioEpoch = 0;
  private acc = 0;
  private costs: number[] = [];
  onTick: (rt: Runtime) => void = () => {};
  onReset: (rt: Runtime) => void = () => {};

  /** load() after the scenario's async prepare() (fetched scene files); plain load() for the rest. */
  async loadAsync(name: string) {
    await scenarioByName(name)?.prepare?.();
    this.load(name);
  }

  load(name: string) {
    const s = scenarioByName(name);
    if (!s) throw Error(`unknown scenario "${name}" (have ${SCENARIOS.map((x) => x.name).join(', ')})`);
    this.scenario = s;
    this.rt = buildRuntime(s);
    this.scenarioEpoch++;
    this.log = [{ tick: 0, level: 'info', text: `scenario ${s.name}: ${s.description}` }];
    this.diagnostics = [];
    this.costs = [];
    this.routes.clear();
    this.acc = 0;
    this.rt.observers.push({ onEvent: (_rt, e) => this.record(e) });
    this.onReset(this.rt);
    const refusal = s.admission?.(this.rt);
    if (refusal) {
      const line: LogLine = { tick: 0, level: 'warn', text: `${refusal.code}: ${refusal.message}` };
      this.log.push(line);
      this.diagnostics.push(line);
    } else s.start(this.rt);
    // violations are pushed to rt.events without an observer callback
    this.seen = this.rt.events.length;
    this.harvest();
  }

  private seen = 0;
  private harvest() {
    for (; this.seen < this.rt.events.length; this.seen++) {
      const e = this.rt.events[this.seen];
      if (e.type === 'violation') this.record(e);
    }
  }

  private record(e: RuntimeEvent) {
    let line: LogLine;
    if (e.type === 'action') {
      const level = e.status === 'failed' ? 'error' : e.status === 'blocked' ? 'warn' : 'info';
      if (['requested', 'validated', 'reserved'].includes(e.status) && (this.scenario.continuous || this.scenario.done)) return;
      line = { tick: e.tick, level, text: `${e.id} ${e.verb} → ${e.status}${e.phase ? ` [${e.phase}]` : ''}${e.code ? ` ${e.code}` : ''}${e.message ? `: ${e.message}` : ''}` };
    } else if (e.type === 'violation') line = { tick: e.tick, level: 'error', text: `VIOLATION ${e.code}: ${e.message}` };
    else line = { tick: e.tick, level: 'info', text: `mark ${e.name} ${e.data ? JSON.stringify(e.data) : ''}` };
    this.log.push(line);
    if (line.level !== 'info') this.diagnostics.push(line);
    if (this.log.length > 600) this.log.splice(1, this.log.length - 500);
    if (this.diagnostics.length > 400) this.diagnostics.splice(0, 100);
  }

  /** One authoritative tick + scenario script, timed. */
  step() {
    const t0 = performance.now();
    this.rt.step();
    this.scenario.tick?.(this.rt);
    this.costs.push(performance.now() - t0);
    if (this.costs.length > 2000) this.costs.splice(0, 1000);
    this.harvest();
    this.watchRoutes();
    this.onTick(this.rt);
  }

  private routes = new Map<string, Route>();
  /** The runtime emits no event when walk_to replans; surface it by watching route identity. */
  private watchRoutes() {
    const seen = new Set<string>();
    for (const { id, actor, route } of liveRoutes(this.rt)) {
      seen.add(id);
      const old = this.routes.get(id);
      if (old && old !== route) this.log.push({ tick: this.rt.tick, level: 'warn', text: `${id} walk_to REPLANNED for ${actor}: route ${old.length.toFixed(1)} m → ${route.length.toFixed(1)} m (${route.legs.length} legs)` });
      this.routes.set(id, route);
    }
    for (const id of this.routes.keys()) if (!seen.has(id)) this.routes.delete(id);
  }

  stepN(n: number) {
    for (let i = 0; i < n && !this.overBudget(); i++) this.step();
  }

  /** Advance by real elapsed seconds; returns interpolation alpha for rendering. */
  advance(seconds: number, maxSteps = 40) {
    if (!this.paused && !this.done()) {
      this.acc += Math.min(seconds, 0.25) * this.speed;
      let n = 0;
      while (this.acc >= DT && n++ < maxSteps) {
        this.step();
        this.acc -= DT;
      }
      if (n > maxSteps) this.acc = 0;
    }
    return this.paused || this.done() ? 1 : Math.min(1, this.acc / DT);
  }

  pending() {
    if (this.scenario.done) return !this.scenario.done(this.rt);
    return [...this.rt.records.values()].some((r) => !TERMINAL.has(r.status));
  }
  overBudget() {
    return this.rt.tick >= this.scenario.maxTicks;
  }
  /** Finished: all actions terminal (or tick budget exhausted); continuous scenarios run until the budget. */
  done() {
    return this.scenario.continuous ? this.overBudget() : !this.pending() || this.overBudget();
  }

  checks(): Check[] {
    const c = this.scenario.expect(this.rt);
    if (!this.scenario.continuous && this.pending()) c.unshift({ ok: false, message: `still running at tick ${this.rt.tick}` });
    return c;
  }

  stats() {
    const s = [...this.costs].sort((a, b) => a - b);
    const q = (f: number) => (s.length ? s[Math.min(s.length - 1, Math.floor(f * s.length))] : 0);
    const mean = s.length ? s.reduce((a, b) => a + b, 0) / s.length : 0;
    return { ticks: s.length, meanMs: +mean.toFixed(4), p50Ms: +q(0.5).toFixed(4), p95Ms: +q(0.95).toFixed(4), maxMs: +q(1).toFixed(3) };
  }
}
