import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BALLOON_RIDE,BALLOON,ROUTE,CARRIER,routePoint,routePose,routeSeconds,seatWorld,ridesFromEdge,flightSeconds,previewState,parseRideOverride,WorldBalloonRide} from '../src/WorldBalloonRide.ts';
import {DRIFTERS,drifterAt} from '../src/atmosphere/balloons.ts';
import {Terrain} from '../../../mars/viewer/app/engine-view/content/assets/eden-regions/terrain.ts';

test('the route data file and the renderer agree byte for byte on vehicles and routes', () => {
  const file = JSON.parse(readFileSync(new URL('../../../worlds/eden/rides/balloon-ride.v1.json', import.meta.url), 'utf8'));
  assert.equal(file.contract, BALLOON_RIDE.contract);
  assert.deepEqual(file.vehicles, JSON.parse(JSON.stringify(BALLOON_RIDE.vehicles)));
  assert.deepEqual(file.routes, JSON.parse(JSON.stringify(BALLOON_RIDE.routes)));
  assert.ok(Math.abs(ROUTE.minutes * 60 - routeSeconds(ROUTE)) < 30, 'minutes matches the route');
});

test('the flight leaves from and returns to the launch meadow, at rest, and never jumps', () => {
  const T = routeSeconds(ROUTE), L = ROUTE.launch.at;
  assert.deepEqual(routePoint(ROUTE, 0), [...L]); assert.deepEqual(routePoint(ROUTE, T), [...L]);
  for (const t of [0, T]) { const a = routePoint(ROUTE, Math.max(0, t - .5)), b = routePoint(ROUTE, Math.min(T, t + .5)); assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < .05, 'zero speed at launch and landing'); }
  let prev = routePose(ROUTE, 0).p, maxStep = 0;
  for (let t = .5; t <= T; t += .5) { const p = routePose(ROUTE, t).p; maxStep = Math.max(maxStep, Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2])); prev = p; }
  assert.ok(maxStep < 2.5, `max ${maxStep.toFixed(2)} m per half second`);
});

test('aloft the basket stays clear of terrain, rooftops and the drifting balloons', () => {
  const terrain = new Terrain(() => 0), T = routeSeconds(ROUTE);
  for (let t = 60; t <= T - 60; t += 2) {
    const {p} = routePose(ROUTE, t), inner = p[0] > -100 && p[0] < 105 && p[2] > -65 && p[2] < 85;
    const ground = inner ? 12 : Math.max(0, terrain.height(p[0], p[2]));
    assert.ok(p[1] - ground > 12, `t=${t} (${p[0].toFixed(0)},${p[2].toFixed(0)}) basket ${p[1].toFixed(1)} over ${ground.toFixed(1)}`);
    // the drifting balloons loop on their own clock, so check every point of every loop against the envelope centre
    if (t % 10 === 0) for (const d of DRIFTERS) for (let s = 0; s < d.period; s += 10) { const q = drifterAt(d, s); assert.ok(Math.hypot(q[0] - p[0], q[1] - (p[1] + 8.7), q[2] - p[2]) > 4.2 + d.s + 6, `near drifter at t=${t}`); }
  }
  // the landmarks Gene can see from the basket are actually passed
  const near = (x: number, z: number, r: number) => { for (let t = 0; t <= T; t += 2) { const {p} = routePose(ROUTE, t); if (Math.hypot(p[0] - x, p[2] - z) < r) return true; } return false; };
  assert.ok(near(-50, 0, 20), 'over the pond'); assert.ok(near(96, 188, 60), 'by the lighthouse'); assert.ok(near(184, 124, 40), 'by the ferris wheel');
});

test('seats sit inside the basket, side by side, facing out', () => {
  const basket = {p: [10, 50, -4], yaw: 1.1};
  const [a, b] = BALLOON.seats.map(s => seatWorld(basket, s));
  for (const s of [a, b]) {
    const dx = s.p[0] - 10, dz = s.p[2] + 4, f = dx * Math.cos(1.1) + dz * Math.sin(1.1), r = -dx * Math.sin(1.1) + dz * Math.cos(1.1);
    assert.ok(Math.abs(f) < BALLOON.basket.length / 2 - .25 && Math.abs(r) < BALLOON.basket.width / 2 - .2, 'inside the wicker with room for a body');
    assert.equal(s.p[1], 50, 'feet on the basket floor (Core floorY 0)');
  }
  assert.ok(Math.hypot(a.p[0] - b.p[0], a.p[2] - b.p[2]) > .5, 'two bodies do not overlap');
});

