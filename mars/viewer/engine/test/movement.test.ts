// Movement quality (owner feedback 2026-09-28 §2 splined turns, §3 immediate block reaction;
// docs/engineering/MOVEMENT.md): smoothed paths stay inside the corridor clearance, heading rate is
// bounded every tick, turning in place only beyond 120° and never past 180°, walk activity only while
// covering ground, obstacles appearing 0.4 m ahead stop the walker at once and a decision follows
// within 0.5 s, and the take metric "walk activity at < 0.05 m/s" is 0 on the flagship, stress-30 and
// the campfire evening.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS, SPEED_CAPS } from '../runtime/invariants.ts';
import { Spatial, entityCorners } from '../spatial/service.ts';
import { provingGround } from '../scenes/proving-ground.ts';
import { emptyWorld, human, addAll, component } from '../world/factory.ts';
import { walkTo, WALK_MIN, TURN_IN_PLACE, DECIDE_TICKS, encounterOf, WALK_SPEED_CAP } from '../locomotion/walk.ts';
import { smoothPolyline, denseClearance, filletCap, LAT_ACCEL, SHARP_CAP, type SmoothPath } from '../locomotion/spline.ts';
import { buildGrids, type LevelGrid } from '../spatial/grid.ts';
import { findRoute, PLAN_MARGIN, type WalkLeg } from '../spatial/path.ts';
import { HUMAN_PROFILE, type SpatialScene } from '../spatial/types.ts';
import { angleDelta, dist2, heading, sub2, type Vec2 } from '../core/math.ts';
import { seedRng, nextRandom } from '../core/rng.ts';
import { walkStallMeter, walkStallsOfTake } from '../take/metrics.ts';
import { TakeRecorder } from '../take/recorder.ts';
import { WorldHistory } from '../history/store.ts';
import { bindTemplate } from '../sequence/bind.ts';
import { rehearse } from '../rehearsal/rehearse.ts';
import { buildBayEntities, buildBayTemplate, buildBayBindings, buildBayRegistry, BUILD_BAY_INVARIANTS, BUILD_BAY_CONTRIBUTORS, type Site } from '../scenarios/build-bay.ts';
import { stress, buildRuntime } from '../../app/lab/scenarios.ts';
import { campfireEvening } from '../../app/lab/campfire-evening.ts';
import type { ActionDef } from '../actions/types.ts';
import { z } from 'zod';

const R = HUMAN_PROFILE.radius;
const PLAN_CLEAR = R + PLAN_MARGIN;
const smooth = (g: LevelGrid, pts: Vec2[]) => smoothPolyline(g, pts, { clearance: PLAN_CLEAR, speed: HUMAN_PROFILE.speed, turnRate: HUMAN_PROFILE.turnRate });

function setup(...people: ReturnType<typeof human>[]) {
  return setupWith([], ...people);
}
function setupWith(extra: ActionDef[], ...people: ReturnType<typeof human>[]) {
  const base = provingGround();
  const w = addAll(emptyWorld('proving-ground', base), ...people);
  return new Runtime(w, new Map<string, ActionDef>([['walk_to', walkTo], ...extra.map((d) => [d.verb, d] as [string, ActionDef])]), { spatial: new Spatial(base) }, DEFAULT_INVARIANTS);
}
const xz = (rt: Runtime, id: string): Vec2 => [rt.world.entities[id].pose.p[0], rt.world.entities[id].pose.p[2]];

/** Every smoothed piece keeps the clearance the raw polyline had (min over the leg, capped at the plan clearance). */
function assertSmoothClear(g: LevelGrid, raw: Vec2[], sm: SmoothPath, what: string) {
  let rawMin = Infinity;
  for (let i = 1; i < raw.length; i++) rawMin = Math.min(rawMin, denseClearance(g, raw[i - 1], raw[i]));
  for (const q of sm.segs) {
    const c = denseClearance(g, q.a, q.b);
    assert.ok(c >= Math.min(PLAN_CLEAR, rawMin) - 1e-9, `${what}: smoothed piece (${q.a.map((x) => x.toFixed(2))})→(${q.b.map((x) => x.toFixed(2))}) clearance ${c.toFixed(3)} < raw ${rawMin.toFixed(3)}`);
    assert.ok(c >= R || rawMin < R, `${what}: body would touch geometry`);
  }
  assert.deepEqual(sm.segs[0].a, raw[0], `${what}: starts where the corridor starts`);
  assert.deepEqual(sm.segs[sm.segs.length - 1].b, raw[raw.length - 1], `${what}: ends exactly at the goal`);
  for (const c of sm.corners) if (c.radius > 0) {
    const cap = filletCap(c.radius, HUMAN_PROFILE.speed, HUMAN_PROFILE.turnRate);
    assert.ok(cap <= Math.sqrt(LAT_ACCEL * c.radius) + 1e-12, 'lateral acceleration bounded on every fillet');
    if (c.radius < 0.6) assert.ok(cap < HUMAN_PROFILE.speed - 0.3, `a ${c.radius} m turn is only taken slowly (${cap.toFixed(2)} m/s)`);
  }
}

test('spline: proving-ground routes (wall, U-trap, 1 m passage, stairs approach, 150 seeded) stay inside the corridor clearance, turn on fillets, keep their endpoints', () => {
  const base = provingGround();
  const grids = buildGrids(base);
  const rng = seedRng('movement-spline');
  const u = () => nextRandom(rng);
  const named: [string, Vec2, Vec2][] = [['wall', [-18, -15], [-12, -15]], ['u-trap', [-15, 12], [-15, 20]], ['passage', [15, -20], [15, -10]], ['stairs approach', [3.5, 12.5], [3.5, 6]]];
  const cases = [...named, ...Array.from({ length: 150 }, (_, i) => [`seeded ${i}`, [-27 + u() * 54, -27 + u() * 54], [-27 + u() * 54, -27 + u() * 54]] as [string, Vec2, Vec2])];
  let corners = 0, filleted = 0, wide = 0;
  for (const [what, a, b] of cases) {
    const r = findRoute(grids, base, HUMAN_PROFILE, { level: 0, p: a }, { level: 0, p: b });
    if (!r.ok) continue;
    for (const leg of r.route.legs) {
      if (leg.kind !== 'walk' || leg.points.length < 2) continue;
      const g = grids.levels.get(leg.level)!;
      const sm = smooth(g, leg.points);
      assertSmoothClear(g, leg.points, sm, what);
      assert.deepEqual(smooth(g, leg.points), sm, 'deterministic');
      corners += sm.corners.length;
      filleted += sm.corners.filter((c) => c.radius > 0).length;
      wide += sm.corners.filter((c) => c.radius >= 0.6).length;
    }
  }
  assert.ok(corners > 50, `${corners} corners`);
  assert.equal(filleted, corners, 'every corner of these routes is walked on an arc');
  assert.ok(wide / corners > 0.85, `${wide}/${corners} corners have radius ≥ 0.6 m`);
});

