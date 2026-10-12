// MARSLAND: which way is north in the scene the viewer draws (the sun's and the sky's compass). Native scenes (/w/mars,
// /w/eden) keep the Mars viewer's own convention (−X is north: sun.ts NORTH_AZIMUTH_OFFSET = −90). Entity (god-built)
// worlds use the engine's north = −z (offset 0), as the god tools, `land extend n` and the Souls' compass words do, so the
// sun rises in +x (east) and stands in +z (south) at noon.
import { NORTH_AZIMUTH_OFFSET } from '../../../mars/viewer/engine/env/sun.ts';
import { newWorld } from './world-kind.ts';
import { marsFork, MARS_2026_NORTH_OFFSET } from './mars-fork.ts';

// MARSLAND-FORK: the operator's Mars fork (/worlds/w/mars) uses the 2026 site bearing, so Chiba's panels face south.
let offset = newWorld ? 0 : marsFork ? MARS_2026_NORTH_OFFSET : NORTH_AZIMUTH_OFFSET;
/** Degrees added to a compass azimuth before projecting to x/z (sun.ts convention). */
export const siteNorthOffset = () => offset;
export function setSiteNorthOffset(deg: number) { offset = deg; }
