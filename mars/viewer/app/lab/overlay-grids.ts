// Raster overlays straight from engine grids: per-level walkability/clearance
// heatmap (LevelGrid.clearance) and single-file traffic components
// (Spatial.narrow) with live traffic reservations highlighted.
import * as THREE from 'three';
import type { LevelGrid } from '../../engine/spatial/grid.ts';
import type { Spatial } from '../../engine/spatial/service.ts';
import { HUMAN_PROFILE } from '../../engine/spatial/types.ts';

const R = HUMAN_PROFILE.radius;

function plane(g: LevelGrid, data: Uint8Array, lift: number) {
  const tex = new THREE.DataTexture(data, g.nx, g.nz, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.flipY = false;
  tex.needsUpdate = true;
  const w = g.nx * g.cell, d = g.nz * g.cell;
  const geo = new THREE.PlaneGeometry(w, d);
  // after rotateX(-90°) uv v=0 sits at +z; flip so texture row 0 (z0) is at -z
  geo.rotateX(-Math.PI / 2);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  m.position.set(g.x0 + w / 2, g.y + lift, g.z0 + d / 2);
  m.renderOrder = 2;
  return m;
}

/** Colour ramp: red = floor but blocked/too tight (< r), amber = single-file band, green→clear = open. */
function clearanceTexture(g: LevelGrid, floor: (i: number) => boolean) {
  const n = g.nx * g.nz, out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const c = g.clearance[i], k = i * 4;
    if (!g.free[i]) {
      if (g.blockers.has(i)) out.set([150, 20, 30, 170], k); // obstacle footprint
      else if (floor(i)) out.set([150, 20, 30, 170], k);
      continue; // void (no floor): transparent
    }
    if (c < R) out.set([235, 70, 40, 150], k);
    else if (c < 2 * R + 0.15) out.set([245, 190, 40, 140], k);
    else {
      const t = Math.min(1, (c - 2 * R) / 2.5);
      out.set([40, 200 - 80 * t, 120 + 60 * t, 120 - 90 * t], k);
    }
  }
  return out;
}

const HUES = [[80, 160, 255], [255, 120, 220], [120, 255, 200], [255, 170, 80], [190, 130, 255], [120, 230, 90]];

export class GridOverlays {
  readonly heat = new THREE.Group();
  readonly traffic = new THREE.Group();
  private epoch = -1;

  constructor() {
    this.heat.name = 'overlay:grid';
    this.traffic.name = 'overlay:traffic';
  }

  private dispose(g: THREE.Group) {
    for (const o of g.children)
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.MeshBasicMaterial).map?.dispose();
        (o.material as THREE.Material).dispose();
      }
    g.clear();
  }

  /** Rebuild when the navigation epoch changes (construction). */
  sync(sp: Spatial, held: Set<string>) {
    const key = sp.epoch * 1000 + held.size;
    if (key === this.epoch) return;
    const rebuildHeat = Math.floor(this.epoch / 1000) !== sp.epoch;
    this.epoch = key;
    if (rebuildHeat) {
      this.dispose(this.heat);
      for (const g of sp.grids.levels.values()) this.heat.add(plane(g, clearanceTexture(g, () => g.level === 0), 0.03));
    }
    this.dispose(this.traffic);
    for (const g of sp.grids.levels.values()) {
      const lab = sp.narrow(g.level, R);
      const out = new Uint8Array(g.nx * g.nz * 4);
      for (let i = 0; i < lab.length; i++) {
        const c = lab[i];
        if (c < 0) continue;
        const busy = held.has(`narrow:${sp.epoch}:${g.level}:${c}`);
        const [r, gg, b] = busy ? [255, 40, 40] : HUES[c % HUES.length];
        out.set([r, gg, b, busy ? 230 : 170], i * 4);
      }
      this.traffic.add(plane(g, out, 0.05));
    }
  }
}