const box = (id: string, x0: number, z0: number, x1: number, z1: number) => ({ id, obb: { c: [(x0 + x1) / 2, (z0 + z1) / 2] as Vec2, half: [(x1 - x0) / 2, (z1 - z0) / 2] as Vec2, yaw: 0 }, y0: 0, y1: 2, kind: 'solid' as const, label: id });
const openScene = (obstacles: ReturnType<typeof box>[]): SpatialScene => ({ bounds: [-5, -5, 5, 5], levels: [{ id: 0, y: 0, label: 'g' }], surfaces: [{ id: 'g', level: 0, y: 0, obb: { c: [0, 0], half: [5, 5], yaw: 0 } }], links: [], obstacles });
/** A 10 m long, 1.0 m wide corridor (walls x ∈ ±[0.5, 0.6], z ∈ [-5, 5]) on 20 × 24 m open ground: no room to step round anyone inside it. */
const corridorScene = (): SpatialScene => ({
  bounds: [-10, -12, 10, 12], levels: [{ id: 0, y: 0, label: 'g' }], surfaces: [{ id: 'g', level: 0, y: 0, obb: { c: [0, 0], half: [10, 12], yaw: 0 } }], links: [],
  obstacles: [box('corridor-w', -0.6, -5, -0.5, 5), box('corridor-e', 0.5, -5, 0.6, 5)],
});
function corridorRuntime(...people: ReturnType<typeof human>[]) {
  const base = corridorScene();
  return new Runtime(addAll(emptyWorld('corridor', base), ...people), new Map<string, ActionDef>([['walk_to', walkTo]]), { spatial: new Spatial(base) }, DEFAULT_INVARIANTS);
}

test('spline (adversarial): a post on the wide arcs forces a tighter or pushed-out fillet; short legs and a reversal stay sharp; clearance always holds', () => {
  // 90° left turn at V = (0, 0) from (-3, 0) to (0, 3), walls 0.45 m outside V. A 0.1 m post inside the
  // corner 0.65 m from V along the bisector lies on the R = 1.2 / 0.9 arcs (which would cut into it).
  const walls = [box('east', 0.45, -5, 5, 5), box('south', -5, -5, 0.45, -0.45)];
  const c = 0.65 / Math.SQRT2;
  const g = buildGrids(openScene([box('post', -c - 0.05, c - 0.05, -c + 0.05, c + 0.05), ...walls])).levels.get(0)!;
  const raw: Vec2[] = [[-3, 0], [0, 0], [0, 3]];
  assert.ok(denseClearance(g, raw[0], raw[1]) >= 0.34 && denseClearance(g, raw[1], raw[2]) >= 0.34, 'raw corridor is clear');
  const sm = smooth(g, raw);
  assertSmoothClear(g, raw, sm, 'post corner');
  assert.equal(sm.corners.length, 1);
  const free = buildGrids(openScene(walls)).levels.get(0)!;
  const wide = smooth(free, raw).corners[0];
  assert.deepEqual([wide.radius, wide.shift], [1.2, 0], 'without the post: the widest arc');
  assert.ok(sm.corners[0].radius > 0 && sm.corners[0].radius < 1.2, `with the post: radius ${sm.corners[0].radius} (the wide arcs are rejected)`);
  // legs too short for any fillet (0.3 m, 90°): the raw vertex stays, crossed at SHARP_CAP
  const short: Vec2[] = [[-3, 0], [0, 0], [0, 0.3], [3, 0.3]];
  const s2 = smooth(free, short);
  assert.equal(s2.corners[0].radius, 0);
  assert.ok(s2.segs.some((q) => dist2(q.b, [0, 0]) < 1e-12 && q.cap === SHARP_CAP), 'sharp vertex kept with its cap');
  assertSmoothClear(free, short, s2, 'short legs');
  // a near-reversal (170°) on 1 m legs: no fillet fits; the walker must stop there (cap 0) and turn in place
  const back: Vec2[] = [[-1, 0], [0, 0], [-0.985, 0.174]];
  const s3 = smooth(buildGrids(openScene([])).levels.get(0)!, back);
  assert.equal(s3.corners[0].radius, 0);
  assert.equal(s3.segs[0].cap, 0);
});

/** Per tick: yaw change, ground speed, the walk record's phase — for the heading-rate and animation checks. */
function track(rt: Runtime, id: string, rec: () => { phase?: string } | undefined) {
  const t = { dyaw: [] as number[], speed: [] as number[], phase: [] as (string | undefined)[], act: [] as string[], field: [] as (number | undefined)[], yaw: [] as number[] };
  let prev = { p: xz(rt, id), yaw: rt.world.entities[id].pose.yaw };
  rt.observers.push({
    onTick() {
      const e = rt.world.entities[id];
      const p = xz(rt, id);
      t.dyaw.push(angleDelta(prev.yaw, e.pose.yaw));
      t.yaw.push(e.pose.yaw);
      t.speed.push(dist2(p, prev.p) * 20);
      t.phase.push(rec()?.phase);
      t.act.push(e.human!.activity);
      t.field.push(e.human!.speed);
      prev = { p, yaw: e.pose.yaw };
    },
  });
  return t;
}

