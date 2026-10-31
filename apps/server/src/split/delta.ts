// Stage B spike (lane L9): the per-tick WorldDelta, built on the tick thread after tickOnce. PROTOTYPE.
// Reads the host/ledger the same way the read path does and emits only what changed. Cost and size are measured by
// split/preload.ts (CPU on the tick thread per tick, JSON bytes per tick). Types live in split/read-model.ts.
import {threadCpuUsage} from 'node:process';
import type {WorldHost} from '../world.ts';
import type {EdgeLedger} from '../edge/ledger/ledger.ts';
import {isCampfire} from '../edge/ledger/fire.ts';
import {centroid} from '../edge/ledger/places.ts';
import type {BodyRow, ItemRow, MindRow, ObjectRow, StaticLayer, WorldDelta, WorldInit} from './read-model.ts';

type V2 = [number, number];
type Ent = {id: string; def?: string; kind?: string; label?: string; pose: {p: number[]; yaw: number}; human?: {activity?: string; level?: number}};
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const cpuMs = () => {const u = threadCpuUsage(); return (u.user + u.system) / 1000;};

export class DeltaTap {
  private last = new Map<string, string>(); private lastMinds = new Map<string, string>(); private lastFaded = '';
  private lastObjects = new Map<string, string>(); private lastItems = ''; private lastEpoch = '';
  readonly cost = {ticks: 0, cpuMs: 0, bytes: 0, maxBytes: 0, maxCpuMs: 0, staticSends: 0, staticBytes: 0, objectScans: 0, objectCpuMs: 0, objectBytes: 0, bodyRows: 0};
  /** per tick, without the periodic object/static scan: [cpuMs, bytes] (the steady body stream) */
  readonly steady: [number, number][] = [];
  /** OBJECTS_EVERY: the comms object table has no change feed on main (L8 is adding one), so the prototype diffs it every N ticks. */
  readonly host: WorldHost; readonly L: EdgeLedger; readonly objectsEvery: number;
  constructor(host: WorldHost, L: EdgeLedger, objectsEvery = 20) {this.host = host; this.L = L; this.objectsEvery = objectsEvery;}

  private world() {return this.host.engine.world as unknown as {tick: number; entities: Record<string, Ent>; regions: Record<string, {polygon: V2[]}>; navV1?: {solids?: unknown[]}};}
  /** The static epoch: what the read model's static layer depends on. Cheap proxies (no planner sync). */
  private epochKey() {
    const w = this.world(), solids = w.navV1?.solids?.length ?? 0, nEnt = Object.keys(w.entities).length, nReg = Object.keys(w.regions).length;
    return `${solids}|${nEnt}|${nReg}|${this.L.places.byId.size}|${this.L.spots.spots.length}`;
  }
  staticLayer(): StaticLayer {
    const w = this.world(), L = this.L;
    const solids = (((w.navV1?.solids ?? []) as {id: string; label?: string; obb?: {c: V2; half: V2; yaw: number}; c?: V2; half?: V2; yaw?: number; y1?: number; height?: number}[])
      .flatMap(x => {const o = x.obb ?? (x.c && x.half ? {c: x.c, half: x.half, yaw: x.yaw ?? 0} : null); return o ? [{id: x.id, ...(x.label ? {label: x.label} : {}), c: o.c, half: o.half, yaw: o.yaw, height: x.y1 ?? x.height}] : [];}));
    const shells: Record<string, V2[]> = {}; for (const p of L.enclosurePlaces()) if (p.enclosed) shells[p.id] = p.polygon as V2[];
    const fires = Object.values(w.entities).filter(e => isCampfire(e)).map(e => ({id: e.id, name: e.label ?? 'campfire', at: [e.pose.p[0], e.pose.p[2]] as V2}));
    const regions = Object.entries(w.regions ?? {}).filter(([id]) => L.places.byId.has(id)).map(([id, r]) => ({id, name: L.places.byId.get(id)!.name, c: centroid(r.polygon)}));
    const spots = L.spots.spots.map(s => ({id: s.id, label: s.label ?? s.activity, activity: s.activity, at: s.at as V2}));
    return {epoch: this.epochKey(), places: [...L.places.byId.values()], shells, solids, fires, regions, spots};
  }
  private bodyRow(e: Ent): BodyRow {return [e.id, r3(e.pose.p[0]), r3(e.pose.p[1]), r3(e.pose.p[2]), r3(e.pose.yaw), String(e.human?.activity ?? ''), e.human?.level ?? 0];}
  /** Bodies = humans plus every non-static entity that has moved since init (carriers, boats, items in hand). */
  private moving = new Set<string>();
  private mindsNow(): MindRow[] {return [...this.host.minds.values()].map(m => ({soulId: m.soulId, entityId: m.entityId, name: m.name}));}
  private objectsNow(): ObjectRow[] {
    const w = this.world();
    return (this.L.comms?.objects.all() ?? []).map(o => {const st = o.state as {at?: V2; removed?: boolean; carrier?: string};
      const body = w.entities[o.id] ?? (o.kind === 'ride' && typeof st?.carrier === 'string' ? w.entities[st.carrier] : undefined);
      return {id: o.id, kind: o.kind, name: (o as {name?: string}).name ?? o.kind, placeId: o.placeId, at: Array.isArray(st?.at) ? st.at : body ? [body.pose.p[0], body.pose.p[2]] as V2 : null, ...(st?.removed ? {removed: true} : {})};});
  }
  private itemsNow(): ItemRow[] {return this.L.together.publicItems().filter(i => i.state === 'placed' && Array.isArray(i.at)).map(i => ({id: i.id, name: i.name, at: i.at as V2}));}

