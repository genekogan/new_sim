// Sequence runner: drives an existing Runtime through a step graph.
// Deterministic: ready steps are submitted in declaration order, re-scanned to
// a fixed point before every tick (so `when: started` chains start on the same
// tick), and the runtime is advanced only through Runtime.step().
import type { ActionStatus, Diagnostic } from '../actions/types.ts';
import { TERMINAL } from '../actions/types.ts';
import { DT, type Runtime, type Violation } from '../runtime/runtime.ts';
import type { StepSpec } from './types.ts';

export type StepStatus = 'pending' | 'executing' | 'blocked' | 'completed' | 'failed' | 'skipped' | 'cancelled';

export type StepReport = {
  id: string;
  verb: string;
  actionId?: string;
  status: StepStatus;
  /** Did the action reach `executing` (i.e. pass validation + reservation)? */
  started: boolean;
  submittedTick?: number;
  endedTick?: number;
  /** For `at` cues: the exact tick the cue named, and how late the step actually started. */
  cueTick?: number;
  cueLateTicks?: number;
  blockedTicks: number;
  diagnostic?: Diagnostic;
  outputs?: Record<string, unknown>;
};

export type SequenceStatus = 'completed' | 'partial' | 'aborted' | 'timeout';

export type SequenceResult = {
  status: SequenceStatus;
  steps: StepReport[];
  violations: Violation[];
  diagnostics: Diagnostic[];
  startTick: number;
  endTick: number;
  ticks: number;
  finalStateHash: string;
};

const DONE: ReadonlySet<StepStatus> = new Set(['completed', 'failed', 'skipped', 'cancelled']);

export class SequenceRunner {
  readonly rt: Runtime;
  readonly steps: StepSpec[];
  readonly reports: StepReport[];
  readonly t0: number;
  readonly diagnostics: Diagnostic[] = [];
  private byId = new Map<string, StepReport>();
  private prefix: string;
  private violationStart: number;
  private aborted = false;
  private timedOut = false;

  constructor(rt: Runtime, steps: StepSpec[], opts: { actionPrefix?: string } = {}) {
    this.rt = rt;
    this.steps = steps;
    this.prefix = opts.actionPrefix ?? 'step:';
    this.t0 = rt.tick;
    this.violationStart = rt.violations.length;
    this.reports = steps.map((s) => {
      const r: StepReport = { id: s.id, verb: s.verb, status: 'pending', started: false, blockedTicks: 0 };
      if (s.at !== undefined) r.cueTick = this.t0 + Math.round(s.at / DT);
      this.byId.set(s.id, r);
      return r;
    });
  }

  get done(): boolean {
    if (this.aborted || this.timedOut) return !this.reports.some((r) => r.status === 'executing' || r.status === 'blocked');
    return this.reports.every((r) => DONE.has(r.status));
  }

  /** Submit every step whose start condition holds now; skip steps whose condition can never hold. */
  advance() {
    if (this.aborted || this.timedOut) return;
    let changed = true;
    while (changed && !this.aborted) {
      changed = false;
      for (let i = 0; i < this.steps.length && !this.aborted; i++) {
        const s = this.steps[i], r = this.reports[i];
        if (r.status !== 'pending') continue;
        const c = this.condition(s);
        if (c === 'never') {
          changed = true;
          continue;
        }
        if (c === 'wait') continue;
        changed = true;
        this.submit(s, r);
      }
    }
  }

  /** Mirror action records into step reports after a tick; apply onFail policies. */
  poll() {
    for (let i = 0; i < this.steps.length; i++) {
      const s = this.steps[i], r = this.reports[i];
      if (r.status !== 'executing' && r.status !== 'blocked') continue;
      const rec = this.rt.records.get(r.actionId!)!;
      if (rec.status === 'blocked') r.blockedTicks++;
      if (!TERMINAL.has(rec.status)) {
        r.status = rec.status === 'blocked' ? 'blocked' : 'executing';
        continue;
      }
      r.endedTick = rec.endedTick;
      r.diagnostic = rec.diagnostic;
      r.outputs = rec.outputs;
      r.status = rec.status as StepStatus;
      if (rec.status === 'failed') this.onFailure(s, r);
    }
  }

  /** Step the runtime until the sequence is done or the tick budget is exhausted. */
  run(maxTicks = 20 * 60 * 30): SequenceResult {
    this.advance();
    let n = 0;
    while (!this.done && n < maxTicks) {
      this.rt.step();
      n++;
      this.poll();
      this.advance();
    }
    if (!this.done) this.timeout();
    return this.result();
  }

