// Diagnostics for builders (spec 33 §2 row 10): terrain samples, entity bounds, free-plot search,
// clearance at a pose, plus the skill's needs (L7): a compact world layout for the client mirror and
// solver, def baking without placing, `describe` (rooms, slots, occupants, openings, constraints,
// behaviours), `where` (what is at a point) and `resolve` (constraint status). Pure functions over the
// WorldModel; `reach` asks the Soul engine through the bridge (L9).
// Owner: L1 (contract); L7 owns it from tranche 2; `reach` is L9's.
import { mediumAt, waterDepthAt, waterLevelAt } from '@sim/ground';
import { creatureAbilities, offsetPolyline, pointAlong, pointInPoly, prepareFor, queryOf, type Baked, type Vec2 } from '@sim/generators';
import { aimOf, obbOverlap, type Entity, type OBB, type StoredDef, WorldModel } from '@sim/world-compiler';
// L2's furnish recipes (pure over the WorldModel; reads tools/god-skill/recipes/furnish/*.json)
import { furnishBatch } from '../../../../tools/god-skill/lib/furnish.mjs';

/** A reach end: a point [x, z] (ground) or [x, y, z], an entity id/path (a Soul's body, a chair…), or `<path>:<room>`. */
export type ReachEnd = string | [number, number] | [number, number, number];
export type ReachFn = (from: ReachEnd, to: ReachEnd) => unknown;
/** Reachability needs the Soul engine; the engine bridge (engine-bridge.ts, lane L9) registers it per world model. */
export const reachProviders = new WeakMap<WorldModel, ReachFn>();
/** Who is using an entity right now (a Soul seated on it, holding it); registered by the engine bridge. */
export const usesProviders = new WeakMap<WorldModel, (id: string) => unknown>();

export type QueryInput = {
  points?: [number, number][];
  entity?: string;
  free?: { size: [number, number]; near?: [number, number]; radius?: number; maxSlope?: number; avoidWater?: boolean; avoidPaved?: boolean; count?: number };
  clearance?: { at: [number, number]; size: [number, number]; yaw?: number };
  reach?: { from: ReachEnd; to: ReachEnd };
  /** Compact world-frame layout of every entity (or those whose bounds touch `area`): the skill's mirror. */
  layout?: { area?: [number, number, number, number]; max?: number; obbs?: boolean } | true;
  /** Bake a def with params (no placement): box, colliders, rooms, slots, openings, links, notes. */
  bake?: { def: string; params?: Record<string, unknown>; seed?: number; shape?: Entity['shape'] };
  /** Everything about one entity a builder needs to reason about it. */
  describe?: string;
  /** What is at (or near) a point. */
  where?: [number, number];
  /** Constraint status: every constrained entity, or the given refs. */
  resolve?: true | string[];
  /** Furniture for a building's rooms from L2's recipes: { ops, placed, dropped, notes } (not applied). */
  furnish?: { ref: string; style?: string; rooms?: string[] };
  /** Freeze what a path/area generator needs from the ground (road grade + bridge spans, river flow, deck heights; L3's
   *  prepareFor) so the client can send exact params. Returns { params, path? } or null when nothing is needed. */
  prepare?: { def: string; shape: { path?: [number, number][]; area?: [number, number][]; width?: number }; params?: Record<string, unknown> };
};

