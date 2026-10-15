// Places on a god's world (R4-INFO, Soul-information parity). On Eden a Soul's agent reads a map of named, walkable
// places with centres, kinds, capacities and descriptions; `here` names the place it stands in and the exits to the
// places around it; `observe` lists the things in its place. On a world the god builds, the same layer is derived from
// what the god built, and re-derived whenever the god edits (the agent's next `map`/`here`/`observe` shows the change):
//
//  - an area the god laid out (a plaza, a lawn, a garden, an orchard) is an outdoor place, its outline the area's;
//  - a pond or a lake is a water place;
//  - a building is a place (its rooms' outline, a little out for the walls) and each room a place inside it,
//    enclosed (privacy and earshot as Eden's rooms), its capacity the seats in it;
//  - a big named thing standing on its own (a fountain, a gazebo, a statue, an old oak) is a landmark place around it,
//    so "where" says "fountain" and not only "Green field";
//  - each has a short description of what is in it: "a plaza with a fountain, two benches, a lamp-post and a sign".
//
// Ids are `g-<path>` (`g-plaza`, `g-moss-cottage.living`); names are the god's names (`plaza`, `moss-cottage/living`), so
// the `walk:<path>` capabilities (nav.ts) carry them as their target place and every place answers to its walk.
// They join the ledger's own places layer (the PlaceIndex), so the ledger's map, place paths, arrivals, exits,
// "elsewhere" invitations and plain-words resolution work on them unchanged; the ledger's `placeWalkable` hook (unset on
// Eden/Mars/LM) says they are walkable although they are not native engine regions. Pure reads of the entity model.
import type { Entity, StoredDef, WorldModel } from '@sim/world-compiler';
import type { EdgeLedger } from '../edge/ledger/ledger.ts';
import type { Place } from '../edge/ledger/places.ts';
import type { GodNav, Thing } from './nav.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Vec2 = [number, number];
export type GodPlace = Place & { ref: string; of: 'area' | 'water' | 'shore' | 'building' | 'room' | 'thing' | 'landmark' | 'landform' | 'land'; entity: string };

