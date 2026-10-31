// Stage B (lane B-facade, rotation 4): the comms objects of a read worker. Main's `Objects` (edge/comms/objects/
// framework.ts) answers the read code's object reads (observe's here.objects through visibleTo, the `object:<id>:<action>`
// offers through its capability provider, here's listing through all()) over its in-memory table; GodPerceive registers
// one kind per kind of god-built thing on it and wraps visibleTo. A worker runs the same framework code over
//   - `ReplicaObjectTable`: the replicated table (B-delta: L8 snapshot + changes, `ReplicaWorld.R.objects`) with the
//     read API of `ObjectTable` (rows, id order, kind lists, the 32 m cell index), re-indexed when the replica moves;
//   - the kinds main registers (the six comms kinds here; the god's built kinds by the read bridge's GodPerceive, the
//     same way and in the same order as main's, so names like `built-chess` come out the same);
//   - no writes: a time-driven advance a listing applies is computed as main computes it and returned, never saved (main
//     saves it when it lists, and the delta brings the row); create/refresh (GodPerceive bringing objects in line with the
//     god's edits) are main's: the row arrives with the delta. Acting is main-only.
import {Objects, checkState, isRefreshOnlyObjectAdvance} from '../edge/comms/objects/framework.ts';
import {canonicalJson, stateDigest} from '../edge/comms/objects/table.ts';
import {chessKind} from '../edge/comms/objects/chess.ts';
import {presentationKind} from '../edge/comms/objects/presentation.ts';
import {markKind, projectKind} from '../edge/comms/objects/marks.ts';
import {calendarKind} from '../edge/comms/objects/calendar.ts';
import {rideKind} from '../edge/comms/objects/ride.ts';
import type {ObjectKind, ObjectRecord, TimeCtx} from '../edge/comms/objects/types.ts';
import type {CommsCore} from '../edge/comms/core.ts';
import type {EdgeLedger} from '../edge/ledger/ledger.ts';

const CELL = 32;
const cellKey = (cx: number, cz: number) => `${cx},${cz}`;
const atOf = (o: ObjectRecord): [number, number] | null => {
  const at = (o.state as {at?: unknown} | null)?.at;
  return Array.isArray(at) && at.length >= 2 && Number.isFinite(at[0]) && Number.isFinite(at[1]) ? [at[0] as number, at[1] as number] : null;
};
const EMPTY: readonly ObjectRecord[] = Object.freeze([]);
/** kinds whose advance is marked readOnlyObjectAdvance on main (it neither mutates nor keeps its input) */
const READ_ONLY_KINDS = new Set(['calendar-item']);
type Source = () => {objectGen: number; objects: Map<string, ObjectRecord>};

