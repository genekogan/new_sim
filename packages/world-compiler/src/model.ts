// The in-memory world model the compiler mutates: defs, entities, indices,
// terrain. Pure data + lookups; no I/O. The server persists it; the god skill
// mirrors it from snapshot + stream.
import { Terrain, emptyGround, type Ground, type Landform, type Water } from '@sim/ground';
import { GENERATORS, type Baked, type LocalOBB } from '@sim/generators';
import { hashOf } from './hash.ts';
import { defSchema, type Def, type DefInput, type Entity, type StoredDef, type Value, type WorldConstants, type WorldState, worldConstantsSchema, worldStateSchema } from './schemas.ts';

export type OBB = { c: [number, number]; half: [number, number]; yaw: number; y0: number; y1: number };
export type AssetInfo = { tris: number; bytes: number; textures: number; box: [number, number, number] };
export type AssetLookup = (hash: string) => AssetInfo | undefined;

export class WorldModel {
  constants: WorldConstants;
  state: WorldState;
  seed: string;
  seq = 0;            // entity counter (ids)
  editSeq = 0;        // committed batches
  defs = new Map<string, StoredDef>();      // by ref ("name@v") and by "sha:<hash>"
  entities = new Map<string, Entity>();
  children = new Map<string, Set<string>>();
  names = new Map<string, string>();        // `${parent}/${name}` → id
  terrain: Terrain;
  assets: AssetLookup;
  private bakes = new Map<string, Baked>();
  private cells = new Map<string, Set<string>>(); // spatial hash of solid footprints
  private footprints = new Map<string, OBB[]>();

  constructor(opts: { constants: Partial<WorldConstants> & { ground: WorldConstants['ground'] }; seed: string; state?: Partial<WorldState>; assets?: AssetLookup }) {
    this.constants = worldConstantsSchema.parse({ extent: 1000, ...opts.constants });
    this.state = worldStateSchema.parse(opts.state ?? {});
    this.seed = opts.seed;
    this.assets = opts.assets ?? (() => undefined);
    const g = emptyGround(this.constants.extent, this.constants.base);
    if (this.constants.ground === 'ocean') g.seaLevel = this.constants.seaLevel ?? 0;
    this.terrain = new Terrain(g);
  }

  // ---------- defs ----------

  /** Normalise, hash and store a def. Idempotent by hash. Returns the stored record. */
  defineDef(input: DefInput, by: string, born: number): StoredDef {
    const def: Def = defSchema.parse(input);
    const { budget: _b, ...hashable } = def;
    const hash = hashOf(hashable);
    const existing = this.defs.get('sha:' + hash);
    if (existing) return existing;
    const ref = `${def.name}@${def.version}`;
    const stored: StoredDef = { ...def, budget: def.budget ?? { tris: 0, bytes: 0, textures: 0 }, hash, ref, by, born };
    this.defs.set('sha:' + hash, stored);
    this.defs.set(ref, stored);
    if (ref.startsWith('core-')) this.defs.set('core/' + ref.slice(5), stored);
    return stored;
  }
  def(ref: string): StoredDef | undefined { return this.defs.get(ref); }
  /** Follow `extends` to merge params defaults/components/slots. Child overrides parent field-by-field. */
  resolvedDef(ref: string, depth = 0): StoredDef | undefined {
    const d = this.defs.get(ref);
    if (!d || !d.extends || depth > 8) return d;
    const base = this.resolvedDef(d.extends, depth + 1);
    if (!base) return d;
    return { ...base, ...d, params: { ...base.params, ...d.params }, state: { ...base.state, ...d.state }, components: { ...base.components, ...d.components }, slots: d.slots.length ? d.slots : base.slots, actions: d.actions.length ? d.actions : base.actions, make: d.make.kind === 'none' && base.make.kind !== 'none' ? base.make : d.make };
  }

  // ---------- baking ----------

  bake(def: StoredDef, params: Record<string, Value>, seed: number, shape?: Entity['shape']): Baked {
    const key = hashOf([def.hash, params, seed, shape ?? null]);
    const hit = this.bakes.get(key);
    if (hit) return hit;
    let baked: Baked;
    const m = def.make;
    if (m.kind === 'gen') {
      const g = GENERATORS[m.gen];
      if (!g) throw new Error(`generator ${m.gen} unknown`);
      baked = g.physics({ params: { ...defaultsOf(g.params), ...params }, args: (m.args ?? {}) as Record<string, unknown>, seed, shape: shape as never });
    } else if (m.kind === 'mesh') {
      const info = this.assets(m.asset);
      const box = info?.box ?? def.size.box;
      const colliders: LocalOBB[] = m.collide === 'none' ? [] : [{ c: [0, 0], half: [box[0] / 2, box[2] / 2], yaw: 0, y0: 0, y1: box[1] }];
      baked = { box, colliders, slots: [], tris: info?.tris ?? 0 };
    } else if (m.kind === 'parts') {
      // Physics of a prefab = union of its parts' boxes (parts are placed as their own entities at expansion time).
      baked = { box: def.size.box, colliders: [], slots: [], tris: 0 };
    } else {
      baked = { box: def.size.box, colliders: [], slots: [], tris: 0 };
    }
    // Def-declared slots and components win over generator output.
    if (def.slots.length) baked = { ...baked, slots: def.slots };
    if (def.components.landform) baked = { ...baked, landform: def.components.landform };
    if (def.components.water) baked = { ...baked, water: def.components.water };
    this.bakes.set(key, baked);
    return baked;
  }

