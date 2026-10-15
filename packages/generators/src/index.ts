export * from './fields.ts';
export * from './types.ts';
export * from './geom.ts';
export { CREATION_LIMITS } from './creation-limits.ts';
export { reachableFromOutside } from './reachability.ts';
export { scatterPoints } from './basic.ts';
export { kitArgs, kitPhysics, kitWhen, KIT_PRIMITIVES, KIT_ROLES, type KitArgs, type KitShape } from './kit.ts';
export { assertFootprint, footprintToBaked, kitFootprintIssues, mergeKitSlots, type LmFootprint } from './kit-footprint.ts';
export { BUILDING_STYLES, buildingParams, buildingPhysics } from './building.ts';
export { ANIMAL_SPECIES, BEHAVIORS, creatureAbilities } from './animals.ts';
export { GENERATORS, registerGenerator, generator, describeGenerators } from './registry.ts';
export * from './terrain.ts';
// lane MARSLAND-NEAR: desert near-field (tyres, scrub, tracks, playa noise)
export { tireLine, tireRingPath, ellipsePath, scrubPoints, trackLines, playaVein, playaPatch, fbm, vnoise, SCRUB_KINDS, DESERT_GENERATORS, type TirePose, type ScrubPoint } from './desert.ts';
