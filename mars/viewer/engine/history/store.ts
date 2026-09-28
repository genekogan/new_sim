// Versioned world history (spec §21–22). Git-like but domain-specific:
//   Checkpoint — immutable, content-addressed world state with parent + cause
//   Workspace  — movable ref (branch); canonical refs are protected
// Reconstruction edits and simulated events are different causes and are
// never conflated. There is deliberately no merge operation.
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
  private store: StateStore | null = null;
  readonly checkpoints = new Map<string, Checkpoint>();
  readonly workspaces = new Map<string, Workspace>();
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
    const existing = this.checkpoints.get(id);
    if (existing) return existing;
    // first clone wins (review M6); with a store, only a state it does not hold yet is written
    if (!this.states.has(stateHash) && !this.stored(stateHash)) {
      this.store?.put(stateHash, frozen);
      this.states.set(stateHash, frozen);
    }
    const cp: Checkpoint = {
      id,
      stateHash,
      physicalHash: hashOf(physicalView(frozen)),
      parent,
      cause,
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
    this.checkpoints.set(id, cp);
    return cp;
  }

  /** Publish a protected canonical state (e.g. Mars 2024 as reconstructed). */
  publishCanonical(id: string, label: string, state: WorldState, note: string): Workspace {
    const cp = this.put(state, null, { kind: 'canonical-publish', note }, label);
    const ws: Workspace = { id, head: cp.id, protected: true, label };
    this.workspaces.set(id, ws);
    return ws;
  }

  fork(fromWorkspace: string, newId: string, label: string, atCheckpoint?: string): Workspace {
    if (this.workspaces.has(newId)) throw new HistoryError('exists', `workspace ${newId} already exists`);
    const src = this.ws(fromWorkspace);
    const head = atCheckpoint ?? src.head;
    this.checkpoint(head);
    const ws: Workspace = { id: newId, head, protected: false, label, forkedFrom: fromWorkspace };
    this.workspaces.set(newId, ws);
    return ws;
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
    return cp;
  }

  /**
   * Returns a mutable deep copy — edits never touch stored history. With `{ resume: true }` returns the
   * world plus the checkpoint's resumable runtime snapshot (null unless it is a pause checkpoint);
   * resume with `Runtime.restore(snapshot, registry, services)`.
   */
  read(checkpointOrWorkspace: string): WorldState;
  read(checkpointOrWorkspace: string, o: { resume: true }): { world: WorldState; snapshot: RuntimeSnapshot | null };
  read(checkpointOrWorkspace: string, o?: { resume: true }): WorldState | { world: WorldState; snapshot: RuntimeSnapshot | null } {
    const ws = this.workspaces.get(checkpointOrWorkspace);
    const cp = this.checkpoint(ws ? ws.head : checkpointOrWorkspace);
    const world = structuredClone(this.state(cp.stateHash)) as WorldState;
    if (!o?.resume) return world;
    let snap = cp.resume ? this.resumes.get(cp.resume) : undefined;
    if (cp.resume && !snap) {
      const got = this.store?.getResume?.(cp.resume);
      if (got) this.resumes.set(cp.resume, (snap = deepFreeze(got)));
    }
    if (cp.resume && !snap) throw new HistoryError('missing-state', `runtime snapshot ${cp.resume.slice(0, 16)}… of pause checkpoint ${cp.id} is not stored`);
    return { world, snapshot: snap ? (structuredClone(snap) as RuntimeSnapshot) : null };
  }

  /** Is this checkpoint (or workspace head) a resumable mid-action pause? */
  resumable(checkpointOrWorkspace: string): boolean {
    const ws = this.workspaces.get(checkpointOrWorkspace);
    return !!this.checkpoint(ws ? ws.head : checkpointOrWorkspace).resume;
  }

  /** The frozen state for a hash: from the cache, else loaded once from the attached store. */
  private state(stateHash: string): WorldState {
    let s = this.states.get(stateHash);
    if (!s) {
      const got = this.store?.get(stateHash);
      if (!got) throw new HistoryError('missing-state', `world state ${stateHash.slice(0, 16)}… is not stored`);
      s = deepFreeze(got);
      this.states.set(stateHash, s);
    }
    return s;
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

  checkpoint(id: string): Checkpoint {
    const cp = this.checkpoints.get(id);
    if (!cp) throw new HistoryError('unknown-checkpoint', `no checkpoint ${id}`);
    return cp;
  }

  private ws(id: string): Workspace {
    const ws = this.workspaces.get(id);
    if (!ws) throw new HistoryError('unknown-workspace', `no workspace ${id}`);
    return ws;
  }

  /**
   * Serialise the history (Durable Object / file persistence). `{ states: false }` writes only the
   * checkpoint + workspace index — the states themselves are in the attached StateStore.
   */
  toJSON(o: { states?: boolean } = {}): HistoryJSON {
    return {
      rulesVersion: this.rulesVersion,
      seq: this.seq,
      ...(o.states === false ? {} : { states: [...this.states.entries()] }),
      checkpoints: [...this.checkpoints.values()],
      workspaces: [...this.workspaces.values()],
      ...(this.resumes.size && !(o.states === false && this.store?.putResume) ? { resumes: [...this.resumes.entries()] } : {}),
    };
  }

  /** Load either format: a full blob (with `states`) or an index whose states come from attachStateStore. */
  static fromJSON(j: HistoryJSON): WorldHistory {
    const h = new WorldHistory(j.rulesVersion);
    h.seq = j.seq;
    for (const [k, s] of j.states ?? []) h.states.set(k, deepFreeze(s));
    for (const c of j.checkpoints) h.checkpoints.set(c.id, c);
    for (const w of j.workspaces) h.workspaces.set(w.id, { ...w });
    for (const [k, s] of j.resumes ?? []) h.resumes.set(k, deepFreeze(s));
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
