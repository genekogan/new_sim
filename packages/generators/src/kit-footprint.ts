// XP5: shared sidecar conversion and opt-in ground-level kit interiors.
import { z } from 'zod';
import { CREATION_LIMITS as L } from './creation-limits.ts';
import { pointInPoly } from './geom.ts';
import { reachableFromOutside } from './reachability.ts';
import type { Baked, LocalOBB, Link, Opening, Room, Slot, Surface, Vec2, Vec3 } from './types.ts';

export type FootprintBaked = Omit<Baked, 'tris' | 'landform' | 'water'>;

export type LmFootprint = {
  schema: 'lm-building-footprint/1'; id?: string; name?: string;
  bounds?: { min: Vec3; max: Vec3 };
  levels?: { id: number; y: number; label?: string }[];
  rooms?: { id: string; label?: string; level: number; y0: number; y1: number; clearHeight?: number; polygon: Vec2[] }[];
  terraces?: { id: string; level: number; y: number; polygon: Vec2[]; hole?: Vec2[] }[];
  obstacles?: { id: string; kind: string; obb: { c: Vec2; half: Vec2; yaw: number }; y0: number; y1: number }[];
  portals?: { id: string; kind: 'door' | 'window' | 'shaft'; level: number; center: Vec3; normal?: Vec3; width?: number; diameter?: number; y0: number; y1: number }[];
  links?: { id: string; kind: string; width: number; from: { level: number; y: number }; to: { level: number; y: number }; path: Vec3[] }[];
};

const centroid = (poly: Vec2[]): Vec2 => { let x = 0, z = 0; for (const p of poly) { x += p[0]; z += p[1]; } return [x / poly.length, z / poly.length]; };
/** Reduce a polygon to ≤ max points (slot schema limit) by even subsampling; rooms keep their exact polygon. */
const thin = (poly: Vec2[], max = 64): Vec2[] => (poly.length <= max ? poly : Array.from({ length: max }, (_, i) => poly[Math.floor((i * poly.length) / max)]));
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** Check source values before arithmetic can coerce null/strings into numbers. */
export function assertFootprint(value: unknown): asserts value is LmFootprint {
  const object = (v: unknown, field: string): Record<string, unknown> => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${field} must be an object`);
    return v as Record<string, unknown>;
  };
  const number = (v: unknown, field: string): number => {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${field} must be a finite number`);
    return v;
  };
  const positive = (v: unknown, field: string) => { if (!(number(v, field) > 0)) throw new Error(`${field} must be greater than 0`); };
  const text = (v: unknown, field: string) => { if (typeof v !== 'string' || !v.length) throw new Error(`${field} must be a nonempty string`); };
  const vector = (v: unknown, length: number, field: string): number[] => {
    if (!Array.isArray(v) || v.length !== length) throw new Error(`${field} must have exactly ${length} numeric coordinates`);
    v.forEach((n, i) => number(n, `${field}.${i}`)); return v;
  };
  const points = (v: unknown, length: number, min: number, field: string) => {
    if (!Array.isArray(v) || v.length < min) throw new Error(`${field} needs at least ${min} points`);
    v.forEach((p, i) => vector(p, length, `${field}.${i}`));
  };
  const fp = object(value, 'footprint');
  if (fp.schema !== 'lm-building-footprint/1') throw new Error('footprint schema must be lm-building-footprint/1');
  for (const key of ['id', 'name']) if (fp[key] !== undefined) text(fp[key], `footprint.${key}`);
  if (fp.bounds !== undefined) {
    const bounds = object(fp.bounds, 'bounds'), min = vector(bounds.min, 3, 'bounds.min'), max = vector(bounds.max, 3, 'bounds.max');
    if (min.some((n, i) => n > max[i])) throw new Error('bounds.max must be ≥ bounds.min');
  }
  for (const key of ['levels', 'rooms', 'terraces', 'obstacles', 'portals', 'links']) {
    const entries = fp[key];
    if (entries === undefined) continue;
    if (!Array.isArray(entries)) throw new Error(`${key} must be an array`);
    for (const [i, raw] of entries.entries()) {
      const field = `${key}.${i}`, entry = object(raw, field);
      if (key === 'levels') number(entry.id, `${field}.id`); else text(entry.id, `${field}.id`);
      if (entry.label !== undefined) text(entry.label, `${field}.label`);
      if (['rooms', 'terraces', 'portals'].includes(key)) number(entry.level, `${field}.level`);
      if (key === 'levels' || key === 'terraces') number(entry.y, `${field}.y`);
      if (['rooms', 'obstacles', 'portals'].includes(key)) {
        const y0 = number(entry.y0, `${field}.y0`), y1 = number(entry.y1, `${field}.y1`);
        if (!(y1 > y0)) throw new Error(`${field}.y1 must exceed y0`);
      }
      if (key === 'rooms' || key === 'terraces') points(entry.polygon, 2, 3, `${field}.polygon`);
      if (key === 'rooms' && entry.clearHeight !== undefined) positive(entry.clearHeight, `${field}.clearHeight`);
      if (key === 'terraces' && entry.hole !== undefined) points(entry.hole, 2, 3, `${field}.hole`);
      if (key === 'obstacles') {
        const obb = object(entry.obb, `${field}.obb`); text(entry.kind, `${field}.kind`);
        vector(obb.c, 2, `${field}.obb.c`); vector(obb.half, 2, `${field}.obb.half`).forEach((n, j) => positive(n, `${field}.obb.half.${j}`)); number(obb.yaw, `${field}.obb.yaw`);
      }
      if (key === 'portals') {
        if (!['door', 'window', 'shaft'].includes(entry.kind as string)) throw new Error(`${field}.kind must be door, window or shaft`);
        vector(entry.center, 3, `${field}.center`); if (entry.normal !== undefined) vector(entry.normal, 3, `${field}.normal`);
        for (const dimension of ['width', 'diameter']) if (entry[dimension] !== undefined) positive(entry[dimension], `${field}.${dimension}`);
      }
      if (key === 'links') {
        text(entry.kind, `${field}.kind`); positive(entry.width, `${field}.width`); points(entry.path, 3, 2, `${field}.path`);
        for (const end of ['from', 'to']) { const endpoint = object(entry[end], `${field}.${end}`); number(endpoint.level, `${field}.${end}.level`); number(endpoint.y, `${field}.${end}.y`); }
      }
    }
  }
}

