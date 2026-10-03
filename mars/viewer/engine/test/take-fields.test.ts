// mars-take/2 fidelity (BODY_MODEL.md "Takes"): the take carries what a studio replay needs to pose people
// exactly as the engine did — hands (mm), baseActivity, on, speed (cm/s), contents — and sampleTake returns them
// at every tick as the live world had them. Final-state replay is unchanged (still hash-verified).
// mars-take/3 (TAKES_AND_PLANS.md "Thinned fields"): hands / speed are keyframes, interpolated; every tick still within
// 5 mm (+ 0.5 mm quantisation) per hand point and 1 cm/s (+ 0.5) of the live world, releases exact at their tick.
// mars-take/4 (TAKES_AND_PLANS.md "Compact tracks, events and entities0"): poses of every entity within TRACK_TOL + ½
// quantum at every tick; `entities0` / `removed` let a replay draw an entity the final state no longer has; compacted
// events expand back to the runtime's stream (merged blocked waits aside); the final state is untouched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DT } from '../runtime/runtime.ts';
import type { Vec3 } from '../core/math.ts';
import { hashOf } from '../core/hash.ts';
import { angleDelta } from '../core/math.ts';
import { def } from '../world/catalog.ts';
import { component } from '../world/factory.ts';
import { TakeRecorder, compactEvents, thinChanges } from '../take/recorder.ts';
import { blockedWaits, expandEvents, replayFinalState, sampleTake, takeEvents } from '../take/replay.ts';
import { ANG_Q, INTERP_FIELDS, POS_Q, TAKE_SCHEMA, TRACK_TOL, type ChangeEvent, type Take, type TakeEvent } from '../take/types.ts';
import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { CARRY_INVARIANTS } from '../carry/invariants.ts';
import { Spatial } from '../spatial/service.ts';
import { walkTo } from '../locomotion/walk.ts';
import { carry } from '../carry/actions.ts';
import { takeFromBundle, bundleEntity } from '../construction/bundle.ts';
import { addAll, emptyWorld, human } from '../world/factory.ts';
import type { ActionDef } from '../actions/types.ts';
import type { SpatialScene } from '../spatial/types.ts';
import type { Provenance } from '../world/types.ts';
import { sliceTake } from '../api/controller.ts';
import { mealRuntime, runMeal } from '../scenarios/meal.ts';
import { bay } from './frame-fixtures.ts';

type Pose = [number, number, number, number, number, number];
type Live = { pose?: Pose; human?: true; hands?: { left?: Vec3; right?: Vec3 }; baseActivity?: string; on?: string; speed?: number; contents?: unknown };
const snap = (rt: Runtime) => {
  const out: Record<string, Live> = {};
  for (const e of Object.values(rt.world.entities)) {
    const pose: Pose = [...e.pose.p, e.pose.yaw, e.pose.pitch ?? 0, e.pose.roll ?? 0] as Pose;
    if (e.human) out[e.id] = { pose, human: true, ...structuredClone({ hands: e.human.hands, baseActivity: e.human.baseActivity, on: e.human.on, speed: e.human.speed }) };
    else if (e.contents) out[e.id] = { pose, contents: structuredClone(e.contents) };
    else out[e.id] = { pose };
  }
  return out;
};
// mars-take/4 pose tracks: TRACK_TOL + ½ quantum per axis / angle
const POS_TOL = (TRACK_TOL.pos + 0.5) / POS_Q, ANG_TOL = (TRACK_TOL.ang + 0.5) / ANG_Q;
const worstPose = { mm: 0, mrad: 0 };
function checkPose(id: string, tick: number, s: { p: Vec3; yaw: number; pitch: number; roll: number }, l: Pose) {
  const dp = Math.max(...s.p.map((v, i) => Math.abs(v - l[i])));
  const da = Math.max(Math.abs(angleDelta(s.yaw, l[3])), Math.abs(angleDelta(s.pitch, l[4])), Math.abs(angleDelta(s.roll, l[5])));
  worstPose.mm = Math.max(worstPose.mm, dp * 1000);
  worstPose.mrad = Math.max(worstPose.mrad, da * 1000);
  assert.ok(dp <= POS_TOL + 1e-9 && da <= ANG_TOL + 1e-9, `${id} pose at ${tick}: ${JSON.stringify([s.p, s.yaw, s.pitch, s.roll])} vs ${JSON.stringify(l)}`);
}
// thinned (mars-take/3): 5 mm tolerance + 0.5 mm quantisation per hand point (Euclidean); speed 1 + 0.5 cm/s
const HAND_TOL = (INTERP_FIELDS.hands + 0.5) / 1000, SPEED_TOL = (INTERP_FIELDS.speed + 0.5) / 100;
const dist = (a: Vec3, b: Vec3) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
let worstHand = 0;
const near = (a: Vec3 | undefined, b: Vec3 | undefined) => {
  if (!a || !b) return !a && !b;
  worstHand = Math.max(worstHand, dist(a, b));
  return dist(a, b) <= HAND_TOL + 1e-9;
};