test('Core ride frames (EDGE-CONTRACT §7b) fold into one view per ride; latest wins; seats keep their order', () => {
  const ride = (tick: number, at: number, extra: Record<string, unknown>) => ({type: 'edge', kind: 'ride', tick, at, ride: {id: 'eden-balloon', def: 'hot-air-balloon', ...extra}});
  const rides = ridesFromEdge([
    ride(10, 1000, {phase: 'boarding', riders: [{seat: 'rider-b', entityId: 'h_b', soulId: 's_ben', name: 'Ben', phase: 'boarding'}], position: [-20, 0, -9], yaw: Math.PI, route: {id: 'eden-commons-loop', seconds: 1120, elapsedSeconds: 0}}),
    {type: 'edge', kind: 'object', objectKind: 'chess', object: 'chess-1', tick: 11, at: 1100, data: {phase: 'aloft'}},
    ride(30, 3000, {phase: 'aloft', holding: false, position: [-28, 25, -6], yaw: 2.9, riders: [{seat: 'rider-a', soulId: 's_ana'}, {seat: 'rider-b', soulId: 's_ben'}], route: {id: 'eden-commons-loop', elapsedSeconds: 40}}),
    ride(20, 2000, {phase: 'parked', riders: []}),
  ]);
  assert.equal(rides.size, 1);
  const v = rides.get('eden-balloon')!;
  assert.equal(v.phase, 'aloft'); assert.deepEqual(v.riders, ['s_ana', 's_ben']); assert.equal(v.carrier, 'eden-balloon'); assert.equal(v.elapsed, 40); assert.deepEqual(v.position, [-28, 25, -6]);
  ridesFromEdge([ride(31, 3500, {phase: 'aloft', route: {elapsedSeconds: 40.5}})], rides);
  assert.deepEqual(rides.get('eden-balloon')!.riders, ['s_ana', 's_ben'], 'riders kept when a frame omits them');
  assert.deepEqual(ridesFromEdge([ride(1, 1, {phase: 'boarding', riders: [{seat: 'rider-b', soulId: 's_ben'}]})]).get('eden-balloon')!.riders, ['', 's_ben'], 'seat b stays seat b');
  // flight time: Core's elapsedSeconds, advanced at most 2 s past the frame, frozen while holding, null on the ground
  const w = rides.get('eden-balloon')!;
  assert.equal(flightSeconds(w, 3500), 40.5); assert.equal(flightSeconds(w, 4000), 41); assert.equal(flightSeconds(w, 60000), 42.5);
  assert.equal(flightSeconds({...w, holding: true}, 60000), 40.5);
  assert.equal(flightSeconds({...w, phase: 'landed'}, 4000), null);
});

test('preview: ?ride=Alice,Bob boards, flies the route and lands', () => {
  assert.equal(parseRideOverride(''), null);
  assert.deepEqual(parseRideOverride('?ride=Alice,%20Bob&rideSpeed=8'), {names: ['alice', 'bob'], speed: 8});
  assert.equal(previewState(0, 10).phase, 'boarding'); assert.equal(previewState(2, 10).aboard, 1); assert.equal(previewState(5, 10).aboard, 2);
  const mid = previewState(8 + 56, 10); assert.equal(mid.phase, 'aloft'); assert.ok(Math.abs(mid.flight! - 560) < 1e-6);
});

