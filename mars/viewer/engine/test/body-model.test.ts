// The one body model (engine/body/model.ts) is the measured rig (OWNER_DECISIONS 2026-09-28 "Body model =
// the measured rig", POSES.md "Body model") and internally consistent: the stated reach numbers and the
// posture envelopes (shoulder band + lean + arm, `postureGap`) agree, the stated caps bind before the
// envelopes do, the posture bands follow from the rig's proportions, and the landmarks are within an arm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dcos, dsin } from '../core/math.ts';
import { BODY_MODEL as M, postureGap, proneAt, proneFrame, pronePoints, proneReachGap, bodyFrame, restHand, carryHand, shoulderPoint, chestPoint, mouthPoint, type Posture } from '../body/model.ts';
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

test('prone receiver + rise (owner feedback §13; W32): the model is the measured rig lying at the edge (woman template), bands derived from it and consistent through the rise', () => {
  const P = M.prone, R = M.rig, pz = P.posture;
  // measured (W29, e2e/prone.spec.ts, POSES.md "Prone receiver"): chest 0.097 (punk) – 0.102 (woman); Torso joint →
  // shoulders 0.27 / 0.19; tip joint 0.08 past the lip; lying hips 0.15; tipped 60° the shoulders −0.10 / −0.03 and the
  // reach straight down 0.80 / 0.73 m. The model is the woman (the smaller): every template reaches what it allows.
  assert.ok(P.chest >= 0.097 - 0.005 && P.chest <= 0.102 + 0.005, `chest ${P.chest}`);
  assert.equal(P.overEdge, 0.19, 'tip joint → shoulders: the woman template');
  assert.equal(P.tipPast, 0.08);
  assert.equal(P.tipUp, 0.15);
  assert.equal(P.girdle, 2 * M.shrug, 'the girdle reaches 2 × shrug (renderer GIRDLE 0.1)');
  // the construction reproduces the measured tipped shoulders for both templates (within 1 cm)
  const shoulderAtTip = (over: number, chest: number) => {
    const dz = chest - P.tipUp, d = Math.sqrt(over * over - dz * dz);
    return P.tipUp + dz * dcos(P.tipMax * DEG) - d * dsin(P.tipMax * DEG);
  };
  const woman = shoulderAtTip(0.19, 0.102), punk = shoulderAtTip(0.27, 0.097);
  assert.ok(Math.abs(woman - -0.03) <= 0.01 && Math.abs(punk - -0.1) <= 0.01, `tipped shoulders woman ${woman.toFixed(3)} punk ${punk.toFixed(3)}`);
  // reach straight down = shoulders + girdle + 0.97 × arm (the elbow never locks, as overhead): woman 0.73 = the cap
  const reach = (sh: number) => -sh + P.girdle + 0.97 * M.armLength;
  assert.equal(P.reachDown, Math.floor(reach(shoulderAtTip(P.overEdge, P.chest)) * 100) / 100);
  assert.equal(P.reachDown, 0.73);
  assert.ok(Math.abs(reach(woman) - 0.73) <= 0.02 && Math.abs(reach(punk) - 0.8) <= 0.02, `rig reach woman ${reach(woman).toFixed(3)} punk ${reach(punk).toFixed(3)}`);
  assert.ok(reach(punk) - P.reachDown >= 0.06, 'punk / casual reach ≥ 6 cm more (slack)');
  assert.ok(P.reachDown > M.reachDownBelowFeet + 0.2, 'prone reaches well below the kneel rule');
  // the band: lo = tipped shoulders − girdle (rounded), hi = lying flat; the cylinder reaches past the cap straight down
  assert.ok(Math.abs(pz.prone.lo - (shoulderAtTip(P.overEdge, P.chest) - P.girdle)) <= 0.005, `prone band bottom ${pz.prone.lo}`);
  assert.ok(Math.abs(pz.prone.hi - (P.chest + P.girdle)) < 1e-9, 'lying flat + girdle');
  assert.ok(M.armLength - pz.prone.lo >= P.reachDown, 'the cap binds before the envelope (as overheadMax)');
  // exact geometry: lying straight out, S 0.35 m behind the lip, a hand straight below a shoulder reaches the cap and not 3 cm more
  const out: [number, number] = [1, 0];
  const fr = proneFrame(FEET, out, out);
  assert.ok(Math.abs(fr.lip - P.back) < 1e-12 && fr.turn === 0 && fr.yaw === 0);
  const sh = pronePoints(fr, P.tipMax).shoulders[1];
  assert.ok(Math.abs(sh[1] - shoulderAtTip(P.overEdge, P.chest)) < 1e-9 && Math.abs(sh[2] - M.shoulderHalf) < 1e-9);
  assert.ok(sh[0] - P.back > 0.1 && sh[0] - P.back < 0.15, `tipped shoulders ${(sh[0] - P.back).toFixed(3)} m past the lip`);
  assert.ok(proneReachGap(fr, [sh[0], -P.reachDown, sh[2]], 'right').gap <= 0, 'reaches the cap below the shoulder');
  assert.ok(proneReachGap(fr, [sh[0], -P.reachDown - 0.03 - P.girdle, sh[2]], 'right').gap > 0, '… not 3 cm below arm + girdle');
  // 0.45 m past the lip (edgeReach) the shoulders still reach ≥ 0.6 m down (the tipped shoulders are 0.13 m past it)
  const at45 = (y: number) => proneReachGap(fr, [P.back + P.edgeReach, y, M.shoulderHalf], 'right').gap <= 0;
  assert.ok(at45(-0.6) && !at45(-0.72), '0.45 m out: 0.6 m down in reach, 0.72 not');
  // a hand 0.3 m to the side of the axis is 0.15 m from the shoulder: turning (proneYaw) is what brings the axis to it
  const side: Vec3 = [P.back + 0.2, -0.7, 0.45];
  assert.ok(proneReachGap(fr, side, 'right').gap > 0, 'straight out, a hand 0.45 m to the side 0.70 m down: out of reach');
  const turned = proneFrame(FEET, out, [dcos(30 * DEG), dsin(30 * DEG)]);
  assert.ok(Math.abs(turned.turn - 30 * DEG) < 1e-12 && turned.lip > P.back / dcos(30 * DEG), 'the lip lies farther along a turned body');
  assert.ok(proneReachGap(turned, side, 'right').gap <= 0, '… turned 30° toward it: in reach');
  // the cylinder bounds the exact envelope over every allowed turn (what the per-tick invariant can check without it)
  for (const tdeg of [-P.turnMax, -20, 0, 20, P.turnMax]) {
    const f = proneFrame(FEET, out, [dcos(tdeg * DEG), dsin(tdeg * DEG)]);
    for (let a = 0; a <= 1.6; a += 0.1) for (let sd = -0.6; sd <= 0.6; sd += 0.1) for (let y = -0.8; y <= 0.3; y += 0.1) {
      const h = proneAt(f, a, sd, y);
      if (proneReachGap(f, h, sd < 0 ? 'left' : 'right').gap <= 0 && -y <= P.reachDown) assert.ok(postureGap(pz.prone, FEET, h) <= 1e-9, `turn ${tdeg}° (${a.toFixed(1)}, ${sd.toFixed(1)}, ${y.toFixed(1)}) inside the exact reach, outside the cylinder`);
    }
  }
  assert.ok(P.back >= 0.28, 'S is standable: ≥ the spatial body radius (0.28 m) from the lip');
  assert.equal(P.edgeReach, M.reachDownOut);
  // the rise: push-up (one straight arm on the deck) → kneel-up (knees, torso rising) → stand (bentOver)
  assert.deepEqual([pz.pushUp.lo, pz.pushUp.lean], [pz.prone.lo, pz.prone.lean], 'push-up starts from prone');
  assert.equal(pz.pushUp.hi, M.armLength, 'push-up tops out an arm above the deck');
  assert.equal(pz.kneelUp.lo, M.posture.bentOver.lo, 'kneel-up: kneeling bent over the edge …');
  assert.ok(Math.abs(pz.kneelUp.hi - (R.kneelHip + R.torso)) < 1e-9, '… to kneeling upright');
  assert.equal(pz.kneelUp.lean, M.posture.bentOver.lean);
  assert.ok(pz.pushUp.hi >= pz.kneelUp.lo && pz.kneelUp.hi <= M.posture.bentOver.hi && pz.prone.hi <= pz.pushUp.hi, 'the shoulder bands overlap phase to phase');
  const H = P.hip;
  assert.ok(H.prone < H.pushUp && H.pushUp <= H.kneelUp && H.kneelUp < H.stand, 'hips rise monotonically');
  assert.deepEqual([H.pushUp, H.kneelUp, H.stand], [R.kneelHip, R.kneelHip, R.hip]);
  // the body lying at the edge: toes → lip, tip joint, torso and head fit a 1.75 m person
  assert.ok(Math.abs(P.bodyBack - (R.hip + 0.06 - (P.back - R.torso / 3))) < 1e-9);
  assert.ok(P.bodyBack + P.back + P.tipPast + P.overEdge + P.head.on + P.head.r <= M.height, 'lying body length ≤ height');
  // the deck hand (lying, pushing up) is inside every prone-phase envelope
  const deckHand: Vec3 = [P.deckHand.fwd, 0, P.deckHand.side];
  for (const [name, b] of Object.entries(pz)) assert.ok(postureGap(b, FEET, deckHand) <= 0, `deck hand inside ${name}`);
});
