// Probe: V3 rows of Tool camp's library loft (the upstairs northeast bay), in mars-two coordinates.
import { readV3, indexNodes, X0 } from './v3.mjs';
const src = await readV3(); const rows = indexNodes(src);
const box = (r) => `x ${(r.e0 + X0).toFixed(2)}..${(r.e1 + X0).toFixed(2)} z ${(-r.n1).toFixed(2)}..${(-r.n0).toFixed(2)} y ${r.y0.toFixed(2)}..${r.y1.toFixed(2)}`;
const [x0, x1, z0, z1] = process.argv.slice(2).map(Number);
for (const r of rows) {
  const cx = (r.e0 + r.e1) / 2 + X0, cz = -(r.n0 + r.n1) / 2;
  if (cx < x0 || cx > x1 || cz < z0 || cz > z1) continue;
  if (r.y1 < 1.2) continue;
  console.log(r.i, (r.layer ?? '').slice(0, 26).padEnd(26), (r.asm ?? '').slice(0, 22).padEnd(22), (r.kind ?? '').slice(0, 24).padEnd(24), (r.name ?? '').slice(0, 30).padEnd(30), box(r));
}
