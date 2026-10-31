// Stage B spike (lane L9): a replicated read model of one world, fed by WorldDelta, indexed by 32 m cells. PROTOTYPE.
// Serves a declared SUBSET of `here` and `capabilities` for one Soul from its neighbourhood, with no engine access.
// Pure: no host, no engine, no db — only the data in WorldInit/WorldDelta (split/delta.ts). Shared by the worker
// (split/read-worker.ts) and by in-thread tests. The subset and why the rest is out are in docs/sim/STAGE-B-SPLIT.md §3.
import {clearSight, dist2, round1, type Solid} from '../edge/perception/geometry.ts';
import {PlaceIndex, centroid, inPoly, type Place} from '../edge/ledger/places.ts';

type V2 = [number, number];
export const CELL = 32;
const SIGHT_RADIUS = 30, OBJECT_RADIUS = 15, NEAR_RADIUS = 20, GO_NEAR_RADIUS = 60, FIRE_OFFER_RADIUS = 150, GATHER_RADIUS = 60;

/** A body or a moving entity: [id, x, y, z, yaw, activity, level] (humans), or [id, x, y, z, yaw, '', 0] (others). */
export type BodyRow = [string, number, number, number, number, string, number];
export type MindRow = {soulId: string; entityId: string; name: string};
export type ObjectRow = {id: string; kind: string; name: string; placeId: string; at: V2 | null; removed?: boolean};
export type ItemRow = {id: string; name: string; at: V2};
export type StaticLayer = {
  epoch: string;
  places: Place[];                 // ledger.places.byId (containment uses the authored polygons)
  shells: Record<string, V2[]>;    // enclosed place -> its validated room shell (ledger.enclosurePlaces), for the enclosure rule
  solids: Solid[];                 // world.navV1.solids, as Perception.solids() shapes them
  fires: {id: string; name: string; at: V2}[];
  regions: {id: string; name: string; c: V2}[];   // world regions that are also places (gather offers)
  spots: {id: string; label: string; activity: string; at: V2}[];
};
export type WorldInit = {tick: number; static: StaticLayer; bodies: BodyRow[]; minds: MindRow[]; faded: string[]; objects: ObjectRow[]; items: ItemRow[]};
export type WorldDelta = {
  tick: number;
  static?: StaticLayer;            // only when the static epoch moved (god edit, nav change)
  bodies?: BodyRow[];              // bodies whose pose/activity/level changed this tick
  gone?: string[];                 // entities removed
  minds?: MindRow[]; mindsGone?: string[]; faded?: string[];   // faded: the whole set, only when it changed
  objects?: ObjectRow[]; items?: ItemRow[];                   // whole changed rows; items: the whole placed list when it changed
};

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

export class ReadModel {
  tick = -1; epoch = '';
  private places!: PlaceIndex; private placeById = new Map<string, Place>(); private shells: Record<string, V2[]> = {};
  private solids = new CellIndex<Solid & {r: number}>(); private solidsBig: (Solid & {r: number})[] = [];
  private fires = new CellIndex<{id: string; name: string; at: V2}>();
  private spots = new CellIndex<{id: string; label: string; activity: string; at: V2}>();
  private regions: StaticLayer['regions'] = [];
  readonly bodies = new Map<string, BodyRow>(); private bodyCells = new CellIndex<BodyRow>();
  private minds = new Map<string, MindRow>(); private mindByEntity = new Map<string, MindRow>(); private faded = new Set<string>();
  private objects = new Map<string, ObjectRow>(); private objectCells = new CellIndex<ObjectRow>(); private mobileObjects = new Map<string, ObjectRow>(); private items: ItemRow[] = [];

