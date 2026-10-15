// Soul navigation to god-built named things (party lane P4). On an entity world a Soul can walk to anything the god
// built and named, by its path: `walk:fountain`, `walk:rose-house` (in at its front door), `walk:rose-house/living`
// (that room's floor), `walk:plaza/bench-2` (the bench's front). Each resolves to a standing point the engine can plan
// to: inside a building's open front door (outside it when the door is closed), a room's floor, the approach to a seat,
// a fountain's rim, the nearest shore of a pond.
//
// World-engine side only: the engine bridge offers these as ordinary `walk:<path>` capabilities through the ledger's
// existing world-profile hook (as the ground host offers `walk:flag-<name>`), labelled with what each thing is and what
// it is by, so the ledger's own vocabulary resolves plain words ("walk to the fountain", "go into rose-house",
// "sit on the bench by the pond") to them. No edge contract change: no new verbs, fields or routes.
//
// Pure reads over the entity model and the engine's standing grids; nothing here is logged or changes the world.
import type { Entity, StoredDef, WorldModel } from '@sim/world-compiler';
import type { EdgeCapability, EdgeSoul } from '../edge/contract.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Vec2 = [number, number];
type Step = { verb: string; params: Record<string, unknown> };
type Plans = Map<string, { label: string; steps: Step[]; seconds?: boolean }>;
type Engine = {
  world: { tick: number; entities: Record<string, any> };
  standableNearV1(at: Vec2, level?: number, except?: string, minClear?: number, maxRing?: number): Vec2 | null;
  reachV1?(from: { p: Vec2; level?: number }, to: { p: Vec2; level?: number }): { ok: boolean };
};
export type NavHost = {
  model: WorldModel;
  /** Changes when anything but a body's pose changed (the engine bridge's version); else the model's editSeq. */
  version?: () => number;
  engine: Engine;
  /** Engine level of a standing height at (x, z): 0 on the ground (any terrain height), else a floor's level. */
  levelAt(x: number, z: number, y: number): number;
  /** Things the engine owns (bodies and what they carry). */
  engineOwned(e: Entity): boolean;
  /** R4-INFO: the place (places.ts) a thing is, if it is one: its walk then targets that place (exits, map, `via`). */
  placeOf?(ref: string): string | undefined;
};

export type ThingKind = 'building' | 'room' | 'seat' | 'water' | 'area' | 'path' | 'thing';
/** A named god-built thing (or a room of a building) a Soul can walk to. */
export type Thing = {
  /** What the Soul names: the entity's path (`plaza/bench-2`) or `<building path>/<room id>`. */
  ref: string;
  id: string;
  room?: string;
  name: string;
  kind: ThingKind;
  /** e.g. "a cottage", "a bench", "Living room of rose-house". */
  what: string;
  /** Words it answers to (names, def name, tags, parent's name). */
  words: string[];
  /** Reference point (for distances and "by the X") and its level. */
  at: Vec2;
  level: number;
  /** Area things: their outline; path things: their centre line + width. */
  area?: Vec2[];
  path?: Vec2[];
  width?: number;
  /** Rooms: their world outline (for "you are in"). Buildings: their rooms' refs. */
  poly?: Vec2[];
  /** Room geometry in the building frame, for rotation-invariant fallback sampling only when needed. */
  roomFrame?: { poly: Vec2[]; at: Vec2; origin: Vec2; yaw: number; scale: number };
  rooms?: string[];
  /** Standing points to approach from (seat fronts, a fountain's rim; a building's door approach), on `level`. */
  stands?: Vec2[];
  /** Buildings: just inside the front door, and whether that door is open now. */
  inside?: Vec2;
  doorOpen?: boolean;
  /** Has a seat (sit:<id> is offered near it). */
  seat?: boolean;
  /** Piers, decks, bridges: standing points ON the deck, preferred in order (F1). */
  deck?: Vec2[];
  /** Rooms: where the building is entered from outside (its front door's approach), for the reachability check. */
  entry?: { p: Vec2; level: number };
};

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const SHOW = 120;            // walk capabilities offered: the nearest this many named things (plus rooms of near buildings)
const ROOMS_WITHIN = 80;
const BUILDINGS_WITHIN = 150;
const STROLL_AREA = 150;     // m²: an open area this big offers a stroll through it (the ledger strolls places ≥ 250 m²)     // rooms of buildings within this many metres are offered too
const STOP = new Set(['the', 'a', 'an', 'to', 'of', 'in', 'at', 'on']);
const words = (s: string) => s.toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w));

