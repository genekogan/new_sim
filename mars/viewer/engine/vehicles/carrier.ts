// Carriers (rides): a native entity with finite seats that carries the bodies seated in it along a
// deterministic route. Generic: a hot-air balloon, a gondola, a cart. The carrier's flight is world
// physics (stepCarriers, a pure function of world state and tick), not anyone's action, so no rider's
// own choices can strand another rider mid-air, and replay/snapshots are exact.
//
//   carrier_ride   {actor, carrier, slot?}  held: step in through the door into a free seat (phase
//                  'occupied' once seated); cancelled → steps out when the carrier is on the ground
//                  (deferred until it lands). When the carrier lands every rider steps out by itself.
//   carrier_depart {actor, carrier}         a seated rider asks to leave now instead of waiting.
//   together/1 (core-next4): carrier_ride {holdSeats, holdSeconds} keeps that many places for invited companions
//   and does not lift off until they are seated (or the hold runs out); a companion boards with {reserved: true}.
//   Strangers cannot take a kept place. carrier_depart ends the hold.
//
// Phases: parked → boarding (first rider claims a seat; departs after `waitTicks`, sooner when full)
// → aloft (route from its first key at elapsed 0; holds above the landing spot until it is clear)
// → landed (riders step out) → parked. Parked, the basket is a static walking obstacle (catalog
// `obstacle`); aloft it is phase 'carried' and leaves the navigation grids.
import { z } from 'zod';
import type { ActionDef, Diagnostic } from '../actions/types.ts';
import type { Runtime, Invariant } from '../runtime/runtime.ts';
import type { Entity, WorldState } from '../world/types.ts';
import { angleDelta, dcos, dsin, heading, hypot, rot2, wrapAngle, type Vec2, type Vec3 } from '../core/math.ts';
import { CATALOG } from '../world/catalog.ts';
import { entityList, stableIndices, type EntityTable } from '../world/entity-list.ts';
import { relevantEntities } from '../world/relevant.ts';
import { acknowledgeRelocation } from '../runtime/invariants.ts';
import { G_SWIM, G_WALK } from '../spatial/ground.ts';
import type { GroundNav } from '../spatial/tiled.ts';

export type CarrierSeatDef = { id: string; local: Vec2; yaw: number; exit: Vec2 };
/** `doorway`: local floor points between the seats and the door, inside first (a basket's door opening): boarding walks
 *  door → doorway (reversed) → seat and stepping out seat → doorway → door, so a body never crosses a wall. */
export type CarrierDef = { seats: CarrierSeatDef[]; door: Vec2; floorY: number; transferSpeed: number; landingClear: number; doorway?: Vec2[] };
export type RouteKey = { t: number; p: Vec3 };
export type CarrierRoute = { id: string; keys: RouteKey[] };
/** A water ride transfers over a short boarding plank to dry bank points. Absolute world positions,
 * retained in the logged installation so replay never consults an author's mutable water model. */
export type CarrierBank = { door: Vec3; exits: Record<string, Vec3> };
export type CarrierInstallSpec = { id: string; def: string; label?: string; at: [number, number]; y?: number; yaw?: number; route: string; routeKeys?: RouteKey[]; bank?: CarrierBank; waitSeconds?: number };
export type CarrierState = {
  contract: 'carrier-state/1';
  phase: 'parked' | 'boarding' | 'aloft' | 'landed';
  home: Vec3; yaw: number;
  seats: Record<string, string | null>;
  route: CarrierRoute;
  /** Ticks of route progress while aloft (stops advancing while holding above a busy landing spot). */
  elapsed: number;
  waitTicks: number; departAtTick: number | null; phaseTick: number; flights: number; holding: boolean;
  /** The one body using the boarding step right now (boarding or stepping out), so transfers never cross. */
  doorBy: string | null;
  bank?: CarrierBank;
  /** together/1: places kept for invited companions (`seats`), how many of them have boarded, until when. Absent otherwise. */
  hold?: { by: string; seats: number; filled: number; untilTick: number };
  /** VEHICLE-STEER (carrier_steer): a rider's destination. `by` null = the ride flying itself home (after a hover ran out, or
   *  empty after a landing away). `to`: where the route goes (x, cruise y, z); `land`: the ground point it lands at (absent:
   *  it holds at `to` until `hoverUntil`, then flies itself home). `built`: the route from the pose to `to`/`land` is in
   *  `route` (a boarding ride builds it at lift-off). Absent: the ride flies its own route. */
  steer?: CarrierSteer;
};
/** `ret`: fly back (punts retrace the steered legs to where they left their own route, then finish it; balloons rejoin it
 *  in the air, or fly straight home when empty or steered before lift-off). `away`: the ride's own route and where it left it. */
export type CarrierSteer = { by: string | null; to: Vec3; land?: Vec3; built: boolean; hoverUntil?: number; ret?: true;
  away: { route: CarrierRoute; elapsed: number; wake: Vec3[] } };
/** `outBy` (leaving only): the tick by which the rider is on the ground; a step-out still held up then is set down at its exit. */
export type CarriedBody = { id: string; slot: string; phase: 'boarding' | 'seated' | 'leaving'; outBy?: number };

const TPS = 20;
/** Clearance of the landing spot: no other person within this distance of the home centre below this height. */
const LANDING_HEIGHT = 3;
/** A boarder starts its climb-in from anywhere this close to the carrier centre (several approach spots, no single queue point). */
const BOARD_REACH = 3.2;
const BLOCK_GAP = 0.56;
const BOARD_TIMEOUT = 15 * TPS;
/** Stepping out never holds a body for long (Gene's review 2026-10-23: a landed rider stayed "riding" behind a busy door/exit):
 *  a rider whose step-out has made no progress this long (busy door, someone on the exit) is set down at its seat exit (the
 *  nearest clear spot there). Walking out, or waiting for a rider ahead who is itself stepping out, renews the limit. */
export const LEAVE_LIMIT = 12 * TPS;
/** Seconds until a leaving rider is on the ground at the latest (LEAVE_LIMIT; the full limit while it has not begun). */
export function stepOutSeconds(body: CarriedBody | undefined, tick: number): number {
  return Math.max(1, Math.ceil(((body?.phase === 'leaving' && body.outBy !== undefined ? body.outBy : tick + LEAVE_LIMIT) - tick) / TPS));
}
/** The exit itself when clear, else the first clear spot a little further out from the carrier or to either side. */
function setDownSpot(rt: Runtime, me: string, e: Entity, exit: Vec3): Vec3 {
  const ax = exit[0] - e.pose.p[0], az = exit[2] - e.pose.p[2], n = hypot(ax, az) || 1, ux = ax / n, uz = az / n;
  for (const [f, s] of [[0, 0], [0.8, 0], [1.6, 0], [0.8, 0.8], [0.8, -0.8], [0, 1.2], [0, -1.2], [2.4, 0]] as const) {
    const p: Vec3 = [r4(exit[0] + ux * f - uz * s), exit[1], r4(exit[2] + uz * f + ux * s)];
    if (!blockerAt(rt, me, p)) return p;
  }
  return exit;
}