  // ---------- entities ----------

  nextId(): string { this.seq++; return 'e_' + hashOf(`${this.seed}:${this.seq}`).slice(0, 8); }
  get(idOrPath: string): Entity | undefined {
    if (this.entities.has(idOrPath)) return this.entities.get(idOrPath);
    // path: names from the world root
    let parent = 'world';
    for (const part of idOrPath.split('/')) {
      const id = this.names.get(`${parent}/${part}`);
      if (!id) return undefined;
      parent = id;
    }
    return this.entities.get(parent);
  }
  pathOf(id: string): string {
    const parts: string[] = [];
    let cur = this.entities.get(id);
    while (cur) { parts.unshift(cur.name ?? cur.id); cur = cur.in.parent === 'world' ? undefined : this.entities.get(cur.in.parent); }
    return parts.join('/');
  }
  insert(e: Entity) {
    this.entities.set(e.id, e);
    const set = this.children.get(e.in.parent) ?? new Set();
    set.add(e.id); this.children.set(e.in.parent, set);
    if (e.name) this.names.set(`${e.in.parent}/${e.name}`, e.id);
  }
  delete(id: string) {
    const e = this.entities.get(id); if (!e) return;
    this.entities.delete(id);
    this.children.get(e.in.parent)?.delete(id);
    if (e.name) this.names.delete(`${e.in.parent}/${e.name}`);
    this.unindex(id);
  }
  subtree(id: string): string[] {
    const out: string[] = [id];
    for (let i = 0; i < out.length; i++) for (const c of this.children.get(out[i]) ?? []) out.push(c);
    return out;
  }
  ancestors(id: string): Set<string> {
    const out = new Set<string>();
    let cur = this.entities.get(id);
    while (cur && cur.in.parent !== 'world') { out.add(cur.in.parent); cur = this.entities.get(cur.in.parent); }
    return out;
  }

  /** World-frame pose of an entity: walks up the parent chain, composing yaw and translation (slots add their frame). */
  worldPose(e: Entity): { x: number; y: number; z: number; yaw: number; s: number } {
    const local = this.localPose(e);
    if (e.in.parent === 'world') return local;
    const parent = this.entities.get(e.in.parent);
    if (!parent) return local;
    const pp = this.worldPose(parent);
    let sx = 0, sy = 0, sz = 0, syaw = 0;
    if (e.in.slot) {
      const slot = this.slotsOf(parent).find((s) => s.id === e.in.slot);
      if (slot) { sx = slot.p[0]; sy = slot.p[1]; sz = slot.p[2]; syaw = slot.yaw; }
    }
    const c = Math.cos(pp.yaw), s = Math.sin(pp.yaw);
    const lx = (sx + local.x) * pp.s, lz = (sz + local.z) * pp.s;
    return { x: pp.x + lx * c + lz * s, y: pp.y + (sy + local.y) * pp.s, z: pp.z - lx * s + lz * c, yaw: pp.yaw + syaw + local.yaw, s: pp.s * local.s };
  }
  localPose(e: Entity) {
    const p = e.p ?? [0, 0];
    const yaw = typeof e.r === 'number' ? e.r : Array.isArray(e.r) ? e.r[0] : 0;
    return { x: p[0], y: p.length === 3 ? p[1] : 0, z: p.length === 3 ? p[2] : p[1], yaw, s: e.s ?? 1 };
  }
  slotsOf(e: Entity) {
    const def = this.resolvedDef(e.def); if (!def) return [];
    return this.bake(def, e.params ?? {}, e.seed ?? 0, e.shape).slots;
  }
  /** World-frame footprint boxes of an entity (its def's colliders transformed by its world pose). */
  footprint(e: Entity, def = this.resolvedDef(e.def)): OBB[] {
    if (!def) return [];
    const baked = this.bake(def, e.params ?? {}, e.seed ?? 0, e.shape);
    const wp = this.worldPose(e);
    const c = Math.cos(wp.yaw), s = Math.sin(wp.yaw);
    return baked.colliders.map((o) => ({
      c: [wp.x + (o.c[0] * c + o.c[1] * s) * wp.s, wp.z + (-o.c[0] * s + o.c[1] * c) * wp.s],
      half: [o.half[0] * wp.s, o.half[1] * wp.s], yaw: wp.yaw + o.yaw, y0: wp.y + o.y0 * wp.s, y1: wp.y + o.y1 * wp.s,
    }));
  }

