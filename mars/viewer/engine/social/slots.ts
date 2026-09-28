// Interaction slots (spec §5 affordances, §28 "Reservation conflict"; RESEARCH §8 Smart Objects).
// A slot is a place a person's body occupies for a social activity: a seat on a bench, a place
// in a fire circle, a spot in an audience. Slots are *derived* from world content — fixture
// entities whose catalog def lists `slots`, and 'place' regions carrying an audience `layout` —
// never stored. Claims are runtime reservations on `slot:<id>` (exclusive), so two actions can
// never own one seat; `claimedBy` is read back from the runtime.
import { add2, clamp, dcos, dist2, dsin, heading, rot2, sub2, wrapAngle, type Vec2 } from '../core/math.ts';
import type { Diagnostic } from '../actions/types.ts';
import type { Runtime } from '../runtime/runtime.ts';
import type { Entity, Region, WorldState } from '../world/types.ts';
import { CATALOG, HUMAN_RADIUS } from '../world/catalog.ts';
import type { Spatial } from '../spatial/service.ts';
import { cellOf, clearanceAt, type LevelGrid } from '../spatial/grid.ts';

export type SlotKind = 'seat' | 'stand' | 'audience' | 'fire-circle';

export type Slot = {
  /** `<owner>#<local id>`, stable for a given world. */
  id: string;
  /** Fixture entity id or region id. */
  owner: string;
  kind: SlotKind;
  /** Where the body stands/sits (ground x, z). */
  p: Vec2;
  /** Heading the occupant faces (0 = +x). */
  yaw: number;
  level: number;
  /** Action id holding `slot:<id>`, if any. */
  claimedBy?: string;
};

/**
 * Audience layout on a 'place' region: rows of slots filling the polygon, all facing `focus`.
 * Rows run perpendicular to the direction from the region's centroid to the focus, nearest row
 * first. Stored as an extra field on the (plain-JSON) region; see `SocialRegion`.
 */
export type AudienceLayout = { focus: Vec2; spacing?: number; rowGap?: number; kind?: 'audience' | 'stand' | 'seat' };
export type SocialRegion = Region & { layout?: AudienceLayout };

export const slotResource = (id: string) => `slot:${id}`;
/** Body clearance a generated slot needs (person radius + a margin). */
export const SLOT_CLEARANCE = HUMAN_RADIUS + 0.07;

function levelOf(rt: Runtime, e: Entity): number {
  const sp = rt.services.spatial as Spatial | undefined;
  const levels = sp?.base.levels ?? [{ id: 0, y: 0, label: 'ground' }];
  let best = levels[0].id, bd = Infinity;
  for (const l of levels) {
    const d = Math.abs(l.y - e.pose.p[1]);
    if (d < bd) { bd = d; best = l.id; }
  }
  return best;
}

function claimed(rt: Runtime, s: Slot): Slot {
  const h = rt.holder(slotResource(s.id));
  return h.length ? { ...s, claimedBy: h[0] } : s;
}

/** Slots of one fixture entity (from its catalog def), in definition order. */
export function fixtureSlots(rt: Runtime, e: Entity): Slot[] {
  const defs = CATALOG[e.def]?.slots ?? [];
  const level = levelOf(rt, e);
  const c: Vec2 = [e.pose.p[0], e.pose.p[2]];
  return defs.map((d) => claimed(rt, { id: `${e.id}#${d.id}`, owner: e.id, kind: d.kind, p: add2(c, rot2(d.local, e.pose.yaw)), yaw: wrapAngle(e.pose.yaw + d.yaw), level }));
}

