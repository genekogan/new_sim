// CATALOG adapter (spec eden4/31 B3, lane L9): the Mars engine's `AssetDef` derived from an entity-world def's
// components and slots, so god-placed chairs are sittable, tables carry items and bowls are carryable — with the
// same entity ids in the engine as in the entity world. Pure data in, pure data out: the server derives the asset
// once per (def, params), the `world-edit` event carries it, and the engine registers it into CATALOG on fold, so
// replay never needs the compiler.
//
// Frames. The entity world uses the three.js convention (yaw about +Y: x' = x cos + z sin, z' = −x sin + z cos);
// the Mars engine rotates the other way (x' = x cos − z sin). A pose with entity yaw θ is Mars yaw −θ, and local
// (x, z) offsets map unchanged. A seat's occupant faces the def's front (+z local), turned by the slot's own yaw.
import { CATALOG, fireRingRadius, type AssetDef, type SlotDef } from '../../../mars/viewer/engine/world/catalog.ts';
import type { SurfaceSlotDef } from '../../../mars/viewer/engine/world/catalog-items.ts';
import { createHash } from 'node:crypto';

/** What the adapter reads of a resolved def (a subset of world-compiler's StoredDef + the baked box/slots). */
export type DefFacts = {
  ref: string;
  hash: string;
  name: string;
  description?: string;
  tags: string[];
  layer: 'solid' | 'surface' | 'volume' | 'decor';
  // L1: presentation components may be lists (lights); fixture detection only reads their presence.
  components: Record<string, unknown>;
  /** Baked slots in the def frame: p [x, y, z], yaw (entity convention). */
  slots: { id: string; kind: string; p: [number, number, number]; yaw: number; height?: number; capacity?: number }[];
  /** Baked local box at the entity's scale (x width, y height, z depth). */
  box: [number, number, number];
  palette?: Record<string, string>;
};

/** Components that make a def an engine fixture or item (everything else becomes plain solids/floors/links). */
export const FIXTURE_COMPONENTS = ['seat', 'bed', 'surface', 'container', 'carryable', 'readable', 'workstation', 'instrument', 'boardGame', 'display'] as const;
export const isFixtureDef = (d: Pick<DefFacts, 'components'> & Partial<Pick<DefFacts, 'tags' | 'name' | 'ref'>>) => FIXTURE_COMPONENTS.some((k) => !!d.components[k]) || isFireCircleDef(d);
/** A small one-hand item the engine's items verbs (take_item / put_item) can carry. */
export const isCarryableDef = (d: Pick<DefFacts, 'components'>) => !!d.components.carryable;

const SURFACE_PITCH = 0.3, SURFACE_MARGIN = 0.12;
const r4 = (v: number) => Math.round(v * 10000) / 10000;
const short = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 10);

/** Engine asset id for a def at given params/scale: stable, namespaced, ≤ 80 chars. */
export function assetIdFor(d: Pick<DefFacts, 'ref' | 'hash' | 'box'> & Partial<Pick<DefFacts, 'slots'>>, paramsKey: string): string {
  // A policy change gets a new asset identity. Old logged assets/active slots keep their original approach semantics.
  const policy = (d.slots?.some((s) => s.kind === 'seat') ? '|seat-approach:reachable/1' : '') + (isFireCircleDef(d) ? '|fire-circle/1' : '');
  return `ew:${d.ref.replace(/[^a-z0-9/@._-]/gi, '').slice(0, 48)}:${short(`${d.hash}|${paramsKey}|${d.box.map(r4).join(',')}${policy}`)}`;
}

/** Surface-slot lattice over a top of size (w, d) at height y (pitch 0.3 m, ids `<slot>-r<i>c<j>`), centred on (cx, cz). */
export function surfaceLattice(slot: string, w: number, d: number, y: number, cx = 0, cz = 0): SurfaceSlotDef[] {
  const nx = Math.max(1, Math.floor((w - 2 * SURFACE_MARGIN) / SURFACE_PITCH) + 1), nz = Math.max(1, Math.floor((d - 2 * SURFACE_MARGIN) / SURFACE_PITCH) + 1);
  const out: SurfaceSlotDef[] = [];
  for (let i = 0; i < nz; i++) for (let j = 0; j < nx; j++) out.push({ id: `${slot}-r${i}c${j}`, local: [r4(cx + (j - (nx - 1) / 2) * SURFACE_PITCH), r4(y), r4(cz + (i - (nz - 1) / 2) * SURFACE_PITCH)] });
  return out;
}

/** B6: an open fire people gather round (a campfire, a bonfire, a fire pit): its asset gets fire-circle places, so the
 *  engine's campfire_circle (warm-by-fire) works on a god-built fire exactly as on the old worlds' native campfire. */
export const isFireCircleDef = (d: Partial<Pick<DefFacts, 'tags' | 'name' | 'ref'>>) => !!d.tags?.includes('fire') && (d.tags.includes('camp') || /campfire|bonfire|fire-?pit/i.test(`${d.name ?? ''} ${d.ref ?? ''}`));
/** Fire-circle places round a fire whose stone ring is `ring` m across: 8 on the engine's fire-ring radius, each facing the
 *  fire, leaving out any within 0.7 m of one of the def's own seats (a campfire's logs). Local frame, Mars yaw. */
