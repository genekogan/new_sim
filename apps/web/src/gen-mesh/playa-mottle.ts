// The playa ground's mottling (MARSLAND-NEAR; moved out of ground-palette.ts by lane L3 so the phone arrival can run it in
// a worker, terrain-color.worker.ts): soft crust/dust patches (40–200 m), thin tan veins with dry grass along them, fine
// speckle. Pure in (colour, x, z); the noise comes straight from the generators' desert module (no package index).
import * as THREE from 'three';
import { fbm, playaPatch, playaVein } from '../../../../packages/generators/src/desert.ts';

const PLAYA = { crust: '#c5c6c6', dust: '#aaa392', vein: '#a69c87', grass: '#a89d78' };
const C = new Map<string, THREE.Color>();
export const col = (h: string) => { let c = C.get(h); if (!c) { c = new THREE.Color(h); C.set(h, c); } return c; };
export function playaMottle(c: THREE.Color, x: number, z: number) {
  const p = playaPatch(x, z);
  if (p > 0) c.lerp(col(PLAYA.crust), Math.min(1, p * 1.3) * 0.45); else c.lerp(col(PLAYA.dust), Math.min(1, -p * 1.3) * 0.2);
  const v = playaVein(x, z);
  if (v > 0.02) { c.lerp(col(PLAYA.vein), v * 0.7); c.lerp(col(PLAYA.grass), v * v * 0.25 * fbm(x, z, 18, 1, 3)); }
  const k = 1 + (fbm(x, z, 7, 2, 61) - 0.5) * 0.09; c.r = Math.min(1, c.r * k); c.g = Math.min(1, c.g * k); c.b = Math.min(1, c.b * k);
}
/** Mottle `n` vertices: rgb (doubles, the unmottled colours) and xz in, float colours out (what sectorMesh stores). */
export function mottleColors(rgb: Float64Array, xz: Float64Array, out: Float32Array, idx: Uint32Array) {
  const c = new THREE.Color();
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k];
    c.r = rgb[i * 3]; c.g = rgb[i * 3 + 1]; c.b = rgb[i * 3 + 2];
    playaMottle(c, xz[i * 2], xz[i * 2 + 1]);
    out[i * 3] = c.r; out[i * 3 + 1] = c.g; out[i * 3 + 2] = c.b;
  }
}