export function pointInPolygon(p: Vec2, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function centroid(poly: [number, number][]): Vec2 {
  let x = 0, z = 0;
  for (const q of poly) { x += q[0]; z += q[1]; }
  return [x / poly.length, z / poly.length];
}

/**
 * Deterministic audience grid of a region: rows perpendicular to (focus − centroid), row r at
 * distance r·rowGap from the row nearest the focus, columns every `spacing` metres. A point is
 * kept only if it lies inside the polygon and has body clearance on the region's level. Ids are
 * row/column indices of the full grid (`r<i>c<j>`), so they stay stable when a point drops out.
 */
export function regionSlots(rt: Runtime, r: SocialRegion): Slot[] {
  const L = r.layout;
  if (r.kind !== 'place' || !L || r.polygon.length < 3) return [];
  const spacing = clamp(L.spacing ?? 0.9, 0.7, 3), rowGap = clamp(L.rowGap ?? 1.0, 0.7, 3);
  const level = r.level ?? 0;
  const sp = rt.services.spatial as Spatial | undefined;
  sp?.sync(rt.world);
  const g = sp?.level(level);
  const c = centroid(r.polygon);
  const fwd = sub2(L.focus, c);
  const yawF = dist2(L.focus, c) > 1e-9 ? heading(fwd) : 0; // rows face +fwd
  // polygon extent in the (along fwd, across) frame
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (const q of r.polygon) {
    const l = rot2(sub2(q, c), -yawF);
    a0 = Math.min(a0, l[0]); a1 = Math.max(a1, l[0]); b0 = Math.min(b0, l[1]); b1 = Math.max(b1, l[1]);
  }
  const out: Slot[] = [];
  const nRows = Math.floor((a1 - a0) / rowGap) + 1, nCols = Math.floor((b1 - b0) / spacing) + 1;
  const bOff = b0 + ((b1 - b0) - (nCols - 1) * spacing) / 2;
  for (let i = 0; i < nRows && i < 200; i++) {
    const a = a1 - i * rowGap; // row 0 is the one nearest the focus
    for (let j = 0; j < nCols && j < 200; j++) {
      const p = add2(c, rot2([a, bOff + j * spacing], yawF));
      if (!pointInPolygon(p, r.polygon)) continue;
      if (g && clearanceAt(g, p) < SLOT_CLEARANCE) continue;
      out.push(claimed(rt, { id: `${r.id}#r${i}c${j}`, owner: r.id, kind: L.kind ?? 'audience', p, yaw: heading(sub2(L.focus, p)), level }));
    }
  }
  return out;
}

/** Slots owned by a fixture entity or a region id; a diagnostic if the owner has none. */
export function slotsOf(rt: Runtime, owner: string): Slot[] | Diagnostic {
  const e = rt.world.entities[owner];
  if (e) {
    const s = fixtureSlots(rt, e);
    return s.length ? s : { code: 'slot.none', message: `${owner} (${e.def}) has no interaction slots`, subjects: [owner] };
  }
  const r = rt.world.regions[owner] as SocialRegion | undefined;
  if (r) {
    const s = regionSlots(rt, r);
    if (s.length) return s;
    return { code: 'slot.none', message: r.layout ? `region ${owner} has no free-standing ground for its audience layout` : `region ${owner} (${r.kind}) has no audience layout`, subjects: [owner] };
  }
  return { code: 'entity.unknown', message: `no fixture or region "${owner}"`, subjects: [owner] };
}

/** One slot by id (`<owner>#<local>`). */
export function slotById(rt: Runtime, id: string): Slot | Diagnostic {
  const owner = id.slice(0, id.lastIndexOf('#'));
  if (!owner) return { code: 'slot.unknown', message: `"${id}" is not a slot id (expected <owner>#<slot>)`, subjects: [id] };
  const all = slotsOf(rt, owner);
  if (!Array.isArray(all)) return all;
  return all.find((s) => s.id === id) ?? { code: 'slot.unknown', message: `${owner} has no slot "${id}" (has ${all.map((s) => s.id).join(', ')})`, subjects: [id, owner] };
}

/** Every slot in the world: fixtures (entity order) then regions (region order). */
export function allSlots(rt: Runtime): Slot[] {
  const out: Slot[] = [];
  for (const e of Object.values(rt.world.entities)) if (CATALOG[e.def]?.slots) out.push(...fixtureSlots(rt, e));
  for (const r of Object.values(rt.world.regions)) out.push(...regionSlots(rt, r as SocialRegion));
  return out;
}

/** Person (not in `except`) whose body is on the slot, if any. */
export function occupantOf(w: WorldState, s: Slot, except: ReadonlySet<string> = new Set()): string | undefined {
  for (const o of Object.values(w.entities))
    if (o.kind === 'human' && o.human && !except.has(o.id) && o.human.level === s.level && dist2([o.pose.p[0], o.pose.p[2]], s.p) < 2 * HUMAN_RADIUS) return o.id;
  return undefined;
}

/** Free = unclaimed and not physically occupied by a person who is not `except`. */
export function isFree(w: WorldState, s: Slot, except: ReadonlySet<string> = new Set()): boolean {
  return !s.claimedBy && !occupantOf(w, s, except);
}

/** "seat0 claimed by a3, seat1 occupied by p2" — why each slot is unavailable. */
export function whyTaken(w: WorldState, slots: Slot[], except: ReadonlySet<string> = new Set()): string {
  return slots.map((s) => (s.claimedBy ? `${s.id} claimed by ${s.claimedBy}` : `${s.id} occupied by ${occupantOf(w, s, except) ?? '?'}`)).join(', ');
}

/**
 * Deterministic nearest-first assignment: all (actor, free slot) pairs sorted by distance (ties by
 * actor then slot order), taken greedily. Returns the assignment and the actors left without one.
 */
export function assignNearest(w: WorldState, actors: string[], slots: Slot[]): { pairs: { actor: string; slot: Slot }[]; left: string[] } {
  const pairs: { d: number; ai: number; si: number }[] = [];
  actors.forEach((a, ai) => {
    const e = w.entities[a];
    slots.forEach((s, si) => pairs.push({ d: dist2([e.pose.p[0], e.pose.p[2]], s.p), ai, si }));
  });
  pairs.sort((x, y) => x.d - y.d || x.ai - y.ai || x.si - y.si);
  const usedA = new Set<number>(), usedS = new Set<number>();
  const out: { actor: string; slot: Slot }[] = [];
  for (const q of pairs) {
    if (usedA.has(q.ai) || usedS.has(q.si)) continue;
    usedA.add(q.ai); usedS.add(q.si);
    out.push({ actor: actors[q.ai], slot: slots[q.si] });
  }
  out.sort((x, y) => actors.indexOf(x.actor) - actors.indexOf(y.actor));
  return { pairs: out, left: actors.filter((_, i) => !usedA.has(i)) };
}

// ---------- seat approach points ----------

/**
 * A seat fixture (chair, bench) is a static obstacle, so nobody walks onto it: the sitter walks to
 * the seat's approach point, a standable spot APPROACH_GAPS beyond the fixture's edge along the
 * seat's facing (its front), or — when every front candidate is blocked — the same distances
 * behind it (mirrored). The sit-down / stand-up transition then moves the body between the
 * approach point and the seat point. Candidates are tried in order, so the choice is deterministic
 * for a given grid; it is made at claim (plan) time against the current grid.
 */
export const APPROACH_GAPS = [0.35, 0.4, 0.45, 0.5] as const;
/** Clearance an approach point needs: the body radius plus 2 cm, so the walk goal never snaps. */
export const APPROACH_CLEARANCE = HUMAN_RADIUS + 0.02;

/** Distance from local point `s` (strictly inside the box) along unit `u` to the box edge. */
function edgeDistance(s: Vec2, u: Vec2, half: Vec2): number {
  let t = Infinity;
  for (const k of [0, 1] as const) if (Math.abs(u[k]) > 1e-9) t = Math.min(t, ((u[k] > 0 ? half[k] : -half[k]) - s[k]) / u[k]);
  return t;
}

/** Nearest blocker id around `p` other than `except` (the seat's own fixture). */
export function blockerNear(g: LevelGrid, p: Vec2, except: string, radius = 1.5): string | undefined {
  const c = cellOf(g, p);
  if (c < 0) return undefined;
  const r = Math.ceil(radius / g.cell), ci = c % g.nx, cj = Math.floor(c / g.nx);
  let best: string | undefined, bd = Infinity;
  for (let j = Math.max(0, cj - r); j <= Math.min(g.nz - 1, cj + r); j++)
    for (let i = Math.max(0, ci - r); i <= Math.min(g.nx - 1, ci + r); i++) {
      const id = g.blockers.get(j * g.nx + i);
      if (id && id !== except) { const d = (i - ci) ** 2 + (j - cj) ** 2; if (d < bd) { bd = d; best = id; } }
    }
  return best;
}

/** Whether a slot is sat on through an approach point (a `seat` of a fixture entity). */
export const needsApproach = (w: WorldState, s: Slot) => s.kind === 'seat' && !!w.entities[s.owner];

/**
 * Approach point of a fixture seat (see APPROACH_GAPS), or `slot.unreachable` naming what blocks
 * both the front and the back (e.g. "passage-e (passage east wall)").
 */
export function seatApproach(rt: Runtime, s: Slot): Vec2 | Diagnostic {
  const e = rt.world.entities[s.owner];
  const d = CATALOG[e.def];
  const sp = rt.services.spatial as Spatial | undefined;
  sp?.sync(rt.world);
  const g = sp?.level(s.level);
  const c: Vec2 = [e.pose.p[0], e.pose.p[2]];
  const local = rot2(sub2(s.p, c), -e.pose.yaw);
  const half: Vec2 = [d.size[0] / 2, d.size[2] / 2];
  const tried: { p: Vec2; cl: number }[] = [];
  for (const side of [1, -1]) {
    const yawL = s.yaw - e.pose.yaw + (side < 0 ? Math.PI : 0);
    const u: Vec2 = [dcos(yawL), dsin(yawL)];
    const edge = edgeDistance(local, u, half);
    for (const gap of APPROACH_GAPS) {
      const p = add2(c, rot2([local[0] + u[0] * (edge + gap), local[1] + u[1] * (edge + gap)], e.pose.yaw));
      const cl = g ? clearanceAt(g, p) : Infinity;
      if (cl >= APPROACH_CLEARANCE) return p;
      tried.push({ p, cl });
    }
  }
  const front = tried[0], back = tried[APPROACH_GAPS.length];
  const blocker = (q: Vec2) => (g ? blockerNear(g, q, e.id) : undefined);
  const name = (id: string | undefined) => {
    if (!id) return 'the edge of walkable ground';
    const label = sp!.scene.obstacles.find((o) => o.id === id)?.label;
    return label && label !== id ? `${id} (${label})` : id;
  };
  const fmt = (q: Vec2) => `(${q[0].toFixed(2)}, ${q[1].toFixed(2)})`;
  const bf = blocker(front.p), bb = blocker(back.p);
  return {
    code: 'slot.unreachable',
    message: `${s.id} cannot be sat on: no standing room ${APPROACH_GAPS[0]}–${APPROACH_GAPS[APPROACH_GAPS.length - 1]} m in front of it (${fmt(front.p)}, ${front.cl.toFixed(2)} m clear, blocked by ${name(bf)}) or behind it (${fmt(back.p)}, ${back.cl.toFixed(2)} m clear, blocked by ${name(bb)}); a sitter needs ${APPROACH_CLEARANCE.toFixed(2)} m`,
    subjects: [s.id, s.owner, ...new Set([bf, bb].filter((x): x is string => !!x))],
    at: [front.p[0], 0, front.p[1]],
  };
}