/**
 * `lm-building-footprint/1` → Baked physics in the def frame (metres, +y up, front +z, origin at the base centre).
 * Obstacle yaws are negated: the engine's rot2 turns counter-clockwise from above, the compiler's OBBs clockwise.
 * `k` scales every length (a def that states a different height than the asset).
 */
export function footprintToBaked(fp: LmFootprint, k = 1): FootprintBaked {
  assertFootprint(fp);
  if (!(Number.isFinite(k) && k > 0)) throw new Error('footprint scale must be positive and finite');
  const finite = (value: unknown, path: string): void => {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`${path} must be finite`);
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) finite(child, `${path}.${key}`);
  };
  finite(fp, 'footprint');
  const s2 = (p: Vec2): Vec2 => [r4(p[0] * k), r4(p[1] * k)];
  const colliders: LocalOBB[] = (fp.obstacles ?? []).map((o) => ({ c: s2(o.obb.c), half: s2(o.obb.half), yaw: -o.obb.yaw, y0: r4(o.y0 * k), y1: r4(o.y1 * k), tag: o.id }));
  const rooms: Room[] = (fp.rooms ?? []).map((r) => { const poly = r.polygon.map(s2); return { id: r.id.toLowerCase().replace(/[^a-z0-9._-]+/g, '-'), name: r.label ?? r.id, floor: r.level, y: r4(r.y0 * k), polygon: poly, origin: centroid(poly).map(r4) as Vec2, yaw: 0, height: r4((r.y1 - r.y0) * k) }; });
  const surfaces: Surface[] = [
    ...rooms.map((r) => ({ level: r.floor, y: r.y, polygon: r.polygon, tag: r.id })),
    ...(fp.terraces ?? []).map((t) => ({ level: t.level, y: r4(t.y * k), polygon: t.polygon.map(s2), tag: t.id })),
  ];
  const openings: Opening[] = (fp.portals ?? []).filter((p) => p.kind !== 'shaft').map((p) => {
    const floorY = fp.levels?.find((l) => l.id === p.level)?.y ?? 0, n = p.normal ?? [0, 0, 1];
    return { id: p.id, kind: p.kind as 'door' | 'window', at: s2([p.center[0], p.center[2]]), yaw: r4(Math.atan2(n[0], n[2])), width: r4((p.width ?? 1) * k), height: r4((p.y1 - p.y0) * k), sill: r4(Math.max(0, p.y0 - floorY) * k), level: p.level, state: 'always' as const };
  });
  const links: Link[] = (fp.links ?? []).map((l) => ({ id: l.id, kind: (['stairs', 'ramp', 'ladder', 'float'].includes(l.kind) ? l.kind : 'float') as Link['kind'], from: l.from.level, to: l.to.level, path: l.path.map((p) => s2([p[0], p[2]])), width: r4(l.width * k), y0: r4(l.from.y * k), y1: r4(l.to.y * k) }));
  const slots: Slot[] = rooms.map((r) => ({ id: r.id, kind: 'room', p: [r.origin[0], r.y, r.origin[1]], yaw: 0, floor: r.floor, polygon: thin(r.polygon.map(([x, z]) => [r4(x - r.origin[0]), r4(z - r.origin[1])] as Vec2)), height: r.height, accepts: {}, capacity: 64, label: r.name }));
  const b = fp.bounds ?? { min: [0, 0, 0], max: [0, 0, 0] };
  const box: Vec3 = [r4((b.max[0] - b.min[0]) * k), r4((b.max[1] - b.min[1]) * k), r4((b.max[2] - b.min[2]) * k)];
  if (box.some(v => !Number.isFinite(v) || v < 0)) throw new Error('footprint bounds must be finite with max ≥ min');
  if (colliders.some(c => c.half.some(v => !Number.isFinite(v) || v <= 0) || !(c.y1 > c.y0))) throw new Error('footprint obstacles need positive half sizes and y1 > y0');
  finite({ colliders, rooms, surfaces, openings, links, slots }, 'footprint');
  const shafts = (fp.portals ?? []).filter((p) => p.kind === 'shaft').length;
  return { box, colliders, surfaces, openings, links, rooms, slots, notes: [`footprint ${fp.id ?? ''}: ${rooms.length} rooms, ${openings.length} openings, ${links.length} links (${shafts} shafts, float-only), ${colliders.length} wall/solid colliders`] };
}

