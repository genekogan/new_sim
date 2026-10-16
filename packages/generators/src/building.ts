// building/1 and stairs/1. Owner: L2 (buildings). Spec <eden4>/29 WP2, 33 §2 row 3, 31 §3.
// Physics half: params (+ def `make.args` presets) → a floor plan (auto per style, or the explicit
// `plan` json; building-plan.ts) → a layout in the canonical frame (front = +z; building-layout.ts)
// → architecture checks → Baked turned to `front`: wall segments split at doors and windows (sill and
// lintel pieces kept), stair bodies, rails, posts; floors per level minus stairwells; openings; stair
// links; rooms with frames and `room` slots. The mesh half (apps/web/src/gen-mesh/building.mesh.ts)
// draws the same layout via `buildingGen.layout`.
import { n, s, b, segmentColliders, rectPoly } from './geom.ts';
import type { Baked, Generator, LocalOBB, Opening, Room, Slot, Surface, Vec2, Link } from './types.ts';
import { autoPlan, explicitPlan, SLAB, FLOOR0 } from './building-plan.ts';
import { realize, architectureChecks, type Layout, type Checks } from './building-layout.ts';

export const BUILDING_STYLES = ['cottage', 'townhouse', 'hall', 'barn', 'tower', 'pavilion', 'greenhouse', 'shed', 'shop', 'chapel'] as const;

export const buildingParams = {
  w: { type: 'number', min: 3, max: 40, default: 8, doc: 'width (x) in metres' },
  d: { type: 'number', min: 3, max: 40, default: 6, doc: 'depth (z) in metres' },
  floors: { type: 'int', min: 1, max: 6, default: 1 },
  floorHeight: { type: 'number', min: 2.4, max: 5, default: 2.8 },
  style: { type: 'enum', values: [...BUILDING_STYLES], default: 'cottage' },
  roof: { type: 'enum', values: ['gable', 'hip', 'flat', 'shed', 'dome', 'none'], default: 'gable' },
  roofPitch: { type: 'number', min: 0, max: 60, default: 32, doc: 'degrees' },
  material: { type: 'enum', values: ['plaster', 'brick', 'stone', 'wood', 'glass', 'metal'], default: 'plaster' },
  wall: { type: 'color', default: '#f1e7d2' },
  trim: { type: 'color', default: '#6b4a2b' },
  roofColor: { type: 'color', default: '#8a3b2a' },
  chimney: { type: 'bool', default: true, doc: 'allow the preset chimney (false removes it)' },
  shutters: { type: 'bool', default: true, doc: 'allow the preset window shutters' },
  flowerBoxes: { type: 'bool', default: true, doc: 'allow the preset window flower boxes' },
  quoins: { type: 'bool', default: true, doc: 'allow corner quoins and pilasters' },
  hood: { type: 'bool', default: true, doc: 'allow exterior door hoods and brackets' },
  doorLamp: { type: 'bool', default: true, doc: 'allow lamps beside exterior doors' },
  front: { type: 'enum', values: ['s', 'n', 'e', 'w'], default: 's', doc: 'side of the main door (s = +z)' },
  porch: { type: 'number', min: 0, max: 4, default: 0, doc: 'porch depth in metres (0 = none)' },
  balcony: { type: 'bool', default: false },
  windows: { type: 'number', min: 0, max: 1, default: 0.6, doc: 'window density along exterior walls' },
  plan: { type: 'json', doc: 'optional explicit plan: {floors:[{rooms:[{id,name,rect:[x0,z0,x1,z1]}],doors:[…],exterior:[…]}],stairs:[…]}' },
  wallThickness: { type: 'number', min: 0.1, max: 0.6, default: 0.22 },
  // XP8 hook: drawn only by the viewer (no physics); world-compiler/src/faces.ts checks slots and images.
  decals: { type: 'json', doc: 'optional wall decals: [{slot (a wall slot: facade-*, opening-*, gable-*, wall-*), w, h, at?:[right,up], text|image|pattern, …face fields}]' },
} as const;

const FRONT_YAW: Record<string, number> = { s: 0, e: Math.PI / 2, n: Math.PI, w: -Math.PI / 2 };

export type BuildingLayout = Layout & { yaw: number; front: string; style: string; roof: string; roofPitch: number; roofRise: number; material: string; checks: Checks; params: Record<string, unknown>; args: Record<string, unknown> };

