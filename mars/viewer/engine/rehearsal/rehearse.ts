// Rehearsal and official execution (spec §16, §21–22). Both go through the
// single `runPlan` below: same registry, same invariants, fresh services from
// the same factory, same Runtime class, same sequence runner, same recorder.
// There is no fast path. They differ only in where the start state comes from
// and whether the successor state is committed.
import type { ActionDef, Diagnostic } from '../actions/types.ts';
import { hashOf, stableStringify } from '../core/hash.ts';
import { HistoryError, type Checkpoint, type WorldHistory } from '../history/store.ts';
import { Runtime, type Invariant, type RuntimeServices, type Violation } from '../runtime/runtime.ts';
import { SequenceRunner, type SequenceResult, type SequenceStatus, type StepReport } from '../sequence/runner.ts';
import type { BoundPlan } from '../sequence/types.ts';
import { planHashOf } from '../sequence/bind.ts';
import { TakeRecorder } from '../take/recorder.ts';
import type { Take } from '../take/types.ts';
import type { TakeLibrary } from '../take/store.ts';
import { physicalView, type WorldState } from '../world/types.ts';
import { affectedSteps, planEnvelope, type AffectedStep, type PlanEnvelope } from './envelope.ts';

/** Everything needed to build a runtime. `services` is a factory: every run gets fresh, unshared service state. */
export type EngineConfig = {
  registry: Map<string, ActionDef>;
  invariants: Invariant[];
  services: (world: WorldState) => RuntimeServices;
  maxTicks?: number;
  keyframeEvery?: number;
  /** Pose-track tolerance of the run's TakeRecorder (default TRACK_TOL). `deploy/record-campus-take.mjs` plans the camera
   *  from a second, exact run (`trackTol: 1`), so thinning never moves a planned camera (TAKES_AND_PLANS.md). */
  trackTol?: number | { pos: number; ang: number };
};

export type RunMetrics = {
  duration: number; // simulated seconds
  ticks: number;
  replans: number; // Σ outputs.replans
  pathLength: number; // Σ outputs.length (m)
  blockedTicks: number;
  violations: number;
};

export type RunReport = {
  status: SequenceStatus;
  ok: boolean; // completed with zero invariant violations
  planHash: string;
  baselineCheckpoint: string;
  steps: StepReport[];
  diagnostics: Diagnostic[];
  violations: Violation[];
  metrics: RunMetrics;
  finalStateHash: string;
  /** Steps cut short by a timeout / abort (see SequenceResult.cut). */
  cut: string[];
  /** No live actions and no held-without-holder supports at the end: safe to treat as a resting state. */
  settled: boolean;
  unsettled: string[];
};

export type EntityDiff = { id: string; fields: string[] };
export type PhysicalDiff = {
  base: boolean;
  added: string[];
  removed: string[];
  changed: EntityDiff[];
  regions: string[];
  other: string[]; // top-level physical fields (inventory, rng)
};

/** `affected`: the steps the change reaches and why (region-scoped staleness, envelope.ts); absent when not scoped. */
export type StaleInfo = { code: 'plan.stale'; message: string; diff?: PhysicalDiff; affected?: AffectedStep[] };
/** The head differs physically from the plan's baseline, but outside every step's envelope: the plan stays valid. */
export type ScopedPass = { diff: PhysicalDiff; summary: string };
/** Supplies the plan's envelope on demand (null = none available: any physical change stales the plan). */
export type EnvelopeSource = () => PlanEnvelope | null;

export type RehearsalResult = { report: RunReport; take: Take; finalState: WorldState; stale?: StaleInfo; envelope?: PlanEnvelope; outsideEnvelope?: ScopedPass };

export type ExecuteResult =
  | { ok: true; checkpoint: Checkpoint; report: RunReport; take: Take; outsideEnvelope?: ScopedPass }
  | { ok: false; code: 'plan.stale' | 'workspace.protected' | 'plan.corrupt'; message: string; diff?: PhysicalDiff; affected?: AffectedStep[] }
  | { ok: false; code: 'execution.failed'; message: string; report: RunReport; take: Take };

