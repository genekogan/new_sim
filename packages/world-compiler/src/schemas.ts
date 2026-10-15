// entity/1 — the world's state model and edit grammar (spec <eden4>/28 §3, §5).
// Everything a god or the server exchanges is one of these shapes. Keep them
// compact; the compiler (compile.ts) is the only thing that interprets them.
import { z } from 'zod';
import { landformBodySchema } from '@sim/ground';
import { ID, NAME, fieldSchema, fieldsSchema, materialEnum, num, slotSchema, v2, v3, value } from '@sim/generators';
import { ACCESS, layersStateSchema, ownerRef, priceSchema, relRef, RELATIONS, scheduleSchema } from './layers.ts';

export const ENTITY_SCHEMA = 'entity/1';
export const DEF_SCHEMA = 'def/1';
export const EDIT_SCHEMA = 'edit/1';

export { ID, NAME, value, fieldSchema, fieldsSchema, slotKind, slotSchema, materialEnum } from '@sim/generators';
export type { Value, Field, FieldInput, Slot, Material } from '@sim/generators';
export const DEF_REF = /^((?:core|eden|lm|mars)\/[a-z0-9][a-z0-9._-]*@\d+|sha:[0-9a-f]{16,64}|[a-z0-9][a-z0-9._-]*@\d+)$/;

// ---------- defs ----------

