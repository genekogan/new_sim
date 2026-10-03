// Chapter takes (W31): ONE continuous run recorded as consecutive takes, cut at plan barriers. A long build (the 2022
// east-house A+B: 600 599 ticks, 12 MB as one take) ships as chapters that each fit the take budget and play back to back.
// The run itself is the ordinary one (`SequenceRunner.run`, same Runtime, same services); a `ChapterCutter` observer only
// finishes the current TakeRecorder and starts the next at the end of the tick in which the last step before a bound
// ended — so chapter k's `baselineStateHash` IS chapter k−1's `finalStateHash` (the same world object, same tick), the
// chapters' ticks sum to the run's ticks, and the last chapter's final state is the unchaptered run's final state.
// A bound must be a barrier: no step at or after it may start before every step before it has ended (sequence-b's
// section gates are; `isBarrier` checks it on the plan). A cut that finds a later step already started throws.
import { TERMINAL } from '../actions/types.ts';
import { hashOf, stableStringify } from '../core/hash.ts';
import { datan2, dcos, dsin } from '../core/math.ts';
import { HistoryError, type WorldHistory } from '../history/store.ts';
import { Runtime, type RuntimeObserver } from '../runtime/runtime.ts';
import { SequenceRunner } from '../sequence/runner.ts';
import type { BoundPlan, StepSpec } from '../sequence/types.ts';
import { checkPlan, integrity, runReport, runServices, type EngineConfig, type RunReport, type StaleInfo } from '../rehearsal/rehearse.ts';
import type { WorldState } from '../world/types.ts';
import { TakeRecorder, type RecorderOptions } from './recorder.ts';
import { sampleTake } from './replay.ts';
import { ANG_Q, POS_Q, type Take } from './types.ts';

/** A chapter starts at plan step index `at` (the first chapter at 0). */
export type ChapterBound = { id: string; at: number };
/** Where a chapter was cut: plan steps [fromStep, toStep), run ticks [fromTick, toTick) relative to the run start. */
export type ChapterCut = { id: string; fromStep: number; toStep: number; fromTick: number; toTick: number; ticks: number };
export type ChapterRun = { report: RunReport; takes: Take[]; chapters: ChapterCut[]; finalState: WorldState; stale?: StaleInfo };

/**
 * Is step index `at` a barrier of `steps`: does every step at or after it depend (through `after` / `when` chains) on
 * every step before it? Then no later step can start before all earlier ones ended (a failed dependency skips it).
 */
export function isBarrier(steps: readonly StepSpec[], at: number): boolean {
  if (at <= 0 || at >= steps.length) return at === 0 || at === steps.length;
  const idx = new Map(steps.map((s, i) => [s.id, i]));
  // ancestors of each step as a bitset over [0, at)
  const words = Math.ceil(at / 32);
  const anc: Uint32Array[] = [];
  const full = new Uint32Array(words);
  for (let i = 0; i < at; i++) full[i >> 5] |= 1 << (i & 31);
  for (let i = 0; i < steps.length; i++) {
    const a = new Uint32Array(words);
    const s = steps[i];
    for (const d of [...(s.after ?? []), ...(s.when ? [s.when.step] : [])]) {
      const j = idx.get(d);
      if (j === undefined || j >= i) continue; // a forward dependency cannot be part of an ancestor chain before `at`
      const aj = anc[j];
      for (let w = 0; w < words; w++) a[w] |= aj[w];
      if (j < at) a[j >> 5] |= 1 << (j & 31);
    }
    anc.push(a);
    if (i >= at) for (let w = 0; w < words; w++) if (((a[w] & full[w]) >>> 0) !== full[w]) return false;
  }
  return true;
}

/** Plan bounds of a year-build A+B: 'A' at 0, then each sequence-b section start; `merge` folds a section into the one before. */
export function sectionBounds(build: { phaseAStepCount?: number; sectionStarts?: { section: string; at: number }[] }, merge: readonly string[] = []): ChapterBound[] {
  const out: ChapterBound[] = [{ id: 'A', at: 0 }];
  for (const s of build.sectionStarts ?? []) {
    if (merge.includes(s.section)) continue;
    if (s.at <= out[out.length - 1].at) throw new Error(`section ${s.section} starts at step ${s.at}, not after ${out[out.length - 1].id} (${out[out.length - 1].at})`);
    out.push({ id: s.section, at: s.at });
  }
  return out;
}

