// mars-take/2 fidelity (BODY_MODEL.md "Takes"): the take carries what a studio replay needs to pose people
// exactly as the engine did — hands (mm), baseActivity, on, speed (cm/s), contents — and sampleTake returns them
// at every tick as the live world had them. Final-state replay is unchanged (still hash-verified).
// mars-take/3 (TAKES_AND_PLANS.md "Thinned fields"): hands / speed are keyframes, interpolated; every tick still within
// 5 mm (+ 0.5 mm quantisation) per hand point and 1 cm/s (+ 0.5) of the live world, releases exact at their tick.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Runtime } from '../runtime/runtime.ts';
import { DT } from '../runtime/runtime.ts';
import type { Vec3 } from '../core/math.ts';
import { hashOf } from '../core/hash.ts';
import { def } from '../world/catalog.ts';
import { component } from '../world/factory.ts';
import { TakeRecorder, thinChanges } from '../take/recorder.ts';
import { replayFinalState, sampleTake } from '../take/replay.ts';
import { INTERP_FIELDS, TAKE_SCHEMA, type ChangeEvent, type Take } from '../take/types.ts';
import { sliceTake } from '../api/controller.ts';
import { mealRuntime, runMeal } from '../scenarios/meal.ts';
import { bay } from './frame-fixtures.ts';

type Live = { hands?: { left?: Vec3; right?: Vec3 }; baseActivity?: string; on?: string; speed?: number; contents?: unknown };
const snap = (rt: Runtime) => {
  const out: Record<string, Live> = {};
  for (const e of Object.values(rt.world.entities)) {
    if (e.human) out[e.id] = structuredClone({ hands: e.human.hands, baseActivity: e.human.baseActivity, on: e.human.on, speed: e.human.speed });
    else if (e.contents) out[e.id] = { contents: structuredClone(e.contents) };
  }
  return out;
};
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
      if (l.contents !== undefined) { assert.deepEqual(s.state.contents, l.contents, `${id} contents at ${tick}`); continue; }
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
