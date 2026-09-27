// Camera planner regressions (SPEC §28: camera collision, camera readability,
// replay independence) on the proving ground with synthetic subject motion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { provingGround } from '../scenes/proving-ground.ts';
import type { Obstacle } from '../spatial/types.ts';
import { hashOf } from '../core/hash.ts';
import { CameraWorld } from '../camera/geom.ts';
import { placement, sweepCrossing, temporal, type TrackSample } from '../camera/quality.ts';
import { evaluateShot, type Sampler, type ShotSpec } from '../camera/shots.ts';
import { LiveSolver } from '../camera/solve.ts';
import { planCameraTrack, type CameraPlan } from '../camera/plan.ts';
import { sampleTrack, toCameraTrack, trackData } from '../camera/track.ts';
import { walker } from '../camera/samplers.ts';

/** Independent verification of a plan (does not trust the report). */
function verify(plan: CameraPlan, world: CameraWorld) {
  const inside = plan.samples.filter((s) => !placement(world, s.position).valid);
  const crossings = plan.samples.slice(1).filter((s, i) => !s.cut && sweepCrossing(world, plan.samples[i].position, s.position));
  return { inside: inside.length, crossings: crossings.length };
}

test('camera collision: path keyed through the test wall is corrected (no sample in solid, no swept crossing)', () => {
  const scene = provingGround();
  const world = new CameraWorld(scene);
  const spec: ShotSpec = { kind: 'path', keys: [{ t: 0, position: [-20, 1.5, -15], target: [-15, 1, -5] }, { t: 10, position: [-10, 1.5, -15], target: [-15, 1, -5] }] };
  const plan = planCameraTrack(spec, () => ({}), world, { duration: 10 });
  const r = plan.report;
  assert.ok(r.desired.invalidSamples > 0 && r.desired.sweptCrossings > 0, 'the desired path really enters/crosses the wall');
  assert.ok(r.reasons.some((x) => /crosses 'test wall'/.test(x)), r.reasons.join('\n'));
  assert.ok(r.reasons.some((x) => /desired shot: camera (inside|[\d.]+ m from) 'test wall'/.test(x)), r.reasons.join('\n'));
  assert.equal(r.invalidSamples, 0);
  assert.equal(r.sweptCrossings, 0);
  assert.equal(r.rejected, false);
  assert.deepEqual(verify(plan, world), { inside: 0, crossings: 0 });
  // getting past the wall needs an explicit correction (e.g. rising over it) and/or a deliberate cut
  assert.ok(r.corrections.length >= 1 || r.cuts.length >= 1);
  assert.ok(r.cuts.length <= 2, `cuts ${JSON.stringify(r.cuts)}`);
  assert.ok(plan.samples.every((s) => s.position[1] > 2.4 + 0.29 || Math.abs(s.position[0] + 15) > 0.44), 'never within clearance of the wall');
  console.log(`  wall path: corrections ${r.corrections.map((c) => `${c.key}@${c.t0}-${c.t1}s`).join(', ')}; cuts ${r.cuts.map((c) => `t=${c.t} ${c.from}→${c.to} (${c.reason})`).join('; ') || 'none'}`);
});

test('camera collision: impossible clearance is reported as rejection, not silently accepted', () => {
  const spec: ShotSpec = { kind: 'fixed', position: [-14, 1.5, -15], target: [-10, 1, -15] };
  const plan = planCameraTrack(spec, () => ({}), provingGround(), { duration: 1, minClear: 40 });
  assert.equal(plan.report.rejected, true);
  assert.ok(plan.report.reasons.some((x) => /^REJECTED: \d+ samples have no valid camera placement/.test(x)));
});

// p2 walks north into the U; a follow camera 9 m west ends up behind the U west wall.
const intoU = walker([[-15, 0], [-15, 13]]);
const occlusionSampler: Sampler = (t) => ({ p2: intoU(t) });
const followWest: ShotSpec = { kind: 'follow', subject: 'p2', offset: [-9, 1.5, 0], frame: 'world', lookHeight: 1.2 };

test('camera readability: subject walking behind U walls is reported; planner cuts to a readable alternate before occlusion', () => {
  const world = new CameraWorld(provingGround());
  const plan = planCameraTrack(followWest, occlusionSampler, world, { duration: 14 });
  const r = plan.report;
  assert.ok(r.desired.unreadableSamples > 20, `desired unreadable ${r.desired.unreadableSamples}`);
  const occ = r.reasons.find((x) => /desired shot: subject p2 \d+% occluded by 'U west wall'/.test(x));
  assert.ok(occ, r.reasons.join('\n'));
  // the plan stays readable, valid and never passes through walls
  assert.equal(r.invalidSamples, 0);
  assert.equal(r.sweptCrossings, 0);
  assert.deepEqual(verify(plan, world), { inside: 0, crossings: 0 });
  assert.ok(r.minReadability >= 0.6, `min readability ${r.minReadability}`);
  assert.ok(r.readableFraction >= 0.95);
  // lookahead: the camera leaves 'desired' before the desired shot becomes unreadable
  const tOcc = Number(/^t ([\d.]+)/.exec(occ!)![1]);
  const leave = r.cuts.find((c) => c.from === 'desired') ?? r.corrections.find((c) => c.key !== 'desired(pushed)');
  const tLeave = 't' in leave! ? leave!.t : (leave as { t0: number }).t0;
  assert.ok(tLeave > 0 && tLeave < tOcc, `left desired at ${tLeave}, occlusion starts ${tOcc}`);
  assert.ok(r.temporal.cutsPer2s <= 1 && r.temporal.oscillations.length === 0);
  console.log(`  U occlusion: desired unreadable from t=${tOcc}s; plan left 'desired' at t=${tLeave}s → ${r.corrections.map((c) => c.key).join(',')}; min readability ${r.minReadability.toFixed(2)}`);
  // the live (no-future) solver also finds a readable alternate at an occluded instant
  const t = 12;
  const live = new LiveSolver(world).step(t, evaluateShot(followWest, occlusionSampler, t), occlusionSampler(t), ['p2']);
  assert.ok(live.chosen.valid && live.chosen.read.score >= 0.6, `${live.chosen.key} ${live.chosen.read.score}`);
});

