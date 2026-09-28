// Trajectory synthesis by calculation (OWNER_FEEDBACK_2026-09-28 §11 layer 2, docs/engineering/CAMERA_DIRECT.md):
// computed tracks validated by the existing planner on the flagship take and on year scenes, verified
// independently (sun model, collision, geometry), deterministic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { datan, datan2, dtan, hypot, type Vec3 } from '../core/math.ts';
import { hashOf } from '../core/hash.ts';
import { solarPosition } from '../env/sun.ts';
import { CameraWorld, raycast } from '../camera/geom.ts';
import { placement } from '../camera/quality.ts';
import { subjectPoints } from '../camera/shots.ts';
import { pointInPolygon } from '../camera/direct.ts';
import { directCamera, MOTION_CAPS, type DirectResult } from '../camera/synth.ts';
import { beforeSunset, campus2024, campus2026, flagship, onGrid, roomScene, stepTimes, withTime } from './camera-direct-fixtures.ts';

const DEG = Math.PI / 180;
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const unit = (a: Vec3): Vec3 => { const l = hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
const angleDeg = (a: Vec3, b: Vec3) => { const u = unit(a), v = unit(b); const c = Math.min(1, Math.max(-1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2])); return datan2(Math.sqrt(1 - c * c), c) / DEG; };
function ok(r: DirectResult): Extract<DirectResult, { ok: true }> {
  assert.ok(r.ok, JSON.stringify(!r.ok && r.diagnostics));
  return r as Extract<DirectResult, { ok: true }>;
}
const inWindow = (plan: Extract<DirectResult, { ok: true }>['plan'], t0: number, t1: number) => plan.samples.filter((s) => s.t >= t0 - 1e-6 && s.t <= t1 + 1e-6);

test('(a) flagship: 270° orbit of the rack bay over 120 s with the crew moving inside — planner validators pass', () => {
  const { take, input } = flagship();
  const at = onGrid(stepTimes(take).get('seat_b1')!.start); // beams, joists, deck: the crew works in and around the bay
  const r = ok(directCamera([{ subject: { kind: 'assembly', ref: 'rack bay' }, motion: { verb: 'orbit', degrees: 270 }, duration: 120, at, framing: { size: 'wide' } }], input));
  const shot = r.shots[0];
  assert.equal(shot.t0, at);
  assert.equal(shot.t1, onGrid(at + 120));
  assert.equal(shot.keys.length, 1201);
  // the existing planner's validators: no invalid placement, no swept crossing, readability within its thresholds
  const rep = r.report.shots[0];
  assert.equal(r.plan.report.invalidSamples, 0);
  assert.equal(r.plan.report.sweptCrossings, 0);
  assert.equal(r.plan.report.rejected, false);
  assert.ok(rep.planner!.minReadability >= 0.6, `min readability ${rep.planner!.minReadability} (planner threshold 0.6)`);
  assert.ok(rep.planner!.readableFraction >= 0.95, `readable fraction ${rep.planner!.readableFraction}`);
  assert.equal(rep.validation.invalidSamples, 0);
  const win = inWindow(r.plan, at, at + 120);
  assert.equal(win.length, 1201);
  assert.ok(win.every((s) => s.key === 'desired' && s.valid), 'the computed move is used as is (alternates off)');
  // geometry: constant radius about the bay centre, 270° clockwise (seen from above: heading increases)
  const c = rep.params.centre as Vec3, R = rep.params.orbitRadius as number;
  let swept = 0, prev: number | null = null;
  for (const k of shot.keys) {
    assert.ok(Math.abs(hypot(k.position[0] - c[0], k.position[2] - c[2]) - R) < 0.02, `radius at t=${k.t}`);
    const h = datan2(k.position[2] - c[2], k.position[0] - c[0]);
    if (prev !== null) { let d = h - prev; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; assert.ok(d >= -1e-9, 'monotonic'); swept += d; }
    prev = h;
  }
  assert.ok(Math.abs(swept / DEG - 270) < 0.5, `swept ${swept / DEG}°`);
  assert.ok(R > 8 && R < 25, `radius from extent + lens: ${R}`);
  // the crew really moves inside the bay during the orbit
  const box = { min: [26.5, 0, -9.5] as Vec3, max: [31.5, 4, -5.8] as Vec3 };
  const inside = new Map<string, Vec3[]>();
  for (let t = at; t <= at + 120; t += 1) for (const [id, s] of Object.entries(input.sampler(t))) {
    if (s.kind !== 'human' || !/^p\d$/.test(id)) continue;
    if (s.p[0] > box.min[0] && s.p[0] < box.max[0] && s.p[2] > box.min[2] && s.p[2] < box.max[2]) { const l = inside.get(id) ?? []; l.push(s.p); inside.set(id, l); }
  }
  const movers = [...inside.entries()].filter(([, ps]) => ps.some((p) => hypot(p[0] - ps[0][0], p[2] - ps[0][2]) > 1));
  assert.ok(movers.length >= 2, `crew moving inside the bay: ${movers.map(([id]) => id).join(', ')}`);
  assert.ok((rep.params.peaks as any).viewOmegaDeg <= MOTION_CAPS.viewOmegaDeg);
});