/** Roof rise above the wall top for the box and the mesh. */
function roofRise(roof: string, pitchDeg: number, W: number, D: number, round: boolean): number {
  const pitch = (Math.min(60, Math.max(0, pitchDeg)) * Math.PI) / 180, short = Math.min(W, D);
  switch (roof) {
    case 'gable': case 'hip': return round ? Math.max(1.2, Math.tan(Math.max(pitch, 0.7)) * (short / 2 + 0.3)) : Math.tan(pitch) * (short / 2 + 0.35);
    case 'shed': return Math.tan(pitch) * 0.5 * (D + 0.5);
    case 'dome': return short * 0.42;
    case 'flat': return 0.45;
    default: return 0;
  }
}

const layoutCache = new Map<string, BuildingLayout>();
/** The full layout (canonical frame + yaw) for params and def args; cached by value. */
export function buildingLayout(params: Record<string, unknown>, args: Record<string, unknown> = {}): BuildingLayout {
  const key = JSON.stringify([params, args]);
  const hit = layoutCache.get(key); if (hit) return hit;
  const style = s(args.style ?? params.style, 'cottage'), front = s(params.front, 's');
  const w = n(params.w, 8), d = n(params.d, 6), t = n(params.wallThickness, 0.22);
  const floorsMax = style === 'tower' ? 6 : 4;
  const floors = Math.max(1, Math.min(floorsMax, Math.round(n(params.floors, 1))));
  const fh = Math.max(2.4, Math.min(5, n(params.floorHeight, 2.8)));
  const turned = front === 'e' || front === 'w';
  const W = turned ? d : w, D = turned ? w : d;
  const common = { W, D, t, fh, floors, balcony: b(params.balcony, false), porch: n(params.porch, 0), density: n(params.windows, 0.6) };
  const usePlan = !!params.plan && typeof params.plan === 'object' && Array.isArray((params.plan as { floors?: unknown }).floors);
  const plan = usePlan ? explicitPlan(params.plan, { ...common, W: w, D: d }) : autoPlan({ ...common, style }, args);
  const L = realize(plan);
  const roof = s(params.roof, 'gable');
  const out: BuildingLayout = { ...L, yaw: usePlan ? 0 : FRONT_YAW[front] ?? 0, front: usePlan ? 's' : front, style: usePlan ? 'plan' : style, roof, roofPitch: n(params.roofPitch, 32), roofRise: roofRise(roof, n(params.roofPitch, 32), L.W, L.D, !!L.round), material: s(params.material, 'plaster'), checks: architectureChecks(L), params, args };
  if (layoutCache.size > 256) layoutCache.clear();
  layoutCache.set(key, out);
  return out;
}