test('heading rate: never more than turnRate·dt per tick; in-place turns only beyond 120° and never past 180°; corners are walked, not pivoted', () => {
  const max = HUMAN_PROFILE.turnRate / 20 + 1e-9;
  const runs: [string, ReturnType<typeof human>, Vec2, number | undefined][] = [
    ['wall, aligned', human('p', -18, -15, { yaw: 0 }), [-12, -15], 0],
    ['u-trap', human('p', -15, 12, { yaw: -Math.PI / 2 }), [-15, 20], 0],
    ['passage', human('p', 15, -20, { yaw: Math.PI / 2 }), [15, -10], 0],
    ['wall, facing away (180°)', human('p', -18, -15, { yaw: Math.PI }), [-12, -15], undefined],
    ['open ground, 100° off', human('p', 0, -20, { yaw: 100 * Math.PI / 180 }), [5, -20], undefined],
  ];
  for (const [what, p, goal, maxTurnTicks] of runs) {
    const rt = setup(p);
    const a = rt.submit('walk_to', { actor: 'p', x: goal[0], z: goal[1] });
    assert.equal(a.status, 'executing', a.diagnostic?.message);
    const t = track(rt, 'p', () => a);
    assert.ok(rt.runUntilIdle(20 * 60));
    assert.equal(a.status, 'completed', `${what}: ${a.diagnostic?.message}`);
    assert.deepEqual(rt.violations, [], what);
    for (const d of t.dyaw) assert.ok(Math.abs(d) <= max, `${what}: heading jumped ${d.toFixed(3)} rad in one tick`);
    // in-place turn episodes (phase 'turn'): one direction, at most 180°, started only beyond TURN_IN_PLACE
    let ep: number[] = [];
    const episodes: number[][] = [];
    t.phase.forEach((ph, i) => { if (ph === 'turn') ep.push(i); else if (ep.length) { episodes.push(ep); ep = []; } });
    if (ep.length) episodes.push(ep);
    for (const e of episodes) {
      const sum = e.reduce((s, i) => s + t.dyaw[i], 0);
      assert.ok(Math.abs(sum) <= Math.PI + 1e-6, `${what}: turned ${sum.toFixed(2)} rad in place`);
      assert.ok(e.every((i) => Math.sign(t.dyaw[i]) === Math.sign(t.dyaw[e[0]]) || t.dyaw[i] === 0), `${what}: in-place turn reversed direction`);
      assert.ok(e.every((i) => t.speed[i] < 1e-6), `${what}: 'turn' ticks do not translate`);
    }
    if (maxTurnTicks !== undefined) assert.equal(episodes.flat().length, maxTurnTicks, `${what}: no turning on the spot at corners`);
    if (what.includes('180')) {
      assert.equal(episodes.length, 1, 'one in-place turn');
      const turned = Math.abs(episodes[0].reduce((s, i) => s + t.dyaw[i], 0));
      assert.ok(turned < Math.PI - TURN_IN_PLACE + 0.25, `turns in place only until the path is within 120° (${turned.toFixed(2)} rad), then walks while turning`);
    }
    if (what.includes('100°')) assert.equal(episodes.length, 0, 'a 100° start walks off while turning');
  }
});

test('curved footprints: at ≥ 1.0 m/s the walked path never turns tighter than ~0.6 m (wall and U-trap routes)', () => {
  for (const [p, goal] of [[human('p', -18, -15, { yaw: 0 }), [-12, -15]], [human('p', -15, 12, { yaw: -Math.PI / 2 }), [-15, 20]]] as [ReturnType<typeof human>, Vec2][]) {
    const rt = setup(p);
    const pts: Vec2[] = [xz(rt, 'p')];
    rt.observers.push({ onTick: () => pts.push(xz(rt, 'p')) });
    rt.submit('walk_to', { actor: 'p', x: goal[0], z: goal[1] });
    assert.ok(rt.runUntilIdle(20 * 60));
    // curvature over 4-tick chords (≈ 0.25 m at speed): the dense polyline's vertices are 0.1 m apart,
    // so single-tick chords would measure the discretisation, not the path
    let tightest = Infinity;
    const K = 4;
    for (let i = 2 * K; i < pts.length; i++) {
      let fast = true;
      for (let j = i - 2 * K + 1; j <= i; j++) if (dist2(pts[j - 1], pts[j]) * 20 < 1.0) fast = false;
      if (!fast) continue;
      const a = pts[i - 2 * K], b = pts[i - K], c = pts[i];
      const d1 = dist2(a, b), d2 = dist2(b, c);
      const turn = Math.abs(angleDelta(heading(sub2(b, a)), heading(sub2(c, b))));
      if (turn > 1e-6) tightest = Math.min(tightest, (d1 + d2) / 2 / turn);
      void turn;
    }
    assert.ok(tightest >= 0.55, `turn radius at walking speed ${tightest.toFixed(2)} m`);
  }
});

test("animation signal: activity 'walk' iff the body covers ≥ WALK_MIN m/s; human.speed published while walking, removed after", () => {
  const rt = setup(human('n1', 15, -20, { yaw: Math.PI / 2 }), human('s1', 15, -10, { yaw: -Math.PI / 2 }), human('p', -18, -15));
  const recs = [rt.submit('walk_to', { actor: 'n1', x: 15, z: -10.5 }), rt.submit('walk_to', { actor: 's1', x: 15, z: -19.5 }), rt.submit('walk_to', { actor: 'p', x: -12, z: -15 })];
  const ts = ['n1', 's1', 'p'].map((id, k) => track(rt, id, () => recs[k]));
  assert.ok(rt.runUntilIdle(20 * 90));
  for (const t of ts) {
    t.act.forEach((act, i) => {
      if (act === 'walk') assert.ok(t.speed[i] >= WALK_MIN - 1e-9, `walk at ${t.speed[i].toFixed(3)} m/s`);
      if (t.field[i] !== undefined) assert.ok(Math.abs(t.field[i]! - t.speed[i]) < 1e-3 + 1e-9, 'human.speed = ground speed of the tick');
    });
    assert.ok(t.act.includes('walk'));
  }
  assert.ok(ts.some((t) => t.act.includes('wait')), 'the yielding walker waits');
  for (const id of ['n1', 's1', 'p']) assert.equal(rt.world.entities[id].human!.speed, undefined, 'speed removed once the walk is over');
});

