// Browser driver for the deterministic engine: one Runtime per scenario run,
// fixed-DT stepping from a real-time accumulator, per-tick cost stats and a
// human-readable action/diagnostic log.
import { DT, type Runtime, type RuntimeEvent } from '../../engine/runtime/runtime.ts';
import type { Diagnostic } from '../../engine/actions/types.ts';
import { TERMINAL } from '../../engine/actions/types.ts';
import type { Route } from '../../engine/spatial/path.ts';
import { buildRuntime, scenarioByName, SCENARIOS, type Check, type Scenario } from './scenarios.ts';

/** Live walk_to routes. Runtime keeps execution state private; this read-only debug access is the only such use (README). */
export function liveRoutes(rt: Runtime): { id: string; actor: string; route: Route; leg: number }[] {
  const live = (rt as unknown as { live: Map<string, { exec: { actor?: string; route?: Route; leg?: number } }> }).live;
  if (!(live instanceof Map)) return [];
  return [...live.entries()].filter(([, l]) => l.exec?.route).map(([id, l]) => ({ id, actor: l.exec.actor!, route: l.exec.route!, leg: l.exec.leg ?? 0 }));
}

export type ScriptResult = Readonly<{ tick: number; time: number; stateHash: string; reason: 'admission-refused' | 'terminal' | 'budget' }>;

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
  /** Invariant corruption or unexpected host/executor fault requires a fresh load. */
  halted: Diagnostic | null = null;
  scriptStopReason: 'admission-refused' | 'terminal' | 'budget' | null = null;
  /** Exact first authored stop boundary; ordinary world ticks continue afterward. */
  scriptResult: ScriptResult | null = null;
  private scriptFinished = false;
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
    // Build before publishing a new scenario/runtime pair; a failed builder preserves the old world.
    const nextRuntime = buildRuntime(s);
    this.scenario = s;
    this.rt = nextRuntime;
    this.scenarioEpoch++;
    this.log = [{ tick: 0, level: 'info', text: `scenario ${s.name}: ${s.description}` }];
    this.diagnostics = [];
    this.halted = null;
    this.scriptFinished = false;
    this.scriptStopReason = null;
    this.scriptResult = null;
    this.costs = [];
    this.routes.clear();
    this.acc = 0;
    this.rt.observers.push({ onEvent: (_rt, e) => this.record(e) });
    this.seen = 0;
    let phase = 'lab.onReset';
    try {
      this.onReset(this.rt);
      // A custom build may already have stepped; do not dispatch into recorded corruption.
      this.harvest();
      this.containViolations();
      if (this.halted) return;
      phase = 'scenario.admission';
      const refusal = s.admission?.(this.rt);
      if (refusal) {
        const line: LogLine = { tick: 0, level: 'warn', text: `${refusal.code}: ${refusal.message}` };
        this.log.push(line);
        this.diagnostics.push(line);
        this.scriptFinished = true;
        this.scriptStopReason = 'admission-refused';
        this.captureScriptResult();
      } else {
        phase = 'scenario.start';
        s.start(this.rt);
      }
      phase = 'scenario.done';
      this.finishScriptIfDone();
      // violations are pushed to rt.events without an observer callback
      this.harvest();
      this.containViolations();
    } catch (error) {
      this.containExecutorFault(phase, error);
    }
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

  private finishScriptIfDone() {
    if (this.scenario.execution === 'sustained') return;
    if (this.scriptFinished || !this.done()) return;
    this.scriptFinished = true;
    this.scriptStopReason = this.overBudget() ? 'budget' : 'terminal';
    this.captureScriptResult();
  }

  private captureScriptResult() {
    if (this.scriptResult || !this.scriptStopReason || this.halted || this.rt.violations.length) return;
    this.scriptResult = Object.freeze({ tick: this.rt.tick, time: this.rt.time, stateHash: this.rt.stateHash(), reason: this.scriptStopReason });
  }

  private containViolations() {
    if (this.halted || !this.rt.violations.length) return;
    this.scriptResult = null;
    const first = this.rt.violations[0];
    this.halted = {
      code: 'lab.invariant-halt',
      message: `world halted after ${first.code} at tick ${first.tick}: ${first.message}; reset to a fresh world before stepping`,
      subjects: first.subjects ? [...first.subjects] : undefined,
    };
    const line: LogLine = { tick: this.rt.tick, level: 'error', text: `${this.halted.code}: ${this.halted.message}` };
    this.log.push(line);
    this.diagnostics.push(line);
    this.acc = 0;
  }

  private executorFaulted() { return this.halted?.code === 'lab.executor-fault'; }

  private containExecutorFault(phase: string, error: unknown) {
    if (this.executorFaulted()) return;
    const priorHalt = this.halted;
    this.scriptResult = null;
    let name = 'NonErrorThrow', message: string, stack: string | null = null;
    try {
      if (error instanceof Error) {
        name = String(error.name);
        message = String(error.message);
        const trace = error.stack;
        stack = typeof trace === 'string' ? trace : null;
      } else message = String(error);
    } catch {
      message = 'thrown value could not be safely described';
    }
    const diagnostic: Diagnostic = {
      code: 'lab.executor-fault',
      message: `${phase} threw ${name}: ${message} at tick ${this.rt.tick}; partial execution state is unknown; reset to a fresh world before stepping`,
      subjects: [this.scenario.name],
      details: { phase, scenario: this.scenario.name, tick: this.rt.tick, name, message, stack, state: 'unknown-partial-execution' },
    };
    if (priorHalt) priorHalt.details = { ...priorHalt.details, executorFault: diagnostic.details };
    else this.halted = diagnostic;
    const line: LogLine = { tick: this.rt.tick, level: 'error', text: `${diagnostic.code}: ${diagnostic.message}${stack ? `\n${stack}` : ''}` };
    this.log.push(line);
    this.diagnostics.push(line);
    // Preserve actual world/records/claims; cancellation or rollback cannot be certified here.
    this.acc = 0;
  }

  /** One authoritative tick, even after the authored script ends; manual Step ignores UI Pause. */
  step() {
    let phase = 'lab.events';
    try {
      this.harvest();
      this.containViolations();
      if (this.halted) return;
      phase = 'scenario.done';
      this.finishScriptIfDone();
      if (this.halted) return;
      const t0 = performance.now();
      phase = 'runtime.step';
      this.rt.step();
      phase = 'lab.events';
      this.harvest();
      this.containViolations();
      // Terminal outcome/budget stops authored dispatch, not ordinary runtime children.
      // Custom sequences can still poll their final child until their own done() becomes true.
      phase = 'scenario.done';
      this.finishScriptIfDone();
      if (this.executorFaulted()) return;
      phase = 'scenario.tick';
      if (!this.halted && !this.scriptFinished) this.scenario.tick?.(this.rt);
      phase = 'scenario.done';
      this.finishScriptIfDone();
      if (this.executorFaulted()) return;
      this.costs.push(performance.now() - t0);
      if (this.costs.length > 2000) this.costs.splice(0, 1000);
      this.harvest();
      this.containViolations();
      phase = 'lab.routes';
      this.watchRoutes();
      phase = 'lab.onTick';
      this.onTick(this.rt);
    } catch (error) {
      this.containExecutorFault(phase, error);
    }
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
    for (let i = 0; i < n && !this.overBudget() && !this.halted; i++) this.step();
  }

  /** Advance by real elapsed seconds; returns interpolation alpha for rendering. */
  advance(seconds: number, maxSteps = 40) {
    this.harvest();
    this.containViolations();
    if (!this.paused && !this.halted) {
      this.acc += Math.min(seconds, 0.25) * this.speed;
      let n = 0;
      while (this.acc >= DT && !this.halted && n++ < maxSteps) {
        this.step();
        if (!this.halted) this.acc -= DT;
      }
      if (n > maxSteps) this.acc = 0;
    }
    return this.paused || this.halted ? 1 : Math.min(1, this.acc / DT);
  }

  pending() {
    if (this.halted) return true;
    if (this.scenario.done) {
      try { return !this.scenario.done(this.rt); }
      catch (error) { this.containExecutorFault('scenario.done', error); return true; }
    }
    return [...this.rt.records.values()].some((r) => !TERMINAL.has(r.status));
  }
  overBudget() {
    return this.rt.tick >= this.scenario.maxTicks;
  }
  /** Authored script result/budget only; this does not stop the usable world clock. */
  done() {
    if (this.halted) return false;
    const finished = this.scriptFinished || (this.scenario.continuous ? this.overBudget() : !this.pending() || this.overBudget());
    return !this.halted && finished;
  }

  checks(): Check[] {
    // A quarantined callback/state is not safe to re-enter merely to refresh the UI.
    const haltedCheck = (): Check[] => [{ ok: false, message: `${this.halted!.code}: ${this.halted!.message}` }];
    if (this.halted) return haltedCheck();
    let c: Check[];
    try { c = [...this.scenario.expect(this.rt)]; }
    catch (error) { this.containExecutorFault('scenario.expect', error); return haltedCheck(); }
    if (!this.scenario.continuous && this.pending()) c.unshift({ ok: false, message: `still running at tick ${this.rt.tick}` });
    return this.halted ? haltedCheck() : c;
  }

  stats() {
    const s = [...this.costs].sort((a, b) => a - b);
    const q = (f: number) => (s.length ? s[Math.min(s.length - 1, Math.floor(f * s.length))] : 0);
    const mean = s.length ? s.reduce((a, b) => a + b, 0) / s.length : 0;
    return { ticks: s.length, meanMs: +mean.toFixed(4), p50Ms: +q(0.5).toFixed(4), p95Ms: +q(0.95).toFixed(4), maxMs: +q(1).toFixed(3) };
  }
}
