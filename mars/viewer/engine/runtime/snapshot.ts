// Resumable mid-action runtime checkpoints (spec §22 "Forking mid-performance requires a resumable
// simulation checkpoint, not merely a screenshot of transforms"). A RuntimeSnapshot holds the world,
// every action record, the live actions' exec + program state, reservations, the plain-data
// services (walk traffic holds, walkExecs, replan budget), the spatial navigation epoch, the id
// counter, violations and the event cursor — everything a Runtime reads when it steps.
// `Runtime.restore()` rebuilds a runtime that steps tick-for-tick identically (resume.test.ts).
//
// Resumable subset (verified): walk_to (all phases incl. stairs), take_slot / sit / stand / face /
// converse / gather / campfire_circle, and sequence-runner state (sequence/runner.ts). Everything
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
  /** rt.events.length at the pause; the restored runtime's events start empty (continue the stream from here). */
  eventCursor: number;
  violations: Violation[];
  /** Non-resumable actions left out under `allowDrop`; restore() finishes each as cancelled (code snapshot.dropped). */
  dropped: DroppedAction[];
};

export type SnapshotOptions = { allowDrop?: boolean };

/** What Runtime exposes to this module (its private live/owner maps and id counter). */
export type LiveEntry = { rec: ActionRecord; def: ActionDef; exec: unknown; program: unknown; cancelling?: boolean; prior: Map<string, WorldState['entities'][string]['phase']> };
export type RuntimeInternals = {
  live: Map<string, LiveEntry>;
  owners: Map<string, { action: string; mode: 'exclusive' | 'shared' }[]>;
  nextId: number;
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

type Graph = {
  world: WorldState;
  records: ActionRecord[];
  live: { id: string; custom: boolean; exec: unknown; program: unknown; cancelling: boolean; prior: LiveEntry['prior'] }[];
  dropped: { id: string; prior: LiveEntry['prior'] }[];
  owners: [string, { action: string; mode: 'exclusive' | 'shared' }[]][];
  services: Record<string, unknown>;
};

/** A dropped action must not leave a load unsupported (spec §13: cancel refuses rather than drops a load). */
function holdsLoad(rt: Runtime, id: string): string | null {
  for (const e of Object.values(rt.world.entities)) {
    if (e.reservedBy === id && (e.phase === 'carried' || e.phase === 'raising')) return `${e.id} is ${e.phase} by it`;
    if (e.human?.task === id && e.human.grip) return `${e.id} is gripping ${e.human.grip.entity} for it`;
  }
  return null;
}

export function takeSnapshot(rt: Runtime, int: RuntimeInternals, opts: SnapshotOptions = {}): RuntimeSnapshot {
  const refused: DroppedAction[] = [];
  const graph: Graph = { world: rt.world, records: [...rt.records.values()], live: [], dropped: [], owners: [...int.owners], services: {} };
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
    graph.live.push({ id, custom: !!l.def.serializeExec, exec, program: l.program, cancelling: !!l.cancelling, prior: l.prior });
  }
  const list = () => refused.map((r) => `action ${r.id} (${r.verb}) is not resumable: ${r.reason}`).join('; ');
  if (refused.length && !opts.allowDrop)
    throw new SnapshotError('snapshot.non-resumable', `cannot take a resumable snapshot at tick ${rt.tick}: ${list()}`, refused.map((r) => r.id));
  for (const r of refused) {
    const load = holdsLoad(rt, r.id);
    if (load) throw new SnapshotError('snapshot.drop-unsafe', `cannot drop action ${r.id} (${r.verb}) from the snapshot at tick ${rt.tick}: ${load}, and dropping it would leave the load unsupported`, [r.id]);
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
  // prove the blob is plain JSON that decodes to the same graph
  const back = encode(decode(JSON.parse(JSON.stringify(data))));
  if (hashOf(back) !== hashOf(data)) throw new SnapshotError('snapshot.roundtrip', `snapshot at tick ${rt.tick} does not survive a JSON round trip`);
  return {
    format: SNAPSHOT_FORMAT,
    tick: rt.tick,
    stateHash: hashOf(rt.world),
    data,
    spatialEpoch,
    nextId: int.nextId,
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
    int.live.set(x.id, { rec, def, exec, program: x.program, cancelling: x.cancelling || undefined, prior: x.prior });
  }
  for (const [k, list] of g.owners) int.owners.set(k, list);
  int.nextId = snap.nextId;
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
