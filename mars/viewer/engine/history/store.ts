// Versioned world history (spec §21–22). Git-like but domain-specific:
//   Checkpoint — immutable, content-addressed world state with parent + cause
//   Workspace  — movable ref (branch); canonical refs are protected
// Reconstruction edits and simulated events are different causes and are
// never conflated. There is deliberately no merge operation.
import { z } from 'zod';
import { hashOf } from '../core/hash.ts';
import { decode } from '../runtime/codec.ts';
import type { WorldState } from '../world/types.ts';
import { physicalView } from '../world/types.ts';
import type { RuntimeSnapshot } from '../runtime/snapshot.ts';

export type Cause =
  | { kind: 'canonical-publish'; note: string }
  | { kind: 'reconstruction-edit'; note: string; evidence?: string[] } // "we learned it was 6 ft east"
  | { kind: 'design-edit'; note: string } // hypothetical/future campus editing
  | { kind: 'simulation-run'; take: string; plan?: string } // "three people moved it"
  | { kind: 'fork'; note?: string }
  /** A mid-action pause: the checkpoint also stores a resumable runtime snapshot (runtime/snapshot.ts). */
  | { kind: 'pause'; note: string; take?: string; plan?: string };

export type Checkpoint = {
  id: string; // hash of {state, parent, cause}
  stateHash: string;
  physicalHash: string;
  parent: string | null;
  cause: Cause;
  rulesVersion: string;
  label?: string;
  created: number; // tick-free ordinal (store sequence), not wall clock → deterministic ids
  /** Pause checkpoints: hash of the stored RuntimeSnapshot (`read(id, { resume: true })`). */
  resume?: string;
};

export type Workspace = { id: string; head: string; protected: boolean; label: string; forkedFrom?: string };

export class HistoryError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Where world states live when they are not all held in memory (the Durable Object keeps each one
 * as its own content-addressed blob `state/<stateHash>`). `get` may return undefined for an unknown
 * hash; `put` is only called for a state hash this history has not stored before.
 */
export type StateStore = {
  get(stateHash: string): WorldState | undefined;
  put(stateHash: string, state: WorldState): void;
  has?(stateHash: string): boolean;
  /** Optional: pause checkpoints' runtime snapshots as content-addressed blobs too (then `toJSON({ states: false })` omits them). */
  getResume?(hash: string): RuntimeSnapshot | undefined;
  putResume?(hash: string, snap: RuntimeSnapshot): void;
};

/** Serialised history. `states` is omitted by `toJSON({ states: false })` (states live in a StateStore). */
export type HistoryJSON = {
  rulesVersion: string;
  seq: number;
  states?: [string, WorldState][];
  checkpoints: Checkpoint[];
  workspaces: Workspace[];
  /** Resumable runtime snapshots of pause checkpoints, by hash. */
  resumes?: [string, RuntimeSnapshot][];
};

export class WorldHistory {
  /** State cache: every state when no store is attached, else the ones read or written so far. */
  private states = new Map<string, WorldState>();
  private physicalHashes = new Map<string, string>();
  private store: StateStore | null = null;
  private checkpointData = new Map<string, Checkpoint>();
  private workspaceData = new Map<string, Workspace>();
  readonly checkpoints: ReadonlyMap<string, Checkpoint> = copiedView(this.checkpointData);
  readonly workspaces: ReadonlyMap<string, Workspace> = copiedView(this.workspaceData);
  private seq = 0;
  private resumes = new Map<string, RuntimeSnapshot>();

  rulesVersion: string;
  constructor(rulesVersion: string) {
    this.rulesVersion = rulesVersion;
  }

