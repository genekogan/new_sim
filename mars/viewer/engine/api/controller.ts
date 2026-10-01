import { sceneForWorld } from '../spatial/edits.ts';
// Engine controller facade (spec §13, §15, §16, §24). One object that the
// browser, Node tests/scripts and the Durable Object all drive with the SAME
// typed operations; MCP tools are generated from `opSchemas` + `call`.
// Deterministic: no wall clock, no Math.random; hosts timestamp metadata
// outside engine state if they want to.
import type { ActionDef, Diagnostic } from '../actions/types.ts';
import { hashOf, stableStringify } from '../core/hash.ts';
import { HistoryError, type Checkpoint, type WorldHistory } from '../history/store.ts';
import { baselineEnvelope, checkPlan, describeDiff, execute as executePlan, integrity, physicalDiff, rehearse as rehearsePlan, runReport, runServices, type EngineConfig, type EnvelopeSource, type RunReport, type StaleInfo } from '../rehearsal/rehearse.ts';
import type { PlanEnvelope } from '../rehearsal/envelope.ts';
import { ActionAdmissionError, DT, Runtime, type Invariant } from '../runtime/runtime.ts';
import { SnapshotError } from '../runtime/snapshot.ts';
import { bindTemplate, PlanError } from '../sequence/bind.ts';
import { DEFAULT_MAX_TICKS, SequenceRunner } from '../sequence/runner.ts';
import { TakeRecorder } from '../take/recorder.ts';
import { PLAN_SCHEMA, SEQUENCE_SCHEMA, templateSchema, type BoundPlan, type SequenceTemplate } from '../sequence/types.ts';
import { sampleTake, takeDuration } from '../take/replay.ts';
import { TakeLibrary } from '../take/store.ts';
import { INTERP_FIELDS, type CameraTrack, type ChangeEvent, type PoseSample, type Take } from '../take/types.ts';
import type { Spatial } from '../spatial/service.ts';
import type { Leg, Route } from '../spatial/path.ts';
import type { CarryProgram } from '../carry/validate.ts';
import type { SpatialScene } from '../spatial/types.ts';
import type { Entity, WorldState } from '../world/types.ts';
import type { CameraDirection } from '../camera/direct.ts';
import { groupStability, isUpright } from '../construction/rules.ts';
import { planCameraTrack } from '../camera/plan.ts';
import { toCameraTrack, withFileCamera } from '../camera/track.ts';
import type { Sampler, ShotSpec, SubjectPose } from '../camera/shots.ts';
import { takeSampler } from '../camera/take-sampler.ts';
import { SemanticWorld, takeFacts, worldFacts } from '../camera/direct.ts';
import { activitiesOf, cameraVocab, parseCameraSentences, type ParsedSentence, type SentenceRefusal } from './camera-vocab.ts';
import { directCamera } from '../camera/synth.ts';
import { createRegistry, describeSequenceVerbs, describeVerbs, engineConfig, ENGINE_INVARIANTS, jsonSchemaOf } from './registry.ts';
import { opSchemas, type OpInput, type OpName } from './schemas.ts';
import { applyEdits } from './edit.ts';
import { appendCommands, describePoint, drive, isPauseSnapshot, liveActions, PAUSE_FORMAT, reached, stepProgress, type PauseContext, type PausePoint, type PauseSnapshot } from './pause.ts';

/** `reboundFrom`: the stale plan this one was re-bound from (engine_execute / engine_rehearse `rebind: 'auto'`, LM-001). */
export type StoredPlan = { plan: BoundPlan; workspace: string; reboundFrom?: string };

/** Optional lazy loaders (the DO keeps takes/plans/cameras in SQLite and loads them on demand). */
export type ControllerStore = {
  loadTake?(id: string): Take | undefined;
  loadPlan?(id: string): StoredPlan | undefined;
  loadCameras?(takeId: string): CameraTrack[] | undefined;
  /** Stored plan/take ids oldest first with their stored sizes (engine_list); default: the in-memory maps. */
  listStored?(): { plans: { id: string; bytes: number }[]; takes: { id: string; bytes: number; cameras: boolean }[] };
};

/** What an operation changed, for hosts that persist incrementally. */
export type Changes = { history: boolean; takes: string[]; plans: string[]; cameras: string[] };

export type ControllerOptions = {
  history: WorldHistory;
  /** Static scenes by world.base.campus (the services factory builds fresh Spatial state per run from these). */
  scenes: Record<string, SpatialScene>;
  registry?: Map<string, ActionDef>;
  invariants?: Invariant[];
  /** Override the services factory (default: Spatial over `scenes` + construction contributors). */
  services?: EngineConfig['services'];
  /** Rack climb links / beam walkways in the spatial scene (default true; registry.ts servicesFor). */
  frameAccess?: boolean;
  maxTicks?: number;
  store?: ControllerStore;
};

export type OpResult = { ok: boolean; [k: string]: unknown };

const r2 = (x: number) => Math.round(x * 100) / 100;
/** Seconds without float noise from tick × dt (1 µs resolution). */
const sec = (x: number) => Math.round(x * 1e6) / 1e6;
const fail = (code: string, message: string, extra: Record<string, unknown> = {}): OpResult => ({ ok: false, code, message, ...extra });

/** Input bounds checked before zod sees the input (zod, stableStringify and structuredClone all recurse). */
export const MAX_INPUT_DEPTH = 32;
export const MAX_INPUT_BYTES = 256 * 1024;
/** Unkept rehearsal takes held in memory per controller (oldest dropped first). */
export const UNKEPT_TAKES = 8;
/** Plan envelopes (region-scoped staleness) cached in memory per controller; recomputed on demand (deterministic). */
export const ENVELOPES = 16;
/**
 * Camera tracks stored beside one take, in bytes of JSON (all its tracks together): a byte cap, not a count
 * (LM-018: counts let one long track outgrow a DO value; the room chunks values, so the cap bounds the take's
 * `cams/<take>` blob). engine_store_camera_track accepts an input up to this size too.
 */
export const MAX_TAKE_CAMERA_BYTES = 4 * 1024 * 1024;

/**
 * Iterative (stack-safe) pre-check of an op input: nesting depth and an estimate of its
 * JSON-serialized size, both bailing out at the first violation. Returns a diagnostic or null.
 */
export function checkInputBounds(input: unknown, maxDepth = MAX_INPUT_DEPTH, maxBytes = MAX_INPUT_BYTES): string | null {
  const stack: [unknown, number, string][] = [[input, 0, '(root)']];
  let bytes = 0;
  while (stack.length) {
    const [v, depth, path] = stack.pop()!;
    if (v === null || typeof v !== 'object') {
      bytes += typeof v === 'string' ? v.length + 2 : typeof v === 'number' ? String(v).length : typeof v === 'boolean' ? 5 : 4;
    } else {
      if (depth >= maxDepth) return `input nesting exceeds ${maxDepth} levels at ${path}`;
      if (Array.isArray(v)) {
        bytes += 2 + v.length;
        if (bytes > maxBytes) break;
        for (let i = v.length - 1; i >= 0; i--) stack.push([v[i], depth + 1, `${path}[${i}]`]);
      } else {
        const keys = Object.keys(v);
        bytes += 2;
        for (let i = keys.length - 1; i >= 0; i--) {
          bytes += keys[i].length + 4;
          stack.push([(v as Record<string, unknown>)[keys[i]], depth + 1, `${path}.${keys[i]}`]);
        }
      }
    }
    if (bytes > maxBytes) break;
  }
  return bytes > maxBytes ? `input exceeds ${Math.round(maxBytes / 1024)} KiB when serialized` : null;
}