export function runQuery(w: WorldModel, q: QueryInput) {
  const out: Record<string, unknown> = {};
  if (q.points) {
    out.points = q.points.slice(0, 256).map(([x, z]) => ({ x, z, y: round(w.terrain.sample(x, z)), slope: round(w.terrain.slope(x, z)), slopeDeg: round((Math.atan(w.terrain.slope(x, z)) * 180) / Math.PI), water: round(waterDepthAt(w.terrain, x, z)), medium: mediumAt(w.terrain, x, z) }));
  }
  if (q.entity) {
    const e = getRef(w, q.entity);
    if (!e) out.entity = { error: `no such entity ${q.entity}` };
    else {
      const def = w.resolvedDef(e.def)!;
      const baked = w.bake(def, e.params ?? {}, e.seed ?? 0, e.shape);
      const pose = w.worldPose(e);
      const fp = w.footprint(e, def);
      const bb = aabbOf(fp.length ? fp : [{ c: [pose.x, pose.z], half: [baked.box[0] * pose.s / 2, baked.box[2] * pose.s / 2], yaw: pose.yaw, y0: pose.y, y1: pose.y + baked.box[1] * pose.s }]);
      out.entity = {
        id: e.id, path: w.pathOf(e.id), def: e.def, pose: { x: round(pose.x), y: round(pose.y), z: round(pose.z), yaw: round(pose.yaw), s: pose.s },
        box: baked.box, bounds: bb, colliders: fp.length,
        rooms: baked.rooms?.map((r) => ({ id: r.id, name: r.name, floor: r.floor })) ?? [],
        openings: baked.openings?.map((o) => ({ id: o.id, kind: o.kind, level: o.level, state: o.state })) ?? [],
        links: baked.links?.map((l) => ({ id: l.id, kind: l.kind, from: l.from, to: l.to })) ?? [],
        slots: baked.slots.map((s) => ({ id: s.id, kind: s.kind, capacity: s.capacity, used: [...(w.children.get(e.id) ?? [])].filter((c) => w.entities.get(c)?.in.slot === s.id).length })),
        children: [...(w.children.get(e.id) ?? [])].map((c) => w.pathOf(c)),
        constraints: e.constraints ?? [],
        ...(usesProviders.get(w) ? { usedBy: usesProviders.get(w)!(e.id) } : {}),
        notes: baked.notes ?? [],
      };
    }
  }
  if (q.free) out.free = findFree(w, q.free);
  if (q.clearance) {
    const { at, size, yaw = 0 } = q.clearance;
    const box: OBB = { c: at, half: [size[0] / 2, size[1] / 2], yaw, y0: w.terrain.sample(at[0], at[1]), y1: w.terrain.sample(at[0], at[1]) + 2 };
    const hits = [...w.near([box])].filter((id) => w.footprintsOf(id).some((b) => obbOverlap(box, b))).map((id) => w.pathOf(id));
    out.clearance = { clear: hits.length === 0, blockedBy: hits };
  }
  if (q.reach) {
    const fn = reachProviders.get(w);
    out.reach = fn ? fn(q.reach.from, q.reach.to) : { supported: false, note: 'reachability needs the Soul engine (this world runs without it)' };
  }
  if (q.layout) out.layout = layout(w, q.layout === true ? {} : q.layout);
  if (q.bake) out.bake = bakeDef(w, q.bake);
  if (q.describe) out.describe = describe(w, q.describe);
  if (q.where) out.where = where(w, q.where);
  if (q.resolve) out.resolve = resolveConstraints(w, q.resolve === true ? null : q.resolve);
  if (q.furnish) {
    const e = getRef(w, q.furnish.ref);
    if (!e) out.furnish = { error: `no such building ${q.furnish.ref}` };
    else { try { out.furnish = furnishBatch(w, e.id, q.furnish.style, q.furnish.rooms ? { rooms: q.furnish.rooms } : {}); } catch (err) { out.furnish = { error: String((err as Error).message ?? err) }; } }
  }
  if (q.prepare) {
    const ref = q.prepare.def.includes('@') || q.prepare.def.startsWith('sha:') ? q.prepare.def : `core/${q.prepare.def}@1`;
    const def = w.resolvedDef(ref);
    if (!def) out.prepare = { error: `def.unknown ${ref}` };
    else if (def.make.kind !== 'gen') out.prepare = null;
    else { try { out.prepare = prepareFor(def.make.gen, queryOf(w), q.prepare.shape, (q.prepare.params ?? {}) as never); } catch (e) { out.prepare = { error: String((e as Error).message ?? e) }; } }
  }
  return out;
}

// ---------------------------------------------------------------- refs and frames

/** id, path of names, or flag:<name>. */
function getRef(w: WorldModel, ref: string): Entity | undefined {
  const r = ref.replace(/^flag:/, '');
  return w.get(r) ?? [...w.entities.values()].find((e) => e.name === r);
}
type Pose = { x: number; y: number; z: number; yaw: number; s: number };
const toWorld = (pp: Pose, lx: number, lz: number): Vec2 => { const c = Math.cos(pp.yaw), s = Math.sin(pp.yaw); return [round(pp.x + (lx * c + lz * s) * pp.s), round(pp.z + (-lx * s + lz * c) * pp.s)]; };
function bakedOf(w: WorldModel, e: Entity): { def: StoredDef; baked: Baked } | null {
  const def = w.resolvedDef(e.def); if (!def) return null;
  return { def, baked: w.bake(def, e.params ?? {}, e.seed ?? 0, e.shape) };
}
function boundsOf(w: WorldModel, e: Entity, def: StoredDef, baked: Baked) {
  const pose = w.worldPose(e);
  const fp = def.layer === 'solid' ? w.footprint(e, def) : [];
  if (e.shape && 'area' in e.shape) { const xs = e.shape.area.map((p) => p[0]), zs = e.shape.area.map((p) => p[1]); return { pose, fp, aabb: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)].map(round), y: [round(pose.y), round(pose.y + baked.box[1])] }; }
  if (e.shape && 'path' in e.shape) { const hw = (e.shape.width ?? 4) / 2; const xs = e.shape.path.map((p) => p[0]), zs = e.shape.path.map((p) => p[1]); return { pose, fp, aabb: [Math.min(...xs) - hw, Math.min(...zs) - hw, Math.max(...xs) + hw, Math.max(...zs) + hw].map(round), y: [round(pose.y), round(pose.y + baked.box[1])] }; }
  const bb = aabbOf(fp.length ? fp : [{ c: [pose.x, pose.z], half: [baked.box[0] * pose.s / 2, baked.box[2] * pose.s / 2], yaw: pose.yaw, y0: pose.y, y1: pose.y + baked.box[1] * pose.s }]);
  return { pose, fp, aabb: [bb.min[0], bb.min[2], bb.max[0], bb.max[2]], y: [bb.min[1], bb.max[1]] };
}
function slotWorld(w: WorldModel, e: Entity, baked: Baked) {
  const pose = w.worldPose(e);
  const kids = [...(w.children.get(e.id) ?? [])].map((c) => w.entities.get(c)!).filter(Boolean);
  return baked.slots.map((s) => {
    const [x, z] = toWorld(pose, s.p[0], s.p[2]);
    const occ = kids.filter((k) => k.in.slot === s.id);
    return { id: s.id, kind: s.kind, p: [x, round(pose.y + s.p[1] * pose.s), z], yaw: round(pose.yaw + s.yaw), capacity: s.capacity, used: occ.length, occupants: occ.slice(0, 64).map((k) => k.name ?? k.id), ...(s.floor !== undefined ? { floor: s.floor } : {}), ...(s.polygon ? { polygon: s.polygon.map(([a, b]) => toWorld(pose, s.p[0] + a, s.p[2] + b)), local: s.polygon } : {}), ...(s.accepts && Object.keys(s.accepts).length ? { accepts: s.accepts } : {}), ...(s.label ? { label: s.label } : {}) };
  });
}