  private put(state: WorldState, parent: string | null, cause: Cause, label?: string, snap?: RuntimeSnapshot): Checkpoint {
    const frozen = deepFreeze(structuredClone(state));
    const stateHash = hashOf(frozen);
    const resume = snap ? hashOf(snap) : undefined;
    const id = hashOf(resume ? { stateHash, parent, cause, rulesVersion: this.rulesVersion, resume } : { stateHash, parent, cause, rulesVersion: this.rulesVersion }).slice(0, 24);
    const existing = this.checkpointData.get(id);
    if (existing) return existing;
    // first clone wins (review M6); with a store, only a state it does not hold yet is written
    if (!this.states.has(stateHash) && !this.stored(stateHash)) {
      this.store?.put(stateHash, frozen);
      this.states.set(stateHash, frozen);
    }
    const physicalHash = this.physicalHashes.get(stateHash) ?? hashOf(physicalView(frozen));
    this.physicalHashes.set(stateHash, physicalHash);
    const cp: Checkpoint = {
      id,
      stateHash,
      physicalHash,
      parent,
      cause: structuredClone(cause),
      rulesVersion: this.rulesVersion,
      label,
      created: this.seq++,
    };
    if (snap && resume) {
      cp.resume = resume;
      if (!this.resumes.has(resume)) {
        const frozenSnap = deepFreeze(structuredClone(snap));
        this.resumes.set(resume, frozenSnap);
        this.store?.putResume?.(resume, frozenSnap);
      }
    }
    this.checkpointData.set(id, deepFreeze(cp));
    return cp;
  }

  /** Publish a protected canonical state (e.g. Mars 2024 as reconstructed). */
  publishCanonical(id: string, label: string, state: WorldState, note: string): Workspace {
    if (this.workspaceData.has(id)) throw new HistoryError('exists', `workspace ${id} already exists`);
    const cp = this.put(state, null, { kind: 'canonical-publish', note }, label);
    const ws: Workspace = { id, head: cp.id, protected: true, label };
    this.workspaceData.set(id, ws);
    return structuredClone(ws);
  }

  fork(fromWorkspace: string, newId: string, label: string, atCheckpoint?: string): Workspace {
    if (this.workspaceData.has(newId)) throw new HistoryError('exists', `workspace ${newId} already exists`);
    const src = this.ws(fromWorkspace);
    const head = atCheckpoint ?? src.head;
    this.checkpoint(head);
    const ws: Workspace = { id: newId, head, protected: false, label, forkedFrom: fromWorkspace };
    this.workspaceData.set(newId, ws);
    return structuredClone(ws);
  }

  /**
   * Commit a successor state to a workspace. Protected workspaces reject all commits. A `pause` cause
   * takes a RuntimeSnapshot (`rt.snapshot()`): the checkpoint's state is its world, and the snapshot is
   * stored with it so the checkpoint — and any workspace forked at it — is resumable mid-action.
   */
  commit(workspace: string, state: WorldState | RuntimeSnapshot, cause: Cause, label?: string): Checkpoint {
    const ws = this.ws(workspace);
    if (ws.protected)
      throw new HistoryError(
        'protected',
        `workspace "${ws.label}" is a protected canonical state; fork it before editing or simulating`,
      );
    if (cause.kind === 'canonical-publish') throw new HistoryError('bad-cause', 'use publishCanonical');
    const isSnap = (state as RuntimeSnapshot).format === 'mars-runtime-snapshot/1';
    if ((cause.kind === 'pause') !== isSnap)
      throw new HistoryError('bad-cause', cause.kind === 'pause' ? 'a pause checkpoint needs a runtime snapshot (rt.snapshot()), not a bare world state' : `a runtime snapshot can only be committed with cause 'pause', not '${cause.kind}'`);
    const snap = isSnap ? (state as RuntimeSnapshot) : undefined;
    let world = state as WorldState;
    if (snap) {
      world = (decode(snap.data) as { world: WorldState }).world;
      if (hashOf(world) !== snap.stateHash) throw new HistoryError('bad-snapshot', 'runtime snapshot world does not match its stateHash');
    }
    const cp = this.put(world, ws.head, cause, label, snap);
    ws.head = cp.id;
    return structuredClone(cp);
  }

