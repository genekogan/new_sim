// MARSLAND: the land around Mars 2026, as god ops in the world frame (frame.mjs: north −z, east +x, metres; the Mimos
// origin 30 m north of the world's 0, 0). Positions come from the 2026 drone (team/lanes/marsland-frames: rectified DJI_0033 / DJI_0012 ground
// maps, video telemetry) and Google Maps (team/lanes/mars-land-refs). The campus spans about x −65…112, z −139…34.
//
// Near (walkable, inside the 1200 m world): the playa ground, the tyre ring of the old race track just west of camp,
// tyre tracks around it, sparse creosote scrub (bare around camp, thicker toward the south and east).
// Far (beyond the edge, non-walkable): the 111, the wash, the levee band, salt flats, the Salton Sea, the mountains —
// see FAR_OPS (core/far-land, core/panorama).
import { MARS_FAR_LAND, MARS_PANORAMA } from '../../e2e/marsland-far-data.mjs';

const CAMP = [24, -53];
const CHIBA = [-11.1, -30.2];                    // the far data's origin (lane MARSLAND-FAR: campus frame centred on Chiba)                          // middle of the campus
export const TIRE_RING = { p: [-170, -104], rx: 52, rz: 104, r: -0.087 };   // its north end leans a little east (satellite)

export const NEAR_OPS = [
  { op: 'place', def: 'core/tire-ring@1', name: 'tire-ring', p: TIRE_RING.p, r: TIRE_RING.r, params: { rx: TIRE_RING.rx, rz: TIRE_RING.rz } },
  { op: 'place', def: 'core/tire-tracks@1', name: 'race-track-tracks', shape: { area: [[-250, -230], [-80, -230], [-80, 20], [-250, 20]] }, params: { count: 70 } },
  { op: 'place', def: 'core/tire-tracks@1', name: 'camp-tracks', shape: { area: [[-80, -180], [160, -180], [160, 80], [-80, 80]] }, params: { count: 40 } },
  { op: 'place', def: 'core/desert-scrub@1', name: 'creosote-scrub', shape: { area: [[-600, -600], [600, -600], [600, 600], [-600, 600]] }, params: { density: 0.0008, toward: 'se', gradient: 0.6, clear: [[CAMP[0], CAMP[1], 120], [TIRE_RING.p[0], TIRE_RING.p[1], 45]] } },
  { op: 'place', def: 'core/desert-scrub@1', name: 'scrub-toward-the-wash', shape: { area: [[300, -600], [600, -600], [600, 600], [300, 600]] }, params: { density: 0.002, toward: 'e' } },
];
// Beyond the walkable edge (lane MARSLAND-FAR): the 111 with its poles, the wash and its delta, the levee band, the salt
// flats and beach, the Salton Sea; the mountain ranges as a camera-following panorama. Unnamed: they are not places.
export const FAR_OPS = [
  { op: 'place', def: 'core/far-land@1', p: CHIBA, params: MARS_FAR_LAND },
  { op: 'place', def: 'core/panorama@1', p: CHIBA, params: MARS_PANORAMA },
];
