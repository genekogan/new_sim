// Path and area mesh halves: roads, paths, walls, fences, hedges, bridges, rivers (banks), plazas,
// lawns, pitches, decks, gardens. Owner: L3. CONTRACT STUB (L1): surfaces become draped ribbons
// or polygons sampled on the terrain every ~2 m; colliders become boxes. World-frame builders.
// L3 replaces with kerbs, paving patterns, line markings, rails, posts, shores, waterfalls.
import * as THREE from 'three';
import type { Surface } from '@sim/generators';
import { registerMesh, type MeshCtx } from './registry.ts';

const box = new THREE.BoxGeometry(1, 1, 1);
const SURFACE_COLORS: Record<string, string> = { asphalt: '#4b4d50', cobble: '#a59d8f', gravel: '#b3ac9e', dirt: '#8a6a48', sand: '#d9c38f', stone: '#b9b3a6', wood: '#a07a4f', tile: '#c48a6a', brick: '#a8553f', grass: '#6aa84f', moss: '#5d7a3a', mud: '#6a5136', rock: '#8d8a84', snow: '#f2f4f6' };

/** A polygon draped on the terrain: fan-triangulated via ShapeGeometry, then each vertex lifted to ground + y. Edges are densified so it follows hills. */
export function drapedPolygon(ctx: MeshCtx, s: Surface, lift = 0.03): THREE.Mesh {
  const dense: [number, number][] = [];
  for (let i = 0; i < s.polygon.length; i++) {
    const [ax, az] = s.polygon[i], [bx, bz] = s.polygon[(i + 1) % s.polygon.length];
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 2));
    for (let k = 0; k < steps; k++) dense.push([ax + ((bx - ax) * k) / steps, az + ((bz - az) * k) / steps]);
  }
  const geo = new THREE.ShapeGeometry(new THREE.Shape(dense.map(([x, z]) => new THREE.Vector2(x, z))));
  geo.rotateX(Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const elevated = s.y > 0.3; // decks and bridges keep their own height
  for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), z = pos.getZ(i); pos.setY(i, elevated ? (ctx.model.terrain.sample(x, z) + s.y) : ctx.model.terrain.sample(x, z) + s.y + lift); }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, ctx.materials.get((s.material as never) ?? 'gravel', SURFACE_COLORS[s.material ?? ''] ?? '#b3ac9e', { side: THREE.DoubleSide }));
  mesh.receiveShadow = true; mesh.name = `surface:${s.tag ?? ''}`; mesh.userData.cameraTransparent = true;
  return mesh;
}

function pathOrArea(ctx: MeshCtx): THREE.Object3D | null {
  const g = new THREE.Group();
  for (const s of ctx.baked.surfaces ?? []) g.add(drapedPolygon(ctx, s));
  const color = typeof ctx.params.color === 'string' ? ctx.params.color : ctx.def.tags.includes('hedge') ? '#3f6b35' : '#c9c1b2';
  for (const c of ctx.baked.colliders) {
    const y = ctx.model.terrain.sample(c.c[0], c.c[1]);
    const m = new THREE.Mesh(box, ctx.materials.get(ctx.def.material ?? 'stone', color)); m.scale.set(c.half[0] * 2, c.y1 - c.y0, c.half[1] * 2); m.position.set(c.c[0], y + (c.y0 + c.y1) / 2, c.c[1]); m.rotation.y = c.yaw; m.castShadow = m.receiveShadow = true; g.add(m);
  }
  return g.children.length ? g : null;
}

for (const gen of ['road/1', 'path/1', 'wall/1', 'fence/1', 'hedge/1', 'bridge/1', 'power-line/1', 'plaza/1', 'lawn/1', 'pitch/1', 'deck/1', 'parking/1', 'garden-bed/1', 'orchard/1', 'scatter/2'])
  registerMesh({ gen, world: true, build: pathOrArea });
// rivers: the water ribbon is drawn by the entity layer from the ground record; banks are L3's.
registerMesh({ gen: 'river/1', world: true, build: () => null });
