// Stage B (lane B-delta, from the L9 spike): the replicated read model of one world. Pure: no host, no engine, no db,
// only the plain data in WorldInit / WorldDelta (split/world-init.ts, split/delta.ts), so it runs in a worker.
//   Replica   = every replicated table, built from one WorldInit and kept current by applying WorldDeltas in order
//               (docs/sim/LOAD-CONTRACT.md §6 "WorldDelta v1"; the oracle in split/delta-oracle.ts checks it against main).
//   ReadModel = the spike's declared SUBSET of `here` and `capabilities` over a Replica (docs/sim/STAGE-B-SPLIT.md §3),
//               kept so the read worker can serve it until B-facade's MenuWorld runs the real read code.
import type {MenuDelta, MenuInit} from './menu-world.ts';
import {clearSight, dist2, round1, type Solid} from '../edge/perception/geometry.ts';
import {PlaceIndex, centroid, inPoly, type Place} from '../edge/ledger/places.ts';

type V2 = [number, number];
export const DELTA_V = 1;
export const CELL = 32;
const SIGHT_RADIUS = 30, OBJECT_RADIUS = 15, NEAR_RADIUS = 20, GO_NEAR_RADIUS = 60, FIRE_OFFER_RADIUS = 150, GATHER_RADIUS = 60;

/** A world entity as the engine holds it (plain data; `pose` is the only part that moves every tick). */
export type Ent = {id: string; kind?: string; def?: string; label?: string; pose: {p: number[]; yaw: number}; human?: Record<string, unknown> & {activity?: string; level?: number}; [k: string]: unknown};
/** A pose update of an entity whose other fields did not change: [id, x, y, z, yaw] or [id, x, y, z, yaw, human.speed]
 *  (exact numbers: B-spatial's people-avoid tests flip at the millimetre). */
export type BodyRow = [string, number, number, number, number] | [string, number, number, number, number, number];
export type MindRow = {soulId: string; entityId: string; name: string; owner: string; native: boolean};
/** An edge receipt as its phase-change notifications carry it (ledger.onReceipt). Open = waiting | started. */
export type ReceiptRow = {id: string; soulId: string; capability: string; phase: string; acceptedTick: number; startedTick: number | null; endedTick: number | null; code: string | null; programId: string | null};
/** A Soul body's engine programme: [entityId, programId | null, step, action id, action verb] (engine.programOf/programAction).
 *  The action's status and phase are not carried: they move inside a step with no programme event. */
export type ProgramRow = [string, string | null, number, string, string];
/** A Soul body's native seat holds (engine.nativeSeatHoldsV1): [entityId, [{action, slot}]]. */
export type HoldRow = [string, {action: string; slot: string}[]];
/** A carrier (engine.carriers(): bikes, punts, balloons): derived from its entity (Replica.carrierRows). */
export type CarrierRow = {id: string; def: string; label: string; state: unknown};
/** A comms object record (L8's table: a whole frozen record, or null = removed), in table-generation order. */
export type ObjectRecordRow = {id: string; kind: string; name: string; description: string; placeId: string; version: number; state: unknown; createdAt: number};
export type ObjectDeltaRow = {gen: number; id: string; record: ObjectRecordRow | null};
export type ItemRow = {id: string; name: string; at: V2};
export type StaticLayer = {
  /** engine.staticEpochV1() | ledger.staticVersion(): the static layer is resent whenever either moves */
  epoch: string;
  places: Place[];                 // ledger.places.byId (containment uses the authored polygons)
  shells: Record<string, V2[]>;    // enclosed place -> its validated room shell (ledger.enclosurePlaces), for the enclosure rule
  solids: Solid[];                 // world.navV1.solids, as Perception.solids() shapes them
  fires: {id: string; name: string; at: V2}[];
  regions: {id: string; name: string; c: V2}[];   // world regions that are also places (gather offers)
  spots: {id: string; label: string; activity: string; at: V2}[];
  /** B-facade: the god places main's bridge installed (its ledger's placeWalkable) */
  walkable?: string[];
};
/** Position in the stream: `gen` changes only when the stream itself restarts (the engine was replaced, the object
 *  table reloaded, the world recovered); `seq` counts deltas within a gen (one per tick, contiguous); `logSeq` = host.seq. */