/** Named routes (World data; deterministic in route time). Positions are world metres, t seconds from lift-off. */
export const CARRIER_ROUTES: Record<string, CarrierRoute> = {
  // World data (sim-wt/world-edge worlds/eden/rides/balloon-ride.v1.json, eden-rides/1, WN9): launch meadow (-20,-9), 18.7 min, over
  // the pond, west lake, river mouth, the new coast, the sea, the lighthouse, the ferris wheel, east rooftops and back.
  'eden-commons-loop': { id: 'eden-commons-loop', keys: [
    [0, -20, 0, -9], [40, -28, 25, -6], [120, -55, 55, 0], [240, -150, 75, 5], [360, -260, 85, 80], [480, -480, 95, 150], [600, -300, 90, 230],
    [720, 60, 80, 215], [840, 160, 70, 140], [960, 70, 50, 40], [1060, 0, 25, -8], [1120, -20, 0, -9]].map(([t, x, y, z]) => ({ t, p: [x, y, z] as Vec3 })) },
  // CN5 (acceptance: a flight lasted ~19 min with no way down): the same World path flown at 0.6x the time, 11.2 min (top speed stays under 6 m/s).
  'eden-commons-loop-brisk': { id: 'eden-commons-loop-brisk', keys: [
    [0, -20, 0, -9], [40, -28, 25, -6], [120, -55, 55, 0], [240, -150, 75, 5], [360, -260, 85, 80], [480, -480, 95, 150], [600, -300, 90, 230],
    [720, 60, 80, 215], [840, 160, 70, 140], [960, 70, 50, 40], [1060, 0, 25, -8], [1120, -20, 0, -9]].map(([t, x, y, z]) => ({ t: Math.round(t * 0.6 * 10) / 10, p: [x, y, z] as Vec3 })) },
  // A short hop over the commons (tests, demos): up, a small loop, down. Relative routes are moved to the home.
  'commons-hop': { id: 'commons-hop', keys: [
    { t: 0, p: [0, 0, 0] }, { t: 15, p: [-4, 8, 4] }, { t: 35, p: [6, 14, 8] }, { t: 55, p: [8, 10, -4] }, { t: 80, p: [0, 0, 0] }] },
};

const diag = (code: string, message: string, subjects?: string[]): Diagnostic => ({ code: `carrier.${code}`, message, subjects });
export const carrierDef = (e: Entity | undefined): CarrierDef | undefined => e ? CATALOG[e.def]?.capabilities?.carrier : undefined;
const state = (e: Entity | undefined) => (e as Entity & { carrier?: CarrierState } | undefined)?.carrier;
const carried = (e: Entity | undefined) => (e?.human as { carrier?: CarriedBody } | undefined)?.carrier;
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** World pose of a local point (x, z) of the carrier at its current pose. */
function at(e: Entity, local: Vec2, y = 0): Vec3 { const d = rot2(local, e.pose.yaw); return [r4(e.pose.p[0] + d[0]), r4(e.pose.p[1] + y), r4(e.pose.p[2] + d[1])]; }
export function seatPose(e: Entity, slot: string): { p: Vec3; yaw: number } | null {
  const d = carrierDef(e), s = d?.seats.find(x => x.id === slot); if (!d || !s) return null;
  return { p: at(e, s.local, d.floorY), yaw: wrapAngle(e.pose.yaw + s.yaw) };
}
export function doorPoint(e: Entity): Vec3 | null { const d = carrierDef(e); return state(e)?.bank?.door ?? (d ? at(e, d.door) : null); }
/** The seat this actor holds, else the first free seat (definition order), else null. */
export function seatFor(e: Entity, actor: string): string | null {
  const c = state(e), d = carrierDef(e); if (!c || !d) return null;
  for (const s of d.seats) if (c.seats[s.id] === actor) return s.id;
  for (const s of d.seats) if (!c.seats[s.id]) return s.id;
  return null;
}
/** The route moved to a home (relative routes start at [0,0,0]). */
export function routeAt(id: string, home: Vec3): CarrierRoute | null {
  const r = CARRIER_ROUTES[id]; if (!r) return null;
  const rel = r.keys[0].p.every(v => v === 0);
  return { id, keys: r.keys.map(k => ({ t: k.t, p: (rel ? [k.p[0] + home[0], k.p[1] + home[1], k.p[2] + home[2]] : [...k.p]) as Vec3 })) };
}
/** Route position after `ticks`: World's eden-rides/1 curve — cubic Hermite through the keys in time, tangent
 *  (p[i+1]-p[i-1])/(t[i+1]-t[i-1]) and zero at the first and last key (starts and ends at rest). Viewers use the same function. */
export function routePosition(route: CarrierRoute, ticks: number): Vec3 {
  const k = route.keys, s = ticks / TPS, n = k.length;
  if (s <= k[0].t) return [...k[0].p] as Vec3;
  if (s >= k[n - 1].t) return [...k[n - 1].p] as Vec3;
  let i = 0; while (i < n - 2 && s >= k[i + 1].t) i++;
  const h = k[i + 1].t - k[i].t, u = (s - k[i].t) / h, u2 = u * u, u3 = u2 * u;
  const tan = (j: number, a: number) => j === 0 || j === n - 1 ? 0 : (k[j + 1].p[a] - k[j - 1].p[a]) / (k[j + 1].t - k[j - 1].t);
  return [0, 1, 2].map(a => r4((2 * u3 - 3 * u2 + 1) * k[i].p[a] + (u3 - 2 * u2 + u) * h * tan(i, a) + (-2 * u3 + 3 * u2) * k[i + 1].p[a] + (u3 - u2) * h * tan(i + 1, a))) as Vec3;
}
export const routeTicks = (route: CarrierRoute) => Math.round(route.keys[route.keys.length - 1].t * TPS);

/** A carrier entity at its home (installed by a logged rules fact). */
export function carrierEntity(spec: CarrierInstallSpec, tick: number): Entity | Diagnostic {
  const d = CATALOG[spec.def], cd = d?.capabilities?.carrier;
  if (!cd) return diag('unknown-def', `${spec.def} is not a carrier`);
  const home: Vec3 = [spec.at[0], spec.y ?? 0, spec.at[1]], route = spec.routeKeys ? { id: spec.route, keys: structuredClone(spec.routeKeys) } : routeAt(spec.route, home);
  if (!route) return diag('unknown-route', `no route ${spec.route}`);
  if (!Number.isFinite(home[1]) || !Number.isFinite(spec.yaw ?? 0) || route.keys.length < 2 || route.keys.length > 64
    || route.keys.some((k, i) => !Number.isFinite(k.t) || k.t < 0 || (i === 0 ? k.t !== 0 : k.t <= route.keys[i - 1].t) || !Array.isArray(k.p) || k.p.length !== 3 || !k.p.every(Number.isFinite)))
    return diag('bad-route', 'a route needs 2–64 finite positions with strictly increasing seconds from zero');
  if (spec.bank && (!Array.isArray(spec.bank.door) || spec.bank.door.length !== 3 || !spec.bank.door.every(Number.isFinite)
    || cd.seats.some(s => !Array.isArray(spec.bank!.exits[s.id]) || spec.bank!.exits[s.id].length !== 3 || !spec.bank!.exits[s.id].every(Number.isFinite))))
    return diag('bad-bank', 'boarding door and every seat exit must be finite world positions');
  const a = route.keys[0].p, b = route.keys[route.keys.length - 1].p;
  if (hypot(a[0] - home[0], a[1] - home[1], a[2] - home[2]) > 1e-6 || hypot(b[0] - home[0], b[1] - home[1], b[2] - home[2]) > 1e-6) return diag('route-home', 'the route must start and end at the carrier home');
  const st: CarrierState = { contract: 'carrier-state/1', phase: 'parked', home, yaw: spec.yaw ?? 0, seats: Object.fromEntries(cd.seats.map(s => [s.id, null])), route,
    elapsed: 0, waitTicks: Math.round(Math.max(5, Math.min(600, spec.waitSeconds ?? 45)) * TPS), departAtTick: null, phaseTick: tick, flights: 0, holding: false, doorBy: null,
    ...(spec.bank ? { bank: structuredClone(spec.bank) } : {}) };
  return { id: spec.id, def: spec.def, kind: 'fixture', label: spec.label ?? d.label, pose: { p: [...home] as Vec3, yaw: spec.yaw ?? 0 }, support: { kind: 'ground' },
    provenance: { origin: 'design-edit', confidence: 'hypothetical', note: 'carrier/1 ride' }, carrier: st } as Entity;
}

