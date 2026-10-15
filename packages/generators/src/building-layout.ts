// building/1: plan → layout (walls, openings, stairs, floors, porch, balcony) in the canonical frame
// (front = +z), plus the architecture checks. The physics half rotates the layout to `front` and
// emits Baked; the mesh half draws the layout directly inside a group turned by `yaw`.
// Owner: L2 (buildings). Spec <eden4>/29 WP2, 33 §2 row 3, 31 §3 rules 1–2.
import { pointInPoly, polyArea } from './geom.ts';
import { reachableFromOutside } from './reachability.ts';
import type { Vec2 } from './types.ts';
import { FLOOR0, SLAB, floorY, ngon, type PExt, type Plan, type Rect, type Side } from './building-plan.ts';

export type LWall = {
  id: string; floor: number; axis: 'x' | 'z' | 'r';
  /** Endpoints on the centreline (exterior runs extended over the corners). */
  a: Vec2; b: Vec2; y0: number; y1: number; thick: number;
  /** Room on the left/right of a→b ('neg' = -z or -x side for axis walls; for round walls the room is `neg`). */
  neg: string | null; pos: string | null; exterior: boolean;
  /** Canonical side for exterior walls; unit outward normal. */
  side?: Side; out?: Vec2;
};
export type LOpening = {
  id: string; kind: 'door' | 'window' | 'arch'; floor: number; wall: number; wallId: string;
  /** Distance from wall.a to the opening centre along the wall. */
  s: number; at: Vec2; width: number; height: number; sill: number;
  /** Rooms (or 'outside' / 'balcony' / 'porch') joined by a door. */
  from?: string; to?: string; exterior: boolean;
};
export type LStair = {
  id: string; kind: 'straight' | 'spiral'; from: number; to: number; room: string; width: number; risers: number; y0: number; y1: number;
  /** Straight: footprint rect, rise axis and direction. Spiral: centre, mid radius, start angle and sweep. */
  rect?: Rect; axis?: 'x' | 'z'; dir?: 1 | -1;
  c?: Vec2; r?: number; a0?: number; sweep?: number;
  /** Walk line: approach on `from`, arrival on `to`. */
  path: Vec2[];
  /** Region removed from floor `to` (the stairwell). */
  hole: Vec2[];
};
export type LRail = { a: Vec2; b: Vec2; y0: number; y1: number };
export type LRoom = { id: string; name: string; kind: string; floor: number; y: number; poly: Vec2[]; centre: Vec2; height: number };
export type LLevel = { floor: number; y: number; polys: { room: string; poly: Vec2[] }[] };
export type Layout = {
  W: number; D: number; t: number; fh: number; floors: number; wallTop: number; open: boolean;
  round?: { R: number; sides: number };
  walls: LWall[]; openings: LOpening[]; stairs: LStair[]; rooms: LRoom[]; levels: LLevel[]; rails: LRail[];
  posts: { c: Vec2; r: number; y0: number; y1: number }[];
  porch?: { poly: Vec2[]; y: number; depth: number };
  balcony?: { floor: number; y: number; polys: Vec2[][]; ring: boolean; r0?: number; r1?: number; rect?: Rect };
  warnings: string[];
};

const EPS = 1e-6;
const DOOR_W = 0.9, EXT_DOOR_W = 1.0;
const doorH = (fh: number) => Math.min(2.1, fh - SLAB - 0.12);

/** Rect shrunk to the faces of its walls: exterior edges by t/2, interior by ti/2. */
function innerRect(r: Rect, p: Plan): Rect {
  const X0 = -p.W / 2 + p.t / 2, X1 = p.W / 2 - p.t / 2, Z0 = -p.D / 2 + p.t / 2, Z1 = p.D / 2 - p.t / 2;
  const h = (v: number, bound: number) => (Math.abs(v - bound) < 1e-6 ? p.t / 2 : p.ti / 2);
  return [r[0] + h(r[0], X0), r[1] + h(r[1], Z0), r[2] - h(r[2], X1), r[3] - h(r[3], Z1)];
}
export const rectPolyOf = (r: Rect): Vec2[] => [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];
/** Rect minus rect → up to four rects (stairwells always touch at least one side, usually leaving two or three). */
function subtract(a: Rect, h: Rect): Rect[] {
  const x0 = Math.max(a[0], h[0]), z0 = Math.max(a[1], h[1]), x1 = Math.min(a[2], h[2]), z1 = Math.min(a[3], h[3]);
  if (x1 - x0 <= EPS || z1 - z0 <= EPS) return [a];
  const out: Rect[] = [];
  if (z0 - a[1] > 0.05) out.push([a[0], a[1], a[2], z0]);
  if (a[3] - z1 > 0.05) out.push([a[0], z1, a[2], a[3]]);
  if (x0 - a[0] > 0.05) out.push([a[0], z0, x0, z1]);
  if (a[2] - x1 > 0.05) out.push([x1, z0, a[2], z1]);
  return out;
}

