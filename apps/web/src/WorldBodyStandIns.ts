import * as THREE from 'three';

/** Own only the visibility changes made while a body is replaced by a loading figure. */
export class WorldBodyStandIns {
 private hidden = new WeakSet<THREE.Object3D>();
 private group: THREE.Group; private geometry: THREE.BufferGeometry; private material: THREE.Material;
 constructor(group: THREE.Group, geometry: THREE.BufferGeometry, material: THREE.Material) { this.group=group; this.geometry=geometry; this.material=material; }
 sync(id: string, p: readonly number[], body: THREE.Object3D | null, readiness: { unresolved: boolean; customReady: boolean; uploaded: boolean; legacyReady: boolean }) {
  // A loaded template is not yet a drawn replacement during the lazy people renderer handoff.
  const needed = !body || readiness.unresolved || (!readiness.customReady && !readiness.uploaded && !readiness.legacyReady);
  let standIn = this.group.getObjectByName(id) as THREE.Mesh | undefined;
  if (!needed) {
   if (body && this.hidden.has(body)) { body.visible = true; this.hidden.delete(body); }
   standIn?.removeFromParent();
   return;
  }
  if (body?.visible) { this.hidden.add(body); body.visible = false; }
  if (!standIn) { standIn = new THREE.Mesh(this.geometry, this.material); standIn.name = id; standIn.castShadow = true; this.group.add(standIn); }
  standIn.position.set(p[0], p[1] + 0.82, p[2]);
 }
 finish(ids: ReadonlySet<string>) { for (const body of [...this.group.children]) if (!ids.has(body.name)) body.removeFromParent(); }
}
