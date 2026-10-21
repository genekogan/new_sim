// building/1 floor plans. Owner: L2 (buildings). Spec <eden4>/29 WP2.
// A plan is drawn in the CANONICAL frame: the front (main door) faces +z, x runs across the
// facade, the back wall is at -z. Room rects are on wall CENTRELINES. `building-layout.ts`
// turns a plan into walls, openings, stairs, floors and slots and rotates it to `front`.
import type { Vec2 } from './types.ts';

export type Side = 's' | 'n' | 'e' | 'w';
/** [x0, z0, x1, z1] on wall centrelines, canonical frame. */
export type Rect = [number, number, number, number];
export type PRoom = { id: string; name: string; floor: number; kind: string; rect?: Rect; poly?: Vec2[] };
export type PDoor = { floor: number; a: string; b: string; at?: number; width?: number; height?: number };
export type PExt = { floor: number; room: string; side: Side; at?: number; kind: 'door' | 'window'; width?: number; height?: number; sill?: number; to?: 'outside' | 'balcony' | 'porch' };
/** A straight flight in a band along a wall: `rect` is the flight's footprint, it rises along `axis` in direction `dir`. */
export type PStair = { id: string; from: number; to: number; room: string; rect: Rect; axis: 'x' | 'z'; dir: 1 | -1; width: number; risers: number; going: number; /** Sign of the room side across the band (away from its wall). */ away: 1 | -1;
  /** A flight narrowed to keep its corridor (bandWidth): the full-width band it replaces. Doors are placed round this one, so
   *  narrowing a flight never moves a door (furniture stored beside a door stays clear of it). */ band?: Rect };
/** A helix along the inside of a round (or square) tower wall: centre, mid radius, start angle (rad, 0 = +z, ccw seen from above toward +x), sweep. */
export type PSpiral = { id: string; from: number; to: number; c: Vec2; r: number; width: number; a0: number; sweep: number; risers: number };
export type Plan = {
  W: number; D: number; t: number; ti: number; fh: number; floors: number;
  rooms: PRoom[]; doors: PDoor[]; ext: PExt[]; stairs: PStair[]; spirals: PSpiral[];
  /** Round tower: wall polygon of `sides` chords at centreline radius R about the origin. */
  round?: { R: number; sides: number };
  /** Open-sided (pavilion): no walls, posts only. */
  open?: boolean;
  /** Windows are placed automatically by density on exterior walls (except where the plan lists its own). */
  autoWindows: boolean;
  windowStyle: { sill: number; top: number; width: number; spacing: number };
  balcony?: { floor: number; room: string; width: number; depth: number; ring?: boolean };
  porch?: { depth: number };
  warnings: string[];
};

export const SLAB = 0.18;          // floor slab thickness between storeys (m)
export const FLOOR0 = 0.1;         // ground floor surface above the entity base (m)
export const STAIR_W = 0.95;       // straight stair clear width (m)
export const GOING = 0.25;         // tread going (m)
export const MAX_RISE = 0.2;       // riser height limit (m)
export const TI = 0.12;            // interior wall thickness (m)

export const floorY = (k: number, fh: number) => k * fh + FLOOR0;
/** Landing/hall width beyond the flights (m). 1.0 left 0.83 m clear beside a flight (walls and rails take the rest), which
 *  a 0.68 m walker (radius .28 + margin .06) loses at some yaws on the 0.1 m walk raster. A def opts into the 1.2 m
 *  layout with make.args.corridor (nav-connect/1, 2026-10-20): stored defs keep 1.0, so a building never changes shape. */
export const corridorOf = (args: Record<string, unknown>) => { const v = Number(args.corridor); return Number.isFinite(v) ? Math.max(1.0, Math.min(2.0, v)) : 1.0; };
/**
 * Flight width for a stair strip `avail` m deep (from the wall the bands start at) holding `bands` flights side by side and a
 * corridor of `corr` beside them (upper-walk/1, lane t4-upper 2026-10-21). A strip the plan had to clamp (a narrow
 * townhouse's hall: rooms keep their 2.4 m) used to keep full 0.95 m flights and leave the corridor short: Eden 2026's
 * 5.2 m canal townhouses had 0.51 m clear beside the upper flight, so no one could walk from the stair top to the bedroom
 * doors. The flights narrow instead (down to MIN_STAIR_W) so the corridor keeps its width. An unclamped strip is unchanged.
 */