const polyArea = (p: Vec2[]) => Math.abs(p.reduce((s, [x, z], i) => { const [x2, z2] = p[(i + 1) % p.length]; return s + x * z2 - x2 * z; }, 0)) / 2;
/** MARSLIVED: the height a thing is reached from — the floor its support stands on. A cup on a tea table is reached from
 *  the table's floor, not at the table top's height: a 0.55 m top matched Mimos's 0.53 m raised floor (its own level),
 *  so Souls were sent up there to fetch a cup from a ground-floor table, and found no standing room. */
export function supportY(m: { entities: Map<string, Entity>; slotsOf(e: Entity): { id: string; kind: string }[]; worldPose(e: Entity): { y: number } }, e: Entity): number {
  let x = e;
  for (let i = 0; i < 8 && x.in.parent !== 'world'; i++) {
    const p = m.entities.get(x.in.parent); if (!p) break;
    const kind = m.slotsOf(p).find((s) => s.id === x.in.slot)?.kind;
    if (!kind || kind === 'room' || kind === 'floor' || kind === 'stand') break;   // in a building's room: on its floor
    x = p;
  }
  return m.worldPose(x).y;
}
function centroid(pts: Vec2[]): Vec2 { let x = 0, z = 0; for (const p of pts) { x += p[0]; z += p[1]; } return [x / pts.length, z / pts.length]; }
function inPoly(x: number, z: number, poly: Vec2[]) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; }
/** Nearest point on a polyline (closed when `loop`). */
function nearestOn(pts: Vec2[], p: Vec2, loop: boolean): { q: Vec2; d: number; dir: Vec2 } {
  let best: { q: Vec2; d: number; dir: Vec2 } = { q: pts[0], d: Infinity, dir: [1, 0] };
  const n = loop ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz;
    const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L)) : 0, q: Vec2 = [a[0] + dx * t, a[1] + dz * t];
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < best.d) { const l = Math.sqrt(L) || 1; best = { q, d, dir: [dx / l, dz / l] }; }
  }
  return best;
}
const shortDef = (def: StoredDef) => def.name.replace(/^core-/, '').replace(/^ew-/, '');
const article = (w: string) => (/^[aeiou]/.test(w) ? `an ${w}` : `a ${w}`);

export class GodNav {
  private h: NavHost;
  private cache: { key: string; things: Thing[]; byRef: Map<string, Thing> } | null = null;
  private goals = new Map<string, { tick: number; key: string; goal: { p: Vec2; level: number } | null }>();
  constructor(h: NavHost) { this.h = h; }

  // ------------------------------------------------------------------ what is there

