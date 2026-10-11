// /v1/god/schema: everything a god agent needs to know about the vocabulary, generated from
// the code so it never drifts (spec 33 §2 row 1, §3.4). Owner: L1.
import { z } from 'zod';
import { describeGenerators, KIT_PRIMITIVES, KIT_ROLES, kitArgs, materialEnum, slotKind } from '@sim/generators';
import { clientOpSchema, componentsSchema, constraintSchema, defSchema, refusalCodes } from '@sim/world-compiler';

let cached: unknown = null;
export function godSchema() {
  if (cached) return cached;
  const js = (s: z.ZodType) => { try { return z.toJSONSchema(s, { unrepresentable: 'any', io: 'input' }); } catch (e) { return { error: String(e) }; } };
  cached = {
    contract: 'god-schema/1',
    conventions: {
      units: 'metres, radians; +x east, +z south, +y up; origin at the world centre',
      yaw: 'rotation about +y; a thing\'s front faces +z at yaw 0 (buildings: the `front` side); facing a point (dx, dz) is yaw = atan2(dx, dz)',
      position: 'p: [x, z] rests on whatever is below (ground, floor, water for anchor float); [x, y, z] keeps y (local to the parent frame)',
      forms: 'point defs take p; path defs take shape.path (+ width); area defs take shape.area',
      addressing: 'ids (e_…), paths of names (cottage/kitchen/chair-1), flag:<name>; in a batch, tmp ids ($c) refer to things placed earlier in it',
      layers: 'solid collides with solid and bodies; surface drapes (roads, lawns); volume is inside-able (water); decor never collides',
      rooms: 'buildings expose each room as a slot of kind room: in: {parent: house, slot: "kitchen"}, p local to the room origin',
      library: 'search the library first (GET /v1/god/defs?q=duck); define only what is missing; prefer params and presets over new kinds',
    },
    ops: js(clientOpSchema),
    def: js(defSchema),
    components: Object.keys((componentsSchema as unknown as { shape: Record<string, unknown> }).shape),
    constraints: js(constraintSchema),
    slotKinds: slotKind.options,
    materials: materialEnum.options,
    kit: { primitives: KIT_PRIMITIVES, roles: KIT_ROLES, args: js(kitArgs) },
    generators: describeGenerators(),
    refusals: refusalCodes,
    endpoints: {
      read: ['GET /assets/<sha>.<ext>', 'GET /v1/god/assets/<sha>', 'GET /v1/god/defs/<ref>/thumb.png', 'GET /v1/world/snapshot', 'GET /v1/world/ground', 'GET /v1/world/tiles/:tx/:tz', 'GET /v1/world/entities/:path', 'GET /v1/god/schema', 'POST /v1/god/query'],
      god: ['GET /v1/god/snapshot', 'GET /v1/god/defs?q=&tag=', 'GET /v1/god/defs/<ref>', 'POST /v1/god/assets (multipart: file, footprint?, name, height?, tags?, license?, source?, define?)', 'GET /v1/god/assets[?core=1]', 'POST /v1/god/dryrun', 'POST /v1/god/preview', 'POST /v1/god/act', 'POST /v1/god/undo[?group=]', 'POST /v1/god/redo', 'GET /v1/god/edits', 'GET /v1/god/stream (SSE)', 'GET /v1/god/prayers', 'POST /v1/god/answer'],
    },
  };
  return cached;
}