  result(): SequenceResult {
    const status: SequenceStatus = this.timedOut
      ? 'timeout'
      : this.aborted
        ? 'aborted'
        : this.reports.every((r) => r.status === 'completed')
          ? 'completed'
          : 'partial';
    return {
      status,
      steps: this.reports.map((r) => ({ ...r })),
      violations: this.rt.violations.slice(this.violationStart),
      diagnostics: [...this.diagnostics],
      startTick: this.t0,
      endTick: this.rt.tick,
      ticks: this.rt.tick - this.t0,
      finalStateHash: this.rt.stateHash(),
    };
  }

  private condition(s: StepSpec): 'ready' | 'wait' | 'never' {
    const r = this.byId.get(s.id)!;
    for (const dep of s.after ?? []) {
      const x = this.byId.get(dep)!;
      if (x.status === 'completed') continue;
      if (DONE.has(x.status)) return this.skip(r, dep, x.status, 'completed');
      return 'wait';
    }
    if (s.when) {
      const x = this.byId.get(s.when.step)!;
      if (s.when.event === 'started') {
        if (!x.started) {
          if (DONE.has(x.status)) return this.skip(r, x.id, x.status, 'started');
          return 'wait';
        }
      } else if (x.status !== 'completed') {
        if (DONE.has(x.status)) return this.skip(r, x.id, x.status, 'completed');
        return 'wait';
      }
    }
    if (r.cueTick !== undefined && this.rt.tick < r.cueTick) return 'wait';
    return 'ready';
  }

  private skip(r: StepReport, dep: string, depStatus: StepStatus, needed: string): 'never' {
    r.status = 'skipped';
    r.endedTick = this.rt.tick;
    r.diagnostic = {
      code: 'sequence.dependency-failed',
      message: `step "${r.id}" skipped: it needed step "${dep}" to have ${needed}, but "${dep}" ${depStatus}`,
      subjects: [r.id, dep],
    };
    return 'never';
  }

  private submit(s: StepSpec, r: StepReport) {
    const rec = this.rt.submit(s.verb, s.params, { id: `${this.prefix}${s.id}` });
    r.actionId = rec.id;
    r.submittedTick = this.rt.tick;
    if (r.cueTick !== undefined) r.cueLateTicks = this.rt.tick - r.cueTick;
    if (rec.status === 'failed') {
      r.status = 'failed';
      r.endedTick = rec.endedTick;
      r.diagnostic = rec.diagnostic;
      this.onFailure(s, r);
      return;
    }
    r.started = true;
    r.status = (rec.status as ActionStatus) === 'blocked' ? 'blocked' : 'executing';
  }

  private onFailure(s: StepSpec, r: StepReport) {
    const why = r.diagnostic ?? { code: 'action.failed', message: `${s.verb} failed` };
    this.diagnostics.push({ ...why, subjects: [s.id, ...(why.subjects ?? [])] });
    if ((s.onFail ?? 'abort') === 'abort') this.abort(`step "${s.id}" (${s.verb}) failed: ${why.message}`, s.id);
  }

  private abort(message: string, cause: string) {
    if (this.aborted) return;
    this.aborted = true;
    this.stopAll('sequence.aborted', `aborted because ${message}`, cause);
  }

  private timeout() {
    this.timedOut = true;
    this.stopAll('sequence.timeout', `tick budget exhausted after ${this.rt.tick - this.t0} ticks`);
    this.diagnostics.push({ code: 'sequence.timeout', message: `sequence did not finish within its tick budget (${this.rt.tick - this.t0} ticks)` });
  }

  /** Skip pending steps and cancel live ones. A refused cancel (e.g. unsupported load) is recorded, never forced. */
  private stopAll(code: string, message: string, cause?: string) {
    for (const r of this.reports) {
      if (r.status === 'pending') {
        r.status = 'skipped';
        r.endedTick = this.rt.tick;
        r.diagnostic = { code, message, subjects: cause ? [r.id, cause] : [r.id] };
      } else if (r.status === 'executing' || r.status === 'blocked') {
        const rec = this.rt.cancel(r.actionId!);
        if (rec.status === 'cancelled') {
          r.status = 'cancelled';
          r.endedTick = rec.endedTick;
          r.diagnostic = { code, message, subjects: cause ? [r.id, cause] : [r.id] };
        } else {
          this.diagnostics.push({
            code: 'sequence.cancel-refused',
            message: `step "${r.id}" could not be cancelled: ${rec.diagnostic?.message ?? 'refused'}; it keeps running`,
            subjects: [r.id],
          });
        }
      }
    }
  }
}

export function runSequence(rt: Runtime, steps: StepSpec[], opts: { maxTicks?: number; actionPrefix?: string } = {}): SequenceResult {
  return new SequenceRunner(rt, steps, opts).run(opts.maxTicks);
}