/** Wall pieces of one floor of rect rooms: maximal runs with the same rooms on either side. */
function rectWalls(p: Plan, floor: number, rooms: { id: string; rect: Rect }[]): Omit<LWall, 'id'>[] {
  type Edge = { s0: number; s1: number; room: string; side: -1 | 1 };
  const lines = new Map<string, { axis: 'x' | 'z'; c: number; edges: Edge[] }>();
  const add = (axis: 'x' | 'z', c: number, s0: number, s1: number, room: string, side: -1 | 1) => {
    const key = `${axis}:${c.toFixed(4)}`; let l = lines.get(key); if (!l) { l = { axis, c, edges: [] }; lines.set(key, l); } l.edges.push({ s0, s1, room, side });
  };
  for (const r of rooms) {
    const [x0, z0, x1, z1] = r.rect;
    add('x', z0, x0, x1, r.id, 1); add('x', z1, x0, x1, r.id, -1);   // room is on the + side of its top (z0) edge
    add('z', x0, z0, z1, r.id, 1); add('z', x1, z0, z1, r.id, -1);
  }
  const y0 = floor * p.fh, y1 = (floor + 1) * p.fh;
  const out: Omit<LWall, 'id'>[] = [];
  for (const l of lines.values()) {
    const bps = [...new Set(l.edges.flatMap((e) => [e.s0, e.s1]).map((v) => +v.toFixed(4)))].sort((a, b) => a - b);
    const pieces: { s0: number; s1: number; neg: string | null; pos: string | null }[] = [];
    for (let i = 0; i < bps.length - 1; i++) {
      const m = (bps[i] + bps[i + 1]) / 2;
      const neg = l.edges.find((e) => e.side === -1 && e.s0 < m && e.s1 > m)?.room ?? null;
      const pos = l.edges.find((e) => e.side === 1 && e.s0 < m && e.s1 > m)?.room ?? null;
      if (!neg && !pos) continue;
      const last = pieces[pieces.length - 1];
      if (last && Math.abs(last.s1 - bps[i]) < EPS && last.neg === neg && last.pos === pos) last.s1 = bps[i + 1];
      else pieces.push({ s0: bps[i], s1: bps[i + 1], neg, pos });
    }
    for (const pc of pieces) {
      const exterior = !pc.neg || !pc.pos;
      const thick = exterior ? p.t : p.ti;
      let s0 = pc.s0, s1 = pc.s1;
      // exterior runs along x close the corners: extend over the perpendicular wall's half thickness
      if (exterior && l.axis === 'x') {
        if (!pieces.some((q) => q !== pc && Math.abs(q.s1 - pc.s0) < EPS)) s0 -= p.t / 2;
        if (!pieces.some((q) => q !== pc && Math.abs(q.s0 - pc.s1) < EPS)) s1 += p.t / 2;
      }
      const a: Vec2 = l.axis === 'x' ? [s0, l.c] : [l.c, s0], b: Vec2 = l.axis === 'x' ? [s1, l.c] : [l.c, s1];
      const side: Side | undefined = !exterior ? undefined : l.axis === 'x' ? (pc.pos ? 'n' : 's') : (pc.pos ? 'w' : 'e');
      const outN: Vec2 | undefined = side === 's' ? [0, 1] : side === 'n' ? [0, -1] : side === 'e' ? [1, 0] : side === 'w' ? [-1, 0] : undefined;
      out.push({ floor, axis: l.axis, a, b, y0, y1, thick, neg: pc.neg, pos: pc.pos, exterior, ...(side ? { side, out: outN } : {}) });
    }
  }
  return out;
}

const len2 = (a: Vec2, b: Vec2) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const lerp2 = (a: Vec2, b: Vec2, s: number): Vec2 => { const L = len2(a, b) || 1; return [a[0] + ((b[0] - a[0]) * s) / L, a[1] + ((b[1] - a[1]) * s) / L]; };

