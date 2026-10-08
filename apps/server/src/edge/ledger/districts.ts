// CN5: the districts made walkable (Gene 2026-10-07: harbour, artists' village, observatory hill, old-town plaza and market
// street). Level-0 nav/1 ground on World's flat district pads (eden-regions *Pads at y 0), joined to the existing ground,
// plus the places admitted as native destinations. The descriptor carries these (nav.ground, nativePlaces); this module is
// the reviewed source of those values and of the tests. Observatory hill is NOT here: its plateau stands about 11.5 m above
// level ground (botanic.ts pad over the vineyard terraces) and level-0 ground is flat at y 0, so walks there are refused
// honestly (place.unreachable) until raised ground exists.
import type {GroundRect} from './nav.ts';

export const CN5_DISTRICT_GROUND: GroundRect[] = [
  // harbour: the y-0 promenade strip (kiosks, fish market) from the park's south edge east past the sports ground
  {id: 'harbour-strip', boundsXZ: [-29.5, 126, 106, 137]},
  // the timber boardwalk (World draws its deck at y 0.55; walking is level 0) and the two piers
  {id: 'harbour-boardwalk', boundsXZ: [-40, 136.4, 100, 141.3]},
  {id: 'harbour-west-pier', boundsXZ: [8.4, 141.3, 11.6, 167.5]},
  {id: 'harbour-east-pier', boundsXZ: [60.4, 141.3, 63.6, 175.5]},
  // the beach west of the shore gate (dry sand above the waterline, within 0.13 m of y 0)
  {id: 'harbour-beach', boundsXZ: [-100, 134, -29.5, 139]},
  // the north avenue from the woods west to the artists' village, and the village itself
  {id: 'north-avenue-west', boundsXZ: [-104, -74, 30, -64]},
  {id: 'artists-village', boundsXZ: [-104, -128, -46, -72]},
  // the old town: plaza, arcades and market street, joined to the east ground at x 104..105
  {id: 'old-town', boundsXZ: [104, 57.8, 172, 112]},
  // the performance stage's deck and back reach north of the east ground (which ends at z -30)
  {id: 'performance-stage', boundsXZ: [84, -34, 100, -29.5]},
];

/** Places admitted as native walk destinations with that ground (descriptor nativePlaces). */
export const CN5_DISTRICT_PLACES = [
  'region-harbour', 'region-harbour.boardwalk', 'region-harbour.west-pier', 'region-harbour.east-pier', 'region-harbour.beach',
  'region-artists-village', 'region-artists-village.green',
  'region-old-town', 'region-old-town.plaza', 'region-old-town.market-street', 'region-old-town.north-arcade', 'region-old-town.south-arcade',
  'eden-performance-stage',
];