const EPS = 1e-6;
/** Sidecars keep their existing contract. Inline kit footprints deliberately support ground rooms only. */
const inlineFootprint = z.custom<LmFootprint>().superRefine((fp, ctx) => {
  try {
    assertFootprint(fp);
    if (!fp.rooms?.length) throw Error('inline footprint needs at least one ground room');
    const caps = { levels: 1, rooms: 32, terraces: 32, obstacles: 1024, portals: 256, links: 0 } as const;
    for (const [key, max] of Object.entries(caps)) {
      if ((fp[key as keyof typeof caps]?.length ?? 0) > max) throw Error(`${key}: at most ${max} entries (stairs and upper decks are deferred)`);
    }
    if (fp.levels?.some(l => l.id !== 0 || l.y !== 0) || fp.rooms.some(r => r.level !== 0 || r.y0 !== 0)
      || fp.terraces?.some(t => t.level !== 0 || t.y !== 0 || t.hole?.length)
      || fp.portals?.some(p => p.level !== 0 || p.kind === 'shaft')) throw Error('only ground rooms at y=0 are supported; stairs, holes and upper decks are deferred');
    const ids = new Set<string>();
    for (const room of fp.rooms) {
      const id = room.id.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
      if (!/^[a-z0-9][a-z0-9._-]{0,47}$/.test(id) || ids.has(id) || id === 'front') throw Error(`room id ${room.id} is invalid, reserved or duplicates another room`);
      ids.add(id);
    }
    const portalIds = new Set<string>();
    for (const p of fp.portals ?? []) {
      if (portalIds.has(p.id)) throw Error(`duplicate portal ${p.id}`);
      portalIds.add(p.id);
    }
    for (const r of [...fp.rooms, ...(fp.terraces ?? [])]) {
      if (r.polygon.length > 256) throw Error(`${r.id}: at most 256 polygon points`);
      const area = r.polygon.reduce((a, p, i, poly) => a + p[0] * poly[(i + 1) % poly.length][1] - p[1] * poly[(i + 1) % poly.length][0], 0);
      if (Math.abs(area) < EPS) throw Error(`${r.id}: polygon must have nonzero area`);
    }
  } catch (e) { ctx.addIssue({ code: 'custom', message: (e as Error).message }); }
});
export const kitFootprintSchema = z.union([z.literal('open'), inlineFootprint]);