const r2 = (v: number) => Math.round(v * 100) / 100;
const SHORE = 3;                   // m: a water's bank, round it
const LANDMARK_MIN = 1.5;          // a named point thing at least this wide (m) standing on its own is a landmark
const NOT_LANDMARKS = /^(sign|signpost|notice-board|lamp-post|lantern|flagpole|bollard|bin|wheelie-bin|mailbox|hydrant|crate|barrel|sack|flower-pot|poster|banner|picture-frame|screen|chalkboard|power-line)$/;
const WORDS = ['no', 'a', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const shortDef = (def: StoredDef) => def.name.replace(/^core-/, '').replace(/^ew-/, '').replace(/-pack$/, '');
const article = (w: string) => (/^[aeiou]/.test(w) ? `an ${w}` : `a ${w}`);
function plural(w: string) { return /(s|sh|ch|x|z)$/.test(w) ? `${w}es` : /[^aeiou]y$/.test(w) ? `${w.slice(0, -1)}ies` : `${w}s`; }
function counted(kind: string, n: number) { return n === 1 ? article(kind) : `${WORDS[n] ?? n} ${plural(kind)}`; }
function listed(parts: string[]) { return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`; }
export function inPoly(x: number, z: number, poly: Vec2[]) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; }
const areaOf = (p: Vec2[]) => Math.abs(p.reduce((s, [x, z], i) => { const [x2, z2] = p[(i + 1) % p.length]; return s + x * z2 - x2 * z; }, 0)) / 2;
const centroid = (p: Vec2[]): Vec2 => [p.reduce((s, v) => s + v[0], 0) / p.length, p.reduce((s, v) => s + v[1], 0) / p.length];
function hull(pts: Vec2[]): Vec2[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]); if (p.length < 3) return p;
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: Vec2[] = [], hi: Vec2[] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of [...p].reverse()) { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return [...lo.slice(0, -1), ...hi.slice(0, -1)];
}
/** The kind a def's `place` component gives (plaza, pitch, garden …). */
function placeKind(m: WorldModel, id: string): string | undefined { const e = m.entities.get(id), k = e ? (m.resolvedDef(e.def)?.components as Record<string, any> | undefined)?.place?.kind : undefined; return typeof k === 'string' && k ? k : undefined; }
/** A polygon pushed out from its centroid by `d` metres (walls round a building's rooms). */
function grow(poly: Vec2[], d: number): Vec2[] { const [cx, cz] = centroid(poly); return poly.map(([x, z]) => { const dx = x - cx, dz = z - cz, n = Math.hypot(dx, dz) || 1; return [r2(x + (dx / n) * d), r2(z + (dz / n) * d)] as Vec2; }); }
function circle(c: Vec2, r: number, n = 12): Vec2[] { return Array.from({ length: n }, (_, i) => [r2(c[0] + Math.cos((i / n) * Math.PI * 2) * r), r2(c[1] + Math.sin((i / n) * Math.PI * 2) * r)] as Vec2); }
/** The outline of a band `half` metres either side of a polyline (a pier's deck). */
function band(path: Vec2[], half: number): Vec2[] {
  const L: Vec2[] = [], R: Vec2[] = [];
  for (let i = 0; i < path.length; i++) {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)], dx = b[0] - a[0], dz = b[1] - a[1], n = Math.hypot(dx, dz) || 1, nx = -dz / n, nz = dx / n;
    L.push([r2(path[i][0] + nx * half), r2(path[i][1] + nz * half)]); R.push([r2(path[i][0] - nx * half), r2(path[i][1] - nz * half)]);
  }
  return [...L, ...R.reverse()];
}
function across(poly: Vec2[]) { const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]); return [Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)]; }

export type PlacesHost = {
  model: WorldModel;
  nav: GodNav;
  edge?: EdgeLedger;
  version?: () => number;
  engineOwned(e: Entity): boolean;
  levelAt(x: number, z: number, y: number): number;
  log(m: string): void;
  /** LAYERS: schedules (today's slots), ownership and who works/lives there, in each place (layers.ts). */
  layers?: { active(): boolean; dayKey(): string; slotsFor(e: Entity, label: string): NonNullable<Place['schedule']>; tag(e: Entity): string; peopleAt(id: string): string; onNow?(e: Entity): string };
};

/** What is where on a god's world, as the ledger's places. */
export class GodPlaces {
  private h: PlacesHost;
  private cache: { key: string; list: GodPlace[]; byRef: Map<string, GodPlace>; byEntity: Map<string, GodPlace> } | null = null;
  /** Ids of the places this layer put in the ledger's index (and only those: a boot place keeps its own). */
  private installed = new Set<string>();
  constructor(h: PlacesHost) { this.h = h; }

  static idOf(ref: string) { return `g-${ref.toLowerCase().replace(/\//g, '.').replace(/[^a-z0-9._-]+/g, '-').replace(/^[^a-z0-9]+/, '')}`.slice(0, 100); }
  /** The place a nav thing is (its walk targets it), if it is one. */
  forRef(ref: string): GodPlace | undefined { return this.index().byRef.get(ref); }
  list(): GodPlace[] { return this.index().list; }
  /** The place a god thing itself is (a plaza, a house, a gazebo, a lone fountain): its objects stand in it. */
  ofEntity(id: string): GodPlace | undefined { return this.index().byEntity.get(id); }
  /** Walkable (the ledger's hook): every place this layer made. */
  walkable(id: string): boolean { return this.installed.has(id); }

  private index() {
    const m = this.h.model, key = `${this.h.version?.() ?? m.editSeq}:${m.entities.size}${this.h.layers?.active() ? `:${this.h.layers.dayKey()}` : ''}`;
    if (this.cache?.key === key) return this.cache;
    const list = this.derive(), byRef = new Map<string, GodPlace>(), byEntity = new Map<string, GodPlace>();
    // a thing's walk targets its place; a water's walk (to its shore) targets the shore
    for (const p of list) { if (p.of === 'water' && byRef.has(p.ref)) continue; byRef.set(p.ref, p); if (p.of !== 'room' && p.of !== 'shore') byEntity.set(p.entity, p); }
    this.cache = { key, list, byRef, byEntity };
    return this.cache;
  }

  private derive(): GodPlace[] {
    const m = this.h.model, things = this.h.nav.things();
    const out: GodPlace[] = [];
    const base = { parent: null as string | null, enclosed: false, capacity: null as number | null, starting: false };
    for (const t of things) {
      if (t.kind === 'area' && t.area && t.area.length >= 3) out.push({ ...base, id: GodPlaces.idOf(t.ref), ref: t.ref, of: 'area', entity: t.id, name: t.ref, kind: placeKind(m, t.id) ?? 'outdoor', polygon: t.area.map(([x, z]) => [r2(x), r2(z)] as Vec2), level: 0 });
      else if (t.kind === 'water' && t.area && t.area.length >= 3) out.push({ ...base, id: GodPlaces.idOf(t.ref), ref: t.ref, of: 'water', entity: t.id, name: t.ref, kind: 'water', polygon: t.area.map(([x, z]) => [r2(x), r2(z)] as Vec2), level: 0 });
      else if (t.kind === 'room' && t.poly && t.poly.length >= 3) out.push({ ...base, id: GodPlaces.idOf(t.ref), ref: t.ref, of: 'room', entity: t.id, name: t.ref, kind: 'room', enclosed: true, polygon: t.poly.map(([x, z]) => [r2(x), r2(z)] as Vec2), level: t.level });
    }
    // GOD-ENV: the god's landforms are places Souls can name and climb: a mountain or hill (round its top), a range, a
    // valley, a ditch or a cliff (a band along it), a plateau or a terrace (its area: already an area place, renamed)
    for (const t of things) {
      const e = m.entities.get(t.id); if (!e || e.in.parent !== 'world') continue;
      const def = m.resolvedDef(e.def); if (!def) continue;
      let lf: any; try { lf = m.bake(def, e.params ?? {}, e.seed ?? 0, e.shape).landform; } catch { continue; }
      if (!lf || lf.kind === 'brush') continue;
      const kind = shortDef(def), have = out.find((p) => p.ref === t.ref);
      if (have) { if (have.of === 'area') { have.of = 'landform'; have.kind = kind; } continue; }
      let poly: Vec2[] | null = null;
      if (lf.kind === 'bump') poly = circle(t.at, Math.max(6, Number(lf.r ?? 20) * m.worldPose(e).s * 0.5));
      else if (t.path?.length) poly = band(t.path, Math.max(2, (lf.kind === 'channel' ? Number(lf.w ?? 2) + Number(lf.edge ?? 2) / 2 : lf.kind === 'cliff' ? Number(lf.face ?? 3) + 2 : Number(lf.w ?? t.width ?? 10) / 2)));
      if (!poly || poly.length < 3) continue;
      out.push({ ...base, id: GodPlaces.idOf(t.ref), ref: t.ref, of: 'landform', entity: t.id, name: t.ref, kind, polygon: poly, level: 0 });
    }
    // GOD-ENV: land the god added beyond the world's first square (extend east/west/north/south): a place per side
    { const half = m.constants.extent / 2, [x0, z0, x1, z1] = m.ground().extent, sides: [string, Vec2[]][] = [];
      if (x1 > half + 1) sides.push(['east', [[half, z0], [x1, z0], [x1, z1], [half, z1]]]);
      if (x0 < -half - 1) sides.push(['west', [[x0, z0], [-half, z0], [-half, z1], [x0, z1]]]);
      if (z0 < -half - 1) sides.push(['north', [[Math.max(x0, -half), z0], [Math.min(x1, half), z0], [Math.min(x1, half), -half], [Math.max(x0, -half), -half]]]);
      if (z1 > half + 1) sides.push(['south', [[Math.max(x0, -half), half], [Math.min(x1, half), half], [Math.min(x1, half), z1], [Math.max(x0, -half), z1]]]);
      for (const [side, polygon] of sides) out.push({ ...base, id: `g-new-land-${side}`, ref: `new-land-${side}`, of: 'land', entity: `world:${side}`, name: `new land to the ${side}`, kind: 'land', polygon: polygon.map(([x, z]) => [r2(x), r2(z)] as Vec2), level: 0 }); }
    // a water's shore: a band round it (where its walk ends, and where a swim starts), as Eden's bank by its pond
    for (const w of out.filter((p) => p.of === 'water')) out.push({ ...base, id: `${w.id}.shore-bank`.slice(0, 100), ref: w.ref, of: 'shore', entity: w.entity, name: `${w.ref} shore`, kind: 'shore', polygon: grow(w.polygon, SHORE), level: 0 });
    // buildings: round their ground-floor rooms (a little out, for the walls)
    for (const t of things) {
      if (t.kind !== 'building') continue;
      const rooms = out.filter((p) => p.of === 'room' && p.entity === t.id && p.level === t.level);
      const pts = rooms.flatMap((p) => p.polygon); if (pts.length < 3) continue;
      const poly = grow(hull(pts), 0.4); if (poly.length < 3) continue;
      out.push({ ...base, id: GodPlaces.idOf(t.ref), ref: t.ref, of: 'building', entity: t.id, name: t.ref, kind: 'building', polygon: poly, level: t.level });
    }
    // things whose def says they are a place (a gazebo, a pergola, a pavilion, a dome; a pier's deck): their footprint
    for (const t of things) {
      if ((t.kind !== 'thing' && t.kind !== 'seat' && t.kind !== 'path') || out.some((p) => p.ref === t.ref)) continue;
      const e = m.entities.get(t.id), def = e ? m.resolvedDef(e.def) : undefined, pc = (def?.components as Record<string, any> | undefined)?.place;
      if (!e || !def || !pc) continue;
      let poly: Vec2[] | null = null;
      try {
        if (t.kind === 'path' && t.path?.length) poly = band(t.path, (t.width ?? 2) / 2 + 0.3);
        else { const b = m.bake(def, e.params ?? {}, e.seed ?? 0, e.shape).box, wp = m.worldPose(e), c = Math.cos(wp.yaw), sn = Math.sin(wp.yaw), hw = b[0] / 2 + 0.8, hd = b[2] / 2 + 0.8;
          poly = ([[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]] as Vec2[]).map(([x, z]) => [r2(wp.x + (x * c + z * sn) * wp.s), r2(wp.z + (-x * sn + z * c) * wp.s)] as Vec2); }
      } catch { continue; }
      if (!poly || poly.length < 3) continue;
      out.push({ ...base, id: GodPlaces.idOf(t.ref), ref: t.ref, of: 'thing', entity: t.id, name: t.ref, kind: String(pc.kind ?? 'outdoor'), enclosed: pc.enclosed === true, capacity: Number.isInteger(pc.capacity) ? pc.capacity : null, polygon: poly, level: t.level });
    }
    // landmarks: big named things standing on their own (not in an area, a building, a water or another place)
    const outer = () => out.filter((p) => p.of !== 'room' && p.of !== 'landmark');
    for (const t of things) {
      if (t.kind !== 'thing' || t.level !== 0 || out.some((p) => p.ref === t.ref)) continue;
      const e = m.entities.get(t.id); if (!e || e.in.parent !== 'world') continue;
      const def = m.resolvedDef(e.def); if (!def || NOT_LANDMARKS.test(shortDef(def))) continue;
      const c = def.components as Record<string, unknown>; if (c.carryable || c.seat || c.item) continue;
      let w = 0; try { const b = m.bake(def, e.params ?? {}, e.seed ?? 0, e.shape).box, s = m.worldPose(e).s; w = Math.max(b[0], b[2]) * s; } catch { continue; }
      if (w < LANDMARK_MIN || outer().some((p) => inPoly(t.at[0], t.at[1], p.polygon))) continue;
      out.push({ ...base, id: GodPlaces.idOf(t.ref), ref: t.ref, of: 'landmark', entity: t.id, name: t.ref, kind: 'landmark', polygon: circle(t.at, Math.max(4, w / 2 + 3)), level: 0 });
    }
    // parents: the smallest bigger place (god-built or the world's own) that holds its centre; else the root
    const boot = [...(this.h.edge?.places.byId.values() ?? [])].filter((p) => !this.installed.has(p.id) && !p.carrier);
    const root = boot.find((p) => p.parent === null)?.id ?? null;
    for (const p of out) {
      const c = centroid(p.polygon), a = areaOf(p.polygon);
      const holders = [...out.filter((q) => q !== p && q.of !== 'room'), ...boot.filter((q) => q.parent !== null)]
        .filter((q) => (q.level ?? 0) === 0 && areaOf(q.polygon) > a && inPoly(c[0], c[1], q.polygon)).sort((x, y) => areaOf(x.polygon) - areaOf(y.polygon));
      p.parent = p.of === 'room' ? (out.find((q) => q.of === 'building' && q.entity === p.entity)?.id ?? holders[0]?.id ?? root) : holders[0]?.id ?? root;
    }
    for (const p of out) { p.description = this.describe(p, out, things); if (p.of === 'room') { const n = this.seatsIn(p); p.capacity = n || null; } }
    if (this.h.layers?.active()) this.layer(out);
    return out.sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  /** LAYERS: a zone's kind is its use ("commercial zone"); a place's own thing adds its owner, hours and people to the
   *  description; a scheduled thing's slots for today join its place's schedule (its own place, else the one holding it). */
  private layer(out: GodPlace[]) {
    const m = this.h.model, L = this.h.layers!;
    for (const p of out) {
      const e = m.entities.get(p.entity); if (!e) continue;
      if (/^core[-/]zone@/.test(m.def(e.def)?.ref ?? e.def)) { p.kind = `${String(e.params?.use ?? 'residential')} zone`; const rest = p.description?.includes(' with ') ? p.description.split(' with ').slice(1).join(' with ') : ''; p.description = `a ${p.kind} the god drew${rest ? `, with ${rest}` : ''}`; }
      const extra = [L.tag(e), L.peopleAt(e.id)].filter(Boolean).join('; ');
      if (extra && p.of !== 'shore') p.description = `${p.description ?? ''}; ${extra}`.slice(0, 600);
    }
    for (const e of m.entities.values()) {
      if (!e.schedule) continue;
      const own = out.find((p) => p.entity === e.id && p.of !== 'shore' && p.of !== 'room');
      let p = own;
      if (!p) { const wp = m.worldPose(e); p = out.filter((q) => q.of !== 'shore' && inPoly(wp.x, wp.z, q.polygon)).sort((a, b) => areaOf(a.polygon) - areaOf(b.polygon))[0]; }
      if (!p) continue;
      // a place's own opening hours are its slots; a thing inside (a door that follows the café's hours) adds only its events
      const label = e.name ? m.pathOf(e.id) : p.name, slots = L.slotsFor(e, label).filter((s) => own || !s.id.startsWith('open-')).map((s) => ({ ...s, id: own ? s.id : `${e.id}-${s.id}`.slice(0, 60) }));
      if (slots.length) p.schedule = [...(p.schedule ?? []), ...slots];
      // EVENTS: an event on now with its set up leads the description (whatson shows its first words)
      const on = L.onNow?.(e); if (on) p.description = `${on}; ${p.description ?? ''}`.replace(/; $/, '').slice(0, 600);
    }
  }

  /** Seats (seat slots of things) whose position is inside a place. */
  private seatsIn(p: GodPlace): number {
    const m = this.h.model; let n = 0;
    for (const e of m.entities.values()) {
      const def = m.resolvedDef(e.def); if (!def || def.components.body || this.h.engineOwned(e)) continue;
      const wp = m.worldPose(e); if (!inPoly(wp.x, wp.z, p.polygon)) continue;
      try { n += m.bake(def, e.params ?? {}, e.seed ?? 0, e.shape).slots.filter((s) => s.kind === 'seat').length; } catch { /* odd def */ }
    }
    return n;
  }

  /** "a plaza with a fountain, two benches, a lamp-post and a sign" (what stands in it, by kind). */
  private describe(p: GodPlace, all: GodPlace[], things: Thing[]): string {
    const m = this.h.model, own = m.entities.get(p.entity), ownDef = own ? m.resolvedDef(own.def) : undefined, kind = ownDef ? shortDef(ownDef) : p.of;
    const counts = new Map<string, number>(), sizes = new Map<string, number>();
    const inBuilding = (e: Entity) => { for (let cur: Entity | undefined = e; cur && cur.in.parent !== 'world'; ) { cur = m.entities.get(cur.in.parent); if (cur && all.some((q) => q.of === 'building' && q.entity === cur!.id)) return cur.id; } return null; };
    for (const e of m.entities.values()) {
      if (e.id === p.entity) continue;
      const def = m.resolvedDef(e.def); if (!def) continue;
      const c = def.components as Record<string, unknown>;
      if (c.body || /^core[-/]flag@/.test(def.ref) || this.h.engineOwned(e)) continue;
      const sh = e.shape as { area?: Vec2[]; path?: Vec2[] } | undefined;
      if (def.form !== 'point' && e.in.parent === 'world' && sh) continue;            // areas, roads, waters are places or ground
      const wp = m.worldPose(e); if (!inPoly(wp.x, wp.z, p.polygon)) continue;
      const b = inBuilding(e);
      if (p.of === 'room' || p.of === 'building' ? b !== p.entity : b !== null) continue;  // a house's furniture is in its rooms
      const k = shortDef(def); counts.set(k, (counts.get(k) ?? 0) + 1);
      if (!sizes.has(k)) { let w = 0; try { const bx = m.bake(def, e.params ?? {}, e.seed ?? 0, e.shape).box; w = Math.max(bx[0], bx[2]) * wp.s; } catch { /* odd def */ } sizes.set(k, w); }
    }
    // the biggest things first ("a fountain, two benches, a lamp-post and a sign")
    const parts = [...counts.entries()].sort((a, b) => (sizes.get(b[0]) ?? 0) - (sizes.get(a[0]) ?? 0) || b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([k, n]) => counted(k, n));
    const items = parts.length > 7 ? [...parts.slice(0, 6), `${parts.length - 6} more kinds of thing`] : parts;
    const [w, d] = across(p.polygon);
    if (p.of === 'room') {
      const t = things.find((x) => x.ref === p.ref), n = this.seatsIn(p);
      return `${t?.what ?? p.ref} (${article(kind)})${items.length ? `, with ${listed(items)}` : ', empty'}${n ? `; seats ${n}` : ''}; indoors, about ${Math.round(w)} by ${Math.round(d)} m`;
    }
    if (p.of === 'building') {
      const t = things.find((x) => x.ref === p.ref), rooms = all.filter((q) => q.of === 'room' && q.entity === p.entity).map((q) => q.ref);
      return `${article(kind)} with ${counted('room', rooms.length)} (${rooms.join(', ')}); its front door is ${t?.doorOpen ? 'open' : 'closed'}`;
    }
    if (p.of === 'landform') {
      const e = m.entities.get(p.entity), [cx, cz] = centroid(p.polygon), top = Math.round(m.terrain.sample(cx, cz));
      const lf: any = (() => { try { const d = e && m.resolvedDef(e.def); return d ? m.bake(d, e!.params ?? {}, e!.seed ?? 0, e!.shape).landform : null; } catch { return null; } })();
      if (lf?.kind === 'bump') return `${article(kind)} about ${Math.round(Math.abs(lf.h * (e ? m.worldPose(e).s : 1)))} m high and ${Math.round(2 * lf.r * (e ? m.worldPose(e).s : 1))} m across; its top is ${top} m up (walk:${p.ref} climbs to it)`;
      if (lf?.kind === 'channel') {
        // how deep: the ground just beyond its banks, less its floor, averaged along it
        const path = lf.path as Vec2[], off = Number(lf.w) + Number(lf.edge) + 2; let sum = 0;
        path.forEach(([x, z], i) => { const a = path[Math.max(0, i - 1)], c = path[Math.min(path.length - 1, i + 1)], dx = c[0] - a[0], dz = c[1] - a[1], n = Math.hypot(dx, dz) || 1; sum += (m.terrain.sample(x - (dz / n) * off, z + (dx / n) * off) + m.terrain.sample(x + (dz / n) * off, z - (dx / n) * off)) / 2 - lf.levels[i]; });
        return `${article(kind)} cut about ${Math.round(sum / path.length)} m into the ground, ${Math.round(2 * lf.w)} m wide at the bottom and ${Math.round(Math.max(w, d))} m long`; }
      if (lf?.kind === 'cliff') return `${article(kind)} ${Math.round(Math.abs(lf.h))} m high and ${Math.round(Math.max(w, d))} m long; the high side is to its ${lf.side > 0 ? 'left' : 'right'} walking along it`;
      if (lf?.kind === 'ridge') return `${article(kind)} ${Math.round(Math.abs(lf.h))} m high, ${Math.round(Math.max(w, d))} m long`;
      return `${article(kind)} about ${Math.round(w)} by ${Math.round(d)} m, ${top} m up${items.length ? `, with ${listed(items)}` : ''}`;
    }
    if (p.of === 'land') return `land the god added to the world, about ${Math.round(w)} by ${Math.round(d)} m${items.length ? `, with ${listed(items)}` : ', still empty'}`;
    if (p.of === 'shore') return `the bank round ${p.ref}: walk:${p.ref} ends here, and a swim starts from here`;
    if (p.of === 'water') return `${article(kind)} you can swim in, about ${Math.round(Math.max(w, d))} m across${items.length ? `, with ${listed(items)}` : ''}`;
    if (p.of === 'thing') return `${article(kind)}${p.capacity ? ` for ${p.capacity}` : ''}${items.length ? `, with ${listed(items)}` : ''}${p.enclosed ? '; indoors' : ''}`;
    if (p.of === 'landmark') { const t = things.find((x) => x.ref === p.ref), by = t ? this.h.nav.namesNear(t.at, p.entity, 2, 15) : [];
      return `${article(kind)} standing on its own${by.length ? ` by ${listed(by)}` : ''}${items.length ? `, with ${listed(items)} round it` : ''}; a landmark`; }
    return `${article(kind)}${items.length ? ` with ${listed(items)}` : ''}, about ${Math.round(w)} by ${Math.round(d)} m`;
  }

  /** Put the places in the ledger's index; take out the ones the god removed. */
  sync() {
    const places = this.h.edge?.places; if (!places) return;
    const want = new Map(this.list().map((p) => [p.id, p]));
    for (const id of [...this.installed]) if (!want.has(id)) { places.byId.delete(id); this.installed.delete(id); }
    for (const [id, p] of want) {
      const cur = places.byId.get(id); if (cur && !this.installed.has(id)) continue;   // a boot place keeps its own
      const { ref: _r, of: _o, entity: _e, ...place } = p;
      if (!cur || JSON.stringify(cur) !== JSON.stringify(place)) places.add(place);
      this.installed.add(id);
    }
  }

  /** The innermost place (any: god-built or the world's own, not a carrier) holding a point at a standing level. */
  placeAt(at: Vec2, level = 0): string | null {
    const places = this.h.edge?.places; if (!places) return null;
    return places.containing(at[0], at[1], level)[0]?.id ?? null;
  }
}