function compare(take: ReturnType<TakeRecorder['finish']>, live: Map<number, Record<string, Live>>) {
  let handTicks = 0;
  const had = new Map<string, boolean>();
  for (const [tick, ents] of live) {
    const f = sampleTake(take, tick * DT);
    for (const [id, l] of Object.entries(ents)) {
      const s = f.entities[id];
      assert.ok(s, `${id} present at ${tick}`);
      if (l.pose) checkPose(id, tick, s, l.pose);
      if (l.contents !== undefined) { assert.deepEqual(s.state.contents, l.contents, `${id} contents at ${tick}`); continue; }
      if (!l.human) continue;
      const lh = l.hands && (l.hands.left || l.hands.right) ? l.hands : undefined;
      assert.equal(!!s.hands, !!lh, `${id} hands present at ${tick}`);
      // a release (hands go free) is a keyframe at exactly that tick, never interpolated away
      if (had.get(id) && !lh) assert.ok(take.changes.some((c) => c[0] === tick && c[1] === id && c[2] === 'hands' && c[3] === null), `${id} hands released at ${tick}`);
      had.set(id, !!lh);
      if (lh) {
        handTicks++;
        assert.ok(near(s.hands!.left, lh.left) && near(s.hands!.right, lh.right), `${id} hands at ${tick}: ${JSON.stringify(s.hands)} vs ${JSON.stringify(lh)}`);
      }
      assert.equal(s.state.baseActivity ?? undefined, l.baseActivity, `${id} baseActivity at ${tick}`);
      assert.equal(s.state.on ?? undefined, l.on, `${id} on at ${tick}`);
      if (l.speed === undefined) assert.equal(s.speed, undefined, `${id} speed at ${tick}`);
      else assert.ok(Math.abs(s.speed! - l.speed) <= SPEED_TOL + 1e-9, `${id} speed ${s.speed} vs ${l.speed} at ${tick}`);
    }
  }
  return handTicks;
}

test('take fields (mars-take/2): the meal take carries hands, baseActivity, speed and bowl contents tick for tick', () => {
  const rt = mealRuntime();
  const rec = new TakeRecorder(rt, { rulesVersion: 'test' });
  const live = new Map<number, Record<string, Live>>();
  runMeal(rt, { onTick: (r) => live.set(r.tick - rec.startTick, snap(r)) });
  const take = rec.finish();
  assert.equal(take.schema, TAKE_SCHEMA);
  const handTicks = compare(take, live);
  assert.ok(handTicks > 1000, `${handTicks} person-ticks with hands`);
  const f = (field: string) => take.changes.filter((c) => c[2] === field).length;
  assert.ok(f('hands') > 0 && f('baseActivity') > 0 && f('speed') > 0 && f('contents') > 0, `hands ${f('hands')} baseActivity ${f('baseActivity')} speed ${f('speed')} contents ${f('contents')}`);
  // hands are integer millimetres
  for (const c of take.changes.filter((c) => c[2] === 'hands' && c[3])) for (const v of Object.values(c[3] as Record<string, number[]>)) assert.ok(v.every(Number.isInteger));
  assert.equal(hashOf(replayFinalState(take)), hashOf(rt.world), 'final state replays exactly');
});

