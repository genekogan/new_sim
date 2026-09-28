// Camera self-correction (OWNER_FEEDBACK_2026-09-28 §11 layer 3, docs/engineering/CAMERA_DIRECT.md §7): every
// sample of a directed shot simulated against the take (people and parts per tick), failure modes detected, ranked
// corrections chosen deterministically and recorded — or the shot refused with everything tried.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { datan2, dcos, dsin, hypot, type Vec3 } from '../core/math.ts';
import { solarPosition, sunBehindWindow } from '../env/sun.ts';
import { CameraWorld } from '../camera/geom.ts';
import { FAILURE_LIMITS, freeSpace, scoreShot, type ShotSim } from '../camera/solve.ts';
import { STRATEGY_ORDER } from '../camera/correct.ts';
import { directCamera, MOTION_CAPS, sunInFrame, type DirectResult } from '../camera/synth.ts';
import { subjectPoints, type SubjectPose } from '../camera/shots.ts';
import { SemanticWorld } from '../camera/direct.ts';
import { beforeSunset, flagship, onGrid, personAt, roomScene, standingSheet, stepTimes, yardScene } from './camera-direct-fixtures.ts';

const DEG = Math.PI / 180;
function ok(r: DirectResult): Extract<DirectResult, { ok: true }> {
  assert.ok(r.ok, JSON.stringify(!r.ok && r.diagnostics));
  return r as Extract<DirectResult, { ok: true }>;
}
const caps = { viewOmegaDeg: MOTION_CAPS.viewOmegaDeg, viewAlphaDeg: MOTION_CAPS.viewAlphaDeg, speed: MOTION_CAPS.speedExterior, accel: MOTION_CAPS.accel };
const wrap = (a: number) => { let x = (a + Math.PI) % (2 * Math.PI); if (x < 0) x += 2 * Math.PI; return x - Math.PI; };