export function realize(p: Plan): Layout {
  const L: Layout = { W: p.W, D: p.D, t: p.t, fh: p.fh, floors: p.floors, wallTop: p.floors * p.fh, open: !!p.open, ...(p.round ? { round: p.round } : {}), walls: [], openings: [], stairs: [], rooms: [], levels: [], rails: [], posts: [], warnings: [...p.warnings] };
  const reserved = new Set(['ground', 'front', 'porch', 'balcony', 'roof']);
  for (const r of p.rooms) if (reserved.has(r.id) || /^floor-\d+$/.test(r.id)) { const old = r.id; r.id = `${old}-room`; for (const d of p.doors) { if (d.a === old) d.a = r.id; if (d.b === old) d.b = r.id; } for (const e of p.ext) if (e.room === old) e.room = r.id; for (const s of p.stairs) if (s.room === old) s.room = r.id; }

  // ---- rooms (interior polygons) and walls
  for (const r of p.rooms) {
    if (r.floor >= p.floors) continue;
    const y = floorY(r.floor, p.fh);
    let poly: Vec2[], centre: Vec2;
    if (r.rect) { const ir = innerRect(r.rect, p); poly = rectPolyOf(ir); centre = [(ir[0] + ir[2]) / 2, (ir[1] + ir[3]) / 2]; }
    else { poly = p.round ? ngon(p.round.R - p.t / 2, p.round.sides) : r.poly ?? []; centre = [0, 0]; }
    if (p.open && r.rect) { poly = rectPolyOf(r.rect); }
    L.rooms.push({ id: r.id, name: r.name, kind: r.kind, floor: r.floor, y, poly, centre, height: p.fh - SLAB });
  }
  for (let k = 0; k < p.floors; k++) {
    if (p.open) continue;
    if (p.round) {
      const room = p.rooms.find((r) => r.floor === k)?.id ?? null;
      const pts = ngon(p.round.R, p.round.sides);
      pts.forEach((a, i) => {
        const b = pts[(i + 1) % pts.length], mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], m = Math.hypot(mid[0], mid[1]) || 1;
        // extend chords a little so the polygon closes at its corners
        const ext = p.t * Math.tan(Math.PI / p.round!.sides) / 2, ab = len2(a, b);
        const a2 = lerp2(b, a, ab + ext), b2 = lerp2(a, b, ab + ext);
        L.walls.push({ id: `f${k}-c${i}`, floor: k, axis: 'r', a: a2, b: b2, y0: k * p.fh, y1: (k + 1) * p.fh, thick: p.t, neg: room, pos: null, exterior: true, side: sideOf([mid[0] / m, mid[1] / m]), out: [mid[0] / m, mid[1] / m] });
      });
      continue;
    }
    const rooms = p.rooms.filter((r) => r.floor === k && r.rect).map((r) => ({ id: r.id, rect: r.rect! }));
    rectWalls(p, k, rooms).forEach((w, i) => L.walls.push({ ...w, id: `f${k}-w${i}` }));
  }

  // ---- doors (interior)
  const used = new Map<number, [number, number][]>(); // wall → occupied intervals
  const claim = (wi: number, s0: number, s1: number) => { const u = used.get(wi) ?? []; if (u.some(([a, b]) => s1 > a - 0.15 && s0 < b + 0.15)) return false; u.push([s0, s1]); used.set(wi, u); return true; };
  const rect = (id: string, floor: number) => p.rooms.find((r) => r.id === id && r.floor === floor)?.rect;
  const doorsTried = new Set<string>();
  for (const d of p.doors) {
    const key = `${d.floor}:${[d.a, d.b].sort().join('|')}`; if (doorsTried.has(key)) continue;
    const ra = rect(d.a, d.floor), rb = rect(d.b, d.floor);
    if (!ra || !rb) { L.warnings.push(`door ${d.a}↔${d.b} (floor ${d.floor}): no such room`); continue; }
    const shared = sharedEdge(ra, rb);
    const w = Math.max(0.6, Math.min(2.4, d.width ?? DOOR_W));
    if (!shared || shared.s1 - shared.s0 < w + 0.3) { if (d.width !== undefined || d.at !== undefined) L.warnings.push(`door ${d.a}↔${d.b} (floor ${d.floor}): rooms do not share a wall long enough`); continue; }
    doorsTried.add(key);
    const at = d.at ?? 0.5, lo = shared.s0 + w / 2 + 0.2, hi = shared.s1 - w / 2 - 0.2;
    const sc = stairClear(p, d.floor, shared, w, lo, hi, lo > hi ? (shared.s0 + shared.s1) / 2 : Math.min(hi, Math.max(lo, shared.s0 + (shared.s1 - shared.s0) * at)));
    const wi = L.walls.findIndex((x) => x.floor === d.floor && x.axis === shared.axis && Math.abs((x.axis === 'x' ? x.a[1] : x.a[0]) - shared.c) < 1e-4 && !x.exterior && sOf(x, sc) >= 0 && sOf(x, sc) <= len2(x.a, x.b));
    if (wi < 0) continue;
    const wall = L.walls[wi], s = sOf(wall, sc);
    if (!claim(wi, s - w / 2, s + w / 2)) continue;
    L.openings.push({ id: `door-${d.a}-${d.b}`.slice(0, 60), kind: 'door', floor: d.floor, wall: wi, wallId: wall.id, s, at: lerp2(wall.a, wall.b, s), width: w, height: Math.min(d.height ?? doorH(p.fh), p.fh - SLAB - 0.05), sill: 0, from: d.a, to: d.b, exterior: false });
  }

  // ---- exterior openings (declared), then porch/balcony and stairs, then automatic windows
  let nDoor = 0, nWin = 0;
  const extOn = (e: PExt) => {
    const r = p.rooms.find((x) => x.id === e.room && x.floor === e.floor);
    if (!r) { L.warnings.push(`exterior ${e.kind} on ${e.room}: no such room on floor ${e.floor}`); return; }
    const cands = L.walls.map((w, i) => ({ w, i })).filter(({ w }) => w.floor === e.floor && w.exterior && w.side === e.side && (w.neg === r.id || w.pos === r.id));
    if (!cands.length) { L.warnings.push(`exterior ${e.kind} on ${e.room}: its ${e.side} side is not an outside wall`); return; }
    const sn: Vec2 = e.side === 's' ? [0, 1] : e.side === 'n' ? [0, -1] : e.side === 'e' ? [1, 0] : [-1, 0];
    const score = (x: LWall) => (x.out ? x.out[0] * sn[0] + x.out[1] * sn[1] : 0) * 100 + len2(x.a, x.b);
    const { w, i } = cands.reduce((m, c) => (score(c.w) > score(m.w) + 1e-9 ? c : m));
    const door = e.kind === 'door';
    const width = Math.max(0.6, Math.min(6, e.width ?? (door ? EXT_DOOR_W : p.windowStyle.width)));
    const sill = door ? 0 : e.sill ?? p.windowStyle.sill;
    const height = door ? Math.min(e.height ?? doorH(p.fh), p.fh - SLAB - 0.05) : Math.min(e.height ?? p.windowStyle.top - sill, p.fh - SLAB - 0.15 - sill);
    // the room's own span on this wall (exterior runs are extended over corners)
    const [s0, s1] = spanOn(w, r.rect ?? [-p.W / 2, -p.D / 2, p.W / 2, p.D / 2], p);
    const lo = s0 + width / 2 + 0.25, hi = s1 - width / 2 - 0.25;
    const sc = lo > hi ? (s0 + s1) / 2 : lo + (hi - lo) * (e.at ?? 0.5);
    if (s1 - s0 < width + 0.3 || !claim(i, sc - width / 2, sc + width / 2)) { L.warnings.push(`exterior ${e.kind} on ${e.room} (${e.side}): no room on the wall`); return; }
    const id = door ? (e.to === 'balcony' ? (nDoor++, 'balcony-door') : nDoor++ === 0 ? 'front-door' : `door-${nDoor}`) : `window-${++nWin}`;
    L.openings.push({ id, kind: 'door' === e.kind ? 'door' : 'window', floor: e.floor, wall: i, wallId: w.id, s: sc, at: lerp2(w.a, w.b, sc), width, height, sill, exterior: true, ...(door ? { from: r.id, to: e.to ?? 'outside' } : {}) });
  };
  for (const e of p.ext.filter((x) => x.kind === 'door')) extOn(e);
  for (const e of p.ext.filter((x) => x.kind === 'window')) extOn(e);

  // ---- stairs
  for (const s of p.stairs) {
    if (s.to >= p.floors) continue;
    const y0 = floorY(s.from, p.fh), y1 = floorY(s.to, p.fh);
    const [x0, z0, x1, z1] = s.rect;
    const axis = s.axis, dir = s.dir;
    const mid = axis === 'x' ? (z0 + z1) / 2 : (x0 + x1) / 2, lo = axis === 'x' ? x0 : z0, hi = axis === 'x' ? x1 : z1;
    const bottom = dir === 1 ? lo : hi, top = dir === 1 ? hi : lo;
    const pt = (a: number, off = 0): Vec2 => (axis === 'x' ? [a, mid + off] : [mid + off, a]);
    // room bounds along the flight: is there floor beyond each end, or do we step off sideways?
    const rr = rect(s.room, s.from), ir = rr ? innerRect(rr, p) : null;
    const rlo = ir ? (axis === 'x' ? ir[0] : ir[1]) : lo - 1, rhi = ir ? (axis === 'x' ? ir[2] : ir[3]) : hi + 1;
    const room0 = dir === 1 ? bottom - rlo : rhi - bottom, roomTop = dir === 1 ? rhi - top : top - rlo;
    const side = (s.width / 2 + 0.45) * s.away;
    // a sideways step on or off stays >= 0.55 m from the end wall, so a body (0.34 m) fits there
    const approach = room0 >= 0.8 ? pt(bottom - dir * 0.35) : pt(bottom + dir * Math.max(0.3, 0.55 - room0), side);
    const arrive = roomTop >= 0.8 ? pt(top + dir * 0.35) : pt(top - dir * Math.max(0.3, 0.55 - roomTop), side);
    const path = [approach, pt(bottom), pt(top), arrive];
    const sideways = roomTop < 0.8;
    L.stairs.push({ id: s.id, kind: 'straight', from: s.from, to: s.to, room: s.room, width: s.width, risers: s.risers, y0, y1, rect: s.rect, axis, dir, path, hole: rectPolyOf([x0 - 0.02, z0 - 0.02, x1 + 0.02, z1 + 0.02]) });
    // rails round the stairwell on the upper floor, except the arrival end and edges against a wall
    const edges: [Vec2, Vec2, 'lo' | 'hi' | 'side'][] = axis === 'x'
      ? [[[x0, z0], [x1, z0], 'side'], [[x0, z1], [x1, z1], 'side'], [[x0, z0], [x0, z1], 'lo'], [[x1, z0], [x1, z1], 'hi']]
      : [[[x0, z0], [x0, z1], 'side'], [[x1, z0], [x1, z1], 'side'], [[x0, z0], [x1, z0], 'lo'], [[x0, z1], [x1, z1], 'hi']];
    for (const [a0, b0, kind] of edges) {
      let a = a0, b = b0;
      if ((kind === 'hi' && dir === 1) || (kind === 'lo' && dir === -1)) continue;
      if (onWall(L, s.to, a, b)) continue;
      if (kind === 'side' && sideways) {
        // leave the last metre of the room-side rail open: that is where you step off
        const offRoomSide = axis === 'x' ? (a[1] - mid) * s.away > 0 : (a[0] - mid) * s.away > 0;
        if (offRoomSide) { const k = axis === 'x' ? 0 : 1; const cut = top - dir * 1.0; if (dir === 1) { b = [...b] as Vec2; b[k] = cut; } else { a = [...a] as Vec2; a[k] = cut; } }
      }
      if (len2(a, b) > 0.1) L.rails.push({ a, b, y0: y1, y1: y1 + 1.0 });
    }
  }
  for (const s of p.spirals) {
    if (s.to >= p.floors) continue;
    const y0 = floorY(s.from, p.fh), y1 = floorY(s.to, p.fh), n = 16;
    const at = (a: number, r: number): Vec2 => [s.c[0] + r * Math.sin(a), s.c[1] + r * Math.cos(a)];
    const path: Vec2[] = [at(s.a0, s.r - s.width / 2 - 0.35), ...Array.from({ length: n + 1 }, (_, i) => at(s.a0 + (s.sweep * i) / n, s.r)), at(s.a0 + s.sweep, s.r - s.width / 2 - 0.35)];
    const rIn = s.r - s.width / 2 - 0.02;
    L.stairs.push({ id: s.id, kind: 'spiral', from: s.from, to: s.to, room: p.rooms.find((r) => r.floor === s.from)?.id ?? '', width: s.width, risers: s.risers, y0, y1, c: s.c, r: s.r, a0: s.a0, sweep: s.sweep, path, hole: annulus(s.c, rIn, s.r + s.width / 2 + 0.05, 24) });
    // the inner disc of the upper floor gets a rail round its edge, open where the helix arrives
    const disc = ngon(rIn, 6), arrive = s.a0 + s.sweep;
    disc.forEach((a, i) => { const b = disc[(i + 1) % disc.length]; const m = Math.atan2((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); if (Math.abs(angDiff(m, arrive)) < 0.45) return; L.rails.push({ a, b, y0: y1, y1: y1 + 1.0 }); });
  }

  // ---- floors: room polygons minus stairwells
  for (let k = 0; k < p.floors; k++) {
    const y = floorY(k, p.fh), polys: LLevel['polys'] = [];
    const holes = L.stairs.filter((s) => s.to === k);
    for (const r of L.rooms.filter((x) => x.floor === k)) {
      const src = p.rooms.find((x) => x.id === r.id);
      if (src?.rect && !p.round) {
        let parts: Rect[] = [p.open ? src.rect : innerRect(src.rect, p)];
        for (const h of holes) if (h.rect) { const hr: Rect = [h.rect[0] - 0.02, h.rect[1] - 0.02, h.rect[2] + 0.02, h.rect[3] + 0.02]; parts = parts.flatMap((q) => subtract(q, hr)); }
        // a spiral in a square tower: the floor above is the disc inside the helix
        const sp = holes.find((h) => h.kind === 'spiral');
        if (sp) { polys.push({ room: r.id, poly: ngon(sp.r! - sp.width / 2 - 0.02, 12) }); continue; }
        for (const q of parts) polys.push({ room: r.id, poly: rectPolyOf(q) });
      } else {
        const sp = holes.find((h) => h.kind === 'spiral');
        polys.push({ room: r.id, poly: sp ? ngon(sp.r! - sp.width / 2 - 0.02, 12) : r.poly });
      }
    }
    L.levels.push({ floor: k, y, polys });
  }

  // ---- porch and balcony
  const W = p.W, D = p.D;
  if (p.porch && p.porch.depth > 0 && !p.round) {
    const dpt = p.porch.depth;
    L.porch = { poly: rectPolyOf([-W / 2, D / 2, W / 2, D / 2 + dpt]), y: FLOOR0, depth: dpt };
    const n = Math.max(2, Math.ceil(W / 3.2) + 1);
    for (let i = 0; i < n; i++) L.posts.push({ c: [-W / 2 + 0.15 + ((W - 0.3) * i) / (n - 1), D / 2 + dpt - 0.15], r: 0.09, y0: 0, y1: p.fh });
  }
  if (p.balcony && p.balcony.floor < p.floors) {
    const b = p.balcony, y = floorY(b.floor, p.fh);
    if (b.ring && p.round) {
      const r0 = p.round.R + p.t / 2, r1 = r0 + b.depth;
      L.balcony = { floor: b.floor, y, polys: [halfRing(r0, r1, 0), halfRing(r0, r1, Math.PI)], ring: true, r0, r1 };
      const outer = ngon(r1 - 0.05, p.round.sides); outer.forEach((a, i) => L.rails.push({ a, b: outer[(i + 1) % outer.length], y0: y, y1: y + 1.05 }));
    } else {
      const door = L.openings.find((o) => o.id === 'balcony-door');
      const xc = door ? door.at[0] : 0, w = Math.max(1.4, b.width);
      // over a porch the balcony runs the porch's full width and depth (a veranda with a balcony on its roof)
      const over = L.porch && b.floor === 1;
      const r: Rect = over ? [-W / 2 + 0.1, D / 2, W / 2 - 0.1, D / 2 + L.porch!.depth] : [Math.max(-W / 2 + 0.2, xc - w / 2), D / 2, Math.min(W / 2 - 0.2, xc + w / 2), D / 2 + b.depth];
      L.balcony = { floor: b.floor, y, polys: [rectPolyOf(r)], ring: false, rect: r };
      L.rails.push({ a: [r[0], r[1]], b: [r[0], r[3]], y0: y, y1: y + 1.0 }, { a: [r[0], r[3]], b: [r[2], r[3]], y0: y, y1: y + 1.0 }, { a: [r[2], r[3]], b: [r[2], r[1]], y0: y, y1: y + 1.0 });
    }
  }
  if (p.open) {
    // pavilion posts round the edge, every ≤ 3.5 m
    const nx = Math.max(1, Math.ceil(W / 3.5)), nz = Math.max(1, Math.ceil(D / 3.5));
    for (let i = 0; i <= nx; i++) for (const z of [-D / 2 + 0.15, D / 2 - 0.15]) L.posts.push({ c: [-W / 2 + 0.15 + ((W - 0.3) * i) / nx, z], r: 0.12, y0: 0, y1: p.fh });
    for (let j = 1; j < nz; j++) for (const x of [-W / 2 + 0.15, W / 2 - 0.15]) L.posts.push({ c: [x, -D / 2 + 0.15 + ((D - 0.3) * j) / nz], r: 0.12, y0: 0, y1: p.fh });
  }

  // ---- automatic windows on exterior walls, clear of doors and stairs
  if (p.autoWindows) {
    const ws = p.windowStyle;
    L.walls.forEach((w, i) => {
      if (!w.exterior) return;
      const total = len2(w.a, w.b);
      const blocked: [number, number][] = [...(used.get(i) ?? []).map(([a, b]) => [a - 0.35, b + 0.35] as [number, number])];
      if (w.axis === 'x') { if (Math.abs(w.a[0] - w.b[0]) > 0) { blocked.push([-1e9, Math.min(w.a[0], w.b[0]) < -W / 2 + 0.01 ? p.t / 2 + 0.3 : 0.25]); blocked.push([total - (Math.max(w.a[0], w.b[0]) > W / 2 - 0.01 ? p.t / 2 + 0.3 : 0.25), 1e9]); } }
      else if (w.axis === 'z') { blocked.push([-1e9, 0.3]); blocked.push([total - 0.3, 1e9]); }
      // stairs running along this wall on this floor (flight) or arriving through it (stairwell)
      for (const s of L.stairs) {
        if (!s.rect || (s.from !== w.floor && s.to !== w.floor)) continue;
        const d = distRectToWall(s.rect, w);
        if (d > 0.4) continue;
        const along = w.axis === 'x' ? [s.rect[0], s.rect[2]] : [s.rect[1], s.rect[3]];
        const a = sOf(w, along[0]), b = sOf(w, along[1]);
        blocked.push([Math.min(a, b) - 0.2, Math.max(a, b) + 0.2]);
      }
      if (L.porch && w.side === 's' && w.floor === 0) { /* porch roof covers the ground floor front: windows still fine */ }
      const free = freeIntervals(0, total, blocked);
      const fullLen = free.reduce((m, [a, b]) => m + b - a, 0);
      let n = Math.round(fullLen / ws.spacing);
      if (n === 0 && fullLen >= ws.width + 0.8 && ws.spacing < 6) n = 1;
      const lantern = p.rooms.find((r) => r.floor === w.floor && (r.id === w.neg || r.id === w.pos))?.kind === 'lantern';
      let width = ws.width, sill = ws.sill, top = Math.min(ws.top, p.fh - SLAB - 0.15);
      if (p.round) {
        const step = ws.spacing <= 2.4 ? 2 : ws.spacing <= 5 ? 4 : 8, chord = i % p.round.sides;
        n = (chord + w.floor) % step === 0 && fullLen >= width + 0.3 ? 1 : 0;
        if (lantern) { n = 1; width = Math.max(0.6, total - p.t - 0.25); sill = 0.85; top = p.fh - SLAB - 0.1; }
      }
      const slots = lantern ? [total / 2] : allocate(free, n, width + 0.5);
      const height = top - sill;
      for (const sc of slots) {
        if (!claim(i, sc - width / 2, sc + width / 2)) continue;
        L.openings.push({ id: `window-${++nWin}`, kind: 'window', floor: w.floor, wall: i, wallId: w.id, s: sc, at: lerp2(w.a, w.b, sc), width, height, sill, exterior: true });
      }
    });
  }
  if (p.open) for (const side of ['s', 'n', 'e', 'w'] as Side[]) {
    const o: Vec2 = side === 's' ? [0, D / 2] : side === 'n' ? [0, -D / 2] : side === 'e' ? [W / 2, 0] : [-W / 2, 0];
    L.openings.push({ id: `open-${side}`, kind: 'arch', floor: 0, wall: -1, wallId: '', s: 0, at: o, width: side === 's' || side === 'n' ? W - 0.4 : D - 0.4, height: p.fh - 0.3, sill: 0, from: L.rooms[0]?.id, to: 'outside', exterior: true });
  }
  return L;
}