  init(w: WorldInit) {
    this.setStatic(w.static);
    this.bodies.clear(); this.bodyCells.clear(); for (const b of w.bodies) this.setBody(b);
    this.minds.clear(); this.mindByEntity.clear(); for (const m of w.minds) this.setMind(m);
    this.faded = new Set(w.faded); this.objects.clear(); this.objectCells.clear(); this.mobileObjects.clear(); for (const o of w.objects) this.setObject(o); this.items = w.items; this.tick = w.tick;
  }
  apply(d: WorldDelta) {
    if (d.static) this.setStatic(d.static);
    for (const b of d.bodies ?? []) this.setBody(b);
    for (const id of d.gone ?? []) {this.bodies.delete(id); this.bodyCells.delete(id);}
    for (const m of d.minds ?? []) this.setMind(m);
    for (const id of d.mindsGone ?? []) {const m = this.minds.get(id); if (m) {this.minds.delete(id); this.mindByEntity.delete(m.entityId);}}
    if (d.faded) this.faded = new Set(d.faded);
    for (const o of d.objects ?? []) this.setObject(o);
    if (d.items) this.items = d.items;
    this.tick = d.tick;
  }
  private setStatic(s: StaticLayer) {
    this.epoch = s.epoch; this.places = new PlaceIndex({contract: 'place-data/1', world: '', places: s.places}); this.placeById = new Map(s.places.map(p => [p.id, p])); this.shells = s.shells;
    this.solids.clear(); this.solidsBig = [];
    // a solid lives in the cell of its centre; ones wider than a cell are kept in a short list checked on every sightline
    for (const x of s.solids) {const r = Math.abs(x.half[0]) + Math.abs(x.half[1]), v = {...x, r}; if (r > CELL / 2) this.solidsBig.push(v); else this.solids.set(x.id, x.c[0], x.c[1], v);}
    this.fires.clear(); for (const f of s.fires) this.fires.set(f.id, f.at[0], f.at[1], f);
    this.spots.clear(); for (const p of s.spots) this.spots.set(p.id, p.at[0], p.at[1], p);
    this.regions = s.regions;
  }
  /** objects with a fixed point live in their cell; the few without one (rides: where their carrier is) are listed apart */
  private setObject(o: ObjectRow) {
    this.objects.set(o.id, o); this.objectCells.delete(o.id); this.mobileObjects.delete(o.id);
    if (o.removed) return; if (o.at) this.objectCells.set(o.id, o.at[0], o.at[1], o); else this.mobileObjects.set(o.id, o);
  }
  private setBody(b: BodyRow) {this.bodies.set(b[0], b); this.bodyCells.set(b[0], b[1], b[3], b);}
  private setMind(m: MindRow) {this.minds.set(m.soulId, m); this.mindByEntity.set(m.entityId, m);}