  /**
   * Returns a mutable deep copy — edits never touch stored history. With `{ resume: true }` returns the
   * world plus the checkpoint's resumable runtime snapshot (null unless it is a pause checkpoint);
   * resume with `Runtime.restore(snapshot, registry, services)`.
   */
  read(checkpointOrWorkspace: string): WorldState;
  read(checkpointOrWorkspace: string, o: { resume: true }): { world: WorldState; snapshot: RuntimeSnapshot | null };
  read(checkpointOrWorkspace: string, o?: { resume: true }): WorldState | { world: WorldState; snapshot: RuntimeSnapshot | null } {
    const ws = this.workspaceData.get(checkpointOrWorkspace);
    const cp = this.checkpoint(ws ? ws.head : checkpointOrWorkspace);
    const stored = this.state(cp.stateHash);
    if (this.physicalHash(cp.stateHash) !== cp.physicalHash) corrupt(`checkpoint ${cp.id} physical hash mismatch`);
    const world = structuredClone(stored) as WorldState;
    if (!o?.resume) return world;
    let snap = cp.resume ? this.resumes.get(cp.resume) : undefined;
    if (cp.resume && !snap) {
      const got = this.store?.getResume?.(cp.resume);
      if (got) {
        validateResume(cp.resume, got, cp.stateHash);
        this.resumes.set(cp.resume, (snap = deepFreeze(structuredClone(got))));
      }
    }
    if (cp.resume && !snap) throw new HistoryError('missing-state', `runtime snapshot ${cp.resume.slice(0, 16)}… of pause checkpoint ${cp.id} is not stored`);
    if (snap && snap.stateHash !== cp.stateHash) corrupt(`snapshot world mismatch at ${cp.id}`);
    return { world, snapshot: snap ? (structuredClone(snap) as RuntimeSnapshot) : null };
  }

  /** Is this checkpoint (or workspace head) a resumable mid-action pause? */
  resumable(checkpointOrWorkspace: string): boolean {
    const ws = this.workspaceData.get(checkpointOrWorkspace);
    return !!this.checkpoint(ws ? ws.head : checkpointOrWorkspace).resume;
  }

  /** The frozen state for a hash: from the cache, else loaded once from the attached store. */
  private state(stateHash: string): WorldState {
    let s = this.states.get(stateHash);
    if (!s) {
      const got = this.store?.get(stateHash);
      if (!got) throw new HistoryError('missing-state', `world state ${stateHash.slice(0, 16)}… is not stored`);
      validateState(stateHash, got);
      s = deepFreeze(structuredClone(got));
      this.states.set(stateHash, s);
    }
    return s;
  }

  /** State clones are immutable, so physical verification is computed once per loaded state. */
  private physicalHash(stateHash: string): string {
    let hash = this.physicalHashes.get(stateHash);
    if (hash === undefined) {
      hash = hashOf(physicalView(this.state(stateHash)));
      this.physicalHashes.set(stateHash, hash);
    }
    return hash;
  }

  /**
   * Keep states in `store` instead of the serialised history: `read()` loads a state on demand and
   * `commit()`/`publishCanonical()` put only the new one. States already in memory (a seeded or
   * old-format history) are written through now, so `toJSON({ states: false })` is complete
   * together with the store. Returns the number of states written. A store with `putResume` also
   * receives every pause snapshot (in memory now, and each new one), and the index then omits them.
   */
  attachStateStore(store: StateStore): number {
    this.store = store;
    let n = 0;
    for (const [hash, s] of this.states)
      if (!this.stored(hash)) {
        store.put(hash, s);
        n++;
      }
    if (store.putResume) for (const [hash, snap] of this.resumes) store.putResume(hash, snap);
    return n;
  }

  private stored(stateHash: string): boolean {
    const st = this.store;
    return !!st && (st.has ? st.has(stateHash) : st.get(stateHash) !== undefined);
  }

  head(workspace: string) {
    return this.checkpoint(this.ws(workspace).head);
  }

  log(workspace: string): Checkpoint[] {
    const out: Checkpoint[] = [];
    for (let id: string | null = this.ws(workspace).head; id; id = this.checkpoint(id).parent) out.push(this.checkpoint(id));
    return out;
  }

  /** Checkpoints (any workspace, live or deleted) whose simulation-run / pause cause names `take`, oldest first (LM-017). */
  checkpointsNamingTake(take: string): string[] {
    return [...this.checkpointData.values()]
      .filter((c) => (c.cause.kind === 'simulation-run' || c.cause.kind === 'pause') && c.cause.take === take)
      .sort((a, b) => a.created - b.created)
      .map((c) => c.id);
  }