test('take fields (mars-take/2): a hand-up take carries every holder\'s hands (incl. the crouch / reach_down approach) and who stands on the beam', () => {
  const L = def('beam-12ft').size[0];
  const JZ = [L / 2 - 0.75, L / 2 - 0.25, L / 2 + 0.25, L / 2 + 0.75];
  const { rt } = bay({ seat: 2.29, beam: 'beam-12ft', joists: JZ }, [component('s1', 'plywood-4x6', [2.6, 0, L / 2], Math.PI / 2, { phase: 'staged' })]);
  const rec = new TakeRecorder(rt, { rulesVersion: 'test' });
  const live = new Map<number, Record<string, Live>>();
  const r = rt.submit('hand_up', { part: 's1', givers: ['p1', 'p2'], receivers: ['p3', 'p4'], to: { x: 0, z: L / 2, yaw: Math.PI / 2 } });
  assert.notEqual(r.status, 'failed', `${r.diagnostic?.code} ${r.diagnostic?.message}`);
  let n = 0;
  while (r.status !== 'completed' && r.status !== 'failed' && n++ < 20 * 400) {
    rt.step();
    live.set(rt.tick - rec.startTick, snap(rt));
  }
  assert.equal(r.status, 'completed', `${r.diagnostic?.code} ${r.diagnostic?.message}`);
  const take = rec.finish();
  const handTicks = compare(take, live);
  assert.ok(handTicks > 200, `${handTicks} person-ticks with hands`);
  assert.ok(take.changes.some((c) => c[2] === 'on' && c[3] === 'beam:b3'), 'a receiver on beam b3 in the take');
  assert.ok(take.changes.some((c) => c[1] === 'p1' && c[2] === 'activity' && c[3] === 'crouch'));
  assert.equal(hashOf(replayFinalState(take)), hashOf(rt.world));
  // mars-take/3 economy: hand points move almost every tick of the lift; a short lift of smoothstep reaches and releases
  // keeps ≈ 1/3 of them (the 2022 year takes ≈ 1/28)
  const q = (h: Live['hands']) => JSON.stringify(h && (h.left || h.right) ? [h.left, h.right].map((v) => v && v.map((x) => Math.round(x * 1000))) : null);
  let liveChanges = 0;
  const prev = new Map<string, string>();
  for (const ents of live.values()) for (const [id, l] of Object.entries(ents)) {
    if (l.contents !== undefined) continue;
    const k = q(l.hands);
    if (prev.has(id) && prev.get(id) !== k) liveChanges++;
    prev.set(id, k);
  }
  const keys = take.changes.filter((c) => c[2] === 'hands').length;
  console.log(`[take-fields] hand-up: ${liveChanges} live hand changes → ${keys} keyframes; worst hand ${(worstHand * 1000).toFixed(2)} mm`);
  assert.ok(keys * 2 < liveChanges, `${keys} hands keyframes for ${liveChanges} live changes`);
  // a get_take slice samples like the whole take, also between keyframes and between ticks
  for (const [a, b] of [[0, 40], [37, 120], [101, 333], [250, take.ticks]]) {
    const sl = { ...take, ...sliceTake(take, a, b) } as Take;
    for (const tick of [a, a + 0.5, (a + b) / 2, b - 0.25, b]) assert.deepEqual(sampleTake(sl, tick * DT), sampleTake(take, tick * DT), `slice ${a}–${b} at ${tick}`);
  }
});