test('(b) 2026: pan across Chiba with the sunset behind — every sample in the sun window (checked against solarPosition)', () => {
  const { scene, world } = campus2026();
  const at = beforeSunset('2026-03-01', 20);
  const r = ok(directCamera([{ subject: { kind: 'region', ref: 'chiba' }, motion: { verb: 'pan' }, context: { sunBehind: { sunset: true } } }], { scene, world: withTime(world, at), sampler: () => ({}), duration: 60 }));
  const sun = solarPosition(at);
  const halfH = datan(dtan(25 * DEG) * 16 / 9) / DEG; // horizontal half fov at vfov 50°, 16:9
  const samples = r.plan.samples;
  assert.ok(samples.length > 40);
  const p0 = samples[0].position;
  let minOff = Infinity;
  const heads: number[] = [];
  for (const s of samples) {
    assert.deepEqual(s.position, p0, 'a pan keeps the camera still');
    const v = sub(s.position, s.target);
    const camAz = ((datan2(v[0], -v[2]) / DEG) % 360 + 360) % 360; // compass bearing subject → camera (-Z north, +X east)
    let d = camAz - ((sun.azimuthDeg + 180) % 360);
    d = ((d + 540) % 360) - 180;
    assert.ok(Math.abs(d) <= halfH - 3 + 1e-6, `t=${s.t}: camera azimuth ${camAz.toFixed(1)}° is ${d.toFixed(1)}° from opposite-the-sun`);
    // the sun projects into the frame, above the optical axis, not on it
    const f = unit(sub(s.target, s.position));
    const off = angleDeg(f, sun.direction);
    minOff = Math.min(minOff, off);
    const rl = hypot(f[0], f[2]);
    const right: Vec3 = [-f[2] / rl, 0, f[0] / rl];
    const up: Vec3 = [right[1] * f[2] - right[2] * f[1], right[2] * f[0] - right[0] * f[2], right[0] * f[1] - right[1] * f[0]];
    const z = sun.direction[0] * f[0] + sun.direction[1] * f[1] + sun.direction[2] * f[2];
    const x = (sun.direction[0] * right[0] + sun.direction[2] * right[2]) / z / (dtan(25 * DEG) * 16 / 9);
    const y = (sun.direction[0] * up[0] + sun.direction[1] * up[1] + sun.direction[2] * up[2]) / z / dtan(25 * DEG);
    assert.ok(z > 0 && Math.abs(x) < 1 && y > 0 && y < 1, `t=${s.t}: sun at NDC (${x.toFixed(2)}, ${y.toFixed(2)})`);
    heads.push(datan2(f[2], f[0]) / DEG);
  }
  assert.ok(minOff >= 6 - 1e-6, `sun ≥ 6° off the optical axis (min ${minOff.toFixed(2)}°)`);
  assert.ok(Math.abs(heads[heads.length - 1] - heads[0]) > 20, 'it pans');
  assert.equal(r.plan.report.invalidSamples, 0);
  assert.equal(r.plan.report.sweptCrossings, 0);
  const sp = r.report.shots[0].params.sun as any;
  assert.equal(sp.samplesInWindow, sp.samples);
  assert.ok(r.report.shots[0].planner!.minReadability >= 0.6, 'the part of Chiba under the look point stays readable');
  // at the take's own 16:00 light (sun ~25° up) sun-behind still works: the camera looks up at it
  const r16 = ok(directCamera([{ subject: { kind: 'region', ref: 'chiba' }, motion: { verb: 'pan' }, context: { sunBehind: true } }], { scene, world, sampler: () => ({}), duration: 60 }));
  assert.equal((r16.report.shots[0].params.sun as any).samplesSunInFrame, r16.plan.samples.length);
  assert.equal(r16.plan.report.invalidSamples, 0);
});