  /** Every named thing (and room) in the entity world, rebuilt when the world changes. */
  things(): Thing[] { return this.index().things; }
  thing(ref: string): Thing | undefined { return this.index().byRef.get(ref); }
  private index() {
    const m = this.h.model, key = `${this.h.version?.() ?? m.editSeq}:${m.entities.size}`;
    if (this.cache?.key === key) return this.cache;
    const things: Thing[] = [], waters = new Map(m.ground().waters.map((w: any) => [w.id, w]));
    for (const e of m.entities.values()) {
      if (!e.name) continue;
      const def = m.resolvedDef(e.def); if (!def || def.components.body || /^core[-/]flag@/.test(def.ref) || this.h.engineOwned(e)) continue;
      try { things.push(...this.describe(e, def, waters.get(e.id))); } catch { /* one odd thing never hides the rest */ }
    }
    const byRef = new Map<string, Thing>();
    for (const t of things) if (!byRef.has(t.ref)) byRef.set(t.ref, t);
    this.cache = { key, things: [...byRef.values()], byRef };
    this.goals.clear();
    return this.cache;
  }
  private describe(e: Entity, def: StoredDef, water: any): Thing[] {
    const m = this.h.model, baked = m.bake(def, e.params ?? {}, e.seed ?? 0, e.shape), wp = m.worldPose(e), ref = m.pathOf(e.id);
    const c = Math.cos(wp.yaw), s = Math.sin(wp.yaw);
    const toWorld = (x: number, z: number): Vec2 => [r3(wp.x + (x * c + z * s) * wp.s), r3(wp.z + (-x * s + z * c) * wp.s)];
    const kind0 = shortDef(def), parent = e.in.parent !== 'world' ? m.entities.get(e.in.parent) : undefined;
    const pname = parent?.name ? [parent.name] : [];
    const base = { id: e.id, name: e.name!, words: [...new Set([...words(e.name!), ...words(kind0), ...def.tags.flatMap(words), ...pname.flatMap(words)])] };
    const sh = e.shape as { area?: Vec2[]; path?: Vec2[]; width?: number } | undefined;
    if (water || (def.form !== 'point' && e.in.parent === 'world' && sh)) {
      const area = (water?.area ?? sh?.area) as Vec2[] | undefined, path = (water?.path ?? sh?.path) as Vec2[] | undefined;
      const width = Number(water?.w ?? water?.width ?? sh?.width ?? 3);
      const at = area ? centroid(area) : path ? path[Math.floor(path.length / 2)] : [wp.x, wp.z] as Vec2;
      const kind: ThingKind = water ? 'water' : area ? 'area' : 'path';
      // F1: a pier, a deck or a bridge is walked ONTO: its end platform (a pier's `end` stand), else the middle of its
      // deck — not the nearest point of its line, which is the shore end
      const deck = !water && def.components.floor ? [...baked.slots.filter((x) => x.kind === 'stand').map((x) => [r3(x.p[0]), r3(x.p[2])] as Vec2), ...(area ? [centroid(area)] : path ? [path[Math.floor(path.length / 2)], ...(path.length === 2 ? [[(path[0][0] + path[1][0]) / 2, (path[0][1] + path[1][1]) / 2] as Vec2] : [])] : [])] : [];
      return [{ ...base, ref, kind, what: article(kind0), at: deck[0] ?? at, level: 0, ...(area ? { area } : {}), ...(path ? { path, width } : {}), ...(deck.length ? { deck } : {}) }];
    }
    const y = wp.y, level = this.h.levelAt(wp.x, wp.z, supportY(m, e));
    // buildings: rooms (ground floor first), a door approach from outside
    const rooms = (baked.rooms ?? []).filter((r) => r.polygon?.length >= 3);
    if (rooms.length) {
      const out: Thing[] = [];
      const doors = (baked.openings ?? []).filter((o) => o.kind === 'door' && (o.level ?? 0) === 0);
      // the front door: named so, else the ground-floor door farthest from the building's centre (an outer wall)
      const front = doors.find((o) => /front|main|entr/.test(o.id)) ?? [...doors].sort((a, b) => Math.hypot(b.at[0], b.at[1]) - Math.hypot(a.at[0], a.at[1]))[0];
      const stands: Vec2[] = [];
      const frontSlot = baked.slots.find((x) => x.kind === 'stand' && /front|door|entr/.test(x.id));
      let inside: Vec2 | undefined, doorOpen = false;
      if (front) {
        // An off-centre door need not face away from the building's centre. Its opening yaw is the outward normal
        // in the building frame; the same transform as the walls/slots then handles any enclosing world yaw.
        const ux = Math.sin(front.yaw), uz = Math.cos(front.yaw);
        stands.push(toWorld(front.at[0] + ux * 1.2, front.at[1] + uz * 1.2));
        inside = toWorld(front.at[0] - ux * 1.0, front.at[1] - uz * 1.0);
        const st = ((e.state?.doors ?? {}) as Record<string, unknown>)[front.id];
        doorOpen = st === 'open' || (st === undefined && front.state !== 'closed' && !(def.components.opening && e.state?.open === false));
      }
      if (frontSlot) stands.push(toWorld(frontSlot.p[0], frontSlot.p[2]));
      const roomRefs: string[] = [];
      for (const r of rooms) {
        const rref = `${ref}/${r.id}`; if (m.get(rref)) continue; // a child named like a room keeps its name
        const slot = baked.slots.find((x) => x.id === r.id);
        const local = slot ? [slot.p[0], slot.p[2]] as Vec2 : centroid(r.polygon as Vec2[]);
        // a room slot's outline is relative to the slot; the baked room's own outline is in the building's frame
        const sp = (slot as { polygon?: Vec2[] } | undefined)?.polygon;
        const localPoly: Vec2[] = sp?.length ? sp.map(([a, b]) => [slot!.p[0] + a, slot!.p[2] + b]) : r.polygon as Vec2[];
        const poly = localPoly.map(([a, b]) => toWorld(a, b));
        const roomFrame = { poly: localPoly, at: local, origin: [wp.x, wp.z] as Vec2, yaw: wp.yaw, scale: wp.s };
        const ry = wp.y + (r.y ?? 0) * wp.s, at = toWorld(local[0], local[1]);
        const rname = r.name ?? r.id, floor = r.floor ?? 0;
        roomRefs.push(rref);
        out.push({ id: e.id, room: r.id, ref: rref, name: `${e.name}/${r.id}`, kind: 'room', what: `${rname} of ${e.name}${floor ? `, floor ${floor}` : ''}`,
          words: [...new Set([...words(r.id), ...words(rname), ...base.words, 'room', 'inside'])], at, level: this.h.levelAt(at[0], at[1], ry), poly, roomFrame, ...(stands[0] ? { entry: { p: stands[0], level } } : {}) });
      }
      // the room the front door opens into goes first (the entrance)
      if (front) { const fa = toWorld(front.at[0], front.at[1]); roomRefs.sort((a, b) => { const A = out.find((t) => t.ref === a)!, B = out.find((t) => t.ref === b)!; return (A.level - B.level) || (polyDist(A.poly!, fa) - polyDist(B.poly!, fa)); }); }
      out.unshift({ ...base, ref, kind: 'building', what: article(kind0), at: [wp.x, wp.z], level, stands, ...(inside ? { inside, doorOpen } : {}), rooms: roomRefs, words: [...base.words, 'building', 'house'] });
      return out;
    }
    // seats: approach in front of each seat; stand slots (a fountain's rim): those points
    const seats = baked.slots.filter((x) => x.kind === 'seat'), standSlots = baked.slots.filter((x) => x.kind === 'stand');
    const stands: Vec2[] = [
      ...seats.map((x) => toWorld(x.p[0] + Math.sin(x.yaw) * 0.75, x.p[2] + Math.cos(x.yaw) * 0.75)),
      ...standSlots.map((x) => toWorld(x.p[0], x.p[2])),
    ];
    return [{ ...base, ref, kind: seats.length ? 'seat' : 'thing', what: `${article(kind0)}${parent?.name ? ` in ${m.pathOf(parent.id)}` : ''}`, at: [r3(wp.x), r3(wp.z)], level, ...(stands.length ? { stands } : {}), ...(seats.length ? { seat: true } : {}) }];
  }

