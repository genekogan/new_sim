import type { AssetDef } from '../../engine/world/catalog.ts';

// Median sRGB of the green upright at x=727..742, y=740..890 in
// docs/engineering/evidence/2026-09-28-skeleton-stage-racks-2x4-frame-before-plywood.jpg.
export const RACK_FRAME_GREEN = '#2c4629';

/** Renderer-only correction; the engine catalog and its pins retain their source colours. */
export function rendererColor(d: AssetDef, fallback: string): string {
  return d.category === 'rack-upright' ? RACK_FRAME_GREEN : d.color ?? fallback;
}