/** Closed component set; each is a config object the engine understands. New components are level-3 code work. */
export const componentsSchema = z.object({
  seat: z.object({ height: num.default(0.45) }).optional(),
  bed: z.object({ height: num.default(0.5) }).optional(),
  surface: z.object({ height: num }).optional(),
  container: z.object({ capacity: num.positive(), of: z.array(z.string()).optional() }).optional(),
  carryable: z.object({ mass: num.positive(), grips: z.number().int().min(1).max(4).default(1) }).optional(),
  opening: z.object({ width: num.positive(), height: num.positive(), state: z.enum(['open', 'closed', 'always']).default('always') }).optional(),
  floor: z.object({ level: z.number().int().default(0), y: num.default(0) }).optional(),
  stairs: z.object({ rise: num.positive(), run: num.positive(), treads: z.number().int().min(1) }).optional(),
  ramp: z.object({ grade: num.positive().max(1) }).optional(),
  water: z.object({ level: num }).optional(),
  landform: landformBodySchema.optional(),
  scatter: z.object({ of: z.array(z.object({ def: z.string().regex(DEF_REF), weight: num.positive().default(1) })).min(1).max(16), density: num.positive().max(10), minSpacing: num.positive().default(1.5), except: z.array(v2).max(256).default([]) }).optional(),
  light: z.object({ color: z.string().regex(/^#[0-9a-f]{6}$/).default('#ffe9c4'), range: num.positive().default(8), on: z.boolean().default(true) }).optional(),
  display: z.object({ w: num.positive(), h: num.positive() }).optional(),
  paint: z.object({ faces: z.array(z.enum(['front', 'back', 'all'])).default(['all']) }).optional(),
  plant: z.object({ stages: z.number().int().min(1).max(8).default(3), daysPerStage: num.positive().default(1) }).optional(),
  instrument: z.object({ kind: z.string() }).optional(),
  readable: z.object({ pages: z.number().int().min(1) }).optional(),
  workstation: z.object({ kind: z.string() }).optional(),
  boardGame: z.object({ game: z.string() }).optional(),
  venue: z.object({ presenter: z.string().optional(), audience: z.string().optional(), capacity: z.number().int().positive().optional() }).optional(),
  carrier: z.object({ seats: z.number().int().min(1), route: z.string().optional() }).optional(),
  foundation: z.object({ kind: z.enum(['pad', 'skirt', 'none']).default('pad') }).optional(),
  /** This def is (or contains) a place Souls can be in: rooms of buildings, plazas, gardens, pitches. Stage B derives the place tree from it. */
  place: z.object({ kind: z.string().max(40), enclosed: z.boolean().default(false), capacity: z.number().int().positive().optional() }).optional(),
  /** Decorative motion, client-side and deterministic from world tick: rotate parts with role `blade|wheel` or the whole thing. */
  spin: z.object({ axis: z.enum(['x', 'y', 'z']).default('y'), rpm: num.default(2), role: z.string().optional() }).optional(),
  sway: z.object({ amount: num.min(0).max(1).default(0.15), period: num.positive().default(6) }).optional(),
  hover: z.object({ height: num.default(0), bob: num.min(0).max(2).default(0.15), period: num.positive().default(4) }).optional(),
  /** Follow the entity's own path shape (or a ref's) at `speed` m/s; loop or ping-pong. Balloons, boats, carts, trains. */
  route: z.object({ ref: z.string().optional(), speed: num.positive().default(2), loop: z.boolean().default(true), altitude: num.default(0) }).optional(),
  /** Creature behaviour, client-side deterministic: needs a gait in kit args (or a pack animal). */
  behavior: z.object({ kind: z.enum(['wander', 'graze', 'swim', 'perch', 'sleep', 'fly', 'follow', 'idle']), speed: num.positive().default(1), radius: num.positive().default(8), ref: z.string().optional() }).optional(),
  /** VOCAB-W2 sound layer (viewer, procedural WebAudio, new worlds): a loop while state `when` holds ('on', '!open', 'lit'),
   *  or a one-shot each time that field changes (mode 'change'); heard within `radius` m of the thing (path/area: its outline). */
  sound: z.object({ kind: z.enum(['water', 'stream', 'fire', 'wind', 'creak', 'birds', 'bell', 'hum', 'engine', 'chime', 'frogs', 'music']), radius: num.positive().max(200).default(14), volume: num.min(0).max(1).default(0.5), when: z.string().regex(/^!?[a-z][a-zA-Z0-9]*$/).optional(), mode: z.enum(['loop', 'change']).default('loop') }).optional(),
  /** Text on a sign or board (state `text` overrides). */
  sign: z.object({ lines: z.array(z.string().max(80)).max(6).default([]) }).optional(),
  body: z.object({
    media: z.array(z.enum(['walk', 'swim', 'fly', 'float'])).min(1),
    radius: num.positive(), height: num.positive(),
    landmarks: z.record(z.string(), v3).default({}),
    carry: z.object({ slot: z.enum(['hands', 'top', 'mouth', 'back']), maxMass: num.nonnegative(), maxSize: v3 }),
    settle: z.enum(['sit', 'lie', 'rest', 'hover']).default('rest'),
    rig: z.enum(['humanoid', 'quadruped']).nullable().default(null),
  }).optional(),
});
export type Components = z.infer<typeof componentsSchema>;

/** Declarative action on a def's own subtree. `when` compares own state; `then` changes own state or attachments. */
export const actionSchema = z.object({
  name: z.string().regex(NAME),
  label: z.string().max(80),
  roles: z.union([z.literal('anyone'), z.array(z.string())]).default('anyone'),
  reach: z.enum(['touch', 'place', 'anywhere']).default('touch'),
  params: z.record(z.string().regex(ID), fieldSchema).default({}),
  when: z.array(z.object({ field: z.string(), is: value.optional(), not: value.optional() })).max(8).default([]),
  then: z.array(z.discriminatedUnion('op', [
    z.object({ op: z.literal('set'), field: z.string(), value: z.union([value, z.object({ param: z.string() })]) }),
    z.object({ op: z.literal('toggle'), field: z.string() }),
    z.object({ op: z.literal('attach'), what: z.enum(['actor', 'held']), slot: z.string() }),
    z.object({ op: z.literal('detach'), what: z.enum(['actor', 'held']) }),
  ])).min(1).max(8),
});
export type Action = z.infer<typeof actionSchema>;

/** `$param` substitution and simple arithmetic only; no loops. Evaluated at expansion time. */
export const expr = z.union([num, z.string().max(200), z.boolean()]);

export const partSchema = z.object({
  id: z.string().regex(NAME),
  def: z.string().regex(DEF_REF),
  slot: z.string().optional(),      // slot on the parent part (or on the prefab root when `in` is absent)
  in: z.string().optional(),        // parent part id; default: the prefab root
  p: z.union([v2, v3]).optional(), r: z.union([num, v3]).optional(), s: num.optional(),
  params: z.record(z.string(), expr).optional(),
  state: z.record(z.string(), expr).optional(),
  /** Include only when the expression is truthy: "$porch", "$floors > 1" (one comparison). */
  when: z.string().max(80).optional(),
  /** Repeat the part `count` times, stepping by [dx, dz] (and yaw) each time; ids get -1, -2, … */
  repeat: z.object({ count: z.union([z.number().int().min(1).max(64), z.string().max(40)]), step: v2.default([1, 0]), yaw: num.default(0) }).optional(),
  /** VOCAB-W3: LAYERS defaults the part's entity starts with (a café counter's price, a hall's opening hours). */
  owner: ownerRef.optional(), access: z.enum(ACCESS).optional(), schedule: scheduleSchema.optional(), price: priceSchema.optional(),
});
export type Part = z.infer<typeof partSchema>;

export const makeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('mesh'), asset: z.string().regex(/^[0-9a-f]{64}$/), lod1: z.string().regex(/^[0-9a-f]{64}$/).optional(), collide: z.enum(['box', 'hull', 'mesh', 'none']).default('box'), /** sha of an lm-building-footprint/1 sidecar in the asset store (rooms, walls, openings, links) */ footprint: z.string().regex(/^[0-9a-f]{64}$/).optional() }),
  z.object({ kind: z.literal('gen'), gen: z.string().regex(/^[a-z][a-z0-9-]*\/\d+$/), args: z.record(z.string(), z.unknown()).optional() }),
  z.object({ kind: z.literal('parts'), parts: z.array(partSchema).min(1).max(256) }),
  /** Nothing to draw or collide with: a place marker, a region, a landform-only def. */
  z.object({ kind: z.literal('none') }),
]);