// ---------------------------------------------------------------- layout (mirror)

function layout(w: WorldModel, o: { area?: [number, number, number, number]; max?: number; obbs?: boolean }) {
  const max = Math.min(o.max ?? 20000, 50000), wantObbs = o.obbs ?? true;
  const rows: unknown[] = [];
  for (const e of w.entities.values()) {
    if (rows.length >= max) break;
    const b = bakedOf(w, e); if (!b) continue;
    const { pose, fp, aabb, y } = boundsOf(w, e, b.def, b.baked);
    if (o.area && (aabb[2] < o.area[0] || aabb[0] > o.area[2] || aabb[3] < o.area[1] || aabb[1] > o.area[3])) continue;
    const row: Record<string, unknown> = { id: e.id, path: w.pathOf(e.id), def: e.def, parent: e.in.parent, layer: b.def.layer, form: b.def.form, tags: b.def.tags, pose: [round(pose.x), round(pose.y), round(pose.z), round(pose.yaw), pose.s], box: b.baked.box.map(round), aabb, y };
    if (e.name) row.name = e.name;
    if (e.in.slot) row.slot = e.in.slot;
    if (e.shape) row.shape = e.shape;
    if (wantObbs && fp.length) row.obbs = fp.slice(0, 48).map((f) => [round(f.c[0]), round(f.c[1]), round(f.half[0]), round(f.half[1]), round(f.yaw), round(f.y0), round(f.y1)]);
    if (b.baked.rooms?.length || b.baked.slots.length) row.slots = slotWorld(w, e, b.baked).map((s) => ({ id: s.id, kind: s.kind, p: s.p, yaw: s.yaw, capacity: s.capacity, used: s.used, ...(s.polygon ? { polygon: s.polygon, local: s.local } : {}), ...(s.floor !== undefined ? { floor: s.floor } : {}) }));
    if (b.baked.water) row.water = b.baked.water.level;
    if (e.constraints?.length) row.constraints = e.constraints;
    // doors (world frame; `out`: opens to the outside) and the building's front, for the CLI solver's
    // doorway clearance, house-relative walls/corners and paths that start at a door
    const doors = (b.baked.openings ?? []).filter((o) => o.kind !== 'window');
    if (doors.length) {
      const rooms = b.baked.rooms ?? [];
      row.doors = doors.map((o) => { const probe: Vec2 = [o.at[0] + Math.sin(o.yaw), o.at[1] + Math.cos(o.yaw)]; return { id: o.id, kind: o.kind, level: o.level, width: o.width, at: toWorld(pose, o.at[0], o.at[1]), yaw: round(pose.yaw + o.yaw), out: !rooms.some((r) => r.floor === o.level && pointInPoly(probe[0], probe[1], r.polygon as Vec2[])) }; });
    }
    if (b.baked.rooms?.length) { const f = String((e.params as Record<string, unknown> | undefined)?.front ?? (b.def.params as Record<string, { default?: unknown }> | undefined)?.front?.default ?? 's'); row.front = round(pose.yaw + (({ s: 0, e: Math.PI / 2, n: Math.PI, w: -Math.PI / 2 } as Record<string, number>)[f] ?? 0)); }
    rows.push(row);
  }
  return { seq: w.editSeq, extent: w.constants.extent, entities: rows };
}

// ---------------------------------------------------------------- bake

