import { test } from 'node:test';
import assert from 'node:assert/strict';
import { axisPoint, gaitAt, stairFootTarget } from '../app/engine-view/stair-gait.ts';
function flight(yaw) {
  return { id: 'pose-flight', o: [8, -11], dir: [Math.cos(yaw), Math.sin(yaw)], going: .3, width: 1.2, yBottom: 0, yTop: 1.8,
    treads: Array.from({ length: 8 }, (_, i) => ({ s: .3 * (i + 1), y: .2 * (i + 1) })) };
}
function sample(f, u) {
  const s = f.treads[0].s + (u - 1) * f.going;
  const p = axisPoint(f, s, .03);
  const g = gaitAt(f, p[0], p[1], .2 * u);
  assert.ok(g && g.weight > .999); return { p, g };
}
function sideDot(point, body, yaw) {
  return (point[0] - body[0]) * -Math.sin(yaw) + (point[1] - body[1]) * Math.cos(yaw);
}
void test('physical foot targets retain anatomical side during ascent/descent at rotated world yaws', () => {
  for (const yaw of [0, Math.PI / 2, -Math.PI / 2, Math.PI, .37, 2.8]) for (const descending of [false, true]) {
    const f = flight(yaw), facingYaw = yaw + (descending ? Math.PI : 0);
    for (let u = 2; u <= 7.5; u += .125) {
      const { g, p } = sample(f, u);
      for (const wrappedYaw of [facingYaw, facingYaw - 2 * Math.PI, facingYaw + 2 * Math.PI]) {
        const left = stairFootTarget(f, g, 'left', .11, wrappedYaw), right = stairFootTarget(f, g, 'right', .11, wrappedYaw);
        assert.ok(sideDot(left.point, p, wrappedYaw) < -.10, `left target crossed at yaw=${yaw}, descending=${descending}, u=${u}`);
        assert.ok(sideDot(right.point, p, wrappedYaw) > .10, `right target crossed at yaw=${yaw}, descending=${descending}, u=${u}`);
        assert.equal(left.foot, g.feet[0]); assert.equal(right.foot, g.feet[1]);
      }
    }
  }
});
void test('negative control: ascent-fixed target sides cross the downhill body', () => {
  const f = flight(.63), { g, p } = sample(f, 4.25), yaw = .63 + Math.PI;
  const oldLeft = axisPoint(f, g.feet[0].s + .04, g.lateral - .11);
  const oldRight = axisPoint(f, g.feet[1].s + .04, g.lateral + .11);
  assert.ok(sideDot(oldLeft, p, yaw) > .10); assert.ok(sideDot(oldRight, p, yaw) < -.10);
});
void test('facing changes target side only; support heights, cadence and anatomical parity remain unchanged', () => {
  const f = flight(-.7), { g } = sample(f, 4.8);
  const before = structuredClone(g);
  for (const side of ['left', 'right']) {
    const up = stairFootTarget(f, g, side, -.12, -.7), down = stairFootTarget(f, g, side, -.12, -.7 + Math.PI);
    assert.equal(up.foot, down.foot); assert.equal(up.facing, 1); assert.equal(down.facing, -1);
    const axial = (down.point[0] - up.point[0]) * f.dir[0] + (down.point[1] - up.point[1]) * f.dir[1];
    assert.ok(Math.abs(axial - .08) < 1e-12, 'existing heel-centre shift remains unchanged');
  }
  assert.deepEqual(g, before);
});