test('checks: squeeze is a sustained narrow gap (two sheets 0.8 m apart), not a door; foreground, flare, horizon, motion are per sample', () => {
  const { scene } = yardScene();
  const world = new CameraWorld(scene);
  const sheets = (gap: number) => ({ s1: standingSheet(0, gap / 2 + 0.0095, [1, 0]), s2: standingSheet(0, -gap / 2 - 0.0095, [1, 0]) });
  // free width across the camera between two standing sheets, against the take's part boxes
  const parts = (o: Record<string, SubjectPose>) => Object.entries(o).flatMap(([id, s]) => (s.occluders ?? []).map((b) => ({ id, b })));
  const fs8 = freeSpace(world, parts(sheets(0.8)), [0, 1.6, 0]);
  assert.ok(Math.abs(fs8.width - 0.8) < 0.01, `0.8 m gap: ${fs8.width}`);
  assert.deepEqual([...fs8.by].sort(), ['part s1', 'part s2']);
  assert.ok(freeSpace(world, parts(sheets(1.6)), [0, 1.6, 0]).width >= FAILURE_LIMITS.squeezeWidth, 'a 1.6 m door-width gap is not a squeeze');
  assert.equal(freeSpace(world, parts(sheets(0.8)), [0, 2.9, 0]).width, Infinity, 'above the sheets');
  const sim = (keys: ShotSim['keys'], sampler: ShotSim['sampler'], extra: Partial<ShotSim> = {}): ReturnType<typeof scoreShot> =>
    scoreShot({ world, sampler, keys, t0: 0, hz: 10, fov: 50, aspect: 16 / 9, subjects: [], caps, ...extra });
  // a dolly along the 1.22 m-wide gap: squeezed for > 0.3 m of travel → a failure; the same gap crossed at right angles
  // (a door's jambs, one sample) is a transient
  const along = Array.from({ length: 41 }, (_, i) => ({ t: i / 10, position: [-2 + i * 0.1, 1.6, 0] as Vec3, target: [-2 + i * 0.1 + 5, 1.6, 0] as Vec3 }));
  const a = sim(along, () => sheets(0.8));
  assert.equal(a.failures.length, 1);
  assert.equal(a.failures[0].kind, 'squeeze');
  assert.equal(a.failures[0].worst, 0.8);
  assert.ok(a.failures[0].samples >= 12 && a.failures[0].samples <= 14, `between the sheets for 1.22 m: ${a.failures[0].samples} samples`);
  const across = Array.from({ length: 41 }, (_, i) => ({ t: i / 10, position: [0, 1.6, -2 + i * 0.1] as Vec3, target: [0, 1.6, 3 + i * 0.1] as Vec3 }));
  const door = { j1: standingSheet(0.8 + 0.61, 0, [1, 0]), j2: standingSheet(-0.8 - 0.61, 0, [1, 0]) }; // 1.6 m opening
  assert.ok(sim(across, () => door).valid, 'through a 1.6 m opening');
  // foreground: a bystander 0.9 m in front of the lens over the subject; the subject itself never is
  const cam = { t: 0, position: [0, 1.7, 5] as Vec3, target: [0, 0.9, 0] as Vec3 };
  const people = { s1: personAt([0, 0, 0]), w1: personAt([0, 0, 4.1]) };
  const fg = sim([cam, { ...cam, t: 0.1 }, { ...cam, t: 0.2 }], () => people, { subjects: ['s1'] });
  assert.equal(fg.failures[0]?.kind, 'foreground');
  assert.ok(fg.samples[0].foreground!.cover >= 0.9 && fg.samples[0].foreground!.id === 'w1');
  assert.ok(sim([cam, { ...cam, t: 0.1 }, { ...cam, t: 0.2 }], () => people, { subjects: ['s1', 'w1'] }).failures.every((x) => x.kind !== 'foreground'), 'a subject is not a foreground blob');
  // flare: the sun on the optical axis, only when above the horizon and not hidden by the scene
  const up = { t: 0, position: [0, 1.7, 5] as Vec3, target: [0, 1.9, 0] as Vec3 }; // looking 2.3° up, into a low sun
  const onAxis: Vec3 = [0, 0.2, -5];
  const fl = sim([up], () => ({}), { sunDir: onAxis });
  assert.equal(fl.failures[0]?.kind, 'flare');
  assert.equal(fl.samples[0].sunOffAxisDeg, 0);
  assert.ok(sim([up], () => ({}), { sunDir: [0.7, 0.2, -5] }).valid, '8° off axis: no flare');
  assert.ok(sim([cam], () => ({}), { sunDir: [0, -0.1, -1] }).valid, 'a sun below the horizon never flares');
  const roofed = new CameraWorld({ ...scene, obstacles: [{ id: 'roof', kind: 'solid', label: 'roof', obb: { c: [0, 0], half: [19, 19], yaw: 0 }, y0: 2.5, y1: 2.6 }] }); // a 2.3° sun would slip under a small roof's edge
  assert.ok(scoreShot({ world: roofed, sampler: () => ({}), keys: [{ t: 0, position: [0, 1.7, 5], target: [0, 1.9, 0] }], t0: 0, hz: 10, fov: 50, aspect: 16 / 9, subjects: [], caps, sunDir: [0, 0.04, -1] }).valid, 'a sun behind the roof does not flare');
  // horizon: a look-at camera straight down has no horizon; an explicit roll tilts it
  assert.equal(sim([{ t: 0, position: [0, 10, 0.5], target: [0, 0, 0] }], () => ({})).failures[0]?.kind, 'horizon');
  assert.equal(sim([{ ...cam, roll: 3 * DEG }], () => ({})).failures[0]?.kind, 'horizon');
  // motion: a whip pan of 40°/s breaks the 20°/s cap
  const whip = Array.from({ length: 11 }, (_, i) => ({ t: i / 10, position: [0, 1.7, 0] as Vec3, target: [dsin(i * 4 * DEG) * 5, 1.7, -dcos(i * 4 * DEG) * 5] as Vec3 }));
  const w = sim(whip, () => ({}));
  assert.equal(w.failures[0]?.kind, 'motion');
  assert.ok(w.worst.maxOmegaDeg > 39 && w.worst.maxOmegaDeg < 41);
});