export function buildingPhysics(params: Record<string, unknown>, args: Record<string, unknown> = {}): Baked {
  const L = buildingLayout(params, args);
  const c = Math.cos(L.yaw), sn = Math.sin(L.yaw);
  const R = (p: Vec2): Vec2 => [p[0] * c + p[1] * sn, -p[0] * sn + p[1] * c];
  const Rp = (poly: Vec2[]) => poly.map(R);
  const side = (canon: string | undefined) => { if (!canon) return undefined; const nrm: Vec2 = canon === 's' ? [0, 1] : canon === 'n' ? [0, -1] : canon === 'e' ? [1, 0] : [-1, 0]; const [x, z] = R(nrm); return Math.abs(z) >= Math.abs(x) ? (z > 0 ? 's' : 'n') : x > 0 ? 'e' : 'w'; };
  const r2 = (v: number) => Math.round(v * 1000) / 1000;
  const rr = (p: Vec2): Vec2 => [r2(p[0]), r2(p[1])];
  const fy = (k: number) => k * L.fh + FLOOR0;

  // ---- colliders: wall segments split at openings (sill and lintel pieces kept), stairs, rails, posts
  const colliders: LocalOBB[] = [];
  L.walls.forEach((w, wi) => {
    const tag = w.exterior ? `wall:f${w.floor}:${side(w.side) ?? w.id}` : `wall:f${w.floor}:${[w.neg, w.pos].sort().join('|')}`;
    const ops = L.openings.filter((o) => o.wall === wi);
    const gaps = ops.map((o) => ({ from: o.s - o.width / 2, to: o.s + o.width / 2 }));
    const path: Vec2[] = [R(w.a), R(w.b)];
    colliders.push(...segmentColliders(path, w.thick, w.y0, w.y1, gaps, tag));
    const ux = path[1][0] - path[0][0], uz = path[1][1] - path[0][1], len = Math.hypot(ux, uz) || 1, yaw = Math.atan2(-uz / len, ux / len);
    for (const o of ops) {
      const cxz = R(o.at), base = fy(o.floor), half: Vec2 = [o.width / 2, w.thick / 2];
      if (o.sill > 0.05) colliders.push({ c: cxz, half, yaw, y0: w.y0, y1: base + o.sill, tag });
      if (base + o.sill + o.height < w.y1 - 0.05) colliders.push({ c: cxz, half, yaw, y0: base + o.sill + o.height, y1: w.y1, tag });
    }
  });
  for (const st of L.stairs) {
    if (st.rect) {
      const [x0, z0, x1, z1] = st.rect, cc = R([(x0 + x1) / 2, (z0 + z1) / 2]);
      colliders.push({ c: cc, half: [(x1 - x0) / 2, (z1 - z0) / 2], yaw: L.yaw, y0: st.y0 - FLOOR0, y1: st.y1 - 0.05, tag: `stairs:${st.id}` });
    } else if (st.c && st.r !== undefined) {
      const segs = 8;
      for (let i = 0; i < segs; i++) {
        const a0 = st.a0! + (st.sweep! * i) / segs, a1 = st.a0! + (st.sweep! * (i + 1)) / segs, am = (a0 + a1) / 2;
        const chord = 2 * st.r * Math.sin((a1 - a0) / 2) + 0.1;
        const h0 = st.y0 + ((st.y1 - st.y0) * i) / segs, h1 = st.y0 + ((st.y1 - st.y0) * (i + 1)) / segs;
        colliders.push({ c: R([st.c[0] + st.r * Math.sin(am), st.c[1] + st.r * Math.cos(am)]), half: [chord / 2, st.width / 2], yaw: am + L.yaw, y0: Math.max(st.y0 - FLOOR0, h0 - 0.35), y1: h1, tag: `stairs:${st.id}` });
      }
    }
  }
  for (const rl of L.rails) colliders.push(...segmentColliders([R(rl.a), R(rl.b)], 0.06, rl.y0, rl.y1, [], 'rail'));
  for (const p of L.posts) colliders.push({ c: R(p.c), half: [p.r, p.r], yaw: L.yaw, y0: p.y0, y1: p.y1, tag: 'post' });
  // the lighthouse lamp (pedestal and lens, drawn by the mesh half) stands in the middle of the top floor
  if (L.args.lantern) { const y = fy(L.floors - 1); colliders.push({ c: [0, 0], half: [0.4, 0.4], yaw: L.yaw, y0: y, y1: y + 1.7, tag: 'lamp' }); }

  // ---- surfaces (walkable floors), rooms, openings, links
  const surfaces: Surface[] = [];
  for (const lv of L.levels) for (const q of lv.polys) surfaces.push({ level: lv.floor, y: r2(lv.y), polygon: Rp(q.poly).map(rr), tag: q.room });
  if (L.porch) surfaces.push({ level: 0, y: r2(L.porch.y), polygon: Rp(L.porch.poly).map(rr), tag: 'porch', material: 'wood' });
  if (L.balcony) for (const q of L.balcony.polys) surfaces.push({ level: L.balcony.floor, y: r2(L.balcony.y), polygon: Rp(q).map(rr), tag: 'balcony' });
  const roofY = L.wallTop + 0.02;
  const flatRoof = L.roof === 'flat' && !L.open;
  if (flatRoof) surfaces.push({ level: L.floors, y: r2(roofY), polygon: Rp(outline(L)).map(rr), tag: 'roof' });
  const rooms: Room[] = L.rooms.map((r) => ({ id: r.id, name: r.name, floor: r.floor, y: r2(r.y), polygon: Rp(r.poly).map(rr), origin: rr(R(r.centre)), yaw: 0, height: r2(r.height) }));
  const openings: Opening[] = L.openings.map((o) => {
    const wall = o.wall >= 0 ? L.walls[o.wall] : undefined;
    const outN: Vec2 = wall?.out ?? (wall ? normalOf(wall) : (Math.abs(o.at[1]) >= Math.abs(o.at[0]) ? [0, Math.sign(o.at[1]) || 1] : [Math.sign(o.at[0]), 0]));
    const heading = Math.atan2(outN[0], outN[1]) + L.yaw;
    return { id: o.id, kind: o.kind, from: o.from, to: o.to, exterior: o.exterior, ...(o.wall >= 0 ? { wall: o.wall } : {}), at: rr(R(o.at)), yaw: r2(heading), width: r2(o.width), height: r2(o.height), ...(o.sill ? { sill: r2(o.sill) } : {}), level: o.floor, ...(o.kind !== 'window' ? { state: o.kind === 'arch' ? 'always' as const : 'open' as const } : {}) };
  });
  const links: Link[] = L.stairs.map((st) => ({ id: st.id, kind: 'stairs', from: st.from, to: st.to, path: st.path.map(R).map(rr), width: r2(st.width), y0: r2(st.y0), y1: r2(st.y1) }));

  // ---- slots: rooms, floors, front stand, porch/balcony/roof, wall hang points
  const slots: Slot[] = [];
  for (const r of rooms) {
    const poly = r.polygon.map(([x, z]) => [r2(x - r.origin[0]), r2(z - r.origin[1])] as Vec2);
    slots.push({ id: r.id, kind: 'room', p: [r.origin[0], r.y, r.origin[1]], yaw: 0, floor: r.floor, polygon: poly, height: r.height, accepts: {}, capacity: 64, label: r.name });
  }
  for (let k = 0; k < L.floors; k++) slots.push({ id: k === 0 ? 'ground' : `floor-${k}`, kind: 'floor', p: [0, r2(fy(k)), 0], yaw: 0, floor: k, polygon: Rp(outline(L)).map(rr), accepts: {}, capacity: 256, label: k === 0 ? 'Ground floor' : `Floor ${k}` });
  const door = L.openings.find((o) => o.id === 'front-door') ?? L.openings.find((o) => o.exterior && o.kind !== 'window');
  if (door) {
    const wall = door.wall >= 0 ? L.walls[door.wall] : undefined, outN: Vec2 = wall?.out ?? [0, 1];
    const away = (L.porch && wall?.side === 's' ? L.porch.depth : 0) + 1.2;
    const at = R([door.at[0] + outN[0] * away, door.at[1] + outN[1] * away]);
    slots.push({ id: 'front', kind: 'stand', p: [r2(at[0]), 0, r2(at[1])], yaw: r2(Math.atan2(-outN[0], -outN[1]) + L.yaw), accepts: {}, capacity: 8, label: 'Outside the front door' });
  }
  if (L.porch) { const pc = R([0, L.D / 2 + L.porch.depth / 2]); slots.push({ id: 'porch', kind: 'floor', p: [r2(pc[0]), r2(L.porch.y), r2(pc[1])], yaw: 0, floor: 0, accepts: {}, capacity: 16, label: 'Porch' }); }
  if (L.balcony) { const bc = L.balcony.rect ? R([(L.balcony.rect[0] + L.balcony.rect[2]) / 2, (L.balcony.rect[1] + L.balcony.rect[3]) / 2]) : R([0, (L.balcony.r0! + L.balcony.r1!) / 2]); slots.push({ id: 'balcony', kind: 'floor', p: [r2(bc[0]), r2(L.balcony.y), r2(bc[1])], yaw: 0, floor: L.balcony.floor, accepts: {}, capacity: 8, label: 'Balcony' }); }
  if (flatRoof) slots.push({ id: 'roof', kind: 'roof', p: [0, r2(roofY), 0], yaw: 0, floor: L.floors, polygon: Rp(outline(L)).map(rr), accepts: {}, capacity: 64, label: 'Roof terrace' });
  // hang points: outside faces of the ground-floor walls, clear of openings (`wall-<side>-<i>`)
  const counts: Record<string, number> = {};
  L.walls.forEach((w, wi) => {
    if (!w.exterior || w.floor !== 0 || !w.out) return;
    const total = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    const ops = L.openings.filter((o) => o.wall === wi);
    for (const f of [0.5, 0.25, 0.75]) {
      const sc = total * f; if (ops.some((o) => Math.abs(o.s - sc) < o.width / 2 + 0.45)) continue;
      const sd = side(w.side) ?? 's'; counts[sd] = (counts[sd] ?? 0) + 1; if (counts[sd] > 3) break;
      const pt: Vec2 = [w.a[0] + (w.b[0] - w.a[0]) * f + w.out[0] * (w.thick / 2 + 0.02), w.a[1] + (w.b[1] - w.a[1]) * f + w.out[1] * (w.thick / 2 + 0.02)];
      const at = R(pt);
      slots.push({ id: `wall-${sd}-${counts[sd]}`, kind: 'wall', p: [r2(at[0]), 1.7, r2(at[1])], yaw: r2(Math.atan2(w.out[0], w.out[1]) + L.yaw), accepts: { maxSize: [2.5, 2, 0.4] }, capacity: 1, label: `${sd} wall` });
      break;
    }
  });
  slots.push(...buildingFacadeSlots(L, slots.map(s => s.id)));

  const H = L.wallTop + L.roofRise + (L.args.lantern ? 0.9 : 0);
  const turned = !(Math.abs(Math.sin(L.yaw)) < 1e-6);
  const porchExtra = L.porch ? 2 * L.porch.depth : 0, ringExtra = L.balcony?.ring ? Math.max(0, 2 * L.balcony.r1! - Math.max(L.W, L.D)) : 0;
  const [bw, bd] = turned ? [L.D, L.W] : [L.W, L.D];
  const box: [number, number, number] = [r2(bw + (turned ? porchExtra : 0) + ringExtra), r2(H), r2(bd + (turned ? 0 : porchExtra) + ringExtra)];
  return { box, colliders, surfaces, openings, links, rooms, slots, tris: estimateTris(L), notes: L.checks.notes };
}