export const defSchema = z.object({
  schema: z.literal(DEF_SCHEMA),
  name: z.string().regex(NAME),
  version: z.number().int().min(1).default(1),
  extends: z.string().regex(DEF_REF).optional(),
  description: z.string().max(4000).default(''),
  tags: z.array(z.string().regex(NAME)).max(32).default([]),
  /** VOCAB-MECH: the catalogue category (a node of vocab/taxonomy.json, e.g. "building.commercial") and the words people
   *  use for it ("bodega", "corner shop"). Optional (no default) so defs without them hash as before; search infers one. */
  category: z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){0,3}$/).optional(),
  synonyms: z.array(z.string().min(2).max(40)).max(24).optional(),
  form: z.enum(['point', 'path', 'area']).default('point'),
  make: makeSchema,
  params: fieldsSchema.default({}),
  state: fieldsSchema.default({}),
  slots: z.array(slotSchema).max(512).default([]),
  components: componentsSchema.default({}),
  actions: z.array(actionSchema).max(32).default([]),
  anchor: z.enum(['base', 'center', 'conform', 'drape', 'float']).default('base'),
  /** Default material and palette (colour per tint key) for the mesh half. */
  material: materialEnum.optional(),
  palette: z.record(z.string().max(32), z.string().regex(/^#[0-9a-fA-F]{6}$/)).optional(),
  tilt: z.object({ maxDeg: num.min(0).max(90) }).optional(),
  layer: z.enum(['solid', 'surface', 'volume', 'decor']).default('solid'),
  /** Local box in metres (x width, y height, z depth) at scale 1, and the allowed uniform-scale range. */
  size: z.object({ box: v3, scale: z.tuple([num.positive(), num.positive()]).default([1, 1]) }),
  overlaps: z.array(z.string()).max(32).default([]),
  /** VOCAB-W3: things placed with it, each its own entity afterwards (a furnished building: the beds, tables and
   *  counters in its rooms, `slot` = the room id). Same shape as prefab parts. Optional, so other defs hash as before. */
  contents: z.array(partSchema).max(256).optional(),
  /** VOCAB-W3: LAYERS defaults a placed entity starts with unless the place op says otherwise (the god overrides with `set`). */
  layers: z.object({ owner: ownerRef.optional(), access: z.enum(ACCESS).optional(), schedule: scheduleSchema.optional(), price: priceSchema.optional() }).optional(),
  /** Filled by the compiler at define time; never trusted from input. */
  budget: z.object({ tris: z.number().int(), bytes: z.number().int(), textures: z.number().int() }).optional(),
});
export type Def = z.infer<typeof defSchema>;
export type DefInput = z.input<typeof defSchema>;

/** A def as stored: input + hash + provenance. */
export type StoredDef = Def & { hash: string; ref: string; by: string; born: number };

// ---------- entities ----------

/** Persistent relationships. Server-maintained: float, ground, facing, along (re-solved when refs or terrain change).
 *  Advisory: near, inside, clear (checked by `resolve`, reported by `describe`). Spec 33 §3.3. */