  checkpoint(id: string): Checkpoint {
    const cp = this.checkpointData.get(id);
    if (!cp) throw new HistoryError('unknown-checkpoint', `no checkpoint ${id}`);
    return structuredClone(cp);
  }

  private ws(id: string): Workspace {
    const ws = this.workspaceData.get(id);
    if (!ws) throw new HistoryError('unknown-workspace', `no workspace ${id}`);
    return ws;
  }

  /** Remove an unprotected leaf ref; checkpoint contents remain addressable. */
  deleteWorkspace(id: string): void {
    const ws = this.ws(id);
    if (ws.protected) throw new HistoryError('workspace.protected', `workspace ${id} is protected`);
    if ([...this.workspaceData.values()].some((w) => w.forkedFrom === id))
      throw new HistoryError('workspace.has-forks', `workspace ${id} has surviving forks`);
    this.workspaceData.delete(id);
  }

  /**
   * Serialise the history (Durable Object / file persistence). `{ states: false }` writes only the
   * checkpoint + workspace index — the states themselves are in the attached StateStore.
   */
  toJSON(o: { states?: boolean } = {}): HistoryJSON {
    return structuredClone({
      rulesVersion: this.rulesVersion,
      seq: this.seq,
      ...(o.states === false ? {} : { states: [...this.states.entries()] }),
      checkpoints: [...this.checkpointData.values()],
      workspaces: [...this.workspaceData.values()],
      ...(this.resumes.size && !(o.states === false && this.store?.putResume) ? { resumes: [...this.resumes.entries()] } : {}),
    });
  }

  /** Load either format: a full blob (with `states`) or an index whose states come from attachStateStore. */
  static fromJSON(j: HistoryJSON): WorldHistory {
    const parsed = historySchema.safeParse(j);
    if (!parsed.success) throw new HistoryError('corrupt-history', `invalid history index: ${parsed.error.issues[0]?.path.join('.')}`);
    j = structuredClone(parsed.data) as HistoryJSON;
    const h = new WorldHistory(j.rulesVersion);
    h.seq = j.seq;
    const ordinals = new Set<number>();
    for (const [k, state] of j.states ?? []) {
      if (h.states.has(k)) corrupt(`duplicate state ${k}`);
      validateState(k, state);
      h.states.set(k, deepFreeze(state));
    }
    for (const c of j.checkpoints) {
      if (h.checkpointData.has(c.id) || ordinals.has(c.created) || c.created >= j.seq) corrupt(`duplicate checkpoint or invalid ordinal ${c.id}`);
      const { stateHash, parent, cause, rulesVersion, resume } = c;
      const expected = hashOf(resume ? { stateHash, parent, cause, rulesVersion, resume } : { stateHash, parent, cause, rulesVersion }).slice(0, 24);
      if (expected !== c.id) corrupt(`checkpoint ${c.id} does not match its content hash`);
      if ((cause.kind === 'canonical-publish') !== (parent === null)) corrupt(`checkpoint ${c.id} has inconsistent canonical parent`);
      if ((cause.kind === 'pause') !== !!resume) corrupt(`checkpoint ${c.id} has inconsistent pause metadata`);
      const state = h.states.get(stateHash);
      if (state && h.physicalHash(stateHash) !== c.physicalHash) corrupt(`checkpoint ${c.id} physical hash mismatch`);
      ordinals.add(c.created);
      h.checkpointData.set(c.id, deepFreeze(c));
    }
    for (const c of h.checkpointData.values()) {
      if (c.parent && (!h.checkpointData.has(c.parent) || h.checkpointData.get(c.parent)!.created >= c.created)) corrupt(`invalid parent of ${c.id}`);
    }
    for (const w of j.workspaces) {
      if (h.workspaceData.has(w.id) || !h.checkpointData.has(w.head)) corrupt(`duplicate workspace or missing head ${w.id}`);
      if (w.protected !== (w.forkedFrom === undefined)) corrupt(`workspace ${w.id} has inconsistent protection`);
      h.workspaceData.set(w.id, w);
    }
    for (const w of h.workspaceData.values()) {
      if (w.protected && h.checkpointData.get(w.head)!.cause.kind !== 'canonical-publish') corrupt(`canonical workspace ${w.id} has a noncanonical head`);
      const seen = new Set<string>();
      for (let id: string | undefined = w.id; id !== undefined; id = h.workspaceData.get(id)!.forkedFrom) {
        if (!h.workspaceData.has(id)) corrupt(`missing fork parent of ${w.id}`);
        if (seen.has(id)) corrupt(`workspace ancestry cycle at ${w.id}`);
        seen.add(id);
      }
    }
    for (const [k, snap] of j.resumes ?? []) {
      if (h.resumes.has(k)) corrupt(`duplicate snapshot ${k}`);
      validateResume(k, snap);
      h.resumes.set(k, deepFreeze(snap));
    }
    for (const c of h.checkpointData.values()) {
      const snap = c.resume && h.resumes.get(c.resume);
      if (snap && snap.stateHash !== c.stateHash) corrupt(`snapshot world mismatch at ${c.id}`);
    }
    return h;
  }
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as object)) deepFreeze(v);
  }
  return o;
}

