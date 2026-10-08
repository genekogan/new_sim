// Mars camp surroundings: the low Sonoran desert around a Mars College camp (Bombay Beach,
// east shore of the Salton Sea) — creosote clumps, scattered stones, a few camp supplies left
// outside the walls (IBC water totes, a shipping container) and low hills to the north and
// east, toward the Chocolate Mountains. Render only and Mars only: everything with any height
// stands OUTSIDE the camp's walkable ground (every level-0 surface, plus a margin), so nothing
// here can stand where a person walks, works or a part is laid; inside the camp only flat pile
// pads and 4 cm build-site corner stakes are drawn. Deterministic: a fixed seed, no Math.random.
// Cost: five draw calls (instanced shrubs, stones, totes; container; hills) plus two once regions
// arrive (pile pads, build-site stakes), under 45k triangles,
// only the container and totes cast shadows. Nothing is loaded from the network.
import * as THREE from 'three';
import type { SpatialScene } from '../../../mars/viewer/engine/spatial/types.ts';

/** The Mars camp (the original eden-camp ground and its expansions) is the only scene this dresses. */
export const isMarsCamp = (scene: SpatialScene | null): scene is SpatialScene => !!scene?.surfaces.some((s) => s.id === 'camp-ground' && s.level === 0);

type Rect = [number, number, number, number];
const MARGIN = 4; // m of bare ground kept between the camp's walkable ground and any dressing
const OUTER = 110; // m: scatter radius around the camp centre

/** Axis-aligned bounds of every ground-level surface, grown by the margin (where dressing never goes). */
export function campKeepClear(scene: SpatialScene): Rect {
  let x0 = scene.bounds[0], z0 = scene.bounds[1], x1 = scene.bounds[2], z1 = scene.bounds[3];
  for (const s of scene.surfaces) {
    if (s.level !== 0) continue;
    const c = Math.abs(Math.cos(s.obb.yaw)), n = Math.abs(Math.sin(s.obb.yaw));
    const hx = s.obb.half[0] * c + s.obb.half[1] * n, hz = s.obb.half[0] * n + s.obb.half[1] * c;
    x0 = Math.min(x0, s.obb.c[0] - hx); x1 = Math.max(x1, s.obb.c[0] + hx);
    z0 = Math.min(z0, s.obb.c[1] - hz); z1 = Math.max(z1, s.obb.c[1] + hz);
  }
  return [x0 - MARGIN, z0 - MARGIN, x1 + MARGIN, z1 + MARGIN];
}
const inside = (r: Rect, x: number, z: number, pad = 0) => x > r[0] - pad && x < r[2] + pad && z > r[1] - pad && z < r[3] + pad;

/** mulberry32: a small fixed-seed generator, so the desert is the same on every load. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type DesertPlacement = { kind: 'shrub' | 'stone' | 'tote' | 'container'; x: number; z: number; yaw: number; s: number };

/** Where everything goes (pure; tested): a ring of scatter outside the keep-clear rectangle. */
export function marsDesertLayout(scene: SpatialScene): DesertPlacement[] {
  const keep = campKeepClear(scene), cx = (keep[0] + keep[2]) / 2, cz = (keep[1] + keep[3]) / 2;
  const rand = rng(0x5a17e5), out: DesertPlacement[] = [];
  const scatter = (kind: 'shrub' | 'stone', n: number, near: number) => {
    for (let k = 0, tries = 0; k < n && tries < n * 20; tries++) {
      // denser close to the camp, thinning out with distance
      const r = near + (OUTER - near) * rand() ** 1.6, a = rand() * Math.PI * 2;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (inside(keep, x, z, 1)) continue;
      out.push({ kind, x, z, yaw: rand() * Math.PI * 2, s: kind === 'shrub' ? 0.4 + rand() * 0.7 : 0.12 + rand() * 0.38 });
      k++;
    }
  };
  scatter('shrub', 260, 6);
  scatter('stone', 320, 4);
  // camp supplies, just outside the north-east corner of the walls: three water totes and a container
  const [x1, z0] = [keep[2], keep[1]];
  for (let i = 0; i < 3; i++) out.push({ kind: 'tote', x: x1 + 2.2, z: z0 + 3 + i * 1.35, yaw: 0, s: 1 });
  out.push({ kind: 'container', x: x1 + 6.5, z: z0 + 6, yaw: Math.PI / 2, s: 1 });
  return out;
}

const color = (hex: string) => new THREE.Color(hex);
const SHRUB = ['#7d8452', '#8a8c5c', '#6f7a47', '#93916a', '#767d4c'].map(color);
const STONE = ['#8b735a', '#9b8467', '#7a6650', '#a6927a'].map(color);

/** The dressing as three.js objects. Owns (and disposes) everything it creates. */
export class MarsDesert {
  readonly group = new THREE.Group();
  private readonly owned: { dispose(): void }[] = [];