export type StreamPos = {v: 1; gen: number; seq: number; tick: number; logSeq: number};
export type WorldInit = StreamPos & {
  entities: Record<string, Ent>;   // L5's shared snapshot view (host.snapshotView().entities)
  env: Record<string, unknown>;
  living: {origin: number; dayTicks: number} | null;
  static: StaticLayer;
  minds: MindRow[]; faded: string[];
  receipts: ReceiptRow[];          // open ones (waiting/started), every Soul
  programs: ProgramRow[]; holds: HoldRow[];
  objects: {gen: number; records: ObjectRecordRow[]};   // L8 table.snapshot()
  items: ItemRow[]; togetherVersion: number;
  menuInputs: string[];            // ledger addMenuInput sources (a god world: commit version | closing construction sites)
  /** B-spatial: engine.exportStaticScene() (structured clone, not JSON), its rebuild key, the paged windows, connectivity ready */
  scene: unknown; sceneKey: string; pages: unknown; navReady: boolean;
  /** B-facade (split/verdict-pump.ts): action rows, verdicts, menu statics; absent when no pump is attached */
  menu?: MenuInit;
};
export type WorldDelta = StreamPos & {
  bodies?: BodyRow[];              // pose-only updates
  ents?: Ent[];                    // whole entities: new ones, and ones whose non-pose fields changed
  gone?: string[];                 // entities removed
  env?: Record<string, unknown>;   // world.env, whole, when it changed (its datetime moves every tick)
  living?: WorldInit['living'];    // the day clock (origin, ticks per day), when it changed
  minds?: MindRow[]; mindsGone?: string[];
  faded?: string[];                // the whole set, only when it changed
  receipts?: ReceiptRow[];         // every phase change since the last delta, in order (upsert; a closed one leaves the open set)
  programs?: ProgramRow[]; holds?: HoldRow[];   // changed rows (null programme = none)
  objects?: {gen: number; deltas: ObjectDeltaRow[]};   // L8 table.changes(since): apply in order, skip gen <= the replica's
  items?: ItemRow[]; togetherVersion?: number;
  static?: StaticLayer;            // only when the static epoch moved
  menuInputs?: string[];
  scene?: unknown; sceneKey?: string;   // B-spatial: when `${spatial.epoch}|${entityPhysicsV1.hash}` moved: rebuild the spatial replica
  pages?: unknown;                 // B-spatial: spatial.pageRectsV1() when the windows moved
  navReady?: boolean;              // B-spatial: main's connectivity ready flag when it flipped
  menu?: MenuDelta;                // B-facade: changed action rows, verdicts, menu statics
};
/** Sent instead of a delta when a consumer can no longer follow: it must load a new WorldInit. */
export type Resnapshot = {t: 'resnapshot'; gen: number; reason: string};

export const OPEN_PHASES = new Set(['waiting', 'started']);

/** Every replicated table. `apply` refuses (returns false) a delta that is not the next one; the caller then re-inits. */
export class Replica {
  pos: StreamPos = {v: 1, gen: -1, seq: -1, tick: -1, logSeq: -1};
  entities = new Map<string, Ent>();
  env: Record<string, unknown> = {};
  living: WorldInit['living'] = null;
  static!: StaticLayer;
  minds = new Map<string, MindRow>(); mindByEntity = new Map<string, MindRow>();
  faded = new Set<string>();
  receipts = new Map<string, ReceiptRow>();
  programs = new Map<string, ProgramRow>(); holds = new Map<string, HoldRow>();
  objectGen = 0; objects = new Map<string, ObjectRecordRow>();
  items: ItemRow[] = []; togetherVersion = 0;
  menuInputs: string[] = [];
  scene: unknown = null; sceneKey = ''; pages: unknown = null; navReady = false;
  /** listeners for derived indexes (ReadModel): what changed in the last init/apply */
  onStatic?: (s: StaticLayer) => void;

