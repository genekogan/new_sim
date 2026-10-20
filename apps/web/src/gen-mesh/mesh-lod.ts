// Z2 (2026-10-20): a core mesh def may carry a distant version (`make.lod1`, worlds/core-assets/lods.index.json). The
// original GLB (`make.asset`) stays the near model; lod1 is drawn only past the switch distance. One rule for the
// eager arrival plan (lazy-assets.ts) and the renderer (mesh.mesh.ts). Distance is horizontal world metres.
export type LodMake = { asset: string; lod1?: string };

/** Switch distance: 4x the def's largest side and at least 40 m, times the entity's scale when it is enlarged. */
export function meshLodDistance(box: readonly number[], scale = 1): number {
  return Math.max(40, Math.max(...box) * 4) * Math.max(1, Math.abs(scale) || 1);
}

/** The GLB to draw at `distance`. `current` adds hysteresis (10%) so a camera at the boundary does not flip models. */
export function meshLodAsset(make: LodMake, box: readonly number[], distance: number, scale = 1, current?: string): string {
  if (!make.lod1) return make.asset;
  const d = meshLodDistance(box, scale);
  if (current === make.lod1) return distance > d ? make.lod1 : make.asset;
  return distance > d * 1.1 ? make.lod1 : make.asset;
}