test('take fields (mars-take/3): thinChanges — keyframes reproduce every tick of the step signal within tolerance; holds, shape changes and releases exact', () => {
  // one static person; hands move in a line, hold, swing on a curve, drop a hand, go free, come back; speed ramps and steps
  const ch: ChangeEvent[] = [[0, 'p', 'present', true]];
  const hands = (t: number): unknown => {
    if (t < 10) return { left: [10 * t, 1000, 0], right: [10 * t, 1000, 400] };
    if (t < 30) return { left: [90, 1000, 0], right: [90, 1000, 400] };
    if (t < 50) return { left: [90 + (t - 30) ** 2, 1000, 0], right: [90, 1000 + 7 * (t - 30), 400] };
    if (t < 55) return { left: [600, 1100, 0] };
    if (t < 60) return null;
    return { left: [0, 900, 0], right: [0, 900, 400] };
  };
  const speed = (t: number): number | null => (t < 5 ? null : t < 25 ? Math.min(120, 6 * (t - 5)) : t < 40 ? 45 : t < 70 ? 45 + (t % 2) : null);
  let lh = 'none', ls = 'none';
  for (let t = 0; t <= 80; t++) {
    const h = JSON.stringify(hands(t)), sp = JSON.stringify(speed(t));
    if (h !== lh && !(lh === 'none' && h === 'null')) ch.push([t, 'p', 'hands', hands(t)]);
    if (sp !== ls && !(ls === 'none' && sp === 'null')) ch.push([t, 'p', 'speed', speed(t)]);
    lh = h; ls = sp;
  }
  const base = { schema: TAKE_SCHEMA, id: 'x', baselineStateHash: 'h', rulesVersion: 'test', dt: DT, startTick: 0, ticks: 80, keyframeEvery: 20,
    tracks: { p: [[0, 0, 0, 0, 0]] }, events: [], finalStateHash: '', finalState: {} } as unknown as Take;
  const thin = { ...base, changes: thinChanges(ch, INTERP_FIELDS) } as Take;
  const exact = { ...base, changes: thinChanges(ch, { hands: 0, speed: 0 }) } as Take;
  assert.ok(thin.changes.length < ch.length / 2, `${thin.changes.length} of ${ch.length} changes kept`);
  for (let t = 0; t <= 80; t++) {
    for (const [tk, eps] of [[thin, 1], [exact, 0]] as const) {
      const e = sampleTake(tk, t * DT).entities.p;
      const want = hands(t) as { left?: number[]; right?: number[] } | null;
      assert.equal(!!e.hands, !!want, `hands present at ${t}`);
      for (const side of ['left', 'right'] as const) {
        assert.equal(!!e.hands?.[side], !!want?.[side], `${side} at ${t}`);
        if (want?.[side]) assert.ok(dist(e.hands![side]!, want[side]!.map((x) => x / 1000) as Vec3) <= (eps * INTERP_FIELDS.hands) / 1000 + 1e-9, `${side} at ${t}: ${e.hands![side]} vs ${want[side]}`);
      }
      const sp = speed(t);
      if (sp === null) assert.equal(e.speed, undefined, `speed at ${t}`);
      else assert.ok(Math.abs(e.speed! * 100 - sp) <= eps * INTERP_FIELDS.speed + 1e-9, `speed at ${t}: ${e.speed} vs ${sp}`);
    }
  }
  // the hold is not smeared into the swing that follows it, and a hold's end is exact
  assert.deepEqual(sampleTake(thin, 29 * DT).entities.p.hands, { left: [0.09, 1, 0], right: [0.09, 1, 0.4] });
  // between ticks: linear inside a run, held across a shape change or a release
  assert.deepEqual(sampleTake(thin, 4.5 * DT).entities.p.hands, { left: [0.045, 1, 0], right: [0.045, 1, 0.4] });
  assert.deepEqual(sampleTake(thin, 54.5 * DT).entities.p.hands, { left: [0.6, 1.1, 0] });
  // the thinned fields are the only ones touched, and the result is sorted by tick
  assert.deepEqual(thin.changes.filter((c) => !(c[2] in INTERP_FIELDS)), ch.filter((c) => !(c[2] in INTERP_FIELDS)));
  assert.ok(thin.changes.every((c, i) => i === 0 || thin.changes[i - 1][0] <= c[0]));
});