export const constraintSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('float'), sink: num.default(0) }),
  z.object({ kind: z.literal('ground') }),
  z.object({ kind: z.literal('facing'), ref: z.string(), offset: num.default(0) }),
  z.object({ kind: z.literal('along'), ref: z.string(), t: num.min(0).max(1), side: z.enum(['center', 'left', 'right']).default('center'), offset: num.default(0) }),
  z.object({ kind: z.literal('near'), ref: z.string(), dist: num.positive() }),
  z.object({ kind: z.literal('inside'), ref: z.string() }),
  z.object({ kind: z.literal('clear'), area: z.array(v2).min(3).max(64) }),
]);
export type Constraint = z.infer<typeof constraintSchema>;
const constraintsSchema = z.array(constraintSchema).max(8);

export const entitySchema = z.object({
  /** `e_…` for things; `h_…` for Souls' bodies, whose id is the engine's entity id (spec 31 §3 rule 3). */
  id: z.string().regex(/^[eh]_[a-z0-9]{4,12}$/),
  name: z.string().regex(NAME).optional(),
  def: z.string().regex(DEF_REF),
  in: z.object({ parent: z.union([z.literal('world'), z.string()]), slot: z.string().optional() }),
  p: z.union([v2, v3]).optional(),
  r: z.union([num, v3]).optional(),
  s: num.positive().optional(),
  shape: z.union([z.object({ path: z.array(v2).min(2).max(512), width: num.positive().optional() }), z.object({ area: z.array(v2).min(3).max(512) })]).optional(),
  anchor: z.enum(['base', 'center', 'conform', 'drape', 'float']).optional(),
  params: z.record(z.string(), value).optional(),
  state: z.record(z.string(), value).optional(),
  seed: z.number().int().optional(),
  constraints: constraintsSchema.optional(),
  /** LAYERS (absent until the god uses them): owner, access, schedule, price. */
  owner: ownerRef.optional(),
  access: z.enum(ACCESS).optional(),
  schedule: scheduleSchema.optional(),
  price: priceSchema.optional(),
  by: z.string(), born: z.number().int(), v: z.number().int().default(1),
});
export type Entity = z.infer<typeof entitySchema>;

// ---------- world ----------

export const worldConstantsSchema = z.object({
  extent: num.positive().max(16000),                 // side length in metres; grows only
  ground: z.enum(['land', 'ocean', 'void']),
  base: num.default(0),
  seaLevel: num.optional(),
  limits: z.object({
    entities: z.number().int().default(50000),
    sizeMax: v3.default([400, 120, 400]),
    sizeMin: num.default(0.05),
    budget: z.object({ tris: z.number().int().default(80000), bytes: z.number().int().default(3_000_000), texPx: z.number().int().default(2048) }).prefault({}),
  }).prefault({}),
});
export type WorldConstants = z.infer<typeof worldConstantsSchema>;

/** Sky palettes the `world` op accepts. The viewer's lamps read night/midnight as night and dawn/dusk/sunset/twilight as half-night; the rest follow `sun`. */
/** Weather kinds of the `world` op (R4-LIVE): 'auto' follows the live worlds' schedule; 'manual' shows the channels as set. */
export const WEATHER_KINDS = ['auto', 'manual', 'clear', 'cloudy', 'rain', 'wind', 'fog', 'storm'] as const;
export const SKY_PALETTES = ['clear-day', 'golden-hour', 'dawn', 'sunset', 'dusk', 'twilight', 'night', 'midnight', 'mars-desert', 'lm-garden'] as const;
const strikeSchema = z.object({ x: num, z: num, n: z.number().int().min(1), tick: z.number().int().min(0) });
export const worldStateSchema = z.object({
  sky: z.object({ palette: z.string().default('clear-day'), sun: num.min(0).max(1).default(0.6) }).prefault({}),
  time: z.object({ dayTicks: z.number().int().default(72000), startTick: z.number().int().default(0),
    /** R4-LIVE env setter: set the time of day to `hour` (0–24) once; `n` counts sets (the world clock applies each n once, moving forward). */
    set: z.object({ hour: num.min(0).max(24), n: z.number().int().min(1) }).nullable().optional(),
    /** The world clock stands still (the god paused time). */
    paused: z.boolean().default(false) }).prefault({}),
  /** `kind` 'auto' = the scheduled weather of the live worlds (a kind per 2 h slot, seeded by the day, as on /w/eden); any
   *  other kind shows these channels as set (`setEnv` writes them from kind × intensity). 'storm' adds lightning and thunder. */
  weather: z.object({ clouds: num.min(0).max(1).default(0.1), wind: num.min(0).max(1).default(0.1), rain: num.min(0).max(1).default(0),
    fog: num.min(0).max(1).default(0), kind: z.enum(WEATHER_KINDS).default('auto'), intensity: num.min(0).max(1).default(1),
    /** GOD-ENV: the god's last lightning strike (x, z at `tick`; `n` counts strikes). Viewers draw it, Souls see and hear it. */
    strike: strikeSchema.nullable().optional() }).prefault({}),
  constitution: z.string().max(20000).default(''),
  /** What the bare ground is made of (L3): the terrain colouring reads it. */
  ground: z.object({ palette: z.enum(['grass', 'desert', 'dust', 'sand', 'snow', 'rock', 'garden', 'playa']).default('grass') }).prefault({}),
  /** LAYERS: currency, wallets, relationships. Absent until a layers op (economy, mint, pay, relate) makes it. */
  layers: layersStateSchema.optional(),
});
export type WorldState = z.infer<typeof worldStateSchema>;
/** A `world` op's state is a patch: no defaults (they would reset what it does not name); compile merges it per key and per field. */
export const worldPatchSchema = z.object({
  sky: z.object({ palette: z.string(), sun: num.min(0).max(1) }).partial(),
  time: z.object({ dayTicks: z.number().int(), startTick: z.number().int(), set: z.object({ hour: num.min(0).max(24), n: z.number().int().min(1) }).nullable(), paused: z.boolean() }).partial(),
  weather: z.object({ clouds: num.min(0).max(1), wind: num.min(0).max(1), rain: num.min(0).max(1), fog: num.min(0).max(1), kind: z.enum(WEATHER_KINDS), intensity: num.min(0).max(1), strike: strikeSchema.nullable() }).partial(),
  constitution: z.string().max(20000),
  ground: z.object({ palette: worldStateSchema.shape.ground.unwrap().shape.palette.unwrap() }).partial(),
}).partial();

