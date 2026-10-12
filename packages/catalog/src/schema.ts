// The catalogue's two records (docs/god/CATALOG-PROGRAM.md (a); P0 of the phased plan).
//
//   def/2  — what the engine compiles and a world pins by hash: shape, params, physics, interfaces. A strict superset of
//            def/1's engine fields; the WORDS (description, category, synonyms) are not in it (Gene's Q7: text outside
//            the hash), so a better synonym or a thumbnail never forks a world.
//   item/1 — the catalogue's record ABOUT a def: id, major, rev (= the def/2 hash), status, words, licence, provenance,
//            media, measured budgets, gate results, play stats, review. Never hashed into worlds.
//
// Both reject unknown top-level keys. New capabilities go through `components` (open, versioned by the contract) and
// new interface verbs through slot kinds and actuators; an item needing an unknown one fails G1 with capability.unknown.
import { z } from 'zod';
import { fieldSchema, slotSchema, materialEnum, NAME, ID } from '@sim/generators';
import { defSchema as def1Schema, partSchema, makeSchema, componentsSchema, actionSchema } from '@sim/world-compiler';

export const DEF2 = 'def/2' as const;
export const ITEM1 = 'item/1' as const;

const num = z.number().finite();
const v3 = z.tuple([num, num, num]);
const v2 = z.tuple([num, num]);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
const CATEGORY = z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){0,3}$/);

/** Namespaces: `eden` (the public catalogue), packs (`lm`, `mars`), later `w/<world>` for an owner's own things. */
export const NAMESPACES = ['eden', 'lm', 'mars'] as const;
export const ITEM_ID = /^[a-z][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/;

// ------------------------------------------------------------------------------------------------ def/2

/** Param groups: what kind of knob it is (the god's UI and the G3 sweep read this). */
export const PARAM_GROUPS = ['stretch', 'warp', 'paint', 'wear', 'variant', 'option', 'size', 'own'] as const;
export const UNITS = ['m', 'deg', '%', 'rpm', 's', ''] as const;
const meta = { doc: z.string().min(1).max(200), group: z.enum(PARAM_GROUPS), vis: z.array(z.string()).optional() };
/** def/2 params: every number has a range and a default, every enum a default, every field a doc and a group. */
export const param2Schema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('number'), min: num, max: num, default: num, step: num.positive().optional(), unit: z.enum(UNITS).default(''), ...meta }).strict(),
  z.object({ type: z.literal('int'), min: z.number().int(), max: z.number().int(), default: z.number().int(), unit: z.enum(UNITS).default(''), ...meta }).strict(),
  z.object({ type: z.literal('bool'), default: z.boolean(), ...meta }).strict(),
  z.object({ type: z.literal('enum'), values: z.array(z.string()).min(1).max(64), default: z.string(), ...meta }).strict(),
  z.object({ type: z.literal('color'), default: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), ...meta }).strict(),
  z.object({ type: z.literal('string'), max: z.number().int().max(2000).default(200), default: z.string().optional(), ...meta }).strict(),
  // def/1 json/ref fields pass through unchanged (rare: plans, shape lists)
  z.object({ type: z.literal('json'), default: z.unknown().optional(), ...meta }).passthrough(),
  z.object({ type: z.literal('ref'), default: z.string().optional(), ...meta }).passthrough(),
]).superRefine((f, ctx) => {
  const r = f as { type: string; min?: number; max?: number; default?: unknown; values?: string[] };
  if ((r.type === 'number' || r.type === 'int') && (r.min! > r.max! || (r.default as number) < r.min! || (r.default as number) > r.max!)) ctx.addIssue({ code: 'custom', message: `default ${String(r.default)} outside ${r.min}..${r.max}` });
  if (r.type === 'enum' && !r.values!.includes(String(r.default))) ctx.addIssue({ code: 'custom', message: `default ${String(r.default)} not among values` });
});
export type Param2 = z.infer<typeof param2Schema>;

export const ACTUATOR_KINDS = ['power', 'door', 'lock', 'fill', 'ignite', 'play'] as const;
export const actuatorDeclSchema = z.tuple([z.enum(ACTUATOR_KINDS), z.object({ default: z.union([z.boolean(), num]).optional(), label: z.string().max(60).optional() }).strict()]);

/** Physics: how it collides, whether it blocks navigation, and where a body stands to use it. */
export const physicsSchema = z.object({
  collide: z.enum(['box', 'walls', 'hull', 'mesh', 'none']),   // walls = wall segments (enterable things never get solid blocks)
  blocksNav: z.boolean(),
  walkableTop: z.boolean().default(false),
  mass: num.positive().optional(),
  approach: z.array(v2).max(32).optional(),
}).strict();

/**
 * LAYERS defaults (owner, access, schedule, price). **INERT** (Gene, Q10): kept so VOCAB-W3 data round-trips, but the
 * economy is not designed, so nothing in the catalogue gates, ranks or reasons about these fields. Coding agents: do
 * NOT treat `layersInert` as live behaviour; the engine applies def/1 `layers` exactly as before and nothing more.
 */
export const layersInertSchema = z.object({
  INERT: z.literal(true),
  owner: z.unknown().optional(), access: z.unknown().optional(), schedule: z.unknown().optional(), price: z.unknown().optional(),
}).strict();