/** Additive facade frames. +z faces out; opening origins are at their sills, wall origins at
 * storey mid-height. Existing room and legacy wall slot ids always keep their meaning. */
export function buildingFacadeSlots(L: BuildingLayout, reserved: string[] = []): Slot[] {
  const slots: Slot[] = [], ids = new Set(reserved), c = Math.cos(L.yaw), s = Math.sin(L.yaw);
  const round = (v: number) => Math.round(v * 1000) / 1000;
  const add = (base: string, kind: Slot['kind'], x: number, y: number, z: number, yaw: number, floor: number, label: string) => {
    let id = base; for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
    ids.add(id);
    slots.push({ id, kind, p: [round(x * c + z * s), round(y), round(-x * s + z * c)], yaw: round(yaw + L.yaw), floor, accepts: {}, capacity: 1, label });
  };
  for (const o of L.openings) {
    if (!o.exterior) continue;
    const w = L.walls[o.wall], out = w?.out ?? normalForPoint(o.at), d = (w?.thick ?? L.t) / 2 + 0.02;
    add(`opening-${o.id}`, 'wall', o.at[0] + out[0] * d, FLOOR0 + o.floor * L.fh + o.sill, o.at[1] + out[1] * d, Math.atan2(out[0], out[1]), o.floor, `${o.kind} ${o.id} facade`);
  }
  const counts = new Map<string, number>();
  for (const w of L.walls) {
    if (!w.exterior || !w.out) continue;
    const key = `facade-f${w.floor}-${w.side ?? 'wall'}`, n = (counts.get(key) ?? 0) + 1; counts.set(key, n);
    const d = w.thick / 2 + 0.02;
    add(`${key}-${n}`, 'wall', (w.a[0] + w.b[0]) / 2 + w.out[0] * d, (w.y0 + w.y1) / 2, (w.a[1] + w.b[1]) / 2 + w.out[1] * d, Math.atan2(w.out[0], w.out[1]), w.floor, `${w.side ?? 'Outer'} wall, storey ${w.floor}`);
  }
  if (!L.round && (L.roof === 'gable' || L.roof === 'hip')) {
    const alongX = L.W >= L.D, short = Math.min(L.W, L.D), long = Math.max(L.W, L.D), ov = L.open ? 0.4 : 0.35;
    if (L.roof === 'gable' && !L.open) for (const sign of [-1, 1]) {
      const d = long / 2 + 0.02, y = L.wallTop + L.roofRise * (short / 2) / (short / 2 + ov);
      const side = alongX ? (sign > 0 ? 'e' : 'w') : (sign > 0 ? 's' : 'n');
      add(`gable-${side}`, 'wall', alongX ? sign * d : 0, y, alongX ? 0 : sign * d, alongX ? sign * Math.PI / 2 : sign > 0 ? 0 : Math.PI, L.floors - 1, `${side} gable apex`);
    }
    add('ridge', 'roof', 0, L.wallTop + L.roofRise + 0.18, 0, alongX ? 0 : Math.PI / 2, L.floors, 'Roof ridge centre');
  }
  return slots;
}
function normalForPoint([x, z]: Vec2): Vec2 { return Math.abs(z) >= Math.abs(x) ? [0, Math.sign(z) || 1] : [Math.sign(x), 0]; }