/** Keep room frames authoritative while retaining authored seat/bed/stand slots. */
export function mergeKitSlots(generated: Slot[], authored: Slot[]): Slot[] {
  const rooms = new Set(generated.filter(s => s.kind === 'room').map(s => s.id));
  for (const s of authored) if (rooms.has(s.id)) throw Error(`slot ${s.id} conflicts with a footprint room; rename the authored slot`);
  const own = new Set(authored.map(s => s.id));
  return [...generated.filter(s => !own.has(s.id)), ...authored];
}

/** Body-centre clearance, matching the compiler's conservative yaw-box representation. */
function clearAt(p: Vec2, colliders: LocalOBB[], radius: number, height: number, y = 0): boolean {
  return !colliders.some(b => {
    if (b.y1 <= y + height * 0.075 + EPS || b.y0 >= y + height - EPS) return false;
    const x = p[0] - b.c[0], z = p[1] - b.c[1], c = Math.cos(b.yaw), s = Math.sin(b.yaw);
    return Math.abs(x * c - z * s) < b.half[0] + radius - EPS && Math.abs(x * s + z * c) < b.half[1] + radius - EPS;
  });
}

/** Find a continuous body-width lane across a declared opening, including its own walls/lintel. */
function lanes(o: Opening, b: Baked, radius: number, height: number): Vec2[] {
  if (o.kind === 'window' || o.width < radius * 2 - EPS || o.height < height - EPS || (o.sill ?? 0) > height * 0.075) return [];
  const c = Math.cos(o.yaw), s = Math.sin(o.yaw), half = o.width / 2 - radius;
  const n = Math.max(1, Math.min(4096, Math.ceil(half * 2 / (height * 0.1))));
  const points: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = -half + 2 * half * i / n, p: Vec2 = [o.at[0] + t * c, o.at[1] - t * s];
    let free = true;
    for (let j = -4; j <= 4; j++) { const d = j * height * 0.075; if (!clearAt([p[0] + d * s, p[1] + d * c], b.colliders, radius, height)) { free = false; break; } }
    if (free) points.push(p);
  }
  return points;
}

