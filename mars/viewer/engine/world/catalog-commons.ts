// Core physical definitions for World's corrected dry commons9b6db72.
// Base-centred, metres, native yaw (renderer rotation.y=-yaw). No carry
// capability: these are installed fixtures, not transportable constructions.
import type { AssetDef } from './catalog.ts';

const dims = { confidence: 'hypothetical' as const, note: 'Eden authored commons/1; World9b6db72 dimensions, conservative bench/table walking boxes' };
export const COMMONS_ASSETS: AssetDef[] = [
  { id: 'rowing-punt', label: 'Rowing punt for two', category: 'fixture', size: [3.4, .55, 1.35], massKg: 0, obstacle: true,
    capabilities: { carrier: { door: [2.6, 0], floorY: .12, transferSpeed: .6, landingClear: 1.7, seats: [
      { id: 'rider-a', local: [-.65, 0], yaw: Math.PI, exit: [3.1, -.85] },
      { id: 'rider-b', local: [.65, 0], yaw: Math.PI, exit: [3.1, .85] }] } },
    dims: { confidence: 'hypothetical', note: 'todo punt/1: flat-bottomed 3.4 m punt, two rowing thwarts and a dry-bank boarding plank' } },
  { id: 'eden-commons-bench', label: 'Commons bench (3 seats)', category: 'fixture',
    size: [2, .9, .65], massKg: 25, obstacle: true,
    slots: [-.65, 0, .65].map((x, i) => ({ id: `seat${i}`, kind: 'seat' as const, local: [x, 0] as [number, number], yaw: Math.PI / 2 })), dims },
  { id: 'eden-commons-table', label: 'Commons table', category: 'fixture',
    size: [1.4, .75, .8], massKg: 18, obstacle: true,
    surfaceSlots: [-.4, 0, .4].flatMap((x, c) => [-.2, .2].map((z, r) => ({ id: `r${r}c${c}`, local: [x, .75, z] as [number, number, number] }))), dims },
  // Multi-part static colliders/support live in the pinned scene; a whole
  // pavilion box would close the aisle. These identity entities add no box.
  { id: 'eden-commons-pavilion', label: 'Commons pavilion', category: 'fixture', size: [6, 2.9, 4], massKg: 0, dims },
  // carrier/1 (vehicles/carrier.ts): a hot-air balloon basket (World eden-rides/1, worlds/eden/rides/balloon-ride.v1.json). The box is
  // the basket (1.5 long x 1.1 high x 1.2 wide; local +x forward), a static walking obstacle while parked; the envelope is depiction
  // only. Two standing places at the rim, a two-step mounting block behind (local -x); riders leave by the block to their own exit spot.
  { id: 'hot-air-balloon', label: 'Hot-air balloon', category: 'fixture', size: [1.5, 1.1, 1.2], massKg: 0, obstacle: true,
    capabilities: { carrier: { door: [-1.25, 0], floorY: 0, transferSpeed: 0.6, landingClear: 1.7, seats: [
      { id: 'rider-a', local: [0.12, -0.3], yaw: 0.35, exit: [-2.0, -0.9] },
      { id: 'rider-b', local: [0.12, 0.3], yaw: -0.35, exit: [-2.0, 0.9] }] } },
    dims: { confidence: 'hypothetical', note: 'World eden-rides/1 (WN9): basket 1.5 x 1.2 x 1.1 m, mount at -1.25 m' } },
  { id: 'eden-commons-platform', label: 'Commons presentation platform', category: 'fixture', size: [3, .24, 2], massKg: 0, dims },
];
