import * as THREE from 'three';
/** Sky palettes that change the look of a god world's sky (lane MARSLAND-FAR). `state.sky.palette` names one; a palette
 * without an entry here keeps the default Daylight sky. By day (faded by clouds and fog) the sky dome's zenith and
 * horizon move to the palette's colours, the air's haze toward its horizon, and the clear-air fog density is scaled
 * (weather fog and rain are untouched). Published to the atmosphere by GodWorldLiving (world-env.ts) as
 * `userData.edenSkyPalette` on its group, read by the atmosphere's scene scan. */
export type SkyLook = { zenith: THREE.Color; horizon: THREE.Color; fog: number };
const look = (zenith: string, horizon: string, fog: number): SkyLook => ({ zenith: new THREE.Color(zenith), horizon: new THREE.Color(horizon), fog });
export const SKY_LOOKS: Record<string, SkyLook> = {
  // Mars College, Salton basin (2026 drone frames): deep blue overhead, pale near the horizon, clear dry air
  'mars-desert': look('#0466aa', '#79b6da', 0.2),
};
export const skyLook = (palette: unknown): SkyLook | null => (typeof palette === 'string' ? SKY_LOOKS[palette] ?? null : null);
