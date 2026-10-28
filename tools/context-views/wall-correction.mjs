import { edits } from './fixture.mjs';

// Retain fixture.mjs unchanged: its original wall is refused overlap.solid with
// landmark. This reviewed correction changes only that added wall's placement.
// God rotations are radians: PI/2 places this wall across the east-west sightline.
export const correctedWallOps = () => edits.find(e => e.id === 'intervening-wall').ops.map(op => ({ ...op, p: [-20, 0], r: Math.PI / 2 }));

/** Closed segment against the actual world compiler OBB convention (radians). */
export function segmentIntersectsWall(eye, at, box) {
  const c = Math.cos(box.yaw), s = Math.sin(box.yaw);
  const local = p => [(p[0] - box.c[0]) * c - (p[2] - box.c[1]) * s, p[1], (p[0] - box.c[0]) * s + (p[2] - box.c[1]) * c];
  const a = local(eye), b = local(at), lower = [-box.half[0], box.y0, -box.half[1]], upper = [box.half[0], box.y1, box.half[1]];
  let enter = 0, leave = 1;
  for (let axis = 0; axis < 3; axis++) {
    const delta = b[axis] - a[axis];
    if (Math.abs(delta) < 1e-10) { if (a[axis] < lower[axis] || a[axis] > upper[axis]) return null; continue; }
    const bounds = [(lower[axis] - a[axis]) / delta, (upper[axis] - a[axis]) / delta].sort((x, y) => x - y);
    enter = Math.max(enter, bounds[0]); leave = Math.min(leave, bounds[1]);
    if (enter > leave) return null;
  }
  return enter > 0 && leave < 1 ? { enter, leave, point: eye.map((v, i) => v + (at[i] - v) * enter) } : null;
}

export function createdWallBox(entity, definition) {
  if (!entity || entity.in.parent !== 'world' || definition?.ref !== 'core-wall@1' ||
      ![definition.ref, 'sha:' + definition.hash, 'core/wall@1'].includes(entity.def) || definition.make?.gen !== 'box/1')
    throw Error('wall proof requires actual root entity bound to the published canonical core/wall box definition');
  const [x, z] = entity.p.length === 2 ? entity.p : [entity.p[0], entity.p[2]], y = entity.p.length === 2 ? 0 : entity.p[1], scale = entity.s ?? 1;
  return { c: [x, z], half: [entity.params.w * scale / 2, entity.params.d * scale / 2], yaw: entity.r ?? 0, y0: y, y1: y + entity.params.h * scale };
}