function compactEntity(e: Entity) {
  const out: Record<string, unknown> = { id: e.id, def: e.def, kind: e.kind, pose: { p: e.pose.p.map(r2), yaw: r2(e.pose.yaw), ...(e.pose.pitch ? { pitch: r2(e.pose.pitch) } : {}), ...(e.pose.roll ? { roll: r2(e.pose.roll) } : {}) } };
  if (e.label && e.label !== e.id) out.label = e.label;
  if (e.phase) out.phase = e.phase;
  if (e.support) out.support = e.support;
  if (e.connections?.length) out.connections = e.connections;
  if (e.human) out.human = e.human;
  if (e.reservedBy) out.reservedBy = e.reservedBy;
  if (e.provenance.origin !== 'test-fixture') out.provenance = e.provenance;
  return out;
}

function summariseLegs(legs: Leg[]) {
  return legs.map((l) =>
    l.kind === 'walk' ? { kind: 'walk', level: l.level, points: l.points.map((p) => [r2(p[0]), r2(p[1])]), minClearance: r2(l.minClearance) } : { kind: 'link', link: l.link.id, ascending: l.ascending },
  );
}

export function compactReport(r: RunReport) {
  const byCode: Record<string, number> = {};
  for (const v of r.violations) byCode[v.code] = (byCode[v.code] ?? 0) + 1;
  return {
    status: r.status,
    ok: r.ok,
    planHash: r.planHash,
    baselineCheckpoint: r.baselineCheckpoint,
    metrics: { ...r.metrics, duration: r2(r.metrics.duration), pathLength: r2(r.metrics.pathLength) },
    finalStateHash: r.finalStateHash,
    diagnostics: r.diagnostics,
    violations: { count: r.violations.length, byCode, first: r.violations.slice(0, 20) },
    steps: r.steps.map((s) => ({
      id: s.id,
      verb: s.verb,
      status: s.status,
      started: s.started,
      submittedTick: s.submittedTick,
      endedTick: s.endedTick,
      blockedTicks: s.blockedTicks,
      ...(s.cueLateTicks ? { cueLateTicks: s.cueLateTicks } : {}),
      ...(s.diagnostic ? { diagnostic: s.diagnostic } : {}),
      ...(s.outputs ? { outputs: s.outputs } : {}),
    })),
  };
}

export function takeSummary(t: Take) {
  let samples = 0;
  for (const s of Object.values(t.tracks)) samples += s.length;
  return {
    take_id: t.id,
    duration: r2(takeDuration(t)),
    ticks: t.ticks,
    dt: t.dt,
    entities: Object.keys(t.tracks).sort(),
    samples,
    events: t.events.length,
    changes: t.changes.length,
    bytes: stableStringify(t).length,
    finalStateHash: t.finalStateHash,
  };
}

/** Take-shaped slice [t0, t1] (ticks): sampleTake(slice, t) equals sampleTake(take, t) for t in range. */
export function sliceTake(take: Take, t0: number, t1: number, entities?: string[]) {
  const keep = entities ? new Set(entities) : null;
  const tracks: Record<string, PoseSample[]> = {};
  for (const id of Object.keys(take.tracks)) {
    if (keep && !keep.has(id)) continue;
    const s = take.tracks[id];
    let a = 0, b = s.length - 1;
    while (a < s.length - 1 && s[a + 1][0] <= t0) a++;
    while (b > 0 && s[b - 1][0] >= t1) b--;
    tracks[id] = s.slice(a, b + 1).map((x) => [...x]);
  }
  // fold discrete state up to t0 into synthetic changes at t0, then real changes in (t0, t1]. Interpolated fields
  // (mars-take/3 INTERP_FIELDS) keep their bracketing keyframes instead: the last one ≤ t0 at its own tick, and the
  // first one after t1 — like the tracks' bracketing samples.
  const folded = new Map<string, Map<string, ChangeEvent>>();
  const changes: ChangeEvent[] = [];
  const tail: ChangeEvent[] = [];
  const after = new Set<string>();
  for (const c of take.changes) {
    if (keep && !keep.has(c[1])) continue;
    if (c[0] <= t0) {
      let m = folded.get(c[1]);
      if (!m) folded.set(c[1], (m = new Map()));
      m.set(c[2], c);
    } else if (c[0] <= t1) changes.push(structuredClone(c));
    else if (c[2] in INTERP_FIELDS && !after.has(`${c[1]}|${c[2]}`)) {
      after.add(`${c[1]}|${c[2]}`);
      tail.push(structuredClone(c));
    }
  }
  const head: ChangeEvent[] = [];
  for (const [id, m] of folded) for (const [f, c] of m) head.push([f in INTERP_FIELDS ? c[0] : t0, id, f, structuredClone(c[3])]);
  head.sort((a, b) => a[0] - b[0]);
  return { tracks, changes: [...head, ...changes, ...tail], events: take.events.filter((e) => e.t >= t0 && e.t <= t1).map((e) => structuredClone(e)) };
}

export class EngineController {
  readonly history: WorldHistory;
  readonly scenes: Record<string, SpatialScene>;
  readonly registry: Map<string, ActionDef>;
  readonly cfg: EngineConfig;
  readonly takes = new TakeLibrary();
  readonly plans = new Map<string, StoredPlan>();
  private store: ControllerStore;
  private camerasLoaded = new Set<string>();
  /** Rehearsal takes not kept (`keep: false`): in memory only, newest UNKEPT_TAKES, never persisted. */
  private unkept = new Map<string, Take>();
  private envelopes = new Map<string, PlanEnvelope | null>();
  private changes: Changes = { history: false, takes: [], plans: [], cameras: [] };

  constructor(o: ControllerOptions) {
    this.history = o.history;
    this.scenes = o.scenes;
    this.registry = o.registry ?? createRegistry();
    const base = engineConfig(o.scenes, { registry: this.registry, invariants: o.invariants ?? ENGINE_INVARIANTS, maxTicks: o.maxTicks, frameAccess: o.frameAccess });
    this.cfg = o.services ? { ...base, services: o.services } : base;
    this.store = o.store ?? {};
  }