test('(c) 2024: go inside the kitchen and face the sink — routed through the opening, never through a wall', () => {
  const { scene, world } = campus2024();
  const from: Vec3 = [8, 1.6, 36];
  const r = ok(directCamera([{ subject: { kind: 'region', ref: 'kitchen-interior' }, motion: { verb: 'fly_through', from }, context: { interior: 'kitchen-interior', lookAt: 'sink' } }], { scene, world, sampler: () => ({}), duration: 120 }));
  const shot = r.shots[0], rep = r.report.shots[0], p = rep.params as any;
  const cw = new CameraWorld(scene);
  const hit = raycast(cw, from, p.goal, 'collide');
  assert.ok(hit && /plywood wall/.test(hit.solid.o.label ?? ''), 'the straight line goes through the kitchen wall');
  assert.match(p.straightLineBlockedBy, /plywood wall/);
  shot.keys.forEach((k, i) => {
    assert.ok(placement(cw, k.position).valid, `t=${k.t}: ${placement(cw, k.position).reason}`);
    if (i) assert.equal(raycast(cw, shot.keys[i - 1].position, k.position, 'collide'), null, `t=${k.t}: move crosses geometry`);
  });
  assert.equal(r.plan.report.invalidSamples, 0);
  assert.equal(r.plan.report.sweptCrossings, 0);
  const room = world.regions['kitchen-interior'].polygon;
  const last = shot.keys[shot.keys.length - 1];
  assert.ok(!pointInPolygon(from[0], from[2], room) && pointInPolygon(last.position[0], last.position[2], room), 'starts outside, ends inside the kitchen');
  assert.match(p.entry.via, /^over 'plywood wall · Communal kitchen and lounge' \(top 1\.26 m\)$/, 'enters over the counter-height half wall (the scene has no door objects)');
  const sinkTop: Vec3 = p.lookAtPoint;
  assert.ok(Math.abs(sinkTop[0] - 5.07) < 0.05 && Math.abs(sinkTop[2] - 43) < 0.05, 'the sink');
  assert.ok(angleDeg(sub(last.target, last.position), sub(sinkTop, last.position)) < 1, 'faces the sink');
  assert.ok(hypot(last.position[0] - sinkTop[0], last.position[2] - sinkTop[2]) < 2.6);
  const pk = p.peaks;
  assert.ok(pk.speed <= MOTION_CAPS.speedInterior + 0.05 && pk.viewOmegaDeg <= MOTION_CAPS.viewOmegaDeg + 0.5 && pk.viewAlphaDeg <= MOTION_CAPS.viewAlphaDeg + 1, JSON.stringify(pk));
  assert.ok(rep.t1 - rep.t0 < 30, `a ${p.routeLength} m move in ${rep.t1 - rep.t0} s`);
  const end = inWindow(r.plan, rep.t1 - 2, rep.t1);
  assert.ok(end.every((s) => s.readability >= 0.6), 'the sink is readable at the end of the move');
});

test('group: the carry crew is orbited with the orbit centre following the group', () => {
  const { take, input } = flagship();
  const at = onGrid(stepTimes(take).get('carryA')!.start + 10);
  const r = ok(directCamera([{ subject: { kind: 'group', ref: 'carryA' }, motion: { verb: 'orbit', degrees: 90 }, at, duration: 20 }], input));
  const shot = r.shots[0];
  assert.deepEqual(r.report.shots[0].subject.ids, ['p1', 'p2']);
  let maxOff = 0;
  for (const k of shot.keys) {
    const now = input.sampler(shot.t0 + k.t);
    const pts = ['p1', 'p2'].flatMap((id) => subjectPoints(now[id]));
    const cx = pts.reduce((a, q) => a + q[0], 0) / pts.length, cz = pts.reduce((a, q) => a + q[2], 0) / pts.length;
    maxOff = Math.max(maxOff, hypot(k.target[0] - cx, k.target[2] - cz));
  }
  assert.ok(maxOff < 1.0, `look point stays on the moving group (max ${maxOff.toFixed(2)} m off)`);
  assert.equal(r.plan.report.invalidSamples, 0);
  assert.ok(r.report.shots[0].planner!.readableFraction >= 0.9, JSON.stringify(r.report.shots[0].planner));
});

