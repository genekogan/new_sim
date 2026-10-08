/** Where Eden's animals live (world metres, x/z rects [x0, z0, x1, z1]; places.v1.json ids in the notes). A herd wanders
 * only inside its zone and never into an AVOID rect (buildings, water, crop fields, the commons stage), so straight walks
 * between seeded points stay on open ground. Counts are kept small: one draw per animal within 140 m of the camera. */
export type Rect = readonly [number, number, number, number];
export type Herd = {
  id: string; model: string; count: number; zone: readonly Rect[];
  /** m/s while walking; seconds per walk + pause cycle. */
  speed: number; period: number;
  clips: { idle?: string; walk?: string; eat?: string };
  /** Walk clip rate (cycles match the ground speed); model scale. */
  clipRate?: number; scale?: number;
  /** Grazers: metres they roam around the herd's slowly moving home spot (unset: anywhere in the zone). */
  roam?: number;
};
export type Flock = { id: string; model: string; count: number; centre: [number, number]; radius: number; height: number; speed: number; clip?: string; scale?: number;
  /** Swimmers: absolute height (just under a pond's surface) instead of a height above the ground; no banking. */
  y?: number };

/** Buildings, water and beds animals keep out of (the herd zones already avoid most of them). */
export const AVOID: readonly Rect[] = [
  [-102, 94, -82, 112], [-80, 94, -62, 112], [-60, 94, -46, 110], [-102, 116, -84, 134], // farm crop fields (south.ts)
  [-77, 119, -63, 129],   // red barn
  [-59, 122, -49, 132],   // farmhouse
  [-84, 126, -73, 130],   // silos
  [-97, 101, -91, 107],   // windmill
  [-96, -11, -66, 6],     // the pond (water y -2) and its channel
  [-20, 103, 8, 122],     // park pond
  [-31, 106, -24, 114],   // park gazebo
  [9, 96, 29, 122],       // volleyball / petanque / gym
  [28, 40, 78, 75],       // eden-gardens beds and greenhouse
  [82, 47, 94, 55],       // barn
  [133, -36, 140, 56],    // the canal
  [-176, 90, -144, 108], [-172, 108, -152, 126], [-144, 52, -104, 88], // abbey church, hall, courtyards
];

export const HERDS: readonly Herd[] = [
  // the abbey meadow west of the farm hamlet (open grass between the abbey path and the farm fence) and the farm paddock
  { id: 'cows', roam: 7, model: 'cow', count: 5, zone: [[-145, 100, -108, 135]], speed: 0.6, period: 70, clips: { idle: 'Idle', walk: 'Walk' } },
  { id: 'horses', roam: 9, model: 'horse', count: 3, zone: [[-145, 100, -108, 135]], speed: 0.9, period: 60, clips: { idle: 'Idle', walk: 'Walk' } },
  { id: 'pigs', roam: 4, model: 'pig', count: 3, zone: [[-63, 113.5, -48, 121]], speed: 0.45, period: 40, clips: { idle: 'Idle', walk: 'Walk' } },
  { id: 'llamas', roam: 4, model: 'llama', count: 2, zone: [[-63, 113.5, -48, 121], [-50.5, 119, -47, 133]], speed: 0.6, period: 55, clips: { idle: 'Idle', walk: 'Walk' } },
  // sheep on the northern meadow (north of the botanic garden fence, west of the lane)
  { id: 'sheep', roam: 6, model: 'sheep', count: 8, zone: [[-105, -225, -45, -178]], speed: 0.5, period: 45, clips: { idle: 'Idle', walk: 'Walk' } },
  // dogs and cats about town and the gardens
  { id: 'dogs-commons', model: 'dog', count: 2, zone: [[-28, -28, 28, 28]], speed: 1.1, period: 30, clips: { idle: 'Idle', walk: 'Walk' } },
  { id: 'dogs-park', model: 'dog', count: 2, zone: [[-42, 95, 32, 134]], speed: 1.2, period: 28, clips: { idle: 'Idle', walk: 'Walk' } },
  { id: 'pug-gardens', model: 'pug', count: 1, zone: [[24, 34, 82, 39], [24, 34, 27, 78], [79, 34, 82, 78]], speed: 0.9, period: 30, clips: { idle: 'Idle', walk: 'Walk' } },
  { id: 'cats-gardens', model: 'cat', count: 2, zone: [[24, 34, 82, 39], [24, 34, 27, 78], [24, 75, 82, 78]], speed: 0.7, period: 40, clips: { idle: 'Idle', walk: 'Walk' } },
  { id: 'cats-canal', model: 'cat', count: 2, zone: [[126, -33, 132, 57], [141, -33, 147, 57]], speed: 0.7, period: 40, clips: { idle: 'Idle', walk: 'Walk' } },
  { id: 'dog-oldtown', model: 'dog', count: 1, zone: [[112, 91, 170, 100]], speed: 1.1, period: 30, clips: { idle: 'Idle', walk: 'Walk' } },
  // woodland edges (foxes stand in for deer until the Ultimate Animated Animal pack can be fetched)
  { id: 'foxes-woods', model: 'fox', count: 2, zone: [[-20, -64, 30, -32]], speed: 0.9, period: 35, clips: { walk: 'Walk' } },
  { id: 'foxes-meadow', model: 'fox', count: 1, zone: [[-110, -238, -60, -228]], speed: 0.9, period: 35, clips: { walk: 'Walk' } },
];

export const FLOCKS: readonly Flock[] = [
  { id: 'birds-meadow', model: 'bird', count: 5, centre: [-40, 60], radius: 22, height: 16, speed: 7, clip: 'Fly' },
  { id: 'birds-park', model: 'bird', count: 4, centre: [-6, 112], radius: 16, height: 13, speed: 6, clip: 'Fly' },
  { id: 'birds-farm', model: 'bird', count: 4, centre: [-110, 115], radius: 20, height: 18, speed: 7, clip: 'Fly' },
  { id: 'gulls-harbour', model: 'bird', count: 5, centre: [40, 160], radius: 26, height: 20, speed: 8, clip: 'Fly' },
  // koi just under the surface of the park pond (−0.45) and the pond by the lake dock (−2.0)
  { id: 'koi-park', model: 'koi', count: 6, centre: [-6, 112.5], radius: 4.5, height: 0, y: -0.62, speed: 0.45, clip: 'Swim' },
  { id: 'koi-pond', model: 'koi', count: 5, centre: [-82, -2], radius: 4, height: 0, y: -2.17, speed: 0.4, clip: 'Swim' },
];
