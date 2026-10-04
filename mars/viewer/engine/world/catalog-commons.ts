// Core physical definitions for World's corrected dry commons9b6db72.
// Base-centred, metres, native yaw (renderer rotation.y=-yaw). No carry
// capability: these are installed fixtures, not transportable constructions.
import type { AssetDef } from './catalog.ts';

const dims = { confidence: 'hypothetical' as const, note: 'Eden authored commons/1; World9b6db72 dimensions, conservative bench/table walking boxes' };
export const COMMONS_ASSETS: AssetDef[] = [
  { id: 'eden-commons-bench', label: 'Commons bench (3 seats)', category: 'fixture',
    size: [2, .9, .65], massKg: 25, obstacle: true,
    slots: [-.65, 0, .65].map((x, i) => ({ id: `seat${i}`, kind: 'seat' as const, local: [x, 0] as [number, number], yaw: Math.PI / 2 })), dims },
  { id: 'eden-commons-table', label: 'Commons table', category: 'fixture',
    size: [1.4, .75, .8], massKg: 18, obstacle: true,
    surfaceSlots: [-.4, 0, .4].flatMap((x, c) => [-.2, .2].map((z, r) => ({ id: `r${r}c${c}`, local: [x, .75, z] as [number, number, number] }))), dims },
  // Multi-part static colliders/support live in the pinned scene; a whole
  // pavilion box would close the aisle. These identity entities add no box.
  { id: 'eden-commons-pavilion', label: 'Commons pavilion', category: 'fixture', size: [6, 2.9, 4], massKg: 0, dims },
  { id: 'eden-commons-platform', label: 'Commons presentation platform', category: 'fixture', size: [3, .24, 2], massKg: 0, dims },
];