  /** Metres from a point to a thing (0 inside an area; to the line of a path; to its outline for a room). */
  distance(t: Thing, p: Vec2): number {
    if (t.area) return inPoly(p[0], p[1], t.area) ? 0 : nearestOn(t.area, p, true).d;
    if (t.path) return Math.max(0, nearestOn(t.path, p, false).d - (t.width ?? 3) / 2);
    if (t.poly) return inPoly(p[0], p[1], t.poly) ? 0 : nearestOn(t.poly, p, true).d;
    return Math.hypot(t.at[0] - p[0], t.at[1] - p[1]);
  }

  /** Where a Soul standing at `me` goes for this thing: a clear standing point on a level (null: no standing room). */
  goal(t: Thing, me: Vec2, except?: string): { p: Vec2; level: number } | null {
    const E = this.h.engine, tick = E.world.tick;
    // a Soul-dependent goal (the shore nearest me, the nearest point of a road) is never cached
    // MARSLIVED: a room's goal is refined live round whoever already stands there (roomGoal itself is cached per version)
    const mine = t.kind === 'water' || t.kind === 'room' || (t.kind === 'path' && !t.deck?.length) || (t.stands?.length ?? 0) > 1;
    const key = `${t.ref}|${mine ? `${Math.round(me[0])},${Math.round(me[1])}` : ''}`;
    const hit = this.goals.get(key); if (hit && tick - hit.tick < 50) return hit.goal;
    const near = (at: Vec2, level: number, ring = 24) => { const p = E.standableNearV1(at, level, except, 0.4, ring); return p ? { p: [r2(p[0]), r2(p[1])] as Vec2, level } : null; };
    let goal: { p: Vec2; level: number } | null = null;
    if (t.kind === 'water') {
      // the nearest shore to me, a little outside the water's edge
      const edge = t.area ? nearestOn(t.area, me, true) : nearestOn(t.path!, me, false);
      const away: Vec2 = t.area ? (() => { const c = centroid(t.area!), dx = edge.q[0] - c[0], dz = edge.q[1] - c[1], n = Math.hypot(dx, dz) || 1; return [dx / n, dz / n] as Vec2; })()
        : (() => { const n: Vec2 = [-edge.dir[1], edge.dir[0]], side = Math.sign((me[0] - edge.q[0]) * n[0] + (me[1] - edge.q[1]) * n[1]) || 1; return [n[0] * side, n[1] * side] as Vec2; })();
      const off = t.area ? 1.5 : (t.width ?? 3) / 2 + 1.5;
      goal = near([edge.q[0] + away[0] * off, edge.q[1] + away[1] * off], 0, 16);
    } else if (t.deck?.length) {
      for (const d of t.deck) { goal = near(d, 0, 6); if (goal) break; }
    } else if (t.kind === 'path') {
      goal = near(nearestOn(t.path!, me, false).q, 0, 16);
    } else if (t.kind === 'area') {
      goal = inPoly(me[0], me[1], t.area!) ? near(me, 0, 8) : near(t.at, 0, 40);
    } else if (t.kind === 'room') {
      // the room's reachable standing point, moved aside when another body already stands on it (two Souls told to go
      // into the tea room do not queue for one spot)
      const base = this.roomGoal(t, near), free = base ? near(base.p, base.level, 6) : null;
      goal = free && (!t.poly || inPoly(free.p[0], free.p[1], t.poly)) ? free : base;
    } else if (t.kind === 'building' && t.inside && t.doorOpen) {
      // in at the front door: standing room just inside it (the room it opens into); else its approach outside
      goal = near(t.inside, 0, 4);
      for (const s of t.stands ?? []) { if (goal) break; goal = near(s, t.level, 6); }
    } else {
      // a door approach, a seat's front, a fountain's rim: the nearest to me with standing room; else around the thing
      const stands = [...(t.stands ?? [])].sort((a, b) => Math.hypot(a[0] - me[0], a[1] - me[1]) - Math.hypot(b[0] - me[0], b[1] - me[1]));
      for (const s of stands) { goal = near(s, t.level, 6); if (goal) break; }
      goal ??= near(t.at, t.level, 40);
    }
    this.goals.set(key, { tick, key, goal });
    return goal;
  }