/** Fresh services for `world` from the factory; refuses a spatial service built for another static base. */
export function runServices(world: WorldState, cfg: EngineConfig): RuntimeServices {
  const services = cfg.services(world);
  const sp = services.spatial as { base?: unknown; baseId?: string } | undefined;
  if (sp && sp.base !== undefined && (sp.baseId ?? hashOf(sp.base)) !== world.base.staticHash)
    throw new HistoryError(
      'services.base-mismatch',
      `the spatial service's static scene does not match the world's base (${world.base.campus}, staticHash ${world.base.staticHash.slice(0, 12)})`,
    );
  return services;
}

/** The one execution path. Pure w.r.t. history: takes a private copy of the start state. */
export function runPlan(start: WorldState, startCheckpoint: string, plan: BoundPlan, cfg: EngineConfig, rulesVersion: string) {
  const world = structuredClone(start);
  const rt = new Runtime(world, cfg.registry, runServices(world, cfg), cfg.invariants);
  const rec = new TakeRecorder(rt, { planHash: plan.planHash, baselineCheckpoint: startCheckpoint, rulesVersion, keyframeEvery: cfg.keyframeEvery, ...(cfg.trackTol !== undefined ? { tol: cfg.trackTol } : {}) });
  const res = new SequenceRunner(rt, plan.steps).run(cfg.maxTicks);
  const take = rec.finish();
  return { report: runReport(res, take, plan.planHash, startCheckpoint), take, finalState: rt.world };
}

/** RunReport of a sequence result (a whole run, or a resumed run's last segment: its runner spans the whole run). */
export function runReport(res: SequenceResult, take: Take, planHash: string, baselineCheckpoint: string): RunReport {
  let replans = 0, pathLength = 0, blockedTicks = 0;
  for (const s of res.steps) {
    blockedTicks += s.blockedTicks;
    if (typeof s.outputs?.replans === 'number') replans += s.outputs.replans;
    if (typeof s.outputs?.length === 'number') pathLength += s.outputs.length;
  }
  return {
    status: res.status,
    ok: res.status === 'completed' && res.violations.length === 0,
    planHash,
    baselineCheckpoint,
    steps: res.steps,
    diagnostics: res.diagnostics,
    violations: res.violations,
    metrics: { duration: res.ticks * take.dt, ticks: res.ticks, replans, pathLength, blockedTicks, violations: res.violations.length },
    finalStateHash: take.finalStateHash,
    cut: res.cut,
    settled: res.settled,
    unsettled: res.unsettled,
  };
}

/** Which physically relevant parts of two states differ (entities by id and field). */
export function physicalDiff(a: WorldState, b: WorldState): PhysicalDiff {
  const pa = physicalView(a) as ReturnType<typeof physicalView> & Record<string, unknown>;
  const pb = physicalView(b) as ReturnType<typeof physicalView> & Record<string, unknown>;
  const ea = pa.entities as Record<string, Record<string, unknown>>, eb = pb.entities as Record<string, Record<string, unknown>>;
  const out: PhysicalDiff = { base: stableStringify(pa.base) !== stableStringify(pb.base), added: [], removed: [], changed: [], regions: [], other: [] };
  for (const id of Object.keys(eb).sort()) if (!ea[id]) out.added.push(id);
  for (const id of Object.keys(ea).sort()) {
    if (!eb[id]) {
      out.removed.push(id);
      continue;
    }
    const fields = [...new Set([...Object.keys(ea[id]), ...Object.keys(eb[id])])].sort().filter((k) => stableStringify(ea[id][k]) !== stableStringify(eb[id][k]));
    if (fields.length) out.changed.push({ id, fields });
  }
  const ra = new Map(pa.regions.map((r) => [r[0] as string, stableStringify(r)]));
  const rb = new Map(pb.regions.map((r) => [r[0] as string, stableStringify(r)]));
  for (const id of [...new Set([...ra.keys(), ...rb.keys()])].sort()) if (ra.get(id) !== rb.get(id)) out.regions.push(id);
  for (const k of Object.keys(pa).sort())
    if (!['base', 'entities', 'regions'].includes(k) && stableStringify(pa[k]) !== stableStringify(pb[k])) out.other.push(k);
  return out;
}