test('navmesh: through the door; over an open-top wall on the flight layer; a sealed room is refused', () => {
  const dir = { subject: { kind: 'region', ref: 'room' }, motion: { verb: 'fly_through', from: [8, 1.6, 0] }, context: { interior: 'room' } };
  const door = roomScene({ door: true, roof: true });
  const r = ok(directCamera([dir], { ...door, sampler: () => ({}), duration: 120 }));
  const p = r.report.shots[0].params as any;
  assert.match(p.straightLineBlockedBy, /east wall/);
  assert.equal(p.usedFlightLayer, false);
  const keys = r.shots[0].keys;
  assert.ok(keys.some((k) => Math.abs(k.position[2] - 3) < 0.15 && Math.abs(k.position[0]) < 0.5 && k.position[1] < 1.8), 'passes through the door opening');
  assert.match(p.entry.via, /opening beside 'south wall (east|west) of the door'/);
  const cw = new CameraWorld(door.scene);
  keys.forEach((k, i) => { assert.ok(placement(cw, k.position).valid); if (i) assert.equal(raycast(cw, keys[i - 1].position, k.position, 'collide'), null); });
  assert.equal(r.plan.report.invalidSamples + r.plan.report.sweptCrossings, 0);
  // no door, no roof: over the 2.5 m wall on the flight layer
  const open = ok(directCamera([dir], { ...roomScene({ door: false, roof: false }), sampler: () => ({}), duration: 120 }));
  const po = open.report.shots[0].params as any;
  assert.equal(po.usedFlightLayer, true);
  assert.ok(Math.max(...open.shots[0].keys.map((k) => k.position[1])) > 2.8, 'clears the wall top + camera radius');
  assert.equal(open.plan.report.invalidSamples + open.plan.report.sweptCrossings, 0);
  // no door, roofed: no route (never through a wall)
  const sealed = directCamera([dir], { ...roomScene({ door: false, roof: true }), sampler: () => ({}), duration: 120 });
  assert.ok(!sealed.ok);
  assert.equal(sealed.diagnostics[0].code, 'camera.nav.unreachable');
});

test('motion caps: too-fast moves are refused with the minimum duration; defaults stay under the caps', () => {
  const { scene, world } = campus2026();
  const fast = directCamera([{ subject: { kind: 'region', ref: 'chiba' }, motion: { verb: 'pan' }, duration: 1 }], { scene, world, sampler: () => ({}), duration: 60 });
  assert.ok(!fast.ok);
  assert.equal(fast.diagnostics[0].code, 'camera.direct.motion-cap');
  assert.match(fast.diagnostics[0].message, /needs ≥ \d+(\.\d+)? s/);
  const late = directCamera([{ subject: { kind: 'region', ref: 'chiba' }, motion: { verb: 'hold' }, at: 58, duration: 5 }], { scene, world, sampler: () => ({}), duration: 60 });
  assert.ok(!late.ok && late.diagnostics[0].code === 'camera.direct.beyond-take');
  for (const motion of [{ verb: 'pan' }, { verb: 'tilt' }, { verb: 'orbit', degrees: 120 }, { verb: 'crane' }, { verb: 'dolly' }]) {
    const r = ok(directCamera([{ subject: { kind: 'region', ref: 'chiba' }, motion }], { scene, world, sampler: () => ({}), duration: 600 }));
    const pk = r.report.shots[0].params.peaks as any;
    assert.ok(pk.viewOmegaDeg <= MOTION_CAPS.viewOmegaDeg + 0.5 && pk.viewAlphaDeg <= MOTION_CAPS.viewAlphaDeg + 1 && pk.speed <= MOTION_CAPS.speedExterior + 0.05, `${motion.verb}: ${JSON.stringify(pk)}`);
  }
});

