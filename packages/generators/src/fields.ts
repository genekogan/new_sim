// Shared value/field/slot vocabulary (contract for every generator and def).
// Owner: L1. Spec <eden4>/33 §4, 29 §4.
import { z } from 'zod';
import { CREATION_LIMITS } from './creation-limits.ts';

export const num = z.number().finite();
export const v2 = z.tuple([num, num]);
export const v3 = z.tuple([num, num, num]);

/** Field ids are short identifiers; camelCase allowed. */
export const ID = /^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/;
export const NAME = /^[a-z0-9][a-z0-9._-]{0,47}$/;

const JSON_MAX = CREATION_LIMITS.fieldJSONBytes;
/** Any JSON value up to 8 KB serialised (plans, shape lists, palettes). */
export const jsonValue = z.json().refine((v) => new TextEncoder().encode(JSON.stringify(v)).byteLength <= JSON_MAX, `json value over ${JSON_MAX} bytes`);
/** A parameter or state value: primitives, small arrays, or JSON objects. */
export const value = z.union([z.string().max(2000), num, z.boolean(), z.null(), jsonValue]);
export type Value = z.infer<typeof value>;

export const materialEnum = z.enum([
  'wood', 'stone', 'plaster', 'brick', 'glass', 'metal', 'fabric', 'thatch', 'tile', 'ceramic',
  'grass', 'water', 'sand', 'gravel', 'asphalt', 'cobble', 'dirt', 'rock', 'moss', 'mud', 'snow',
  'leaf', 'bark', 'fur', 'feather', 'paint', 'plastic', 'paper', 'rubber', 'emissive',
]);
export type Material = z.infer<typeof materialEnum>;
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** Typed, ranged parameter / state field. `vis` restricts who may read a state field (default public). */
export const fieldSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('number'), min: num.optional(), max: num.optional(), default: num.optional(), doc: z.string().max(200).optional(), vis: z.array(z.string()).optional() }),
  z.object({ type: z.literal('int'), min: z.number().int().optional(), max: z.number().int().optional(), default: z.number().int().optional(), doc: z.string().max(200).optional(), vis: z.array(z.string()).optional() }),
  z.object({ type: z.literal('bool'), default: z.boolean().optional(), doc: z.string().max(200).optional(), vis: z.array(z.string()).optional() }),
  z.object({ type: z.literal('string'), max: z.number().int().max(2000).default(200), default: z.string().optional(), doc: z.string().max(200).optional(), vis: z.array(z.string()).optional() }),
  z.object({ type: z.literal('enum'), values: z.array(z.string()).min(1).max(64), default: z.string().optional(), doc: z.string().max(200).optional(), vis: z.array(z.string()).optional() }),
  z.object({ type: z.literal('color'), default: color.optional(), doc: z.string().max(200).optional(), vis: z.array(z.string()).optional() }),
  z.object({ type: z.literal('ref'), default: z.string().optional(), doc: z.string().max(200).optional(), vis: z.array(z.string()).optional() }),
  z.object({ type: z.literal('json'), maxBytes: z.number().int().max(JSON_MAX).default(JSON_MAX), default: jsonValue.optional(), doc: z.string().max(400).optional(), vis: z.array(z.string()).optional() }),
]);
export type Field = z.infer<typeof fieldSchema>;
export type FieldInput = z.input<typeof fieldSchema>;
export const fieldsSchema = z.record(z.string().regex(ID), fieldSchema).refine((r) => Object.keys(r).length <= 48, 'at most 48 fields');

export const slotKind = z.enum(['seat', 'bed', 'surface', 'stand', 'door', 'hang', 'carry', 'socket', 'room', 'floor', 'roof', 'wall', 'post', 'perch', 'shelf']);
export type SlotKind = z.infer<typeof slotKind>;
export const slotSchema = z.object({
  id: z.string().regex(NAME),
  kind: slotKind,
  /** Local frame: position and yaw in the def's frame (metres, radians). */
  p: v3, yaw: num.default(0),
  /** Room slots: which floor, and the room polygon in the room's own frame (for `inside` checks and furnishing). */
  floor: z.number().int().optional(),
  polygon: z.array(v2).max(64).optional(),
  /** Seat / surface height above the slot's floor (body solver, Stage B). */
  height: num.optional(),
  accepts: z.object({ kinds: z.array(z.string()).optional(), tags: z.array(z.string()).optional(), maxSize: v3.optional(), maxMass: num.optional() }).default({}),
  capacity: z.number().int().min(1).max(4096).default(1),
  label: z.string().max(80).optional(),
});
export type Slot = z.infer<typeof slotSchema>;
export type SlotInput = z.input<typeof slotSchema>;
