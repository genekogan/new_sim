// PLACE-DATA-v1: typed places (Place/Occupier/Schedule/Role) and a Soul's place path.
// World authors the file; Core validates against the live world and indexes it.
import {CATALOG} from '../../../../../mars/viewer/engine/world/catalog.ts';
import type {WorldState as NativeWorld} from '../../../../../mars/viewer/engine/world/types.ts';
import type {PlaceRef} from '../contract.ts';

type V2 = [number, number];
export type Occupier = {id: string; fixture: string; slot: string; kind: string};
export type Place = {id: string; name: string; kind: string; parent: string | null; polygon: V2[]; level: number; enclosed: boolean; capacity: number | null; starting: boolean; description?: string; occupiers?: Occupier[]; schedule?: {id: string; cron: string; durationMinutes?: number; ticketed?: boolean; label?: string}[]; roles?: {id: string; relations?: {name: string; to: string}[]}[]};
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
  }
  const roots = d.places.filter(p => p.parent === null);
  if (roots.length !== 1) errs.push(`exactly one root required (found ${roots.length})`);
  for (const p of d.places) {
    if (p.parent !== null && !ids.has(p.parent)) {errs.push(`${p.id}: parent ${p.parent} missing`); continue;}
    const seen = new Set<string>(); let q: Place | undefined = p;
    while (q && q.parent !== null) {if (seen.has(q.id)) {errs.push(`${p.id}: parent cycle`); break;} seen.add(q.id); q = ids.get(q.parent);}
    const parent = p.parent ? ids.get(p.parent) : undefined;
    if (parent && Array.isArray(p.polygon) && Array.isArray(parent.polygon)) {const [cx, cz] = centroid(p.polygon); if (!inPoly(cx, cz, parent.polygon)) errs.push(`${p.id}: centroid outside parent ${parent.id}`);}
    if (p.capacity && (p.occupiers?.length ?? 0) > p.capacity) errs.push(`${p.id}: capacity below its occupier count`);
    for (const o of p.occupiers ?? []) {
      if (!REF.test(o.id) || ids.has(o.id)) errs.push(`${p.id}: occupier id ${o.id}`);
      if (world) {const e = world.entities[o.fixture]; if (!e) errs.push(`${p.id}: occupier ${o.id} fixture ${o.fixture} not in world`); else if (!(CATALOG[e.def]?.slots ?? []).some(s => s.id === o.slot && s.kind === 'seat')) errs.push(`${p.id}: occupier ${o.id} slot ${o.slot} not a seat slot of ${o.fixture} (${e.def})`);}
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
  constructor(data: PlaceData) {
    this.data = data;
    for (const p of data.places) {this.byId.set(p.id, p); for (const o of p.occupiers ?? []) this.occupierOf.set(o.fixture + '#' + o.slot, {occ: o, place: p});}
  }
  /** Places containing the point, innermost (smallest) first; occupier (if seated) prepended by caller. */
  containing(x: number, z: number, level = 0): Place[] {
    return [...this.byId.values()].filter(p => (p.level ?? 0) === level && inPoly(x, z, p.polygon) || p.parent === null).sort((a, b) => (a.parent === null ? 1 : 0) - (b.parent === null ? 1 : 0) || area(a.polygon) - area(b.polygon));
  }
  ref(p: Place): PlaceRef {return {id: p.id, name: p.name, kind: p.kind};}
}