const HYPO: Provenance = { origin: 'design-edit', confidence: 'hypothetical', note: 'take-fields test' };
const ground = (): SpatialScene => ({ bounds: [-20, -20, 20, 20], levels: [{ id: 0, y: 0, label: 'ground' }], surfaces: [{ id: 'ground', level: 0, y: 0, obb: { c: [0, 0], half: [20, 20], yaw: 0 } }], obstacles: [], links: [] });
/** A 2-beam stack emptied mid-take (take_from_bundle removes the stack with its last piece), as in year-stock.test.ts. */
function yardTake(opts: { compactEvents?: boolean } = {}) {
  const w = addAll(emptyWorld('open-ground', ground()), bundleEntity('beams', 'stack-beam-12ft', 0, 0, 0, 2, 0, HYPO), human('p1', -3, -3), human('p2', -2, -3), human('p3', -1, -3));
  const reg = new Map<string, ActionDef>([['walk_to', walkTo], ['carry', carry], ['take_from_bundle', takeFromBundle]]);
  const rt = new Runtime(w, reg, { spatial: new Spatial(ground()) }, [...DEFAULT_INVARIANTS, ...CARRY_INVARIANTS]);
  const rec = new TakeRecorder(rt, { rulesVersion: 'test', ...opts });
  const live = new Map<number, Record<string, Live>>();
  const run = (verb: string, params: unknown) => {
    const r = rt.submit(verb, params);
    let n = 0;
    while (r.status !== 'completed' && r.status !== 'failed' && n++ < 20 * 300) { rt.step(); live.set(rt.tick - rec.startTick, snap(rt)); }
    assert.equal(r.status, 'completed', `${verb}: ${r.diagnostic?.code} ${r.diagnostic?.message}`);
  };
  const spot = { x: 0, z: 1.4, yaw: 0 };
  run('take_from_bundle', { crew: ['p1', 'p2'], bundle: 'beams', piece: 'b1', to: spot });
  run('carry', { crew: ['p1', 'p2'], item: 'b1', to: { x: -8, z: 3, yaw: 0 } });
  run('take_from_bundle', { crew: ['p2', 'p3'], bundle: 'beams', piece: 'b2', to: spot });
  assert.equal(rt.world.entities.beams, undefined, 'the emptied stack is gone');
  assert.deepEqual(rt.violations, []);
  return { rt, take: rec.finish(), live };
}

test('take fields (mars-take/4): entities0 + removed — an emptied stack removed mid-take is recorded as first seen, sampled until its removal tick; poses within TRACK_TOL every tick', () => {
  const { rt, take, live } = yardTake();
  assert.equal(take.schema, TAKE_SCHEMA);
  compare(take, live);
  console.log(`[take-fields] worst pose ${worstPose.mm.toFixed(2)} mm / ${worstPose.mrad.toFixed(2)} mrad over the meal, hand-up and yard takes`);
  // removed: exactly the stack, at its present:false change
  const gone = take.changes.filter((c) => c[2] === 'present' && c[3] === false);
  assert.deepEqual(take.removed, gone.map((c) => ({ id: c[1], t: c[0] })));
  assert.deepEqual(take.removed!.map((r) => r.id), ['beams']);
  const tr = take.removed![0].t;
  assert.ok(!take.finalState.entities.beams);
  // entities0: every tracked id, as first seen; minus provenance / label / tags
  assert.deepEqual(Object.keys(take.entities0!), Object.keys(take.tracks));
  const b0 = take.entities0!.beams;
  assert.equal(b0.kind, 'fixture');
  assert.equal(b0.def, 'stack-beam-12ft');
  assert.ok(!('provenance' in b0) && !('label' in b0) && !('tags' in b0));
  const { provenance: _p, label: _l, tags: _t, ...want } = structuredClone(addAll(emptyWorld('open-ground', ground()), bundleEntity('beams', 'stack-beam-12ft', 0, 0, 0, 2, 0, HYPO)).entities.beams);
  assert.deepEqual(b0, want, 'the stack as it stood at tick 0 (2 pieces)');
  // a piece that appears mid-take is recorded at its first sample
  const firstB2 = take.changes.find((c) => c[1] === 'b2' && c[2] === 'present')![0];
  assert.ok(firstB2 > 0 && take.entities0!.b2.def === 'beam-12ft');
  assert.deepEqual(take.entities0!.b2.pose.p.map((v) => Math.round(v * POS_Q)), take.tracks.b2[0].slice(1, 4));
  // the stack is sampled (so drawable from entities0) until the tick before its removal, then gone
  assert.ok(sampleTake(take, (tr - 1) * DT).entities.beams, 'stack present the tick before removal');
  assert.equal(sampleTake(take, tr * DT).entities.beams, undefined);
  assert.equal(hashOf(replayFinalState(take)), hashOf(rt.world));
});