  // ---------- spatial index (solid footprints) ----------

  private cellKeys(o: OBB): string[] {
    const r = Math.sqrt(o.half[0] ** 2 + o.half[1] ** 2);
    const x0 = Math.floor((o.c[0] - r) / 16), x1 = Math.floor((o.c[0] + r) / 16), z0 = Math.floor((o.c[1] - r) / 16), z1 = Math.floor((o.c[1] + r) / 16);
    const out: string[] = [];
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) out.push(`${x},${z}`);
    return out;
  }
  index(id: string, boxes: OBB[]) {
    this.unindex(id);
    this.footprints.set(id, boxes);
    for (const b of boxes) for (const k of this.cellKeys(b)) { const s = this.cells.get(k) ?? new Set(); s.add(id); this.cells.set(k, s); }
  }
  unindex(id: string) {
    const boxes = this.footprints.get(id); if (!boxes) return;
    for (const b of boxes) for (const k of this.cellKeys(b)) this.cells.get(k)?.delete(id);
    this.footprints.delete(id);
  }
  /** Ids whose indexed footprints might touch any of `boxes`. */
  near(boxes: OBB[]): Set<string> {
    const out = new Set<string>();
    for (const b of boxes) for (const k of this.cellKeys(b)) for (const id of this.cells.get(k) ?? []) out.add(id);
    return out;
  }
  footprintsOf(id: string): OBB[] { return this.footprints.get(id) ?? []; }

  // ---------- ground ----------

  ground(): Ground { return this.terrain.ground; }
  setLandform(l: Landform | null, id: string): Landform[] {
    const g = this.terrain.ground;
    const prev = g.landforms.find((x) => x.id === id);
    const landforms = g.landforms.filter((x) => x.id !== id);
    if (l) landforms.push(l);
    const changed = [prev, l].filter((x): x is Landform => !!x);
    this.terrain.update({ ...g, landforms }, changed);
    return changed;
  }
  setWater(w: Water | null, id: string) {
    const g = this.terrain.ground;
    const waters = g.waters.filter((x) => x.id !== id);
    if (w) waters.push(w);
    this.terrain.update({ ...g, waters }, []);
  }

  snapshot() {
    return {
      constants: this.constants, state: this.state, seed: this.seed, seq: this.seq, editSeq: this.editSeq,
      defs: [...new Set(this.defs.values())].sort((a, b) => (a.ref < b.ref ? -1 : 1)), entities: [...this.entities.values()].sort((a, b) => (a.id < b.id ? -1 : 1)), ground: this.terrain.ground,
    };
  }
  static fromSnapshot(s: ReturnType<WorldModel['snapshot']>, assets?: AssetLookup): WorldModel {
    const w = new WorldModel({ constants: s.constants, seed: s.seed, state: s.state, assets });
    w.seq = s.seq; w.editSeq = s.editSeq;
    for (const d of s.defs) { w.defs.set('sha:' + d.hash, d); w.defs.set(d.ref, d); if (d.ref.startsWith('core-')) w.defs.set('core/' + d.ref.slice(5), d); }
    w.terrain = new Terrain(s.ground);
    for (const e of s.entities) w.insert(e);
    for (const e of s.entities) { const def = w.resolvedDef(e.def); if (def && def.layer === 'solid') w.index(e.id, w.footprint(e, def)); }
    return w;
  }
}

/** 2-D separating-axis test for two yawed rectangles plus a vertical-interval test. */
export function obbOverlap(a: OBB, b: OBB): boolean {
  if (a.y1 <= b.y0 || b.y1 <= a.y0) return false;
  const axes: [number, number][] = [[Math.cos(a.yaw), -Math.sin(a.yaw)], [Math.sin(a.yaw), Math.cos(a.yaw)], [Math.cos(b.yaw), -Math.sin(b.yaw)], [Math.sin(b.yaw), Math.cos(b.yaw)]];
  const corners = (o: OBB) => {
    const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
    return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([i, j]) => [o.c[0] + i * o.half[0] * c + j * o.half[1] * s, o.c[1] - i * o.half[0] * s + j * o.half[1] * c] as [number, number]);
  };
  const ca = corners(a), cb = corners(b);
  for (const [ax, az] of axes) {
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [x, z] of ca) { const p = x * ax + z * az; a0 = Math.min(a0, p); a1 = Math.max(a1, p); }
    for (const [x, z] of cb) { const p = x * ax + z * az; b0 = Math.min(b0, p); b1 = Math.max(b1, p); }
    if (a1 <= b0 + 1e-6 || b1 <= a0 + 1e-6) return false;
  }
  return true;
}

/** Generator param defaults (a def's own params already merged into the instance by the compiler). */
function defaultsOf(fields: Record<string, { default?: unknown }>): Record<string, Value> {
  const out: Record<string, Value> = {};
  for (const [k, f] of Object.entries(fields)) if (f.default !== undefined) out[k] = f.default as Value;
  return out;
}
