// Resumable mid-action runtime checkpoints (spec §22 "Forking mid-performance requires a resumable
// simulation checkpoint, not merely a screenshot of transforms"). A RuntimeSnapshot holds the world,
// every action record, the live actions' exec + program state, reservations, the plain-data
// services (walk traffic holds, walkExecs, replan budget), the spatial navigation epoch, the id
// counter, violations and the event cursor — everything a Runtime reads when it steps.
// `Runtime.restore()` rebuilds a runtime that steps tick-for-tick identically (resume.test.ts).
//
// Resumable subset (verified): walk_to (all phases incl. stairs), take_slot / sit / stand / face /
// converse / gather / campfire_circle, lowering-only raise_upright via its custom phase codec,
// and sequence-runner state (sequence/runner.ts). Everything
// else is refused loudly, naming the action and why (NON_RESUMABLE, or "not verified").
import type { ActionDef, ActionRecord, Diagnostic } from '../actions/types.ts';
import type { WorldState } from '../world/types.ts';
import { hashOf } from '../core/hash.ts';
import { CodecError, decode, encode } from './codec.ts';
import type { Runtime, Violation } from './runtime.ts';

export const SNAPSHOT_FORMAT = 'mars-runtime-snapshot/1';

/** Verbs whose exec state has been proven to resume tick-exact with the default graph codec. */
export const RESUMABLE_VERBS: ReadonlySet<string> = new Set(['walk_to', 'take_slot', 'sit', 'stand', 'face', 'converse', 'gather', 'campfire_circle']);

const CONSTRUCTION =
  'construction lift actions hold a load (support held/raising, a lift crew gripping it) and drive crew sub-walks plus lift trajectories whose tick-exact restoration has not been verified';
/** Why the known non-resumable verbs are refused (TAKES_AND_PLANS.md "Resumability"). */
export const NON_RESUMABLE: Readonly<Record<string, string>> = {
  carry:
    'carry drives in-process walk sub-execs (not child actions) that it registers in services.walkExecs, publishes its load discs through a services closure (loadDiscs), and holds planner trajectories + formation transitions (lift / move / set-down) whose tick-exact restoration has not been verified; a paused carry also holds a load, so it cannot be dropped either',
  raise_upright: CONSTRUCTION,
  connect_beam: CONSTRUCTION,
  install_joist: CONSTRUCTION,
  install_plywood: CONSTRUCTION,
  install_stair_flight: CONSTRUCTION,
  install_tread: CONSTRUCTION,
  release_support: CONSTRUCTION,
  mount: 'vehicle controller state (mount transition) and the per-runtime vehicle invariant memory are not serialised',
  dismount: 'vehicle controller state (dismount transition) and the per-runtime vehicle invariant memory are not serialised',
  ride_to: 'vehicle ride curves, forklift fork phases and the per-runtime vehicle invariant memory are not serialised',
  ride_loop: 'vehicle ride curves, forklift fork phases and the per-runtime vehicle invariant memory are not serialised',
};

/** `null` = resumable; otherwise the reason this action's live state cannot be snapshotted. */
export function nonResumableReason(def: ActionDef): string | null {
  if (def.resumable === true || def.serializeExec) return null;
  if (typeof def.resumable === 'string') return def.resumable;
  if (NON_RESUMABLE[def.verb]) return NON_RESUMABLE[def.verb];
  if (RESUMABLE_VERBS.has(def.verb)) return null;
  return `${def.verb} has not been verified resumable (add it to RESUMABLE_VERBS with a resume test, or give its ActionDef serializeExec/restoreExec)`;
}

export type DroppedAction = { id: string; verb: string; reason: string };

export type RuntimeSnapshot = {
  format: typeof SNAPSHOT_FORMAT;
  tick: number;
  /** hashOf(world) at the pause: equals the paused runtime's stateHash(). */
  stateHash: string;
  /** Encoded graph { world, records, live, owners, services } (codec.ts); the world is plain JSON unless aliased. */
  data: unknown;
  spatialEpoch?: number;
  nextId: number;
  idPrefix?: string;
  /** rt.events.length at the pause; the restored runtime's events start empty (continue the stream from here). */
  eventCursor: number;
  violations: Violation[];
  /** Non-resumable actions left out under `allowDrop`; restore() finishes each as cancelled (code snapshot.dropped). */
  dropped: DroppedAction[];
};