  /** F1: a room's goal is standing room inside it that the front door reaches (furniture can close off its middle):
   *  its centre if reachable, else the reachable spot inside nearest the centre; null (and `blocked`) when furniture
   *  closes the whole room off. Cached per world version (furniture moves only with edits). */
  private roomGoal(t: Thing, near: (at: Vec2, level: number, ring?: number) => { p: Vec2; level: number } | null): { p: Vec2; level: number } | null {
    const E = this.h.engine;
    const centre = near(t.at, t.level, 40);
    if (!t.entry || !E.reachV1) return centre;
    const key = `${this.cache?.key}|${t.ref}`, hit = this.rooms.get(key); if (hit !== undefined) return hit;
    const reach = (p: Vec2) => { const r = E.reachV1!({ p: t.entry!.p, level: t.entry!.level }, { p, level: t.level }); return r.ok; };
    let goal: { p: Vec2; level: number } | null = null;
    if (centre && inPoly(centre.p[0], centre.p[1], t.poly ?? []) && reach(centre.p)) goal = centre;
    else if (t.poly?.length) {
      // The same bounded search at every yaw: a world-axis lattice changed which furnished pockets were tried
      // when the building turned. Sample and order in its own frame, then transform exactly as its room/slots.
      const frame = t.roomFrame;
      const cand = frame ? roomSamples(frame.poly, frame.at).map(([x, z]): Vec2 => {
        const c = Math.cos(frame.yaw), s = Math.sin(frame.yaw);
        return [r3(frame.origin[0] + (x * c + z * s) * frame.scale), r3(frame.origin[1] + (-x * s + z * c) * frame.scale)];
      }) : roomSamples(t.poly, t.at);
      const tried = new Set<string>();
      for (const c of cand) {
        if (tried.size >= 14) break;
        const q = near(c, t.level, 3); if (!q || !inPoly(q.p[0], q.p[1], t.poly)) continue;
        const k = `${q.p[0]},${q.p[1]}`; if (tried.has(k)) continue; tried.add(k);
        if (reach(q.p)) { goal = q; break; }
      }
    }
    this.rooms.set(key, goal); if (this.rooms.size > 200) this.rooms.clear();
    if (!goal) this.blocked.set(t.ref, `Nothing inside ${t.ref} can be reached from its front door right now: furniture closes the way in.`); else this.blocked.delete(t.ref);
    return goal;
  }
  private rooms = new Map<string, { p: Vec2; level: number } | null>();
  /** Why a thing has no goal (shown as the capability's blocked reason). */
  readonly blocked = new Map<string, string>();

