import type { AssetDef } from './catalog.ts';
export const GARDEN_PLANTER_ASSET: AssetDef = { id: 'garden-planter', label: 'hypothetical raised garden planter', category: 'fixture', size: [0.6, 0.8, 0.6], massKg: 15, color: '#865337', obstacle: true,
  surfaceSlots: [{ id: 'care', local: [0, 0.8, 0] }], dims: { confidence: 'hypothetical', note: 'Bounded raised ground planter; care target at soil height, not a historical Mars fixture' } };
export const GARDEN_ASSETS = [GARDEN_PLANTER_ASSET];
