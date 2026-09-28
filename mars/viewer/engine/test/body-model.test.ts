// The one body model (engine/body/model.ts) is the measured rig (OWNER_DECISIONS 2026-09-28 "Body model =
// the measured rig", POSES.md "Body model") and internally consistent: the stated reach numbers and the
// posture envelopes (shoulder band + lean + arm, `postureGap`) agree, the stated caps bind before the
// envelopes do, the posture bands follow from the rig's proportions, and the landmarks are within an arm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dcos } from '../core/math.ts';
import { BODY_MODEL as M, postureGap, bodyFrame, restHand, carryHand, shoulderPoint, chestPoint, mouthPoint, type Posture } from '../body/model.ts';
import { human } from '../world/factory.ts';
import type { Vec3 } from '../core/math.ts';

const FEET: Vec3 = [0, 0, 0];
const DEG = Math.PI / 180;
const d3 = (a: Vec3, b: Vec3) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
/** Deepest hand `out` m from the feet a posture's envelope reaches (bisection on postureGap). */
function deepest(pz: Posture, out: number) {
  if (postureGap(pz, FEET, [out, pz.lo, 0]) > 0) return NaN;
  let lo = -3, hi = pz.lo; // lo: outside (too deep), hi: inside
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (postureGap(pz, FEET, [out, m, 0]) <= 0) hi = m; else lo = m; }
  return hi;
}
/** Farthest out a posture's envelope reaches at height `y` above the feet. */
function farthest(pz: Posture, y: number) {
  let lo = 0, hi = 3;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (postureGap(pz, FEET, [m, y, 0]) <= 0) lo = m; else hi = m; }
  return lo;
}

test('body model = the measured rig (W9, poses.spec.ts "body model", within 2 cm)', () => {
  assert.equal(M.shoulderHeight, 1.34);
  assert.equal(M.shoulderHalf, 0.15);
  assert.equal(M.armLength, 0.62);
  assert.equal(M.overheadReach, 2.0);
  assert.ok(Math.abs(M.overheadMax - 2.06) < 1e-9);
  assert.equal(M.reachDownBelowFeet, 0.5);
  assert.equal(M.maxHorizontalFromFeet, 0.8);
  // measured: shoulders 1.340, half-width 0.116–0.146, arm 0.620, overhead 1.997 / 2.057, reach-down 0.35–0.54 at 0.45 m out, out 0.78–0.96
  assert.ok(Math.abs(M.overheadReach - 1.997) <= 0.02 && Math.abs(M.overheadMax - 2.057) <= 0.02);
  assert.ok(M.shoulderHalf >= 0.116 - 0.02 && M.shoulderHalf <= 0.146 + 0.02);
  assert.ok(M.reachDownBelowFeet >= 0.35 && M.reachDownBelowFeet <= 0.54, 'reach-down within the measured range');
  assert.ok(M.maxHorizontalFromFeet >= 0.78 - 0.02 && M.maxHorizontalFromFeet <= 0.96, 'kneel reach-out within the measured range');
  assert.equal(M.mouthHeight, 1.58, "the renderer's measured mouth point (humans.ts)");
});