  // ------------------------------------------------------------------ capabilities

  /** `walk:<path>` for the nearest named things and the rooms of near buildings (plus any this Soul asked for). */
  capabilities(soul: EdgeSoul, caps: EdgeCapability[], plans: Plans) {
    const me = this.h.engine.world.entities[soul.entityId]; if (!me?.human) return;
    const here: Vec2 = [me.pose.p[0], me.pose.p[2]], myLevel = me.human.level ?? 0;
    const seated = me.human.activity === 'sit' || me.human.baseActivity === 'sit';
    const all = this.things();
    const ranked = all.filter((t) => t.kind !== 'room').map((t) => ({ t, d: this.distance(t, here) })).sort((a, b) => a.d - b.d || (a.t.ref < b.t.ref ? -1 : 1));
    const pick: { t: Thing; d: number }[] = ranked.slice(0, SHOW);
    // SOULFIX2: a furnished town has more named things near than SHOW (each chair is one): buildings within
    // BUILDINGS_WITHIN stay offered however many pieces of furniture are nearer, so a Soul can always head for one
    for (const x of ranked.slice(SHOW)) if (x.t.kind === 'building' && x.d <= BUILDINGS_WITHIN) pick.push(x);
    for (const { t, d } of ranked) if (t.kind === 'building' && d <= ROOMS_WITHIN) for (const r of t.rooms ?? []) { const rt = this.thing(r); if (rt) pick.push({ t: rt, d: this.distance(rt, here) }); }
    for (const { t, d } of pick) {
      const id = `walk:${t.ref}`; if (caps.some((c) => c.id === id)) continue;
      const goal = this.goal(t, here, soul.entityId), where = this.label(t, Math.round(d)), place = this.h.placeOf?.(t.ref);
      const cap: EdgeCapability = { id, verb: 'walk', label: where, target: place ? { id: place, kind: 'place' } : { id: t.id, kind: 'object' }, available: !!goal,
        ...(goal ? {} : { blocked: this.blocked.has(t.ref) ? { code: 'route.unreachable', reason: this.blocked.get(t.ref)! } : { code: 'place.no-standing-room', reason: `There is no clear standing room at ${t.ref} right now.` } }) };
      caps.push(cap);
      if (!goal) continue;
      const stand: Step[] = seated ? [{ verb: 'stand', params: {} }] : [];
      // on the ground from the ground: the ledger's walk (swims and wades where the way is water); else the level walk
      const go: Step = goal.level === 0 && myLevel === 0 ? { verb: 'walk_to', params: { to: goal.p, standoff: 0 } } : { verb: 'mars:walk_to', params: { x: goal.p[0], z: goal.p[1], level: goal.level } };
      plans.set(id, { label: `Walk to ${t.ref}`, steps: [...stand, go] });
      if (place) this.placeCapabilities(t, place, here, d, [...stand, go], myLevel, caps, plans);
    }
  }
  /** R4-INFO: what Eden offers at each of its places, at a god-built place too: hang out there (walk there, then spend
   *  a while), and for an open area big enough, a stroll through it (a loop of clear stops inside it). */
  private placeCapabilities(t: Thing, place: string, here: Vec2, d: number, go: Step[], myLevel: number, caps: EdgeCapability[], plans: Plans) {
    const secs = { seconds: { type: 'integer', min: 1, max: 600, default: 60 } };
    const hid = `hang-out:${t.ref}`;
    if (!caps.some((c) => c.id === hid) && t.kind !== 'water') {
      caps.push({ id: hid, verb: 'hang-out', label: `Hang out at ${t.ref} (${t.what}; ${Math.round(d)} m)`, target: { id: place, kind: 'place' }, available: true, params: secs });
      plans.set(hid, { label: `Hang out at ${t.ref}`, steps: [...go, { verb: 'rest', params: { seconds: 60 } }], seconds: true });
    }
    const poly = t.area; if (!poly || t.kind !== 'area' || myLevel !== 0 || polyArea(poly) < STROLL_AREA) return;
    const sid = `stroll:${t.ref}`; if (caps.some((c) => c.id === sid)) return;
    const spots = this.strollSpots(t.ref, poly); if (spots.length < 2) return;
    // a loop from the stop nearest me, each next the nearest not yet visited
    const left = [...spots], route: Vec2[] = [];
    let at = here; while (left.length) { left.sort((a, b) => Math.hypot(a[0] - at[0], a[1] - at[1]) - Math.hypot(b[0] - at[0], b[1] - at[1])); at = left.shift()!; route.push(at); }
    caps.push({ id: sid, verb: 'stroll', label: `Stroll through ${t.ref} (a loop of ${route.length} stops)`, target: { id: place, kind: 'place' }, available: true, params: { pause: { type: 'integer', min: 0, max: 60, default: 4 } } });
    plans.set(sid, { label: `Stroll through ${t.ref}`, steps: [...go.filter((s) => s.verb === 'stand'), ...route.flatMap((p, i) => [{ verb: 'walk_to', params: { to: p } }, ...(i < route.length - 1 ? [{ verb: 'rest', params: { seconds: 4 } }] : [])])] });
  }
  private strolls = new Map<string, { key: string; spots: Vec2[] }>();
  private strollSpots(ref: string, poly: Vec2[]): Vec2[] {
    const key = this.cache?.key ?? ''; const hit = this.strolls.get(ref); if (hit?.key === key) return hit.spots;
    const f = (this.h.engine as unknown as { clearSpotsV1?: (p: Vec2[], n: number) => Vec2[] }).clearSpotsV1;
    const spots = (f ? f.call(this.h.engine, poly, 5) : []).map(([x, z]) => [r2(x), r2(z)] as Vec2);
    this.strolls.set(ref, { key, spots }); if (this.strolls.size > 200) this.strolls.clear();
    return spots;
  }
  private label(t: Thing, d: number): string {
    const by = this.landmarks(t).map((x) => x.ref);
    if (t.kind === 'room') return `Go into ${t.what} (${t.ref}; ${d} m)`;
    if (t.kind === 'building') return `Walk to ${t.ref}, ${t.what}: ${t.doorOpen ? 'in at its front door' : 'to its front door (closed)'} (${t.rooms?.length ?? 0} rooms, each walk:${t.ref}/<room>; ${d} m)`;
    if (t.kind === 'water') return `Walk to the shore of ${t.ref}, ${t.what} (${d} m)`;
    return `Walk to ${t.ref}, ${t.what}${by.length ? `, by ${by.join(' and ')}` : ''} (${d} m)`;
  }
  /** Named things within 15 m of a thing (its "by the X"), nearest first. */
  landmarks(t: Thing, n = 2): Thing[] {
    return this.things().filter((o) => o.kind !== 'room' && o.id !== t.id && !t.ref.startsWith(o.ref + '/')).map((o) => ({ o, d: this.distance(o, t.at) })).filter((x) => x.d <= 15).sort((a, b) => a.d - b.d).slice(0, n).map((x) => x.o);
  }
  /** Names of the named things within `within` m of a point (not `except`, not rooms), nearest first: "by the X". */
  namesNear(at: Vec2, except: string, n = 2, within = 12): string[] {
    return this.things().filter((o) => o.kind !== 'room' && o.id !== except).map((o) => ({ o, d: this.distance(o, at) })).filter((x) => x.d <= within).sort((a, b) => a.d - b.d).slice(0, n).map((x) => x.o.ref);
  }
}

function polyDist(poly: Vec2[], p: Vec2) { return inPoly(p[0], p[1], poly) ? 0 : nearestOn(poly, p, true).d; }

function roomSamples(poly: Vec2[], at: Vec2): Vec2[] {
  const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]), candidates: Vec2[] = [];
  for (let x = Math.min(...xs) + 0.3; x < Math.max(...xs); x += 0.6) for (let z = Math.min(...zs) + 0.3; z < Math.max(...zs); z += 0.6)
    if (inPoly(x, z, poly)) candidates.push([x, z]);
  return candidates.sort((a, b) => Math.hypot(a[0] - at[0], a[1] - at[1]) - Math.hypot(b[0] - at[0], b[1] - at[1]));
}