  /** Validate `input` with the op's zod schema and dispatch. Never throws for engine-level failures. */
  call(name: string, input: unknown): OpResult {
    if (!Object.hasOwn(opSchemas, name)) return fail('op.unknown', `no engine operation "${name}"`);
    try {
      const bounds = checkInputBounds(input ?? {}, MAX_INPUT_DEPTH, name === 'store_camera_track' ? MAX_TAKE_CAMERA_BYTES : MAX_INPUT_BYTES);
      if (bounds) return fail('input.invalid', `${name}: ${bounds}`);
      let parsed;
      try {
        parsed = opSchemas[name as OpName].safeParse(input ?? {});
      } catch (e) {
        return fail('input.invalid', `${name}: input could not be validated (${e instanceof Error ? e.message : String(e)})`);
      }
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => ({ path: i.path.join('.') || '(root)', message: i.message }));
        return fail('op.invalid-input', `${name}: ${uniqueMessage(`input: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`)}`, { details: { issues } });
      }
      switch (name as OpName) {
        case 'list_verbs': return this.listVerbs();
        case 'query_world': return this.queryWorld(parsed.data as OpInput<'query_world'>);
        case 'bind_plan': return this.bindPlan(parsed.data as OpInput<'bind_plan'>);
        case 'rehearse': return this.rehearse(parsed.data as OpInput<'rehearse'>);
        case 'execute': return this.execute(parsed.data as OpInput<'execute'>);
        case 'resume': return this.resume(parsed.data as OpInput<'resume'>);
        case 'fork': return this.fork(parsed.data as OpInput<'fork'>);
        case 'edit_world': return this.editWorld(parsed.data as OpInput<'edit_world'>);
        case 'log': return this.log(parsed.data as OpInput<'log'>);
        case 'list': return this.list(parsed.data as OpInput<'list'>);
        case 'delete_workspace': return this.deleteWorkspace(parsed.data as OpInput<'delete_workspace'>);
        case 'get_take': return this.getTake(parsed.data as OpInput<'get_take'>);
        case 'attach_camera_track': return this.attachCameraTrack(parsed.data as OpInput<'attach_camera_track'>);
        case 'direct_camera': return this.directCameraOp(parsed.data as OpInput<'direct_camera'>);
        case 'parse_camera': return this.parseCamera(parsed.data as OpInput<'parse_camera'>);
        case 'store_camera_track': return this.storeCameraTrack(parsed.data as OpInput<'store_camera_track'>);
      }
    } catch (e) {
      if (e instanceof PlanError) return fail(e.code, e.message, { diagnostics: e.diagnostics });
      if (e instanceof HistoryError) return fail(e.code, e.message);
      if (e instanceof ActionAdmissionError) return fail(e.diagnostic.code, e.message, { diagnostics: [e.diagnostic] });
      return fail('engine.error', e instanceof Error ? e.message : String(e));
    }
    return fail('op.unknown', name);
  }

  /** Changes since the last drain (history rewritten? new takes / plans / camera sets). */
  drainChanges(): Changes {
    const c = this.changes;
    this.changes = { history: false, takes: [], plans: [], cameras: [] };
    return c;
  }

  // ---- read-only -------------------------------------------------------------------------------

  listVerbs(): OpResult {
    return {
      ok: true,
      rulesVersion: this.history.rulesVersion,
      dt: DT,
      templateSchema: SEQUENCE_SCHEMA,
      planSchema: PLAN_SCHEMA,
      verbs: describeVerbs(this.registry),
      sequenceVerbs: describeSequenceVerbs(),
      templateJsonSchema: jsonSchemaOf(templateSchema),
    };
  }

  workspaces() {
    return [...this.history.workspaces.values()].map((w) => ({
      id: w.id,
      label: w.label,
      protected: w.protected,
      head: w.head,
      forkedFrom: w.forkedFrom,
      campus: this.history.read(w.head).base.campus,
      ...(this.history.checkpoint(w.head).resume ? { paused: true } : {}),
    }));
  }

  /**
   * Takes and plans named by a `simulation-run` cause on a checkpoint reachable from a live workspace
   * head (id → those checkpoint ids). Unreferenced ones are what the room evicts first.
   */
  referencedRuns(): { takes: Map<string, string[]>; plans: Map<string, string[]> } {
    const takes = new Map<string, string[]>(), plans = new Map<string, string[]>();
    const seen = new Set<string>();
    const add = (m: Map<string, string[]>, k: string, cp: string) => {
      const l = m.get(k);
      if (l) l.push(cp);
      else m.set(k, [cp]);
    };
    for (const ws of this.history.workspaces.values())
      for (let id: string | null = ws.head; id && !seen.has(id); id = this.history.checkpoint(id).parent) {
        seen.add(id);
        const c = this.history.checkpoint(id).cause;
        if (c.kind !== 'simulation-run' && c.kind !== 'pause') continue;
        if (c.take) add(takes, c.take, id);
        if (c.plan) add(plans, c.plan, id);
      }
    return { takes, plans };
  }

  list(q: OpInput<'list'>): OpResult {
    const inc = new Set(q.include ?? ['plans', 'takes', 'workspaces']);
    const refs = this.referencedRuns();
    const stored = this.store.listStored?.() ?? {
      plans: [...this.plans.entries()].map(([id, p]) => ({ id, bytes: JSON.stringify(p).length })),
      takes: (this.takes.toJSON().takes as Take[]).map((t) => ({ id: t.id, bytes: JSON.stringify(t).length, cameras: this.takes.cameras(t.id).length > 0 })),
    };
    const out: OpResult = { ok: true };
    if (inc.has('plans'))
      out.plans = stored.plans.map((s, order) => {
        const p = this.plan(s.id);
        return { plan_id: s.id, order, bytes: s.bytes, template: p?.plan.template.id, workspace: p?.workspace || undefined, baselineCheckpoint: p?.plan.baselineCheckpoint, rulesVersion: p?.plan.rulesVersion, referencedByCheckpoint: refs.plans.get(s.id) ?? [] };
      });
    if (inc.has('takes')) {
      const kept = stored.takes.map((s, order) => ({ take_id: s.id, order, kept: true, bytes: s.bytes, cameras: s.cameras, referencedByCheckpoint: refs.takes.get(s.id) ?? [] }));
      const known = new Set(kept.map((t) => t.take_id));
      const unkept = [...this.unkept.values()].filter((t) => !known.has(t.id)).map((t, i) => ({ take_id: t.id, order: kept.length + i, kept: false, bytes: JSON.stringify(t).length, cameras: false, referencedByCheckpoint: refs.takes.get(t.id) ?? [] }));
      out.takes = [...kept, ...unkept];
    }
    if (inc.has('workspaces')) {
      const all = this.workspaces();
      out.workspaces = all.map((w) => ({ ...w, forks: all.filter((o) => o.forkedFrom === w.id).map((o) => o.id) }));
    }
    if (q.take_id) {
      if (!this.take(q.take_id)) return this.noTake(q.take_id);
      out.take_id = q.take_id;
      out.cameras = this.cameras(q.take_id).map((c) => {
        const d = c.data as { spec?: { kind?: string; subject?: string }; hz?: number; duration?: number; samples?: unknown[] };
        return { id: c.id, kind: c.kind, shot: d?.spec?.kind, subject: d?.spec?.subject, hz: d?.hz, duration: d?.duration };
      });
    }
    return out;
  }

  deleteWorkspace(q: OpInput<'delete_workspace'>): OpResult {
    const ws = this.history.workspaces.get(q.workspace);
    if (!ws) return fail('unknown-workspace', `no workspace ${q.workspace}`);
    if (ws.protected) return fail('workspace.protected', `workspace "${ws.label}" is a protected canonical state and cannot be deleted`);
    const forks = [...this.history.workspaces.values()].filter((w) => w.forkedFrom === ws.id).map((w) => w.id).sort();
    if (forks.length)
      return fail('workspace.has-forks', `workspace ${ws.id} is the fork parent of ${forks.join(', ')}; delete ${forks.length > 1 ? 'those' : 'that'} first`, { details: { forks } });
    this.history.deleteWorkspace(ws.id);
    this.changes.history = true;
    return { ok: true, deleted: ws.id, head: ws.head, note: 'its checkpoints stay addressable by id (engine_fork `at`); plans/takes referenced only from it are now evictable' };
  }

  queryWorld(q: OpInput<'query_world'>): OpResult {
    if (!q.workspace) return { ok: true, workspaces: this.workspaces() };
    const world = this.history.read(q.workspace);
    const ws = this.history.workspaces.get(q.workspace);
    const cp = this.history.checkpoint(ws ? ws.head : q.workspace);
    const needle = q.label?.toLowerCase();
    const inRegion = (e: Entity) => !q.region || (e.pose.p[0] >= q.region.min[0] && e.pose.p[0] <= q.region.max[0] && e.pose.p[2] >= q.region.min[1] && e.pose.p[2] <= q.region.max[1]);
    const all = Object.keys(world.entities).sort().map((id) => world.entities[id]);
    const matched = all.filter((e) => (!q.ids || q.ids.includes(e.id)) && (!q.kind || e.kind === q.kind) && (!needle || [e.id, e.label ?? '', e.def].some((s) => s.toLowerCase().includes(needle))) && inRegion(e));
    const limit = q.limit ?? 100;
    const out: OpResult = {
      ok: true,
      workspace: q.workspace,
      checkpoint: cp.id,
      protected: ws?.protected ?? true,
      campus: world.base.campus,
      env: world.env,
      entityCount: all.length,
      matched: matched.length,
      entities: matched.slice(0, limit).map(compactEntity),
      ...(matched.length > limit ? { truncated: true } : {}),
    };
    const inc = new Set(q.include ?? []);
    if (inc.has('regions')) out.regions = Object.values(world.regions);
    if (inc.has('levels') || inc.has('links') || inc.has('obstacles')) {
      const sp = this.cfg.services(world).spatial as Spatial;
      sp.sync(world);
      if (inc.has('obstacles')) out.obstacles = sp.scene.obstacles;
      if (inc.has('levels'))
        out.levels = sp.scene.levels.map((l) => ({ ...l, surfaces: sp.scene.surfaces.filter((s) => s.level === l.id).map((s) => ({ id: s.id, label: s.label, y: s.y, obb: s.obb })) }));
      if (inc.has('links'))
        out.links = sp.scene.links.map((l) => ({ id: l.id, kind: l.kind, usable: l.usable, ...(l.reason ? { reason: l.reason } : {}), from: l.from, to: l.to, width: l.width }));
    }
    if (inc.has('stability')) {
      const seen = new Set<string>();
      const reports = [];
      for (const e of all) {
        if (!isUpright(e) || seen.has(e.id)) continue;
        const r = groupStability(world, e);
        for (const g of r.group) seen.add(g);
        reports.push(r);
      }
      out.stability = reports;
    }
    if (q.route) out.route = this.preview(world, 'walk_to', q.route, (prog: Route) => ({ length: r2(prog.length), legs: summariseLegs(prog.legs) }));
    if (q.carry)
      out.carry = this.preview(world, 'carry', q.carry, (p: CarryProgram) => {
        const poses = p.traj.poses as { x: number; z: number; th: number }[];
        const step = Math.max(1, Math.ceil(poses.length / 60));
        return {
          load: p.f?.defId,
          crew: p.crew,
          level: p.level,
          length: r2(p.traj.length),
          rotation: r2(p.traj.rotation),
          reverse: r2(p.traj.reverse),
          expanded: p.stats?.expanded,
          keyposes: p.stats?.keyposes,
          path: poses.filter((_, i) => i % step === 0 || i === poses.length - 1).map((s) => [r2(s.x), r2(s.z), r2(s.th)]),
        };
      });
    return out;
  }

  /** Validate + plan one verb against a private copy of `world` with fresh services (the runtime's own plan()). */
  private preview<P>(world: WorldState, verb: string, params: unknown, summarise: (program: P) => unknown) {
    const def = this.registry.get(verb);
    if (!def) return { ok: false, diagnostic: { code: 'action.unknown-verb', message: `no verb ${verb}` } };
    const parsed = def.schema.safeParse(params);
    if (!parsed.success) return { ok: false, diagnostic: { code: 'action.invalid-params', message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') } };
    const w = structuredClone(world);
    const rt = new Runtime(w, this.registry, this.cfg.services(w), []);
    const r = def.plan(rt, parsed.data);
    return r.ok ? { ok: true, ...(summarise(r.program as P) as object), ...(r.notes ? { notes: r.notes } : {}) } : { ok: false, diagnostic: r.diagnostic as Diagnostic };
  }

  log(q: OpInput<'log'>): OpResult {
    if (!q.workspace) return { ok: true, workspaces: this.workspaces() };
    const cps = this.history.log(q.workspace).slice(0, q.limit ?? 50);
    return { ok: true, workspace: q.workspace, head: cps[0]?.id, checkpoints: cps.map(compactCheckpoint) };
  }

  getTake(q: OpInput<'get_take'>): OpResult {
    const take = this.take(q.take_id);
    if (!take) return this.noTake(q.take_id);
    const t0 = Math.max(0, Math.floor((q.from ?? 0) / take.dt + 1e-6));
    const t1 = Math.min(take.ticks, q.to === undefined ? take.ticks : Math.ceil(q.to / take.dt - 1e-6));
    if (t1 < t0) return fail('take.bad-range', `empty range: from ${q.from} s is after to ${q.to} s`);
    const inc = new Set(q.include ?? ['events', 'changes']);
    const s = sliceTake(take, t0, t1, q.entities);
    const { tracks: _t, changes: _c, events: _e, finalState, ...header } = take;
    return {
      ok: true,
      ...header,
      duration: r2(takeDuration(take)),
      range: { from: sec(t0 * take.dt), to: sec(t1 * take.dt), fromTick: t0, toTick: t1 },
      tracks: s.tracks,
      changes: inc.has('changes') ? s.changes : undefined,
      events: inc.has('events') ? s.events : undefined,
      finalState: inc.has('final') ? structuredClone(finalState) : undefined,
      cameras: inc.has('cameras') ? this.cameras(take.id) : this.cameras(take.id).map(cameraListing),
    };
  }

  // ---- plans, runs, workspaces ----------------------------------------------------------------

  bindPlan(q: OpInput<'bind_plan'>): OpResult {
    if ((this.history.workspaces.has(q.workspace) || this.history.checkpoints.has(q.workspace)) && this.history.resumable(q.workspace))
      return fail('workspace.paused', `${q.workspace} is a mid-action pause checkpoint (live actions are part of its state); engine_resume it first, or fork at its parent to bind against a resting state`);
    const plan = bindTemplate(q.template as SequenceTemplate, q.bindings, { history: this.history, baseline: q.workspace, registry: this.registry });
    const ws = this.history.workspaces.has(q.workspace) ? q.workspace : '';
    if (!this.plans.has(plan.planHash)) {
      this.plans.set(plan.planHash, { plan, workspace: ws });
      this.changes.plans.push(plan.planHash);
    }
    return { ok: true, plan_id: plan.planHash, baselineCheckpoint: plan.baselineCheckpoint, rulesVersion: plan.rulesVersion, workspace: ws || undefined, steps: plan.steps.map((s) => ({ id: s.id, verb: s.verb, params: s.params, after: s.after, when: s.when, at: s.at })) };
  }

  rehearse(q: OpInput<'rehearse'>): OpResult {
    let sp = this.plan(q.plan_id);
    if (!sp) return fail('plan.unknown', `no plan ${q.plan_id} (bind_plan first)`);
    const ws = q.workspace ?? sp.workspace;
    if (!ws) return fail('op.invalid-input', 'plan was bound to a checkpoint; pass `workspace` to rehearse against');
    let rebound: ReboundEvent | undefined;
    if (q.rebind === 'auto') {
      const rb = this.rebindIfStale(sp, ws);
      if ('ok' in rb) return rb;
      sp = rb.stored;
      rebound = rb.event;
    }
    const r = rehearsePlan(this.history, ws, sp.plan, this.cfg);
    if (r.envelope) this.cacheEnvelope(sp.plan.planHash, r.envelope);
    // read-only by default: the take stays in memory (playable via get_take while it lasts) and is
    // stored only on request — or later, by execute / attach_camera_track on the same take id
    const kept = q.keep === true || this.takes.has(r.take.id);
    if (q.keep === true) this.keepTake(r.take);
    else if (!kept) this.holdUnkept(r.take);
    const out: OpResult = {
      ok: r.report.ok,
      ...(rebound ? { plan_id: sp.plan.planHash, rebound } : {}),
      report: compactReport(r.report),
      take: { ...takeSummary(r.take), kept },
      stale: r.stale,
      ...(r.outsideEnvelope ? { outsideEnvelope: r.outsideEnvelope } : {}),
    };
    return r.report.ok ? out : { ...out, ok: false, code: 'rehearsal.failed', message: failureMessage(r.report) };
  }

  execute(q: OpInput<'execute'>): OpResult {
    let sp = this.plan(q.plan_id);
    if (!sp) return fail('plan.unknown', `no plan ${q.plan_id} (bind_plan first)`);
    const ws = this.history.workspaces.get(q.workspace);
    if (ws && !ws.protected && this.history.resumable(ws.id))
      return fail('workspace.paused', `workspace ${ws.id} is paused mid-run at ${ws.head}; engine_resume it (or fork at its parent) before executing another plan there`);
    let rebound: ReboundEvent | undefined;
    if (q.rebind === 'auto' && ws && !ws.protected) {
      const rb = this.rebindIfStale(sp, q.workspace);
      if ('ok' in rb) return rb;
      sp = rb.stored;
      rebound = rb.event;
    }
    const re = rebound ? { plan_id: sp.plan.planHash, rebound } : {};
    if (q.pauseAt !== undefined) {
      const out = this.executePausable(q, sp.plan);
      return rebound ? { ...out, ...re } : out;
    }
    const r = executePlan(this.history, q.workspace, sp.plan, this.cfg, { takes: this.takes, label: q.label, envelope: this.envelopeSource(sp.plan) });
    if ('take' in r) {
      this.unkept.delete(r.take.id);
      this.noteTake(r.take.id);
    }
    if (r.ok) {
      this.changes.history = true;
      return { ok: true, workspace: q.workspace, ...re, checkpoint: compactCheckpoint(r.checkpoint), take_id: r.take.id, take: takeSummary(r.take), report: compactReport(r.report), ...(r.outsideEnvelope ? { outsideEnvelope: r.outsideEnvelope } : {}) };
    }
    if (r.code === 'execution.failed') return { ok: false, code: r.code, message: uniqueMessage(r.message), ...re, take_id: r.take.id, take: takeSummary(r.take), report: compactReport(r.report) };
    return { ok: false, code: r.code, message: r.message, ...(r.diff ? { diff: r.diff } : {}), ...(r.affected ? { affected: r.affected } : {}) };
  }

  /**
   * LM-001: if `sp` is stale against `workspace`'s head (region-scoped, like execute), bind the same template +
   * bindings against that head (a new plan hash; stored with `reboundFrom`) and return it with a `plan.rebound`
   * event carrying the physical diff and the steps it reached. Not stale → `{ stored: sp }`. A binding that no
   * longer holds → a `plan.rebind-failed` refusal naming the steps that cannot re-bind.
   */
  private rebindIfStale(sp: StoredPlan, workspace: string): { stored: StoredPlan; event?: ReboundEvent } | OpResult {
    if (this.history.resumable(workspace))
      return fail('workspace.paused', `${workspace} is a mid-action pause checkpoint; engine_resume it before re-binding a plan against it`);
    const chk = checkPlan(this.history, workspace, sp.plan, this.envelopeSource(sp.plan));
    if (chk.ok) return { stored: sp };
    const stale: StaleInfo = { code: chk.code, message: chk.message, ...(chk.diff ? { diff: chk.diff } : {}), ...(chk.affected ? { affected: chk.affected } : {}) };
    let plan: BoundPlan;
    try {
      plan = bindTemplate(sp.plan.template, sp.plan.bindings, { history: this.history, baseline: workspace, registry: this.registry });
    } catch (e) {
      if (!(e instanceof PlanError)) throw e;
      const steps = stepsOf(sp.plan, e.diagnostics);
      return fail(
        'plan.rebind-failed',
        uniqueMessage(`plan ${sp.plan.planHash} is stale (${stale.message}) and cannot be re-bound against ${workspace}: ${steps.length ? `step${steps.length > 1 ? 's' : ''} ${steps.join(', ')}: ` : ''}${e.diagnostics.map((d) => d.message).join('; ')}`),
        { details: { steps, diagnostics: e.diagnostics, stale } },
      );
    }
    const ws = this.history.workspaces.has(workspace) ? workspace : '';
    const stored: StoredPlan = { plan, workspace: ws, reboundFrom: sp.plan.planHash };
    if (!this.plans.has(plan.planHash)) {
      this.plans.set(plan.planHash, stored);
      this.changes.plans.push(plan.planHash);
    }
    const event: ReboundEvent = {
      type: 'plan.rebound',
      from: sp.plan.planHash,
      to: plan.planHash,
      workspace,
      fromBaseline: sp.plan.baselineCheckpoint,
      toBaseline: plan.baselineCheckpoint,
      reason: stale.message,
      ...(stale.diff ? { diff: stale.diff, summary: describeDiff(stale.diff) } : {}),
      ...(stale.affected ? { affected: stale.affected } : {}),
    };
    return { stored: this.plans.get(plan.planHash)!, event };
  }

  /** The plan's envelope, cached; computed on first need by a run from the plan's baseline (deterministic). */
  private envelopeSource(plan: BoundPlan): EnvelopeSource {
    return () => {
      if (!this.envelopes.has(plan.planHash)) this.cacheEnvelope(plan.planHash, baselineEnvelope(this.history, plan, this.cfg));
      return this.envelopes.get(plan.planHash) ?? null;
    };
  }
  private cacheEnvelope(id: string, env: PlanEnvelope | null) {
    this.envelopes.delete(id);
    this.envelopes.set(id, env);
    for (const k of this.envelopes.keys()) if (this.envelopes.size > ENVELOPES) this.envelopes.delete(k);
  }

  /** execute with `pauseAt`: the same checks and runtime as execute, driven to the pause point (pause.ts). */
  private executePausable(q: OpInput<'execute'>, plan: BoundPlan): OpResult {
    const ws = this.history.workspaces.get(q.workspace);
    if (!ws) return fail('unknown-workspace', `no workspace ${q.workspace}`);
    if (ws.protected) return fail('workspace.protected', `workspace "${ws.label}" is a protected canonical state; fork it and execute in the fork`);
    const bad = integrity(this.history, plan);
    if (bad) return fail('plan.corrupt', bad);
    const chk = checkPlan(this.history, q.workspace, plan, this.envelopeSource(plan));
    if (!chk.ok) return fail(chk.code, chk.message, { ...(chk.diff ? { diff: chk.diff } : {}), ...(chk.affected ? { affected: chk.affected } : {}) });
    const p = q.pauseAt as PausePoint;
    if (typeof p === 'object' && !plan.steps.some((s) => s.id === p.step)) return fail('pause.unknown-step', `pauseAt: plan ${plan.planHash} has no step "${p.step}" (steps: ${plan.steps.map((s) => s.id).join(', ')})`);
    const world = this.history.read(chk.head.id);
    const rt = new Runtime(world, this.registry, runServices(world, this.cfg), this.cfg.invariants);
    const rec = new TakeRecorder(rt, { planHash: plan.planHash, baselineCheckpoint: chk.head.id, rulesVersion: this.history.rulesVersion, keyframeEvery: this.cfg.keyframeEvery });
    const runner = new SequenceRunner(rt, plan.steps);
    const maxTicks = this.cfg.maxTicks ?? DEFAULT_MAX_TICKS;
    return this.segment(q.workspace, chk.head.id, rt, rec, runner, p, maxTicks, { plan: plan.planHash, runStart: chk.head.id, maxTicks, takes: [], commands: [] }, q.allowDrop, q.label);
  }

  /** engine_resume: restore the head pause checkpoint's runtime + runner, add commands, drive on. */
  resume(q: OpInput<'resume'>): OpResult {
    const ws = this.history.workspaces.get(q.workspace);
    if (!ws) return fail('unknown-workspace', `no workspace ${q.workspace}`);
    if (ws.protected) return fail('workspace.protected', `workspace "${ws.label}" is a protected canonical state; fork it first`);
    const head = this.history.checkpoint(ws.head);
    if (!head.resume)
      return fail('resume.not-resumable', `workspace ${ws.id} head ${head.id} is a ${head.cause.kind} checkpoint, not a mid-action pause: there is nothing to resume (engine_execute a plan, with pauseAt to pause it)`);
    if (head.rulesVersion !== this.history.rulesVersion)
      return fail('resume.stale-rules', `pause checkpoint ${head.id} was taken under rules ${head.rulesVersion}; the engine is now ${this.history.rulesVersion}, so its live actions cannot be continued — fork at its parent and execute again`);
    const { world, snapshot } = this.history.read(head.id, { resume: true });
    if (!isPauseSnapshot(snapshot))
      return fail('resume.not-resumable', `pause checkpoint ${head.id} carries a runtime snapshot but no sequence state (it was not made by engine_execute pauseAt), so there is no run to continue here`);
    const ctx = snapshot.pause;
    let rt: Runtime;
    try {
      rt = Runtime.restore(snapshot, this.registry, runServices(world, this.cfg), this.cfg.invariants);
    } catch (e) {
      if (e instanceof SnapshotError) return fail(e.code, e.message, { details: { subjects: e.subjects } });
      throw e;
    }
    const state = structuredClone(ctx.runner);
    const added = appendCommands(state, (q.commands ?? []) as { verb: string; params: Record<string, unknown>; id?: string }[], this.registry, ctx.takes.length);
    if (!added.ok) return fail(added.code, added.message, added.details ? { details: added.details } : {});
    const runner = SequenceRunner.restore(rt, state);
    const until = q.until as PausePoint | undefined;
    const t = sec((rt.tick - runner.t0) * DT);
    if (typeof until === 'object' && !runner.reports.some((r) => r.id === until.step))
      return fail('pause.unknown-step', `until: this run has no step "${until.step}" (steps: ${runner.reports.map((r) => r.id).join(', ')})`);
    if (until !== undefined && reached(runner, until)) return fail('resume.bad-until', `until: ${describePoint(until)} is already reached (the run is paused at t = ${t} s)`);
    const rec = new TakeRecorder(rt, { planHash: ctx.plan, baselineCheckpoint: head.id, rulesVersion: this.history.rulesVersion, keyframeEvery: this.cfg.keyframeEvery });
    const budget = ctx.maxTicks - (rt.tick - runner.t0);
    const out = this.segment(ws.id, head.id, rt, rec, runner, until, budget, { ...ctx, commands: [...ctx.commands, ...added.ids] }, q.allowDrop, q.label);
    return { ...out, resumedFrom: { checkpoint: head.id, t }, ...(added.ids.length ? { commands: added.ids } : {}) };
  }

  /**
   * Drive one segment (start → pause, pause → pause, or pause/start → end) and commit it: a `pause`
   * checkpoint holding snapshot + runner state, or — at the end — `simulation-run` under execute's rules.
   */
  private segment(workspace: string, start: string, rt: Runtime, rec: TakeRecorder, runner: SequenceRunner, until: PausePoint | undefined, budget: number, ctx: Omit<PauseContext, 'format' | 'runner'>, allowDrop: boolean | undefined, label: string | undefined): OpResult {
    const d = drive(runner, until, budget);
    const t = sec((rt.tick - runner.t0) * DT);
    if (d.paused) {
      let snap;
      try {
        snap = rt.snapshot({ allowDrop });
      } catch (e) {
        if (!(e instanceof SnapshotError)) throw e;
        const hint = e.code === 'snapshot.drop-unsafe' ? 'safely stop the owning object task or set down its carried load before pausing' : 'pause while no such action is live, or pass allowDrop (only while it holds no load)';
        return fail(e.code, `pause at t = ${t} s: ${e.message} — nothing was committed; ${hint}`, { details: { subjects: e.subjects, at: t, live: liveActions(rt) } });
      }
      const take = rec.finish();
      this.keepTake(take);
      const pause: PauseContext = { format: PAUSE_FORMAT, ...ctx, runner: runner.serialize(), takes: [...ctx.takes, take.id] };
      const blob: PauseSnapshot = { ...snap, pause };
      const cp = this.history.commit(workspace, blob, { kind: 'pause', note: `paused at ${describePoint(until!)} (t = ${t} s)`, take: take.id, plan: ctx.plan }, label);
      this.changes.history = true;
      return {
        ok: true,
        paused: true,
        resumable: true,
        workspace,
        checkpoint: compactCheckpoint(cp),
        at: { t, tick: rt.tick - runner.t0 },
        live: liveActions(rt),
        ...(snap.dropped.length ? { dropped: snap.dropped } : {}),
        take_id: take.id,
        take: takeSummary(take),
        run: { start: ctx.runStart, takes: pause.takes },
        steps: stepProgress(runner.reports),
        snapshotBytes: stableStringify(blob).length,
      };
    }
    const take = rec.finish();
    this.keepTake(take);
    const report = runReport(d.result, take, ctx.plan, start);
    const run = { start: ctx.runStart, takes: [...ctx.takes, take.id] };
    const notReached = until !== undefined ? { paused: false, note: `the run ended before ${describePoint(until)} was reached` } : {};
    if (!report.ok)
      return {
        ok: false,
        code: 'execution.failed',
        message: uniqueMessage(
          `plan ${ctx.plan} did not complete cleanly (${report.status}, ${report.violations.length} violations): ${
            report.diagnostics.map((x) => x.message).join('; ') ||
            report.violations.map((v) => v.message).join('; ') ||
            report.steps.filter((x) => x.status !== 'completed' && x.diagnostic).map((x) => `step ${x.id} ${x.status}: ${x.diagnostic!.message}`).join('; ')
          }`,
        ),
        take_id: take.id,
        take: takeSummary(take),
        report: compactReport(report),
        run,
        ...notReached,
      };
    const cp = this.history.commit(workspace, rt.world, { kind: 'simulation-run', take: take.id, plan: ctx.plan }, label);
    this.changes.history = true;
    return { ok: true, workspace, checkpoint: compactCheckpoint(cp), take_id: take.id, take: takeSummary(take), report: compactReport(report), ...(ctx.takes.length ? { run } : {}), ...notReached };
  }

  fork(q: OpInput<'fork'>): OpResult {
    const at = q.at ?? this.history.workspaces.get(q.from)?.head;
    if (q.inventory && at && this.history.checkpoints.has(at) && this.history.resumable(at) && this.history.read(at).inventory !== q.inventory)
      return fail('workspace.paused', `cannot change inventory when forking at pause checkpoint ${at}: the change would be a design edit on top of a mid-action state (fork without inventory, resume, then edit)`);
    this.history.fork(q.from, q.name, q.label ?? q.name, q.at);
    this.changes.history = true;
    if (q.inventory) {
      const world = this.history.read(q.name);
      if (world.inventory !== q.inventory) {
        world.inventory = q.inventory;
        this.history.commit(q.name, world, { kind: 'design-edit', note: `inventory: ${q.inventory}` }, `inventory ${q.inventory}`);
      }
    }
    return { ok: true, workspace: this.history.workspaces.get(q.name)!, inventory: this.history.read(q.name).inventory };
  }

  /** Design edits on an editable workspace: all-or-nothing, one `design-edit` checkpoint, returns the physical diff. */
  editWorld(q: OpInput<'edit_world'>): OpResult {
    const ws = this.history.workspaces.get(q.workspace);
    if (!ws) return fail('unknown-workspace', `no workspace ${q.workspace}`);
    if (ws.protected) return fail('workspace.protected', `workspace "${ws.label}" is a protected canonical state; fork it (engine_fork) before editing`);
    if (this.history.resumable(ws.id)) return fail('workspace.paused', `workspace ${ws.id} is paused mid-run at ${ws.head}; engine_resume it before design-editing (an edit would strand its live actions)`);
    const before = this.history.read(q.workspace);
    const r = applyEdits(before, q.edits, (w) => this.cfg.services(w).spatial as Spatial, q.note);
    if (!r.ok) return r;
    const parent = ws.head;
    const cp = this.history.commit(q.workspace, r.world, { kind: 'design-edit', note: q.note }, q.label);
    this.changes.history = true;
    const diff = physicalDiff(before, r.world);
    return { ok: true, workspace: q.workspace, checkpoint: compactCheckpoint(cp), parent, applied: r.applied, diff, summary: describeDiff(diff) };
  }

  attachCameraTrack(q: OpInput<'attach_camera_track'>): OpResult {
    const take = this.take(q.take_id);
    if (!take) return this.noTake(q.take_id);
    const sourceScene = this.scenes[take.finalState.base.campus];
    const scene = sourceScene && sceneForWorld(sourceScene, take.finalState);
    if (!scene) return fail('camera.no-scene', `no static scene for campus ${take.finalState.base.campus}`);
    // a camera track is stored beside its take: an unkept rehearsal take is kept from now on
    if (this.unkept.has(take.id)) this.keepTake(take);
    const before = this.takes.takeHash(take.id);
    const sampler: Sampler = (t) => {
      const f = sampleTake(take, t);
      const out: Record<string, SubjectPose> = {};
      for (const [id, e] of Object.entries(f.entities)) out[id] = { p: e.p, yaw: e.yaw };
      return out;
    };
    const plan = planCameraTrack(q.shot as ShotSpec, sampler, scene, { duration: takeDuration(take), hz: q.hz ?? 10 });
    const trackId = q.track_id ?? `cam-${hashOf({ take: take.id, shot: q.shot, hz: q.hz ?? 10 }).slice(0, 12)}`;
    this.cameras(take.id); // make sure existing tracks are loaded before we add one
    this.takes.attachCamera(toCameraTrack(trackId, take.id, plan));
    if (!this.changes.cameras.includes(take.id)) this.changes.cameras.push(take.id);
    const r = plan.report;
    return {
      ok: !r.rejected,
      ...(r.rejected ? { code: 'camera.rejected', message: uniqueMessage(`camera track ${trackId} rejected: ${r.reasons.slice(0, 5).join('; ') || 'no readable framing'}`) } : {}),
      track_id: trackId,
      take_id: take.id,
      takeHashUnchanged: this.takes.takeHash(take.id) === before,
      report: { samples: r.samples, invalidSamples: r.invalidSamples, sweptCrossings: r.sweptCrossings, minReadability: r2(r.minReadability), readableFraction: r2(r.readableFraction), cuts: r.cuts, corrections: r.corrections.slice(0, 20), reasons: r.reasons.slice(0, 20) },
    };
  }

  /** LM-007/008: camera sentences → directions, resolved in a take's or workspace's world (camera-vocab.ts). */
  parseCamera(q: OpInput<'parse_camera'>): OpResult {
    if ((q.take_id ? 1 : 0) + (q.workspace ? 1 : 0) !== 1) return fail('op.invalid-input', 'parse_camera: give exactly one of `take_id`, `workspace`');
    let world: WorldState, take: Take | undefined;
    if (q.take_id) {
      take = this.take(q.take_id);
      if (!take) return this.noTake(q.take_id);
      world = take.finalState;
    } else world = this.history.read(q.workspace!);
    const sourceScene = this.scenes[world.base.campus];
    const scene = sourceScene && sceneForWorld(sourceScene, world);
    if (!scene) return fail('camera.no-scene', `no static scene for campus ${world.base.campus}`);
    const p = this.parseSentencesIn(scene, world, take, q.sentences);
    const source = { ...(q.take_id ? { take_id: q.take_id } : { workspace: q.workspace }), campus: world.base.campus };
    if (p.refusals.length) return { ...sentenceRefusal(p.directions, p.refusals), source };
    return { ok: true, source, directions: p.directions, refusals: [] };
  }

  private parseSentencesIn(scene: SpatialScene, world: WorldState, take: Take | undefined, sentences: string[]) {
    const sw = new SemanticWorld(scene, world, take ? takeFacts(take) : worldFacts(world));
    return parseCameraSentences(sw, sentences, cameraVocab(sw, activitiesOf(world, take)));
  }

  /** LM-013: store a compiled camera track (a directed one from the studio) beside its take. */
  storeCameraTrack(q: OpInput<'store_camera_track'>): OpResult {
    const take = this.take(q.take_id);
    if (!take) return this.noTake(q.take_id);
    const track = q.track as CameraTrack;
    if (track.takeId !== take.id) return fail('camera.track-take-mismatch', `camera track ${track.id} belongs to take ${track.takeId}, not ${take.id}; store it beside its own take`, { details: { track: track.id, takeId: track.takeId } });
    try {
      withFileCamera({ take: { id: take.id }, camera: { id: '', takeId: take.id, kind: 'none', data: null } }, track);
    } catch (e) {
      return fail('camera.track-invalid', e instanceof Error ? e.message : String(e), { details: { track: track.id } });
    }
    const d = track.data as { hz: number; duration: number; samples: { t: number }[] };
    const dur = takeDuration(take);
    if (d.duration > dur + 1 / d.hz + 1e-6) return fail('camera.track-invalid', `camera track ${track.id} lasts ${r2(d.duration)} s but take ${take.id} is ${r2(dur)} s`, { details: { track: track.id } });
    if (d.samples.length > Math.ceil(d.duration * d.hz) + 2) return fail('camera.track-invalid', `camera track ${track.id} has ${d.samples.length} samples; ${r2(d.duration)} s at ${d.hz} Hz allows ${Math.ceil(d.duration * d.hz) + 2}`, { details: { track: track.id } });
    const existing = this.cameras(take.id);
    const same = existing.find((c) => c.id === track.id) ?? this.takes.toJSON().cameras.find((c) => c.id === track.id);
    if (same) {
      if (stableStringify(same) === stableStringify(track)) return { ok: true, track_id: track.id, take_id: take.id, stored: false, note: 'identical track already stored', takeHashUnchanged: true };
      return fail('camera.track-exists', `a different camera track ${track.id} is already stored${same.takeId !== take.id ? ` (beside take ${same.takeId})` : ''}; pick another id`, { details: { track: track.id, takeId: same.takeId } });
    }
    const bytes = existing.reduce((n, c) => n + JSON.stringify(c).length, 0) + JSON.stringify(track).length;
    if (bytes > MAX_TAKE_CAMERA_BYTES)
      return fail('camera.store-full', `take ${take.id} would hold ${bytes} bytes of camera tracks (cap ${MAX_TAKE_CAMERA_BYTES}); store a shorter or lower-rate track`, { details: { bytes, cap: MAX_TAKE_CAMERA_BYTES } });
    if (this.unkept.has(take.id)) this.keepTake(take);
    const before = this.takes.takeHash(take.id);
    this.takes.attachCamera(track);
    if (!this.changes.cameras.includes(take.id)) this.changes.cameras.push(take.id);
    return { ok: true, track_id: track.id, take_id: take.id, stored: true, kind: track.kind, samples: d.samples.length, hz: d.hz, duration: d.duration, cameraBytes: bytes, takeHashUnchanged: this.takes.takeHash(take.id) === before };
  }

  /** OWNER_FEEDBACK §11: directions → computed, validated camera track stored beside the take (camera/direct.ts, synth.ts). */
  directCameraOp(q: OpInput<'direct_camera'>): OpResult {
    const take = this.take(q.take_id);
    if (!take) return this.noTake(q.take_id);
    const sourceScene = this.scenes[take.finalState.base.campus];
    const scene = sourceScene && sceneForWorld(sourceScene, take.finalState);
    if (!scene) return fail('camera.no-scene', `no static scene for campus ${take.finalState.base.campus}`);
    if ((q.directions ? 1 : 0) + (q.sentences ? 1 : 0) !== 1) return fail('op.invalid-input', 'direct_camera: give exactly one of `directions`, `sentences`');
    let directions = q.directions as CameraDirection[] | undefined;
    let parsedFrom: ParsedSentence[] | undefined;
    if (q.sentences) {
      const p = this.parseSentencesIn(scene, take.finalState, take, q.sentences);
      if (p.refusals.length) return sentenceRefusal(p.directions, p.refusals);
      parsedFrom = p.directions;
      directions = p.directions.map((x) => x.direction);
    }
    q = { ...q, directions: directions! };
    const hz = q.hz ?? 10;
    const r = directCamera(q.directions!, { scene, world: take.finalState, sampler: takeSampler(take), facts: takeFacts(take), duration: takeDuration(take), hz, ...(q.correct === false ? { correct: false } : {}) });
    if (!r.ok) {
      const d = r.diagnostics[0];
      return fail(d.code, uniqueMessage(r.diagnostics.map((x) => x.message).join('; ')), { diagnostics: r.diagnostics, shots: r.shots });
    }
    if (this.unkept.has(take.id)) this.keepTake(take);
    const before = this.takes.takeHash(take.id);
    // the id hashes the directions (parsed ones for sentences), so sentences and their parsed directions give the same track
    const trackId = q.track_id ?? `dir-${hashOf({ take: take.id, directions: q.directions, hz, ...(q.correct === false ? { correct: false } : {}) }).slice(0, 12)}`;
    this.cameras(take.id);
    this.takes.attachCamera(toCameraTrack(trackId, take.id, r.plan, 'directed'));
    if (!this.changes.cameras.includes(take.id)) this.changes.cameras.push(take.id);
    const rep = r.plan.report;
    const every = Math.max(1, Math.round(hz));
    return {
      ok: !rep.rejected,
      ...(rep.rejected ? { code: 'camera.rejected', message: uniqueMessage(`directed track ${trackId} rejected: ${rep.reasons.slice(0, 5).join('; ')}`) } : {}),
      track_id: trackId,
      take_id: take.id,
      takeHashUnchanged: this.takes.takeHash(take.id) === before,
      ...(parsedFrom ? { parsed: parsedFrom.map((x) => ({ index: x.index, sentence: x.sentence, direction: x.direction, notes: x.notes, subject: x.subject })) } : {}),
      track: { hz, duration: r.plan.duration, samples: r.plan.samples.length, keyframes: r.plan.samples.filter((_, i) => i % every === 0).map((s) => ({ t: s.t, position: s.position, target: s.target, fov: s.fov, cut: s.cut })) },
      report: r.report,
    };
  }

  // ---- storage helpers --------------------------------------------------------------------------

  /**
   * A take that is not here: `take.evicted` when a checkpoint still names it (its workspace was deleted and the
   * room evicted the take past its cap — LM-017), else `take.unknown`.
   */
  noTake(id: string): OpResult {
    const cps = this.history.checkpointsNamingTake(id);
    if (!cps.length) return fail('take.unknown', `no take ${id}`);
    return fail(
      'take.evicted',
      `take ${id} is no longer stored: checkpoint${cps.length > 1 ? 's' : ''} ${cps.join(', ')} still name${cps.length > 1 ? '' : 's'} it, but no live workspace reaches ${cps.length > 1 ? 'them' : 'it'} (deleted workspace), so the room evicted the take past its cap. Re-record it: engine_fork at the checkpoint's parent and engine_execute the plan again`,
      { details: { take_id: id, checkpoints: cps } },
    );
  }

  take(id: string): Take | undefined {
    if (this.takes.has(id)) return this.takes.get(id);
    const u = this.unkept.get(id);
    if (u) return u;
    const t = this.store.loadTake?.(id);
    if (!t) return undefined;
    this.takes.put(t);
    return this.takes.get(id);
  }

  plan(id: string): StoredPlan | undefined {
    let p = this.plans.get(id);
    if (!p) {
      p = this.store.loadPlan?.(id);
      if (p) this.plans.set(id, p);
    }
    return p;
  }

  cameras(takeId: string): CameraTrack[] {
    if (!this.camerasLoaded.has(takeId)) {
      this.camerasLoaded.add(takeId);
      for (const c of this.store.loadCameras?.(takeId) ?? []) if (this.takes.has(c.takeId)) this.takes.attachCamera(c);
    }
    return this.takes.cameras(takeId);
  }

  /** Store a take in the library and mark it for persistence (drops any unkept copy). */
  private keepTake(t: Take) {
    this.unkept.delete(t.id);
    this.takes.put(t);
    this.noteTake(t.id);
  }
  private holdUnkept(t: Take) {
    this.unkept.delete(t.id);
    this.unkept.set(t.id, t);
    for (const k of this.unkept.keys()) if (this.unkept.size > UNKEPT_TAKES) this.unkept.delete(k);
  }
  private noteTake(id: string) {
    if (!this.changes.takes.includes(id)) this.changes.takes.push(id);
  }
}

/** A stale plan re-bound against the workspace head (LM-001), returned as `rebound` by execute / rehearse. */
export type ReboundEvent = {
  type: 'plan.rebound';
  from: string;
  to: string;
  workspace: string;
  fromBaseline: string;
  toBaseline: string;
  reason: string;
  diff?: ReturnType<typeof physicalDiff>;
  summary?: string;
  affected?: { step: string; causes: string[] }[];
};

/** Step ids a bind failure concerns: a step diagnostic's own subject, or the steps whose params use a failing binding. */
function stepsOf(plan: BoundPlan, diags: Diagnostic[]): string[] {
  const ids = new Set(plan.template.steps.map((s) => s.id));
  const out = new Set<string>();
  for (const d of diags) {
    for (const x of d.subjects ?? []) if (ids.has(x)) out.add(x);
    const param = /parameter "([^"]+)"/.exec(d.message)?.[1];
    if (param)
      for (const s of plan.template.steps)
        if (new RegExp(`"\\$${param}(?![\\w])`).test(JSON.stringify(s.params))) out.add(s.id);
  }
  return [...out];
}