/** ObjectTable's read API over the replicated rows (rebuilt when the replica's object generation or map moves). */
export class ReplicaObjectTable {
  private src: Source; private gen = -1; private map: Map<string, ObjectRecord> | null = null;
  private sorted: readonly ObjectRecord[] = EMPTY; private idList: readonly string[] = [];
  private kinds = new Map<string, readonly ObjectRecord[]>(); private cells = new Map<string, string[]>();
  readonly cost = {rebuilds: 0, ms: 0};
  constructor(src: Source) {this.src = src;}
  sync(): this {
    const R = this.src(); if (R.objectGen === this.gen && R.objects === this.map) return this;
    const t0 = performance.now();
    this.gen = R.objectGen; this.map = R.objects;
    const all = [...R.objects.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    this.sorted = Object.freeze(all); this.idList = Object.freeze(all.map(o => o.id));
    const kinds = new Map<string, ObjectRecord[]>(), cells = new Map<string, string[]>();
    for (const o of all) {
      let k = kinds.get(o.kind); if (!k) kinds.set(o.kind, k = []); k.push(o);
      const at = atOf(o); if (at) {const key = cellKey(Math.floor(at[0] / CELL), Math.floor(at[1] / CELL)); let c = cells.get(key); if (!c) cells.set(key, c = []); c.push(o.id);}
    }
    for (const [k, v] of kinds) Object.freeze(v), this.kinds.set(k, v);
    for (const k of [...this.kinds.keys()]) if (!kinds.has(k)) this.kinds.delete(k);
    this.cells = cells;
    this.cost.rebuilds++; this.cost.ms += performance.now() - t0;
    return this;
  }
  get generation() {return this.gen;}
  get(id: string): ObjectRecord | undefined {return this.map?.get(id);}
  has(id: string): boolean {return !!this.map?.has(id);}
  all(): readonly ObjectRecord[] {return this.sorted;}
  ids(): readonly string[] {return this.idList;}
  ofKind(kind: string): readonly ObjectRecord[] {return this.kinds.get(kind) ?? EMPTY;}
  kindsPresent(): IterableIterator<string> {return this.kinds.keys();}
  near(at: readonly [number, number], radius: number): string[] {
    const out: string[] = [];
    const x0 = Math.floor((at[0] - radius) / CELL), x1 = Math.floor((at[0] + radius) / CELL), z0 = Math.floor((at[1] - radius) / CELL), z1 = Math.floor((at[1] + radius) / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      for (const id of this.cells.get(cellKey(cx, cz)) ?? []) {const p = atOf(this.map!.get(id)!)!; if (Math.hypot(p[0] - at[0], p[1] - at[1]) <= radius) out.push(id);}
    }
    return out;
  }
  /** a replica has no per-cell generations: any change anywhere moves it (a cache key on it is only ever conservative) */
  generationNear(): number {return this.gen;}
  snapshot() {return {gen: this.gen, records: this.sorted};}
  changes(): null {return null;}
  wrote() {/* a worker writes nothing */}
  removed() {/* nor removes */}
  reload() {/* follows the replica */}
}

export type ReplicaObjectsOpts = {db: CommsCore['db']; worldId: string; tick(): number; nameOf(id: string): string; ledger: EdgeLedger; src: Source; mainOnly(what: string): never};

/** main's Objects framework over the replicated table, read-only; the six comms kinds registered as on main. */
export function replicaObjects(o: ReplicaObjectsOpts): Objects & {replicaTable: ReplicaObjectTable} {
  const table = new ReplicaObjectTable(o.src);
  const core = {deps: {ledger: o.ledger} as never, db: o.db, worldId: o.worldId, streams: null as never, now: () => Date.now(), tick: o.tick, nameOf: o.nameOf,
    liveSoulIds: () => [], isLive: () => false, spectate: () => {/* nobody listens to a worker */}} as CommsCore;
  const objs = new Objects(core);
  for (const k of [chessKind, presentationKind, markKind, projectKind, calendarKind, rideKind]) objs.register(k as never);
  Object.defineProperty(objs, 'table', {get: () => table.sync()});
  const x = objs as unknown as Record<string, unknown>;
  x.save = () => {/* main saves the advance it computes when it lists; the delta brings the row */};
  x.log = () => {/* main logs */};
  x.emit = () => {/* main delivers */};
  // GodPerceive bringing an object in line with the god's edits: main does it (create/refresh), the row comes with a delta
  x.create = (input: {id: string; kind: string; name: string; description?: string; placeId: string}) => table.sync().get(input.id) ?? {...input, description: input.description ?? '', version: 0, state: {}, createdAt: 0};
  x.refresh = () => {/* main's */};
  x.reload = () => {/* follows the replica */};
  // main's freshList, without the writes: after main's first written advance it re-reads each later row in its own
  // transaction (an emit may have changed it); nothing is written here, so every row is advanced as read (one savepoint per
  // object of a world was ~2x main's own listing). Same records out: an advance that changes nothing (same state, no
  // events) keeps the row, otherwise the row with the new state and the next version, exactly as main's `advanced`.
  const kinds = (objs as unknown as {kinds: Map<string, ObjectKind>}).kinds, timeCtx = () => (objs as unknown as {timeCtx(): TimeCtx}).timeCtx();
  x.freshList = (only: readonly ObjectRecord[] | undefined, withRefreshOnly: boolean): ObjectRecord[] => {
    const rows = only ?? table.sync().all();
    let ctx: TimeCtx | undefined;
    return rows.map(o => {
      const kind = kinds.get(o.kind), advance = kind?.advance;
      if (!kind || !advance || (!withRefreshOnly && isRefreshOnlyObjectAdvance(advance))) return o;
      // READ_ONLY advances (calendar items: thousands of them) read the state without a defensive copy, as on main
      const step = advance.call(kind, READ_ONLY_KINDS.has(o.kind) ? o.state : structuredClone(o.state), ctx ??= timeCtx());
      if (!step) return o;
      checkState(kind, step.state);
      if (!step.events?.length && canonicalJson(step.state) === stateDigest(o.state)) return o;
      return {...o, state: step.state, version: o.version + 1};
    });
  };
  for (const k of ['act', 'prepareAct', 'remove', 'sweep', 'sweepSteps']) x[k] = () => o.mainOnly(`comms.objects.${k}`);
  return Object.assign(objs, {replicaTable: table});
}
