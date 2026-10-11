// Ground palettes: what the terrain is made of, read by the entity layer's terrain colouring.
// `state.ground.palette` (patch 03) ∈ grass | desert | dust | sand | snow | rock | garden | playa. The
// colour is a pure function of height above base, slope and a little positional noise, so every
// viewer paints the same ground. Owner: L3.
import * as THREE from 'three';
import { fbm, playaPatch, playaVein } from '@sim/generators';

export const GROUND_PALETTES = ['grass', 'desert', 'dust', 'sand', 'snow', 'rock', 'garden', 'playa'] as const;
export type GroundPalette = (typeof GROUND_PALETTES)[number];
type P = { low: string; base: string; high: string; rock: string; snow?: number; snowC?: string; rockFrom: number; noise: number; shore: string };
const PAL: Record<GroundPalette, P> = {
  grass: { low: '#a89b6f', base: '#5f9a4c', high: '#7e8a6e', rock: '#8d8a84', snow: 140, snowC: '#f2f4f6', rockFrom: 0.7, noise: 0.05, shore: '#a89b6f' },
  garden: { low: '#8c8a5a', base: '#4f8f3e', high: '#5f8a4a', rock: '#7d8a70', snow: 160, snowC: '#eef2ee', rockFrom: 0.85, noise: 0.07, shore: '#8c8a5a' },
  desert: { low: '#c9a66b', base: '#d8b27a', high: '#c79565', rock: '#a8674a', rockFrom: 0.45, noise: 0.06, shore: '#bfa070' },
  dust: { low: '#b9a888', base: '#c8b896', high: '#b3a487', rock: '#9a8c78', rockFrom: 0.6, noise: 0.05, shore: '#a99a7c' },
  sand: { low: '#d8c59a', base: '#e2d1a4', high: '#d4c08e', rock: '#b8a27a', rockFrom: 0.55, noise: 0.04, shore: '#cdb88a' },
  snow: { low: '#dfe6ea', base: '#eef2f5', high: '#f6f8fa', rock: '#7f858c', snow: 0, snowC: '#f8fafc', rockFrom: 0.75, noise: 0.03, shore: '#c9d2d8' },
  rock: { low: '#8a857b', base: '#8f8a80', high: '#a19c92', rock: '#6f6b65', snow: 120, snowC: '#eef0f2', rockFrom: 0.5, noise: 0.08, shore: '#8a857b' },
  // MARSLAND-NEAR: the Salton Sea playa (pale crusted cream, tan drainage veins and dusty patches; mottling in playaMottle)
  playa: { low: '#bdb5a0', base: '#c4beb0', high: '#b9ad96', rock: '#a39478', rockFrom: 0.5, noise: 0, shore: '#c6bfae' },
};
const PLAYA = { crust: '#d3cfc4', dust: '#b9ac92', vein: '#ab9877', grass: '#b4a26e' };
/** Playa mottling: soft crust/dust patches (40–200 m), thin tan veins with dry grass along them, fine speckle. */
function playaMottle(c: THREE.Color, x: number, z: number) {
  const p = playaPatch(x, z);
  if (p > 0) c.lerp(col(PLAYA.crust), Math.min(1, p * 1.3) * 0.5); else c.lerp(col(PLAYA.dust), Math.min(1, -p * 1.3) * 0.38);
  const v = playaVein(x, z);
  if (v > 0.02) { c.lerp(col(PLAYA.vein), v * 0.6); c.lerp(col(PLAYA.grass), v * v * 0.25 * fbm(x, z, 18, 1, 3)); }
  const k = 1 + (fbm(x, z, 7, 2, 61) - 0.5) * 0.09; c.r = Math.min(1, c.r * k); c.g = Math.min(1, c.g * k); c.b = Math.min(1, c.b * k);
}
const C = new Map<string, THREE.Color>(); const col = (h: string) => { let c = C.get(h); if (!c) { c = new THREE.Color(h); C.set(h, c); } return c; };
function n2(x: number, z: number) { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); }

/** Terrain vertex colour for a palette (the grass palette reproduces today's colouring plus a little noise). */
export function terrainColorFor(palette: string | undefined): (c: THREE.Color, y: number, slope: number, base: number, x?: number, z?: number) => void {
  const p = PAL[(palette as GroundPalette) ?? 'grass'] ?? PAL.grass;
  return (c, y, slope, base, x = 0, z = 0) => {
    const h = y - base;
    c.copy(h < -0.2 ? col(p.shore) : col(p.base));
    if (h < -0.2) c.lerp(col(p.low), Math.min(1, (-0.2 - h) / 1.5) * 0.6); // wet ground below the plain: shore → bed
    if (h > 40) c.lerp(col(p.high), Math.min(1, (h - 40) / 60));
    const rocky = Math.min(1, Math.max(0, (slope - p.rockFrom) / 0.9));
    c.lerp(col(p.rock), rocky);
    if (p.snow !== undefined && h > p.snow) c.lerp(col(p.snowC ?? '#f2f4f6'), Math.min(1, (h - p.snow) / 50));
    if (p === PAL.playa && h > -0.2) playaMottle(c, x, z);
    if (p.noise > 0) { const k = 1 + (n2(Math.floor(x / 4), Math.floor(z / 4)) - 0.5) * 2 * p.noise; c.r = Math.min(1, c.r * k); c.g = Math.min(1, c.g * k); c.b = Math.min(1, c.b * k); }
  };
}