  /** Keeps references into `w` (a structured clone, as a MessagePort delivers it); never mutates it. */
  init(w: WorldInit) {
    this.pos = {v: 1, gen: w.gen, seq: w.seq, tick: w.tick, logSeq: w.logSeq};
    this.entities = new Map(Object.entries(w.entities).map(([id, e]) => [id, {...e}]));   // shallow: a pose update replaces e.pose, never the source's
    this.env = w.env; this.living = w.living;
    this.minds.clear(); this.mindByEntity.clear(); for (const m of w.minds) this.setMind(m);
    this.faded = new Set(w.faded);
    this.receipts = new Map(w.receipts.map(r => [r.id, r]));
    this.programs = new Map(w.programs.map(r => [r[0], r])); this.holds = new Map(w.holds.map(r => [r[0], r]));
    this.objectGen = w.objects.gen; this.objects = new Map(w.objects.records.map(o => [o.id, o]));
    this.items = w.items; this.togetherVersion = w.togetherVersion; this.menuInputs = w.menuInputs;
    this.scene = w.scene; this.sceneKey = w.sceneKey; this.pages = w.pages; this.navReady = w.navReady;
    this.setStatic(w.static);
  }
  /** Apply the next delta. False (nothing applied) when it is from another gen or not seq + 1. */
  apply(d: WorldDelta): boolean {
    if (d.gen !== this.pos.gen || d.seq !== this.pos.seq + 1) return false;
    for (const e of d.ents ?? []) this.entities.set(e.id, e);
    for (const b of d.bodies ?? []) {const e = this.entities.get(b[0]); if (!e) continue; e.pose = {...e.pose, p: [b[1], b[2], b[3]], yaw: b[4]}; if (b.length === 6 && e.human) e.human = {...e.human, speed: b[5]};}
    for (const id of d.gone ?? []) this.entities.delete(id);
    if (d.env) this.env = d.env;
    if (d.living !== undefined) this.living = d.living;
    for (const m of d.minds ?? []) this.setMind(m);
    for (const id of d.mindsGone ?? []) {const m = this.minds.get(id); if (m) {this.minds.delete(id); if (this.mindByEntity.get(m.entityId) === m) this.mindByEntity.delete(m.entityId);}}
    if (d.faded) this.faded = new Set(d.faded);
    for (const r of d.receipts ?? []) if (OPEN_PHASES.has(r.phase)) this.receipts.set(r.id, r); else this.receipts.delete(r.id);
    for (const r of d.programs ?? []) if (r[1] === null) this.programs.delete(r[0]); else this.programs.set(r[0], r);
    for (const r of d.holds ?? []) if (!r[1].length) this.holds.delete(r[0]); else this.holds.set(r[0], r);
    if (d.objects) {for (const x of d.objects.deltas) if (x.gen > this.objectGen) {if (x.record) this.objects.set(x.id, x.record); else this.objects.delete(x.id);} this.objectGen = Math.max(this.objectGen, d.objects.gen);}
    if (d.items) this.items = d.items;
    if (d.togetherVersion !== undefined) this.togetherVersion = d.togetherVersion;
    if (d.menuInputs) this.menuInputs = d.menuInputs;
    if (d.sceneKey !== undefined) {this.scene = d.scene; this.sceneKey = d.sceneKey;}
    if (d.pages !== undefined) this.pages = d.pages;
    if (d.navReady !== undefined) this.navReady = d.navReady;
    if (d.static) this.setStatic(d.static);
    this.pos = {v: 1, gen: d.gen, seq: d.seq, tick: d.tick, logSeq: d.logSeq};
    return true;
  }
  private setStatic(s: StaticLayer) {this.static = s; this.onStatic?.(s);}
  private setMind(m: MindRow) {const old = this.minds.get(m.soulId); if (old && this.mindByEntity.get(old.entityId) === old) this.mindByEntity.delete(old.entityId); this.minds.set(m.soulId, m); this.mindByEntity.set(m.entityId, m);}
  openReceipts(soulId: string): ReceiptRow[] {return [...this.receipts.values()].filter(r => r.soulId === soulId).sort((a, b) => a.acceptedTick - b.acceptedTick || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));}
  get tick() {return this.pos.tick;}
  /** carriers, as engine.carriers() lists them (pose aside) */
  carrierRows(): CarrierRow[] {const out: CarrierRow[] = []; for (const e of this.entities.values()) {const c = (e as {carrier?: unknown}).carrier; if (c) out.push({id: e.id, def: String(e.def ?? ''), label: String(e.label ?? e.id), state: c});} return out;}
}

const cellOf = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
class CellIndex<T> {
  private cells = new Map<string, Map<string, T>>(); private where = new Map<string, string>();
  set(id: string, x: number, z: number, v: T) {
    const k = cellOf(x, z), old = this.where.get(id);
    if (old !== k) {if (old) this.cells.get(old)?.delete(id); this.where.set(id, k);}
    let c = this.cells.get(k); if (!c) this.cells.set(k, c = new Map()); c.set(id, v);
  }
  delete(id: string) {const k = this.where.get(id); if (k) {this.cells.get(k)?.delete(id); this.where.delete(id);}}
  clear() {this.cells.clear(); this.where.clear();}
  *near(x: number, z: number, r: number): Generator<T> {
    const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL), z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {const c = this.cells.get(`${i},${j}`); if (c) yield* c.values();}
  }
  get size() {return this.where.size;}
}

