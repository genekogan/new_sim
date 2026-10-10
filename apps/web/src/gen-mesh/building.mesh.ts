// building/1 + stairs/1 mesh halves. Owner: L2. CONTRACT STUB (L1): draws the baked wall
// segments, floor slabs and a simple roof so placeholder buildings read as hollow houses.
// L2 replaces with the Eden look (port dwelling-kit, eden-facades, eden-interiors): framed
// windows and doors, trims, porches, balconies, stairs with treads, roofs by style, and the
// interior view (hide roof/upper floors above the camera; ?hideRoofs=1).
import * as THREE from 'three';
import { registerMesh } from './registry.ts';

const box = new THREE.BoxGeometry(1, 1, 1);
const col = (v: unknown, d: string) => (typeof v === 'string' && /^#/.test(v) ? v : d);

registerMesh({
  gen: 'building/1',
  build(ctx) {
    const g = new THREE.Group(), b = ctx.baked, p = ctx.params;
    const wall = ctx.materials.get((p.material as never) ?? 'plaster', col(ctx.entity.state?.paint, col(p.wall, '#f1e7d2')));
    for (const c of b.colliders) {
      const m = new THREE.Mesh(box, wall); m.scale.set(c.half[0] * 2, c.y1 - c.y0, c.half[1] * 2); m.position.set(c.c[0], (c.y0 + c.y1) / 2, c.c[1]); m.rotation.y = c.yaw; m.castShadow = m.receiveShadow = true; g.add(m);
    }
    const floorMat = ctx.materials.get('wood', '#b08b5a');
    for (const s of b.surfaces ?? []) {
      const shape = new THREE.Shape(s.polygon.map(([x, z]) => new THREE.Vector2(x, z)));
      const geo = new THREE.ShapeGeometry(shape); geo.rotateX(Math.PI / 2);
      const m = new THREE.Mesh(geo, floorMat); m.position.y = s.y; m.receiveShadow = true; m.material = floorMat; (m.material as THREE.Material).side = THREE.DoubleSide; g.add(m);
    }
    const [w, , d] = b.box, top = Math.max(...b.colliders.map((c) => c.y1), 2.6);
    if (p.roof !== 'none' && !new URLSearchParams(location.search).has('hideRoofs')) {
      const pitch = ((typeof p.roofPitch === 'number' ? p.roofPitch : 32) * Math.PI) / 180, rise = Math.tan(pitch) * (d / 2);
      const s = new THREE.Shape([new THREE.Vector2(-d / 2 - 0.3, 0), new THREE.Vector2(d / 2 + 0.3, 0), new THREE.Vector2(0, rise + 0.2)]);
      const geo = new THREE.ExtrudeGeometry(s, { depth: w + 0.6, bevelEnabled: false }); geo.translate(0, 0, -(w + 0.6) / 2); geo.rotateY(Math.PI / 2);
      const roof = new THREE.Mesh(geo, ctx.materials.get('tile', col(p.roofColor, '#8a3b2a'))); roof.position.y = top; roof.castShadow = true; roof.name = 'roof'; g.add(roof);
    }
    return g;
  },
});

registerMesh({
  gen: 'stairs/1',
  build(ctx) {
    const g = new THREE.Group(), rise = Number(ctx.params.rise ?? 2.8), run = Number(ctx.params.run ?? 4), width = Number(ctx.params.width ?? 1.1);
    const n = Math.max(2, Math.round(rise / 0.18)), mat = ctx.materials.get('wood');
    for (let i = 0; i < n; i++) { const t = new THREE.Mesh(box, mat); t.scale.set(width, rise / n, run / n); t.position.set(0, (rise / n) * (i + 0.5), run / 2 - (run / n) * (i + 0.5)); t.castShadow = true; g.add(t); }
    return g;
  },
});