test('block reaction: a person appearing 0.4 m ahead inside a 1 m corridor → blocked within 2 ticks, no forward motion, decision (replan) within 0.5 s, never pushes', () => {
  const rt = corridorRuntime(human('n1', 0, -8, { yaw: Math.PI / 2 }));
  const a = rt.submit('walk_to', { actor: 'n1', x: 0, z: 8 });
  let n = 0;
  while (xz(rt, 'n1')[1] < -2 && n++ < 400) rt.step();
  const v0 = (rt.services.walkExecs as Map<string, { v: number }>).get(a.id)!.v;
  assert.ok(v0 > 1.2, `walking at speed (${v0.toFixed(2)} m/s) when the obstacle appears`);
  const z0 = xz(rt, 'n1')[1];
  const stranger = human('x', 0, z0 + 2 * R + 0.4, { yaw: -Math.PI / 2 });
  stranger.human!.task = 'holding-position'; // cannot be asked to make way
  rt.world.entities.x = stranger;
  const t0 = rt.tick;
  const meter = walkStallMeter(rt);
  let blockedAt = -1, decidedAt = -1, zAtBlock = 0;
  const ex = () => (rt.services.walkExecs as Map<string, { replans: number }>).get(a.id);
  const replans0 = ex()!.replans;
  for (let i = 0; i < 40; i++) {
    rt.step();
    if (blockedAt < 0 && a.status === 'blocked') {
      blockedAt = rt.tick;
      zAtBlock = xz(rt, 'n1')[1];
      assert.equal(a.diagnostic?.code, 'traffic.person');
      assert.ok(a.diagnostic?.subjects?.includes('x'), `names the person: ${a.diagnostic?.message}`);
    }
    else if (blockedAt >= 0 && decidedAt < 0) {
      if (a.phase === 'replan' || (ex()?.replans ?? replans0) > replans0) decidedAt = rt.tick;
      else assert.ok(xz(rt, 'n1')[1] <= zAtBlock + 1e-9, 'no forward motion while blocked');
    }
  }
  assert.ok(blockedAt > 0 && blockedAt - t0 <= 2, `first blocked tick ${blockedAt - t0} ticks after the obstacle appeared`);
  assert.ok(decidedAt > 0 && decidedAt - blockedAt <= DECIDE_TICKS + 1, `decision ${decidedAt - blockedAt} ticks after the block`);
  assert.ok(dist2(xz(rt, 'n1'), xz(rt, 'x')) >= 2 * R - 0.02, 'never inside their space');
  assert.ok(rt.runUntilIdle(20 * 90, [a.id]));
  assert.equal(a.status, 'completed', a.diagnostic?.message);
  assert.equal(a.outputs?.pushes, 0, 'the hard separation layer never had to cancel a step');
  assert.equal(meter.report.stalls, 0, JSON.stringify(meter.report.first));
  assert.deepEqual(rt.violations.map((v) => v.message), []);
});

test('block reaction: a panel placed 0.4 m ahead inside a 1 m corridor → replan within 2 ticks, no forward motion into it, arrives around it', () => {
  const rt = corridorRuntime(human('n1', 0, -8, { yaw: Math.PI / 2 }));
  const a = rt.submit('walk_to', { actor: 'n1', x: 0, z: 8 });
  const PZ = 0;
  // a plywood sheet standing on edge, turned so it spans the corridor (thin along z)
  const zExtent = (yaw: number) => {
    const e = component('panel', 'plywood-4x8', [0, 0, PZ], yaw, { phase: 'installed', pose: { p: [0, 0, PZ], yaw, roll: Math.PI / 2 } });
    const zs = entityCorners(e).map((q) => q[2]);
    return { e, half: (Math.max(...zs) - Math.min(...zs)) / 2 };
  };
  const [p0, p1] = [zExtent(0), zExtent(Math.PI / 2)];
  const { e: panel, half: halfZ } = p0.half < p1.half ? p0 : p1;
  assert.ok(halfZ < 0.05, `the sheet is thin along the corridor (${halfZ})`);
  let n = 0;
  while (xz(rt, 'n1')[1] + R + 0.4 < PZ - halfZ - 0.07 && n++ < 400) rt.step();
  const z0 = xz(rt, 'n1')[1];
  assert.ok(Math.abs(PZ - halfZ - (z0 + R) - 0.4) < 0.08, `panel face ${(PZ - halfZ - (z0 + R)).toFixed(2)} m ahead of the body`);
  rt.world.entities.panel = panel;
  const t0 = rt.tick;
  let reactedAt = -1;
  const ex = () => (rt.services.walkExecs as Map<string, { replans: number }>).get(a.id);
  const replans0 = ex()!.replans;
  for (let i = 0; i < 30; i++) {
    rt.step();
    if (reactedAt < 0 && (a.status === 'blocked' || (ex()?.replans ?? replans0) > replans0)) reactedAt = rt.tick;
    assert.ok(xz(rt, 'n1')[1] <= z0 + 0.07 + 1e-9, `no forward motion into the panel (moved ${(xz(rt, 'n1')[1] - z0).toFixed(3)} m)`);
  }
  assert.ok(reactedAt > 0 && reactedAt - t0 <= 2, `reaction ${reactedAt - t0} ticks after placement`);
  assert.ok(rt.runUntilIdle(20 * 120, [a.id]));
  assert.equal(a.status, 'completed', a.diagnostic?.message);
  assert.deepEqual(rt.violations.map((v) => v.message), []);
});

test('head-on in the 1 m passage: both walkers get through, nobody pushes, nobody walks on the spot', () => {
  for (const [zs, zn] of [[-20, -10], [-18, -12]]) {
    const rt = setup(human('n1', 15, zs, { yaw: Math.PI / 2 }), human('s1', 15, zn, { yaw: -Math.PI / 2 }));
    const meter = walkStallMeter(rt);
    const a = rt.submit('walk_to', { actor: 'n1', x: 15, z: zn - 0.5 });
    const b = rt.submit('walk_to', { actor: 's1', x: 15, z: zs + 0.5 });
    assert.ok(rt.runUntilIdle(20 * 90));
    assert.equal(a.status, 'completed', a.diagnostic?.message);
    assert.equal(b.status, 'completed', b.diagnostic?.message);
    assert.equal(a.outputs?.pushes, 0);
    assert.equal(b.outputs?.pushes, 0);
    assert.equal(meter.report.stalls, 0, JSON.stringify(meter.report.first));
    assert.deepEqual(rt.violations.map((v) => v.message), []);
  }
});

