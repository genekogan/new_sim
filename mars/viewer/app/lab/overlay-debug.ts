// Vector debug overlays: planned route legs + clearance ribbons, obstacle
// footprints, stair links (entry/approach/facing, usable vs unusable) and
// violation markers. Everything reads engine state; nothing writes it.
import * as THREE from 'three';
import type { Runtime, Violation } from '../../engine/runtime/runtime.ts';
import type { Spatial } from '../../engine/spatial/service.ts';
import type { Route } from '../../engine/spatial/path.ts';
import { linkApproach } from '../../engine/spatial/path.ts';
import { segmentClearance } from '../../engine/spatial/grid.ts';
import { obbCorners } from '../../engine/core/math.ts';

const line = (pts: THREE.Vector3[], color: string, opacity = 1) =>
  new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity, depthTest: false }));
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export function clearGroup(g: THREE.Object3D) {
  g.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
  g.clear();
}

/** Live walk_to routes. The Runtime keeps execution state private; this debug read is the only such access (see README). */
export function liveRoutes(rt: Runtime): { id: string; actor: string; route: Route; leg: number }[] {
  const live = (rt as unknown as { live: Map<string, { exec: { actor?: string; route?: Route; leg?: number } }> }).live;
  if (!(live instanceof Map)) return [];
  return [...live.entries()].filter(([, l]) => l.exec?.route).map(([id, l]) => ({ id, actor: l.exec.actor!, route: l.exec.route!, leg: l.exec.leg ?? 0 }));
}

/** Route polylines (cyan = current leg) and corridor ribbons whose half-width is each segment's clearance. */
export function buildRoutes(group: THREE.Group, rt: Runtime) {
  clearGroup(group);
  const sp = rt.services.spatial as Spatial;
  for (const { route, leg } of liveRoutes(rt))
    route.legs.forEach((l, k) => {
      const color = k === leg ? '#28e0ff' : k < leg ? '#557080' : '#8fb8ff';
      if (l.kind === 'link') {
        group.add(line(l.link.path.map((p) => v3(p[0], p[1] + 0.08, p[2])), color));
        return;
      }
      const g = sp.level(l.level);
      if (!g) return;
      const y = g.y + 0.08;
      group.add(line(l.points.map((p) => v3(p[0], y, p[1])), color));
      for (let i = 1; i < l.points.length; i++) {
        const a = l.points[i - 1], b = l.points[i];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 1e-3) continue;
        const half = Math.min(2, segmentClearance(g, a, b));
        const rib = new THREE.Mesh(new THREE.PlaneGeometry(len, half * 2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.13, depthWrite: false }));
        rib.position.set((a[0] + b[0]) / 2, y - 0.02, (a[1] + b[1]) / 2);
        rib.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
        group.add(rib);
      }
      const end = l.points[l.points.length - 1];
      const dot = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.25, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, depthTest: false }));
      dot.position.set(end[0], y, end[1]);
      group.add(dot);
    });
}

/** OBB prisms (outline at base and top) for every obstacle the planner sees, including components. */
export function buildObstacles(group: THREE.Group, sp: Spatial) {
  clearGroup(group);
  for (const o of sp.scene.obstacles) {
    const cs = obbCorners(o.obb);
    const color = o.kind === 'component' ? '#ff9d2e' : o.kind === 'wall' ? '#ff4d6d' : '#d06cff';
    for (const y of [Math.max(0, o.y0) + 0.04, o.y1]) group.add(line([...cs, cs[0]].map(([x, z]) => v3(x, y, z)), color));
    for (const [x, z] of cs) group.add(line([v3(x, Math.max(0, o.y0), z), v3(x, o.y1, z)], color, 0.5));
  }
}

function arrow(from: THREE.Vector3, dirYaw: number, len: number, color: string) {
  return new THREE.ArrowHelper(v3(Math.cos(dirYaw), 0, Math.sin(dirYaw)), from, len, color, 0.3, 0.2);
}

/** Stair links: green usable / red unusable; entry discs, approach points, facing arrows both ways. */
export function buildLinks(group: THREE.Group, sp: Spatial) {
  clearGroup(group);
  for (const l of sp.scene.links) {
    const color = l.usable ? '#3dff7a' : '#ff3355';
    group.add(line(l.path.map((p) => v3(p[0], p[1] + 0.15, p[2])), color));
    for (const asc of [true, false]) {
      const { entry, approach } = linkApproach(l, asc);
      const y = (sp.level(entry.level)?.y ?? 0) + 0.1;
      const ring = new THREE.Mesh(new THREE.RingGeometry(l.width / 2 - 0.06, l.width / 2, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 }));
      ring.position.set(entry.p[0], y, entry.p[1]);
      group.add(ring, line([v3(approach[0], y, approach[1]), v3(entry.p[0], y, entry.p[1])], color));
      group.add(arrow(v3(approach[0], y, approach[1]), asc ? l.heading : l.heading + Math.PI, 0.8, color));
    }
  }
}

/** Red pillars + rings at every violation location (kept for the whole run). */
export function buildViolations(group: THREE.Group, vs: Violation[]) {
  clearGroup(group);
  const seen = new Set<string>();
  for (const v of vs) {
    if (!v.at) continue;
    const key = `${v.code}:${v.at.map((x) => x.toFixed(1)).join(',')}`;
    if (seen.has(key) || seen.size > 200) continue;
    seen.add(key);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6).translate(0, 1.3, 0), new THREE.MeshBasicMaterial({ color: '#ff1133', depthTest: false }));
    m.position.set(v.at[0], v.at[1], v.at[2]);
    const r = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.5, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ff1133', depthTest: false }));
    r.position.set(v.at[0], v.at[1] + 0.06, v.at[2]);
    group.add(m, r);
  }
}