test('take events (mars-take/4): compactEvents folds same-tick lifecycles losslessly and merges repeated blocked waits; final state and tracks unchanged', () => {
  const raw = yardTake({ compactEvents: false }).take, comp = yardTake().take;
  assert.equal(comp.finalStateHash, raw.finalStateHash);
  assert.deepEqual(comp.tracks, raw.tracks);
  assert.deepEqual(comp.changes, raw.changes);
  assert.deepEqual(comp.events, compactEvents(raw.events));
  assert.ok(comp.events.length < raw.events.length * 0.7, `${comp.events.length} of ${raw.events.length} events`);
  // lossless where nothing blocked repeatedly: expand(compact) is the raw stream
  const noRepeat = raw.events.every((e, i) => !(e.type === 'action' && e.status === 'blocked') || !raw.events.slice(0, i).some((x) => x.type === 'action' && x.id === e.id && x.status === 'blocked' && x.code === e.code && x.message === e.message));
  if (noRepeat) assert.deepEqual(expandEvents(comp.events), raw.events);
  assert.equal(blockedWaits(comp.events), raw.events.filter((e) => e.type === 'action' && e.status === 'blocked').length);
  assert.deepEqual(takeEvents(comp, 0, 2), expandEvents(comp.events.filter((e) => e.t * DT < 2)));
  // synthetic: a lifecycle run, a lifecycle that stops at reserved, a failed validation, and a thrice-repeated wait
  const A = (t: number, id: string, status: string, x: Record<string, unknown> = {}) => ({ t, type: 'action', id, verb: 'walk_to', status, ...x }) as TakeEvent;
  const wait = { phase: 'walk', code: 'traffic.person', message: 'm1 is waiting for m2' };
  const ev: TakeEvent[] = [
    A(0, 'a', 'requested'), A(0, 'a', 'validated'), A(0, 'a', 'reserved'), A(0, 'a', 'executing'),
    A(0, 'b', 'requested'), A(0, 'b', 'validated'), A(0, 'b', 'reserved'),
    A(0, 'c', 'requested'), A(0, 'c', 'failed', { code: 'x', message: 'no' }),
    A(1, 'a', 'executing', { phase: 'walk' }),
    A(5, 'a', 'blocked', wait), A(6, 'a', 'executing', { phase: 'walk' }),
    A(9, 'a', 'blocked', wait), A(12, 'b', 'executing'), A(13, 'a', 'executing', { phase: 'walk' }),
    A(20, 'a', 'blocked', wait), A(22, 'a', 'executing', { phase: 'walk' }),
    A(30, 'a', 'blocked', { ...wait, message: 'm1 is waiting for m3' }), A(31, 'a', 'executing', { phase: 'walk' }),
    A(40, 'a', 'completed', { phase: 'walk' }),
  ];
  const c = compactEvents(structuredClone(ev));
  assert.deepEqual(c, [
    A(0, 'a', 'executing', { from: 'requested' }), A(0, 'b', 'reserved', { from: 'requested' }), A(0, 'c', 'requested'), A(0, 'c', 'failed', { code: 'x', message: 'no' }),
    A(1, 'a', 'executing', { phase: 'walk' }),
    A(5, 'a', 'blocked', { ...wait, n: 3, until: 20 }), A(12, 'b', 'executing'), A(22, 'a', 'executing', { phase: 'walk' }),
    A(30, 'a', 'blocked', { ...wait, message: 'm1 is waiting for m3' }), A(31, 'a', 'executing', { phase: 'walk' }),
    A(40, 'a', 'completed', { phase: 'walk' }),
  ]);
  assert.equal(blockedWaits(c), 4);
  const dropped = new Set([6, 9, 13, 20]); // the merged waits and the resumes between them
  assert.deepEqual(expandEvents(c).map((e) => { const { n: _n, until: _u, ...r } = e as Record<string, unknown>; return r; }), ev.filter((e) => !(e.type === 'action' && e.id === 'a' && dropped.has(e.t))));
  assert.deepEqual(compactEvents(c), c, 'idempotent');
});
