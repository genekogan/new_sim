import * as THREE from 'three';
import type { Entity } from '../../engine/world/types.ts';
import type { MeshKit } from './solar-mesh.ts';

const box = (kit: MeshKit, key: string, size: [number, number, number], color: string, pos: [number, number, number]) => {
  const mesh = new THREE.Mesh(kit.geo(key, () => new THREE.BoxGeometry(...size)), kit.mat(color));
  mesh.position.set(...pos);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
};

/** Equipment silhouettes share the catalog dimensions; labels retain the exact configuration text. */
export function equipmentMesh(e: Entity, sx: number, sy: number, sz: number, color: string, kit: MeshKit, label: THREE.Texture): THREE.Group {
  const g = new THREE.Group();
  const kind = e.equipment?.kind ?? e.def;
  if (kind === 'battery') {
    g.add(box(kit, 'battery-case', [sx, sy * 0.78, sz], color, [0, sy * 0.39, 0]));
    g.add(box(kit, 'battery-lid', [sx * 0.94, sy * 0.15, sz * 0.9], '#26342d', [0, sy * 0.87, 0]));
    for (const sign of [-1, 1]) {
      g.add(box(kit, 'battery-terminal', [0.045, 0.022, 0.045], sign < 0 ? '#b7342d' : '#333a40', [sign * sx * 0.3, sy + 0.008, 0]));
    }
    g.add(box(kit, 'battery-handle', [sx * 0.35, 0.025, 0.025], '#17251d', [0, sy + 0.018, -sz * 0.28]));
  } else if (kind === 'charge-controller') {
    g.add(box(kit, 'controller-case', [sx, sy, sz], '#596875', [0, sy / 2, 0]));
    g.add(box(kit, 'controller-screen', [sx * 0.52, sy * 0.02, sz * 0.28], '#1a3442', [0, sy + 0.009, -sz * 0.15]));
    for (const sign of [-1, 1]) g.add(box(kit, 'controller-port', [sx * 0.18, sy * 0.12, 0.02], '#252b2d', [sign * sx * 0.27, sy * 0.46, sz / 2 + 0.009]));
  } else {
    g.add(box(kit, 'inverter-case', [sx, sy, sz], '#626b71', [0, sy / 2, 0]));
    g.add(box(kit, 'inverter-front', [sx * 0.86, sy * 0.72, 0.012], '#343d43', [0, sy * 0.5, sz / 2 + 0.006]));
    const vent = kit.geo('inverter-vent', () => new THREE.BoxGeometry(sx * 0.1, sy * 0.012, 0.005));
    for (let i = 0; i < 5; i++) {
      const line = new THREE.Mesh(vent, kit.mat('#8a9296'));
      line.position.set(-sx * 0.3 + i * sx * 0.15, sy * 0.45, sz / 2 + 0.015);
      g.add(line);
    }
  }
  const labelMat = new THREE.MeshBasicMaterial({ map: label, toneMapped: false });
  const w = sx * 0.86, h = sy < 0.16 ? sz * 0.38 : Math.min(sz * 0.55, w * 0.42);
  const top = new THREE.Mesh(new THREE.PlaneGeometry(w, h), labelMat);
  top.rotation.x = -Math.PI / 2;
  top.position.set(0, sy + 0.035, sz * 0.22);
  const front = new THREE.Mesh(new THREE.PlaneGeometry(w, Math.min(sy * 0.52, h)), labelMat);
  front.position.set(0, sy * 0.45, sz / 2 + 0.02);
  top.name = front.name = 'label';
  g.add(top, front);
  return g;
}