/** No mutators or references to stored values cross the history boundary. */
function copiedView<K, V>(map: Map<K, V>): ReadonlyMap<K, V> {
  const view: ReadonlyMap<K, V> = {
    get size() { return map.size; },
    has: (key) => map.has(key),
    get: (key) => { const value = map.get(key); return value === undefined ? undefined : structuredClone(value); },
    keys: () => map.keys(),
    *values(): Generator<V, undefined> { for (const value of map.values()) yield structuredClone(value); return undefined; },
    *entries(): Generator<[K, V], undefined> { for (const [key, value] of map) yield [key, structuredClone(value)] as [K, V]; return undefined; },
    [Symbol.iterator]() { return this.entries(); },
    forEach(callback, thisArg) { for (const [key, value] of this) callback.call(thisArg, value, key, view); },
  };
  return Object.freeze(view);
}
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const checkpointId = z.string().regex(/^[a-f0-9]{24}$/);
const causeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('canonical-publish'), note: z.string() }),
  z.object({ kind: z.literal('reconstruction-edit'), note: z.string(), evidence: z.array(z.string()).optional() }),
  z.object({ kind: z.literal('design-edit'), note: z.string() }),
  z.object({ kind: z.literal('simulation-run'), take: z.string(), plan: z.string().optional() }),
  z.object({ kind: z.literal('fork'), note: z.string().optional() }),
  z.object({ kind: z.literal('pause'), note: z.string(), take: z.string().optional(), plan: z.string().optional() }),
]);
const historySchema = z.object({
  rulesVersion: z.string(), seq: z.number().int().nonnegative(),
  states: z.array(z.tuple([hashSchema, z.unknown()])).optional(),
  resumes: z.array(z.tuple([hashSchema, z.unknown()])).optional(),
  checkpoints: z.array(z.object({ id: checkpointId, stateHash: hashSchema, physicalHash: hashSchema,
    parent: checkpointId.nullable(), cause: causeSchema, rulesVersion: z.string(), label: z.string().optional(),
    created: z.number().int().nonnegative(), resume: hashSchema.optional() })),
  workspaces: z.array(z.object({ id: z.string(), head: checkpointId, protected: z.boolean(), label: z.string(), forkedFrom: z.string().optional() })),
});
function corrupt(message: string): never { throw new HistoryError('corrupt-history', message); }
function validateState(hash: string, state: WorldState): void {
  try { if (hashOf(state) === hash) return; } catch { /* report a named storage diagnostic */ }
  corrupt(`world state ${hash} does not match its content hash`);
}
function validateResume(hash: string, snap: RuntimeSnapshot, stateHash?: string): void {
  try {
    if (hashOf(snap) === hash && snap.format === 'mars-runtime-snapshot/1' &&
      (!stateHash || snap.stateHash === stateHash) && hashOf((decode(snap.data) as { world: WorldState }).world) === snap.stateHash) return;
  } catch { /* malformed encoded graph is a corrupt stored snapshot */ }
  corrupt(`runtime snapshot ${hash} does not match its content/world hash`);
}
