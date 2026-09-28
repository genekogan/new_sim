// Mid-action pause / resume through the control plane (spec §22; TAKES_AND_PLANS.md "What is resumable").
// `engine_execute { pauseAt }` drives the same Runtime + SequenceRunner + TakeRecorder that runPlan uses,
// tick by tick, until the pause point; then `rt.snapshot()` (refusing non-resumable live actions such as
// carry unless `allowDrop`) + `runner.serialize()` go into ONE content-addressed blob committed as a
// `pause` checkpoint. `engine_resume` restores both, optionally appends extra commands as steps, and
// continues. A paused-then-resumed run is tick-for-tick the unpaused run: the tick budget is shared and
// `drive()` finishes with `runner.run(rest)`, exactly the loop the unpaused path runs.
import type { ActionDef, ActionRecord } from '../actions/types.ts';
import { TERMINAL } from '../actions/types.ts';
import { DT, type Runtime } from '../runtime/runtime.ts';
import type { RuntimeSnapshot } from '../runtime/snapshot.ts';
import type { RunnerState, SequenceResult, SequenceRunner, StepReport } from '../sequence/runner.ts';
import type { StepSpec } from '../sequence/types.ts';

export const PAUSE_FORMAT = 'mars-pause/1';

/** Seconds from the plan's start (the sequence clock `at` cues use), or a step lifecycle event. */
export type PausePoint = number | { step: string; event: 'started' | 'completed' };

/** What a pause checkpoint needs besides the runtime snapshot; rides inside the same content-addressed blob. */
export type PauseContext = {
  format: typeof PAUSE_FORMAT;
  plan: string;
  /** The checkpoint the run started from (before its first pause). */
  runStart: string;
  runner: RunnerState;
  /** Tick budget of the whole run (shared across segments, so a resumed run times out where the unpaused one would). */
  maxTicks: number;
  /** Segment takes so far, oldest first (the last one ends at this pause). */
  takes: string[];
  /** Extra commands submitted by earlier resumes (step ids). */
  commands: string[];
};

export type PauseSnapshot = RuntimeSnapshot & { pause: PauseContext };

export const isPauseSnapshot = (s: RuntimeSnapshot | null): s is PauseSnapshot => !!s && (s as PauseSnapshot).pause?.format === PAUSE_FORMAT;

/** Has the run reached `p`? (checked before each tick, after ready steps were submitted) */
export function reached(runner: SequenceRunner, p: PausePoint): boolean {
  if (typeof p === 'number') return runner.rt.tick - runner.t0 >= Math.round(p / DT);
  const r = runner.reports.find((x) => x.id === p.step);
  return !!r && (p.event === 'started' ? r.started : r.status === 'completed');
}

export function describePoint(p: PausePoint) {
  return typeof p === 'number' ? `t = ${p} s` : `step "${p.step}" ${p.event}`;
}

/**
 * Advance until the sequence is done or `until` is reached (then `{ paused: true }`, runtime untouched
 * past that tick). Otherwise finishes with `runner.run(rest)` — the unpaused loop, timeout and settle
 * included — and returns its result.
 */
export function drive(runner: SequenceRunner, until: PausePoint | undefined, budget: number): { paused: true; ticks: number } | { paused: false; result: SequenceResult } {
  runner.advance();
  let n = 0;
  while (!runner.done && n < budget) {
    if (until !== undefined && reached(runner, until)) return { paused: true, ticks: n };
    runner.tick();
    n++;
  }
  return { paused: false, result: runner.run(budget - n) };
}

/** Live (non-terminal) actions: what a pause holds mid-flight. */
export function liveActions(rt: Runtime) {
  const out: { id: string; verb: string; status: ActionRecord['status']; phase?: string }[] = [];
  for (const r of rt.records.values()) if (!TERMINAL.has(r.status)) out.push({ id: r.id, verb: r.verb, status: r.status, ...(r.phase ? { phase: r.phase } : {}) });
  return out;
}

export function stepProgress(reports: StepReport[]) {
  return reports.map((r) => ({ id: r.id, verb: r.verb, status: r.status, ...(r.diagnostic ? { diagnostic: r.diagnostic.code } : {}) }));
}

export type Command = { verb: string; params: Record<string, unknown>; id?: string };

/**
 * Append extra commands to a paused runner's state as unconditioned steps (submitted on the resume tick,
 * declaration order). Params are parsed with the verb's registry schema, exactly as bind_plan does.
 */
export function appendCommands(state: RunnerState, cmds: Command[], registry: Map<string, ActionDef>, segment: number): { ok: true; ids: string[] } | { ok: false; code: string; message: string; details?: unknown } {
  const taken = new Set(state.steps.map((s) => s.id));
  const ids: string[] = [];
  for (let i = 0; i < cmds.length; i++) {
    const c = cmds[i];
    const def = registry.get(c.verb);
    if (!def) return { ok: false, code: 'resume.invalid-command', message: `commands[${i}]: no verb "${c.verb}" (engine_list_verbs)`, details: { index: i } };
    const parsed = def.schema.safeParse(c.params);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((x) => ({ path: x.path.join('.') || '(root)', message: x.message }));
      return { ok: false, code: 'resume.invalid-command', message: `commands[${i}] (${c.verb}): ${issues.map((x) => `${x.path}: ${x.message}`).join('; ')}`, details: { index: i, issues } };
    }
    const id = c.id ?? `resume${segment}-${i + 1}`;
    if (taken.has(id)) return { ok: false, code: 'resume.invalid-command', message: `commands[${i}]: step id "${id}" is already used by this run`, details: { index: i } };
    taken.add(id);
    ids.push(id);
    const step: StepSpec = { id, verb: c.verb, params: parsed.data as Record<string, unknown> };
    state.steps.push(step);
    state.reports.push({ id, verb: c.verb, status: 'pending', started: false, blockedTicks: 0 });
  }
  return { ok: true, ids };
}