function bakeDef(w: WorldModel, b: NonNullable<QueryInput['bake']>) {
  const ref = b.def.includes('@') || b.def.startsWith('sha:') ? b.def : `core/${b.def}@1`;
  const def = w.resolvedDef(ref);
  if (!def) return { error: `def.unknown ${ref}` };
  const params: Record<string, unknown> = {};
  for (const [k, f] of Object.entries(def.params)) if ((f as { default?: unknown }).default !== undefined) params[k] = (f as { default?: unknown }).default;
  Object.assign(params, b.params ?? {});
  let baked: Baked;
  try { baked = w.bake(def, params as never, b.seed ?? 0, b.shape); } catch (e) { return { error: String((e as Error).message ?? e) }; }
  return {
    ref: def.ref, name: def.name, gen: def.make.kind === 'gen' ? def.make.gen : def.make.kind, form: def.form, layer: def.layer, anchor: def.anchor, tags: def.tags, box: baked.box.map(round), scale: def.size.scale,
    colliders: baked.colliders.length, tris: baked.tris,
    rooms: baked.rooms?.map((r) => ({ id: r.id, name: r.name, floor: r.floor, y: round(r.y), height: r.height, polygon: r.polygon, origin: r.origin })) ?? [],
    slots: baked.slots.map((s) => ({ id: s.id, kind: s.kind, p: s.p, yaw: s.yaw, capacity: s.capacity, ...(s.polygon ? { polygon: s.polygon } : {}), ...(s.floor !== undefined ? { floor: s.floor } : {}), ...(s.accepts && Object.keys(s.accepts).length ? { accepts: s.accepts } : {}) })),
    openings: baked.openings ?? [], links: baked.links?.map((l) => ({ id: l.id, kind: l.kind, from: l.from, to: l.to, width: l.width })) ?? [],
    surfaces: baked.surfaces?.map((s) => ({ level: s.level, y: round(s.y), tag: s.tag })) ?? [],
    landform: !!baked.landform, water: baked.water?.level ?? null, notes: baked.notes ?? [],
    behaviours: behaviours(def),
  };
}

/** What a creature / thing can do and why not (spec 33 §3.2). Kit creatures (roles/gait in kit/2 args) use L4's
 *  creatureAbilities (the same rules the herd and the gait use); bodies and anchors add their media. */
function behaviours(def: StoredDef): { supported: string[]; missing: Record<string, string>; gait?: string; roles?: string[] } {
  const args = (def.make.kind === 'gen' ? def.make.args ?? {} : {}) as { gait?: string; shapes?: { role?: string }[] };
  const body = def.components.body;
  const creature = !!(args.gait && args.gait !== 'none') || (args.shapes ?? []).some((s) => s.role && /^(leg|wing|tail|head)/.test(s.role));
  const supported: string[] = [], missing: Record<string, string> = {};
  let extra: { gait?: string; roles?: string[] } = {};
  if (creature) {
    const a = creatureAbilities(args);
    supported.push(...a.behaviors); Object.assign(missing, a.refusals); extra = { gait: a.gait, roles: a.roles };
  }
  const media = body?.media ?? [];
  if (media.includes('walk')) for (const b of ['wander', 'follow', 'idle']) { supported.push(b); delete missing[b]; }
  if (media.includes('fly')) { supported.push('fly'); delete missing.fly; }
  if (media.includes('swim') || def.anchor === 'float') { supported.push('swim'); delete missing.swim; }
  if (def.components.spin) supported.push('spin'); if (def.components.sway) supported.push('sway'); if (def.components.hover) supported.push('hover'); if (def.components.route) supported.push('route');
  if (def.components.seat) supported.push('sit'); if (def.components.bed) supported.push('lie'); if (def.components.carryable) supported.push('carry'); if (def.components.surface) supported.push('put-on');
  if (def.components.light) supported.push('light on/off'); if (def.components.opening) supported.push('open/close');
  return { supported: [...new Set(supported)], missing, ...extra };
}

// ---------------------------------------------------------------- describe / where

