// Stage B (lane B-facade, item 6): the read worker's world host. The Soul read code (EdgeLedger's binds / perception /
// together / god-nav reads) is written against a `WorldHost`; in a read worker it gets this one instead: a read-only
// host over a ReplicaWorld (split/replica-world.ts) and a read-only sqlite connection to the world's database (WAL: the
// worker sees each commit main makes, never writes). Its `engine` is not an engine: every read the read code makes goes
// through `menuWorldOf(host)` (registered here with setMenuWorld), and any reach left into `host.engine` throws
// `MainOnly`, which the worker answers by forwarding the request to main (counted), never with a wrong answer.
//
// What it answers: minds / mindByEntity (replicated rows), kernel (the pump's statics), living, worldId, db (read-only),
// seq (the stream's log seq: the read code keys its per-tick caches on it), the host's name helpers (profiles and name
// claims shipped in the pump's statics), and an EdgeLedger built with `readOnly` (no DDL beyond the no-op IF NOT EXISTS,
// no restart re-arm loop that writes, no host hooks).
import {DatabaseSync} from 'node:sqlite';
import type {Db} from '../db.ts';
import type {Mind} from '../world.ts';
import {EdgeLedger} from '../edge/ledger/ledger.ts';
import {setMenuWorld} from './menu-world.ts';
import type {ReplicaWorld} from './replica-world.ts';
import type {MindRow} from './read-model.ts';

/** A reach into main-only state from read code: the request is answered by main instead (read-worker.ts). */
export class MainOnly extends Error {
  constructor(what: string) {super(`read worker: ${what} is main-only`); this.name = 'MainOnly';}
}
const mainOnly = (what: string) => () => {throw new MainOnly(what);};
const ENGINE = new Proxy({}, {get: (_t, k) => {if (k === 'then' || typeof k === 'symbol') return undefined; throw new MainOnly(`host.engine.${String(k)}`);}});

/** A Mind as the read code reads it, from the replicated row (the brain's private fields are not replicated). */
const mindOf = (m: MindRow): Mind => ({soulId: m.soulId, entityId: m.entityId, name: m.name, owner: m.owner, native: m.native, description: '',
  intent: null, intentVersion: 0, mood: '', energy: 1, wantsCompany: 0, recent: [], doing: '', nextEvalTick: 0, evalTrigger: '', lastEnergyTick: 0,
  lastFingerprint: '', nudge: null, agenda: [], agendaPos: 0} as unknown as Mind);

type SoulProfileFact = {revision: number; name: string; birthName: string};
type Names = {profiles?: Record<string, SoulProfileFact>; claims?: Record<string, string[]>};

export class ReadOnlyHost {
  readonly engine = ENGINE;
  readonly worldId: string;
  readonly db: Db;
  readonly rw: ReplicaWorld;
  readonly listeners: never[] = [];
  readonly extra: Record<string, unknown> = {};
  private mindsAt = -1; private mindsKey = '';
  private _minds = new Map<string, Mind>(); private _byEntity = new Map<string, Mind>();
  enqueue = mainOnly('host.enqueue'); enqueueChecked = mainOnly('host.enqueueChecked'); enqueueObjectDecision = mainOnly('host.enqueueObjectDecision');
  quietBarrier = mainOnly('host.quietBarrier'); markSoulDirty = () => {/* a read never dirties a Soul */};
  ownLectureRosterV1 = mainOnly('host.ownLectureRosterV1');
  /** what the ledger would publish on a real host (D1 approach line, the body card): unused in a worker */
  approachV1?: unknown; publicBodyOf?: unknown; recoveryForEdge = false;