export const MIN_STAIR_W = 0.75; // the compiler's stairs.narrow floor
export function bandWidth(avail: number, bands: number, corr: number): number {
  if (avail >= bands * STAIR_W + corr - 1e-6) return STAIR_W;
  return Math.max(MIN_STAIR_W, Math.min(STAIR_W, (avail - corr) / bands));
}
export function stairGeometry(fh: number) { const risers = Math.ceil(fh / MAX_RISE - 1e-9); return { risers, run: (risers - 1) * GOING }; }

class Ids { private used = new Set<string>(); take(base: string): string { let id = base, k = 2; while (this.used.has(id)) id = `${base}-${k++}`; this.used.add(id); return id; } }
const title = (id: string) => id.replace(/-(\d+)$/, ' $1').replace(/^./, (c) => c.toUpperCase());

type Ctx = { W: number; D: number; t: number; fh: number; floors: number; style: string; balcony: boolean; porch: number; density: number; args: Record<string, unknown> };

/** Canonical extents of the wall centrelines. */
function extents(c: Ctx) { return { X0: -c.W / 2 + c.t / 2, X1: c.W / 2 - c.t / 2, Z0: -c.D / 2 + c.t / 2, Z1: c.D / 2 - c.t / 2 }; }

function base(c: Ctx): Plan {
  return { W: c.W, D: c.D, t: c.t, ti: TI, fh: c.fh, floors: c.floors, rooms: [], doors: [], ext: [], stairs: [], spirals: [], autoWindows: c.density > 0,
    windowStyle: { sill: 0.9, top: Math.min(2.15, c.fh - 0.4), width: 1.0, spacing: 2.0 / Math.max(0.05, c.density) }, warnings: [], ...(c.porch > 0 ? { porch: { depth: c.porch } } : {}) };
}

/**
 * Stairs stacked in bands along the back wall (axis x) or the west wall (axis z) of a "service strip".
 * Flight k uses band k % 2 and alternates direction (a switchback), so every floor is reachable.
 * Returns the flights and how deep the strip must be.
 */
function bandStairs(c: Ctx, axis: 'x' | 'z', lo: number, hi: number, wallInner: number, rooms: (k: number) => string, ids: Ids, plan: Plan, width = STAIR_W): PStair[] {
  const { risers, run: run0 } = stairGeometry(c.fh);
  const out: PStair[] = [];
  const span = hi - lo;
  // compact houses: shorten the going (down to 0.2 m) before giving up the landings
  const going = Math.max(0.2, Math.min(GOING, (span - 0.5) / (risers - 1)));
  const run = going * (risers - 1), m = span - run;
  if (going < GOING - 1e-9) plan.warnings.push(`stairs: steep going ${going.toFixed(2)} m to fit ${span.toFixed(2)} m`);
  // margins at the two ends: arrive onto ≥ 1 m of landing, approach the bottom over ≥ 0.6 m; switchbacks split evenly
  if (m < 1.6) plan.warnings.push(`stairs: ${span.toFixed(2)} m along the wall for a ${run.toFixed(2)} m flight; landings are tight`);
  const atTop = c.floors > 2 ? Math.max(0, m / 2) : Math.min(1.0, Math.max(0, m - 0.6)), atBottom = Math.max(0, m - atTop);
  // band 0 rises toward +x (axis x) or toward the back, -z (axis z)
  const rise0: 1 | -1 = axis === 'x' ? 1 : -1;
  const s0 = lo + (rise0 === 1 ? atBottom : atTop), s1 = s0 + run;
  for (let k = 0; k < c.floors - 1; k++) {
    const band = k % 2, b0 = wallInner + band * width, b1 = b0 + width;
    const dir = (band === 0 ? rise0 : -rise0) as 1 | -1;
    const rect: Rect = axis === 'x' ? [s0, b0, s1, b1] : [b0, s0, b1, s1];
    const n0 = wallInner + band * STAIR_W, n1 = n0 + STAIR_W, band0: Rect = axis === 'x' ? [s0, n0, s1, n1] : [n0, s0, n1, s1];
    out.push({ id: ids.take('stairs'), from: k, to: k + 1, room: rooms(k), rect, axis, dir, width, risers, going, away: 1, ...(width < STAIR_W ? { band: band0 } : {}) });
  }
  return out;
}