  constructor(scene: SpatialScene) {
    this.group.name = 'mars desert';
    const layout = marsDesertLayout(scene), keep = campKeepClear(scene);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    const own = <T extends { dispose(): void }>(x: T) => (this.owned.push(x), x);
    const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, list: DesertPlacement[], shape: (d: DesertPlacement) => [number, number, number, number], palette?: THREE.Color[]) => {
      const mesh = new THREE.InstancedMesh(own(geo), own(mat), list.length);
      list.forEach((d, i) => {
        const [sx, sy, sz, y] = shape(d);
        q.setFromAxisAngle(up, -d.yaw);
        m.compose(p.set(d.x, y, d.z), q, s.set(sx, sy, sz));
        mesh.setMatrixAt(i, m);
        if (palette) mesh.setColorAt(i, palette[i % palette.length]);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      return mesh;
    };
    const by = (k: DesertPlacement['kind']) => layout.filter((d) => d.kind === k);
    // creosote: a loose, flattened clump (low icosphere), olive and dusty
    instanced(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, flatShading: true }), by('shrub'),
      (d) => [d.s * 0.95, d.s * 0.72, d.s * 0.85, d.s * 0.3], SHRUB);
    // stones half set into the ground
    instanced(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, flatShading: true }), by('stone'),
      (d) => [d.s * 1.3, d.s * 0.7, d.s, d.s * 0.18], STONE);
    // IBC water totes: white tank in a grey cage, on a pallet (one merged box set, instanced)
    const tote = instanced(this.toteGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.15 }), by('tote'), () => [1, 1, 1, 0]);
    tote.castShadow = true;
    // a weathered 20 ft shipping container, doors facing the camp
    for (const d of by('container')) {
      const box = new THREE.Mesh(own(this.containerGeometry()), own(new THREE.MeshStandardMaterial({ color: '#8c5a3c', roughness: 0.8, metalness: 0.3, flatShading: true })));
      box.position.set(d.x, 0, d.z);
      box.rotation.y = -d.yaw;
      box.castShadow = box.receiveShadow = true;
      box.name = 'mars desert container';
      this.group.add(box);
    }
    // low hills at the far edge of the ground to the north and east (toward the Chocolate Mountains)
    const ridge = new THREE.Mesh(own(this.ridgeGeometry((keep[0] + keep[2]) / 2, (keep[1] + keep[3]) / 2)), own(new THREE.MeshStandardMaterial({ color: '#b59c80', roughness: 1, side: THREE.DoubleSide })));
    ridge.name = 'mars desert ridge';
    this.group.add(ridge);
  }

  /** 1.0 × 1.15 × 1.2 m: pallet, white tank, a few cage bars; per-vertex colours so it stays one draw call. */
  private toteGeometry() {
    const parts: THREE.BufferGeometry[] = [];
    const add = (sx: number, sy: number, sz: number, x: number, y: number, z: number, hex: string) => {
      const g = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed();
      g.translate(x, y, z);
      const c = color(hex), n = g.getAttribute('position').count, cols = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) c.toArray(cols, i * 3);
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      g.deleteAttribute('uv');
      parts.push(g);
    };
    add(1.2, 0.14, 1.0, 0, 0.07, 0, '#9a7b55'); // pallet
    add(1.1, 0.9, 0.92, 0, 0.6, 0, '#e9e7df'); // tank
    for (const x of [-0.56, 0.56]) for (const z of [-0.47, 0.47]) add(0.04, 1.0, 0.04, x, 0.64, z, '#8d9094'); // cage posts
    for (const y of [0.45, 0.8, 1.13]) { add(1.16, 0.035, 0.035, 0, y, -0.47, '#8d9094'); add(1.16, 0.035, 0.035, 0, y, 0.47, '#8d9094'); }
    add(0.18, 0.08, 0.18, 0, 1.1, 0, '#3d3f42'); // cap
    const merged = mergeBoxes(parts);
    for (const g of parts) g.dispose();
    return merged;
  }

  /** 6.06 × 2.59 × 2.44 m with shallow vertical corrugation ribs on the long sides. */
  private containerGeometry() {
    const L = 6.06, H = 2.59, W = 2.44, parts: THREE.BufferGeometry[] = [new THREE.BoxGeometry(L, H, W).translate(0, H / 2, 0).toNonIndexed()];
    for (let i = 0; i < 22; i++) {
      const x = -L / 2 + 0.2 + (i * (L - 0.4)) / 21;
      for (const z of [-W / 2 - 0.02, W / 2 + 0.02]) parts.push(new THREE.BoxGeometry(0.07, H - 0.2, 0.04).translate(x, H / 2, z).toNonIndexed());
    }
    for (const g of parts) g.deleteAttribute('uv');
    const merged = mergeBoxes(parts);
    for (const g of parts) g.dispose();
    return merged;
  }

  /**
   * Low ragged hills at the far edge of the ground, from north round to south-east: a crest line
   * 125–170 m out, 5–19 m high, with a front slope down to the ground and a back slope behind it.
   */
  private ridgeGeometry(cx: number, cz: number) {
    const rand = rng(0xc0c0a), seg = 120, a0 = -Math.PI * 0.62, a1 = Math.PI * 0.22;
    let h = 10, r = 145;
    const crest: { a: number; r: number; h: number }[] = [];
    for (let i = 0; i <= seg; i++) {
      h = Math.max(5, Math.min(19, h + (rand() - 0.5) * 4.5));
      r = Math.max(125, Math.min(170, r + (rand() - 0.5) * 8));
      crest.push({ a: a0 + ((a1 - a0) * i) / seg, r, h });
    }
    const at = (a: number, rr: number, y: number) => [cx + Math.cos(a) * rr, y, cz + Math.sin(a) * rr];
    const pos: number[] = [];
    const quad = (p: number[], q: number[], u: number[], v: number[]) => pos.push(...p, ...q, ...u, ...p, ...u, ...v);
    for (let i = 0; i < seg; i++) {
      const A = crest[i], B = crest[i + 1];
      // front slope (toward the camp), then back slope
      quad(at(A.a, A.r - A.h * 3, -0.05), at(B.a, B.r - B.h * 3, -0.05), at(B.a, B.r, B.h), at(A.a, A.r, A.h));
      quad(at(A.a, A.r, A.h), at(B.a, B.r, B.h), at(B.a, B.r + B.h * 2.5, -0.05), at(A.a, A.r + A.h * 2.5, -0.05));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  }

  private marks = '';
  private markOwned: { dispose(): void }[] = [];
  /**
   * Mark the camp's material piles and its build site on the ground, once the recording supplies
   * the regions: a compacted-earth pad under each material pile (the plan's own pile colour, darkened
   * to dirt) and corner stakes with orange flagging at the marked build site. Flat or tiny, so a
   * part, a person or a pile on them is never hidden or displaced. Two draw calls; idempotent.
   */
  markRegions(regions: Record<string, { id: string; kind?: string; level?: number; polygon?: [number, number][] }> | undefined) {
    if (!regions) return;
    const piles = Object.values(regions).filter((r) => r.kind === 'material-pile' && (r.level ?? 0) === 0 && (r.polygon?.length ?? 0) >= 3).sort((a, b) => (a.id < b.id ? -1 : 1));
    const site = regions['build-site']?.polygon;
    const key = JSON.stringify([piles.map((r) => [r.id, r.polygon]), site ?? null]);
    if (key === this.marks) return;
    this.marks = key;
    this.group.getObjectByName('mars desert marks')?.removeFromParent();
    for (const x of this.markOwned) x.dispose();
    this.markOwned = [];
    const group = new THREE.Group();
    group.name = 'mars desert marks';
    const own = <T extends { dispose(): void }>(x: T) => (this.markOwned.push(x), x);
    if (piles.length) {
      const pads = piles.map((r) => {
        const g = new THREE.ShapeGeometry(new THREE.Shape(r.polygon!.map(([x, z]) => new THREE.Vector2(x, -z))));
        g.rotateX(-Math.PI / 2);
        g.deleteAttribute('uv');
        return g.toNonIndexed();
      });
      const mesh = new THREE.Mesh(own(mergeBoxes(pads)), own(new THREE.MeshStandardMaterial({ color: '#ad9673', roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })));
      for (const g of pads) g.dispose();
      mesh.position.y = 0.003;
      mesh.receiveShadow = true;
      mesh.name = 'mars desert pile pads';
      group.add(mesh);
    }
    if (site && site.length >= 3) {
      const parts: THREE.BufferGeometry[] = [];
      const add = (sx: number, sy: number, sz: number, x: number, y: number, z: number, hex: string) => {
        const g = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed();
        g.translate(x, y, z);
        g.deleteAttribute('uv');
        const c = color(hex), n = g.getAttribute('position').count, cols = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) c.toArray(cols, i * 3);
        g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
        parts.push(g);
      };
      for (const [x, z] of site) { add(0.04, 0.7, 0.04, x, 0.35, z, '#b58f5c'); add(0.05, 0.12, 0.012, x + 0.03, 0.62, z, '#ec6a1f'); }
      const stakes = new THREE.Mesh(own(mergeBoxes(parts)), own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 })));
      for (const g of parts) g.dispose();
      stakes.castShadow = true;
      stakes.name = 'mars desert site stakes';
      group.add(stakes);
    }
    this.group.add(group);
  }

  dispose() {
    this.group.removeFromParent();
    for (const x of [...this.owned, ...this.markOwned]) x.dispose();
    this.owned.length = 0;
    this.markOwned = [];
  }
}

/** Concatenate non-indexed geometries with the same attributes (positions, normals, optional colours). */
function mergeBoxes(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(parts[0].attributes)) {
    const size = parts[0].getAttribute(name).itemSize, total = parts.reduce((n, g) => n + g.getAttribute(name).count, 0);
    const arr = new Float32Array(total * size);
    let o = 0;
    for (const g of parts) { arr.set(g.getAttribute(name).array as Float32Array, o); o += g.getAttribute(name).count * size; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  return out;
}