/** The spike's `here`/`capabilities` subset over a Replica (same API the spike's worker calls: init, apply, here,
 *  capabilities, stats, tick). Spatial indexes over the static layer are rebuilt when it changes; bodies are read from
 *  the replica's entities (Soul bodies only: the subset never looks at other bodies). */
export class ReadModel {
  readonly R = new Replica();
  private places!: PlaceIndex; private placeById = new Map<string, Place>(); private shells: Record<string, V2[]> = {};
  private solids = new CellIndex<Solid & {r: number}>(); private solidsBig: (Solid & {r: number})[] = [];
  private fires = new CellIndex<{id: string; name: string; at: V2}>();
  private spots = new CellIndex<{id: string; label: string; activity: string; at: V2}>();
  private regions: StaticLayer['regions'] = [];
  constructor() {this.R.onStatic = s => this.setStatic(s);}
  get tick() {return this.R.tick;}
  get epoch() {return this.R.static?.epoch ?? '';}
  init(w: WorldInit) {this.R.init(w);}
  apply(d: WorldDelta): boolean {return this.R.apply(d);}
  private setStatic(s: StaticLayer) {
    this.places = new PlaceIndex({contract: 'place-data/1', world: '', places: s.places}); this.placeById = new Map(s.places.map(p => [p.id, p])); this.shells = s.shells;
    this.solids.clear(); this.solidsBig = [];
    // a solid lives in the cell of its centre; ones wider than a cell are kept in a short list checked on every sightline
    for (const x of s.solids) {const r = Math.abs(x.half[0]) + Math.abs(x.half[1]), v = {...x, r}; if (r > CELL / 2) this.solidsBig.push(v); else this.solids.set(x.id, x.c[0], x.c[1], v);}
    this.fires.clear(); for (const f of s.fires) this.fires.set(f.id, f.at[0], f.at[1], f);
    this.spots.clear(); for (const p of s.spots) this.spots.set(p.id, p.at[0], p.at[1], p);
    this.regions = s.regions;
  }
  /** objects with a fixed point (state.at) by cell; the rest (located by a body) apart; rebuilt when the table moves */
  private objIdx: {gen: number; cells: CellIndex<ObjectRecordRow>; mobile: Map<string, ObjectRecordRow>} | null = null;
  private objectIndex() {
    if (this.objIdx?.gen === this.R.objectGen) return this.objIdx;
    const cells = new CellIndex<ObjectRecordRow>(), mobile = new Map<string, ObjectRecordRow>();
    for (const o of this.R.objects.values()) {
      const st = o.state as {at?: V2; removed?: boolean} | null; if (st?.removed) continue;
      if (Array.isArray(st?.at)) cells.set(o.id, st.at[0], st.at[1], o); else mobile.set(o.id, o);
    }
    return this.objIdx = {gen: this.R.objectGen, cells, mobile};
  }
  /** where an object is: its state.at, else its own body, else (a ride) its carrier's body */
  private objectAt(o: ObjectRecordRow): V2 | null {
    const st = o.state as {at?: V2; carrier?: string} | null;
    if (Array.isArray(st?.at)) return st.at;
    const e = this.R.entities.get(o.id) ?? (o.kind === 'ride' && typeof st?.carrier === 'string' ? this.R.entities.get(st.carrier) : undefined);
    return e ? [e.pose.p[0], e.pose.p[2]] : null;
  }