function freeBody(rt: Runtime, actor: string): Diagnostic | null {
  const e = rt.world.entities[actor], h = e?.human;
  if (!h || e.kind !== 'human' || (e.body && e.body.family !== 'humanoid')) return diag('body-family', `${actor} cannot ride`, [actor]);
  if (h.hands?.left || h.hands?.right || h.grip || h.riding || h.on || h.sleepPose || h.boatPassenger || h.boatTransit || (h.shore && h.shore.depthMetres > 0)
    || Object.values(rt.world.entities).some(o => o.support?.kind === 'in-hand' && o.support.by === actor))
    return diag('occupied-body', `${actor} needs free hands and to be standing on the ground`, [actor]);
  return null;
}
/** Another person within the body gap of p (same height band). */
function blockerAt(rt: Runtime, me: string, p: Vec3): string | null {
  for (const o of Object.values(rt.world.entities)) {
    if (o.id === me || !o.human || Math.abs(o.pose.p[1] - p[1]) > 1) continue;
    if (hypot(o.pose.p[0] - p[0], o.pose.p[2] - p[2]) < BLOCK_GAP) return o.id;
  }
  return null;
}
function moveToward(e: Entity, to: Vec3, speed: number, dt: number): boolean {
  const d = hypot(to[0] - e.pose.p[0], to[1] - e.pose.p[1], to[2] - e.pose.p[2]);
  if (d <= speed * dt) { e.pose.p = [...to] as Vec3; return true; }
  const k = speed * dt / d; e.pose.p = e.pose.p.map((v, i) => r4(v + (to[i] - v) * k)) as Vec3; return false;
}
function turnToward(e: Entity, yaw: number, dt: number) { const t = angleDelta(e.pose.yaw, yaw); e.pose.yaw = wrapAngle(e.pose.yaw + Math.max(-4 * dt, Math.min(4 * dt, t))); }