export type SnapshotOptions = { allowDrop?: boolean };

/** What Runtime exposes to this module (its private live/owner maps and id counter). */
export type LiveEntry = { rec: ActionRecord; def: ActionDef; exec: unknown; program: unknown; cancelling?: boolean; reason?: Diagnostic; prior: Map<string, WorldState['entities'][string]['phase']> };
export type WaitingEntry = { rec: ActionRecord; def: ActionDef; params: unknown; parent?: string; holds: string[] };
export type RuntimeInternals = {
  waiting: Map<string, WaitingEntry>;
  live: Map<string, LiveEntry>;
  owners: Map<string, { action: string; mode: 'exclusive' | 'shared' }[]>;
  nextId: number;
  idPrefix?: string;
  forceFinish(l: LiveEntry, status: 'cancelled', d: Diagnostic): void;
};

export class SnapshotError extends Error {
  code: string;
  subjects: string[];
  constructor(code: string, message: string, subjects: string[] = []) {
    super(message);
    this.code = code;
    this.subjects = subjects;
  }
  get diagnostic(): Diagnostic {
    return { code: this.code, message: this.message, subjects: this.subjects };
  }
}

const isPlainObject = (v: object) => {
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
};

export type Graph = {
  world: WorldState;
  records: ActionRecord[];
  live: { id: string; custom: boolean; exec: unknown; program: unknown; cancelling: boolean; reason?: Diagnostic; prior: LiveEntry['prior'] }[];
  waiting?: { id: string; params: unknown; parent?: string; holds: string[] }[];
  dropped: { id: string; prior: LiveEntry['prior'] }[];
  owners: [string, { action: string; mode: 'exclusive' | 'shared' }[]][];
  services: Record<string, unknown>;
};

/** A dropped action must not leave a load unsupported (spec §13: cancel refuses rather than drops a load). */
function holdsLoad(rt: Runtime, id: string): string | null {
  for (const e of Object.values(rt.world.entities)) {
    if (e.reservedBy === id && (e.phase === 'carried' || e.phase === 'raising')) return `${e.id} is ${e.phase} by it`;
    if (e.human?.task === id && e.human.grip) return `${e.id} is gripping ${e.human.grip.entity} for it`;
    if(e.human?.sleepPose&&e.human.task){const seen=new Set<string>();for(let owner:string|undefined=e.human.task;owner&&!seen.has(owner);owner=rt.records.get(owner)?.parent){if(owner===id)return `${e.id} has a prone sleep pose owned by ${e.human.task}`;seen.add(owner);}}
  }
  return null;
}

