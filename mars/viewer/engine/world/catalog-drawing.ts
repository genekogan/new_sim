import type { AssetDef } from './catalog.ts';
const dims = {
  confidence: 'hypothetical' as const,
  note: 'Generic drawing practice equipment; no historical Mars artifact or placement claim',
};
export const DRAWING_ASSETS: AssetDef[] = [
  {
    id: 'drawing-pad',
    label: 'hypothetical sketch pad',
    category: 'item',
    size: [0.24, 0.012, 0.18],
    massKg: 0.25,
    color: '#f6efd9',
    dims,
    handling: {
      carryCrew: [1, 1],
      carryPose: 'flat',
      carryHeight: 0.95,
      hands: 1,
      small: true,
      grips: { 1: [{ id: 'hand', local: [0, 0.006, 0] }] },
    },
  },
  {
    id: 'drawing-pencil',
    label: 'hypothetical drawing pencil',
    category: 'item',
    size: [0.014, 0.11, 0.014],
    massKg: 0.02,
    color: '#d5a335',
    dims,
    handling: {
      carryCrew: [1, 1],
      carryPose: 'flat',
      carryHeight: 0.95,
      hands: 1,
      small: true,
      grips: { 1: [{ id: 'hand', local: [0, 0.08, 0] }] },
    },
  },
];
