// L3's public surface (terrain, paths, water, ecology): prepare-steps the skill and the compiler
// call, and the shared centre-line/pattern helpers the mesh halves use. Owner: L3.
export { queryOf, smoothPath, arcLengths, frames, offsetAlong, band, subPath, valueAt, pathSig, distToWater, hyp, type TerrainQuery, type AbsSurface, type AbsOBB } from './terrain-query.ts';
export { prepareRoad, centreLine, gradeOf, deckAt, steepest, type Grade, type Span } from './road.ts';
export { snapRiver, riverLine, flowOf, offsetRing, distToRiver, type Flow, type Fall } from './river.ts';
export { prepareBridge, prepareDeck, atOf, bridgeSpan, deckRaised, railGaps, DECK_RAISED, type At } from './bridge.ts';
export { scatter2Points, paletteOf, SPECIES, DEFAULT_PALETTE, type PaletteEntry, type ScatterPoint, type Species } from './scatter2.ts';
export { areaFrame, orchardPoints, SPORTS } from './areas.ts';
export { gatesOf } from './paths.ts';
export { prepareFor } from './prepare.ts';
