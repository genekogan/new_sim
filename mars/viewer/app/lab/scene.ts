// Static geometry for the Engine Lab: ground, walls/solids as boxes (from the
// engine SpatialScene) and stairs built from link.path with missing treads left
// out. World components (panels, rack parts) are drawn by components.ts.
import * as THREE from 'three';
import type { Link, Obstacle, SpatialScene } from '../../engine/spatial/types.ts';

const MAT = {
  ground: new THREE.MeshStandardMaterial({ color: '#b9a383', roughness: 1 }),
  wall: new THREE.MeshStandardMaterial({ color: '#cdb892', roughness: 0.9 }),
  solid: new THREE.MeshStandardMaterial({ color: '#9c7a52', roughness: 0.85 }),
  post: new THREE.MeshStandardMaterial({ color: '#2f6fb3', roughness: 0.6, metalness: 0.2 }),
  tread: new THREE.MeshStandardMaterial({ color: '#a8835a', roughness: 0.85 }),
  stringer: new THREE.MeshStandardMaterial({ color: '#e07b2a', roughness: 0.6, metalness: 0.2 }),
};
const unit = new THREE.BoxGeometry(1, 1, 1);

function box(mat: THREE.Material, cx: number, y0: number, cz: number, sx: number, sy: number, sz: number, yaw = 0) {
  const m = new THREE.Mesh(unit, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(cx, y0 + sy / 2, cz);
  m.rotation.y = -yaw;
  m.castShadow = m.receiveShadow = true;
  return m;
}

/** Parse "treads 6–9 …" / "treads 5–12 missing" into a set of missing tread numbers (1-based from the bottom). */
export function missingTreads(link: Link): Set<number> {
  const out = new Set<number>();
  if (link.usable) return out;
  const m = /(\d+)\s*[–-]\s*(\d+)/.exec(link.reason ?? '');
  if (m) for (let i = Number(m[1]); i <= Number(m[2]); i++) out.add(i);
  else for (let i = 2; i < link.path.length - 1; i += 2) out.add(i); // unknown: show gaps rather than a false-complete stair
  return out;
}

/** Treads centred on link.path points 1..n (point 0 is the ground entry), plus two stringers. */
function stairs(link: Link): THREE.Group {
  const g = new THREE.Group();
  g.name = `stairs ${link.id}`;
  const p = link.path, n = p.length - 1;
  const dx = p[n][0] - p[0][0], dz = p[n][2] - p[0][2];
  const run = Math.hypot(dx, dz) / n, yaw = Math.atan2(dz, dx);
  const missing = missingTreads(link);
  for (let i = 1; i <= n; i++) {
    if (missing.has(i)) continue;
    g.add(box(MAT.tread, p[i][0], p[i][1] - 0.05, p[i][2], run + 0.02, 0.05, link.width, yaw));
  }
  const len = Math.hypot(dx, p[n][1] - p[0][1], dz), pitch = Math.atan2(p[n][1] - p[0][1], Math.hypot(dx, dz));
  const side: [number, number] = [-Math.sin(yaw), Math.cos(yaw)];
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(unit, MAT.stringer);
    m.scale.set(len, 0.22, 0.06);
    m.position.set((p[0][0] + p[n][0]) / 2 + side[0] * s * (link.width / 2 + 0.03), (p[0][1] + p[n][1]) / 2 - 0.12, (p[0][2] + p[n][2]) / 2 + side[1] * s * (link.width / 2 + 0.03));
    m.rotation.set(0, -yaw, pitch, 'YXZ');
    m.castShadow = true;
    g.add(m);
  }
  return g;
}

function obstacleMesh(o: Obstacle, wall = MAT.wall) {
  const mat = o.label === 'deck post' ? MAT.post : o.kind === 'wall' ? wall : MAT.solid;
  const m = box(mat, o.obb.c[0], o.y0, o.obb.c[1], o.obb.half[0] * 2, o.y1 - o.y0, o.obb.half[1] * 2, o.obb.yaw);
  m.name = o.id;
  return m;
}

export class StaticScene {
  readonly group = new THREE.Group();

  private readonly styledMaterials: THREE.Material[] = [];
  constructor(base: SpatialScene, colors?: { ground: string; wall: string }) {
    const groundMaterial = colors ? MAT.ground.clone() : MAT.ground;
    const wallMaterial = colors ? MAT.wall.clone() : MAT.wall;
    if (colors) {
      groundMaterial.color.set(colors.ground); wallMaterial.color.set(colors.wall);
      this.styledMaterials.push(groundMaterial, wallMaterial);
    }
    this.group.name = 'proving ground';
    const [x0, z0, x1, z1] = base.bounds;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 + 40, z1 - z0 + 40), groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
    ground.receiveShadow = true;
    this.group.add(ground);
    const bodies = new Set(base.links.map((l) => `${l.id}-body`));
    for (const o of base.obstacles) if (!bodies.has(o.id)) this.group.add(obstacleMesh(o, wallMaterial));
    for (const l of base.links) if (l.kind === 'stairs') this.group.add(stairs(l));
  }

  dispose() {
    for (const material of this.styledMaterials) material.dispose();
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh && o.geometry !== unit) o.geometry.dispose();
    });
  }
}