test('stall metric: the take computation equals the live meter; a deliberately faked walk-in-place is counted', () => {
  // a bogus verb that claims 'walk' while standing still for 10 ticks (what the owner saw)
  const fake = {
    verb: 'moonwalk', description: 'test only', schema: z.strictObject({ actor: z.string() }),
    reservations: (_w: unknown, p: { actor: string }) => [{ resource: `actor:${p.actor}`, mode: 'exclusive' as const }],
    plan: () => ({ ok: true as const, program: null }),
    start: (_rt: Runtime, p: { actor: string }) => ({ n: 0, actor: p.actor }),
    step: (r: Runtime, ex: { n: number; actor: string }) => { r.world.entities[ex.actor].human!.activity = 'walk'; return ++ex.n >= 10 ? { status: 'completed' as const } : { status: 'running' as const }; },
    cancel: () => ({ ok: true as const }),
  } as unknown as ActionDef;
  const rt = setupWith([fake], human('n1', 15, -20, { yaw: Math.PI / 2 }), human('s1', 15, -10, { yaw: -Math.PI / 2 }));
  const rec = new TakeRecorder(rt, { rulesVersion: 'test' });
  const meter = walkStallMeter(rt);
  rt.submit('walk_to', { actor: 'n1', x: 15, z: -10.5 });
  rt.submit('walk_to', { actor: 's1', x: 15, z: -19.5 });
  assert.ok(rt.runUntilIdle(20 * 90));
  const take = rec.finish();
  const fromTake = walkStallsOfTake(take);
  assert.equal(fromTake.stalls, 0);
  assert.equal(meter.report.stalls, 0);
  assert.ok(Math.abs(fromTake.walkTicks - meter.report.walkTicks) <= 2, `${fromTake.walkTicks} vs ${meter.report.walkTicks}`);
  const r2 = setupWith([fake], human('m', 0, 0));
  const rec2 = new TakeRecorder(r2, { rulesVersion: 'test' });
  const m2 = walkStallMeter(r2);
  assert.equal(r2.submit('moonwalk', { actor: 'm' }).status, 'executing');
  assert.ok(r2.runUntilIdle(40));
  assert.ok(m2.report.stalls >= 9, `live meter counts the fake (${m2.report.stalls})`);
  assert.ok(walkStallsOfTake(rec2.finish()).stalls >= 9, 'take metric counts the fake');
});

// ---- the take metric on the three scenes the owner named (bound achieved: exactly 0) -------------

test('stall metric = 0: build-bay flagship rehearsal take, lab stress-30 (60 s), campfire evening (75 s)', () => {
  // build-bay flagship on open ground (as build-bay.test.ts)
  const ground = (): SpatialScene => ({ bounds: [-20, -15, 15, 15], levels: [{ id: 0, y: 0, label: 'ground' }], surfaces: [{ id: 'ground', level: 0, y: 0, obb: { c: [-2.5, 0], half: [17.5, 15], yaw: 0 } }], obstacles: [], links: [] });
  const site: Site = { origin: [0, 0], yaw: 0 };
  const h = new WorldHistory('mars-rules/flagship-test');
  h.publishCanonical('canon', 'Open ground', addAll(emptyWorld('open-ground', ground()), ...buildBayEntities(site)), 'movement metric');
  h.fork('canon', 'ws', 'ws');
  const plan = bindTemplate(buildBayTemplate(site), buildBayBindings, { history: h, baseline: 'ws', registry: buildBayRegistry() });
  const reh = rehearse(h, 'ws', plan, { registry: buildBayRegistry(), invariants: BUILD_BAY_INVARIANTS, services: () => ({ spatial: new Spatial(ground(), { contributors: BUILD_BAY_CONTRIBUTORS }) }) });
  assert.equal(reh.report.status, 'completed');
  const bay = walkStallsOfTake(reh.take);
  // stress-30 and the campfire evening, stepped as the lab steps them
  const s = stress(30);
  const srt = buildRuntime(s);
  s.start(srt);
  const sm = walkStallMeter(srt);
  for (let i = 0; i < 20 * 60; i++) { srt.step(); s.tick!(srt); }
  const f = campfireEvening;
  const frt = buildRuntime(f);
  f.start(frt);
  const fm = walkStallMeter(frt);
  while (!f.done!(frt)) { frt.step(); f.tick!(frt); }
  console.log(`walk stalls (< 0.05 m/s with activity walk): build-bay ${bay.stalls}/${bay.walkTicks}, stress-30 ${sm.report.stalls}/${sm.report.walkTicks}, campfire ${fm.report.stalls}/${fm.report.walkTicks} person-ticks`);
  assert.equal(bay.stalls, 0, JSON.stringify(bay.first));
  assert.equal(sm.report.stalls, 0, JSON.stringify(sm.report.first));
  assert.equal(fm.report.stalls, 0, JSON.stringify(fm.report.first));
  assert.ok(bay.walkTicks > 5000 && sm.report.walkTicks > 20000 && fm.report.walkTicks > 2000, 'people really walked');
  assert.deepEqual(srt.violations, []);
  assert.deepEqual(frt.violations, []);
});

// W15 (2026-09-28, OWNER_FEEDBACK §3 "decide within ≤ 0.5 s"): a person standing still in the way is
// routed around within DECIDE_TICKS of the walker stopping, whatever they are doing; a person who is
// walking is waited for (followed), not routed around.
test('stationary blocker (warm / idle / sit, speed 0) in a 1 m corridor → replan around within DECIDE_TICKS; no forward motion before it; never pushes', () => {
  for (const activity of ['warm', 'idle', 'sit'] as const) {
    const x = human('x', 0, 1, { yaw: 0 });
    x.human!.activity = activity;
    x.human!.task = 'holding-position'; // a directed task: cannot be asked to make way
    const rt = corridorRuntime(human('n1', 0, -8, { yaw: Math.PI / 2 }), x);
    const a = rt.submit('walk_to', { actor: 'n1', x: 0, z: 8 });
    const ex = () => (rt.services.walkExecs as Map<string, { replans: number }>).get(a.id);
    let blockedAt = -1, decidedAt = -1, zAtBlock = 0;
    for (let i = 0; i < 20 * 20 && decidedAt < 0; i++) {
      rt.step();
      if (blockedAt < 0 && a.status === 'blocked') {
        blockedAt = rt.tick;
        zAtBlock = xz(rt, 'n1')[1];
        assert.equal(a.diagnostic?.code, 'traffic.person');
        assert.deepEqual(a.diagnostic?.subjects, ['n1', 'x']);
      } else if (blockedAt >= 0) {
        if (a.phase === 'replan' || (ex()?.replans ?? 0) > 0) decidedAt = rt.tick;
        else assert.ok(xz(rt, 'n1')[1] <= zAtBlock + 1e-9, `${activity}: no forward motion while blocked`);
      }
    }
    assert.ok(blockedAt > 0, `${activity}: the walker stopped for x`);
    assert.ok(decidedAt > 0 && decidedAt - blockedAt <= DECIDE_TICKS, `${activity}: routed around ${decidedAt - blockedAt} ticks after stopping (≤ ${DECIDE_TICKS})`);
    assert.equal(rt.world.entities.x.human!.speed ?? 0, 0);
    assert.ok(rt.runUntilIdle(20 * 90, [a.id]));
    assert.equal(a.status, 'completed', a.diagnostic?.message);
    assert.equal(a.outputs?.replans, 1, `${activity}: one replan (round the corridor)`);
    assert.equal(a.outputs?.pushes, 0);
    assert.deepEqual(rt.violations.map((v) => v.message), []);
  }
});

