// ground/1 — the shared height model (spec: <eden4>/28 §4).
// The ground is a deterministic function of landform records. Server and
// browser bake the same 64 m tiles at 1 m spacing from the same records and
// sample the tiles, never the raw function, so they agree to the bit.
import { z } from 'zod';
import { brushBody, brushForm, channelBody, channelForm, cliffBody, cliffForm, terraceBody, terraceForm } from './forms.ts';

export const GROUND_SCHEMA = 'ground/1';
/** Tile edge in metres and samples per edge (65 × 65 corner samples). */
export const TILE_M = 64;
export const TILE_N = TILE_M + 1;

const v2 = z.tuple([z.number(), z.number()]);
const poly = z.array(v2).min(3).max(512);
const path = z.array(v2).min(2).max(512);
const finite = z.number().finite();

/** Point bump: hill, knoll, mountain. `peak` sharpens (1 = round, 3 = alpine). */
const bump = z.object({
  id: z.string(), kind: z.literal('bump'),
  c: v2, r: finite.positive(), h: finite, peak: finite.min(0.25).max(6).default(1),
});
/** Swept bump along a polyline: ridge, mountain range, dune line. */
const ridge = z.object({
  id: z.string(), kind: z.literal('ridge'),
  path, w: finite.positive(), h: finite, peak: finite.min(0.25).max(6).default(1),
});
/** Raised (or lowered) area with a soft edge: plateau, shelf, broad valley. */
const plateau = z.object({
  id: z.string(), kind: z.literal('plateau'),
  area: poly, h: finite, edge: finite.positive().default(8),
});
/** Carve to an absolute bed level: lake bed, river bed. Applied after natural forms. */
const carveBase = z.object({
  id: z.string(), kind: z.literal('carve'),
  area: poly.optional(), path: path.optional(), w: finite.positive().optional(),
  bed: finite, edge: finite.positive().default(4),
});
const areaOrPath = (c: { area?: unknown; path?: unknown; w?: unknown }) => (c.area ? !c.path : !!c.path && c.w !== undefined);
const carve = carveBase.refine(areaOrPath, { message: 'carve needs area, or path + w' });
/** Flatten to an absolute level: a building's foundation terrace. Applied last. */
const pad = z.object({
  id: z.string(), kind: z.literal('pad'),
  area: poly, level: finite, edge: finite.positive().default(1.5),
  /** pad/2 (lane RT, 2026-10-20): graded banks. Outside the flat (area and aprons) the ground is held within `grade`
   *  (rise/run) of the level, so every bank of the terrace is walkable; the last 2 m of `edge` ease back to the natural
   *  ground where a bank has not met it. Absent: the pad/1 smoothstep blend over `edge`, as before. */
  grade: finite.positive().optional(),
  /** pad/2: extra flat areas at the level, e.g. a landing in front of each exterior door. */
  aprons: z.array(poly).optional(),
});

// Tranche-2 kinds (L3, forms.ts): cliff, terrace, channel, brush. Additive: the five originals fold exactly as before.
export const landformSchema = z.discriminatedUnion('kind', [bump, ridge, plateau, carve, pad, cliffForm, terraceForm, channelForm, brushForm]);
export type Landform = z.infer<typeof landformSchema>;
/** A landform without its id (for defs that carry one as a component; the entity id becomes the landform id). */
export const landformBodySchema = z.discriminatedUnion('kind', [bump.omit({ id: true }), ridge.omit({ id: true }), plateau.omit({ id: true }), carveBase.omit({ id: true }).refine(areaOrPath, { message: 'carve needs area, or path + w' }), pad.omit({ id: true }), cliffBody, terraceBody, channelBody, brushBody]);
export type LandformBody = z.infer<typeof landformBodySchema>;

/** Standing water: surface level over an area or along a path. Depth = level − ground. */
export const waterSchema = z.object({
  id: z.string(), area: poly.optional(), path: path.optional(), w: finite.positive().optional(), level: finite,
  /** Path water only (rivers, L3): surface level per path point, flowing from the first to the last. `level` stays the lowest. */
  levels: z.array(finite).max(512).optional(),
}).refine((c) => (c.area ? !c.path : !!c.path && c.w !== undefined), { message: 'water needs area, or path + w' })
  .refine((c) => !c.levels || (!!c.path && c.levels.length === c.path.length), { message: 'water levels need a path and one level per point' });
export type Water = z.infer<typeof waterSchema>;

/** Low-amplitude value noise over natural forms only; integer-hash based, engine-independent. */
export const noiseSchema = z.object({ amp: finite.nonnegative(), scale: finite.positive(), seed: z.number().int() });

export const groundSchema = z.object({
  schema: z.literal(GROUND_SCHEMA),
  /** Plane height when no landform applies. */
  base: finite,
  /** World extent in metres [x0, z0, x1, z1]; tiles outside are never baked. */
  extent: z.tuple([finite, finite, finite, finite]),
  seaLevel: finite.optional(),
  noise: noiseSchema.optional(),
  landforms: z.array(landformSchema).max(4096),
  waters: z.array(waterSchema).max(1024),
});
export type Ground = z.infer<typeof groundSchema>;

export type Vec2 = [number, number];
export type Anchor = 'base' | 'center' | 'conform' | 'drape';

export function emptyGround(extentM = 1000, base = 0): Ground {
  const h = extentM / 2;
  return { schema: GROUND_SCHEMA, base, extent: [-h, -h, h, h], landforms: [], waters: [] };
}