export function takeSnapshot(rt: Runtime, int: RuntimeInternals, opts: SnapshotOptions = {}): RuntimeSnapshot {
  const refused: DroppedAction[] = [];
  const graph: Graph = { world: rt.world, records: [...rt.records.values()], live: [], dropped: [], owners: [...int.owners], services: {} };
  if (int.waiting.size) graph.waiting = [...int.waiting.values()].map((w) => ({ id: w.rec.id, params: w.params, parent: w.parent, holds: w.holds }));
  const skip = new Set<object>();
  for (const l of int.live.values()) {
    const { id, verb } = l.rec;
    let reason = nonResumableReason(l.def);
    let exec = l.exec;
    if (!reason)
      try {
        if (l.def.serializeExec) exec = l.def.serializeExec(rt, l.exec);
        encode({ exec, program: l.program }, `action ${id} (${verb}) exec`);
      } catch (e) {
        if (!(e instanceof CodecError)) throw e;
        reason = e.message;
      }
    if (reason) {
      refused.push({ id, verb, reason });
      graph.dropped.push({ id, prior: l.prior });
      if (l.exec && typeof l.exec === 'object') skip.add(l.exec);
      continue;
    }
    graph.live.push({ id, custom: !!l.def.serializeExec, exec, program: l.program, cancelling: !!l.cancelling, ...(l.reason ? { reason: l.reason } : {}), prior: l.prior });
  }
  const list = () => refused.map((r) => `action ${r.id} (${r.verb}) is not resumable: ${r.reason}`).join('; ');
  if (refused.length && !opts.allowDrop)
    throw new SnapshotError('snapshot.non-resumable', `cannot take a resumable snapshot at tick ${rt.tick}: ${list()}`, refused.map((r) => r.id));
  for (const r of refused) {
    // Generic dropped-action cleanup cannot finalize durable work progress: the
    // owning object task must finish its ordinary stop before active state can be omitted.
    const station = Object.values(rt.world.entities).find(e =>
      e.equipment && e.equipment.config.status === 'active' && e.equipment.config.action === r.id);
    if (station) throw new SnapshotError('snapshot.drop-unsafe',
      `cannot drop action ${r.id} (${r.verb}) from the snapshot at tick ${rt.tick}: equipment ${station.id} has active task state owned by it; safely stop the owning work first so unfinished progress is recorded`, [r.id, station.id]);
    const load = holdsLoad(rt, r.id);
    if (load) throw new SnapshotError('snapshot.drop-unsafe', `cannot drop action ${r.id} (${r.verb}) from the snapshot at tick ${rt.tick}: ${load}, and dropping it would leave the load unsupported`, [r.id]);
  }
  for (const w of graph.waiting ?? []) {
    const dependencies = new Set(w.holds);
    for (let parent = w.parent; parent && !dependencies.has(parent); parent = rt.records.get(parent)?.parent) dependencies.add(parent);
    const discarded = refused.filter((r) => dependencies.has(r.id));
    if (discarded.length) throw new SnapshotError('snapshot.waiting-dependency', `cannot drop dependencies of waiting directive ${w.id}`, [w.id, ...discarded.map((r) => r.id)]);
  }
  // the navigation epoch keys walk replans and single-file traffic resources; syncing now is
  // behaviour-neutral (sync is idempotent on the same world) and makes the epoch final
  const sp = rt.services.spatial as { sync?: (w: WorldState) => boolean; epoch?: number } | undefined;
  let spatialEpoch: number | undefined;
  if (sp && typeof sp.sync === 'function') {
    sp.sync(rt.world);
    spatialEpoch = sp.epoch;
  }
  // plain-data services are simulation state; functions and class instances are environment the caller re-supplies
  for (const [k, v] of Object.entries(rt.services)) {
    if (k === 'spatial' || v === undefined || typeof v === 'function') continue;
    if (typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Map) && !(v instanceof Set) && !isPlainObject(v)) continue;
    graph.services[k] = v;
  }
  let data: unknown;
  try {
    data = encode(graph, '$', skip);
  } catch (e) {
    if (!(e instanceof CodecError)) throw e;
    throw new SnapshotError('snapshot.unencodable', `cannot take a resumable snapshot at tick ${rt.tick}: ${e.message}`);
  }
  // encode validates inert source data and constructs an owned JSON-safe graph. Its
  // alias/JSON roundtrip contract is exercised in codec tests, not by decoding and
  // re-encoding every captured world here. Restore still verifies the world hash.
  return {
    format: SNAPSHOT_FORMAT,
    tick: rt.tick,
    stateHash: hashOf(rt.world),
    data,
    spatialEpoch,
    nextId: int.nextId,
    idPrefix: int.idPrefix,
    eventCursor: rt.events.length,
    violations: structuredClone(rt.violations),
    dropped: refused,
  };
}