/** Take the boarding step if it is free (or already mine). */
const takeDoor = (c: CarrierState, actor: string) => { if (c.doorBy && c.doorBy !== actor) return false; c.doorBy = actor; return true; };
const freeDoor = (c: CarrierState, actor: string) => { if (c.doorBy === actor) c.doorBy = null; };
type RideExec = { actor: string; carrier: string; slot: string; phase: 'boarding' | 'seated' | 'leaving'; leg: number; stopping: boolean; waited: number; id: string; path: Vec3[]; throughReturn?: boolean };
/** The doorway's points in world space, inside first. */
const inside = (e: Entity, d: CarrierDef) => (d.doorway ?? []).map(q => at(e, q, d.floorY));
/** From where the boarder stands, round the basket (never through it) to the boarding step, through the door, then to its seat. */
export function boardingPath(e: Entity, from: Vec3, seat: Vec3, d: CarrierDef): Vec3[] {
  if (state(e)?.bank) return [doorPoint(e)!, seat];
  const l = rot2([from[0] - e.pose.p[0], from[2] - e.pose.p[2]], -e.pose.yaw), hz = CATALOG[e.def].size[2] / 2 + 0.6;
  const side = l[1] >= 0 ? 1 : -1, out = d.door[0] >= 0 ? 1 : -1, pts: Vec2[] = [];
  if (l[0] * out < Math.abs(d.door[0]) - 0.05) { if (Math.abs(l[1]) < hz) pts.push([l[0], side * hz]); pts.push([d.door[0], side * hz]); }
  return [...pts.map(q => at(e, q)), doorPoint(e)!, ...inside(e, d).reverse(), seat];
}
/** together/1: places kept for companions who have not boarded yet. */
const keptSeats = (c: CarrierState) => c.hold ? Math.max(0, c.hold.seats - c.hold.filled) : 0;
const HOLD_MAX_SECONDS = 180;
type RideParams = { actor: string; carrier: string; slot?: string; holdSeats?: number; holdSeconds?: number; reserved?: boolean; throughReturn?: boolean };
const ride: ActionDef<RideParams, { slot: string }, RideExec> = {
  verb: 'carrier_ride',
  description: 'Step into a free seat of a parked or boarding carrier (a balloon basket) from its door and stay seated while it carries you; step out only when it is on the ground.',
  schema: z.object({ actor: z.string().min(1), carrier: z.string().min(1), slot: z.string().min(1).max(40).optional(),
    holdSeats: z.number().int().min(1).max(8).optional(), holdSeconds: z.number().min(5).max(HOLD_MAX_SECONDS).optional(), reserved: z.boolean().optional(), throughReturn: z.boolean().optional() }).strict(),
  resumable: true,
  reservations: (w: WorldState, p) => {
    const e = w.entities[p.carrier], slot = p.slot ?? (e ? seatFor(e, p.actor) : null) ?? 'none';
    return [{ resource: `actor:${p.actor}`, mode: 'exclusive' }, { resource: `carrier-seat:${p.carrier}#${slot}`, mode: 'exclusive' }];
  },
  plan(rt, p) {
    const e = rt.world.entities[p.carrier], c = state(e), d = carrierDef(e);
    if (!e || !c || !d) return { ok: false, diagnostic: diag('unknown', `no carrier ${p.carrier}`, [p.carrier]) };
    const issue = freeBody(rt, p.actor); if (issue) return { ok: false, diagnostic: issue };
    if (carried(rt.world.entities[p.actor])) return { ok: false, diagnostic: diag('already-aboard', `${p.actor} is already riding`, [p.actor]) };
    if (c.phase === 'aloft') return { ok: false, diagnostic: diag('departed', `${e.label ?? e.id} has already left; wait for it to land`, [e.id]) };
    if (c.phase === 'landed') return { ok: false, diagnostic: diag('landing', `${e.label ?? e.id} has just landed; wait for its riders to step out`, [e.id]) };
    const slot = p.slot && !c.seats[p.slot] && d.seats.some(s => s.id === p.slot) ? p.slot : seatFor(e, p.actor);
    if (!slot || c.seats[slot]) return { ok: false, diagnostic: diag('full', `${e.label ?? e.id} is full`, [e.id]) };
    const free = Object.values(c.seats).filter(v => !v).length;
    if (!(p.reserved && keptSeats(c) > 0) && free - keptSeats(c) < 1) return { ok: false, diagnostic: diag('reserved', `the last place in ${e.label ?? e.id} is kept for someone who was invited`, [e.id]) };
    if (p.holdSeats && p.holdSeats > free - keptSeats(c) - 1) return { ok: false, diagnostic: diag('full', `${e.label ?? e.id} has no room for ${p.holdSeats} more`, [e.id]) };
    const a = rt.world.entities[p.actor];
    const door = doorPoint(e)!;
    if (hypot(a.pose.p[0] - e.pose.p[0], a.pose.p[2] - e.pose.p[2]) > BOARD_REACH || Math.abs(a.pose.p[1] - (c.bank ? door[1] : c.home[1])) > 0.05 || (c.bank && hypot(a.pose.p[0] - door[0], a.pose.p[2] - door[2]) > 0.35) || (a.human!.level ?? 0) !== 0)
      return { ok: false, diagnostic: diag('not-at-door', `${p.actor} must stand beside ${e.label ?? e.id} first`, [p.actor]) };
    return { ok: true, program: { slot } };
  },
  start(rt, p, prog, id) {
    const e = rt.world.entities[p.carrier], c = state(e)!, a = rt.world.entities[p.actor], h = a.human!;
    c.seats[prog.slot] = p.actor;
    if (c.phase === 'parked') { c.phase = 'boarding'; c.phaseTick = rt.tick; c.departAtTick = rt.tick + c.waitTicks; }
    if (p.reserved && c.hold && c.hold.filled < c.hold.seats) c.hold.filled++;
    if (p.holdSeats && !c.hold) c.hold = { by: p.actor, seats: p.holdSeats, filled: 0, untilTick: rt.tick + Math.round((p.holdSeconds ?? 120) * TPS) };
    (h as { carrier?: CarriedBody }).carrier = { id: e.id, slot: prog.slot, phase: 'boarding' };
    h.task = id; h.activity = 'board'; delete h.speed;
    return { actor: p.actor, carrier: p.carrier, slot: prog.slot, phase: 'boarding', leg: 0, stopping: false, waited: 0, id, path: boardingPath(e, a.pose.p, seatPose(e, prog.slot)!.p, carrierDef(e)!), ...(p.throughReturn ? { throughReturn: true } : {}) };
  },
  step(rt, ex, dt) {
    const e = rt.world.entities[ex.carrier], c = state(e), d = carrierDef(e), a = rt.world.entities[ex.actor];
    if (!e || !c || !d || !a?.human) return { status: 'failed', diagnostic: diag('gone', 'the carrier or rider is gone') };
    const h = a.human, body = (h as { carrier?: CarriedBody }).carrier!, seat = seatPose(e, ex.slot)!, def = d.seats.find(s => s.id === ex.slot)!;
    const leave = () => { ex.phase = 'leaving'; ex.leg = 0; body.phase = 'leaving'; body.outBy = rt.tick + LEAVE_LIMIT; h.activity = 'alight'; };
    if (ex.phase === 'boarding') {
      const abandon = (d2: Diagnostic | null) => { freeDoor(c, ex.actor); c.seats[ex.slot] = null; delete (h as { carrier?: CarriedBody }).carrier; delete h.task; h.activity = 'idle';
        return d2 ? { status: 'failed' as const, diagnostic: d2 } : { status: 'completed' as const, outputs: { carrier: e.id, phase: 'ashore' } }; };
      if (!takeDoor(c, ex.actor)) {   // someone else is on the step: wait at the door (or give up the seat when told to stop)
        if (ex.stopping) return abandon(null);
        return ++ex.waited > BOARD_TIMEOUT ? abandon(diag('door-blocked', `the boarding step of ${e.label ?? e.id} stayed busy`, [c.doorBy!])) : { status: 'running', phase: 'boarding-wait' };
      }
      if (ex.stopping) { leave(); return { status: 'running', phase: 'leaving' }; }
      const to = ex.path[Math.min(ex.leg, ex.path.length - 1)], last = ex.leg >= ex.path.length - 1;
      const blocker = blockerAt(rt, ex.actor, to);
      if (blocker && hypot(a.pose.p[0] - to[0], a.pose.p[2] - to[2]) > 1e-9)
        return ++ex.waited > BOARD_TIMEOUT ? (leave(), { status: 'running', phase: 'leaving' }) : { status: 'running', phase: 'boarding-wait' };
      if (!last) { const dx = to[0] - a.pose.p[0], dz = to[2] - a.pose.p[2]; if (Math.abs(dx) + Math.abs(dz) > 1e-6) turnToward(a, heading([dx, dz]), dt); if (moveToward(a, to, d.transferSpeed, dt)) ex.leg++; return { status: 'running', phase: 'boarding' }; }
      turnToward(a, seat.yaw, dt);
      if (moveToward(a, seat.p, d.transferSpeed, dt) && Math.abs(angleDelta(a.pose.yaw, seat.yaw)) < 1e-9) {
        ex.phase = 'seated'; body.phase = 'seated'; h.activity = e.def === 'rowing-punt' ? 'row' : 'ride';
        if (e.def === 'rowing-punt') { h.baseActivity = 'sit'; h.seatHeight = .36; }
        freeDoor(c, ex.actor);
        return { status: 'running', phase: ex.throughReturn ? 'rowing' : 'occupied' };
      }
      return { status: 'running', phase: 'boarding' };
    }
    if (ex.phase === 'seated') {
      if (c.phase === 'landed' || (ex.stopping && (c.phase === 'parked' || c.phase === 'boarding'))) { leave(); return { status: 'running', phase: 'leaving' }; }
      a.pose.p = seat.p; a.pose.yaw = seat.yaw;   // follows its seat (stepCarriers moves the carrier first)
      return { status: 'running', phase: ex.throughReturn ? 'rowing' : 'occupied' };
    }
    // leaving: seat → door → this seat's exit spot (so the next rider has the door), each step only when clear.
    const door = doorPoint(e)!, exit = c.bank?.exits[ex.slot] ?? at(e, def.exit);
    // Before departure a rear rider may stop while the front rider stays aboard. Sidestep along the
    // gunwale to the bow before taking the plank; do not walk through the other occupied thwart.
    const bypass=c.bank&&c.phase!=='landed'&&d.seats.some(s=>s.local[0]>def.local[0]&&c.seats[s.id]);
    const path=bypass?[at(e,[def.local[0],-.65],d.floorY),at(e,[1.6,-.65],d.floorY),door,exit]:[...inside(e,d),door,exit];
    // The punt's thwarts are in line. At the shared return, the rider nearest the plank gets out first,
    // so the rear rider never walks through the one still seated at the front thwart.
    // A step-out held up past its limit (busy door, someone standing on the exit, a rider ahead) ends here: set down at the exit.
    // (A body already leaving from an older state gets its limit from now.)
    body.outBy ??= rt.tick + LEAVE_LIMIT;
    const setDown = rt.tick >= body.outBy && c.phase !== 'aloft';
    if (setDown) { const p = setDownSpot(rt, ex.actor, e, exit); a.pose.p = [p[0], a.pose.p[1], p[2]]; acknowledgeRelocation(rt, ex.actor); ex.leg = path.length; }
    if (!setDown && c.bank && c.phase === 'landed' && ex.leg === 0) {
      const mine=hypot(seat.p[0]-door[0],seat.p[2]-door[2]);
      if (Object.entries(c.seats).some(([slot,actor])=>actor&&actor!==ex.actor&&(()=>{const p=seatPose(e,slot)!.p;return hypot(p[0]-door[0],p[2]-door[2])<mine-.01;})()))
        { body.outBy = rt.tick + LEAVE_LIMIT; return {status:'running',phase:'leaving-wait'}; }
    }
    if (ex.leg >= path.length) {
      freeDoor(c, ex.actor); c.seats[ex.slot] = null; delete (h as { carrier?: CarriedBody }).carrier; delete h.task; h.activity = 'idle';
      delete h.baseActivity; delete h.seatHeight; delete h.speed;
      a.pose.p = [a.pose.p[0], c.bank ? exit[1] : e.pose.p[1], a.pose.p[2]];
      const contact = rt.services.carrierBankContact as ((rt: Runtime, actor: string) => void) | undefined;
      if (c.bank) { delete h.shore; contact?.(rt, ex.actor); }
      return { status: 'completed', outputs: { carrier: e.id, slot: ex.slot, phase: 'ashore', position: [...a.pose.p], ...(setDown ? { setDown: true } : {}) } };
    }
    const to = path[ex.leg];
    if (!takeDoor(c, ex.actor) || blockerAt(rt, ex.actor, to)) return { status: 'running', phase: 'leaving-wait' };
    body.outBy = rt.tick + LEAVE_LIMIT;
    if (moveToward(a, to, d.transferSpeed, dt)) ex.leg++;
    return { status: 'running', phase: 'leaving' };
  },
  // Never strands a rider: stepping out happens only on the ground, after the transfer that is under way.
  cancel(_rt, ex) { ex.stopping = true; return { ok: true, deferred: true }; },
};