  init(): WorldInit {
    const w = this.world(), bodies: BodyRow[] = [];
    for (const e of Object.values(w.entities)) {const row = this.bodyRow(e); bodies.push(row); this.last.set(e.id, JSON.stringify(row)); if (e.kind === 'human') this.moving.add(e.id);}
    const minds = this.mindsNow(); for (const m of minds) this.lastMinds.set(m.soulId, JSON.stringify(m));
    const faded = [...this.L.faded].sort(); this.lastFaded = faded.join('|');
    const objects = this.objectsNow(); for (const o of objects) this.lastObjects.set(o.id, JSON.stringify(o));
    const items = this.itemsNow(); this.lastItems = JSON.stringify(items);
    const st = this.staticLayer(); this.lastEpoch = st.epoch;
    return {tick: w.tick, static: st, bodies, minds, faded, objects, items};
  }
  /** After a tick: `changed` = entity ids the engine reported in this step's paths/changes. */
  delta(changed: Iterable<string>): WorldDelta {
    const c0 = cpuMs(), w = this.world(), d: WorldDelta = {tick: w.tick};
    for (const id of changed) if (w.entities[id]) this.moving.add(id);
    const bodies: BodyRow[] = [], gone: string[] = [];
    for (const id of this.moving) {
      const e = w.entities[id]; if (!e) {gone.push(id); this.moving.delete(id); this.last.delete(id); continue;}
      const row = this.bodyRow(e), k = JSON.stringify(row); if (this.last.get(id) !== k) {this.last.set(id, k); bodies.push(row);}
    }
    if (bodies.length) d.bodies = bodies; if (gone.length) d.gone = gone;
    if (this.host.minds.size !== this.lastMinds.size || [...this.host.minds.values()].some(m => !this.lastMinds.has(m.soulId))) {
      const now = this.mindsNow(), ids = new Set(now.map(m => m.soulId)); d.minds = now.filter(m => this.lastMinds.get(m.soulId) !== JSON.stringify(m));
      d.mindsGone = [...this.lastMinds.keys()].filter(id => !ids.has(id)); this.lastMinds = new Map(now.map(m => [m.soulId, JSON.stringify(m)]));
      for (const m of now) if (!this.moving.has(m.entityId) && w.entities[m.entityId]) this.moving.add(m.entityId);
    }
    const faded = [...this.L.faded].sort().join('|'); if (faded !== this.lastFaded) {this.lastFaded = faded; d.faded = faded ? faded.split('|') : [];}
    if (w.tick % this.objectsEvery === 0) {
      const o0 = cpuMs(); this.cost.objectScans++;
      const objs = this.objectsNow().filter(o => {const k = JSON.stringify(o); if (this.lastObjects.get(o.id) === k) return false; this.lastObjects.set(o.id, k); return true;});
      if (objs.length) d.objects = objs;
      const items = this.itemsNow(), ik = JSON.stringify(items); if (ik !== this.lastItems) {this.lastItems = ik; d.items = items;}
      const ep = this.epochKey(); if (ep !== this.lastEpoch) {d.static = this.staticLayer(); this.lastEpoch = ep; this.cost.staticSends++; this.cost.staticBytes += JSON.stringify(d.static).length;}
      this.cost.objectCpuMs += cpuMs() - o0; this.cost.objectBytes += JSON.stringify(d.objects ?? []).length + JSON.stringify(d.items ?? []).length;
    } else {const b = JSON.stringify(d).length; if (this.steady.length < 20000) this.steady.push([cpuMs() - c0, b]);}
    this.cost.bodyRows += bodies.length;
    const ms = cpuMs() - c0, bytes = JSON.stringify(d).length;
    this.cost.ticks++; this.cost.cpuMs += ms; this.cost.bytes += bytes; this.cost.maxBytes = Math.max(this.cost.maxBytes, bytes); this.cost.maxCpuMs = Math.max(this.cost.maxCpuMs, ms);
    return d;
  }
}
