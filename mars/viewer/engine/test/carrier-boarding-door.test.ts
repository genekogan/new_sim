// BALLOON-BODY (Gene 2026-10-23): boarding never crosses the basket wall except through the door gap in the back wall,
// from any side and at any yaw, and riders stand on the floor (seat y = basket y + floorY).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardingPath } from '../vehicles/carrier.ts';
import { CATALOG } from '../world/catalog.ts';
import { rot2, type Vec3 } from '../core/math.ts';

const def = (CATALOG['hot-air-balloon'] as unknown as { capabilities: { carrier: Parameters<typeof boardingPath>[3] } }).capabilities.carrier;
const [L, , W] = CATALOG['hot-air-balloon'].size, HX = L / 2, HZ = W / 2, DOOR_HALF = 0.28;
const inside = (x: number, z: number) => Math.abs(x) < HX && Math.abs(z) < HZ;

for (const yaw of [0, Math.PI / 2, Math.PI, -1.1]) for (const [name, lx, lz] of [['front', 3, 0.2], ['back', -3, -0.1], ['left', 0.1, 2.5], ['right', -0.4, -2.5], ['step-out', -2, -0.9], ['beside', -1.8, -0.7]] as const) {
  test(`boarding from ${name} at yaw ${yaw.toFixed(2)} crosses the wall only through the door`, () => {
    const p: Vec3 = [-20, 0, -9], e = { id: 'b', def: 'hot-air-balloon', pose: { p, yaw } } as never;
    const w = (x: number, z: number): Vec3 => { const d = rot2([x, z], yaw); return [p[0] + d[0], p[1], p[2] + d[1]]; };
    const seatL = def.seats[0].local, seat = w(seatL[0], seatL[1]);
    const path = [w(lx, lz), ...boardingPath(e, w(lx, lz), seat, def)];
    const loc = path.map((q) => rot2([q[0] - p[0], q[2] - p[2]], -yaw));
    let crossings = 0;
    for (let i = 1; i < loc.length; i++) for (let k = 1; k <= 400; k++) {
      const a = (k - 1) / 400, b = k / 400, [x0, z0] = [loc[i - 1][0] + (loc[i][0] - loc[i - 1][0]) * a, loc[i - 1][1] + (loc[i][1] - loc[i - 1][1]) * a];
      const [x1, z1] = [loc[i - 1][0] + (loc[i][0] - loc[i - 1][0]) * b, loc[i - 1][1] + (loc[i][1] - loc[i - 1][1]) * b];
      if (inside(x0, z0) !== inside(x1, z1)) { crossings++; assert.ok(Math.abs(x1 + HX) < 0.05 && Math.abs(z1) < DOOR_HALF, `wall crossed at local (${x1.toFixed(2)}, ${z1.toFixed(2)})`); }
    }
    assert.equal(crossings, 1, 'enters exactly once, through the door');
    assert.ok(path.every((q) => q[1] === p[1] + def.floorY), 'every step on the basket floor / ground level');
  });
}