/** Decode and verify a snapshot; the world is returned first so Runtime.restore can construct around it. */
export function decodeSnapshot(snap: RuntimeSnapshot): Graph {
  if (!snap || snap.format !== SNAPSHOT_FORMAT) throw new SnapshotError('snapshot.format', `not a ${SNAPSHOT_FORMAT} snapshot`);
  const g = decode(snap.data) as Graph;
  if (hashOf(g.world) !== snap.stateHash) throw new SnapshotError('snapshot.corrupt', `snapshot world hash ${hashOf(g.world).slice(0, 12)}… does not match its recorded stateHash ${snap.stateHash.slice(0, 12)}…`);
  return g;
}

/**
 * Load a decoded snapshot into a freshly constructed runtime (Runtime.restore). The runtime must own
 * its services: in particular a Spatial shared with another runtime would share its navigation epoch.
 */
export function applySnapshot(rt: Runtime, int: RuntimeInternals, snap: RuntimeSnapshot, g: Graph) {
  for (const r of g.records) rt.records.set(r.id, r);
  for (const [k, v] of Object.entries(g.services)) rt.services[k] = v;
  if (snap.spatialEpoch !== undefined) {
    const sp = rt.services.spatial as { sync?: (w: WorldState) => boolean; epoch: number } | undefined;
    if (!sp || typeof sp.sync !== 'function') throw new SnapshotError('snapshot.services', 'the snapshot was taken with services.spatial; restore needs a Spatial for the same base scene');
    sp.sync(rt.world);
    sp.epoch = snap.spatialEpoch;
  }
  for (const x of g.live) {
    const rec = rt.records.get(x.id)!;
    const def = rt.registry.get(rec.verb);
    if (!def) throw new SnapshotError('snapshot.unknown-verb', `live action ${x.id} is a "${rec.verb}", which the restore registry does not have`, [x.id]);
    if (x.custom && !def.restoreExec) throw new SnapshotError('snapshot.unknown-verb', `live action ${x.id} (${rec.verb}) was serialised by serializeExec but its ActionDef has no restoreExec`, [x.id]);
    const exec = x.custom ? def.restoreExec!(rt, x.exec) : x.exec;
    const invalid = def.validateSnapshot?.(rt, exec, rec);
    if (invalid) throw new SnapshotError(invalid.code, invalid.message, invalid.subjects);
    int.live.set(x.id, { rec, def, exec, program: x.program, cancelling: x.cancelling || undefined, reason: x.reason, prior: x.prior });
  }
  if (g.waiting !== undefined && !Array.isArray(g.waiting)) throw new SnapshotError('snapshot.waiting-invalid', 'waiting directives must be an array');
  const seenWaiting = new Set<string>();
  for (const w of g.waiting ?? []) {
    if (!w || typeof w.id !== 'string') throw new SnapshotError('snapshot.waiting-invalid', 'waiting directive must have an id');
    const rec = rt.records.get(w.id);
    const invalid = () => new SnapshotError('snapshot.waiting-invalid', `waiting directive ${w.id} has invalid graph provenance`, [w.id]);
    if (!rec || seenWaiting.has(w.id) || int.live.has(w.id) || g.dropped.some((d) => d.id === w.id) ||
      rec.status !== 'requested' || rec.phase !== 'pre-empting' || rec.parent !== w.parent ||
      hashOf(rec.params) !== hashOf(w.params) || !Array.isArray(w.holds) || !w.holds.length ||
      new Set(w.holds).size !== w.holds.length || w.holds.some((id) => id === w.id || !rt.records.has(id) || g.dropped.some((d) => d.id === id)) ||
      g.owners.some(([, owners]) => owners.some((o) => o.action === w.id))) throw invalid();
    for (const id of w.holds) {
      const held = int.live.get(id), record = rt.records.get(id)!;
      if (held ? !held.cancelling : !['completed', 'cancelled', 'failed'].includes(record.status)) throw invalid();
    }
    const ancestors = new Set([w.id]);
    for (let parent = w.parent; parent; parent = rt.records.get(parent)?.parent) {
      if (ancestors.has(parent) || !rt.records.has(parent) || g.dropped.some((d) => d.id === parent)) throw invalid();
      ancestors.add(parent);
    }
    const def = rt.registry.get(rec.verb);
    if (!def) throw new SnapshotError('snapshot.unknown-verb', `waiting action ${w.id} is a "${rec.verb}", which the restore registry does not have`, [w.id]);
    if (!def.schema.safeParse(w.params).success) throw invalid();
    seenWaiting.add(w.id);
    int.waiting.set(w.id, { rec, def, params: w.params, parent: w.parent, holds: w.holds });
  }
  for (const rec of rt.records.values())
    if (rec.status === 'requested' && rec.phase === 'pre-empting' && !seenWaiting.has(rec.id))
      throw new SnapshotError('snapshot.waiting-invalid', `pre-empting directive ${rec.id} is missing its waiting intent`, [rec.id]);
  // Return intents are restricted to the original standalone seat action. They are
  // not a general deferred command queue, even if a supplied registry has more verbs.
  const returns = g.services.socialReturns;
  if (returns !== undefined) {
    const invalid = () => new SnapshotError('snapshot.return-invalid', 'social return intent has invalid shape or source provenance');
    if (!Array.isArray(returns)) throw invalid();
    const seen = new Set<string>();
    for (const value of returns) {
      if (!value || typeof value !== 'object') throw invalid();
      const q = value as { source: string; directive: string; actor: string; verb: string; params: { actor?: string; slot?: string; activity?: string } };
      const source = rt.records.get(q.source), directive = rt.records.get(q.directive);
      const original = source?.params as { actor?: string; slot?: string; owner?: string; fixture?: string; activity?: string } | undefined;
      if (Object.keys(q).some((k) => !['source', 'directive', 'actor', 'verb', 'params'].includes(k)) ||
        !source || !directive || source.parent || directive.parent || source.id === directive.id || seen.has(source.id) ||
        !['sit', 'take_slot'].includes(q.verb) || source.verb !== q.verb || original?.actor !== q.actor ||
        !source.history.some((h) => h.phase === 'occupied') || !source.history.some((h) => h.code === 'social.pre-empted') ||
        !q.params || q.params.actor !== q.actor || typeof q.params.slot !== 'string' ||
        !rt.registry.get(q.verb)?.schema.safeParse(q.params).success) throw invalid();
      const reason = int.live.get(source.id)?.reason ?? source.diagnostic;
      if (reason?.code === 'social.pre-empted') {
        const initial = reason.details?.by;
        if (typeof initial !== 'string') throw invalid();
        let by: string = initial;
        const chain = new Set<string>();
        for (;;) {
          if (chain.has(by)) throw invalid();
          chain.add(by);
          const record = rt.records.get(by);
          if (!record) throw invalid();
          if (!record.parent) break;
          by = record.parent;
        }
        if (by !== directive.id) throw invalid();
      }
      const slotOwner = q.params.slot.slice(0, q.params.slot.lastIndexOf('#'));
      if (original.slot ? q.params.slot !== original.slot : slotOwner !== (original.owner ?? original.fixture)) throw invalid();
      if (q.verb === 'take_slot' && q.params.activity !== (original.activity ?? 'sit')) throw invalid();
      if (rt.records.has(`${q.source}:resume:${q.directive}`)) throw invalid();
      seen.add(source.id);
    }
  }
  for (const [k, list] of g.owners) int.owners.set(k, list);
  int.nextId = snap.nextId;
  int.idPrefix = snap.idPrefix ?? 'a';
  rt.violations.push(...structuredClone(snap.violations));
  for (const d of g.dropped) {
    const rec = rt.records.get(d.id)!;
    const def = rt.registry.get(rec.verb) ?? ({ verb: rec.verb } as ActionDef);
    const why = snap.dropped.find((x) => x.id === d.id)?.reason ?? 'not resumable';
    int.forceFinish({ rec, def, exec: undefined, program: undefined, prior: d.prior }, 'cancelled', {
      code: 'snapshot.dropped',
      message: `action ${d.id} (${rec.verb}) was dropped when the runtime was snapshotted at tick ${snap.tick}: ${why}`,
      subjects: [d.id],
    });
  }
}
