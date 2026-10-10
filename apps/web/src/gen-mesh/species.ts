// Built-in plant and rock species for scatter/2 and orchard/1, in the Eden look: rounded low-poly
// blobs, tapered many-sided trunks, vertex colours, ≤ ~250 triangles each (instanced). Owner: L3.
import * as THREE from 'three';
import { Soup, rgb, scale, type RGB } from './soup.ts';

export type SpeciesKind = 'oak' | 'pine' | 'birch' | 'poplar' | 'palm' | 'bush' | 'fern' | 'reed' | 'rock' | 'boulder' | 'flower' | 'grass' | 'cactus' | 'apple' | 'pear' | 'cherry' | 'olive' | 'lemon';
const BARK = rgb('#6b4a30'), LEAF = rgb('#4f8a3e'), DARK = rgb('#2f6a3a'), BIRCH = rgb('#e9e4d6'), ROCK = rgb('#8f8b82');

/** Geometry at unit scale, base at the origin. Cached per kind. */
const cache = new Map<string, THREE.BufferGeometry>();
export function speciesGeometry(kind: SpeciesKind | string): THREE.BufferGeometry {
  const hit = cache.get(kind); if (hit) return hit;
  const s = new Soup();
  switch (kind) {
    case 'pine': {
      s.cyl([0, 0, 0], 0.16, 1.6, BARK, 6, 0.1);
      const tiers: [number, number, number][] = [[1.2, 1.6, 2.4], [2.3, 1.25, 2.0], [3.3, 0.9, 1.7], [4.2, 0.55, 1.4]];
      tiers.forEach(([y, r, h], i) => s.cone([0, y, 0], r, h, scale(DARK, 0.9 + i * 0.06), 8));
      break;
    }
    case 'birch': {
      s.cyl([0, 0, 0], 0.11, 3.2, BIRCH, 6, 0.07);
      for (const [y, h] of [[0.6, 0.06], [1.3, 0.05], [2.1, 0.06]]) s.cyl([0, y, 0], 0.115, h, rgb('#3a3530'), 6, 0.112, false);
      s.blob([0, 3.5, 0], [1.0, 1.5, 1.0], rgb('#8fb04a'), 1, 0.14, 3);
      s.blob([0.4, 2.9, 0.2], [0.65, 0.8, 0.6], rgb('#7aa245'), 0, 0.15, 5);
      break;
    }
    case 'poplar': {
      s.cyl([0, 0, 0], 0.14, 1.4, BARK, 6, 0.1);
      s.blob([0, 3.4, 0], [0.8, 2.6, 0.8], rgb('#5d8f3c'), 1, 0.1, 7);
      break;
    }
    case 'palm': {
      for (let k = 0; k < 6; k++) s.cyl([0.04 * k, k * 0.7, 0], 0.16 - k * 0.012, 0.72, scale(BARK, 1.1 + (k % 2) * 0.1), 7, 0.15 - k * 0.012);
      for (let k = 0; k < 7; k++) { const a = (k / 7) * Math.PI * 2; s.rod([0.24, 4.2, 0], [0.24 + Math.cos(a) * 1.9, 3.5, Math.sin(a) * 1.9], 0.09, scale(LEAF, 1.05), 3); }
      s.blob([0.24, 4.2, 0], [0.3, 0.25, 0.3], rgb('#6a8f34'), 0, 0.1, 2);
      break;
    }
    case 'bush': {
      s.blob([0, 0.45, 0], [0.75, 0.55, 0.7], rgb('#4d7f39'), 1, 0.16, 11);
      s.blob([0.45, 0.35, 0.2], [0.45, 0.4, 0.45], rgb('#5a8d3f'), 0, 0.15, 12);
      break;
    }
    case 'fern': {
      for (let k = 0; k < 7; k++) { const a = (k / 7) * Math.PI * 2; s.rod([0, 0.05, 0], [Math.cos(a) * 0.65, 0.45, Math.sin(a) * 0.65], 0.07, scale(rgb('#5e9440'), 0.9 + (k % 3) * 0.06), 3); }
      break;
    }
    case 'reed': {
      for (let k = 0; k < 5; k++) { const a = k * 1.3, r = 0.08 + (k % 2) * 0.06, h = 1.3 + (k % 3) * 0.35, x = Math.cos(a) * r, z = Math.sin(a) * r; s.rod([x, -0.2, z], [x * 1.6, h, z * 1.6], 0.018, rgb('#7a9442'), 3); if (k % 2 === 0) s.rod([x * 1.5, h * 0.8, z * 1.5], [x * 1.6, h * 0.97, z * 1.6], 0.045, rgb('#6b4a2c'), 5); }
      break;
    }
    case 'rock': {
      s.blob([0, 0.25, 0], [0.7, 0.5, 0.6], ROCK, 0, 0.22, 21);
      break;
    }
    case 'boulder': {
      s.blob([0, 0.6, 0], [1.4, 1.0, 1.2], scale(ROCK, 0.95), 1, 0.2, 23);
      s.blob([0.9, 0.3, 0.5], [0.6, 0.45, 0.55], scale(ROCK, 1.05), 0, 0.2, 24);
      break;
    }
    case 'flower': {
      const petals = [rgb('#e8c547'), rgb('#d9534f'), rgb('#f2f0e6'), rgb('#9b6cc0')];
      for (let k = 0; k < 4; k++) { const a = k * 1.7, x = Math.cos(a) * 0.15, z = Math.sin(a) * 0.15, h = 0.35 + (k % 2) * 0.15; s.rod([x, 0, z], [x, h, z], 0.012, rgb('#5d8f3c'), 3); s.blob([x, h, z], [0.07, 0.05, 0.07], petals[k], 0, 0.1, k, false); }
      break;
    }
    case 'grass': {
      for (let k = 0; k < 6; k++) { const a = k * 1.05, x = Math.cos(a) * 0.1, z = Math.sin(a) * 0.1; s.cone([x, 0, z], 0.05, 0.35 + (k % 3) * 0.12, scale(rgb('#7fa64a'), 0.9 + (k % 2) * 0.12), 3); }
      break;
    }
    case 'cactus': {
      s.cyl([0, 0, 0], 0.22, 1.9, rgb('#5f8f4a'), 8, 0.2); s.blob([0, 1.9, 0], [0.2, 0.15, 0.2], rgb('#5f8f4a'), 0, 0.05, 1);
      s.rod([0.2, 0.9, 0], [0.55, 0.95, 0], 0.12, rgb('#5f8f4a'), 6); s.cyl([0.55, 0.9, 0], 0.12, 0.6, rgb('#5f8f4a'), 6, 0.11);
      break;
    }
    case 'apple': case 'pear': case 'cherry': case 'lemon': case 'olive': {
      const leaf = kind === 'olive' ? rgb('#8a9a6a') : kind === 'cherry' ? rgb('#5f9446') : LEAF;
      s.cyl([0, 0, 0], 0.14, 1.3, BARK, 6, 0.1);
      s.blob([0, 1.9, 0], [1.25, 0.95, 1.2], leaf, 1, 0.16, 31);
      const fruit: Record<string, RGB> = { apple: rgb('#c8382e'), pear: rgb('#c9c24a'), cherry: rgb('#a8183a'), lemon: rgb('#f0d43a'), olive: rgb('#3d4a2a') };
      if (kind === 'cherry') s.blob([0.2, 2.2, 0.1], [0.9, 0.6, 0.85], rgb('#f2b8c8'), 0, 0.2, 33);
      for (let k = 0; k < 7; k++) { const a = k * 0.9, y = 1.5 + (k % 3) * 0.35, r = 1.05 - (k % 3) * 0.2; s.blob([Math.cos(a) * r, y, Math.sin(a) * r], [0.09, 0.09, 0.09], fruit[kind], 0, 0, k, false); }
      break;
    }
    default: { // oak / broadleaf
      s.cyl([0, 0, 0], 0.22, 1.9, BARK, 7, 0.14);
      s.rod([0, 1.6, 0], [0.7, 2.4, 0.2], 0.08, BARK, 4);
      s.blob([0, 3.0, 0], [1.6, 1.3, 1.5], LEAF, 1, 0.16, 41);
      s.blob([0.9, 2.6, 0.4], [0.95, 0.8, 0.9], scale(LEAF, 1.08), 0, 0.18, 42);
      s.blob([-0.7, 2.7, -0.5], [0.9, 0.75, 0.85], scale(LEAF, 0.92), 0, 0.18, 43);
    }
  }
  const g = s.geometry(); cache.set(kind, g); return g;
}
