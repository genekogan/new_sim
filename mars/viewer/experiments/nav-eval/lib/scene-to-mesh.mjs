// Convert the engine's SpatialScene (viewer/engine/spatial/types.ts) into a closed
// triangle soup so Recast / Rapier / three-mesh-bvh can be run on *exactly* the
// scene the bespoke planner uses. Stair links become real step geometry; stair
// "-body" placeholder obstacles are dropped; missing treads parsed from link.reason.
export function sceneToMesh(scene, { slab = 0.2 } = {}) {
  const pos = [], idx = [], boxes = [];
  // oriented box: footprint OBB {c:[x,z], half:[hx,hz], yaw}, vertical [y0,y1]
  const obox = (obb, y0, y1, label) => {
    boxes.push({ obb, y0, y1, label });
    const { c, half, yaw } = obb;
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    const corner = (sx, sz) => [c[0] + sx * half[0] * cs - sz * half[1] * sn, c[1] + sx * half[0] * sn + sz * half[1] * cs];
    const foot = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
    const b = pos.length / 3;
    for (const y of [y0, y1]) for (const [x, z] of foot) pos.push(x, y, z);
    const cen = [c[0], (y0 + y1) / 2, c[1]];
    const quads = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
    for (const q of quads)
      for (const t of [[q[0], q[1], q[2]], [q[0], q[2], q[3]]]) {
        const P = t.map((i) => pos.slice((b + i) * 3, (b + i) * 3 + 3));
        const e0 = P[1].map((v, k) => v - P[0][k]), e1 = P[2].map((v, k) => v - P[0][k]);
        const n = [e0[1] * e1[2] - e0[2] * e1[1], e0[2] * e1[0] - e0[0] * e1[2], e0[0] * e1[1] - e0[1] * e1[0]];
        const d = [0, 1, 2].reduce((s, k) => s + n[k] * ((P[0][k] + P[1][k] + P[2][k]) / 3 - cen[k]), 0);
        idx.push(...(d >= 0 ? t : [t[0], t[2], t[1]]).map((i) => b + i));
      }
  };
  for (const s of scene.surfaces) obox(s.obb, s.y - slab, s.y, `surface:${s.id}`);
  for (const o of scene.obstacles) if (!o.id.endsWith('-body')) obox(o.obb, o.y0, o.y1, o.id);
  for (const l of scene.links) {
    if (l.kind !== 'stairs') continue;
    const m = /treads?\s+(\d+)\s*[–-]\s*(\d+)/.exec(l.reason || '');
    const missing = !l.usable && m ? [+m[1], +m[2]] : null;
    const n = l.path.length - 1;
    for (let i = 1; i <= n; i++) {
      if (missing && i >= missing[0] && i <= missing[1]) continue;
      const a = l.path[i - 1], b = l.path[i];
      const top = b[1];
      const y0 = missing && i > missing[1] ? top - 0.05 : Math.min(0, a[1]);
      const cx = (a[0] + b[0]) / 2, cz = (a[2] + b[2]) / 2;
      const run = Math.hypot(b[0] - a[0], b[2] - a[2]);
      obox({ c: [cx, cz], half: [run / 2, l.width / 2], yaw: Math.atan2(b[2] - a[2], b[0] - a[0]) }, y0, top, `${l.id}:step${i}`);
    }
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx), boxes };
}