/** Outer outline of the footprint (canonical). */
function outline(L: Layout): Vec2[] {
  if (L.round) { const R = L.round.R + L.t / 2, k = L.round.sides; return Array.from({ length: k }, (_, i) => { const a = ((i + 0.5) * 2 * Math.PI) / k; return [R * Math.sin(a), R * Math.cos(a)] as Vec2; }); }
  return rectPoly(-L.W / 2, -L.D / 2, L.W / 2, L.D / 2);
}
function normalOf(w: Layout['walls'][number]): Vec2 { const dx = w.b[0] - w.a[0], dz = w.b[1] - w.a[1], l = Math.hypot(dx, dz) || 1; return [dz / l, -dx / l]; }
/** Triangle estimate matching the mesh half's budget (walls, openings with frames, floors, stairs, roof, details). */
export function estimateTris(L: Layout): number {
  // calibrated against the mesh half (apps/web/.lane/tris.mts): walls as faces, framed openings, slabs, stairs, rails
  const walls = L.walls.length * 30, ops = L.openings.reduce((m, o) => m + (o.kind === 'window' ? (o.exterior ? 100 : 60) : 90), 0);
  const floors = L.levels.reduce((m, lv) => m + lv.polys.length * 40, 0), rooms = L.rooms.length * 32;
  const stairs = L.stairs.reduce((m, st) => m + st.risers * (st.kind === 'spiral' ? 14 : 26) + 80, 0), rails = L.rails.length * 40, posts = L.posts.length * 48;
  // the mesh half drops detail (ivy, flowers, shutters, lamps, mullions) until it fits 6 k, so the budget is capped there
  return Math.min(6000, Math.round(walls + ops + floors + rooms + stairs + rails + posts + 500 + (L.round ? 400 : 0)));
}

