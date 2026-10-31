// Stage B (lane B-facade, rotation 3): the read worker's god. On main the GodMode bridge (god/engine-bridge.ts) registers
// the god layer's reads on the ledger (god walks, seats on god-built things, beds, items, layers/calendar items, the
// constitution, notices); a worker's ledger needs the same reads. The god model is a pure function of the commit log +
// the static scene, and main persists it as it commits (god/store.ts: world_meta_v1 / world_defs_v1 / world_entities_v1,
// one transaction per commit), so the worker reads it from its own read-only connection (WAL: it sees each commit main
// makes) and refreshes it when the stored editSeq moves. `GodReplica` is duck-typed to the parts of GodMode the bridge's
// read side uses (model, builds, db, onCommit, onBuild, now, opts); every write (engineAct, pray) is main-only.
//
// A refresh re-reads the entity rows and compares their stored text: unchanged rows keep their parsed entity, changed rows
// are re-parsed, and the model is rebuilt from the snapshot (WorldModel.fromSnapshot, as main's boot loads it) and folded
// into the same model object (`Object.assign`, as GodMode.commit does), so holders of `god.model` see the new state. The
// listeners get one synthetic commit per refresh (upserts/removes/defs/tiles as main's diffs name them; `by` 'engine' when
// every journaled edit since the last refresh was the engine's), which bumps the bridge's own versions exactly as main's
// commits do.
import {WorldModel, coreLibrary, type Diff, type Entity, type StoredDef} from '@sim/world-compiler';
import type {Db} from '../db.ts';
import {WorldStore} from '../god/store.ts';
import {AssetStore, defaultAssetDir} from '../god/assets.ts';
import {GodBuilds, type BuildNotice} from '../god/builds.ts';
import type {CommitListener} from '../god/god.ts';
import {MainOnly} from './read-host.ts';

type Meta = {editSeq: number; seq: number; owner: string | null; ground: unknown; state: unknown; constants: unknown};

export class GodReplica {
  readonly db: Db; readonly opts: {worldId: string; tick: () => number; cobuilders?: boolean};
  readonly store: WorldStore; readonly assets: AssetStore;
  model: WorldModel; owner: string | null = null;
  private _builds: GodBuilds; private buildsRev = -1;
  private rows = new Map<string, {text: string; e: Entity}>(); private defHashes = new Set<string>();
  private metaText = {ground: '', state: '', constants: ''};
  private editSeq = -1;
  private commitListeners: CommitListener[] = []; private buildListeners: ((e: BuildNotice) => void)[] = [];
  readonly cost = {syncs: 0, refreshes: 0, refreshMs: 0, maxRefreshMs: 0, buildRefreshes: 0};
  bodies: Record<string, unknown> = {};
  layers?: unknown;

  constructor(db: Db, worldId: string, tick: () => number) {
    this.db = db; this.opts = {worldId, tick};
    // read-only: WorldStore's constructor runs its schema DDL and an INSERT; a worker's connection is query_only
    const store = Object.create(WorldStore.prototype) as WorldStore & {db: Db; worldId: string; partsOriginsV1: boolean};
    store.db = db; store.worldId = worldId; store.partsOriginsV1 = !!store.meta()?.partsOriginsV1;
    this.store = store;
    this.assets = new AssetStore({dir: defaultAssetDir(), db, worldId});
    this.model = new WorldModel({constants: {ground: 'land', extent: 1000} as never, seed: `${worldId}:genesis`, assets: this.assets.lookup});
    this.refresh(true);
    this._builds = this.newBuilds();
  }
  now(): number {return Date.now();}
  get builds(): GodBuilds {this.syncBuilds(); return this._builds;}
  onCommit(fn: CommitListener) {this.commitListeners.push(fn); return () => {this.commitListeners = this.commitListeners.filter(f => f !== fn);};}
  onBuild(fn: (e: BuildNotice) => void) {this.buildListeners.push(fn); return () => {this.buildListeners = this.buildListeners.filter(f => f !== fn);};}
  engineAct(): never {throw new MainOnly('god.engineAct');}
  pray(): never {throw new MainOnly('god.pray');}