// ---------- edits ----------

const place = z.object({
  op: z.literal('place'), tmp: z.string().regex(/^\$[a-z0-9_-]{1,24}$/).optional(),
  def: z.string().regex(DEF_REF), name: z.string().regex(NAME).optional(),
  in: z.object({ parent: z.union([z.literal('world'), z.string()]), slot: z.string().optional() }).default({ parent: 'world' }),
  p: z.union([v2, v3]).optional(), r: z.union([num, v3]).optional(), s: num.positive().optional(),
  shape: entitySchema.shape.shape, anchor: entitySchema.shape.anchor,
  params: z.record(z.string(), value).optional(), state: z.record(z.string(), value).optional(), seed: z.number().int().optional(),
  constraints: constraintsSchema.optional(),
  owner: ownerRef.optional(), access: z.enum(ACCESS).optional(), schedule: scheduleSchema.optional(), price: priceSchema.optional(),
  mode: z.enum(['strict', 'nudge']).default('strict'),
});
const remove = z.object({ op: z.literal('remove'), id: z.string(), cascade: z.boolean().default(true) });
const move = z.object({
  op: z.literal('move'), id: z.string(),
  in: z.object({ parent: z.union([z.literal('world'), z.string()]), slot: z.string().optional() }).optional(),
  p: z.union([v2, v3]).optional(), r: z.union([num, v3]).optional(), s: num.positive().optional(), shape: entitySchema.shape.shape,
  constraints: constraintsSchema.optional(),
  mode: z.enum(['strict', 'nudge']).default('strict'),
});
const set = z.object({ op: z.literal('set'), id: z.string(), state: z.record(z.string(), value).optional(), params: z.record(z.string(), value).optional(), name: z.string().regex(NAME).optional(), constraints: constraintsSchema.optional(),
  /** LAYERS: null clears. */
  owner: ownerRef.nullable().optional(), access: z.enum(ACCESS).nullable().optional(), schedule: scheduleSchema.nullable().optional(), price: priceSchema.nullable().optional() });
/** LAYERS ops. economy: the world's currency name. mint: the god adds (or, negative, takes) money. pay: money moves
 *  between wallets (never below zero). relate: a relationship on (or off). Each inverts exactly. */