function describe(w: WorldModel, ref: string) {
  const e = getRef(w, ref);
  if (!e) return { error: `no such entity ${ref}` };
  const b = bakedOf(w, e); if (!b) return { error: `def ${e.def} missing` };
  const { def, baked } = b;
  const { pose, fp, aabb, y } = boundsOf(w, e, def, baked);
  const slots = slotWorld(w, e, baked);
  const kids = [...(w.children.get(e.id) ?? [])].map((c) => w.entities.get(c)!).filter(Boolean);
  const rooms = (baked.rooms ?? []).map((r) => {
    const slot = slots.find((s) => s.id === r.id);
    const occ = kids.filter((k) => k.in.slot === r.id);
    const doors = (baked.openings ?? []).filter((o) => o.level === r.floor && pointNearPoly(o.at, r.polygon, 0.6)).map((o) => `${o.kind} ${o.id}${o.state ? ` (${o.state})` : ''}`);
    return { id: r.id, name: r.name, floor: r.floor, y: round(pose.y + r.y * pose.s), height: r.height, size: polySize(r.polygon), polygon: slot?.polygon ?? r.polygon, local: r.polygon, occupants: occ.map((k) => ({ name: k.name ?? k.id, def: k.def, p: k.p })), doors };
  });
  const openings = (baked.openings ?? []).map((o) => ({ id: o.id, kind: o.kind, level: o.level, width: o.width, height: o.height, state: o.state ?? 'always', at: toWorld(pose, o.at[0], o.at[1]), faces: compassOf(pose.yaw + o.yaw) }));
  const links = (baked.links ?? []).map((l) => ({ id: l.id, kind: l.kind, from: l.from, to: l.to, width: l.width, path: l.path.map(([a, c]) => toWorld(pose, a, c)) }));
  const parent = e.in.parent === 'world' ? null : w.entities.get(e.in.parent);
  // shape things (roads, rivers, lakes, plazas) sit at the origin: measure from the path's middle / the area's centroid
  const sh = e.shape as { area?: Vec2[]; path?: Vec2[]; width?: number } | undefined;
  const [ax, az] = sh?.path ? pointAlong(sh.path, 0.5).p : sh?.area ? centroid(sh.area) : [pose.x, pose.z];
  const near = nearest(w, [ax, az], 6, new Set([e.id, ...w.subtree(e.id)]));
  const ground = { y: round(w.terrain.sample(ax, az)), slopeDeg: round((Math.atan(w.terrain.slope(ax, az)) * 180) / Math.PI), water: round(waterDepthAt(w.terrain, ax, az)), medium: mediumAt(w.terrain, ax, az) };
  const shape = sh?.path ? { path: sh.path.length <= 16 ? sh.path : [sh.path[0], sh.path[sh.path.length - 1]], points: sh.path.length, length: round(sh.path.reduce((l, p, i) => (i ? l + Math.hypot(p[0] - sh.path![i - 1][0], p[1] - sh.path![i - 1][1]) : 0), 0)), width: sh.width ?? null, middle: [round(ax), round(az)] }
    : sh?.area ? { area: sh.area.length <= 16 ? sh.area : null, points: sh.area.length, centre: [round(ax), round(az)], size: polySize(sh.area) } : null;
  return {
    id: e.id, path: w.pathOf(e.id), name: e.name ?? null, def: e.def, description: def.description, tags: def.tags, layer: def.layer, form: def.form, anchor: e.anchor ?? def.anchor,
    in: parent ? { parent: w.pathOf(parent.id), slot: e.in.slot ?? null } : 'world',
    pose: { x: round(pose.x), y: round(pose.y), z: round(pose.z), yaw: round(pose.yaw), faces: compassOf(pose.yaw), s: pose.s },
    box: baked.box.map(round), aabb, y, colliders: fp.length, tris: baked.tris,
    params: e.params ?? {}, state: e.state ?? {}, shape,
    rooms, openings, links,
    slots: slots.filter((s) => s.kind !== 'room').map(({ polygon: _p, local: _l, ...s }) => s),
    children: kids.filter((k) => !k.in.slot || !rooms.some((r) => r.id === k.in.slot)).map((k) => ({ name: k.name ?? k.id, def: k.def, slot: k.in.slot ?? null })),
    constraints: (e.constraints ?? []).map((c) => checkConstraint(w, e, c)),
    behaviours: behaviours(def),
    ground, near, notes: baked.notes ?? [],
  };
}

function where(w: WorldModel, at: [number, number]) {
  const [x, z] = at;
  const contains: unknown[] = [];
  let room: unknown = null;
  for (const e of w.entities.values()) {
    const b = bakedOf(w, e); if (!b) continue;
    const { aabb } = boundsOf(w, e, b.def, b.baked);
    if (x < aabb[0] || x > aabb[2] || z < aabb[1] || z > aabb[3]) continue;
    if (e.shape && 'area' in e.shape && !pointInPoly(x, z, e.shape.area)) continue;
    contains.push({ path: w.pathOf(e.id), def: e.def, layer: b.def.layer });
    if (b.baked.rooms?.length) for (const s of slotWorld(w, e, b.baked)) if (s.kind === 'room' && s.polygon && pointInPoly(x, z, s.polygon as Vec2[])) room = { building: w.pathOf(e.id), room: s.id, floor: s.floor ?? 0 };
  }
  const lvl = waterLevelAt(w.ground(), x, z);
  return { x, z, y: round(w.terrain.sample(x, z)), slopeDeg: round((Math.atan(w.terrain.slope(x, z)) * 180) / Math.PI), water: lvl === null ? null : { level: lvl, depth: round(waterDepthAt(w.terrain, x, z)) }, medium: mediumAt(w.terrain, x, z), inside: contains, room, near: nearest(w, at, 8) };
}

const centroid = (a: Vec2[]): Vec2 => { let x = 0, z = 0; for (const p of a) { x += p[0]; z += p[1]; } return [x / a.length, z / a.length]; };
function nearest(w: WorldModel, at: [number, number], n: number, skip = new Set<string>()) {
  const rows: { path: string; def: string; dist: number; dir: string }[] = [];
  for (const e of w.entities.values()) {
    if (skip.has(e.id) || e.in.parent !== 'world') continue;
    const b = bakedOf(w, e); if (!b) continue;
    const { aabb } = boundsOf(w, e, b.def, b.baked);
    const cx = Math.max(aabb[0], Math.min(at[0], aabb[2])), cz = Math.max(aabb[1], Math.min(at[1], aabb[3]));
    const mx = (aabb[0] + aabb[2]) / 2, mz = (aabb[1] + aabb[3]) / 2;
    rows.push({ path: w.pathOf(e.id), def: e.def, dist: round(Math.hypot(cx - at[0], cz - at[1])), dir: compassOf(Math.atan2(mx - at[0], mz - at[1])) });
  }
  return rows.sort((a, b) => a.dist - b.dist).slice(0, n);
}