test('moving blocker: a walker catching up with a slower walker in the 1 m corridor follows it, never routes around it', () => {
  const rt = corridorRuntime(human('lead', 0, -4.5, { yaw: Math.PI / 2 }), human('n1', 0, -8, { yaw: Math.PI / 2 }));
  const meter = walkStallMeter(rt);
  const lead = rt.submit('walk_to', { actor: 'lead', x: 0, z: 6, speed: 0.3 });
  const a = rt.submit('walk_to', { actor: 'n1', x: 0, z: 8 });
  let waited = 0, gap = Infinity;
  while (lead.status !== 'completed' && rt.tick < 20 * 60) {
    rt.step();
    if (a.status === 'blocked') {
      waited++;
      assert.equal(a.diagnostic?.code, 'traffic.person');
      assert.ok(a.diagnostic?.subjects?.includes('lead'));
    }
    assert.equal((rt.services.walkExecs as Map<string, { replans: number }>).get(a.id)?.replans ?? 0, 0, `no replan round a walker who keeps walking (tick ${rt.tick})`);
    gap = Math.min(gap, dist2(xz(rt, 'n1'), xz(rt, 'lead')));
  }
  assert.equal(lead.status, 'completed');
  assert.ok(waited > 0, 'it did catch up and wait behind');
  assert.ok(gap >= 2 * R - 0.02, `kept its distance (${gap.toFixed(3)} m)`);
  assert.ok(rt.runUntilIdle(20 * 60, [a.id]));
  assert.equal(a.status, 'completed', a.diagnostic?.message);
  assert.equal(a.outputs?.replans, 0);
  assert.equal(a.outputs?.pushes, 0);
  assert.equal(meter.report.stalls, 0, JSON.stringify(meter.report.first));
  assert.deepEqual(rt.violations.map((v) => v.message), []);
});

test('campfire evening: x1 (take_slot at 42 s) decides within DECIDE_TICKS of stopping behind the ring, without flickering between walking and blocked, and is warm by 60 s', () => {
  const f = campfireEvening;
  const rt = buildRuntime(f);
  f.start(rt);
  let rec: { id: string; status: string; phase?: string } | undefined;
  let firstBlocked = -1, decided = -1, flips = 0, last = '', warmAt = -1;
  while (rt.tick < 20 * 62 && warmAt < 0) {
    rt.step();
    f.tick!(rt);
    rec ??= [...rt.records.values()].find((r) => r.verb === 'walk_to' && (r.params as { actor: string }).actor === 'x1');
    if (rec && decided < 0) {
      if (rec.status === 'blocked' && firstBlocked < 0) firstBlocked = rt.tick;
      if (firstBlocked >= 0 && rec.phase === 'replan') decided = rt.tick;
      if (firstBlocked >= 0 && rec.status !== last) flips++;
      last = rec.status;
    }
    if (rt.world.entities.x1.human!.activity === 'warm') warmAt = rt.tick;
  }
  assert.ok(rec, 'x1 walked');
  if (firstBlocked >= 0) {
    assert.ok(decided > 0 && decided - firstBlocked <= DECIDE_TICKS, `decided ${decided - firstBlocked} ticks after stopping (was 79: the block flickered, resetting the clock)`);
    assert.ok(flips <= 2, `${flips} blocked/walking flips before deciding`);
  }
  assert.ok(warmAt > 0 && warmAt <= 20 * 60, `x1 warm at ${(warmAt / 20).toFixed(1)} s`);
  assert.deepEqual(rt.violations, []);
});

test('squeezed people-replan: routing round everyone fails (people crowd the goal), routing round everyone planned smaller succeeds — the walker replans within DECIDE_TICKS and arrives, never inside anyone\'s space', () => {
  const still = (id: string, x: number, z: number) => {
    const h = human(id, x, z, { yaw: 0 });
    h.human!.activity = 'warm';
    h.human!.task = 'holding-position';
    return h;
  };
  // x blocks the corridor; f1 / f2 stand 0.66 m either side of the goal (room for a body between them,
  // but as planning obstacles they leave the goal no standing room: route.goal-blocked names them; squeezed
  // (walk.ts SQUEEZE_HALF) the goal snaps to the nearest plannable spot, which walk_to reports)
  const rt = corridorRuntime(human('n1', 0, -8, { yaw: Math.PI / 2 }), still('x', 0, 1), still('f1', -0.66, 8), still('f2', 0.66, 8));
  const sp = rt.services.spatial as Spatial;
  const calls: string[] = [];
  const orig = sp.routeAround.bind(sp);
  sp.routeAround = (...args: Parameters<Spatial['routeAround']>) => {
    const r = orig(...args);
    calls.push(`${args[4].map((q) => q.id).join('+')}${args[4].some((q) => q.half !== undefined) ? ' (squeezed)' : ''}: ${r.ok ? 'ok' : `${r.diagnostic.code} ${r.diagnostic.subjects?.join(',')}`}`);
    return r;
  };
  const a = rt.submit('walk_to', { actor: 'n1', x: 0, z: 8 });
  let blockedAt = -1, decidedAt = -1;
  while (decidedAt < 0 && rt.tick < 20 * 20) {
    rt.step();
    if (blockedAt < 0 && a.status === 'blocked') blockedAt = rt.tick;
    if (blockedAt >= 0 && a.phase === 'replan') decidedAt = rt.tick;
  }
  assert.deepEqual(calls, ['f1+f2+x: route.goal-blocked f1,f2', 'f1+f2+x (squeezed): ok'], 'everyone → fails naming the goal crowd; everyone squeezed → ok');
  assert.ok(decidedAt - blockedAt <= DECIDE_TICKS, `replanned ${decidedAt - blockedAt} ticks after stopping`);
  const done = rt.runUntilIdle(20 * 90, [a.id]);
  assert.ok(done, `${a.status} ${a.phase} ${a.diagnostic?.message} at ${xz(rt, 'n1').map((v) => v.toFixed(2))} calls ${calls.join(' | ')}`);
  assert.equal(a.status, 'completed', a.diagnostic?.message);
  const snapped = (a.outputs as { snapped: number }).snapped;
  assert.ok(snapped <= 0.35 + 0.0708 && /* snap tolerance, counted in whole cells (≤ half a 0.1 m cell diagonal more) */ Math.abs(dist2(xz(rt, 'n1'), [0, 8]) - snapped) < 0.05, `at its goal or the reported snap (${snapped} m)`);
  for (const f of ['f1', 'f2', 'x']) assert.ok(dist2(xz(rt, 'n1'), xz(rt, f)) >= 2 * R - 0.02, `clear of ${f}`);
  assert.equal(a.outputs?.pushes, 0);
  assert.deepEqual(rt.violations.map((v) => v.message), []);
});

