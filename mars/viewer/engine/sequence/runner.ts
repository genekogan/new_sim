// Sequence runner: drives an existing Runtime through a step graph.
// Deterministic: ready steps are submitted in declaration order, re-scanned to
// a fixed point before every tick (so `when: started` chains start on the same
// tick), and the runtime is advanced only through Runtime.step().
import { z } from 'zod';
import type { ActionStatus, Diagnostic } from '../actions/types.ts';
import { TERMINAL } from '../actions/types.ts';
import { DT, type Runtime, type Violation } from '../runtime/runtime.ts';
import type { StepSpec } from './types.ts';
import { completionBlockedTails } from './blocked-tails.ts';

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

export type SequenceStatus = 'completed' | 'partial' | 'aborted' | 'timeout' | 'blocked';

export type SequenceResult = {
  status: SequenceStatus;
  steps: StepReport[];
  violations: Violation[];
  diagnostics: Diagnostic[];
  startTick: number;
  endTick: number;
  ticks: number;
  finalStateHash: string;
  /** Steps the sequence cut short (timeout / abort): pending ones skipped, live ones cancelled (or refused). */
  cut: string[];
  /** No live actions and no `held` support without a gripping holder: the final state is a resting state. */
  settled: boolean;
  /** Why the final state is not settled (empty when settled). */
  unsettled: string[];
  /** Extra ticks stepped after a timeout to let deferred cancels (e.g. a controlled set-down) finish. */
  settleTicks: number;
};

/** Default tick budget of `run()` (30 simulated minutes). */
export const DEFAULT_MAX_TICKS = 20 * 60 * 30;
/** Sim-time budget after a timeout for deferred cancels to finish (review M4). */
export const SETTLE_S = 20;
/** While settling, refused cancels are retried this often (a carry may refuse until the ground is clear). */
const RETRY_CANCEL_TICKS = 20;

/**
 * Everything a SequenceRunner holds between ticks (plain JSON). Together with a Runtime snapshot
 * (runtime/snapshot.ts) it resumes a sequence paused between — or during — steps.
 */
export type RunnerState = {
  format: 'mars-sequence-runner/1';
  steps: StepSpec[];
  prefix: string;
  t0: number;
  reports: StepReport[];
  diagnostics: Diagnostic[];
  violationStart: number;
  aborted: boolean;
  timedOut: boolean;
  blockedDiagnostic?: Diagnostic;
  cut: string[];
  cutReason: [string, Diagnostic][];
  refused: string[];
  settleTicks: number;
};

const DONE: ReadonlySet<StepStatus> = new Set(['completed', 'failed', 'skipped', 'cancelled']);

/**
 * Sequence verbs the runner handles itself (LAST_MILE LM-016); they are not registry actions, reserve nothing and
 * complete on the tick they start (so `after`, `when` and `at` apply to them like to any step).
 */