/** Split [a, b] into n near-equal parts (cuts). */
const cuts = (a: number, b: number, n: number) => Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);

// ---------------------------------------------------------------- per-style auto plans

function cottagePlan(c: Ctx): Plan {
  const p = base(c), ids = new Ids(), { X0, X1, Z0, Z1 } = extents(c);
  const Wc = X1 - X0, Dc = Z1 - Z0, zMid = (Z0 + Z1) / 2;
  const column = Wc >= 5.2, colW = Math.min(4, Math.max(2.4, 0.3 * Wc)), xK = X0 + colW;
  const living = ids.take('living');
  if (column) {
    const kitchen = ids.take('kitchen');
    p.rooms.push({ id: living, name: 'Living room', floor: 0, kind: 'living', rect: [xK, Z0, X1, Z1] });
    if (Dc >= 4.4) {
      const back = ids.take(c.floors === 1 ? 'bedroom' : 'bath');
      p.rooms.push({ id: kitchen, name: 'Kitchen', floor: 0, kind: 'kitchen', rect: [X0, zMid, xK, Z1] });
      p.rooms.push({ id: back, name: c.floors === 1 ? 'Bedroom' : 'Bathroom', floor: 0, kind: c.floors === 1 ? 'bedroom' : 'bath', rect: [X0, Z0, xK, zMid] });
      p.doors.push({ floor: 0, a: back, b: living });
    } else p.rooms.push({ id: kitchen, name: 'Kitchen', floor: 0, kind: 'kitchen', rect: [X0, Z0, xK, Z1] });
    p.doors.push({ floor: 0, a: kitchen, b: living });
  } else {
    p.rooms.push({ id: living, name: 'Living room', floor: 0, kind: 'living', rect: [X0, Z0, X1, Z1] });
  }
  p.ext.push({ floor: 0, room: living, side: 's', kind: 'door', to: c.porch > 0 ? 'porch' : 'outside' });
  if (c.floors > 1) upperFloors(c, p, ids, column ? xK + TI / 2 : X0 + c.t / 2, living);
  return p;
}

/** Upper floors of houses: a landing strip along the back (holding the switchback flights), rooms in front. */
function upperFloors(c: Ctx, p: Plan, ids: Ids, stairLo: number, groundStairRoom: string, roomKinds: string[] = ['bedroom', 'bedroom', 'bath']) {
  const { X0, X1, Z0, Z1 } = extents(c), Wc = X1 - X0;
  const inner = Z0 + c.t / 2;
  const landingIds: string[] = [];
  const bands = c.floors > 2 ? 2 : 1, strip = bands * STAIR_W + corridorOf(c.args);
  const zL = Math.min(Z1 - 2.2, inner + strip), width = bandWidth(zL - inner, bands, corridorOf(c.args));
  for (let k = 1; k < c.floors; k++) {
    const landing = ids.take('landing'); landingIds[k] = landing;
    p.rooms.push({ id: landing, name: k === 1 ? 'Landing' : `Landing ${k}`, floor: k, kind: 'landing', rect: [X0, Z0, X1, zL] });
    const n = Wc >= 10 ? 3 : Wc >= 7 ? 2 : 1;
    const xs = cuts(X0, X1, n);
    for (let i = 0; i < n; i++) {
      const kind = roomKinds[Math.min(i, roomKinds.length - 1)] ?? 'bedroom';
      const id = ids.take(kind);
      p.rooms.push({ id, name: title(id).replace('Bath', 'Bathroom'), floor: k, kind, rect: [xs[i], zL, xs[i + 1], Z1] });
      p.doors.push({ floor: k, a: id, b: landing });
      if (k === 1 && i === 0 && c.balcony) p.balcony = { floor: 1, room: id, width: Math.min(3.2, xs[1] - xs[0] - 0.4), depth: 1.2 };
    }
  }
  p.stairs = bandStairs(c, 'x', stairLo, X1 - c.t / 2, inner, (k) => (k === 0 ? groundStairRoom : landingIds[k]), ids, p, width);
  if (p.balcony) p.ext.push({ floor: 1, room: p.balcony.room, side: 's', kind: 'door', to: 'balcony' });
}