export const buildingGen: Generator & { layout: typeof buildingLayout } = {
  id: 'building/1', form: 'point', owner: 'L2', params: buildingParams as never,
  doc: 'A building with floors, rooms, doors, windows, stairs and a roof. Rooms are slots (`in: {parent, slot: "kitchen"}`); floors are slots `ground`, `floor-1`…; `front` stands outside the door. Styles plan rooms; `plan` overrides. Optional chimney/shutters/flowerBoxes/quoins/hood/doorLamp switches preserve the preset when true. Changing trim recolours sills/lintels. Facade slots: opening-<opening-id> at each exterior sill, facade-f<floor>-<side>-<n> at wall centres, gable-<side> at gable apexes, ridge above the roof. Facades face out (+z); mount kits with place --on house/<slot>. Existing wall-<side>-<n> slots remain.',
  physics({ params, args }) { return buildingPhysics(params, args); },
  layout: buildingLayout,
};

export { architectureChecks, SLAB };
export const stairsGen: Generator = {
  id: 'stairs/1', form: 'point', owner: 'L2',
  doc: 'A straight flight of stairs from y=0 to `rise`, `run` long, `width` wide; a link between two levels.',
  params: { rise: { type: 'number', min: 0.3, max: 12, default: 2.8 }, run: { type: 'number', min: 0.5, max: 20, default: 4 }, width: { type: 'number', min: 0.6, max: 6, default: 1.1 }, material: { type: 'enum', values: ['wood', 'stone', 'metal'], default: 'wood' }, rail: { type: 'bool', default: true } },
  physics({ params }) {
    const rise = n(params.rise, 2.8), run = n(params.run, 4), width = n(params.width, 1.1);
    return { box: [width, rise, run], colliders: [{ c: [0, 0], half: [width / 2, run / 2], yaw: 0, y0: 0, y1: Math.min(rise, 0.3) }], links: [{ id: 'flight', kind: 'stairs', from: 0, to: 1, path: [[0, run / 2], [0, -run / 2]], width, y0: 0, y1: rise }], surfaces: [{ level: 1, y: rise, polygon: rectPoly(-width / 2, -run / 2 - 0.5, width / 2, -run / 2), tag: 'landing' }], slots: [], tris: 24 * Math.ceil(rise / 0.18) };
  },
};