test('riders not yet carried natively are seated at render time (step up, then follow the basket); carried riders are left alone', () => {
  const ride = new WorldBalloonRide();
  const at = {tick: 0, entities: {'e-ana': {p: [-18, 0, -9] as const, yaw: 0}, 'e-ben': {p: [-17, 0, -10] as const, yaw: 0}, 'e-cy': {p: [0, 0, 0] as const, yaw: 0}}};
  const soulEntity = (id: string) => ({s_ana: 'e-ana', s_ben: 'e-ben'} as Record<string, string>)[id] ?? null;
  const base = {dt: .2, eden: true, history: false, soulEntity};
  // boarding, step up: halfway along with an arc, then exactly in the seat
  let out = ride.update(at, {...base, seconds: 10, preview: {riders: ['s_ana'], phase: 'boarding', flight: null}});
  assert.notEqual(out, at); assert.equal(out.entities['e-cy'], at.entities['e-cy']); assert.equal(at.entities['e-ana'].p[0], -18, 'input untouched');
  out = ride.update(at, {...base, seconds: 10.6, preview: {riders: ['s_ana'], phase: 'boarding', flight: null}});
  const seatA = seatWorld({p: [...ROUTE.launch.at], yaw: ROUTE.launch.yaw}, BALLOON.seats[0]);
  assert.ok(out.entities['e-ana'].p[1] > .4, 'arc while stepping up');
  out = ride.update(at, {...base, seconds: 12, preview: {riders: ['s_ana', 's_ben'], phase: 'aloft', flight: 300}});
  const pose = routePose(ROUTE, 300), seatAir = seatWorld(pose, BALLOON.seats[0]);
  assert.ok(Math.hypot(out.entities['e-ana'].p[0] - seatAir.p[0], out.entities['e-ana'].p[1] - seatAir.p[1], out.entities['e-ana'].p[2] - seatAir.p[2]) < 1e-6, 'Ana rides in her seat');
  assert.ok(ride.basket.aloft && ride.basket.p[1] > 50); assert.equal(ride.tethers.visible, false);
  assert.ok(out.entities['e-ben'].p[1] > 50, 'Ben joined far below: no 80 m glide, he is simply aboard');
  assert.ok(seatA.p[1] < 1);
  // Core carriage: the basket follows the native entity `eden-balloon`; World never moves the (natively carried) riders
  assert.equal(CARRIER, 'eden-balloon');
  const carried = {tick: 0, entities: {'eden-balloon': {p: [5, 40, 5] as const, yaw: .5}, 'e-ana': {p: [0, 0, 0] as const, yaw: .85}}};
  const r2 = new WorldBalloonRide(); r2.ingest([{type: 'edge', kind: 'ride', tick: 1, at: 1, ride: {id: 'eden-balloon', phase: 'aloft', riders: [{seat: 'rider-a', soulId: 's_ana'}], route: {elapsedSeconds: 300}}}]);
  const o2 = r2.update(carried, {...base, seconds: 1, nowMs: 1});
  assert.equal(o2, carried); assert.deepEqual(r2.basket.p, [5, 40, 5]); assert.equal(r2.basket.yaw, .5); assert.equal(r2.flight(), 300);
  // no recording entity: Core's published position and yaw, eased between frames (never our own clock path)
  const r3 = new WorldBalloonRide(); r3.ingest([{type: 'edge', kind: 'ride', tick: 1, at: 1000, ride: {id: 'eden-balloon', phase: 'aloft', position: [-150, 75, 5], yaw: 2, route: {elapsedSeconds: 240}}}]);
  r3.update(at, {...base, seconds: 1, nowMs: 1000}); assert.deepEqual(r3.basket.p, [-150, 75, 5]); assert.equal(r3.basket.yaw, 2);
  r3.ingest([{type: 'edge', kind: 'ride', tick: 2, at: 1500, ride: {id: 'eden-balloon', phase: 'aloft', position: [-151, 75, 5], yaw: 2}}]);
  r3.update(at, {...base, seconds: 1.05, nowMs: 1550}); assert.ok(r3.basket.p[0] < -150 && r3.basket.p[0] > -151, 'glides toward the new frame');
  for (let i = 0; i < 60; i++) r3.update(at, {...base, seconds: 1.1 + i * .05, nowMs: 2000}); assert.ok(Math.abs(r3.basket.p[0] + 151) < 1e-3, 'arrives'); r3.dispose();
  // history and other worlds: no live ride overrides; outside Eden nothing is drawn
  assert.equal(r2.update(at, {...base, seconds: 2, history: true}), at);
  assert.equal(r2.update(at, {...base, seconds: 2, eden: false}), at); assert.equal(r2.group.visible, false);
  ride.dispose(); r2.dispose();
});

test('the ride asset is cheap: five meshes (BALLOON-BODY added the swinging gate), culled normally, never a camera or pick target', () => {
  const ride = new WorldBalloonRide(); let meshes = 0, tris = 0;
  ride.group.traverse(o => { const m = o as unknown as {isMesh?: boolean; geometry: {attributes: {position: {count: number}}; index: null | {count: number}}; userData: Record<string, unknown>; frustumCulled: boolean};
    if (!m.isMesh) return; meshes++; tris += (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3;
    assert.equal(m.userData.cameraTransparent, true); assert.equal(m.frustumCulled, true); });
  assert.equal(meshes, 5); assert.ok(tris < 3000, String(tris));
  ride.dispose();
});

test('a balloon rider stands with both hands on the rim (carrier activity "ride" is a standing overlay, never a gait)', async () => {
  const {activityFrame, activityBase, ACTIVITY_OVERLAYS} = await import('../../../mars/viewer/app/engine-view/activity-poses.ts');
  assert.ok(ACTIVITY_OVERLAYS.has('ride')); assert.equal(activityBase('ride'), 'idle');
  for (const s of [0, 7, 31]) { const f = activityFrame('ride', 'idle', s, 'soul-a')!; assert.ok(f.hands?.[0] && f.hands[1], 'both hands placed'); assert.ok(f.hands[0][2] < -0.3, 'hands down at the rim'); }
});