  constructor(rw: ReplicaWorld, worldId: string, dbPath: string) {
    this.rw = rw; this.worldId = worldId;
    const db = new DatabaseSync(dbPath, {readOnly: true});
    db.exec('PRAGMA busy_timeout = 2000; PRAGMA query_only = 1;');
    this.db = {db, path: dbPath, soul: (id: string) => db.prepare('SELECT * FROM souls WHERE id = ?').get(id)} as unknown as Db;
    setMenuWorld(this, rw.mw);
  }
  get seq() {return this.rw.R.pos.logSeq;}
  get kernel() {return this.rw.kernel as never;}
  get living() {return this.rw.R.living as never;}
  private syncMinds() {
    const R = this.rw.R;
    if (this.mindsAt === R.pos.seq && this.mindsKey === `${R.minds.size}`) return;
    this.mindsAt = R.pos.seq; this.mindsKey = `${R.minds.size}`;
    const next = new Map<string, Mind>(), byEntity = new Map<string, Mind>();
    for (const r of R.minds.values()) {
      const old = this._minds.get(r.soulId), m = old && old.entityId === r.entityId && old.name === r.name && old.owner === r.owner && old.native === r.native ? old : mindOf(r);
      next.set(r.soulId, m); byEntity.set(r.entityId, m);
    }
    this._minds = next; this._byEntity = byEntity;
  }
  get minds() {this.syncMinds(); return this._minds;}
  get mindByEntity() {this.syncMinds(); return this._byEntity;}
  // ---- the host's name helpers (world.ts), over the replicated minds and the shipped names
  private get names(): Names {return (this.rw.names ?? {}) as Names;}
  profileFact(id: string) {return this.names.profiles?.[id];}
  currentProfileName(id: string, birthName: string) {const p = this.profileFact(id); return p?.birthName === birthName ? p.name : birthName;}
  soulNameRefusal(ref: string): 'soul.name-stale' | 'soul.name-ambiguous' | null {
    if (this.minds.has(ref)) return null;
    const key = ref.trim().normalize('NFKC').toLowerCase(), old = this.names.claims?.[key];
    if (!old?.length) return null;
    const current = [...this.minds.values()].filter(m => m.name.trim().normalize('NFKC').toLowerCase() === key);
    return current.length === 1 && old.every(id => id === current[0].soulId) ? null : current.length ? 'soul.name-ambiguous' : 'soul.name-stale';
  }
  publicNameMetadata(id: string) {const name = this.minds.get(id)?.name; return name && this.soulNameRefusal(name) === 'soul.name-ambiguous' ? {nameAmbiguous: true as const} : {};}
  nameOf(id: string): string {
    const k = this.rw.kernel as {things?: Record<string, {name?: string}>} | null, w = this.rw.mw.world as unknown as {entities: Record<string, {label?: string}>; regions: Record<string, {label?: string}>};
    return k?.things?.[id]?.name ?? w.entities[id]?.label ?? w.regions?.[id]?.label ?? id;
  }
  nowOf() {return null;}
  close() {setMenuWorld(this, null); try {(this.db.db as DatabaseSync).close();} catch {/* closed */}}
}

/** The worker's ledger: the main ledger's read code over the read-only host. `placeData` = what main loaded (PLACE_DATA),
 *  else derived from the replicated world, as main derives it. */
export function readLedger(host: ReadOnlyHost, placeData?: unknown, env: NodeJS.ProcessEnv = process.env) {
  const L = new EdgeLedger(host as never, host.db, placeData, {readOnly: true});
  L.comms = readComms(host, env.EDGE_FADING === '1', env.SIM_BEAM === '1') as never;
  return L;
}

/** The comms reads the read code makes, from the database main writes (edge/comms/fading.ts status()). With the idle
 *  beam-up on, a Soul's colour depends on main's in-memory holds: main answers (MainOnly). */
function readComms(host: ReadOnlyHost, fading: boolean, beam: boolean) {
  const db = host.db.db as DatabaseSync;
  let q: ReturnType<DatabaseSync['prepare']> | null = null;
  const objs: {gen: number; n: number; list: readonly unknown[]} = {gen: -1, n: -1, list: []};
  return {
    fading: {
      status(soulId: string): {colour: string; idleSeconds: number} | null {
        if (!fading) return null;
        if (beam) throw new MainOnly('fading.status with SIM_BEAM');
        q ??= db.prepare('SELECT last_at, colour FROM edge_comms_activity WHERE world_id = ? AND soul_id = ?');
        const r = q.get(host.worldId, soulId) as {last_at: number; colour: string} | undefined;
        if (!r) return {colour: 'green', idleSeconds: 0};
        return r.colour === 'gone' ? {colour: 'gone', idleSeconds: Math.floor((Date.now() - r.last_at) / 1000)} : {colour: 'green', idleSeconds: 0};
      },
    },
    get streams(): never {throw new MainOnly('comms.streams');},
    /** the replicated comms object table (B-delta: L8 table snapshot + changes), in the table's id order */
    objects: new Proxy({
      all: () => {const R = host.rw.R; if (objs.gen !== R.objectGen || objs.n !== R.objects.size) {objs.gen = R.objectGen; objs.n = R.objects.size; objs.list = Object.freeze([...R.objects.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0));} return objs.list;},
      has: (id: string) => host.rw.R.objects.has(id),
    } as Record<string, unknown>, {get: (t, k) => {if (k in t || typeof k === 'symbol') return t[k as string]; throw new MainOnly(`comms.objects.${String(k)}`);}}),
    close() {/* nothing held */},
  };
}