  // ---- the same rules as the ledger/Perception, over replicated data
  private enclosureAt(x: number, z: number, level = 0) {return this.places.containing(x, z, level).find(p => p.enclosed && inPoly(x, z, this.shells[p.id] ?? p.polygon))?.id ?? null;}
  private sightSolids(a: V2, b: V2): Solid[] {
    const mid: V2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], reach = dist2(a, b) / 2 + CELL / 2;
    return [...this.solids.near(mid[0], mid[1], reach), ...this.solidsBig];
  }
  private sees(a: V2, b: V2) {return clearSight(a, b, this.sightSolids(a, b)).clear;}
  private bodyOf(soulId: string) {const m = this.minds.get(soulId); return m ? this.bodies.get(m.entityId) : undefined;}
  /** ledger.perceivedBodies: other Souls within radius, not faded, in the same enclosure (no sightline). */
  perceived(soulId: string, radius: number) {
    const mb = this.bodyOf(soulId); if (!mb) return [];
    const myEnc = this.enclosureAt(mb[1], mb[3], mb[6]), out: {soulId: string; entityId: string; name: string; distance: number; at: V2}[] = [];
    for (const ob of this.bodyCells.near(mb[1], mb[3], radius)) {
      const o = this.mindByEntity.get(ob[0]); if (!o || o.soulId === soulId || this.faded.has(o.soulId)) continue;
      const d = Math.hypot(ob[1] - mb[1], ob[3] - mb[3]); if (d > radius) continue;
      if (this.enclosureAt(ob[1], ob[3], ob[6]) !== myEnc) continue;
      out.push({soulId: o.soulId, entityId: o.entityId, name: o.name, distance: Math.round(d * 10) / 10, at: [ob[1], ob[3]]});
    }
    return out.sort((a, b) => a.distance - b.distance);
  }

  /** `here` subset: me.pos, near (ids + distances, sightline + enclosure), things of kind fire/spot/object(with a point)/item. */
  here(soulId: string) {
    const mb = this.bodyOf(soulId); if (!mb) return {tick: this.tick, me: null, near: [], things: []};
    const pos: V2 = [mb[1], mb[3]], enc = this.enclosureAt(pos[0], pos[1], mb[6]);
    const near = this.perceived(soulId, SIGHT_RADIUS).filter(o => this.sees(pos, o.at)).slice(0, 6).map(o => ({id: o.soulId, dist: o.distance}));
    const things: {kind: string; id: string; dist: number}[] = [], d = (at: V2) => round1(dist2(pos, at));
    for (const f of this.fires.near(pos[0], pos[1], SIGHT_RADIUS)) if (d(f.at) <= SIGHT_RADIUS) things.push({kind: 'fire', id: f.id, dist: d(f.at)});
    for (const s of this.spots.near(pos[0], pos[1], OBJECT_RADIUS)) if (d(s.at) <= OBJECT_RADIUS) things.push({kind: 'spot', id: s.id, dist: d(s.at)});
    for (const o of [...this.objectCells.near(pos[0], pos[1], OBJECT_RADIUS), ...this.mobileObjects.values()]) {
      const at = o.at ?? this.entityAt(o.id); if (!at) continue;
      if (d(at) <= OBJECT_RADIUS) things.push({kind: 'object', id: o.id, dist: d(at)});
    }
    for (const i of this.items) if (d(i.at) <= OBJECT_RADIUS) things.push({kind: 'item', id: i.id, dist: d(i.at)});
    const at = (t: {kind: string; id: string}): V2 => t.kind === 'fire' ? [...this.fires.near(pos[0], pos[1], SIGHT_RADIUS)].find(f => f.id === t.id)!.at
      : t.kind === 'spot' ? [...this.spots.near(pos[0], pos[1], OBJECT_RADIUS)].find(s => s.id === t.id)!.at
      : t.kind === 'item' ? this.items.find(i => i.id === t.id)!.at : (this.objects.get(t.id)!.at ?? this.entityAt(t.id)!);
    const seen = things.filter(t => {const p = at(t); return this.enclosureAt(p[0], p[1], 0) === enc && this.sees(pos, p);})
      .sort((a, b) => a.dist - b.dist || a.id.localeCompare(b.id));
    return {tick: this.tick, me: {pos: [round1(pos[0]), round1(pos[1])] as V2}, near, things: seen};
  }
  private entityAt(id: string): V2 | null {const b = this.bodies.get(id); return b ? [b[1], b[3]] : null;}

  /** `capabilities` subset: the ids of go-near/wave/face (perceived Souls), warm-by-fire (150 m), gather (60 m). */
  capabilities(soulId: string): string[] {
    const mb = this.bodyOf(soulId); if (!mb) return [];
    const out: string[] = [];
    for (const o of this.perceived(soulId, GO_NEAR_RADIUS)) out.push('go-near:' + o.soulId);
    for (const o of this.perceived(soulId, NEAR_RADIUS)) out.push('wave:' + o.soulId, 'face:' + o.soulId);
    for (const f of this.fires.near(mb[1], mb[3], FIRE_OFFER_RADIUS)) if (Math.hypot(f.at[0] - mb[1], f.at[1] - mb[3]) <= FIRE_OFFER_RADIUS) out.push('warm-by-fire:' + f.id);
    for (const r of this.regions) if (Math.hypot(r.c[0] - mb[1], r.c[1] - mb[3]) <= GATHER_RADIUS) out.push('gather:' + r.id);
    return out.sort();
  }
  stats() {return {tick: this.tick, epoch: this.epoch, bodies: this.bodies.size, minds: this.minds.size, places: this.placeById.size, solids: this.solids.size + this.solidsBig.length, solidsBig: this.solidsBig.length, fires: this.fires.size, spots: this.spots.size, objects: this.objects.size, items: this.items.length};}
}

export {centroid};
