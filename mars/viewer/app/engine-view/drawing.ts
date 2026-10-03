// Appearance only. Retained marks read authoritative pad state; no execution here.
import * as THREE from 'three';
import {
  DRAWING_MARKS,
  DRAWING_MARK_TICKS,
  DRAWING_TOTAL_TICKS,
} from '../../engine/objects/drawing.ts';
import type { ItemObject, Kit } from './items.ts';
export function drawingItemObject(
  def: string,
  size: [number, number, number],
  color: string,
  kit: Kit,
): ItemObject | null {
  if (def !== 'drawing-pad' && def !== 'drawing-pencil') return null;
  const [width, height, depth] = size,
    group = new THREE.Group();
  const add = (geometry: THREE.BufferGeometry, color: string) => {
    const m = new THREE.Mesh(geometry, kit.mat(color));
    m.castShadow = m.receiveShadow = true;
    group.add(m);
    return m;
  };
  if (def === 'drawing-pencil') {
    const tipHeight = 0.016;
    const barrel = add(
      kit.geo(
        'drawing-pencil-body',
        () =>
          new THREE.CylinderGeometry(
            width / 2,
            width / 2,
            height - tipHeight,
            6,
          ),
      ),
      color,
    );
    barrel.position.y = tipHeight + (height - tipHeight) / 2;
    const tip = add(
      kit.geo(
        'drawing-pencil-tip',
        () => new THREE.ConeGeometry(width / 2, tipHeight, 6),
      ),
      '#34312e',
    );
    tip.rotation.x = Math.PI;
    tip.position.y = tipHeight / 2;
    return { obj: group };
  }
  const paper = add(
    kit.geo('drawing-pad', () => new THREE.BoxGeometry(width, height, depth)),
    color,
  );
  paper.position.y = height / 2;
  const drawingMarks = DRAWING_MARKS.map((_, i) => {
    const mark = add(
      kit.geo('drawing-mark', () => new THREE.BoxGeometry(1, 0.001, 0.0018)),
      '#363431',
    );
    mark.name = `retained-mark-${i + 1}`;
    mark.position.y = height + 0.0005;
    mark.visible = false;
    mark.castShadow = false;
    return mark;
  });
  return { obj: group, drawingMarks };
}
export function setDrawing(
  it: ItemObject,
  state: Record<string, string | number | boolean> | undefined,
) {
  if (!it.drawingMarks) return;
  const ticks = Math.max(
    0,
    Math.min(
      DRAWING_TOTAL_TICKS,
      typeof state?.drawTicks === 'number' ? state.drawTicks : 0,
    ),
  );
  for (let i = 0; i < it.drawingMarks.length; i++) {
    const [from, to] = DRAWING_MARKS[i],
      mark = it.drawingMarks[i],
      progress = Math.max(
        0,
        Math.min(1, (ticks - i * DRAWING_MARK_TICKS) / DRAWING_MARK_TICKS),
      );
    const dx = to[0] - from[0],
      dz = to[1] - from[1];
    mark.visible = progress > 0;
    mark.scale.x = Math.sqrt(dx * dx + dz * dz) * progress;
    mark.rotation.y = -Math.atan2(dz, dx);
    mark.position.x = from[0] + (dx * progress) / 2;
    mark.position.z = from[1] + (dz * progress) / 2;
  }
}