/** The observer that cuts: at the end of a tick, once every step before the next bound has ended, finish and restart. */
export class ChapterCutter implements RuntimeObserver {
  readonly rt: Runtime;
  readonly runner: SequenceRunner;
  readonly bounds: ChapterBound[];
  readonly takes: Take[] = [];
  readonly cuts: ChapterCut[] = [];
  private rec: TakeRecorder;
  private k = 0;
  private fromTick: number;
  private readonly t0: number;
  private readonly recOpts: RecorderOptions;

  constructor(rt: Runtime, runner: SequenceRunner, bounds: ChapterBound[], recOpts: RecorderOptions) {
    if (!bounds.length || bounds[0].at !== 0) throw new Error('the first chapter must start at step 0');
    for (let i = 1; i < bounds.length; i++)
      if (!(bounds[i].at > bounds[i - 1].at && bounds[i].at < runner.steps.length)) throw new Error(`chapter ${bounds[i].id} bound ${bounds[i].at} is not inside the plan after ${bounds[i - 1].id}`);
    this.rt = rt;
    this.runner = runner;
    this.bounds = bounds;
    this.recOpts = recOpts;
    this.t0 = rt.tick;
    this.fromTick = rt.tick;
    // the recorder first, then the cutter: at a cut tick the recorder has sampled the tick (finish() re-samples anyway)
    this.rec = new TakeRecorder(rt, recOpts);
    rt.observers.push(this);
  }

  onTick() {
    while (this.k + 1 < this.bounds.length && this.ended(this.bounds[this.k + 1].at)) this.cut();
  }

  /** Every step before `at` has an action record in a terminal state (a pending / skipped step never does). A terminal
   *  record stays terminal, so the scan resumes at the first step not yet seen ended (amortised O(1) per tick). */
  private ended(at: number): boolean {
    while (this.p < at) {
      const id = this.runner.reports[this.p].actionId;
      const rec = id ? this.rt.records.get(id) : undefined;
      if (!rec || !TERMINAL.has(rec.status)) return false;
      this.p++;
    }
    return true;
  }
  private p = 0;

  private cut() {
    const next = this.bounds[this.k + 1];
    const early = this.runner.reports.slice(next.at).find((r) => r.status !== 'pending' || r.actionId);
    if (early) throw new Error(`chapter ${next.id} (step ${next.at}) is not a barrier: step ${early.id} started before every earlier step ended`);
    this.push(next.at);
    this.rec = new TakeRecorder(this.rt, this.recOpts);
    // keep the recorder ahead of the cutter: it samples a tick before the cutter may finish it (a finished recorder is
    // off the list; the tick's observer loop runs over the list as it was, so it is not sampled again)
    this.rt.observers = [...this.rt.observers.filter((o) => o !== this), this];
    this.k++;
  }

  private push(toStep: number) {
    const take = this.rec.finish();
    const b = this.bounds[this.k];
    this.cuts.push({ id: b.id, fromStep: b.at, toStep, fromTick: this.fromTick - this.t0, toTick: this.rt.tick - this.t0, ticks: this.rt.tick - this.fromTick });
    this.takes.push(take);
    this.fromTick = this.rt.tick;
  }

  /** After the run: the last chapter's take; every bound must have been reached. */
  finish(): { takes: Take[]; chapters: ChapterCut[] } {
    this.rt.observers = this.rt.observers.filter((o) => o !== this);
    if (this.k !== this.bounds.length - 1)
      throw new Error(`the run ended in chapter ${this.bounds[this.k].id}; chapters ${this.bounds.slice(this.k + 1).map((b) => b.id).join(', ')} never started`);
    this.push(this.runner.steps.length);
    return { takes: this.takes, chapters: this.cuts };
  }
}

/**
 * Continuity of two consecutive chapters: the first frame of `next` is the final state of `prev`. Returns the problems
 * (empty = continuous): `next.baselineStateHash` = `prev.finalStateHash` = hashOf(prev.finalState); `next.entities0` holds
 * every entity of `prev.finalState` exactly (minus provenance / label / tags, as the recorder stores it) and nothing else
 * present at t = 0; the replayed first frame (`sampleTake(next, 0)`) is within the track quantum (½ mm, ½ mrad) of those
 * poses with the same phase / activity / level.
 */