test('verbs: tilt / dolly / crane / pull_out / hold have the geometry their names promise, all valid', () => {
  const { scene, world } = campus2026();
  const run = (motion: object, extra: object = {}) => ok(directCamera([{ subject: { kind: 'region', ref: 'chiba' }, motion, ...extra }], { scene, world, sampler: () => ({}), duration: 600 }));
  const valid = (r: Extract<DirectResult, { ok: true }>) => assert.equal(r.plan.report.invalidSamples + r.plan.report.sweptCrossings, 0);
  const tilt = run({ verb: 'tilt' });
  valid(tilt);
  const tk = tilt.shots[0].keys;
  assert.ok(tk.every((k) => k.position.every((v, j) => v === tk[0].position[j])) && tk[tk.length - 1].target[1] > tk[0].target[1] + 1, 'tilt up: fixed camera, rising aim');
  const dolly = run({ verb: 'dolly', distance: 12 });
  valid(dolly);
  const dk = dolly.shots[0].keys;
  assert.ok(Math.abs(hypot(dk[dk.length - 1].position[0] - dk[0].position[0], dk[dk.length - 1].position[2] - dk[0].position[2]) - 12) < 0.05, 'dolly travels 12 m');
  assert.ok(angleDeg(sub(dk[0].target, dk[0].position), sub(dk[dk.length - 1].target, dk[dk.length - 1].position)) < 0.01, 'view direction held');
  const crane = run({ verb: 'crane', rise: 6 });
  valid(crane);
  const ck = crane.shots[0].keys;
  assert.ok(Math.abs(ck[ck.length - 1].position[1] - ck[0].position[1] - 6) < 1e-6 && ck.every((k, i) => !i || k.position[1] >= ck[i - 1].position[1] - 1e-9), 'crane up 6 m');
  const pull = run({ verb: 'pull_out' });
  valid(pull);
  const pk = pull.shots[0].keys, dist = (k: { position: Vec3; target: Vec3 }) => hypot(...sub(k.position, k.target));
  assert.ok(pk.every((k, i) => !i || dist(k) >= dist(pk[i - 1]) - 1e-9) && dist(pk[pk.length - 1]) > dist(pk[0]) + 5, 'pull_out: distance grows');
  const hold = run({ verb: 'hold' }, { duration: 3, framing: { size: 'close', side: 'south' } });
  valid(hold);
  const hk = hold.shots[0].keys;
  assert.equal(hk.length, 31);
  assert.ok(hk.every((k) => JSON.stringify(k.position) === JSON.stringify(hk[0].position)));
  const v = sub(hk[0].position, hk[0].target);
  const az = ((datan2(v[0], -v[2]) / DEG) % 360 + 360) % 360;
  assert.ok(Math.abs(az - 180) < 1, `side: south → camera due south of the subject (${az.toFixed(1)}°)`);
});

test('determinism: the same directions give the identical track hash, and the track round-trips through JSON', () => {
  const { take, input } = flagship();
  const d = [{ subject: { kind: 'assembly', ref: 'rack bay' }, motion: { verb: 'orbit', degrees: 270 }, duration: 120, at: onGrid(stepTimes(take).get('seat_b1')!.start), framing: { size: 'wide' } }];
  const a = ok(directCamera(d, input)), b = ok(directCamera(JSON.parse(JSON.stringify(d)), input));
  assert.equal(a.report.trackHash, b.report.trackHash);
  assert.equal(hashOf(JSON.parse(JSON.stringify(a.plan.samples))), a.report.trackHash);
  const { scene, world } = campus2024();
  const k = [{ subject: { kind: 'region', ref: 'kitchen-interior' }, motion: { verb: 'fly_through', from: [8, 1.6, 36] }, context: { interior: 'kitchen-interior', lookAt: 'sink' } }];
  const k1 = ok(directCamera(k, { scene, world, sampler: () => ({}), duration: 120 })), k2 = ok(directCamera(k, { scene, world, sampler: () => ({}), duration: 120 }));
  assert.equal(k1.report.trackHash, k2.report.trackHash);
  assert.deepEqual(k1.report, k2.report);
});