  // ---- the same rules as the ledger/Perception, over replicated data
  private enclosureAt(x: number, z: number, level = 0) {return this.places.containing(x, z, level).find(p => p.enclosed && inPoly(x, z, this.shells[p.id] ?? p.polygon))?.id ?? null;}
  private sightSolids(a: V2, b: V2): Solid[] {
    const mid: V2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], reach = dist2(a, b) / 2 + CELL / 2;
    return [...this.solids.near(mid[0], mid[1], reach), ...this.solidsBig];
  }
  private sees(a: V2, b: V2) {return clearSight(a, b, this.sightSolids(a, b)).clear;}
  private bodyOf(soulId: string) {const m = this.R.minds.get(soulId); return m ? this.R.entities.get(m.entityId) : undefined;}
  private levelOf(e: Ent) {return Number(e.human?.level ?? 0);}
  /** ledger.perceivedBodies: other Souls within radius, not faded, in the same enclosure (no sightline). */
  perceived(soulId: string, radius: number) {
    const mb = this.bodyOf(soulId); if (!mb) return [];
    const [mx, , mz] = mb.pose.p, myEnc = this.enclosureAt(mx, mz, this.levelOf(mb)), out: {soulId: string; entityId: string; name: string; distance: number; at: V2}[] = [];
    for (const o of this.R.minds.values()) {
      if (o.soulId === soulId || this.faded(o.soulId)) continue; const ob = this.R.entities.get(o.entityId); if (!ob) continue;
      const [ox, , oz] = ob.pose.p, d = Math.hypot(ox - mx, oz - mz); if (d > radius) continue;
      if (this.enclosureAt(ox, oz, this.levelOf(ob)) !== myEnc) continue;
      out.push({soulId: o.soulId, entityId: o.entityId, name: o.name, distance: Math.round(d * 10) / 10, at: [ox, oz]});
    }
    return out.sort((a, b) => a.distance - b.distance);
  }
  private faded(soulId: string) {return this.R.faded.has(soulId);}

  /** `here` subset: me.pos, near (ids + distances, sightline + enclosure), things of kind fire/spot/object(with a point)/item. */
  here(soulId: string) {
    const mb = this.bodyOf(soulId); if (!mb) return {tick: this.tick, me: null, near: [], things: []};
    const pos: V2 = [mb.pose.p[0], mb.pose.p[2]], enc = this.enclosureAt(pos[0], pos[1], this.levelOf(mb));
    const near = this.perceived(soulId, SIGHT_RADIUS).filter(o => this.sees(pos, o.at)).slice(0, 6).map(o => ({id: o.soulId, dist: o.distance}));
    const things: {kind: string; id: string; dist: number; at: V2}[] = [], d = (at: V2) => round1(dist2(pos, at));
    for (const f of this.fires.near(pos[0], pos[1], SIGHT_RADIUS)) if (d(f.at) <= SIGHT_RADIUS) things.push({kind: 'fire', id: f.id, dist: d(f.at), at: f.at});
    for (const s of this.spots.near(pos[0], pos[1], OBJECT_RADIUS)) if (d(s.at) <= OBJECT_RADIUS) things.push({kind: 'spot', id: s.id, dist: d(s.at), at: s.at});
    const idx = this.objectIndex();
    for (const o of [...idx.cells.near(pos[0], pos[1], OBJECT_RADIUS), ...idx.mobile.values()]) {
      const at = this.objectAt(o); if (at && d(at) <= OBJECT_RADIUS) things.push({kind: 'object', id: o.id, dist: d(at), at});
    }
    for (const i of this.R.items) if (d(i.at) <= OBJECT_RADIUS) things.push({kind: 'item', id: i.id, dist: d(i.at), at: i.at});
    const seen = things.filter(t => this.enclosureAt(t.at[0], t.at[1], 0) === enc && this.sees(pos, t.at))
      .sort((a, b) => a.dist - b.dist || a.id.localeCompare(b.id)).map(t => ({kind: t.kind, id: t.id, dist: t.dist}));
    return {tick: this.tick, me: {pos: [round1(pos[0]), round1(pos[1])] as V2}, near, things: seen};
  }

  /** `capabilities` subset: the ids of go-near/wave/face (perceived Souls), warm-by-fire (150 m), gather (60 m). */
  capabilities(soulId: string): string[] {
    const mb = this.bodyOf(soulId); if (!mb) return [];
    const out: string[] = [], [x, , z] = mb.pose.p;
    for (const o of this.perceived(soulId, GO_NEAR_RADIUS)) out.push('go-near:' + o.soulId);
    for (const o of this.perceived(soulId, NEAR_RADIUS)) out.push('wave:' + o.soulId, 'face:' + o.soulId);
    for (const f of this.fires.near(x, z, FIRE_OFFER_RADIUS)) if (Math.hypot(f.at[0] - x, f.at[1] - z) <= FIRE_OFFER_RADIUS) out.push('warm-by-fire:' + f.id);
    for (const r of this.regions) if (Math.hypot(r.c[0] - x, r.c[1] - z) <= GATHER_RADIUS) out.push('gather:' + r.id);
    return out.sort();
  }
  stats() {const R = this.R; return {tick: R.tick, gen: R.pos.gen, seq: R.pos.seq, epoch: this.epoch, entities: R.entities.size, minds: R.minds.size, places: this.placeById.size, solids: this.solids.size + this.solidsBig.length, solidsBig: this.solidsBig.length, fires: this.fires.size, spots: this.spots.size, objects: R.objects.size, items: R.items.length, receipts: R.receipts.size};}
}

export {centroid};
