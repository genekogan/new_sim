// PLACE-DATA-v1: typed places (Place/Occupier/Schedule/Role) and a Soul's place path.
// World authors the file; Core validates against the live world and indexes it.
import {CATALOG} from '../../../../../mars/viewer/engine/world/catalog.ts';
import type {WorldState as NativeWorld} from '../../../../../mars/viewer/engine/world/types.ts';
import type {PlaceRef} from '../contract.ts';

type V2 = [number, number];
export type Occupier = {id: string; fixture: string; slot: string; kind: string};
export type Place = {id: string; name: string; kind: string; parent: string | null; polygon: V2[]; level: number; enclosed: boolean; capacity: number | null; starting: boolean; description?: string; occupiers?: Occupier[]; schedule?: {id: string; cron: string; durationMinutes?: number; ticketed?: boolean; label?: string}[]; roles?: {id: string; relations?: {name: string; to: string}[]}[];
  /** carrier/1: a place that moves with a native carrier entity (a balloon basket). Membership is by carriage, never geometry; `polygon` is in the entity's own frame. */
  carrier?: {entity: string; frame?: 'local'};
  /** knowledge/1: the world's creator keeps this place (and everything inside it) off maps and listings until a Soul has been there or found it. */
  secret?: boolean};
export type PlaceData = {contract: 'place-data/1'; world: string; places: Place[]};
const REF = /^[a-z0-9][a-z0-9._-]{0,99}$/;

export function inPoly(x: number, z: number, poly: V2[]) {let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;} return c;}
const area = (p: V2[]) => Math.abs(p.reduce((s, [x, z], i) => {const [x2, z2] = p[(i + 1) % p.length]; return s + x * z2 - x2 * z;}, 0)) / 2;
export const centroid = (p: V2[]): V2 => [p.reduce((s, v) => s + v[0], 0) / p.length, p.reduce((s, v) => s + v[1], 0) / p.length];

/** Rules 1–6 of PLACE-DATA-v1. With `world`, also checks occupiers against live native fixtures. */
export function validatePlaceData(raw: unknown, world?: NativeWorld): string[] {
  const errs: string[] = [], d = raw as PlaceData;
  if (!d || d.contract !== 'place-data/1' || !Array.isArray(d.places)) return ['contract must be place-data/1 with places[]'];
  const ids = new Map<string, Place>();
  for (const p of d.places) {
    if (typeof p.id !== 'string' || !REF.test(p.id)) errs.push(`bad id ${JSON.stringify(p.id)}`);
    else if (ids.has(p.id)) errs.push(`duplicate id ${p.id}`); else ids.set(p.id, p);
    if (typeof p.name !== 'string' || !p.name || p.name.length > 100) errs.push(`${p.id}: name`);
    if (typeof p.kind !== 'string' || !p.kind) errs.push(`${p.id}: kind`);
    if (!Array.isArray(p.polygon) || p.polygon.length < 3 || p.polygon.some(v => !Array.isArray(v) || v.length !== 2 || !v.every(Number.isFinite))) errs.push(`${p.id}: polygon`);
    if (p.level !== undefined && !Number.isInteger(p.level)) errs.push(`${p.id}: level`);
    if (typeof p.enclosed !== 'boolean') errs.push(`${p.id}: enclosed must be boolean`);
    if (p.capacity !== null && !(Number.isInteger(p.capacity) && p.capacity >= 1)) errs.push(`${p.id}: capacity`);
    if (p.description !== undefined && (typeof p.description !== 'string' || p.description.length > 4000)) errs.push(`${p.id}: description`);
    if (p.secret !== undefined && typeof p.secret !== 'boolean') errs.push(`${p.id}: secret must be boolean`);
  }
  const roots = d.places.filter(p => p.parent === null);
  if (roots.length !== 1) errs.push(`exactly one root required (found ${roots.length})`);
  for (const p of d.places) {
    if (p.parent !== null && !ids.has(p.parent)) {errs.push(`${p.id}: parent ${p.parent} missing`); continue;}
    const seen = new Set<string>(); let q: Place | undefined = p;
    while (q && q.parent !== null) {if (seen.has(q.id)) {errs.push(`${p.id}: parent cycle`); break;} seen.add(q.id); q = ids.get(q.parent);}
    const parent = p.parent ? ids.get(p.parent) : undefined;
    if (p.carrier !== undefined) {
      if (!p.carrier || typeof p.carrier.entity !== 'string' || (p.carrier.frame !== undefined && p.carrier.frame !== 'local')) errs.push(`${p.id}: carrier must be {entity, frame?: 'local'}`);
      else if (world) {const e = world.entities[p.carrier.entity], seats = e ? CATALOG[e.def]?.capabilities?.carrier?.seats : undefined;
        if (!e || !seats) errs.push(`${p.id}: carrier ${p.carrier.entity} is not a native carrier in this world`);
        else for (const o of p.occupiers ?? []) if (o.fixture !== p.carrier.entity || !seats.some(s => s.id === o.slot)) errs.push(`${p.id}: occupier ${o.id} must name a seat of ${p.carrier.entity}`);}
    }
    if (p.carrier === undefined && parent && Array.isArray(p.polygon) && Array.isArray(parent.polygon)) {const [cx, cz] = centroid(p.polygon); if (!inPoly(cx, cz, parent.polygon)) errs.push(`${p.id}: centroid outside parent ${parent.id}`);}
    if (p.capacity && (p.occupiers?.length ?? 0) > p.capacity) errs.push(`${p.id}: capacity below its occupier count`);
    for (const o of p.occupiers ?? []) {
      if (!REF.test(o.id) || ids.has(o.id)) errs.push(`${p.id}: occupier id ${o.id}`);
      if (world && p.carrier === undefined) {const e = world.entities[o.fixture]; if (!e) errs.push(`${p.id}: occupier ${o.id} fixture ${o.fixture} not in world`); else if (!(CATALOG[e.def]?.slots ?? []).some(s => s.id === o.slot && s.kind === 'seat')) errs.push(`${p.id}: occupier ${o.id} slot ${o.slot} not a seat slot of ${o.fixture} (${e.def})`);}
    }
  }
  if (!d.places.some(p => p.starting)) errs.push('at least one starting place required');
  return errs;
}

