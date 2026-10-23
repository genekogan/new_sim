// BALLOON-BODY: a god's ride balloon draws Core's hollow cabin (door in the back wall, floor top at Core's floorY 0) instead
// of its kit's solid basket block, so a rider's body (y = basket y + floorY) stands visibly on the floor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { envelopeShapes, mouthOf } from './balloon.mesh.ts';
import { BALLOON, buildBalloon } from '../../WorldBalloonRide.ts';

{
  const shapes = [{ kind: 'lathe', at: [0, 3.2, 0], tint: 'env' }, { kind: 'extrude', at: [0, .02, 0], tint: 'basket' }, { kind: 'extrude', at: [0, .78, 0], tint: 'rim' },
    { kind: 'cyl', at: [.5, 2.1, .5], tint: 'rope' }, { kind: 'cyl', at: [0, 2.6, 0], tint: 'burner' }, { kind: 'capsule', at: [2.9, 6.8, 0], tint: 'stripe' }];
  test('god ride balloon: drops the solid basket, rim, ropes and burner and keeps the envelope', () => {
    assert.deepEqual(envelopeShapes(shapes).map((s) => s.tint), ['env', 'stripe']);
    assert.equal(mouthOf(shapes), 3.2);
  });
  test('god ride balloon: the cabin floor top is at y 0 (Core floorY) and the cabin is hollow up to the rim', () => {
    const pos = buildBalloon({ basketOnly: true }).getAttribute('position');
    const L = BALLOON.basket.length / 2 - .1, W = BALLOON.basket.width / 2 - .1;
    let floorTop = -Infinity, inBody = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (Math.abs(x) < L && Math.abs(z) < W && y < .1) floorTop = Math.max(floorTop, y);
      // nothing solid where a rider stands (between the seats and the door), from the floor to the rim
      if (x > -.3 && x < .5 && Math.abs(z) < .3 && y > .05 && y < BALLOON.basket.height - .1) inBody++;
    }
    assert.ok(Math.abs(floorTop) < .01, `floor top ${floorTop}`);
    assert.equal(inBody, 0);
  });
  test('god ride balloon: the back wall (local -x) has the door gap', () => {
    const pos = buildBalloon({ basketOnly: true }).getAttribute('position');
    let inGap = 0;
    for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getX(i) + BALLOON.basket.length / 2) < .02 && Math.abs(pos.getZ(i)) < .2 && pos.getY(i) > .1 && pos.getY(i) < .9) inGap++;
    assert.equal(inGap, 0);
  });
}