type AlightExec = { actor: string; carrier: string; id: string };
/** RIDE-EXIT (soul3 continuation): a rider seated in a carrier still on the ground (parked/boarding) steps out before lift-off. It
 *  cancels the rider's own held carrier_ride, whose deferred cancel walks the body out through the door (never aloft; lift-off
 *  waits while any rider is not seated). Completes when the body is ashore. */
const alight: ActionDef<{ actor: string; carrier: string }, null, AlightExec> = {
  verb: 'carrier_alight',
  description: 'A rider seated in a carrier that is still on the ground steps out through its door before it lifts off.',
  schema: z.object({ actor: z.string().min(1), carrier: z.string().min(1) }).strict(),
  resumable: true,
  reservations: (_w, p) => [{ resource: `carrier-alight:${p.actor}`, mode: 'exclusive' }],
  plan(rt, p) {
    const e = rt.world.entities[p.carrier], c = state(e), a = rt.world.entities[p.actor], me = carried(a);
    if (!e || !c) return { ok: false, diagnostic: diag('unknown', `no carrier ${p.carrier}`) };
    if (me?.id !== e.id || me.phase !== 'seated') return { ok: false, diagnostic: diag('not-aboard', `${p.actor} is not seated in ${e.label ?? e.id}`, [p.actor]) };
    if (c.phase !== 'parked' && c.phase !== 'boarding') return { ok: false, diagnostic: diag('not-on-ground', `${e.label ?? e.id} is not on the ground; it lands by itself and riders step out then`) };
    const task = a.human?.task, rec = task ? rt.records.get(task) : undefined;
    if (!task || rec?.verb !== 'carrier_ride' || !rt.isActive(task)) return { ok: false, diagnostic: diag('no-ride', `${p.actor} holds no ride in ${e.label ?? e.id}`, [p.actor]) };
    return { ok: true, program: null };
  },
  start(rt, p, _prog, id) { rt.cancel(rt.world.entities[p.actor].human!.task!, { code: 'carrier.alight', message: 'stepping out before lift-off' }); return { actor: p.actor, carrier: p.carrier, id }; },
  step(rt, ex) {
    const me = carried(rt.world.entities[ex.actor]);
    if (!me || me.id !== ex.carrier) return { status: 'completed', outputs: { carrier: ex.carrier, phase: 'ashore' } };
    return { status: 'running', phase: me.phase };
  },
  cancel() { return { ok: true }; },
};

type DepartExec = { carrier: string; id: string };
const depart: ActionDef<{ actor: string; carrier: string }, null, DepartExec> = {
  verb: 'carrier_depart',
  description: 'A seated rider asks the boarding carrier to leave now instead of waiting for more riders.',
  schema: z.object({ actor: z.string().min(1), carrier: z.string().min(1) }).strict(),
  resumable: true,
  reservations: (_w, p) => [{ resource: `carrier-depart:${p.carrier}`, mode: 'exclusive' }],
  plan(rt, p) {
    const e = rt.world.entities[p.carrier], c = state(e), me = carried(rt.world.entities[p.actor]);
    if (!e || !c) return { ok: false, diagnostic: diag('unknown', `no carrier ${p.carrier}`) };
    if (me?.id !== e.id || me.phase !== 'seated') return { ok: false, diagnostic: diag('not-aboard', `${p.actor} is not seated in ${e.label ?? e.id}`, [p.actor]) };
    if (c.phase !== 'boarding') return { ok: false, diagnostic: diag('not-boarding', `${e.label ?? e.id} is not waiting to leave`) };
    return { ok: true, program: null };
  },
  start(rt, p, _prog, id) { const c = state(rt.world.entities[p.carrier])!; c.departAtTick = Math.min(c.departAtTick ?? rt.tick, rt.tick); delete c.hold; return { carrier: p.carrier, id }; },
  step() { return { status: 'completed', outputs: { departing: true } }; },
  cancel() { return { ok: true }; },
};
// VEHICLE-STEER (Gene 2026-10-23, #12: "a drive/ride/steer action for souls to control vehicles including hot air balloons"):
// one generic verb for every ride. A seated rider sets a destination (x, z), asks it to land, or to stop (hold here). The
// world flies/rows it there on a smooth route from where it is (the same Hermite curve, so viewers need nothing new). With
// nobody steering it keeps its own route: a hold runs out after STEER_HOVER and it rejoins its route; a balloon that landed
// away flies itself home once its riders are out. Water rides go only where open water reaches in a straight line and let
// riders off only at their own bank. Deterministic: everything is world state, built from the pose at a tick.
const STEER_AIR = 4, STEER_WATER = 1.2, STEER_CLIMB = 1.5, STEER_CRUISE = 35, STEER_HOVER = 120 * TPS, STEER_LAND_SEARCH = 30, STEER_RANGE = 1200;
const r1 = (n: number) => Math.round(n * 10) / 10;
function groundNav(rt: Runtime): GroundNav | null { return (rt.services.spatial as { ground?: GroundNav } | undefined)?.ground ?? null; }
function inExtent(g: GroundNav | null, x: number, z: number): boolean { if (!g) return true; const x0 = g.field.extent; return x >= x0[0] && z >= x0[1] && x <= x0[2] && z <= x0[3]; }
/** Ground y where a basket can set down at (x, z): dry, walkable, no building, level within 1 m over its footprint. */
function landableAt(g: GroundNav | null, x: number, z: number, fallbackY: number): number | null {
  if (!g) return fallbackY;
  const y = g.standY(x, z);
  for (let k = 0; k < 9; k++) {
    const a = k * Math.PI / 4, px = k === 8 ? x : x + 2 * dcos(a), pz = k === 8 ? z : z + 2 * dsin(a);
    if (!inExtent(g, px, pz) || g.base.medium(px, pz) !== G_WALK || g.coarseSolid(px, pz) || Math.abs(g.standY(px, pz) - y) > 1) return null;
  }
  return y;
}
/** The nearest landable spot to (x, z) within STEER_LAND_SEARCH m (rings of 4 m), or null. */
function findLanding(g: GroundNav | null, x: number, z: number, fallbackY: number): Vec3 | null {
  for (let r = 0; r <= STEER_LAND_SEARCH; r += 4) {
    const n = r === 0 ? 1 : Math.ceil(2 * Math.PI * r / 4);
    for (let i = 0; i < n; i++) {
      const a = i * 2 * Math.PI / n, px = r4(x + r * dcos(a)), pz = r4(z + r * dsin(a)), y = landableAt(g, px, pz, fallbackY);
      if (y !== null) return [px, r4(y), pz];
    }
  }
  return null;
}
/** Where a punt can row toward (x, z) in a straight line over open water: the target itself, or the last water point 3 m
 *  short of the first shore on the way; null when it cannot move that way at all. */