function townhousePlan(c: Ctx, shop = false): Plan {
  const p = base(c), ids = new Ids(), { X0, X1, Z0, Z1 } = extents(c);
  if (shop) {
    // ground: the shop across the front, a storeroom behind; flats above share the cottage's upper floors
    const zS = Z1 - Math.max(3, (Z1 - Z0) * 0.58);
    const shopId = ids.take('shop'), store = ids.take('storeroom');
    p.rooms.push({ id: shopId, name: 'Shop', floor: 0, kind: 'shop', rect: [X0, zS, X1, Z1] }, { id: store, name: 'Storeroom', floor: 0, kind: 'store', rect: [X0, Z0, X1, zS] });
    p.doors.push({ floor: 0, a: shopId, b: store, at: 0.25 });
    const door = 1.2, shopWindow = Math.min(4.5, (X1 - X0) / 2 - door / 2 - 0.8);
    p.ext.push({ floor: 0, room: shopId, side: 's', kind: 'door', at: 0.5, width: door });
    if (shopWindow >= 1.2) for (const at of [0, 1]) p.ext.push({ floor: 0, room: shopId, side: 's', kind: 'window', at, width: shopWindow, sill: 0.45, height: Math.min(2.3, c.fh - 0.35) - 0.45 });
    if (c.floors > 1) {
      // stairs at the back of the storeroom; the band must stay clear of the shop door's line
      if (Z1 - zS < 3) p.warnings.push('shop: shallow shop room');
      upperFloors(c, p, ids, X0 + c.t / 2, store, ['bedroom', 'living', 'bath']);
    }
    return p;
  }
  // townhouse: a hall down the west side with the stairs along the west wall; rooms to the east
  const bands = c.floors > 2 ? 2 : 1, hw = bands * STAIR_W + corridorOf(c.args), xh = Math.min(X0 + hw, X1 - 2.4), innerW = X0 + c.t / 2;
  const width = bandWidth(xh - X0, bands, corridorOf(c.args));
  const zSplit = (Z0 + Z1) / 2;
  const halls: string[] = [];
  for (let k = 0; k < c.floors; k++) {
    const hall = ids.take(k === 0 ? 'hall' : 'landing'); halls[k] = hall;
    p.rooms.push({ id: hall, name: k === 0 ? 'Hall' : k === 1 ? 'Landing' : `Landing ${k}`, floor: k, kind: k === 0 ? 'hall' : 'landing', rect: [X0, Z0, xh, Z1] });
    const [front, back] = k === 0 ? ['parlour', 'kitchen'] : ['bedroom', k === 1 ? 'bath' : 'bedroom'];
    const f = ids.take(front), b = ids.take(back);
    p.rooms.push({ id: f, name: title(f).replace('Bath', 'Bathroom'), floor: k, kind: front, rect: [xh, zSplit, X1, Z1] }, { id: b, name: title(b).replace('Bath', 'Bathroom'), floor: k, kind: back, rect: [xh, Z0, X1, zSplit] });
    p.doors.push({ floor: k, a: f, b: hall }, { floor: k, a: b, b: hall });
    if (k === 1 && c.balcony) p.balcony = { floor: 1, room: f, width: Math.min(3, X1 - xh - 0.6), depth: 1.1 };
  }
  p.ext.push({ floor: 0, room: halls[0], side: 's', kind: 'door', to: c.porch > 0 ? 'porch' : 'outside' });
  if (p.balcony) p.ext.push({ floor: 1, room: p.balcony.room, side: 's', kind: 'door', to: 'balcony' });
  // flights along the west wall, rising toward the back; arrive at the back, landing 1 m before the back wall
  p.stairs = bandStairs(c, 'z', Z0 + c.t / 2, Z1 - c.t / 2 - 1.2, innerW, (k) => halls[k], ids, p, width);
  return p;
}

