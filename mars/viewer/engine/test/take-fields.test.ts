// mars-take/2 fidelity (BODY_MODEL.md "Takes"): the take carries what a studio replay needs to pose people
// exactly as the engine did — hands (mm), baseActivity, on, speed (cm/s), contents — and sampleTake returns them
// at every tick as the live world had them. Final-state replay is unchanged (still hash-verified).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Runtime } from '../runtime/runtime.ts';
import { DT } from '../runtime/runtime.ts';
import type { Vec3 } from '../core/math.ts';
import { hashOf } from '../core/hash.ts';
import { def } from '../world/catalog.ts';
import { component } from '../world/factory.ts';
import { TakeRecorder } from '../take/recorder.ts';
import { replayFinalState, sampleTake } from '../take/replay.ts';
import { TAKE_SCHEMA } from '../take/types.ts';
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
const near = (a: Vec3 | undefined, b: Vec3 | undefined) => (!a && !b) || (!!a && !!b && a.every((x, i) => Math.abs(x - b[i]) <= 0.0005 + 1e-12));

function compare(take: ReturnType<TakeRecorder['finish']>, live: Map<number, Record<string, Live>>) {
  let handTicks = 0;
  for (const [tick, ents] of live) {
    const f = sampleTake(take, tick * DT);
    for (const [id, l] of Object.entries(ents)) {
      const s = f.entities[id];
      assert.ok(s, `${id} present at ${tick}`);
      if (l.contents !== undefined) { assert.deepEqual(s.state.contents, l.contents, `${id} contents at ${tick}`); continue; }
      const lh = l.hands && (l.hands.left || l.hands.right) ? l.hands : undefined;
      assert.equal(!!s.hands, !!lh, `${id} hands present at ${tick}`);
      if (lh) {
        handTicks++;
        assert.ok(near(s.hands!.left, lh.left) && near(s.hands!.right, lh.right), `${id} hands at ${tick}: ${JSON.stringify(s.hands)} vs ${JSON.stringify(lh)}`);
      }
      assert.equal(s.state.baseActivity ?? undefined, l.baseActivity, `${id} baseActivity at ${tick}`);
      assert.equal(s.state.on ?? undefined, l.on, `${id} on at ${tick}`);
      if (l.speed === undefined) assert.equal(s.speed, undefined, `${id} speed at ${tick}`);
      else assert.ok(Math.abs(s.speed! - l.speed) <= 0.005 + 1e-12, `${id} speed ${s.speed} vs ${l.speed} at ${tick}`);
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
});