function waterReach(g: GroundNav | null, from: Vec3, x: number, z: number): Vec3 | null {
  const dx = x - from[0], dz = z - from[2], len = hypot(dx, dz);
  if (!g || len < 0.5) return len < 0.5 ? [...from] as Vec3 : [x, from[1], z];
  let ok = 0;
  for (let s = 1; s <= len; s += 1) { const px = from[0] + dx * s / len, pz = from[2] + dz * s / len; if (!inExtent(g, px, pz) || g.base.medium(px, pz) !== G_SWIM) break; ok = s; }
  if (ok >= len - 1) return [r4(x), from[1], r4(z)];
  const keep = ok - 3; if (keep < 2) return null;
  return [r4(from[0] + dx * keep / len), from[1], r4(from[2] + dz * keep / len)];
}
const same = (a: Vec3, b: Vec3) => hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-3;
function legTime(a: Vec3, b: Vec3, water: boolean): number {
  return Math.max(water ? 2 : 4, Math.abs(b[1] - a[1]) / STEER_CLIMB, hypot(b[0] - a[0], b[2] - a[2]) / (water ? STEER_WATER : STEER_AIR));
}
/** The route a steer flies from the carrier's pose now (keys at whole tenths of a second). */
function steerRoute(rt: Runtime, e: Entity, c: CarrierState): CarrierRoute {
  const s = c.steer!, water = !!c.bank, p0 = [...e.pose.p] as Vec3, pts: Vec3[] = [p0];
  let tail: RouteKey[] = [];
  if (s.ret) {
    const a = s.away;
    if (water) pts.push(...[...a.wake].reverse());
    else if (a.elapsed > 0 && Object.values(c.seats).some(Boolean)) pts.push(routePosition(a.route, a.elapsed));
    else { const cy = Math.max(p0[1], c.home[1] + STEER_CRUISE); if (p0[1] < cy - 1) pts.push([p0[0], cy, p0[2]]); pts.push([c.home[0], cy, c.home[2]], [...c.home] as Vec3); }
    if ((water || Object.values(c.seats).some(Boolean)) && a.elapsed > 0) { const t0 = a.elapsed / TPS; tail = a.route.keys.filter(k => k.t > t0 + 0.05).map(k => ({ t: k.t - t0, p: [...k.p] as Vec3 })); }
    else if (!same(pts[pts.length - 1], c.home)) pts.push([...c.home] as Vec3);
  } else { pts.push([...s.to] as Vec3); if (s.land && !same(s.land, s.to)) pts.push([...s.land] as Vec3); }
  const keys: RouteKey[] = [{ t: 0, p: pts[0] }];
  let t = 0;
  for (let i = 1; i < pts.length; i++) { if (same(pts[i], pts[i - 1]) && i < pts.length - 1) continue; t = r1(t + legTime(keys[keys.length - 1].p, pts[i], water)); keys.push({ t, p: pts[i] }); }
  for (const k of tail) keys.push({ t: r1(t + k.t), p: k.p });
  return { id: s.ret ? 'steer-return' : 'steer', keys };
}
function startReturn(c: CarrierState, by: string | null = null) {
  c.steer = { by, to: [...c.home] as Vec3, land: [...c.home] as Vec3, built: false, ret: true, away: c.steer!.away };
}

/** A steer is over: the ride gets its own route back (a steer flew a 'steer'/'steer-return' route in its place), so the next
 *  boarding qualifies and the next unsteered trip flies the ride's own route again. */