// ---------------------------------------------------------------- constraints

function checkConstraint(w: WorldModel, e: Entity, c: NonNullable<Entity['constraints']>[number]) {
  const pose = w.worldPose(e);
  const refE = 'ref' in c && c.ref ? getRef(w, c.ref) : undefined;
  if ('ref' in c && c.ref && !refE && c.kind !== 'inside') return { ...c, ok: false, why: `ref ${c.ref} no longer exists` };
  switch (c.kind) {
    case 'float': { const lvl = waterLevelAt(w.ground(), pose.x, pose.z); return lvl === null ? { ...c, ok: false, why: 'no water here' } : { ...c, ok: Math.abs(pose.y - (lvl - c.sink)) < 0.05, why: `water level ${round(lvl)}, y ${round(pose.y)}` }; }
    case 'ground': return { ...c, ok: true };
    // aimed as the compiler aims (compile.ts aimOf): a point thing's pose, an area's centroid, a path's midpoint
    case 'facing': { const t = aimOf(w, refE!); const want = Math.atan2(t.x - pose.x, t.z - pose.z) + c.offset; const d = Math.abs(angDiff(want, pose.yaw)); return { ...c, ok: d < 0.15, why: d < 0.15 ? `faces ${c.ref}` : `off by ${round((d * 180) / Math.PI)}°` }; }
    case 'near': { const gap = gapBetween(w, e, refE!); return { ...c, ok: gap <= c.dist + 0.25, why: `gap ${round(gap)} m (want ≤ ${c.dist})` }; }
    case 'inside': {
      const anc = w.ancestors(e.id);
      // ref = a thing (house) or house/<room slot>
      let host = getRef(w, c.ref), roomId: string | null = null;
      if (!host && c.ref.includes('/')) { host = getRef(w, c.ref.slice(0, c.ref.lastIndexOf('/'))); roomId = c.ref.slice(c.ref.lastIndexOf('/') + 1); }
      if (!host) return { ...c, ok: false, why: `no ${c.ref}` };
      if (anc.has(host.id) && (!roomId || slotChain(w, e, host.id) === roomId)) return { ...c, ok: true, why: `inside ${w.pathOf(host.id)}${roomId ? '/' + roomId : ''}` };
      const hb = bakedOf(w, host)!; const { aabb } = boundsOf(w, host, hb.def, hb.baked);
      const inBox = pose.x >= aabb[0] && pose.x <= aabb[2] && pose.z >= aabb[1] && pose.z <= aabb[3];
      return { ...c, ok: inBox, why: inBox ? `within ${w.pathOf(host.id)}'s bounds` : `outside ${w.pathOf(host.id)}` };
    }
    case 'clear': {
      const blockers: string[] = [];
      for (const o of w.entities.values()) {
        if (o.id === e.id || o.in.parent !== 'world') continue;
        const b = bakedOf(w, o); if (!b || b.def.layer !== 'solid') continue;
        const p = w.worldPose(o);
        if (pointInPoly(p.x, p.z, c.area)) blockers.push(w.pathOf(o.id));
      }
      return { ...c, ok: blockers.length === 0, why: blockers.length ? `blocked by ${blockers.slice(0, 8).join(', ')}${blockers.length > 8 ? ` (+${blockers.length - 8})` : ''}` : 'clear', blockers };
    }
    case 'along': {
      const path = refE!.shape && 'path' in refE!.shape ? refE!.shape.path : null;
      if (!path) return { ...c, ok: false, why: `${c.ref} is not a path` };
      // exactly the compiler's placement (compile.ts admit): offset from the path edge, side by offsetPolyline
      const sideK = c.side === 'left' ? -1 : c.side === 'right' ? 1 : 0;
      const line = sideK ? offsetPolyline(path, sideK * (((refE!.shape as { width?: number }).width ?? 0) / 2 + c.offset)) : path;
      const { p } = pointAlong(line, c.t);
      const d = Math.hypot(p[0] - pose.x, p[1] - pose.z);
      return { ...c, ok: d < 1, why: `${round(d)} m from its spot on ${c.ref}` };
    }
  }
}
function slotChain(w: WorldModel, e: Entity, hostId: string): string | null {
  let cur: Entity | undefined = e;
  while (cur && cur.in.parent !== 'world') { if (cur.in.parent === hostId) return cur.in.slot ?? null; cur = w.entities.get(cur.in.parent); }
  return null;
}
function resolveConstraints(w: WorldModel, refs: string[] | null) {
  const list = refs ? refs.map((r) => getRef(w, r)).filter((x): x is Entity => !!x) : [...w.entities.values()].filter((e) => e.constraints?.length);
  const rows = list.map((e) => ({ path: w.pathOf(e.id), constraints: (e.constraints ?? []).map((c) => checkConstraint(w, e, c)) }));
  const violated = rows.flatMap((r) => r.constraints.filter((c) => !c.ok).map((c) => ({ path: r.path, kind: c.kind, why: (c as { why?: string }).why })));
  return { checked: rows.length, violated, entities: rows };
}
/** The gap a `near` constraint measures, by the solver's own rule (tools/god-skill/lib/solver.mjs, near): along
 *  the line from the ref's centre (an area's corner mean, a path's nearest point) to the thing, the distance between
 *  the ref's edge (its box × scale, the area's rim, the path's half width) and the thing's box × scale. A thing the
 *  solver put `--dist g` away measures exactly g. Shapes near shapes: the bounds gap. */