  /** Bring the model (and the open builds) to what main last committed. True when something changed. */
  sync(): boolean {
    this.cost.syncs++;
    const r = this.db.db.prepare("SELECT json_extract(body, '$.editSeq') AS s FROM world_meta_v1 WHERE world_id = ?").get(this.opts.worldId) as {s: number} | undefined;
    const moved = !!r && r.s !== this.editSeq && this.refresh(false);
    const built = this.syncBuilds();
    return moved || built;
  }
  private newBuilds() {
    return new GodBuilds(this.store, {model: () => this.model, now: () => this.now(), emit: () => {/* a worker publishes nothing */}, notice: () => {/* nor notices */}});
  }
  /** Open builds (closing sites, construction refusals) follow god_builds_v1's revision. */
  private syncBuilds(): boolean {
    const rev = this.store.buildsRev(); if (rev === this.buildsRev) return false;
    const first = this.buildsRev < 0; this.buildsRev = rev;
    if (!this._builds) return false;
    this._builds = this.newBuilds(); this.cost.buildRefreshes++;
    if (!first) for (const fn of this.buildListeners) {try {fn({kind: 'step', id: '', rev, now: this.now(), delta: {} as never} as BuildNotice);} catch {/* listeners never fail a read */}}
    return true;
  }
  private refresh(first: boolean): boolean {
    const t0 = performance.now(), wid = this.opts.worldId, q = (s: string) => this.db.db.prepare(s);
    const metaRow = q('SELECT body FROM world_meta_v1 WHERE world_id = ?').get(wid) as {body: string} | undefined;
    if (!metaRow) return false;
    const meta = JSON.parse(metaRow.body) as Meta & {seed: string; defRefs?: Record<string, string>};
    if (meta.editSeq === this.editSeq) return false;
    const before = this.editSeq;
    // entities: re-parse only the rows whose stored text changed
    const upserts: Entity[] = [], seen = new Set<string>();
    for (const row of q('SELECT id, body FROM world_entities_v1 WHERE world_id = ?').all(wid) as {id: string; body: string}[]) {
      seen.add(row.id);
      const old = this.rows.get(row.id); if (old?.text === row.body) continue;
      const e = JSON.parse(row.body) as Entity; this.rows.set(row.id, {text: row.body, e}); upserts.push(e);
    }
    const removes: string[] = []; for (const id of this.rows.keys()) if (!seen.has(id)) removes.push(id);
    for (const id of removes) this.rows.delete(id);
    const defs: StoredDef[] = [], allDefs: StoredDef[] = [];
    for (const row of q('SELECT hash, body FROM world_defs_v1 WHERE world_id = ?').all(wid) as {hash: string; body: string}[]) {
      const d = JSON.parse(row.body) as StoredDef; allDefs.push(d); if (!this.defHashes.has(row.hash)) {this.defHashes.add(row.hash); defs.push(d);}
    }
    const ground = JSON.stringify(meta.ground ?? null), tiles = ground !== this.metaText.ground; this.metaText.ground = ground;
    const next = WorldModel.fromSnapshot({constants: meta.constants, state: meta.state, seed: meta.seed, seq: meta.seq, editSeq: meta.editSeq, defs: allDefs, defRefs: meta.defRefs,
      entities: [...this.rows.values()].map(x => x.e), ground: meta.ground} as never, this.assets.lookup, coreLibrary());
    for (const k of Object.keys(this.model)) if (!(k in next)) delete (this.model as unknown as Record<string, unknown>)[k];
    Object.assign(this.model, next);
    this.owner = meta.owner; this.editSeq = meta.editSeq;
    const ms = performance.now() - t0; this.cost.refreshes++; this.cost.refreshMs += ms; this.cost.maxRefreshMs = Math.max(this.cost.maxRefreshMs, ms);
    if (first) return true;
    const god = (q("SELECT count(*) AS n FROM world_edits_v1 WHERE world_id = ? AND seq > ? AND seq <= ? AND by != 'engine'").get(wid, before, meta.editSeq) as {n: number}).n;
    const diff = {upserts, removes, defs, tiles: tiles ? ['*'] : [], answers: []} as unknown as Diff;
    for (const fn of this.commitListeners) {try {fn({seq: meta.editSeq, diff, kind: 'edit', by: god ? 'god' : 'engine'});} catch {/* listeners never fail a read */}}
    return true;
  }
}