export type KitFootprintIssue = { code: 'architecture.headroom' | 'architecture.sealed' | 'architecture.unreachable'; detail: string };
/** Pure admission at the instance scale. Never applies to older kits or mesh sidecars. */
export function kitFootprintIssues(b: Baked, scale = 1): KitFootprintIssue[] {
  const radius = L.bodyWidthM / (2 * scale), height = L.bodyHeightM / scale;
  const issues: KitFootprintIssue[] = [], edges: [string, string][] = [], roomEdges: [string, string][] = [];
  const grids = new Map<string, { target: string; component(p: Vec2): string | undefined }>();
  for (const r of b.rooms ?? []) {
    if (r.height < height - EPS) { issues.push({ code: 'architecture.headroom', detail: `${r.id}: ${(r.height * scale).toFixed(2)} m headroom; needs ${L.bodyHeightM} m` }); continue; }
    // Components matter: an internal door behind a wall cannot connect two otherwise accessible rooms.
    const xs = r.polygon.map(p => p[0]), zs = r.polygon.map(p => p[1]), x0 = Math.min(...xs), z0 = Math.min(...zs);
    const width = Math.max(...xs) - x0, depth = Math.max(...zs) - z0;
    const step = Math.max(0.2 / scale, Math.sqrt(width * depth / 65536));
    const nx = Math.max(1, Math.ceil(width / step)), nz = Math.max(1, Math.ceil(depth / step));
    if (nx * nz > 100000) { issues.push({ code: 'architecture.unreachable', detail: `${r.id}: ground room is too elongated for the bounded clearance check` }); continue; }
    const points = new Map<number, Vec2>();
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
      const p: Vec2 = [x0 + (x + 0.5) * width / nx, z0 + (z + 0.5) * depth / nz];
      if (pointInPoly(p[0], p[1], r.polygon) && clearAt(p, b.colliders, radius, height, r.y)) points.set(z * nx + x, p);
    }
    if (!points.size) { issues.push({ code: 'architecture.headroom', detail: `${r.id}: no standing area with ${L.bodyHeightM} m headroom and ${L.bodyWidthM} m body clearance` }); continue; }
    const components = new Map<number, string>();
    let serial = 0;
    for (const start of points.keys()) {
      if (components.has(start)) continue;
      const name = `${r.id}:${serial++}`, queue = [start]; components.set(start, name);
      for (let i = 0; i < queue.length; i++) {
        const id = queue[i], x = id % nx, p = points.get(id)!;
        for (const next of [x ? id - 1 : -1, x + 1 < nx ? id + 1 : -1, id - nx, id + nx]) {
          const q = points.get(next);
          if (q && !components.has(next) && clearAt([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], b.colliders, radius, height, r.y)) { components.set(next, name); queue.push(next); }
        }
      }
    }
    const nearest = (p: Vec2) => {
      let best = -1, distance = Infinity;
      for (const [id, q] of points) { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < distance) { best = id; distance = d; } }
      return { id: best, distance };
    };
    grids.set(r.id, { target: components.get(nearest(r.origin).id)!, component(p) {
      if (!pointInPoly(p[0], p[1], r.polygon)) return undefined;
      const best = nearest(p), q = points.get(best.id)!;
      if (best.distance > step * 2 || !clearAt([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], b.colliders, radius, height, r.y)) return undefined;
      return components.get(best.id);
    } });
  }
  const offset = 0.6 / scale;
  for (const o of b.openings ?? []) {
    if (!o.from || !o.to) continue;
    const free = lanes(o, b, radius, height);
    if (free.length) roomEdges.push([o.from, o.to]);
    for (const p of free) {
      const n: Vec2 = [Math.sin(o.yaw) * offset, Math.cos(o.yaw) * offset];
      const from = grids.get(o.from)?.component([p[0] - n[0], p[1] - n[1]]);
      const to = o.to === 'outside' ? 'outside' : grids.get(o.to)?.component([p[0] + n[0], p[1] + n[1]]);
      if (from && to) edges.push([from, to]);
    }
  }
  const reached = reachableFromOutside(edges), roomReached = reachableFromOutside(roomEdges);
  for (const [room, grid] of grids) if (!reached.has(grid.target)) issues.push(roomReached.has(room)
    ? { code: 'architecture.unreachable', detail: `${room}: its standing target is cut off from outside by kit solids` }
    : { code: 'architecture.sealed', detail: `${room}: no body-width entrance connects this room to outside` });
  return issues;
}