function endSteer(c: CarrierState): void {
  if (c.steer) c.route = c.steer.away.route;
  delete c.steer;
}
type SteerParams = { actor: string; carrier: string; x?: number; z?: number; land?: boolean; stop?: boolean };
type SteerPlan = { to: Vec3; land?: Vec3; ret?: true; mode: 'to' | 'land' | 'stop' | 'return'; seconds: number };
const steer: ActionDef<SteerParams, SteerPlan, { carrier: string; id: string; plan: SteerPlan }> = {
  verb: 'carrier_steer',
  description: 'A seated rider steers the ride: go toward (x, z) (and land there), land here, or stop and hold. Without steering the ride follows its own route.',
  schema: z.object({ actor: z.string().min(1), carrier: z.string().min(1), x: z.number().finite().optional(), z: z.number().finite().optional(), land: z.boolean().optional(), stop: z.boolean().optional() }).strict(),
  resumable: true,
  reservations: (_w, p) => [{ resource: `carrier-steer:${p.carrier}`, mode: 'exclusive' }],
  plan(rt, p) {
    const e = rt.world.entities[p.carrier], c = state(e), me = carried(rt.world.entities[p.actor]);
    if (!e || !c) return { ok: false, diagnostic: diag('unknown', `no carrier ${p.carrier}`) };
    const name = e.label ?? e.id, water = !!c.bank, g = groundNav(rt);
    if (me?.id !== e.id || me.phase !== 'seated') return { ok: false, diagnostic: diag('not-aboard', `${p.actor} is not seated in ${name}`, [p.actor]) };
    if (c.phase !== 'aloft' && c.phase !== 'boarding') return { ok: false, diagnostic: diag('on-ground', `${name} is on the ground; its riders are stepping out`, [e.id]) };
    const other = c.steer?.by && c.steer.by !== p.actor && carried(rt.world.entities[c.steer.by])?.id === e.id ? c.steer.by : null;
    if (other) return { ok: false, diagnostic: diag('steered', `${rt.world.entities[other]?.label ?? other} is steering ${name}`, [other]) };
    if (c.phase === 'boarding' && c.hold) return { ok: false, diagnostic: diag('keeping-place', `${name} is waiting for an invited companion`, [e.id]) };
    const hasXZ = p.x !== undefined && p.z !== undefined;
    if ((p.x === undefined) !== (p.z === undefined) || [hasXZ, !!p.stop, !!p.land && !hasXZ].filter(Boolean).length !== 1 || (p.stop && p.land))
      return { ok: false, diagnostic: diag('params', 'steer takes a destination (x, z, optional land), land, or stop') };
    const here = e.pose.p, home = c.home;
    if ((p.stop || (p.land && !hasXZ && !water)) && c.phase === 'boarding') return { ok: false, diagnostic: diag('not-aloft', `${name} has not left yet`, [e.id]) };
    if (p.stop) return { ok: true, program: { to: [...here] as Vec3, mode: 'stop', seconds: 0 } };
    if (water && p.land) {
      if (hasXZ && hypot(p.x! - home[0], p.z! - home[2]) > 6) return { ok: false, diagnostic: diag('no-landing-spot', `${name} lets riders off only at its own bank; steer it to land to row back there`, [e.id]) };
      return { ok: true, program: { to: [...home] as Vec3, land: [...home] as Vec3, ret: true, mode: 'return', seconds: 0 } };
    }
    const x = hasXZ ? p.x! : here[0], zz = hasXZ ? p.z! : here[2];
    if (!inExtent(g, x, zz) || hypot(x - home[0], zz - home[2]) > STEER_RANGE) return { ok: false, diagnostic: diag('out-of-bounds', `(${Math.round(x)}, ${Math.round(zz)}) is outside the world ${name} can travel`, [e.id]) };
    if (water) {
      const to = waterReach(g, here, x, zz);
      if (!to) return { ok: false, diagnostic: diag('no-water-route', `there is no open water from here toward (${Math.round(x)}, ${Math.round(zz)})`, [e.id]) };
      return { ok: true, program: { to, mode: 'to', seconds: Math.round(legTime(here, to, true)) } };
    }
    const groundY = (px: number, pz: number) => g ? g.standY(px, pz) : home[1];
    let land: Vec3 | undefined;
    if (p.land) {
      const l = findLanding(g, x, zz, home[1]);
      if (!l) return { ok: false, diagnostic: diag('no-landing-spot', `nowhere clear, dry and level to set down within ${STEER_LAND_SEARCH} m of (${Math.round(x)}, ${Math.round(zz)})`, [e.id]) };
      land = l;
    }
    const cy = hasXZ ? Math.max(here[1], groundY(here[0], here[2]) + STEER_CRUISE, groundY(x, zz) + STEER_CRUISE) : Math.max(here[1], (land?.[1] ?? 0) + 5);
    const to: Vec3 = land ? [land[0], r4(cy), land[2]] : [r4(x), r4(cy), r4(zz)];
    return { ok: true, program: { to, land, mode: hasXZ ? 'to' : 'land', seconds: Math.round(legTime(here, to, false) + (land ? legTime(to, land, false) : 0)) } };
  },
  start(rt, p, prog, id) {
    const e = rt.world.entities[p.carrier], c = state(e)!;
    // where it leaves its own route (or, steered again while flying itself back, that return route), and the steered legs
    const away = c.steer && !c.steer.ret ? c.steer.away : { route: c.route, elapsed: c.phase === 'aloft' ? c.elapsed : 0, wake: [] as Vec3[] };
    if (!prog.ret) away.wake.push([...e.pose.p] as Vec3);
    c.steer = { by: p.actor, to: prog.to, ...(prog.land ? { land: prog.land } : {}), built: false, ...(prog.ret ? { ret: true as const } : {}), away };
    if (c.phase === 'boarding') { c.departAtTick = Math.min(c.departAtTick ?? rt.tick, rt.tick); delete c.hold; }
    return { carrier: p.carrier, id, plan: prog };
  },
  step(_rt, ex) { const q = ex.plan; return { status: 'completed', outputs: { steering: ex.carrier, mode: q.mode, to: [q.to[0], q.to[2]], ...(q.land ? { landAt: [q.land[0], q.land[2]] } : {}), seconds: q.seconds } }; },
  cancel() { return { ok: true }; },
};
export const CARRIER_ACTIONS: ActionDef[] = [ride, alight, depart, steer] as ActionDef[];

function landingClear(rt: Runtime, e: Entity, c: CarrierState, d: CarrierDef, at: Vec3 = c.home): boolean {
  for (const o of Object.values(rt.world.entities)) {
    if (!o.human || carried(o)?.id === e.id) continue;
    if (Math.abs(o.pose.p[1] - at[1]) <= 1.9 && hypot(o.pose.p[0] - at[0], o.pose.p[2] - at[2]) < d.landingClear) return false;
  }
  return true;
}
/** Advance every carrier one tick (call before the runtime steps). No carriers → no effect. `table`: the caller's
 *  current listing of the world's entity table (S1 r2: the engine lists once and hands the same listing to the runtime
 *  step; this function changes entities' fields, never the table's entries). */