/** One big room per floor (hall, chapel, barn, shed, greenhouse) with optional back rooms. */
function hallPlan(c: Ctx): Plan {
  const p = base(c), ids = new Ids(), { X0, X1, Z0, Z1 } = extents(c);
  const main = ({ hall: 'hall', chapel: 'nave', barn: 'barn', shed: 'shed', greenhouse: 'greenhouse' } as Record<string, string>)[c.style] ?? 'hall';
  const mainId = ids.take(main);
  const backDepth = c.style === 'chapel' && Z1 - Z0 >= 11 ? 2.6 : c.style === 'hall' && Z1 - Z0 >= 12 ? 3.2 : 0;
  const zB = Z0 + backDepth;
  p.rooms.push({ id: mainId, name: title(main), floor: 0, kind: main, rect: [X0, zB, X1, Z1] });
  if (backDepth) {
    const back = ids.take(c.style === 'chapel' ? 'vestry' : 'kitchen');
    p.rooms.push({ id: back, name: title(back), floor: 0, kind: back, rect: [X0, Z0, X1, zB] });
    p.doors.push({ floor: 0, a: back, b: mainId, at: 0.8 });
  }
  const big = c.style === 'barn' ? Math.min(3.4, (X1 - X0) * 0.42) : c.style === 'chapel' || c.style === 'hall' ? 1.6 : 1.0;
  p.ext.push({ floor: 0, room: mainId, side: 's', kind: 'door', width: big, height: c.style === 'barn' ? Math.min(3.4, c.fh - 0.4) : c.style === 'chapel' ? Math.min(2.8, c.fh - 0.23) : 2.1, to: c.porch > 0 ? 'porch' : 'outside' });
  if (c.style === 'chapel') p.windowStyle = { sill: 1.1, top: Math.min(c.fh - 0.5, 3.6), width: 0.9, spacing: 2.4 / Math.max(0.05, c.density) };
  if (c.style === 'barn') p.windowStyle = { sill: 1.6, top: Math.min(c.fh - 0.5, 2.4), width: 0.8, spacing: 3.2 / Math.max(0.05, c.density) };
  if (c.style === 'greenhouse') { p.windowStyle = { sill: 0.55, top: c.fh - 0.25, width: 1.3, spacing: 1.5 }; p.autoWindows = true; }
  // upper floors: one room each (loft, gallery), stairs along the back wall of the main room
  const tops: string[] = [mainId];
  for (let k = 1; k < c.floors; k++) {
    const id = ids.take(c.style === 'barn' ? 'loft' : 'gallery'); tops[k] = id;
    p.rooms.push({ id, name: title(id), floor: k, kind: c.style === 'barn' ? 'loft' : 'gallery', rect: [X0, Z0, X1, Z1] });
  }
  if (c.floors > 1) p.stairs = bandStairs(c, 'x', X0 + c.t / 2, X1 - c.t / 2, (backDepth ? zB + TI / 2 : Z0 + c.t / 2), (k) => tops[k], ids, p);
  return p;
}

function pavilionPlan(c: Ctx): Plan {
  const p = base(c), { X0, X1, Z0, Z1 } = extents(c);
  p.open = true; p.autoWindows = false;
  p.rooms.push({ id: 'pavilion', name: 'Pavilion', floor: 0, kind: 'pavilion', rect: [X0, Z0, X1, Z1] });
  if (c.floors > 1) p.warnings.push('pavilion: one open floor (floors ignored)');
  p.floors = 1;
  return p;
}

