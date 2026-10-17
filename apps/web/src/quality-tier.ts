// Lane phones (V4): one quality tier per page, picked automatically. A phone (touch-first, short side ≤ 820 CSS px)
// gets the `phone` tier; everything else stays `full`, exactly as before. `?quality=phone|full` overrides for tests and
// for anyone who wants to compare. The tier only changes how the view is drawn (pixel ratio, shadow map, distance
// detail, far stand-ins), never what the world is.
export type QualityTier = 'phone' | 'full';
export type QualitySettings = {
  tier: QualityTier;
  /** Why this tier was chosen (shown in the probe and diagnostics). */
  reason: string;
  /** Upper bound for the drawing-buffer pixels per CSS pixel. */
  maxPixelRatio: number;
  /** Sun shadow map edge in texels. */
  shadowMapSize: number;
  /** Render-time distance detail; null leaves every mesh drawn as before. */
  detail: DistanceDetailOptions | null;
};
export type DistanceDetailOptions = {
  /** Meshes whose bounding sphere projects smaller than this many CSS pixels (radius) are not drawn. */
  minRadiusPx: number;
  /** Shadow casters stop casting beyond near + perMetre·radius metres (as WorldShadowDetail does for the Eden expansion). */
  shadowNear: number; shadowPerMetre: number; shadowMaxRadius: number;
  /** Bodies (Souls, kin) further than this many metres stop casting shadows (Infinity: never). */
  standInDistance: number;
  /** Rescan the scene for candidates every n frames. */
  rescanFrames: number;
};
export const PHONE_DETAIL: DistanceDetailOptions = Object.freeze({ minRadiusPx: 1.25, shadowNear: 24, shadowPerMetre: 14, shadowMaxRadius: 6, standInDistance: 38, rescanFrames: 90 });
/** Release 3.1: desktops get only the invisible part of distance detail — meshes under half a CSS pixel of radius are
 *  not drawn, small casters far away stop casting — and mesh LOD at half a pixel of error. No flat cards, same pixel
 *  ratio and shadow map. `?desktopDetail=0` turns it off. */
export const DESKTOP_DETAIL: DistanceDetailOptions = Object.freeze({ minRadiusPx: 0.5, shadowNear: 60, shadowPerMetre: 30, shadowMaxRadius: 6, standInDistance: Infinity, rescanFrames: 90 });

export type QualityEnvironment = { search: string; coarsePointer: boolean; screen: readonly [number, number]; deviceMemory?: number };
export function pickQualityTier(env: QualityEnvironment): QualitySettings {
  const forced = new URLSearchParams(env.search).get('quality');
  const shortSide = Math.min(env.screen[0], env.screen[1]);
  const [tier, reason]: [QualityTier, string] = forced === 'phone' || forced === 'full' ? [forced, `?quality=${forced}`]
    : env.coarsePointer && shortSide > 0 && shortSide <= 820 ? ['phone', `touch screen, short side ${shortSide}px`]
    : env.coarsePointer && env.deviceMemory !== undefined && env.deviceMemory <= 2 ? ['phone', `touch device with ${env.deviceMemory} GB`]
    : ['full', 'desktop or large screen'];
  return tier === 'phone'
    ? { tier, reason, maxPixelRatio: 1.5, shadowMapSize: 1024, detail: PHONE_DETAIL }
    : { tier, reason, maxPixelRatio: 2, shadowMapSize: 2048, detail: new URLSearchParams(env.search).get('desktopDetail') === '0' ? null : DESKTOP_DETAIL };
}

/** The page's tier (browser only). */
export function browserQuality(): QualitySettings {
  if (typeof window === 'undefined') return pickQualityTier({ search: '', coarsePointer: false, screen: [0, 0] });
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return pickQualityTier({ search: location.search, coarsePointer: coarse, screen: [screen.width, screen.height], deviceMemory: (navigator as { deviceMemory?: number }).deviceMemory });
}