export function stepCarriers(rt: Runtime, table?: EntityTable | null): void {
  // a snapshot, as Object.values was (0.46 -> 0.17 ms a tick on Eden 2026). S1 r2: only the entities with a ride state
  // (fixed for an entity's life), found again without reading every entity while the table holds the same objects
  // (world/entity-list.ts stableIndices); only a ride looks its def up in the catalogue.
  const list = table && table.entities === rt.world.entities ? table.list : entityList(rt.world);
  for (const i of stableIndices(rt.world.entities, 'carrier/1 rides', list, null, (e) => !!state(e)).idx) {
    const e = list[i], c = state(e)!;
    const d = carrierDef(e); if (!d) continue;
    const riders = Object.values(c.seats).filter((a): a is string => !!a);
    const tick = rt.tick;
    if (c.phase === 'boarding') {
      if (!riders.length) { c.phase = 'parked'; c.departAtTick = null; c.phaseTick = tick; delete c.hold; continue; }
      if (c.hold) {
        // together/1: wait for invited companions (all seated), or until the hold runs out / its host is no longer aboard
        const companionsIn = c.hold.filled >= c.hold.seats && riders.every(a => carried(rt.world.entities[a])?.phase === 'seated');
        if (companionsIn || tick >= c.hold.untilTick || !riders.includes(c.hold.by)) {
          if (companionsIn) c.departAtTick = tick + 3 * TPS;   // everyone is in: a moment to settle, then up
          delete c.hold;
        } else continue;
      }
      if (riders.length === d.seats.length) c.departAtTick = Math.min(c.departAtTick ?? tick, tick + 5 * TPS);
      const allSeated = riders.every(a => carried(rt.world.entities[a])?.phase === 'seated');
      if (allSeated && c.departAtTick !== null && tick >= c.departAtTick) {
        c.phase = 'aloft'; c.phaseTick = tick; c.elapsed = 0; c.flights++; c.departAtTick = null; e.phase = 'carried';
      }
      continue;
    }
    if (c.phase === 'landed') {
      // A rider whose ride step is gone (no action holds its seat) would keep the carrier landed and the body "riding" for
      // ever: once the step-out limit has passed since landing, the world sets that body down at its exit.
      if (tick - c.phaseTick > LEAVE_LIMIT) for (const [slot, actor] of Object.entries(c.seats)) {
        const a = actor ? rt.world.entities[actor] : undefined;
        if (!actor || rt.holder(`carrier-seat:${e.id}#${slot}`).length) continue;
        c.seats[slot] = null; freeDoor(c, actor); if (!a?.human || carried(a)?.id !== e.id) continue;
        const h = a.human, def = d.seats.find(s => s.id === slot), exit = c.bank?.exits[slot] ?? (def ? at(e, def.exit) : doorPoint(e)!), p = setDownSpot(rt, actor, e, exit);
        delete (h as { carrier?: CarriedBody }).carrier; delete h.task; delete h.baseActivity; delete h.seatHeight; delete h.speed; h.activity = 'idle';
        a.pose.p = [p[0], c.bank ? exit[1] : e.pose.p[1], p[2]]; acknowledgeRelocation(rt, actor);
        if (c.bank) { delete h.shore; (rt.services.carrierBankContact as ((rt: Runtime, actor: string) => void) | undefined)?.(rt, actor); }
      }
      if (!Object.values(c.seats).some(Boolean)) {
        // VEHICLE-STEER: a ride that landed away from home flies itself back empty once its riders are out
        if (c.steer?.land && !same(c.steer.land, c.home)) { startReturn(c); c.phase = 'aloft'; e.phase = 'carried'; c.elapsed = 0; }
        else { endSteer(c); c.phase = 'parked'; }
        c.phaseTick = tick;
      }
      continue;
    }
    if (c.phase !== 'aloft') continue;
    const s = c.steer;
    if (s && !s.built) { c.route = steerRoute(rt, e, c); c.elapsed = 0; s.built = true; }
    const end = routeTicks(c.route);
    if (s && !s.land && c.elapsed >= end) {   // holding where a rider steered it; with no new steer it rejoins its own route
      s.hoverUntil ??= tick + STEER_HOVER;
      if (tick >= s.hoverUntil) startReturn(c);
      continue;
    }
    const L = s?.land ?? c.home, away = !same(L, c.home), next = routePosition(c.route, c.elapsed + 1);
    c.holding = (!s || !!s.land) && next[1] - L[1] < LANDING_HEIGHT && c.elapsed + 1 > (e.def === 'rowing-punt' ? end - TPS : end / 2) && !landingClear(rt, e, c, d, L);
    if (c.holding) continue;
    c.elapsed++;
    // yaw follows travel high up (World: "yaw follows travel") and turns back to the home yaw low down, so it parks as it left; ≤ 0.5 rad/s.
    const dx = next[0] - e.pose.p[0], dz = next[2] - e.pose.p[2], follow = e.def === 'rowing-punt' ? c.elapsed < end - 4 * TPS || (!!s && !s.land) : next[1] - L[1] > 10;
    const want = follow && hypot(dx, dz) > 0.02 / TPS ? heading([dx, dz]) : c.yaw;
    const turn = angleDelta(e.pose.yaw, want); e.pose.yaw = wrapAngle(e.pose.yaw + Math.max(-0.5 / TPS, Math.min(0.5 / TPS, turn)));
    e.pose.p = next;
    for (const a of riders) { const b = rt.world.entities[a], s = seatPose(e, carried(b)!.slot); if (b && s) { b.pose.p = s.p; b.pose.yaw = s.yaw; } }
    if (s && !s.land) continue;   // a steer without land ends in the air (or afloat): the hold above takes it from the next tick
    if (c.elapsed >= end && away) { e.pose.p = [...L] as Vec3; delete e.phase; c.phase = 'landed'; c.phaseTick = tick; c.elapsed = end; continue; }   // steered down away from home: as it is
    if (c.elapsed >= end && Math.abs(angleDelta(e.pose.yaw, c.yaw)) > 1e-6) { c.elapsed = end - 1; continue; }   // finish turning before touching down
    if (c.elapsed >= end) { endSteer(c); e.pose.p = [...c.home] as Vec3; e.pose.yaw = c.yaw; delete e.phase; c.phase = 'landed'; c.phaseTick = tick; c.elapsed = end; }
  }
}

/** Seats, riders and bodies agree; a seated rider sits exactly in its seat frame. */
export const carrierInvariant: Invariant = (rt: Runtime) => {
  const out: Diagnostic[] = [];
  for (const e of relevantEntities(rt.world)) {   // riders (a body) and rides (ride state) only (world/relevant.ts)
    const b = carried(e);
    if (b) { const v = rt.world.entities[b.id]; if (state(v)?.seats[b.slot] !== e.id) out.push(diag('rider-mismatch', `${e.id} rides ${b.id}#${b.slot}, which does not hold it`, [e.id, b.id])); }
    const c = state(e); if (!c) continue;
    for (const [slot, a] of Object.entries(c.seats)) {
      if (!a) continue; const r = rt.world.entities[a], rb = carried(r);
      if (rb?.id !== e.id || rb.slot !== slot) { out.push(diag('seat-mismatch', `${e.id}#${slot} holds ${a}, who is not in it`, [e.id, a])); continue; }
      if (rb.phase === 'seated') { const s = seatPose(e, slot)!; if (hypot(r.pose.p[0] - s.p[0], r.pose.p[1] - s.p[1], r.pose.p[2] - s.p[2]) > 0.2) out.push(diag('rider-off-seat', `${a} left its seat in ${e.id}`, [e.id, a])); }
    }
    if (c.phase === 'aloft' && Object.values(c.seats).some(a => a && carried(rt.world.entities[a])?.phase !== 'seated')) out.push(diag('unseated-aloft', `${e.id} is aloft with a rider not seated`, [e.id]));
  }
  return out;
};

/** E2 (logged rules fact `carrierRerouteV1`): a parked carrier with nobody aboard or at its door moves to a new home and
 *  flies new route keys from its next flight: a god's ride whose attraction was resized or moved (a bigger ferris wheel
 *  boards further out and goes round a bigger circle). The spec is an install spec for the same id and def; refused
 *  (diagnostic, no change) while busy, or for a spec carrierEntity itself would refuse. */
export function rerouteCarrier(world: { entities: Record<string, Entity> }, spec: CarrierInstallSpec, tick: number): Diagnostic | null {
  const e = world.entities[spec.id], c = state(e);
  if (!e || !c) return diag('unknown-carrier', `no carrier ${spec.id}`);
  if (spec.def !== e.def) return diag('def-mismatch', `${spec.id} is a ${e.def}, not a ${spec.def}`);
  if (c.phase !== 'parked' || Object.values(c.seats).some(Boolean) || c.doorBy || c.hold) return diag('carrier-busy', `${spec.id} has riders or boarders; it re-routes once parked and empty`, [spec.id]);
  const next = carrierEntity(spec, tick); if ('code' in next) return next;
  const n = state(next)!;
  c.home = n.home; c.yaw = n.yaw; c.route = n.route; c.elapsed = 0; c.departAtTick = null; c.holding = false;
  if (spec.bank) c.bank = n.bank; else delete c.bank;
  e.pose = structuredClone(next.pose);
  return null;
}

/** CN5 (logged rules fact `carrierRouteV1`): a parked carrier with nobody aboard flies a different named route from its next
 *  flight (e.g. the brisk eden loop); refused (no change) while boarding, aloft or landed, or for a route not ending at home. */
export function setCarrierRoute(world: { entities: Record<string, Entity> }, id: string, routeId: string): boolean {
  const e = world.entities[id], c = state(e); if (!e || !c || c.phase !== 'parked' || Object.values(c.seats).some(Boolean)) return false;
  const route = routeAt(routeId, c.home); if (!route) return false;
  const a = route.keys[0].p, b = route.keys[route.keys.length - 1].p;
  if (hypot(a[0] - c.home[0], a[1] - c.home[1], a[2] - c.home[2]) > 1e-6 || hypot(b[0] - c.home[0], b[1] - c.home[1], b[2] - c.home[2]) > 1e-6) return false;
  c.route = route; c.elapsed = 0; return true;
}