// W15: walker-walker encounters (follow / head-on / crossing) are measured against the smoothed path
// ahead (its tangent where the walkers meet, the other walker's own path over its next ~1 s), so curved
// approaches resolve like straight ones.
test('head-on in the 1 m passage on curved approaches: both get through, nobody pushes, nobody walks on the spot', () => {
  let met = 0;
  for (const [from, to] of [[[11.5, -19], [18.5, -11]], [[18.5, -19], [11.5, -11]], [[12, -18.5], [17.5, -11.5]]] as [Vec2, Vec2][]) {
    const rt = setup(human('n1', from[0], from[1], { yaw: heading(sub2(to, from)) }), human('s1', to[0], to[1], { yaw: heading(sub2(from, to)) }));
    const meter = walkStallMeter(rt);
    const a = rt.submit('walk_to', { actor: 'n1', x: to[0], z: to[1] - 0.6 });
    const b = rt.submit('walk_to', { actor: 's1', x: from[0], z: from[1] + 0.6 });
    let near = Infinity;
    for (let i = 0; i < 20 * 90 && !(a.status === 'completed' && b.status === 'completed'); i++) { rt.step(); near = Math.min(near, dist2(xz(rt, 'n1'), xz(rt, 's1'))); }
    assert.equal(a.status, 'completed', a.diagnostic?.message);
    assert.equal(b.status, 'completed', b.diagnostic?.message);
    if (near < 1.5) met++;
    assert.ok(near >= 2 * R - 0.02, `kept apart (${near.toFixed(3)} m)`);
    assert.equal(a.outputs?.pushes, 0);
    assert.equal(b.outputs?.pushes, 0);
    assert.equal(meter.report.stalls, 0, JSON.stringify(meter.report.first));
    assert.deepEqual(rt.violations.map((v) => v.message), []);
  }
  assert.ok(met >= 2, `the walkers actually met near the passage (${met}/3)`);
});

test('crossing at a corner: a walker turning round a block and one cutting across its corner never collide, never push, never stall', () => {
  const scene = openScene([box('block', -5, -5, -0.8, -0.8)]) // only the way round its north-east corner;
  let met = 0;
  for (const delay of [0, 8, 16, 24, 32, 40]) {
    const base = scene;
    const rt = new Runtime(addAll(emptyWorld('corner', base), human('a', -4, 0, { yaw: 0 }), human('b', 2.5, -2.5, { yaw: heading([-1, 1]) })), new Map<string, ActionDef>([['walk_to', walkTo]]), { spatial: new Spatial(base) }, DEFAULT_INVARIANTS);
    const meter = walkStallMeter(rt);
    const A = rt.submit('walk_to', { actor: 'a', x: 0, z: -4 }); // east, then south round the block's corner (-0.8, -0.8)
    let B: ReturnType<Runtime['submit']> | undefined;
    let near = Infinity;
    for (let i = 0; i < 20 * 60; i++) {
      if (i === delay) B = rt.submit('walk_to', { actor: 'b', x: -2.5, z: 2.5 }); // north-west across the corner
      rt.step();
      near = Math.min(near, dist2(xz(rt, 'a'), xz(rt, 'b')));
      if (A.status === 'completed' && B?.status === 'completed') break;
    }
    assert.equal(A.status, 'completed', A.diagnostic?.message);
    assert.equal(B!.status, 'completed', B!.diagnostic?.message);
    if (near < 1.2) met++;
    console.log(`corner delay ${delay}: nearest ${near.toFixed(3)} m, ticks ${rt.tick}`);
    assert.ok(near >= 2 * R - 0.02, `delay ${delay}: kept apart (${near.toFixed(3)} m)`);
    assert.equal(A.outputs?.pushes, 0, `delay ${delay}`);
    assert.equal(B!.outputs?.pushes, 0, `delay ${delay}`);
    assert.equal(meter.report.stalls, 0, JSON.stringify(meter.report.first));
    assert.deepEqual(rt.violations.map((v) => v.message), []);
  }
  assert.ok(met >= 3, `the paths really crossed near the corner in ${met}/6 staggers`);
});

