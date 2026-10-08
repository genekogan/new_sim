import test from 'node:test';
import assert from 'node:assert/strict';
import {DRIFTERS,drifterAt,burn,Balloons} from '../src/atmosphere/balloons.ts';
import {Terrain} from '../../../mars/viewer/app/engine-view/content/assets/eden-regions/terrain.ts';
test('balloons drift on closed loops that never jump when the 7200 s atmosphere clock wraps', () => {
  for (const d of DRIFTERS) {
    assert.equal(7200 % d.period, 0, 'period divides 7200');
    const a = drifterAt(d, 0), b = drifterAt(d, 7200);
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(a[k] - b[k]) < 1e-6);
    const p = drifterAt(d, 0), q = drifterAt(d, d.period / 4);
    assert.ok(Math.hypot(p[0] - q[0], p[2] - q[2]) > 30, 'they actually move');
  }
});
test('balloons stay well clear of the terrain and the inhabited rectangle roofs', () => {
  const t = new Terrain(() => 0);
  for (const d of DRIFTERS) for (let s = 0; s < 7200; s += 20) {
    const [x, y, z] = drifterAt(d, s), basket = y - d.s * 1.15 - 1.8;
    const ground = x > -100 && x < 105 && z > -65 && z < 85 ? 12 : t.height(x, z);
    assert.ok(basket - ground > 20, `${x.toFixed(0)},${z.toFixed(0)} basket ${basket.toFixed(1)} over ground ${ground.toFixed(1)}`);
  }
});
test('burners flare briefly (about 12 s in 90 s); one draw, decorative only', () => {
  let on = 0; for (let s = 0; s < 900; s++) if (burn(DRIFTERS[0], s) > 0) on++;
  assert.ok(on > 100 && on < 140, String(on));
  const b = new Balloons(); assert.equal(b.mesh.frustumCulled, false); assert.equal(b.mesh.userData.cameraTransparent, true); assert.equal(b.mesh.castShadow, false);
  b.update(123); b.dispose();
});