function towerPlan(c: Ctx): Plan {
  const p = base(c), ids = new Ids();
  const round = c.args.round !== false;
  const R = Math.min(c.W, c.D) / 2 - c.t / 2;
  const sides = round ? 12 : 4;
  p.W = p.D = Math.min(c.W, c.D);
  if (round) p.round = { R, sides };
  const lantern = !!c.args.lantern, home = !!c.args.home;   // home: a round cottage (living room, bedroom upstairs)
  for (let k = 0; k < c.floors; k++) {
    const top = k === c.floors - 1;
    const kind = k === 0 ? (home ? 'living' : 'entrance') : top && lantern ? 'lantern' : top ? (home ? 'bedroom' : 'top') : 'room';
    const id = ids.take(kind === 'room' ? 'room' : kind);
    const name = kind === 'room' ? `Room ${k}` : kind === 'living' ? 'Living room' : title(kind) + (kind === 'top' ? ' room' : kind === 'lantern' ? ' room' : '');
    if (round) p.rooms.push({ id, name, floor: k, kind, poly: ngon(R, sides) });
    else { const h = R; p.rooms.push({ id, name, floor: k, kind, rect: [-h, -h, h, h] }); }
  }
  p.ext.push({ floor: 0, room: p.rooms[0].id, side: 's', kind: 'door', to: 'outside' });
  p.windowStyle = { sill: 1.0, top: Math.min(2.1, c.fh - 0.4), width: 0.75, spacing: 2.2 / Math.max(0.05, c.density) };
  // a continuous helix up the inside of the wall: each flight sweeps 320°, starting just past the door
  const inner = R - c.t / 2, sw = Math.max(0.75, Math.min(0.9, inner * 0.36)), rm = inner - sw / 2;
  const a0 = 0.5;
  const sweep = (320 * Math.PI) / 180;
  const risers = Math.ceil(c.fh / MAX_RISE - 1e-9);
  for (let k = 0; k < c.floors - 1; k++) p.spirals.push({ id: ids.take('stairs'), from: k, to: k + 1, c: [0, 0], r: rm, width: sw, a0: a0 + k * sweep, sweep, risers });
  if (c.floors > 1 && inner - sw < 0.9) p.warnings.push('tower: narrow; little floor beside the stair');
  if (lantern && c.floors > 1) p.balcony = { floor: c.floors - 1, room: p.rooms[p.rooms.length - 1].id, width: 0, depth: 0.9, ring: true };
  if (p.balcony) p.ext.push({ floor: c.floors - 1, room: p.balcony.room, side: 's', kind: 'door', to: 'balcony' });
  return p;
}

/** Regular n-gon with a chord midpoint facing +z (so the door sits flat on the front). */
export function ngon(R: number, n: number): Vec2[] {
  return Array.from({ length: n }, (_, i) => { const a = ((i + 0.5) * 2 * Math.PI) / n; return [R * Math.sin(a), R * Math.cos(a)] as Vec2; });
}

export function autoPlan(params: { W: number; D: number; t: number; fh: number; floors: number; style: string; balcony: boolean; porch: number; density: number }, args: Record<string, unknown>): Plan {
  const c: Ctx = { ...params, args };
  switch (c.style) {
    case 'townhouse': return townhousePlan(c);
    case 'shop': return townhousePlan(c, true);
    case 'hall': case 'chapel': case 'barn': case 'shed': case 'greenhouse': return hallPlan(c);
    case 'pavilion': return pavilionPlan(c);
    case 'tower': return towerPlan(c);
    default: return cottagePlan(c);
  }
}

// ---------------------------------------------------------------- explicit plans (the `plan` json param)