const pane: Obstacle = { id: 'plexi', obb: { c: [0, -5], half: [2, 0.02], yaw: 0 }, y0: 0, y1: 2.4, kind: 'glass', label: 'plexiglass pane' };

test('camera glass: subject behind plexiglass stays readable; the camera may not fly through it', () => {
  const world = new CameraWorld(provingGround({ extra: [pane] }));
  const s: Sampler = () => ({ p1: { p: [0, 0, -2], yaw: 0 } });
  const fixed = planCameraTrack({ kind: 'fixed', position: [0, 1.6, -10], target: [0, 1, -2], subjects: ['p1'] }, s, world, { duration: 3 });
  assert.equal(fixed.report.minReadability, 1);
  assert.equal(fixed.report.corrections.length, 0, 'no deocclusion needed through glass');
  const through: ShotSpec = { kind: 'path', subjects: ['p1'], keys: [{ t: 0, position: [0, 1.6, -10], target: [0, 1, -2] }, { t: 6, position: [0.3, 1.6, -3.5], target: [0, 1, -2] }] };
  const plan = planCameraTrack(through, s, world, { duration: 6 });
  assert.ok(plan.report.reasons.some((x) => /crosses 'plexiglass pane'/.test(x)), plan.report.reasons.join('\n'));
  assert.equal(plan.report.sweptCrossings, 0);
  assert.deepEqual(verify(plan, world), { inside: 0, crossings: 0 });
  assert.ok(plan.report.minReadability >= 0.6);
});

// Two mirror-image alternates (az±15) around a pillar; the subject sways so each is marginally better in turn.
const pillar: Obstacle = { id: 'pillar', obb: { c: [0, -4], half: [0.4, 0.4], yaw: 0 }, y0: 0, y1: 3, kind: 'solid', label: 'pillar' };
const sway: Sampler = (t) => ({ p1: { p: [0.5 * Math.sin(Math.PI * t), 0, 0], yaw: 0 } });
const blocked: ShotSpec = { kind: 'fixed', position: [0, 1.6, -8], target: [0, 1, 0], subjects: ['p1'] };
const symmetric = { variants: ['az+15', 'az-15'], minSize: 0.26 };

function runLive(world: CameraWorld, opts: ConstructorParameters<typeof LiveSolver>[1]) {
  const solver = new LiveSolver(world, opts);
  const out: TrackSample[] = [];
  for (let i = 0; i <= 100; i++) {
    const t = i / 10;
    const st = solver.step(t, evaluateShot(blocked, sway, t), sway(t), ['p1']);
    out.push({ t, ...st.chosen.pose, key: st.chosen.key, cut: i > 0 && st.switched });
  }
  return temporal(out);
}

test('camera temporal: hysteresis prevents oscillation between two equal alternatives over 10 s', () => {
  const world = new CameraWorld(provingGround({ extra: [pillar] }));
  const naive = runLive(world, { ...symmetric, hysteresis: 0, minHold: 0 });
  assert.ok(naive.oscillations.length >= 3, `control: greedy selector flips (${naive.keySwitches} switches)`);
  const held = runLive(world, symmetric);
  assert.equal(held.oscillations.length, 0);
  assert.ok(held.keySwitches <= 1, `switches ${held.keySwitches}`);
  const plan = planCameraTrack(blocked, sway, world, { duration: 10, ...symmetric });
  assert.equal(plan.report.temporal.oscillations.length, 0);
  assert.ok(plan.report.cuts.length <= 1);
  console.log(`  hysteresis: greedy ${naive.keySwitches} switches / ${naive.oscillations.length} oscillations; live+hysteresis ${held.keySwitches}; planner ${plan.report.cuts.length} cut(s)`);
});

test('camera determinism + CameraTrack payload round trip', () => {
  const scene = provingGround();
  const a = planCameraTrack(followWest, occlusionSampler, scene, { duration: 14 });
  const b = planCameraTrack(followWest, occlusionSampler, new CameraWorld(scene), { duration: 14 });
  assert.equal(hashOf(a), hashOf(b));
  const track = toCameraTrack('cam-1', 'take-1', a);
  const data = trackData(JSON.parse(JSON.stringify(track)));
  for (const s of data.samples.filter((_, i) => i % 17 === 0)) assert.deepEqual(sampleTrack(data, s.t).position, s.position);
  assert.throws(() => trackData({ ...track, data: {} }), /not mars-camera-track\/1/);
});