/** One-line reason for a failed rehearsal: status plus the first failing step's (or invariant's) diagnostic. */
function failureMessage(r: RunReport) {
  const step = r.steps.find((s) => s.diagnostic && s.status !== 'completed');
  if (step?.diagnostic) return uniqueMessage(`rehearsal ${r.status}: step ${step.id} (${step.verb}) ${step.diagnostic.code}: ${step.diagnostic.message}`);
  if (r.violations.length) return uniqueMessage(`rehearsal ${r.status} with ${r.violations.length} invariant violation(s): ${r.violations[0].code}: ${r.violations[0].message}`);
  const d = r.diagnostics[0];
  return uniqueMessage(`rehearsal ${r.status}${d ? `: ${d.code}: ${d.message}` : ''}`);
}

/** Collapse repeated '; '-joined diagnostic messages and cap the length (tool output stays readable). */
function uniqueMessage(m: string, max = 800) {
  const [head, ...rest] = m.split(': ');
  const parts = [...new Set(rest.join(': ').split('; '))];
  const s = parts.length ? `${head}: ${parts.join('; ')}` : head;
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Some sentences were refused: one envelope, the first refusal's code, every refusal and whatever did parse. */
function sentenceRefusal(directions: ParsedSentence[], refusals: SentenceRefusal[]): OpResult {
  const f = refusals[0];
  return fail(f.code, uniqueMessage(`${refusals.length} of ${directions.length + refusals.length} camera sentence(s) refused: ${refusals.map((r) => `[${r.index}] ${r.message}${r.question ? ` (${r.question})` : ''}`).join('; ')}`), { directions, refusals });
}

/** A camera track as get_take lists it without include 'cameras': id, kind and its shape. */
function cameraListing(c: CameraTrack) {
  const d = c.data as { hz?: number; duration?: number; samples?: unknown[] } | null;
  return { id: c.id, kind: c.kind, ...(d && typeof d === 'object' ? { hz: d.hz, duration: d.duration, samples: d.samples?.length } : {}) };
}

function compactCheckpoint(c: Checkpoint) {
  return { id: c.id, parent: c.parent, cause: c.cause, label: c.label, stateHash: c.stateHash.slice(0, 16), physicalHash: c.physicalHash.slice(0, 16), rulesVersion: c.rulesVersion, seq: c.created, ...(c.resume ? { resumable: true } : {}) };
}

export function createController(o: ControllerOptions): EngineController {
  return new EngineController(o);
}