export function describeDiff(d: PhysicalDiff): string {
  const parts: string[] = [];
  if (d.base) parts.push('static base geometry changed');
  for (const c of d.changed) parts.push(`${c.id} changed (${c.fields.join(', ')})`);
  if (d.added.length) parts.push(`added ${d.added.join(', ')}`);
  if (d.removed.length) parts.push(`removed ${d.removed.join(', ')}`);
  if (d.regions.length) parts.push(`regions changed: ${d.regions.join(', ')}`);
  if (d.other.length) parts.push(`${d.other.join(', ')} changed`);
  return parts.join('; ') || 'no physical difference';
}

/**
 * Does the workspace head still match the plan's assumptions? Env/camera/label-only edits pass. A physical
 * change passes too when `envelope` supplies the plan's per-step envelope and the change is outside all of
 * it (region-scoped staleness, envelope.ts); then `outsideEnvelope` describes what was ignored.
 */
export function checkPlan(
  history: WorldHistory,
  workspaceId: string,
  plan: BoundPlan,
  envelope?: EnvelopeSource,
): ({ ok: true; head: Checkpoint; outsideEnvelope?: ScopedPass }) | ({ ok: false; head: Checkpoint } & StaleInfo) {
  const head = history.head(workspaceId);
  if (plan.rulesVersion !== history.rulesVersion)
    return { ok: false, head, code: 'plan.stale', message: `plan ${plan.planHash} was validated under rules ${plan.rulesVersion}; the runtime is now ${history.rulesVersion} — rehearse and rebind` };
  if (head.physicalHash === plan.baselinePhysicalHash) return { ok: true, head };
  const before = history.read(plan.baselineCheckpoint), after = history.read(head.id);
  const diff = physicalDiff(before, after);
  // physically identical (a checkpoint hashed under an older physicalView): nothing to scope
  if (!diff.base && !diff.added.length && !diff.removed.length && !diff.changed.length && !diff.regions.length && !diff.other.length) return { ok: true, head };
  const env = envelope?.() ?? null;
  const summary = describeDiff(diff);
  if (!env)
    return {
      ok: false,
      head,
      code: 'plan.stale',
      message: `workspace ${workspaceId} changed physically since plan ${plan.planHash} was validated against ${plan.baselineCheckpoint}: ${summary} — revalidate (rehearse/rebind) before executing`,
      diff,
    };
  const affected = affectedSteps(env, before, after, diff);
  if (!affected.length) return { ok: true, head, outsideEnvelope: { diff, summary } };
  const named = affected.slice(0, 8).map((a) => `step ${a.step} ← ${a.causes.join(', ')}`).join('; ');
  return {
    ok: false,
    head,
    code: 'plan.stale',
    message: `workspace ${workspaceId} changed physically since plan ${plan.planHash} was validated against ${plan.baselineCheckpoint}: ${summary}; inside the plan's route/footprint: ${named}${affected.length > 8 ? ` (+${affected.length - 8} more steps)` : ''} — revalidate (rehearse, or rebind: 'auto') before executing`,
    diff,
    affected,
  };
}

/**
 * The plan's envelope from a run from its own baseline checkpoint (deterministic; one full run), or null
 * when that run does not complete cleanly (then there is no trustworthy route to scope staleness to).
 */
export function baselineEnvelope(history: WorldHistory, plan: BoundPlan, cfg: EngineConfig): PlanEnvelope | null {
  const start = history.read(plan.baselineCheckpoint);
  const r = runPlan(start, plan.baselineCheckpoint, plan, cfg, history.rulesVersion);
  return r.report.ok ? planEnvelope(plan, start, r.take, r.report.steps) : null;
}