export function chapterContinuity(prev: Take, next: Take): string[] {
  const out: string[] = [];
  if (hashOf(prev.finalState) !== prev.finalStateHash) out.push(`prev ${prev.id}: finalState does not hash to its finalStateHash`);
  if (next.baselineStateHash !== prev.finalStateHash) out.push(`next ${next.id} starts from ${next.baselineStateHash.slice(0, 12)}, prev ${prev.id} ends at ${prev.finalStateHash.slice(0, 12)}`);
  if (next.dt !== prev.dt) out.push(`dt ${prev.dt} → ${next.dt}`);
  const ents = prev.finalState.entities;
  const frame = sampleTake(next, 0).entities;
  const ids = Object.keys(ents).sort();
  const at0 = Object.keys(frame).sort();
  if (stableStringify(ids) !== stableStringify(at0)) {
    const miss = ids.filter((i) => !frame[i]), extra = at0.filter((i) => !ents[i]);
    out.push(`first frame entities differ: missing ${miss.slice(0, 5).join(', ')}${miss.length > 5 ? ' …' : ''}; extra ${extra.slice(0, 5).join(', ')}`);
  }
  for (const id of ids) {
    const { provenance: _p, label: _l, tags: _t, ...e0 } = ents[id];
    if (stableStringify(next.entities0?.[id]) !== stableStringify(e0)) out.push(`${id}: entities0 ≠ prev final entity`);
    const f = frame[id];
    if (!f) continue;
    const e = ents[id];
    const dp = Math.max(...[0, 1, 2].map((i) => Math.abs(f.p[i] - e.pose.p[i])));
    const da = Math.max(Math.abs(angDiff(f.yaw, e.pose.yaw)), Math.abs(f.pitch - (e.pose.pitch ?? 0)), Math.abs(f.roll - (e.pose.roll ?? 0)));
    if (dp > 0.5 / POS_Q + 1e-9 || da > 0.5 / ANG_Q + 1e-9) out.push(`${id}: first frame pose off by ${(dp * 1000).toFixed(2)} mm / ${(da * 1000).toFixed(2)} mrad`);
    if ((f.phase ?? undefined) !== e.phase || (f.activity ?? undefined) !== e.human?.activity || (f.level ?? undefined) !== e.human?.level) out.push(`${id}: first frame phase / activity / level differ`);
  }
  return out;
}
const angDiff = (a: number, b: number) => datan2(dsin(a - b), dcos(a - b));

/** `runPlan` (rehearsal/rehearse.ts) with the take cut into chapters. Pure w.r.t. history. */
export function runPlanChapters(start: WorldState, startCheckpoint: string, plan: BoundPlan, cfg: EngineConfig, rulesVersion: string, bounds: ChapterBound[]) {
  const world = structuredClone(start);
  const rt = new Runtime(world, cfg.registry, runServices(world, cfg), cfg.invariants);
  const runner = new SequenceRunner(rt, plan.steps);
  const cutter = new ChapterCutter(rt, runner, bounds, { planHash: plan.planHash, baselineCheckpoint: startCheckpoint, rulesVersion, keyframeEvery: cfg.keyframeEvery, ...(cfg.trackTol !== undefined ? { tol: cfg.trackTol } : {}) });
  const res = runner.run(cfg.maxTicks);
  const { takes, chapters } = cutter.finish();
  return { report: runReport(res, takes[takes.length - 1], plan.planHash, startCheckpoint), takes, chapters, finalState: rt.world };
}

/** `rehearse` with chapter takes: the same checks, the same run, one take per chapter. */
export function rehearseChapters(history: WorldHistory, workspaceId: string, plan: BoundPlan, cfg: EngineConfig, bounds: ChapterBound[]): ChapterRun {
  const bad = integrity(history, plan);
  if (bad) throw new HistoryError('plan.corrupt', bad);
  if (plan.rulesVersion !== history.rulesVersion)
    throw new HistoryError('plan.stale', `plan was bound under rules ${plan.rulesVersion}; runtime is ${history.rulesVersion} — rebind`);
  for (const b of bounds) if (!isBarrier(plan.steps, b.at)) throw new Error(`chapter ${b.id} at step ${b.at} is not a barrier of plan ${plan.planHash}`);
  const r = runPlanChapters(history.read(plan.baselineCheckpoint), plan.baselineCheckpoint, plan, cfg, history.rulesVersion, bounds);
  const chk = checkPlan(history, workspaceId, plan);
  return chk.ok ? r : { ...r, stale: { code: chk.code, message: chk.message, diff: chk.diff } };
}
