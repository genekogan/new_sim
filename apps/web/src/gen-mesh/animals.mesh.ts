// animals/1 mesh half: a herd in an area. Owner: L4. CONTRACT STUB (L1): static rounded blobs at
// seeded points. L4 replaces with pack animals (eden-animals.glb clips) or kit creatures with
// gaits, moving by behaviour (wander, graze, swim, perch, sleep, fly) as a function of world time.
import * as THREE from 'three';
import { scatterPoints } from '@sim/generators';
import { registerMesh } from './registry.ts';

const body = new THREE.SphereGeometry(0.35, 8, 6);
registerMesh({
  gen: 'animals/1', world: true,
  build(ctx) {
    const e = ctx.entity; if (!e.shape || !('area' in e.shape)) return null;
    const count = Number(ctx.params.count ?? 3), pts = scatterPoints(e.shape.area, 1, 1, e.seed ?? 7, count);
    const g = new THREE.Group(), mat = ctx.materials.get('fur');
    for (const [x, z] of pts.slice(0, count)) { const m = new THREE.Mesh(body, mat); m.scale.set(1.3, 0.8, 0.8); m.position.set(x, ctx.model.terrain.sample(x, z) + 0.35, z); m.castShadow = true; g.add(m); }
    return g;
  },
});
