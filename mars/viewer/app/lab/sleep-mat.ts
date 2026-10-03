// Read-only display of the explicitly authored ground-mat region; no collider or support override.
import * as THREE from 'three';
import type { WorldState } from '../../engine/world/types.ts';
export class SleepMatView {
  readonly group = new THREE.Group();
  private key = '';
  private geometry?: THREE.BufferGeometry;
  private readonly material = new THREE.MeshStandardMaterial({ color: '#416b71', roughness: 1, side: THREE.DoubleSide });
  constructor() { this.group.name = 'hypothetical ground sleeping mat'; }
  sync(world: WorldState, enabled: boolean) {
    const r = enabled ? world.regions.mat : undefined;
    const key = r ? JSON.stringify(r.polygon) : '';
    if (key === this.key) return;
    this.key = key;
    this.group.clear(); this.geometry?.dispose(); this.geometry = undefined;
    if (!r || r.polygon.length !== 4) return;
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute(r.polygon.flatMap(p => [p[0], 0.003, p[1]]), 3));
    this.geometry.setIndex([0, 2, 1, 0, 3, 2]); this.geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(this.geometry, this.material); mesh.receiveShadow = true;
    this.group.add(mesh);
  }
  dispose() { this.group.clear(); this.geometry?.dispose(); this.geometry = undefined; this.material.dispose(); }
}