function gapBetween(w: WorldModel, a: Entity, b: Entity): number {
  const ba = bakedOf(w, a)!, bb = bakedOf(w, b)!;
  if (ba.def.form === 'point' && !a.shape) {
    const me = w.worldPose(a), bp = w.worldPose(b);
    const along = (half: [number, number], yaw: number, u: Vec2) => half[0] * Math.abs(u[0] * Math.cos(yaw) - u[1] * Math.sin(yaw)) + half[1] * Math.abs(u[0] * Math.sin(yaw) + u[1] * Math.cos(yaw));
    const mine = (u: Vec2) => along([(ba.baked.box[0] * me.s) / 2, (ba.baked.box[2] * me.s) / 2], me.yaw, u);
    const toWorld = (q: [number, number]): Vec2 => { const c = Math.cos(bp.yaw), sn = Math.sin(bp.yaw); return [bp.x + q[0] * c + q[1] * sn, bp.z - q[0] * sn + q[1] * c]; };
    const sh = b.shape as { area?: [number, number][]; path?: [number, number][]; width?: number } | undefined;
    let c0: Vec2 | null = null, edge: (u: Vec2) => number = () => 0;
    if (sh?.area?.length) {
      const poly = sh.area.map(toWorld); c0 = [poly.reduce((t, q) => t + q[0], 0) / poly.length, poly.reduce((t, q) => t + q[1], 0) / poly.length];
      const cc = c0; edge = (u) => rayExit(poly, cc, u);
    } else if (sh?.path?.length) {
      const path = sh.path.map(toWorld); c0 = nearestOn(path, [me.x, me.z]); const hw = (sh.width ?? 4) / 2; edge = () => hw;
    } else if (bb.def.form === 'point') {
      c0 = [bp.x, bp.z]; edge = (u) => along([(bb.baked.box[0] * bp.s) / 2, (bb.baked.box[2] * bp.s) / 2], bp.yaw, u);
    }
    if (c0) {
      const dx = me.x - c0[0], dz = me.z - c0[1], d = Math.hypot(dx, dz);
      if (d < 1e-6) return 0;
      const u: Vec2 = [dx / d, dz / d];
      return Math.max(0, d - edge(u) - mine(u));
    }
  }
  const A = boundsOf(w, a, ba.def, ba.baked).aabb, B = boundsOf(w, b, bb.def, bb.baked).aabb;
  const dx = Math.max(0, Math.max(A[0], B[0]) - Math.min(A[2], B[2])), dz = Math.max(0, Math.max(A[1], B[1]) - Math.min(A[3], B[3]));
  return Math.hypot(dx, dz);
}