test('encounters follow the smoothed path: a walker coming back along it just past the bend is head-on (though off the current tangent); a person dead ahead of the current tangent but off the curved path is no encounter', () => {
  const scene = openScene([box('block', -5, -5, -0.8, -0.8)]); // the way round its north-east corner only
  type Ex = { s: number; total: number; segs: { a: Vec2; b: Vec2; s0: number; len: number }[] };
  const at = (ex: Ex, s: number): Vec2 => {
    const g = ex.segs.find((q) => s <= q.s0 + q.len) ?? ex.segs[ex.segs.length - 1];
    const u = Math.min(1, Math.max(0, (s - g.s0) / g.len));
    return [g.a[0] + (g.b[0] - g.a[0]) * u, g.a[1] + (g.b[1] - g.a[1]) * u];
  };
  const dirAt = (ex: Ex, s: number): Vec2 => { const p = at(ex, s), q = at(ex, s + 0.05); const l = dist2(p, q); return [(q[0] - p[0]) / l, (q[1] - p[1]) / l]; };
  const start = () => {
    const rt = new Runtime(addAll(emptyWorld('corner', scene), human('a', -4, 0.3, { yaw: 0 })), new Map<string, ActionDef>([['walk_to', walkTo]]), { spatial: new Spatial(scene) }, DEFAULT_INVARIANTS);
    const A = rt.submit('walk_to', { actor: 'a', x: 0.3, z: -4 });
    const ex = () => (rt.services.walkExecs as Map<string, Ex>).get(A.id)!;
    // walk until the path point 2 m ahead lies outside the old straight-tangent band (0.1 m margin)
    const lat = () => { const e = ex(), me = xz(rt, 'a'), t = dirAt(e, e.s), d = sub2(at(e, e.s + 2.0), me); return Math.abs(d[0] * -t[1] + d[1] * t[0]); };
    while (rt.tick < 200 && lat() < 2 * R + 0.22) rt.step();
    return { rt, A, ex: ex(), me: xz(rt, 'a'), tan: dirAt(ex(), ex().s) };
  };
  // 1) b stands on the path 2.0 m ahead (past the bend) and walks back along it towards a
  {
    const { rt, A, ex, me, tan } = start();
    const pb = at(ex, ex.s + 2.0);
    const d = sub2(pb, me);
    assert.ok(Math.abs(d[0] * -tan[1] + d[1] * tan[0]) >= 2 * R + 0.12, 'the old straight-tangent measure would not see b');
    const back = dirAt(ex, ex.s + 2.0);
    rt.world.entities.b = human('b', pb[0], pb[1], { yaw: heading([-back[0], -back[1]]) });
    const B = rt.submit('walk_to', { actor: 'b', x: -4, z: 0.9 });
    assert.equal(B.status, 'executing');
    const enc = encounterOf(rt, A.id);
    if (enc.kind === 'none') assert.fail('no encounter with b');
    assert.equal(enc.kind, 'headon', JSON.stringify(enc));
    assert.equal(enc.id, 'b');
    assert.ok(Math.abs(enc.along - 2.0) < 0.15 && enc.lateral < 0.1, JSON.stringify(enc));
  }
  // 2) c stands 2.0 m dead ahead of a's current tangent, where the path has already turned away
  {
    const { rt, A, ex, me, tan } = start();
    const pc: Vec2 = [me[0] + 2.0 * tan[0], me[1] + 2.0 * tan[1]];
    let off = Infinity;
    for (let s = ex.s; s <= ex.total; s += 0.05) off = Math.min(off, dist2(at(ex, s), pc));
    assert.ok(off >= 2 * R + 0.12, `c is off the curved path (${off.toFixed(2)} m)`);
    rt.world.entities.c = human('c', pc[0], pc[1], { yaw: 0 });
    assert.equal(encounterOf(rt, A.id).kind, 'none', 'no encounter with someone the path does not pass');
  }
});

// W21 (2026-09-28): walkers never jump. At 9ee061a walk_to moved bodies up to 0.55 m in one tick (published
// speeds of 4–11 m/s) under the old 0.6 m motion.teleport bound. Three classes (MOVEMENT.md "No jumps"):
// A. release after a hold — while the hard separation layer cancelled a step, the lateral offset kept moving
//    towards its sidestep target, and the body jumped to it on release (stress-30 w09 @1132: 0.55 m);
// B. offset collapse — an offset spot without clearance halved the offset in one step (w07 @97: 0.29 m);
// C. offset swept round a bend / sidestep on top of full speed — 1.5–3 m/s over 221 person-ticks of stress-30.
// Now every tick's forward progress, sidestep and pull-back share one budget of min(speed, WALK_SPEED_CAP)·DT.
test('no jumps: a walker moves at most min(speed, 1.4 m/s)·DT per tick and publishes an honest speed — stress-30 (60 s), campfire evening (75 s)', () => {
  const watch = (rt: Runtime) => {
    const out = { worst: 0, at: '', ticks: 0, over: [] as string[] };
    let prev = new Map<string, [number, number]>();
    rt.invariants.push((r) => {
      const cur = new Map<string, [number, number]>();
      for (const e of Object.values(r.world.entities)) {
        if (e.kind !== 'human' || e.human?.speed === undefined) continue; // walk_to owns this person this tick
        cur.set(e.id, [e.pose.p[0], e.pose.p[2]]);
        const q = prev.get(e.id);
        const d = q ? dist2(q, [e.pose.p[0], e.pose.p[2]]) : 0;
        if (d > out.worst) { out.worst = d; out.at = `${e.id}@${r.tick}`; }
        if (e.human.speed > SPEED_CAPS[e.human.activity] * 1.05) out.over.push(`${e.id}@${r.tick} ${e.human.activity} ${e.human.speed}`);
        out.ticks++;
      }
      prev = cur;
      return [];
    });
    return out;
  };
  const s = stress(30);
  const srt = buildRuntime(s);
  s.start(srt);
  const sw = watch(srt);
  for (let i = 0; i < 20 * 60; i++) { srt.step(); s.tick!(srt); }
  const f = campfireEvening;
  const frt = buildRuntime(f);
  f.start(frt);
  const fw = watch(frt);
  while (!f.done!(frt)) { frt.step(); f.tick!(frt); }
  console.log(`max one-tick walker distance: stress-30 ${sw.worst.toFixed(4)} m (${sw.at}) over ${sw.ticks} person-ticks, campfire ${fw.worst.toFixed(4)} m (${fw.at}) over ${fw.ticks}`);
  const cap = WALK_SPEED_CAP * 0.05 + 1e-9;
  assert.ok(sw.worst <= cap, `stress-30: ${sw.worst} m at ${sw.at}`);
  assert.ok(fw.worst <= cap, `campfire: ${fw.worst} m at ${fw.at}`);
  assert.ok(sw.ticks > 20000 && fw.ticks > 2000, 'people really walked');
  assert.deepEqual([...sw.over, ...fw.over], []);
  assert.deepEqual(srt.violations, []);
  assert.deepEqual(frt.violations, []);
});