export function kitFootprint(fp: 'open' | LmFootprint | undefined, baked: Baked, bounds: { min: Vec3; max: Vec3 }): Baked {
  if (!fp) return baked;
  const source: LmFootprint = fp === 'open' ? {
    schema: 'lm-building-footprint/1', id: 'kit-open', bounds,
    levels: [{ id: 0, y: 0 }],
    rooms: [{ id: 'ground', label: 'Ground', level: 0, y0: 0, y1: Math.max(0.01, bounds.max[1]), polygon: [[bounds.min[0], bounds.min[2]], [bounds.max[0], bounds.min[2]], [bounds.max[0], bounds.max[2]], [bounds.min[0], bounds.max[2]]] }],
  } : fp;
  const converted = footprintToBaked(source);
  const rooms = converted.rooms ?? [], openings = converted.openings ?? [];
  // The converter rounds to 0.1 mm; compare with that same tolerance.
  const outside = ([x, z]: Vec2) => x < bounds.min[0] - 1e-4 || x > bounds.max[0] + 1e-4 || z < bounds.min[2] - 1e-4 || z > bounds.max[2] + 1e-4;
  for (const s of converted.surfaces ?? []) if (s.polygon.some(outside)) throw Error(`room/floor ${s.tag} extends outside the kit floor bounds`);
  for (const c of converted.colliders) {
    const co = Math.abs(Math.cos(c.yaw)), si = Math.abs(Math.sin(c.yaw)), x = c.half[0] * co + c.half[1] * si, z = c.half[0] * si + c.half[1] * co;
    if (outside([c.c[0] - x, c.c[1] - z]) || outside([c.c[0] + x, c.c[1] + z]) || c.y1 > bounds.max[1] + 1e-4) throw Error(`obstacle ${c.tag} extends outside the kit bounds`);
  }
  if (fp === 'open') {
    const r = rooms[0], poly = r.polygon;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], z = poly[(i + 1) % poly.length], dx = z[0] - a[0], dz = z[1] - a[1];
      openings.push({ id: `open-${i}`, kind: 'door', at: [(a[0] + z[0]) / 2, (a[1] + z[1]) / 2], yaw: Math.atan2(dz, -dx), width: Math.hypot(dx, dz), height: r.height, level: 0, state: 'always', from: r.id, to: 'outside', exterior: true });
    }
  } else {
    for (const o of openings) {
      const n: Vec2 = [Math.sin(o.yaw) * 0.3, Math.cos(o.yaw) * 0.3];
      let from = rooms.find(r => pointInPoly(o.at[0] - n[0], o.at[1] - n[1], r.polygon));
      let to = rooms.find(r => pointInPoly(o.at[0] + n[0], o.at[1] + n[1], r.polygon));
      if (!from && to) { from = to; to = undefined; o.yaw += Math.PI; }
      o.from = from?.id; o.to = to?.id ?? 'outside'; o.exterior = !to;
    }
    for (const [i, r] of rooms.entries()) r.height = Math.min(r.height, source.rooms![i].clearHeight ?? Infinity);
    for (const s of converted.slots) if (s.kind === 'room') s.height = rooms.find(r => r.id === s.id)!.height;
  }
  const out: Baked = { ...baked, colliders: [...baked.colliders, ...converted.colliders], rooms, surfaces: converted.surfaces, openings, links: [], slots: converted.slots, notes: converted.notes };
  if (fp === 'open') out.notes = ['footprint open: one ground room at y=0, open on all four sides'];
  // A front stand gives describe's ordinary walk check a real outside starting point.
  for (const o of openings.filter(o => o.exterior && o.kind !== 'window')) {
    const lane = lanes(o, out, L.bodyWidthM / 2, L.bodyHeightM).sort((a, b) => Math.hypot(a[0] - o.at[0], a[1] - o.at[1]) - Math.hypot(b[0] - o.at[0], b[1] - o.at[1]))[0];
    if (!lane) continue;
    out.slots.push({ id: 'front', kind: 'stand', p: [lane[0] + Math.sin(o.yaw) * 1.2, 0, lane[1] + Math.cos(o.yaw) * 1.2], yaw: o.yaw + Math.PI, accepts: {}, capacity: 1 });
    break;
  }
  out.slots = mergeKitSlots(out.slots, baked.slots);
  return out;
}