const economy = z.object({ op: z.literal('economy'), currency: z.string().min(1).max(24).nullable() });
const mint = z.object({ op: z.literal('mint'), to: ownerRef, amount: z.number().min(-1_000_000).max(1_000_000).refine((n) => n !== 0, 'amount must not be 0') });
const pay = z.object({ op: z.literal('pay'), from: ownerRef, to: ownerRef, amount: z.number().positive().max(1_000_000), for: z.string().max(120).optional() });
const relate = z.object({ op: z.literal('relate'), a: relRef, rel: z.enum(RELATIONS), b: relRef, on: z.boolean().default(true) });
/** Deep-copy a subtree with fresh ids. `count` copies stepping by `step` [dx, dz] from `p` (or from the source). */
const clone = z.object({
  op: z.literal('clone'), id: z.string(), tmp: z.string().regex(/^\$[a-z0-9_-]{1,24}$/).optional(), name: z.string().regex(NAME).optional(),
  in: z.object({ parent: z.union([z.literal('world'), z.string()]), slot: z.string().optional() }).optional(),
  p: z.union([v2, v3]).optional(), r: z.union([num, v3]).optional(),
  count: z.number().int().min(1).max(64).default(1), step: v2.optional(),
  mode: z.enum(['strict', 'nudge']).default('strict'),
});
const define = z.object({ op: z.literal('define'), def: defSchema });
const world = z.object({ op: z.literal('world'), state: worldPatchSchema });
/** Grow the world: `extent` = a centred square of that side (the original form); `bounds` = [x0, z0, x1, z1] metres, any
 *  direction (GOD-ENV: "extend the world east by 300 m"), each side ≤ 16 km. Grows only; its inverse (trusted) shrinks back. */
const expand = z.object({ op: z.literal('expand'), extent: num.positive().max(16000).optional(), bounds: z.tuple([num, num, num, num]).optional() });
const answer = z.object({ op: z.literal('answer'), prayer: z.string(), text: z.string().max(4000) });
/** Internal: restore a previously removed entity verbatim (inverse of remove). Never accepted from clients. */
const restore = z.object({ op: z.literal('restore'), entity: entitySchema });
/** Internal: restore the active revision of an already stored definition. */
const restoreDef = z.object({ op: z.literal('restore-def'), ref: z.string(), hash: z.string().regex(/^[0-9a-f]{64}$/),
  /** Only geometry fields changed by admission/preparation are restored; unrelated later state edits survive. */
  instances: z.array(z.object({ entity: entitySchema, fields: z.array(z.enum(['p', 'r', 'shape', 'params'])) })).optional(),
});

export const opSchema = z.discriminatedUnion('op', [place, remove, move, set, clone, define, world, expand, answer, restore, restoreDef, economy, mint, pay, relate]);
export type Op = z.infer<typeof opSchema>;
export const clientOpSchema = z.discriminatedUnion('op', [place, remove, move, set, clone, define, world, expand, answer, economy, mint, pay, relate]);

export const batchSchema = z.object({
  schema: z.literal(EDIT_SCHEMA).default(EDIT_SCHEMA),
  ops: z.array(clientOpSchema).min(1).max(256),
  clientRef: z.string().max(100).optional(),
  note: z.string().max(400).optional(),
  /** A named edit group ("duck family"): reviewable and undoable as a whole. */
  group: z.string().max(60).optional(),
});
export type Batch = z.infer<typeof batchSchema>;
/** Server-internal: stored inverses may restore content or be empty (an accepted no-op revert). */
export const trustedBatchSchema = batchSchema.extend({ ops: z.array(opSchema).max(256) });

export type Failure = {
  op: number; code: string; detail: string;
  /** Repair context, additive so existing clients can continue to use code/detail. */
  field?: string; fix?: string; measured?: unknown; limit?: unknown; def?: string; entity?: string;
  suggest?: { p?: [number, number] | [number, number, number]; r?: number };
};
export type Accepted = { accepted: true; seq: number; undoId: string; ids: Record<string, string>; warnings: string[]; replayed?: true };
export type Refused = { accepted: false; failures: Failure[] };
export type Result = Accepted | Refused;

export const refusalCodes = [
  'schema', 'def.unknown', 'def.budget', 'def.expansion', 'def.invalid',
  'parent.unknown', 'slot.unknown', 'slot.incompatible', 'slot.full', 'slot.outside',
  'size.range', 'extent.outside', 'overlap.solid', 'support.none', 'held.by-body', 'occupied.by-body',
  'constant.immutable', 'float.no-water', 'constraint.unsatisfied', 'architecture.unreachable', 'architecture.headroom', 'entity.unknown', 'entity.limit', 'name.taken', 'params.invalid', 'state.invalid', 'undo.conflict',
  'wallet.insufficient', 'relation.invalid',
  'request.conflict', 'request.budget', 'revision.stale', 'asset.invalid', 'asset.budget',
] as const;
export type RefusalCode = (typeof refusalCodes)[number];