export function integrity(history: WorldHistory, plan: BoundPlan): string | null {
  if (planHashOf(plan) !== plan.planHash) return `plan content does not match its planHash ${plan.planHash}`;
  const cp = history.checkpoint(plan.baselineCheckpoint);
  if (cp.physicalHash !== plan.baselinePhysicalHash) return `baseline checkpoint ${cp.id} physical hash ${cp.physicalHash.slice(0, 12)} ≠ plan's ${plan.baselinePhysicalHash.slice(0, 12)}`;
  return null;
}

/**
 * Run the plan privately from its own baseline checkpoint. Never touches the
 * history (reads a structured clone) or any live runtime. `stale` reports
 * whether executing in `workspaceId` right now would be refused.
 */
export function rehearse(history: WorldHistory, workspaceId: string, plan: BoundPlan, cfg: EngineConfig): RehearsalResult {
  const bad = integrity(history, plan);
  if (bad) throw new HistoryError('plan.corrupt', bad);
  if (plan.rulesVersion !== history.rulesVersion)
    throw new HistoryError('plan.stale', `plan was bound under rules ${plan.rulesVersion}; runtime is ${history.rulesVersion} — rebind`);
  const start = history.read(plan.baselineCheckpoint);
  const r = runPlan(start, plan.baselineCheckpoint, plan, cfg, history.rulesVersion);
  const envelope = r.report.ok ? planEnvelope(plan, start, r.take, r.report.steps) : undefined;
  const chk = checkPlan(history, workspaceId, plan, () => envelope ?? null);
  const withEnv = envelope ? { ...r, envelope } : r;
  if (chk.ok) return chk.outsideEnvelope ? { ...withEnv, outsideEnvelope: chk.outsideEnvelope } : withEnv;
  return { ...withEnv, stale: { code: chk.code, message: chk.message, ...(chk.diff ? { diff: chk.diff } : {}), ...(chk.affected ? { affected: chk.affected } : {}) } };
}

/**
 * Official execution in a workspace: refuse protected canonical workspaces and
 * stale plans, run from the workspace head (physically identical to the plan's
 * baseline; env/labels may differ and are carried forward), record the take,
 * and commit the successor with cause simulation-run. A run that does not
 * complete cleanly is not committed unless `commitOnFailure` is set.
 */
export function execute(
  history: WorldHistory,
  workspaceId: string,
  plan: BoundPlan,
  cfg: EngineConfig,
  opts: { takes?: TakeLibrary; commitOnFailure?: boolean; label?: string; envelope?: EnvelopeSource } = {},
): ExecuteResult {
  const ws = history.workspaces.get(workspaceId);
  if (!ws) throw new HistoryError('unknown-workspace', `no workspace ${workspaceId}`);
  if (ws.protected)
    return { ok: false, code: 'workspace.protected', message: `workspace "${ws.label}" is a protected canonical state; fork it and execute in the fork` };
  const bad = integrity(history, plan);
  if (bad) return { ok: false, code: 'plan.corrupt', message: bad };
  const chk = checkPlan(history, workspaceId, plan, opts.envelope);
  if (!chk.ok) return { ok: false, code: chk.code, message: chk.message, diff: chk.diff, ...(chk.affected ? { affected: chk.affected } : {}) };
  const { report, take, finalState } = runPlan(history.read(chk.head.id), chk.head.id, plan, cfg, history.rulesVersion);
  opts.takes?.put(take);
  // an unsettled final state (live actions, loads held by nobody) is never committed as a resumable checkpoint (§22)
  if (!report.ok && (!opts.commitOnFailure || !report.settled))
    return {
      ok: false,
      code: 'execution.failed',
      message: `plan ${plan.planHash} did not complete cleanly (${report.status}, ${report.violations.length} violations): ${report.diagnostics.map((d) => d.message).join('; ') || report.violations.map((v) => v.message).join('; ')}`,
      report,
      take,
    };
  const checkpoint = history.commit(workspaceId, finalState, { kind: 'simulation-run', take: take.id, plan: plan.planHash }, opts.label);
  return chk.outsideEnvelope ? { ok: true, checkpoint, report, take, outsideEnvelope: chk.outsideEnvelope } : { ok: true, checkpoint, report, take };
}