type JPlan = {
  /** Optional authored footprint: room coordinates resize with the building instead of being clipped. */
  size?: number[];
  floors?: { rooms?: { id?: string; name?: string; rect?: number[]; kind?: string }[]; doors?: { between?: string[]; at?: number; width?: number }[]; exterior?: { room?: string; wall?: string; at?: number; kind?: string; width?: number; sill?: number; height?: number }[] }[];
  stairs?: { from?: number; to?: number; room?: string; wall?: string; at?: number }[];
  /** One balcony on the front (south) wall of a room above the ground floor, reached by a door at `at` along that wall. */
  balcony?: { floor?: number; room?: string; at?: number; width?: number; depth?: number };
};

/**
 * Explicit plan in the DEF frame (no rotation): rects are metres from the building's north-west outer
 * corner, [x0, z0, x1, z1] with 0 ≤ x ≤ w, 0 ≤ z ≤ d (+z = south). Omitting `doors` on a floor auto-connects
 * its rooms; an empty `doors` list means "no interior doors" (and the checks will say what is sealed).
 */
export function explicitPlan(json: unknown, c0: { W: number; D: number; t: number; fh: number; floors: number; density: number; balcony: boolean; porch: number }): Plan {
  const j = (json ?? {}) as JPlan;
  const c: Ctx = { ...c0, style: 'plan', args: {} };
  const p = base(c);
  const { X0, X1, Z0, Z1 } = extents(c);
  const sx = j.size?.[0] && j.size[0] > 0 ? c.W / j.size[0] : 1, sz = j.size?.[1] && j.size[1] > 0 ? c.D / j.size[1] : 1;
  const clampX = (x: number) => Math.min(X1, Math.max(X0, x * sx - c.W / 2)), clampZ = (z: number) => Math.min(Z1, Math.max(Z0, z * sz - c.D / 2));
  const floors = Array.isArray(j.floors) ? j.floors.slice(0, 6) : [];
  p.floors = Math.max(1, floors.length || c.floors);
  const ids = new Ids();
  floors.forEach((f, k) => {
    const mine: string[] = [];
    for (const r of (f.rooms ?? []).slice(0, 16)) {
      const rect = Array.isArray(r.rect) && r.rect.length === 4 && r.rect.every((v) => typeof v === 'number') ? r.rect : [0, 0, c.W, c.D];
      const id = ids.take(slug(r.id ?? r.name ?? 'room'));
      const R: Rect = [clampX(Math.min(rect[0], rect[2])), clampZ(Math.min(rect[1], rect[3])), clampX(Math.max(rect[0], rect[2])), clampZ(Math.max(rect[1], rect[3]))];
      if (R[2] - R[0] < 0.8 || R[3] - R[1] < 0.8) { p.warnings.push(`plan: room ${id} is smaller than 0.8 m; dropped`); continue; }
      p.rooms.push({ id, name: r.name ?? title(id), floor: k, kind: r.kind ?? slug(r.id ?? 'room').replace(/-\d+$/, ''), rect: R });
      mine.push(id);
    }
    if (Array.isArray(f.doors)) {
      for (const d of f.doors.slice(0, 32)) { const [a, b] = d.between ?? []; if (typeof a === 'string' && typeof b === 'string') p.doors.push({ floor: k, a: slug(a), b: slug(b), ...(typeof d.at === 'number' ? { at: d.at } : {}), ...(typeof d.width === 'number' ? { width: d.width } : {}) }); }
    } else {
      // auto: chain every room to its first adjacent neighbour (layout realises only doors whose rooms touch)
      for (let i = 0; i < mine.length; i++) for (let jx = i + 1; jx < mine.length; jx++) p.doors.push({ floor: k, a: mine[i], b: mine[jx] });
    }
    for (const e of (f.exterior ?? []).slice(0, 48)) {
      if (typeof e.room !== 'string') continue;
      const side = (['s', 'n', 'e', 'w'] as const).find((x) => x === e.wall) ?? 's';
      const kind = e.kind === 'window' ? 'window' : 'door';
      p.ext.push({ floor: k, room: slug(e.room), side, kind, ...(typeof e.at === 'number' ? { at: e.at } : {}), ...(typeof e.width === 'number' ? { width: e.width } : {}), ...(typeof e.sill === 'number' ? { sill: e.sill } : {}), ...(typeof e.height === 'number' ? { height: e.height } : {}) });
    }
  });
  if (!p.rooms.length) { p.rooms.push({ id: 'room', name: 'Room', floor: 0, kind: 'room', rect: [X0, Z0, X1, Z1] }); p.warnings.push('plan: no rooms; one room fills the footprint'); }
  if (p.ext.some((e) => e.kind === 'window')) p.autoWindows = false;
  if (j.balcony && typeof j.balcony === 'object') {
    const b = j.balcony, floor = typeof b.floor === 'number' ? Math.round(b.floor) : 1;
    const room = p.rooms.find((r) => r.floor === floor && r.id === slug(b.room ?? '')) ?? p.rooms.find((r) => r.floor === floor);
    if (!room || floor < 1) p.warnings.push(`plan: balcony skipped (it needs a room on an upper floor, floor ${floor})`);
    else {
      const span = room.rect ? room.rect[2] - room.rect[0] : c.W;
      p.balcony = { floor, room: room.id, width: Math.min(typeof b.width === 'number' ? b.width : 3.2, span - 0.4), depth: Math.min(2, Math.max(0.8, typeof b.depth === 'number' ? b.depth : 1.2)) };
      p.ext.push({ floor, room: room.id, side: 's', kind: 'door', to: 'balcony', ...(typeof b.at === 'number' ? { at: Math.min(1, Math.max(0, b.at)) } : {}) });
    }
  }
  const { risers } = stairGeometry(c.fh);
  for (const s of (j.stairs ?? []).slice(0, 8)) {
    const from = typeof s.from === 'number' ? Math.round(s.from) : 0, to = typeof s.to === 'number' ? Math.round(s.to) : from + 1;
    const room = p.rooms.find((r) => r.floor === from && r.id === slug(s.room ?? '')) ?? p.rooms.find((r) => r.floor === from);
    if (!room?.rect || to !== from + 1) { p.warnings.push(`plan: stairs ${from}→${to} skipped (one floor at a time, in a room of floor ${from})`); continue; }
    const [x0, z0, x1, z1] = room.rect, wall = (['n', 's', 'e', 'w'] as const).find((x) => x === s.wall) ?? 'n';
    const inset = (v: number, bound: number) => (Math.abs(v - bound) < 1e-6 ? c.t / 2 : TI / 2);
    const along = wall === 'n' || wall === 's' ? 'x' : 'z';
    const lo = along === 'x' ? x0 + inset(x0, X0) : z0 + inset(z0, Z0), hi = along === 'x' ? x1 - inset(x1, X1) : z1 - inset(z1, Z1);
    // Keep the legal tread going while fitting resized rooms; leave a half metre for the landings.
    const going = Math.max(0.2, Math.min(GOING, (hi - lo - 0.5) / (risers - 1))), run = going * (risers - 1);
    const at = typeof s.at === 'number' ? Math.min(1, Math.max(0, s.at)) : 0.5;
    // approach the bottom straight over >= 0.9 m (a 0.34 m body 0.35 m before the first tread clears the wall) and
    // arrive onto >= 1 m of landing when the wall has room; `at` places the flight in what is left
    const free = Math.max(0, hi - lo - run), mB = Math.min(0.9, free), mT = Math.min(1.0, free - mB);
    const s0 = lo + mB + (free - mB - mT) * at, s1 = s0 + run;
    const b0 = wall === 'n' ? z0 + inset(z0, Z0) : wall === 's' ? z1 - inset(z1, Z1) - STAIR_W : wall === 'w' ? x0 + inset(x0, X0) : x1 - inset(x1, X1) - STAIR_W;
    const rect: Rect = along === 'x' ? [s0, b0, s1, b0 + STAIR_W] : [b0, s0, b0 + STAIR_W, s1];
    p.stairs.push({ id: ids.take('stairs'), from, to, room: room.id, rect, axis: along, dir: 1, width: STAIR_W, risers, going, away: wall === 'n' || wall === 'w' ? 1 : -1 });
  }
  return p;
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'room';