function sideOf(n: Vec2): Side { return Math.abs(n[1]) >= Math.abs(n[0]) ? (n[1] > 0 ? 's' : 'n') : n[0] > 0 ? 'e' : 'w'; }
const angDiff = (a: number, b: number) => { let d = (a - b) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; };
/** Distance along a wall from its a-end to the foot of a coordinate on the wall's axis. */
function sOf(w: LWall, coord: number) { return w.axis === 'x' ? (w.b[0] >= w.a[0] ? coord - w.a[0] : w.a[0] - coord) : (w.b[1] >= w.a[1] ? coord - w.a[1] : w.a[1] - coord); }
/**
 * A door is walked through from both sides: keep it off a flight of stairs (on the floor it starts from) or a stairwell
 * (on the floor it arrives at) that runs along its wall closer than a body's width (0.85 m) — slide it along the wall to the
 * nearest clear spot, else leave it where it was asked for.
 */
function stairClear(p: Plan, floor: number, e: { axis: 'x' | 'z'; c: number }, w: number, lo: number, hi: number, want: number): number {
  const bad: [number, number][] = [];
  for (const st of p.stairs) {
    if (st.from !== floor && st.to !== floor) continue;
    const [x0, z0, x1, z1] = st.rect, [a0, a1, b0, b1] = e.axis === 'x' ? [x0, x1, z0, z1] : [z0, z1, x0, x1];
    if (Math.max(b0 - e.c, e.c - b1, 0) >= 0.85) continue;
    bad.push([a0 - w / 2 - 0.45, a1 + w / 2 + 0.45]);
  }
  const ok = (x: number) => !bad.some(([u, v]) => x > u && x < v);
  if (!bad.length || ok(want) || lo > hi) return want;
  for (let k = 1; k <= 400; k++) for (const x of [want - k * 0.05, want + k * 0.05]) if (x >= lo - 1e-9 && x <= hi + 1e-9 && ok(x)) return x;
  return want;
}
function sharedEdge(a: Rect, b: Rect): { axis: 'x' | 'z'; c: number; s0: number; s1: number } | null {
  const near = (u: number, v: number) => Math.abs(u - v) < 1e-4;
  if (near(a[2], b[0]) || near(a[0], b[2])) { const c = near(a[2], b[0]) ? a[2] : a[0]; const s0 = Math.max(a[1], b[1]), s1 = Math.min(a[3], b[3]); return s1 > s0 ? { axis: 'z', c, s0, s1 } : null; }
  if (near(a[3], b[1]) || near(a[1], b[3])) { const c = near(a[3], b[1]) ? a[3] : a[1]; const s0 = Math.max(a[0], b[0]), s1 = Math.min(a[2], b[2]); return s1 > s0 ? { axis: 'x', c, s0, s1 } : null; }
  return null;
}
/** The room's interval on a wall, in the wall's s coordinate, inset to the room's inner faces. */
function spanOn(w: LWall, r: Rect, p: Plan): [number, number] {
  if (w.axis === 'r') { const total = len2(w.a, w.b); return [p.t / 2, total - p.t / 2]; }
  const ir = innerRect(r, p);
  const [c0, c1] = w.axis === 'x' ? [ir[0], ir[2]] : [ir[1], ir[3]];
  const total = len2(w.a, w.b);
  const a = Math.max(0, Math.min(sOf(w, c0), sOf(w, c1))), b = Math.min(total, Math.max(sOf(w, c0), sOf(w, c1)));
  return [a, b];
}
function onWall(L: Layout, floor: number, a: Vec2, b: Vec2): boolean {
  const m: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  return L.walls.some((w) => w.floor === floor && w.axis !== 'r' && distPointSeg(m, w.a, w.b) < w.thick / 2 + 0.05 && Math.abs((b[0] - a[0]) * (w.b[1] - w.a[1]) - (b[1] - a[1]) * (w.b[0] - w.a[0])) < 1e-6);
}
function distPointSeg(p: Vec2, a: Vec2, b: Vec2) { const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz); }
function distRectToWall(r: Rect, w: LWall) {
  if (w.axis === 'x') { const z = w.a[1]; return Math.min(Math.abs(r[1] - z), Math.abs(r[3] - z)) - w.thick / 2; }
  if (w.axis === 'z') { const x = w.a[0]; return Math.min(Math.abs(r[0] - x), Math.abs(r[2] - x)) - w.thick / 2; }
  return 9;
}
function freeIntervals(lo: number, hi: number, blocked: [number, number][]): [number, number][] {
  let free: [number, number][] = [[lo, hi]];
  for (const [a, b] of blocked) free = free.flatMap(([u, v]) => (b <= u || a >= v ? [[u, v]] : [[u, Math.max(u, a)], [Math.min(v, b), v]].filter(([x, y]) => y - x > 0.01)) as [number, number][]);
  return free;
}
/** Place n centres in free intervals, each needing `need` metres, spread by length. */
function allocate(free: [number, number][], n: number, need: number): number[] {
  const usable = free.filter(([a, b]) => b - a >= need);
  if (!usable.length || n <= 0) return [];
  const total = usable.reduce((m, [a, b]) => m + b - a, 0);
  const out: number[] = [];
  let left = n;
  usable.forEach(([a, b], i) => {
    let k = i === usable.length - 1 ? left : Math.round((n * (b - a)) / total);
    k = Math.min(k, Math.floor((b - a) / need), left);
    for (let j = 0; j < k; j++) out.push(a + ((b - a) * (j + 0.5)) / k);
    left -= k;
  });
  return out;
}
function annulus(c: Vec2, r0: number, r1: number, n: number): Vec2[] {
  const outer = Array.from({ length: n + 1 }, (_, i) => { const a = (i / n) * 2 * Math.PI; return [c[0] + r1 * Math.sin(a), c[1] + r1 * Math.cos(a)] as Vec2; });
  const inner = Array.from({ length: n + 1 }, (_, i) => { const a = ((n - i) / n) * 2 * Math.PI; return [c[0] + r0 * Math.sin(a), c[1] + r0 * Math.cos(a)] as Vec2; });
  return [...outer, ...inner];
}
function halfRing(r0: number, r1: number, start: number): Vec2[] {
  const n = 8, pts: Vec2[] = [];
  for (let i = 0; i <= n; i++) { const a = start + (Math.PI * i) / n; pts.push([r1 * Math.sin(a), r1 * Math.cos(a)]); }
  for (let i = n; i >= 0; i--) { const a = start + (Math.PI * i) / n; pts.push([r0 * Math.sin(a), r0 * Math.cos(a)]); }
  return pts;
}