/** Provisional hierarchy until World data is installed: native regions under one outdoor root. */
export function derivePlaceData(world: NativeWorld): PlaceData {
  const regions = Object.values(world.regions ?? {}) as {id: string; label?: string; kind?: string; level?: number; polygon: V2[]}[];
  const all = regions.flatMap(r => r.polygon), xs = all.map(v => v[0]), zs = all.map(v => v[1]);
  const pad = 5, root: Place = {id: 'world', name: 'World', kind: 'outdoor', parent: null, level: 0, enclosed: false, capacity: null, starting: true,
    polygon: all.length ? [[Math.min(...xs) - pad, Math.min(...zs) - pad], [Math.max(...xs) + pad, Math.min(...zs) - pad], [Math.max(...xs) + pad, Math.max(...zs) + pad], [Math.min(...xs) - pad, Math.max(...zs) + pad]] : [[-200, -200], [200, -200], [200, 200], [-200, 200]]};
  return {contract: 'place-data/1', world: 'derived', places: [root, ...regions.filter(r => r.id !== 'world').map(r => ({id: r.id, name: r.label ?? r.id, kind: r.kind === 'place' ? 'outdoor' : (r.kind ?? 'outdoor'), parent: 'world', polygon: r.polygon, level: r.level ?? 0, enclosed: false, capacity: null, starting: false}))]};
}

export class PlaceIndex {
  readonly byId = new Map<string, Place>();
  readonly occupierOf = new Map<string, {occ: Occupier; place: Place}>();
  readonly data: PlaceData;
  /** carrier/1: carrier entity id → its place (declared in the data, or derived by the ledger). */
  readonly carrierPlaces = new Map<string, Place>();
  constructor(data: PlaceData) {
    this.data = data;
    for (const p of data.places) this.add(p);
  }
  add(p: Place) {this.byId.set(p.id, p); for (const o of p.occupiers ?? []) this.occupierOf.set(o.fixture + '#' + o.slot, {occ: o, place: p}); if (p.carrier) this.carrierPlaces.set(p.carrier.entity, p);}
  /** Places containing the point, innermost (smallest) first; occupier (if seated) prepended by caller. Carrier places never contain by geometry. */
  containing(x: number, z: number, level = 0): Place[] {
    return [...this.byId.values()].filter(p => !p.carrier && ((p.level ?? 0) === level && inPoly(x, z, p.polygon) || p.parent === null)).sort((a, b) => (a.parent === null ? 1 : 0) - (b.parent === null ? 1 : 0) || area(a.polygon) - area(b.polygon));
  }
  ref(p: Place): PlaceRef {return {id: p.id, name: p.name, kind: p.kind};}
}

export type Happening = {placeId: string; place: string; id: string; label: string; now: boolean; startsInMinutes: number; endsInMinutes: number; distance: number | null};
/** What is on now, or next within `horizon` world minutes, from place schedules (daily `M H * * *` slots on the
 *  world clock; other cron forms are skipped in v1). Nearest-first among those on now, then soonest. A reason to go somewhere. */
export function happenings(places: Iterable<Place>, minuteOfDay: number, from: V2 | null, limit = 4, horizon = 120): Happening[] {
  const out: Happening[] = [];
  for (const p of places) for (const s of p.schedule ?? []) {
    const m = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(s.cron.trim()); if (!m) continue;
    const start = Number(m[2]) * 60 + Number(m[1]), dur = s.durationMinutes ?? 60;
    const since = (minuteOfDay - start + 1440) % 1440, now = since < dur, until = now ? 0 : (start - minuteOfDay + 1440) % 1440;
    if (!now && until > horizon) continue;
    const [cx, cz] = centroid(p.polygon);
    out.push({placeId: p.id, place: p.name, id: s.id, label: s.label ?? s.id, now, startsInMinutes: until, endsInMinutes: now ? dur - since : until + dur, distance: from ? Math.round(Math.hypot(cx - from[0], cz - from[1])) : null});
  }
  return out.sort((a, b) => Number(b.now) - Number(a.now) || (a.now ? (a.distance ?? 0) - (b.distance ?? 0) : a.startsInMinutes - b.startsInMinutes)).slice(0, limit);
}