/** The stuck-between-plywood take: a dolly across the plot, with two sheets standing 0.8 m apart around its path. */
function plywoodTake() {
  const { scene, world } = yardScene();
  const dir = { subject: { kind: 'region', ref: 'plot' }, motion: { verb: 'dolly', distance: 6 }, framing: { side: 'south' }, duration: 8 };
  const raw = ok(directCamera([dir], { scene, world, sampler: () => ({}), duration: 30, correct: false }));
  const k = raw.shots[0].keys, a = k[0].position, b = k[k.length - 1].position, m = k[Math.floor(k.length / 2)].position;
  const L = hypot(b[0] - a[0], b[2] - a[2]), al: [number, number] = [(b[0] - a[0]) / L, (b[2] - a[2]) / L], n = [al[1], -al[0]];
  const sheets = { s1: standingSheet(m[0] + n[0] * 0.4095, m[2] + n[1] * 0.4095, al), s2: standingSheet(m[0] - n[0] * 0.4095, m[2] - n[1] * 0.4095, al) };
  return { scene, world, dir, raw, sheets, mid: m };
}

test('fixture "stuck between plywood": a dolly through two standing sheets 0.8 m apart → raise, recorded with the numbers', () => {
  const { scene, world, dir, raw, sheets, mid } = plywoodTake();
  assert.equal(mid[1], 1.7, 'phase 1 dollies at eye level, straight between the sheets (take parts do not collide in the planner)');
  assert.equal(raw.plan.report.invalidSamples, 0, 'the planner alone sees nothing wrong');
  const r = ok(directCamera([dir], { scene, world, sampler: () => sheets, duration: 30 }));
  assert.equal(r.shots.length, 1);
  const rep = r.report.shots[0];
  assert.equal(rep.corrections.length, 1);
  const c = rep.corrections[0];
  assert.equal(c.failure, 'squeeze');
  assert.ok(c.strategy === 'raise' || c.strategy === 'reroute');
  assert.equal(c.strategy, 'raise');
  assert.equal(c.params.heightOffset, 1, '+0.5 m still between the 2.44 m sheets; +1 m clears them by ≥ 0.3 m');
  assert.deepEqual(c.attempts.map((x) => [x.magnitude, x.result]), [[0.5, 'squeeze ×9'], [1, 'valid']]);
  assert.match(c.reason, /free width 0\.8 m between 'part s\d' and 'part s\d' \(< 1\.2 m\)/);
  assert.deepEqual(c.tried, [], 'raise is the first strategy');
  assert.equal(c.samples.count, 9);
  assert.ok('failures' in c.before && c.before.failingSamples === 9 && c.before.failures[0].worst === 0.8);
  assert.ok('failures' in c.after && c.after.valid && c.after.failingSamples === 0);
  assert.ok(rep.simulation!.valid);
  // the corrected dolly passes over the sheets (2.44 m tall), ≥ 0.3 m from their top edges
  for (const k of r.shots[0].keys) if (hypot(k.position[0] - mid[0], k.position[2] - mid[2]) < 0.61) assert.ok(k.position[1] > 2.44, `t=${k.t}: y ${k.position[1]}`);
  assert.ok(rep.simulation!.worst.minPartClearance >= FAILURE_LIMITS.partClearance, `part clearance ${rep.simulation!.worst.minPartClearance} m`);
  assert.equal(r.plan.report.invalidSamples + r.plan.report.sweptCrossings, 0);
  // deterministic: the same take and directions → the same track and the same record
  const again = ok(directCamera([dir], { scene, world, sampler: () => sheets, duration: 30 }));
  assert.equal(again.report.trackHash, r.report.trackHash);
  assert.equal(JSON.stringify(again.report.shots[0].corrections), JSON.stringify(rep.corrections));
});