/** Distance from c along unit u to where the ray leaves polygon poly (0 if c is outside); the solver's rayExit. */
function rayExit(poly: Vec2[], c: Vec2, u: Vec2): number {
  let best = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j], [bx, bz] = poly[i], ex = bx - ax, ez = bz - az;
    const den = u[0] * ez - u[1] * ex; if (Math.abs(den) < 1e-12) continue;
    const t = ((ax - c[0]) * ez - (az - c[1]) * ex) / den, k = ((ax - c[0]) * u[1] - (az - c[1]) * u[0]) / den;
    if (t > 0 && k >= 0 && k <= 1) best = Math.max(best, t);
  }
  return best;
}
/** The nearest point of a polyline to q. */
function nearestOn(path: Vec2[], q: Vec2): Vec2 {
  let best: Vec2 = path[0], bd = Infinity;
  for (let i = 1; i < path.length; i++) {
    const [ax, az] = path[i - 1], [bx, bz] = path[i], ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez;
    const k = l2 ? Math.max(0, Math.min(1, ((q[0] - ax) * ex + (q[1] - az) * ez) / l2)) : 0, p: Vec2 = [ax + ex * k, az + ez * k], d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

// ---------------------------------------------------------------- free plots

function findFree(w: WorldModel, f: NonNullable<QueryInput['free']>) {
  const [sw, sd] = f.size, maxSlope = f.maxSlope ?? 0.25, half = w.constants.extent / 2 - Math.max(sw, sd);
  const centre = f.near ?? [0, 0], radius = Math.min(f.radius ?? 120, half * 2), want = Math.min(f.count ?? 3, 12);
  const found: { at: [number, number]; y: number; slope: number; dist: number }[] = [];
  // paved ways and squares are not building plots (roads, paths, plazas, pitches, parking): point-in tests
  const paved: ((x: number, z: number) => boolean)[] = [];
  for (const e of w.entities.values()) {
    if (!e.shape) continue;
    const d = w.resolvedDef(e.def); if (!d || d.layer !== 'surface' || !d.tags.some((t) => PAVED.has(t))) continue;
    const sh = e.shape as { area?: Vec2[]; path?: Vec2[]; width?: number };
    if (sh.area) { const poly = sh.area; paved.push((x, z) => pointInPoly(x, z, poly)); }
    else if (sh.path) { const path = sh.path, hw = (sh.width ?? Number((e.params as Record<string, unknown> | undefined)?.width ?? 4)) / 2 + 1; paved.push((x, z) => distToPath(path, x, z) <= hw); }
  }
  // spiral search on a 2 m lattice, nearest first
  const step = 2, rings = Math.ceil(radius / step);
  for (let r = 0; r <= rings && found.length < want; r++) {
    for (let k = -r; k <= r && found.length < want; k++) for (const [dx, dz] of r === 0 ? [[0, 0]] : [[k, -r], [k, r], [-r, k], [r, k]]) {
      if (found.length >= want) break;
      const x = centre[0] + dx * step, z = centre[1] + dz * step;
      if (Math.abs(x) > half || Math.abs(z) > half) continue;
      const corners: [number, number][] = [[x - sw / 2, z - sd / 2], [x + sw / 2, z - sd / 2], [x + sw / 2, z + sd / 2], [x - sw / 2, z + sd / 2], [x, z]];
      const ys = corners.map(([a, c]) => w.terrain.sample(a, c));
      const slope = (Math.max(...ys) - Math.min(...ys)) / Math.max(sw, sd);
      if (slope > maxSlope) continue;
      if ((f.avoidWater ?? true) && corners.some(([a, c]) => waterDepthAt(w.terrain, a, c) > 0)) continue;
      const box: OBB = { c: [x, z], half: [sw / 2 + 0.5, sd / 2 + 0.5], yaw: 0, y0: Math.min(...ys), y1: Math.max(...ys) + 3 };
      if ([...w.near([box])].some((id) => w.footprintsOf(id).some((b) => obbOverlap(box, b)))) continue;
      if ((f.avoidPaved ?? true) && corners.some(([a, c]) => paved.some((p) => p(a, c)))) continue;
      if (found.some((p) => Math.abs(p.at[0] - x) < sw && Math.abs(p.at[1] - z) < sd)) continue;
      found.push({ at: [x, z], y: round(ys[4]), slope: round(slope), dist: round(Math.hypot(x - centre[0], z - centre[1])) });
    }
  }
  return found;
}

const PAVED = new Set(['road', 'path', 'path-network', 'plaza', 'paving', 'pitch', 'parking', 'bridge']);
function distToPath(path: Vec2[], x: number, z: number) {
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const [ax, az] = path[i - 1], [bx, bz] = path[i], dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L));
    best = Math.min(best, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
  }
  return best;
}

// ---------------------------------------------------------------- small geometry

function aabbOf(boxes: OBB[]) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const o of boxes) { const c = Math.abs(Math.cos(o.yaw)), s = Math.abs(Math.sin(o.yaw)); const hx = o.half[0] * c + o.half[1] * s, hz = o.half[0] * s + o.half[1] * c; x0 = Math.min(x0, o.c[0] - hx); x1 = Math.max(x1, o.c[0] + hx); z0 = Math.min(z0, o.c[1] - hz); z1 = Math.max(z1, o.c[1] + hz); y0 = Math.min(y0, o.y0); y1 = Math.max(y1, o.y1); }
  return { min: [round(x0), round(y0), round(z0)], max: [round(x1), round(y1), round(z1)] };
}
const COMPASS = ['s', 'se', 'e', 'ne', 'n', 'nw', 'w', 'sw'];
/** yaw (front = +z at 0, atan2(dx, dz)) → compass word: 0 → s, π/2 → e, π → n, −π/2 → w. */
export function compassOf(yaw: number): string { const k = Math.round((((yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (Math.PI / 4)) % 8; return COMPASS[k]; }
const angDiff = (a: number, b: number) => { let d = (a - b) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; };
function polySize(poly: Vec2[]): [number, number] { const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]); return [round(Math.max(...xs) - Math.min(...xs)), round(Math.max(...zs) - Math.min(...zs))]; }
function pointNearPoly(p: Vec2, poly: Vec2[], tol: number): boolean {
  if (pointInPoly(p[0], p[1], poly)) return true;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [ax, az] = poly[j], [bx, bz] = poly[i]; const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1; const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - az) * dz) / l2)); if (Math.hypot(ax + dx * t - p[0], az + dz * t - p[1]) <= tol) return true; }
  return false;
}
const round = (v: number) => Math.round(v * 100) / 100;
