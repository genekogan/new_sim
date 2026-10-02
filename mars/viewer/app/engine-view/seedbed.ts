import * as THREE from 'three';
import type { Entity } from '../../engine/world/types.ts';

type SeedbedEntity = Entity & {
  planting?: { kind: string; deposited: number };
};
type Box = (color: string, x: number, y: number, z: number,
  sx: number, sy: number, sz: number) => THREE.Mesh;

/** Visual deposit markers, never seedlings or a second source of seed quantity. */
export function seedbedObject(box: Box, sx: number, sy: number, sz: number, color: string) {
  const obj = new THREE.Group();
  for (const side of [-1, 1]) {
    obj.add(box(color, side * (sx / 2 - 0.025), 0, 0, 0.05, sy, sz));
    obj.add(box(color, 0, 0, side * (sz / 2 - 0.025), sx, sy, 0.05));
  }
  obj.add(box('#473421', 0, sy - 0.04, 0, sx - 0.1, 0.04, sz - 0.1));
  const markers = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z], i) => {
    const marker = box('#c6ae73', x * sx * 0.2, sy, z * sz * 0.2, 0.075, 0.016, 0.035);
    marker.name = `retained-seed-deposit-${i + 1}`;
    marker.visible = false;
    obj.add(marker);
    return marker;
  });
  let deposits = 0;
  return {
    obj,
    update(entity: Entity) {
      const state = (entity as SeedbedEntity).planting;
      const n = state?.kind === 'seedbed-v1' ? state.deposited * 16 : 0;
      // Invalid authoritative state is diagnosed by the activity. Do not invent
      // a visible quantity for missing, fractional, negative or excess deposits.
      deposits = Number.isInteger(n) && n >= 0 && n <= 4 ? n : 0;
      markers.forEach((marker, i) => { marker.visible = i < deposits; });
    },
    inspection() {
      obj.updateWorldMatrix(true, true);
      const visible = markers.filter(marker => marker.visible);
      return {
        deposits,
        count: visible.length,
        positions: visible.map(marker => marker.getWorldPosition(new THREE.Vector3()).toArray()),
        decorativePlantVisible: false,
      };
    },
  };
}
export type SeedbedVisual = ReturnType<typeof seedbedObject>;