export const SEQUENCE_VERBS: Record<string, { description: string; schema: z.ZodType }> = {
  mark: {
    description: 'Put a named mark event into the run (and its take) on the tick this step starts; completes at once.',
    schema: z.strictObject({ name: z.string().min(1).max(80), data: z.record(z.string(), z.unknown()).optional() }),
  },
  cancel: {
    description:
      "Stop another step of this plan: a live one is cancelled (its action's controlled stop) and ends 'cancelled', a pending one is skipped — both with sequence.step-cancelled, which is not a failure (no onFail abort); a finished one is left alone. Completes at once.",
    schema: z.strictObject({ step: z.string().min(1).max(64) }),
  },
};
const MAKE_WAY = /:make-way:\d+$/;

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
  private blockedDiagnostic?: Diagnostic;
  private cut: string[] = [];
  /** Why each cut live step was stopped (applied when its deferred cancel finishes). */
  private cutReason = new Map<string, Diagnostic>();
  /** Cut steps whose cancel the action refused; retried while settling. */
  private refused = new Set<string>();
  private settleTicks = 0;

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

  /** Plain-JSON runner state (pair it with `rt.snapshot()` taken at the same tick). */
  serialize(): RunnerState {
    return structuredClone({
      format: 'mars-sequence-runner/1' as const,
      steps: this.steps,
      prefix: this.prefix,
      t0: this.t0,
      reports: this.reports,
      diagnostics: this.diagnostics,
      violationStart: this.violationStart,
      aborted: this.aborted,
      timedOut: this.timedOut,
      ...(this.blockedDiagnostic ? { blockedDiagnostic: this.blockedDiagnostic } : {}),
      cut: this.cut,
      cutReason: [...this.cutReason],
      refused: [...this.refused],
      settleTicks: this.settleTicks,
    });
  }

  /** Rebuild a runner over `rt` (a runtime restored from the snapshot taken with this state). */
  static restore(rt: Runtime, state: RunnerState): SequenceRunner {
    if (state?.format !== 'mars-sequence-runner/1') throw new Error('not a mars-sequence-runner/1 state');
    const s = structuredClone(state);
    const r = new SequenceRunner(rt, s.steps, { actionPrefix: s.prefix });
    (r as { t0: number }).t0 = s.t0;
    r.reports.splice(0, r.reports.length, ...s.reports);
    r.byId = new Map(r.reports.map((x) => [x.id, x]));
    r.diagnostics.push(...s.diagnostics);
    r.violationStart = s.violationStart;
    r.aborted = s.aborted;
    r.timedOut = s.timedOut;
    r.blockedDiagnostic = s.blockedDiagnostic;
    r.cut = s.cut;
    r.cutReason = new Map(s.cutReason);
    r.refused = new Set(s.refused);
    r.settleTicks = s.settleTicks;
    return r;
  }

  /** One tick of `run()`: step the runtime, mirror records into reports, submit newly ready steps. */
  tick() {
    if (this.rt.violations.length) return;
    this.blockedDiagnostic = undefined;
    this.rt.step();
    // Invariant corruption is distinct from an ordinary action refusal/failure.
    // Do not dispatch, cancel, settle or save a resumable invalid state.
    if (this.rt.violations.length) return;
    const eventCursor = this.rt.events.length;
    this.poll();
    if (this.hasTimeouts) this.checkTimeouts();
    this.advance();
    // A cue/cancel/timeout changed the world or action graph after this tick's wait sample.
    // Give its consequences a full tick before certifying quiescence.
    if (this.rt.events.length === eventCursor) this.checkBlocked();
  }

  private get hasTimeouts() {
    return this.steps.some((s) => s.timeout !== undefined);
  }

  /** Only completion-dependent tails may be inert; independent cues/timeouts/work prevent stopping. */
  private checkBlocked() {
    if (this.aborted || this.timedOut) return;
    if (this.steps.some((s, i) => s.timeout !== undefined && ['executing', 'blocked'].includes(this.reports[i].status))) return;
    const waits = this.rt.exhaustedWaitDiagnostics();
    if (!waits) return;
    const live = new Set(this.reports.flatMap((r) => r.actionId && this.rt.isActive(r.actionId) ? [r.actionId] : []));
    const pendingTails = completionBlockedTails(this.steps, this.reports, live);
    if (!pendingTails) return;
    this.blockedDiagnostic = { code: 'sequence.blocked', message: 'all live work remains blocked after bounded recovery; supports and reservations remain live',
      subjects: [...new Set(waits.flatMap((d) => d.subjects ?? []))].sort(), details: { waits, ...(pendingTails.length ? { pendingTails } : {}) } };
  }

  /** LM-016: cancel steps live past their `timeout` (a controlled stop), then apply their onFail policy. */
  private checkTimeouts() {
    if (this.aborted || this.timedOut) return;
    for (let i = 0; i < this.steps.length && !this.aborted; i++) {
      const s = this.steps[i], r = this.reports[i];
      if (s.timeout === undefined || (r.status !== 'executing' && r.status !== 'blocked') || this.cutReason.has(r.id)) continue;
      if (this.rt.tick - r.submittedTick! < Math.round(s.timeout / DT)) continue;
      const reason: Diagnostic = { code: 'sequence.step-timeout', message: `step "${s.id}" (${s.verb}) did not finish within its ${s.timeout} s timeout`, subjects: [s.id] };
      this.stopStep(r, reason);
      this.diagnostics.push(reason);
      if ((s.onFail ?? 'abort') === 'abort') this.abort(`step "${s.id}" (${s.verb}) timed out after ${s.timeout} s`, s.id);
    }
  }

  /** Cancel one live step's action with `reason` (recorded when a deferred cancel finishes); a refused cancel is recorded. */
  private stopStep(r: StepReport, reason: Diagnostic) {
    this.cutReason.set(r.id, reason);
    const rec = this.rt.cancel(r.actionId!, reason);
    if (rec.status === 'cancelled') {
      r.status = 'cancelled';
      r.endedTick = rec.endedTick;
      r.diagnostic = reason;
    } else if (!this.deferredCancel(rec)) {
      this.refused.add(r.id);
      this.diagnostics.push({ code: 'sequence.cancel-refused', message: `step "${r.id}" could not be cancelled: ${rec.diagnostic?.message ?? 'refused'}; it keeps running`, subjects: [r.id] });
    }
  }

  /** A runner built-in (`mark`, `cancel`): runs and completes on this tick. */
  private builtin(s: StepSpec, r: StepReport) {
    r.submittedTick = this.rt.tick;
    r.started = true;
    if (r.cueTick !== undefined) r.cueLateTicks = this.rt.tick - r.cueTick;
    const p = s.params as { name?: string; data?: unknown; step?: string };
    if (s.verb === 'mark') {
      this.rt.mark(p.name!, p.data ?? { step: s.id });
      r.outputs = { mark: p.name };
    } else {
      const t = this.byId.get(p.step!);
      const reason: Diagnostic = { code: 'sequence.step-cancelled', message: `step "${p.step}" cancelled by step "${s.id}"`, subjects: [p.step!, s.id] };
      if (!t || t.id === s.id) {
        r.status = 'failed';
        r.endedTick = this.rt.tick;
        r.diagnostic = { code: 'sequence.unknown-step', message: `step "${s.id}": cancel names ${t ? 'itself' : `unknown step "${p.step}"`}`, subjects: [s.id] };
        this.onFailure(s, r);
        return;
      }
      if (t.status === 'pending') {
        t.status = 'skipped';
        t.endedTick = this.rt.tick;
        t.diagnostic = reason;
      } else if ((t.status === 'executing' || t.status === 'blocked') && !this.cutReason.has(t.id)) this.stopStep(t, reason);
      r.outputs = { cancelled: t.id, was: t.status };
    }
    r.status = 'completed';
    r.endedTick = this.rt.tick;
  }

  get done(): boolean {
    if (this.rt.violations.length) return true;
    if (this.blockedDiagnostic) return true;
    if (this.aborted || this.timedOut) return !this.reports.some((r) => r.status === 'executing' || r.status === 'blocked');
    return this.reports.every((r) => DONE.has(r.status));
  }

  /** Submit every step whose start condition holds now; skip steps whose condition can never hold. */
  advance() {
    if (this.aborted || this.timedOut || this.rt.violations.length) return;
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
        r.diagnostic = rec.diagnostic;
        continue;
      }
      r.endedTick = rec.endedTick;
      r.diagnostic = rec.diagnostic ?? (rec.status === 'cancelled' ? this.cutReason.get(r.id) : undefined);
      r.outputs = rec.outputs;
      r.status = rec.status as StepStatus;
      this.refused.delete(r.id);
      if (rec.status === 'failed') this.onFailure(s, r);
    }
  }

  /** Step the runtime until the sequence is done or the tick budget is exhausted. */
  run(maxTicks = DEFAULT_MAX_TICKS): SequenceResult {
    this.blockedDiagnostic = undefined; // an explicit continuation may observe changed external circumstances
    this.advance();
    let n = 0;
    while (!this.done && n < maxTicks) {
      this.tick();
      n++;
    }
    if (!this.done) {
      this.timeout();
      this.settle(Math.round(SETTLE_S / DT));
    }
    return this.result();
  }

  /**
   * After a timeout: keep stepping (bounded) until every deferred cancel has finished, so the recorded
   * final state is a resting state rather than mid-action. Refused cancels are retried periodically and
   * stay recorded in `diagnostics` if they never succeed.
   */
  private settle(budget: number) {
    let n = 0;
    while (n < budget && this.liveActions().length && !this.rt.violations.length) {
      this.rt.step();
      n++;
      if (this.rt.violations.length) break;
      this.poll();
      if (n % RETRY_CANCEL_TICKS === 0)
        for (const r of this.reports) {
          if (!this.refused.has(r.id) || (r.status !== 'executing' && r.status !== 'blocked')) continue;
          const rec = this.rt.cancel(r.actionId!);
          if (rec.status === 'cancelled') this.poll();
          else if (this.deferredCancel(rec)) this.refused.delete(r.id);
        }
    }
    this.settleTicks = n;
    const why = this.unsettledReasons();
    if (why.length)
      this.diagnostics.push({
        code: 'sequence.unsettled',
        message: `final state is not settled after ${(n * DT).toFixed(1)} s of settling: ${why.join('; ')}`,
        subjects: this.liveActions().map((r) => r.id),
      });
  }

  private liveActions() {
    return [...this.rt.records.values()].filter((r) => !TERMINAL.has(r.status));
  }

  private deferredCancel(rec: { phase?: string; history: { code?: string }[] }) {
    return rec.phase === 'cancelling' && !rec.history[rec.history.length - 1]?.code;
  }

  private unsettledReasons(): string[] {
    const out = this.liveActions().map((r) => `action ${r.id} (${r.verb}) is still ${r.status}${r.phase ? ` (${r.phase})` : ''}`);
    const ents = this.rt.world.entities;
    for (const id of Object.keys(ents).sort()) {
      const e = ents[id];
      if (e.support?.kind !== 'held') continue;
      for (const h of e.support.by)
        if (ents[h]?.human?.grip?.entity !== e.id) out.push(`${id} is marked held by ${h}, who is not gripping it`);
    }
    return out;
  }

  result(): SequenceResult {
    const unsettled = this.unsettledReasons();
    const corruption = this.rt.violations[0];
    const halt: Diagnostic[] = corruption ? [{ code: 'sequence.invariant-halt',
      message: `run quarantined at tick ${corruption.tick} after ${corruption.code}: ${corruption.message}; invalid state was not continued or committed`,
      subjects: corruption.subjects ? [...corruption.subjects] : undefined }] : [];
    const status: SequenceStatus = corruption ? 'aborted' : this.blockedDiagnostic ? 'blocked' : this.timedOut
      ? 'timeout'
      : this.aborted
        ? 'aborted'
        : this.reports.every((r) => r.status === 'completed' || ((r.status === 'cancelled' || r.status === 'skipped') && r.diagnostic?.code === 'sequence.step-cancelled'))
          ? 'completed' // a step the plan's own `cancel` stopped ran as directed (LM-016)
          : 'partial';
    return {
      status,
      steps: this.reports.map((r) => ({ ...r })),
      violations: this.rt.violations.slice(corruption ? 0 : this.violationStart),
      diagnostics: [...this.diagnostics, ...halt, ...(this.blockedDiagnostic ? [this.blockedDiagnostic] : [])],
      startTick: this.t0,
      endTick: this.rt.tick,
      ticks: this.rt.tick - this.t0,
      finalStateHash: this.rt.stateHash(),
      cut: [...this.cut],
      settled: !unsettled.length,
      unsettled,
      settleTicks: this.settleTicks,
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
    // an idle person nudged aside by a walker (locomotion/walk.ts makeWay: an ambient walk_to with id
    // `<person>:make-way:<tick>`) is busy for a second or two: a directed step waits for that instead of
    // failing with reservation.conflict
    const def = this.rt.registry.get(s.verb);
    const parsed = def?.schema.safeParse(s.params);
    if (def && parsed?.success)
      for (const res of def.reservations(this.rt.world, parsed.data))
        if (this.rt.holder(res.resource).some((a) => MAKE_WAY.test(a) && this.rt.isActive(a))) return 'wait';
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
    if (Object.hasOwn(SEQUENCE_VERBS, s.verb) && !this.rt.registry.has(s.verb)) return this.builtin(s, r);
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

  /**
   * Skip pending steps and cancel live ones. A deferred cancel (controlled stop) keeps the step live until
   * it finishes as `cancelled`; a refused cancel (e.g. unsupported load) is recorded, never forced.
   */
  private stopAll(code: string, message: string, cause?: string) {
    for (const r of this.reports) {
      if (r.status === 'pending') {
        r.status = 'skipped';
        r.endedTick = this.rt.tick;
        r.diagnostic = { code, message, subjects: cause ? [r.id, cause] : [r.id] };
        this.cut.push(r.id);
      } else if (r.status === 'executing' || r.status === 'blocked') {
        const reason = { code, message, subjects: cause ? [r.id, cause] : [r.id] };
        if (!this.cut.includes(r.id)) this.cut.push(r.id);
        this.cutReason.set(r.id, reason);
        const rec = this.rt.cancel(r.actionId!);
        if (rec.status === 'cancelled') {
          r.status = 'cancelled';
          r.endedTick = rec.endedTick;
          r.diagnostic = reason;
        } else if (this.deferredCancel(rec)) {
          // controlled stop in progress: poll() records the end
        } else {
          this.refused.add(r.id);
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
