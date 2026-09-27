// Rehearsal and official execution (spec §16, §21–22). Both go through the
// single `runPlan` below: same registry, same invariants, fresh services from
// the same factory, same Runtime class, same sequence runner, same recorder.
// There is no fast path. They differ only in where the start state comes from
// and whether the successor state is committed.
import type { ActionDef, Diagnostic } from '../actions/types.ts';
import { hashOf, stableStringify } from '../core/hash.ts';
import { HistoryError, type Checkpoint, type WorldHistory } from '../history/store.ts';
import { Runtime, type Invariant, type Violation } from '../runtime/runtime.ts';
import { SequenceRunner, type SequenceStatus, type StepReport } from '../sequence/runner.ts';
import type { BoundPlan } from '../sequence/types.ts';
import { planHashOf } from '../sequence/bind.ts';
import { TakeRecorder } from '../take/recorder.ts';
import type { Take } from '../take/types.ts';
import type { TakeLibrary } from '../take/store.ts';
import { physicalView, type WorldState } from '../world/types.ts';

/** Everything needed to build a runtime. `services` is a factory: every run gets fresh, unshared service state. */
export type EngineConfig = {
  registry: Map<string, ActionDef>;
  invariants: Invariant[];
  services: (world: WorldState) => Record<string, any>;
  maxTicks?: number;
  keyframeEvery?: number;
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

export type StaleInfo = { code: 'plan.stale'; message: string; diff?: PhysicalDiff };

export type RehearsalResult = { report: RunReport; take: Take; finalState: WorldState; stale?: StaleInfo };

export type ExecuteResult =
  | { ok: true; checkpoint: Checkpoint; report: RunReport; take: Take }
  | { ok: false; code: 'plan.stale' | 'workspace.protected' | 'plan.corrupt'; message: string; diff?: PhysicalDiff }
  | { ok: false; code: 'execution.failed'; message: string; report: RunReport; take: Take };

/** The one execution path. Pure w.r.t. history: takes a private copy of the start state. */
export function runPlan(start: WorldState, startCheckpoint: string, plan: BoundPlan, cfg: EngineConfig, rulesVersion: string) {
  const world = structuredClone(start);
  const services = cfg.services(world);
  const sp = services.spatial as { base?: unknown; baseId?: string } | undefined;
  if (sp && sp.base !== undefined && (sp.baseId ?? hashOf(sp.base)) !== world.base.staticHash)
    throw new HistoryError(
      'services.base-mismatch',
      `the spatial service's static scene does not match the world's base (${world.base.campus}, staticHash ${world.base.staticHash.slice(0, 12)})`,
    );
  const rt = new Runtime(world, cfg.registry, services, cfg.invariants);
  const rec = new TakeRecorder(rt, { planHash: plan.planHash, baselineCheckpoint: startCheckpoint, rulesVersion, keyframeEvery: cfg.keyframeEvery });
  const res = new SequenceRunner(rt, plan.steps).run(cfg.maxTicks);
  const take = rec.finish();
  let replans = 0, pathLength = 0, blockedTicks = 0;
  for (const s of res.steps) {
    blockedTicks += s.blockedTicks;
    if (typeof s.outputs?.replans === 'number') replans += s.outputs.replans;
    if (typeof s.outputs?.length === 'number') pathLength += s.outputs.length;
  }
  const report: RunReport = {
    status: res.status,
    ok: res.status === 'completed' && res.violations.length === 0,
    planHash: plan.planHash,
    baselineCheckpoint: startCheckpoint,
    steps: res.steps,
    diagnostics: res.diagnostics,
    violations: res.violations,
    metrics: { duration: res.ticks * take.dt, ticks: res.ticks, replans, pathLength, blockedTicks, violations: res.violations.length },
    finalStateHash: take.finalStateHash,
  };
  return { report, take, finalState: rt.world };
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
  const ra = new Map(pa.regions.map((r) => [String(r[0]), stableStringify(r)]));
  const rb = new Map(pb.regions.map((r) => [String(r[0]), stableStringify(r)]));
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

/** Does the workspace head still match the plan's assumptions? Env/camera/label-only edits pass. */
export function checkPlan(history: WorldHistory, workspaceId: string, plan: BoundPlan): { ok: true; head: Checkpoint } | ({ ok: false; head: Checkpoint } & StaleInfo) {
  const head = history.head(workspaceId);
  if (plan.rulesVersion !== history.rulesVersion)
    return { ok: false, head, code: 'plan.stale', message: `plan ${plan.planHash} was validated under rules ${plan.rulesVersion}; the runtime is now ${history.rulesVersion} — rehearse and rebind` };
  if (head.physicalHash === plan.baselinePhysicalHash) return { ok: true, head };
  const diff = physicalDiff(history.read(plan.baselineCheckpoint), history.read(head.id));
  return {
    ok: false,
    head,
    code: 'plan.stale',
    message: `workspace ${workspaceId} changed physically since plan ${plan.planHash} was validated against ${plan.baselineCheckpoint}: ${describeDiff(diff)} — revalidate (rehearse/rebind) before executing`,
    diff,
  };
}

function integrity(history: WorldHistory, plan: BoundPlan): string | null {
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
  const chk = checkPlan(history, workspaceId, plan);
  return chk.ok ? r : { ...r, stale: { code: chk.code, message: chk.message, diff: chk.diff } };
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
  opts: { takes?: TakeLibrary; commitOnFailure?: boolean; label?: string } = {},
): ExecuteResult {
  const ws = history.workspaces.get(workspaceId);
  if (!ws) throw new HistoryError('unknown-workspace', `no workspace ${workspaceId}`);
  if (ws.protected)
    return { ok: false, code: 'workspace.protected', message: `workspace "${ws.label}" is a protected canonical state; fork it and execute in the fork` };
  const bad = integrity(history, plan);
  if (bad) return { ok: false, code: 'plan.corrupt', message: bad };
  const chk = checkPlan(history, workspaceId, plan);
  if (!chk.ok) return { ok: false, code: chk.code, message: chk.message, diff: chk.diff };
  const { report, take, finalState } = runPlan(history.read(chk.head.id), chk.head.id, plan, cfg, history.rulesVersion);
  opts.takes?.put(take);
  if (!report.ok && !opts.commitOnFailure)
    return {
      ok: false,
      code: 'execution.failed',
      message: `plan ${plan.planHash} did not complete cleanly (${report.status}, ${report.violations.length} violations): ${report.diagnostics.map((d) => d.message).join('; ') || report.violations.map((v) => v.message).join('; ')}`,
      report,
      take,
    };
  const checkpoint = history.commit(workspaceId, finalState, { kind: 'simulation-run', take: take.id, plan: plan.planHash }, opts.label);
  return { ok: true, checkpoint, report, take };
}