test('body model is internally consistent: overhead, caps vs envelopes, bands from the rig, landmarks', () => {
  // overhead ≈ shoulders + arm + shrug (the elbow never locks: a little under)
  assert.ok(Math.abs(M.overheadReach - (M.shoulderHeight + M.armLength + M.shrug)) <= 0.05);
  assert.ok(M.overheadReach <= M.shoulderHeight + M.armLength + M.shrug + 1e-9);
  assert.equal(M.overheadMax, M.overheadReach + M.heelRaise);
  // every posture tops out at shoulders + shrug + heels, so an arm straight up reaches overheadMax (the stated cap binds)
  const top = M.shoulderHeight + M.shrug + M.heelRaise;
  for (const [name, pz] of Object.entries(M.posture)) {
    assert.ok(Math.abs(pz.hi - top) < 1e-9, `${name}.hi = shoulders + shrug + heels`);
    assert.ok(pz.lo < pz.hi && pz.lean >= 0 && pz.lean < M.armLength, name);
  }
  const up = M.posture.upright;
  assert.ok(postureGap(up, FEET, [0, M.overheadMax, 0]) <= 0, 'upright envelope reaches overheadMax');
  assert.ok(postureGap(up, FEET, [0, M.overheadMax + 0.05, 0]) > 0, '… and not 5 cm more');
  assert.ok(postureGap(M.posture.painting, FEET, [0, M.overheadMax, 0]) <= 0, 'painting envelope reaches overheadMax straight up');
  assert.ok(postureGap(M.posture.painting, FEET, [0.3, M.lowReach, 0]) <= 0, 'painting envelope reaches lowReach 0.3 m out');
  // reach-down ≤ arm; the kneeling envelope reaches the cap at reachDownOut (cap binds) and ~ the measured casual / punk 0.54 m
  assert.ok(M.reachDownBelowFeet <= M.armLength);
  const bent = M.posture.bentOver;
  const deep = -deepest(bent, M.reachDownOut);
  assert.ok(deep >= M.reachDownBelowFeet, `kneeling envelope reaches ${deep.toFixed(3)} m below the feet at ${M.reachDownOut} m out ≥ the cap`);
  assert.ok(Math.abs(deep - 0.54) <= 0.02, `… ≈ the measured 0.54 m (${deep.toFixed(3)})`);
  // kneeling reach-out at kneelOutBelow below the feet: ≥ the 0.8 cap, ≈ the measured casual / punk 0.96 m
  const out = farthest(bent, -M.kneelOutBelow);
  assert.ok(out >= M.maxHorizontalFromFeet, `kneeling envelope reaches ${out.toFixed(3)} m out ≥ the kneel rule`);
  assert.ok(Math.abs(out - 0.96) <= 0.02, `… ≈ the measured 0.96 m (${out.toFixed(3)})`);
  // a kneeling body's shoulders stay above the deck (POSES.md "Body model": no shoulders below the feet)
  assert.ok(bent.lo >= 0);
  // bands from the rig: torso = shoulders − hips; squat and kneel shoulder heights = hips + torso × cos(bend)
  const R = M.rig;
  assert.ok(Math.abs(R.torso - (M.shoulderHeight - R.hip)) < 1e-9);
  assert.ok(Math.abs(M.posture.crouch.lo - (R.squatHip + R.torso * dcos(R.squatBend * DEG))) <= 0.01);
  assert.ok(Math.abs(bent.lo - (R.kneelHip + R.torso * dcos(R.kneelBend * DEG))) <= 0.01);
  assert.ok(up.lo < M.shoulderHeight && up.lo > R.hip, 'upright: knees soft, shoulders above the hips');
  // landmarks: hands within an arm of their shoulder, chest below the shoulders, mouth above them and below the crown
  const b = bodyFrame(human('x', 0, 0));
  for (const h of ['left', 'right'] as const) {
    assert.ok(d3(restHand(b, h), shoulderPoint(b, h)) <= M.armLength + 0.005, `${h} rest hand within an arm (${d3(restHand(b, h), shoulderPoint(b, h)).toFixed(4)})`);
    assert.ok(d3(carryHand(b, h), shoulderPoint(b, h)) <= M.armLength, `${h} carry hand within an arm`);
  }
  assert.ok(Math.abs(M.restHand.up - (M.shoulderHeight - M.armLength)) < 1e-9, 'rest hand = shoulders − arm');
  assert.ok(chestPoint(b)[1] < M.shoulderHeight && chestPoint(b)[1] > M.restHand.up);
  assert.ok(mouthPoint(b)[1] > M.shoulderHeight && mouthPoint(b)[1] < M.height);
});