// ---------------------------------------------------------------- architecture checks (pure)

export type Violation = { code: 'room.unreachable' | 'building.no-entrance' | 'headroom' | 'stairs.headroom' | 'stairs.blocked' | 'stairs.outside-room' | 'stairs.narrow' | 'stairs.steep' | 'door.small'; detail: string };
export type Checks = { ok: boolean; notes: string[]; violations: Violation[]; reachable: string[]; unreachable: string[]; minHeadroom: number; stairHeadroom: number | null };

/**
 * Every room reachable from an exterior door through doors and stairs; headroom ≥ 2.0 m in rooms, under
 * stairs and through doors; stairs clear (width, riser, going), inside their room, landing in rooms.
 */
export function architectureChecks(L: Layout): Checks {
  const v: Violation[] = [];
  const key = (floor: number, id: string) => `${floor}:${id}`;
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => { (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b); (adj.get(b) ?? adj.set(b, new Set()).get(b)!).add(a); };
  const roomAt = (floor: number, pt: Vec2) => L.rooms.find((r) => r.floor === floor && pointInPoly(pt[0], pt[1], r.poly));
  for (const o of L.openings) {
    if (o.kind === 'window' || !o.from || !o.to) continue;
    const a = key(o.floor, o.from);
    const b = o.to === 'outside' || o.to === 'porch' ? 'outside' : o.to === 'balcony' ? 'balcony' : key(o.floor, o.to);
    link(a, b);
    if (o.kind === 'door' && (o.width < 0.75 || o.height < 2.0)) v.push({ code: 'door.small', detail: `${o.id} is ${o.width.toFixed(2)} × ${o.height.toFixed(2)} m (needs ≥ 0.75 × 2.0)` });
  }
  if (L.open) for (const r of L.rooms) link(key(r.floor, r.id), 'outside');
  if (!L.openings.some((o) => o.exterior && o.kind !== 'window' && (o.to === 'outside' || o.to === 'porch'))) v.push({ code: 'building.no-entrance', detail: 'no door to the outside' });
  let stairHeadroom: number | null = null;
  for (const s of L.stairs) {
    const a = s.path[0], b = s.path[s.path.length - 1];
    const ra = roomAt(s.from, a), rb = roomAt(s.to, b);
    if (!ra) v.push({ code: 'stairs.blocked', detail: `${s.id}: the foot of the stairs (floor ${s.from}) is not in a room` });
    if (!rb) v.push({ code: 'stairs.blocked', detail: `${s.id}: the head of the stairs (floor ${s.to}) is not in a room` });
    if (ra && rb) link(key(s.from, ra.id), key(s.to, rb.id));
    if (s.width < 0.75) v.push({ code: 'stairs.narrow', detail: `${s.id} is ${s.width.toFixed(2)} m wide (needs ≥ 0.75)` });
    const rise = (s.y1 - s.y0) / s.risers;
    const going = s.rect ? (s.axis === 'x' ? s.rect[2] - s.rect[0] : s.rect[3] - s.rect[1]) / Math.max(1, s.risers - 1) : (s.r! * s.sweep!) / Math.max(1, s.risers - 1);
    if (rise > 0.22 || going < 0.2 - 1e-6) v.push({ code: 'stairs.steep', detail: `${s.id}: risers ${rise.toFixed(3)} m (≤ 0.22), going ${going.toFixed(3)} m (≥ 0.2)` });
    if (s.rect) {
      const room = L.rooms.find((r) => r.floor === s.from && r.id === s.room);
      const [x0, z0, x1, z1] = s.rect, inset = 0.03;
      const corners: Vec2[] = [[x0 + inset, z0 + inset], [x1 - inset, z0 + inset], [x1 - inset, z1 - inset], [x0 + inset, z1 - inset]];
      if (!room || corners.some((c) => !pointInPoly(c[0], c[1], room.poly))) v.push({ code: 'stairs.outside-room', detail: `${s.id} runs through a wall of ${s.room}` });
    }
    // headroom along the walk line: the lowest floor slab above each point
    const n = 10;
    for (let i = 1; i < n; i++) {
      const f = i / n;
      const pt: Vec2 = s.kind === 'spiral' ? [s.c![0] + s.r! * Math.sin(s.a0! + s.sweep! * f), s.c![1] + s.r! * Math.cos(s.a0! + s.sweep! * f)] : [s.path[1][0] + (s.path[2][0] - s.path[1][0]) * f, s.path[1][1] + (s.path[2][1] - s.path[1][1]) * f];
      const h = s.y0 + (s.y1 - s.y0) * f;
      let ceiling = L.wallTop;
      for (const lv of L.levels) if (lv.y > h + 0.05 && lv.polys.some((q) => pointInPoly(pt[0], pt[1], q.poly))) { ceiling = Math.min(ceiling, lv.y - SLAB); }
      // the next turn of a helix overhead
      if (s.kind === 'spiral') ceiling = Math.min(ceiling, h + (s.y1 - s.y0) * ((2 * Math.PI) / s.sweep!) - 0.2);
      const head = ceiling - h;
      stairHeadroom = stairHeadroom === null ? head : Math.min(stairHeadroom, head);
    }
    if (stairHeadroom !== null && stairHeadroom < 2.0 - 1e-6) v.push({ code: 'stairs.headroom', detail: `${s.id}: ${stairHeadroom.toFixed(2)} m over the stairs (needs ≥ 2.0)` });
  }
  const minHeadroom = L.fh - SLAB;
  if (minHeadroom < 2.0) v.push({ code: 'headroom', detail: `rooms have ${minHeadroom.toFixed(2)} m (needs ≥ 2.0)` });
  // reachability from outside
  const seen = reachableFromOutside([...adj].flatMap(([a, bs]) => [...bs].map(b => [a, b] as const)));
  const reachable: string[] = [], unreachable: string[] = [];
  for (const r of L.rooms) (seen.has(key(r.floor, r.id)) ? reachable : unreachable).push(r.id);
  for (const id of unreachable) { const r = L.rooms.find((x) => x.id === id)!; v.push({ code: 'room.unreachable', detail: `${id} (floor ${r.floor}) cannot be reached from a door to the outside` }); }
  const byFloor = Array.from({ length: L.floors }, (_, k) => L.rooms.filter((r) => r.floor === k).map((r) => `${r.id} ${polyArea(r.poly).toFixed(1)} m²`).join(', '));
  const doors = L.openings.filter((o) => o.kind === 'door'), wins = L.openings.filter((o) => o.kind === 'window');
  const notes = [
    `rooms: ${byFloor.map((s, k) => `floor ${k}: ${s || '—'}`).join('; ')}`,
    `doors: ${doors.filter((d) => d.exterior).length} outside (${doors.filter((d) => d.exterior).map((d) => d.id).join(', ')}), ${doors.filter((d) => !d.exterior).length} inside; windows: ${wins.length}`,
    ...L.stairs.map((s) => `stairs ${s.id}: floor ${s.from}→${s.to} in ${s.room}, ${s.kind}, ${s.risers} risers of ${((s.y1 - s.y0) / s.risers).toFixed(3)} m, ${s.width.toFixed(2)} m wide`),
    `reachable from outside: ${unreachable.length ? `${reachable.length}/${L.rooms.length} rooms` : `all ${L.rooms.length} rooms`}`,
    `headroom: rooms ${minHeadroom.toFixed(2)} m${stairHeadroom !== null ? `, stairs ≥ ${stairHeadroom.toFixed(2)} m` : ''}`,
    ...L.warnings.map((w) => `warning: ${w}`),
    ...v.map((x) => `violation: ${x.code}: ${x.detail}`),
  ];
  return { ok: v.length === 0, notes, violations: v, reachable, unreachable, minHeadroom, stairHeadroom };
}