test('fixture "behind a head": a bystander walks past the lens during a hold → raise (or swing), only the crossing flagged', () => {
  const { scene, world } = yardScene();
  const pair = { s1: personAt([-0.4, 0, 0]), s2: personAt([0.4, 0, 0.2]) };
  const facts = () => ({ s1: { task: 'talk', activity: 'idle' }, s2: { task: 'talk', activity: 'idle' }, w1: { task: 'errand', activity: 'walk' } });
  const dir = { subject: { kind: 'group', ref: 'talk' }, motion: { verb: 'hold' }, framing: { side: 'south' }, duration: 8 };
  const raw = ok(directCamera([dir], { scene, world, sampler: () => ({ ...pair, w1: personAt([10, 0, 10]) }), facts, duration: 30, correct: false }));
  const P = raw.shots[0].keys[0].position, T = raw.shots[0].keys[0].target;
  assert.ok(P[1] > 1.5 && P[1] < 2.1, `an eye-level hold: camera at ${P[1]} m`);
  const fl = hypot(T[0] - P[0], T[2] - P[2]), f = [(T[0] - P[0]) / fl, (T[2] - P[2]) / fl], lat = [-f[1], f[0]];
  // w1 walks 6 m across the view, 0.9 m in front of the lens, between t = 2 and 6 s
  const w1 = (t: number): Vec3 => { const s = -3 + 6 * Math.max(0, Math.min(1, (t - 2) / 4)); return [P[0] + f[0] * 0.9 + lat[0] * s, 0, P[2] + f[1] * 0.9 + lat[1] * s]; };
  const r = ok(directCamera([dir], { scene, world, sampler: (t) => ({ ...pair, w1: personAt(w1(t)) }), facts, duration: 30 }));
  const c = r.report.shots[0].corrections[0];
  assert.ok(c, 'corrected');
  assert.equal(c.failure, 'foreground');
  assert.ok(c.strategy === 'raise' || c.strategy === 'swing');
  assert.equal(c.strategy, 'raise');
  assert.equal(c.params.heightOffset, 0.5);
  assert.match(c.reason, /person w1 0\.\d+ m from the camera covers \d+% of the subject's frame region/);
  assert.ok(c.samples.t0 >= 2 && c.samples.t1 <= 6, `only while w1 crosses: ${c.samples.t0}–${c.samples.t1} s`);
  assert.ok('failures' in c.before && c.before.failures[0].worst >= 0.7, 'w1 covers ≥ 70 % of the pair at worst');
  assert.ok(r.report.shots[0].simulation!.valid);
  assert.ok(r.shots[0].keys.every((k) => Math.abs(k.position[1] - (P[1] + 0.5)) < 1e-9), 'the whole hold is lifted 0.5 m (a hold does not jump mid-shot)');
});

test('fixture "the group outgrows the frame": one of two people walks 5 m away mid-hold → widen (raise does not address framing)', () => {
  const { scene, world } = yardScene();
  const facts = () => ({ s1: { task: 'talk', activity: 'idle' }, s2: { task: 'talk', activity: 'idle' } });
  const sampler = (t: number) => ({ s1: personAt([-0.4, 0, 0]), s2: personAt([0.4 + 5 * Math.max(0, Math.min(1, (t - 2) / 4)), 0, 0]) });
  const dir = { subject: { kind: 'group', ref: 'talk' }, motion: { verb: 'hold' }, framing: { side: 'south' }, duration: 8 };
  const r = ok(directCamera([dir], { scene, world, sampler, facts, duration: 30 }));
  const c = r.report.shots[0].corrections[0];
  assert.equal(c.failure, 'frame');
  assert.equal(c.strategy, 'widen');
  assert.equal(c.params.distanceScale, 1.15);
  assert.deepEqual(c.tried.map((x) => [x.strategy, x.outcome]), [['raise', 'n/a']]);
  assert.ok(c.samples.t0 > 4 && c.samples.t1 === 8, `once s2 has walked off: ${c.samples.t0}–${c.samples.t1} s`);
  assert.ok('failures' in c.before && c.before.failures[0].worst === 0.5, 'at worst half the pair is out of frame');
  assert.equal(r.report.shots[0].simulation!.worst.minFramed, 1);
  const raw = ok(directCamera([dir], { scene, world, sampler, facts, duration: 30, correct: false }));
  const d0 = hypot(raw.shots[0].keys[0].position[0] - raw.shots[0].keys[0].target[0], raw.shots[0].keys[0].position[2] - raw.shots[0].keys[0].target[2]);
  const d1 = hypot(r.shots[0].keys[0].position[0] - r.shots[0].keys[0].target[0], r.shots[0].keys[0].position[2] - r.shots[0].keys[0].target[2]);
  assert.ok(Math.abs(d1 / d0 - 1.15) < 0.01, `distance ${d0.toFixed(2)} → ${d1.toFixed(2)} m`);
});

test('fixture "subject leaves frame": a 270° orbit of a crew that walks 6 m — the orbit centre follows, no correction; a fixed centre would fail', () => {
  const { scene, world } = yardScene();
  const crew = (t: number): Record<string, SubjectPose> => { const x = -3 + 6 * Math.max(0, Math.min(1, t / 45)); return { p1: personAt([x, 0, 0]), p2: personAt([x + 0.8, 0, 0.5]), p3: personAt([x - 0.6, 0, -0.6]) }; };
  const facts = () => ({ p1: { task: 'haul', activity: 'walk' }, p2: { task: 'haul', activity: 'walk' }, p3: { task: 'haul', activity: 'walk' } });
  const r = ok(directCamera([{ subject: { kind: 'group', ref: 'haul' }, motion: { verb: 'orbit', degrees: 270 } }], { scene, world, sampler: crew, facts, duration: 60 }));
  const shot = r.shots[0], rep = r.report.shots[0];
  assert.equal(shot.t1 - shot.t0, 45, '270° at the default 6°/s');
  assert.deepEqual(rep.corrections, [], 'no correction needed');
  assert.ok(rep.simulation!.valid && rep.simulation!.worst.minFramed === 1, JSON.stringify(rep.simulation!.worst));
  const k0 = shot.keys[0].target, k1 = shot.keys[shot.keys.length - 1].target;
  assert.ok(Math.abs(k1[0] - k0[0] - 6) < 0.6, `the orbit centre follows the crew: ${(k1[0] - k0[0]).toFixed(2)} m`);
  // the same orbit about the crew's starting centre: the check sees the crew walk out of the frame
  const fixed = shot.keys.map((k) => ({ t: k.t, position: [k0[0] + k.position[0] - k.target[0], k.position[1] - k.target[1] + k0[1], k0[2] + k.position[2] - k.target[2]] as Vec3, target: k0 }));
  const sc = scoreShot({ world: new CameraWorld(scene), sampler: crew, keys: fixed, t0: shot.t0, hz: 10, fov: shot.fov, aspect: 16 / 9, subjects: ['p1', 'p2', 'p3'], caps });
  assert.equal(sc.failures[0]?.kind, 'frame', JSON.stringify(sc.failures.map((x) => x.detail)));
  assert.ok(sc.failures[0].t0 > 10, `leaves the frame once it has walked: from ${sc.failures[0].t0} s`);
});

test('fixture "flare": a pan across the sun low in the west → swing within the sun-behind band, every sample ≥ 6° off axis', () => {
  const dt = beforeSunset('2026-03-20', 10);
  const sp = solarPosition(dt);
  assert.ok(sp.elevationDeg > 0 && sp.elevationDeg < 3 && Math.abs(sp.azimuthDeg - 270) < 5, `sun az ${sp.azimuthDeg}, el ${sp.elevationDeg}`);
  const { scene, world } = yardScene([], dt);
  const dir = { subject: { kind: 'region', ref: 'plot' }, motion: { verb: 'pan', degrees: 30 }, framing: { side: 'east' } }; // camera east of the plot, looking west into the sun
  const raw = ok(directCamera([dir], { scene, world, sampler: () => ({}), duration: 60, correct: false }));
  const off = (k: { position: Vec3; target: Vec3 }) => sunInFrame({ position: k.position, target: k.target, fov: raw.shots[0].fov }, sp.direction as Vec3, 16 / 9).offAxisDeg;
  const rawMin = Math.min(...raw.shots[0].keys.map(off));
  assert.ok(rawMin < 4, `the phase-1 pan crosses the sun: min ${rawMin}° off axis`);
  const r = ok(directCamera([dir], { scene, world, sampler: () => ({}), duration: 60 }));
  const c = r.report.shots[0].corrections[0];
  assert.equal(c.failure, 'flare');
  assert.equal(c.strategy, 'swing');
  assert.deepEqual(c.tried.map((x) => [x.strategy, x.outcome]), [['raise', 'n/a'], ['widen', 'n/a']], 'raise / widen do not address flare');
  assert.equal(c.params.bearingOffsetDeg, 20);
  assert.deepEqual(c.attempts, [{ magnitude: 10, result: 'flare ×16' }, { magnitude: -10, result: 'flare ×10' }, { magnitude: 20, result: 'valid' }], '±10° still cross the sun');
  assert.ok('failures' in c.before && c.before.failures[0].worst < 4, `the phase-1 pan passes ${'failures' in c.before ? c.before.failures[0].worst : '?'}° from the sun`);
  assert.match(c.reason, /limited to the sun-behind band/);
  const band = sunBehindWindow(dt, { vfovDeg: r.shots[0].fov, aspect: 16 / 9 }).cameraHeading;
  for (const k of r.shots[0].keys) {
    assert.ok(off(k) >= FAILURE_LIMITS.flareDeg, `t=${k.t}: ${off(k)}° off axis`);
    // camera heading from the plot centre (the origin), the band's convention
    assert.ok(Math.abs(wrap(datan2(k.position[2], k.position[0]) - band.centre)) <= band.halfWidth, `t=${k.t}: the camera stays in the sun-behind band`);
  }
  const inFrame = r.shots[0].keys.filter((k) => sunInFrame({ position: k.position, target: k.target, fov: r.shots[0].fov }, sp.direction as Vec3, 16 / 9).inFrame).length;
  assert.ok(inFrame / r.shots[0].keys.length > 0.5, `the sun stays in frame on ${inFrame}/${r.shots[0].keys.length} samples (a backlit pan, not flare)`);
});

test('fixture "impossible": a fly-through into a sealed room is refused with every strategy listed', () => {
  const dir = { subject: { kind: 'region', ref: 'room' }, motion: { verb: 'fly_through', from: [8, 1.6, 0] }, context: { interior: 'room' } };
  const r = directCamera([dir], { ...roomScene({ door: false, roof: true }), sampler: () => ({}), duration: 120 });
  assert.ok(!r.ok);
  const d = r.diagnostics[0];
  assert.equal(d.code, 'camera.nav.unreachable', 'the refusal keeps its cause');
  assert.match(d.message, /self-correction tried raise, widen, swing, reroute, shorten, split, cut: none gives a valid shot/);
  const tried = (d.details as any).corrections.tried as { strategy: string; outcome: string; attempts?: { result: string }[] }[];
  assert.deepEqual(tried.map((x) => x.strategy), STRATEGY_ORDER);
  assert.deepEqual(tried.map((x) => x.outcome), ['failed', 'n/a', 'n/a', 'failed', 'n/a', 'n/a', 'n/a']);
  assert.ok(tried[0].attempts!.length === 5 && tried[3].attempts!.length === 2);
  assert.ok([...tried[0].attempts!, ...tried[3].attempts!].every((a) => /^refused: camera\.nav\.unreachable$/.test(a.result)));
});

test('phase-1 flagship shots: the bay orbit (structure growing during it) and the carry-crew orbit are valid as computed — corrections []', () => {
  const { take, input } = flagship();
  const at = onGrid(stepTimes(take).get('seat_b1')!.start);
  const r = ok(directCamera([{ subject: { kind: 'assembly', ref: 'rack bay' }, motion: { verb: 'orbit', degrees: 270 }, duration: 120, at, framing: { size: 'wide' } }], input));
  const rep = r.report.shots[0];
  assert.deepEqual(rep.corrections, []);
  assert.ok(rep.simulation!.valid && rep.simulation!.samples === 1201, JSON.stringify(rep.simulation));
  assert.equal(rep.simulation!.worst.minFramed, 1, 'every in-place member framed on every sample, including the ones placed during the orbit');
  // the structure grows during the orbit: members arrive inside its final box (the frame check follows them)
  const bay = new SemanticWorld(input.scene, take.finalState, input.facts).assemblies.find((a) => a.id === 'structure:A')!;
  const inside = (q: Vec3) => [0, 1, 2].every((j) => q[j] >= bay.box!.min[j] - 0.25 && q[j] <= bay.box!.max[j] + 0.25);
  const inPlace = (t: number) => { const now = input.sampler(t); return bay.members!.filter((m) => now[m] && subjectPoints(now[m]).every(inside)).length; };
  assert.ok(inPlace(at + 120) > inPlace(at), `members in place: ${inPlace(at)} → ${inPlace(at + 120)}`);
  const carry = onGrid(stepTimes(take).get('carryA')!.start + 10);
  const g = ok(directCamera([{ subject: { kind: 'group', ref: 'carryA' }, motion: { verb: 'orbit', degrees: 90 }, at: carry, duration: 20 }], input));
  assert.deepEqual(g.report.shots[0].corrections, []);
  assert.ok(g.report.shots[0].simulation!.valid);
});
