// three.js side of the year-walkabout presets (year-walkabout.ts): the studio's
// real geometry for the year as the lab backdrop (procedural Kit scene from
// app/history/scenes.ts for 2020–2025, the runtime campus GLB for 2026), and
// the "Engine obstacle prisms" overlay — translucent boxes for every obstacle
// that blocks the ground band, drawn on top of everything so footprints under
// roofs stay visible and disagreements with the render stand out.
import * as THREE from 'three';
import type { Runtime } from '../../engine/runtime/runtime.ts';
import type { Spatial } from '../../engine/spatial/service.ts';
import { obbCorners } from '../../engine/core/math.ts';
import { loadGltf, ThreeResources } from '../../lib/three-resources';
import { walkaboutInfo } from './year-walkabout.ts';
import { clearGroup } from './overlay-debug.ts';

/** What LabView renders as static geometry (StaticScene has the same shape). */
export type Backdrop = { group: THREE.Group; dispose(): void; ready?: () => boolean; fog?: [number, number] };

const GROUND = new THREE.MeshStandardMaterial({ color: '#c8b08a', roughness: 1 });

function disposeTree(root: THREE.Object3D) {
  const geos = new Set<THREE.BufferGeometry>(), mats = new Set<THREE.Material>(), texs = new Set<THREE.Texture>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    geos.add(m.geometry);
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      if (mat === GROUND) continue;
      mats.add(mat);
      for (const v of Object.values(mat)) if (v instanceof THREE.Texture) texs.add(v);
    }
  });
  geos.forEach((g) => g.dispose());
  mats.forEach((m) => m.dispose());
  texs.forEach((t) => t.dispose());
}

/** Every texture image decoded (Kit photos load asynchronously; captures wait for this). */
function texturesLoaded(root: THREE.Object3D) {
  let ok = true;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!ok || !m.isMesh) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material])
      for (const v of Object.values(mat))
        if (v instanceof THREE.Texture && v.image instanceof HTMLImageElement && !(v.image.complete && v.image.naturalWidth > 0)) ok = false;
  });
  return ok;
}

/** 2026 GLB nodes the engine extractor skips (deploy/engine-scene.mjs): people, context groups, aerial/reference ground. */
const skipped2026 = (o: THREE.Object3D) => {
  const u = o.userData ?? {};
  return ['context_person', 'context_group', 'reference'].includes(u.kind) || ['people', 'reference-ground'].includes(u.assembly_id) || u.layer === 'Aerial reference';
};

/** The studio's geometry for a year-walkabout runtime; undefined for other presets (LabView then uses StaticScene). */
export function yearBackdrop(rt: Runtime, onError: (message: string) => void): Backdrop | undefined {
  const info = walkaboutInfo(rt);
  if (!info) return undefined;
  const group = new THREE.Group();
  group.name = `studio ${info.year} geometry`;
  const [x0, z0, x1, z1] = info.base.bounds;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 + 200, z1 - z0 + 200), GROUND);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((x0 + x1) / 2, info.base.meta.groundY - 0.004, (z0 + z1) / 2);
  ground.receiveShadow = true;
  group.add(ground);
  let loaded = false, disposed = false;
  const abort = new AbortController(), resources = new ThreeResources();
  if (info.year === 2026) {
    loadGltf('/browser/campus.glb?v=20260922b', abort.signal, resources)
      .then((g) => {
        if (disposed) return;
        g.scene.traverse((o) => {
          if (skipped2026(o)) o.visible = false;
          if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
        });
        group.add(g.scene);
        loaded = true;
      })
      .catch((e) => {
        if (!disposed) onError(`2026 campus GLB could not load: ${e.message}`);
      });
  } else {
    // dynamic: keeps the studio's scene modules out of the lab's import graph (and its dev-server
    // reloads) until a year walkabout is opened
    import('../history/scenes')
      .then(({ createHistoricalScene }) => {
        if (disposed) return;
        group.add(createHistoricalScene(info.year));
        loaded = true;
      })
      .catch((e) => {
        if (!disposed) onError(`studio ${info.year} scene could not load: ${e.message}`);
      });
  }
  const r = (x1 - x0 + z1 - z0) / 2;
  return {
    group,
    ready: () => loaded && texturesLoaded(group),
    fog: [Math.max(70, r * 1.2), Math.max(160, r * 2.6)],
    dispose() {
      disposed = true;
      abort.abort();
      ground.geometry.dispose();
      disposeTree(group);
      resources.dispose();
    },
  };
}

// saturated hues that stay distinct from timber, sand and painted walls
const KIND_COLOR: Record<string, string> = { wall: '#ff1f3d', glass: '#00e5ff', vehicle: '#ffe600', fixture: '#7a4dff', solid: '#ff2bd6', component: '#ff9d2e' };

/**
 * Ground-band obstacle prisms (those the grids treat as blocking at level 0: y1 > y+0.22 and
 * y0 < y+1.8), one instanced translucent draw + one outline draw, depthTest off.
 */
export function buildPrisms(group: THREE.Group, sp: Spatial) {
  for (const o of group.children) if (o instanceof THREE.InstancedMesh) o.dispose();
  clearGroup(group);
  const lv = sp.scene.levels.find((l) => l.id === 0);
  if (!lv) return;
  const y = lv.y;
  const obs = sp.scene.obstacles.filter((o) => o.y1 > y + 0.22 && o.y0 < y + 1.8);
  if (!obs.length) return;
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, depthTest: false, depthWrite: false }), obs.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
  const edges: number[] = [];
  obs.forEach((o, i) => {
    const b0 = Math.max(o.y0, y), b1 = Math.min(o.y1, y + 1.8);
    q.setFromAxisAngle(up, -o.obb.yaw);
    m.compose(new THREE.Vector3(o.obb.c[0], b0, o.obb.c[1]), q, new THREE.Vector3(o.obb.half[0] * 2, Math.max(0.02, b1 - b0), o.obb.half[1] * 2));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.set(KIND_COLOR[o.kind ?? 'solid'] ?? KIND_COLOR.solid));
    const cs = obbCorners(o.obb);
    for (let k = 0; k < 4; k++) {
      const [ax, az] = cs[k], [bx, bz] = cs[(k + 1) % 4];
      edges.push(ax, b1, az, bx, b1, bz, ax, b0, az, bx, b0, bz, ax, b0, az, ax, b1, az);
    }
  });
  mesh.renderOrder = 5;
  mesh.name = 'engine prisms';
  const lines = new THREE.LineSegments(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(edges, 3)),
    new THREE.LineBasicMaterial({ color: '#3a0a00', transparent: true, opacity: 0.7, depthTest: false }),
  );
  lines.renderOrder = 6;
  group.add(mesh, lines);
}