export const def2Schema = z.object({
  schema: z.literal(DEF2),
  name: z.string().regex(NAME),
  version: z.number().int().min(1),                        // = the item's major
  extends: z.string().optional(),
  /** Engine-semantic labels (slot `accepts.tags` match them). Words for people live in item.text. */
  tags: z.array(z.string().regex(NAME)).max(32).default([]),
  form: z.enum(['point', 'path', 'area']),
  make: makeSchema,
  params: z.record(z.string().regex(ID), param2Schema).default({}),
  state: z.record(z.string(), fieldSchema).default({}),
  slots: z.array(slotSchema).max(512).default([]),
  actuators: z.array(actuatorDeclSchema).max(6).default([]),
  actions: z.array(actionSchema).max(32).default([]),
  components: componentsSchema.default({}),
  size: z.object({ box: v3, scale: z.tuple([num.positive(), num.positive()]).default([1, 1]) }).strict(),
  anchor: z.enum(['base', 'center', 'conform', 'drape', 'float']),
  layer: z.enum(['solid', 'surface', 'volume', 'decor']),
  physics: physicsSchema.optional(),
  tilt: z.object({ maxDeg: num.min(0).max(90) }).optional(),
  overlaps: z.array(z.string()).max(32).default([]),
  contents: z.array(partSchema).max(256).optional(),
  layersInert: layersInertSchema.optional(),
  material: materialEnum.optional(),
  palette: z.record(z.string().max(32), z.string().regex(/^#[0-9a-fA-F]{6}$/)).optional(),
}).strict();
export type Def2 = z.infer<typeof def2Schema>;
export type Def2Input = z.input<typeof def2Schema>;

// ------------------------------------------------------------------------------------------------ item/1

export const STATUSES = ['draft', 'candidate', 'stable', 'deprecated', 'yanked'] as const;
export const GATES = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'] as const;
/** Licences. Our own assets are CC0 (Gene, Q2 follow-up). Third-party restricted assets are recorded with their source and
 *  kept from redistribution (never offered to other owners' worlds, never exported); nothing blocks Gene's own use. */
export const LICENCES = ['CC0-1.0', 'CC-BY-4.0', 'Eden-internal', 'third-party-restricted'] as const;
export const REDISTRIBUTABLE: Record<(typeof LICENCES)[number], boolean> = { 'CC0-1.0': true, 'CC-BY-4.0': true, 'Eden-internal': false, 'third-party-restricted': false };

const gateResult = z.object({ ok: z.boolean(), at: isoDate, report: z.string().max(4000), numbers: z.record(z.string(), num).optional(), grandfathered: z.boolean().optional() }).strict();

export const item1Schema = z.object({
  schema: z.literal(ITEM1),
  id: z.string().regex(ITEM_ID),
  major: z.number().int().min(1),
  rev: sha256,                                            // = hash(def/2), filled by the build
  status: z.enum(STATUSES),
  supersedes: z.array(sha256).default([]),
  /** Old refs that resolve to this item (worlds and god scripts keep working): core/<x>@1, core-<x>@1. */
  aliases: z.array(z.string()).max(8).default([]),
  /** The def/1 hash worlds already pinned for this item (import-core), so a world's stored def maps back to its item. */
  def1Hash: sha256.optional(),
  text: z.object({
    title: z.string().min(1).max(60),
    first: z.string().max(160),                           // first sentence: what, size, use
    description: z.string().max(4000),
    category: CATEGORY,
    alsoIn: z.array(CATEGORY).max(3).default([]),
    synonyms: z.array(z.string().min(2).max(40)).max(24), // ≥ 3 is a G1 rule for new items (grandfathered imports queue a text pass)
    heldOut: z.array(z.string()).max(8).default([]),     // eval words, deliberately not indexed (G5)
    i18n: z.record(z.string(), z.object({ title: z.string(), synonyms: z.array(z.string()) })).optional(),
  }).strict(),
  affords: z.array(z.string()).default([]),               // derived from slots/actuators/components
  sound: z.object({ kinds: z.array(z.string()) }).optional(),
  behaviour: z.object({ kind: z.string() }).optional(),
  budgets: z.object({                                     // measured by the build (G2), never typed in
    tris: z.object({ lod0: z.number().int().min(0), lod1: z.number().int().min(0).optional() }).strict(),
    draws: z.number().int().min(0), materials: z.number().int().min(0),
    bytes: z.object({ def: z.number().int().min(0), assets: z.number().int().min(0), textures: z.number().int().min(0) }).strict(),
    texturePx: z.number().int().min(0),
    limit: z.string(),
    measured: z.enum(['kit', 'asset-meta', 'estimate']),   // how tris/draws were measured
  }).strict(),
  licence: z.object({ spdx: z.enum(LICENCES), attribution: z.string().optional(), source: z.string().optional(), redistribute: z.boolean() }).strict(),
  provenance: z.object({
    route: z.enum(['kit', 'preset', 'set', 'generator', 'glb', 'import']),
    author: z.string(), run: z.string(), at: isoDate,
    parents: z.array(z.string()).default([]),
    tool: z.string(), sourceHash: sha256, family: z.string().optional(),
  }).strict(),
  media: z.object({ thumb: sha256.optional(), views: z.array(sha256).max(8).default([]), states: z.record(z.string(), sha256).default({}) }).strict(),
  tests: z.object({ contract: z.string(), gates: z.partialRecord(z.enum(GATES), gateResult).default({}) }).strict(),
  play: z.object({ placed: z.number().int(), kept: z.number().int(), worlds: z.number().int(), soulUses: z.number().int(), score: num.optional() }).strict().optional(),
  review: z.object({ by: z.string(), verdict: z.enum(['ok', 'fix', 'reject']), note: z.string().optional(), at: isoDate }).strict().optional(),
  /** Retrieval tier (hot = in the agent's T0 context and server memory; cold = on disk, promoted on demand). Derived. */
  tier: z.enum(['hot', 'cold']).default('cold'),
}).strict();
export type Item1 = z.infer<typeof item1Schema>;

export { def1Schema };