export function fireCircleSlots(ring: number, seats: { p: [number, number, number] }[]): SlotDef[] {
  const R = fireRingRadius(ring, ring), out: SlotDef[] = [];
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4, x = r4(R * Math.cos(a)), z = r4(R * Math.sin(a));
    if (seats.some((s) => Math.hypot(s.p[0] - x, s.p[2] - z) < 0.7)) continue;
    out.push({ id: `ring${k}`, kind: 'fire-circle', local: [x, z], yaw: r4(a + Math.PI) });
  }
  return out;
}

/** A thing that floats or hovers (a canoe, a rowing boat): it lies in the water beside a jetty or a bank, so its box is
 *  no walking obstacle there (party F1: a moored canoe's box closed the jetty); it is boarded from its side. */
export const isFloatingDef = (d: Pick<DefFacts, 'components'>) => !!d.components.hover;

/** The engine AssetDef of an entity-world def (for an id from assetIdFor). `seen`: a decoration that is only perceived
 *  (a fountain, a lamp, a sign): a fixture Souls can see, look at and name, with no slots and no obstacle of its own
 *  (its walls and rims are the entity's solids, as before). */
export function assetFromDef(id: string, d: DefFacts, o: { seen?: boolean } = {}): AssetDef {
  const c = d.components as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const [w, h, dd] = d.box;
  const label = (d.description?.replace(/\.$/, '') || d.name.replace(/^core-/, '')).slice(0, 80);
  const color = d.palette ? Object.values(d.palette)[0] : undefined;
  const out: AssetDef = {
    id, label, category: c.carryable && !o.seen ? 'item' : 'fixture', size: [r4(w), r4(h), r4(dd)],
    massKg: typeof c.carryable?.mass === 'number' ? c.carryable.mass : Math.max(1, Math.round(w * h * dd * 40)),
    ...(color ? { color } : {}),
    dims: { confidence: 'hypothetical', note: `derived from entity-world def ${d.ref} (${d.hash.slice(0, 12)}) by the L9 catalog adapter` },
  };
  if (o.seen) return out;
  if (c.carryable) {
    // one hand, palm under the base (catalog-items.ts hand1): the engine's take_item / put_item / serve verbs
    out.handling = { carryCrew: [1, 1], carryPose: 'flat', grips: { 1: [{ id: 'hand', local: [0, 0, 0] }] }, carryHeight: 0.95, hands: 1, small: true };
  // B6: a fire's box spans its logs; its stone ring and logs are the entity's own solids, so the box is no obstacle
  // (people stand inside it, round the fire)
  } else if (!isFloatingDef(d) && !isFireCircleDef(d)) out.obstacle = true;
  const seats: SlotDef[] = d.slots.filter((s) => s.kind === 'seat').map((s) => ({ id: s.id, kind: 'seat' as const, local: [r4(s.p[0]), r4(s.p[2])], yaw: r4(Math.PI / 2 - s.yaw), approachPolicy: 'reachable/1' }));
  const stands: SlotDef[] = d.slots.filter((s) => s.kind === 'stand').map((s) => ({ id: s.id, kind: 'stand' as const, local: [r4(s.p[0]), r4(s.p[2])], yaw: r4(Math.PI / 2 - s.yaw) }));
  // B6: the stone ring is the def's description's size when it says so ("a ring of stones (1.6 m)"), else 1 m
  const ring = Number(/ring of stones \((\d+(?:\.\d+)?) m\)/.exec(d.description ?? '')?.[1] ?? 1);
  const fire = isFireCircleDef(d) ? fireCircleSlots(Math.min(ring, Math.min(w, dd)), d.slots.filter((s) => s.kind === 'seat')) : [];
  if (seats.length || stands.length || fire.length) out.slots = [...seats, ...stands, ...fire];
  const tops = d.slots.filter((s) => s.kind === 'surface' || s.kind === 'shelf');
  if (tops.length) out.surfaceSlots = tops.flatMap((s) => surfaceLattice(s.id, tops.length === 1 ? w : Math.min(w, 1.2), tops.length === 1 ? dd : Math.min(dd, 0.8), s.height ?? s.p[1] ?? c.surface?.height ?? h, tops.length === 1 ? 0 : s.p[0], tops.length === 1 ? 0 : s.p[2]));
  else if (c.surface) out.surfaceSlots = surfaceLattice('top', w, dd, c.surface.height ?? h);
  const caps: NonNullable<AssetDef['capabilities']> = {};
  if (c.readable) caps.readable = { pages: Math.max(1, Math.round(c.readable.pages ?? 4)), maxSeatDistance: 0.65 };
  if (c.display) caps.display = { accepts: 'text', maxChars: 280 };
  if (c.boardGame?.game === 'chess') caps.boardGame = 'chess';
  if (Object.keys(caps).length) out.capabilities = caps;
  return out;
}

/** The surface-slot id of a lattice nearest a local point on a table (for items resting on it). */
export function nearestSurfaceSlot(a: AssetDef, local: [number, number, number]): string | null {
  let best: string | null = null, bd = Infinity;
  for (const s of a.surfaceSlots ?? []) { const dd = (s.local[0] - local[0]) ** 2 + (s.local[2] - local[2]) ** 2; if (dd < bd - 1e-12) { bd = dd; best = s.id; } }
  return best;
}

/** Make derived assets known to the engine (idempotent; an id never changes meaning: same def hash + params). */
export function registerAssets(assets: Record<string, unknown> | undefined): number {
  let n = 0;
  for (const id of Object.keys(assets ?? {}).sort()) if (!CATALOG[id]) { CATALOG[id] = structuredClone(assets![id]) as AssetDef; n++; }
  return n;
}
