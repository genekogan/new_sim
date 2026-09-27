// Takes: recording fidelity, compactness, determinism, camera independence, replay isolation (spec §22–23, §28).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { hashOf, stableStringify } from '../core/hash.ts';
import { angleDelta } from '../core/math.ts';
import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { bindTemplate } from '../sequence/bind.ts';
import { SequenceRunner } from '../sequence/runner.ts';
import { rehearse, execute } from '../rehearsal/rehearse.ts';
import { TakeRecorder, takeIdOf } from '../take/recorder.ts';
import { replayFinalState, sampleTake, takeDuration, takeEvents } from '../take/replay.ts';
import { TakeLibrary } from '../take/store.ts';
import type { Take } from '../take/types.ts';
import { config, crossBindings, crossTemplate, minuteBindings, minuteTemplate, pgHistory, pgWorld, registry, RULES } from './sequence-fixtures.ts';

function recordMinute() {
  const h = pgHistory();
  const plan = bindTemplate(minuteTemplate, minuteBindings, { history: h, baseline: 'ws', registry: registry() });
  return { h, plan, ...rehearse(h, 'ws', plan, config()) };
}

test('take fidelity: sampling at every tick reproduces true poses within 2 mm / 2 mrad and exact activity/level', () => {
  const h = pgHistory();
  const plan = bindTemplate(crossTemplate, crossBindings, { history: h, baseline: 'ws', registry: registry() });
  const c = config();
  const w = pgWorld();
  const rt = new Runtime(w, c.registry, c.services(w), DEFAULT_INVARIANTS);
  const truth: { tick: number; e: Record<string, { p: number[]; yaw: number; activity?: string; level?: number }> }[] = [];
  const snap = () =>
    truth.push({
      tick: rt.tick,
      e: Object.fromEntries(Object.values(rt.world.entities).map((x) => [x.id, { p: [...x.pose.p], yaw: x.pose.yaw, activity: x.human?.activity, level: x.human?.level }])),
    });
  snap();
  const rec = new TakeRecorder(rt, { rulesVersion: RULES, planHash: plan.planHash });
  rt.observers.push({ onTick: snap });
  const res = new SequenceRunner(rt, plan.steps).run();
  const take = rec.finish();
  assert.equal(res.status, 'completed');
  assert.equal(take.ticks, res.ticks);
  let worst = 0, worstAng = 0;
  for (const s of truth) {
    const f = sampleTake(take, (s.tick - take.startTick) * take.dt);
    for (const [id, e] of Object.entries(s.e)) {
      const g = f.entities[id];
      assert.ok(g, `${id} present at tick ${s.tick}`);
      worst = Math.max(worst, ...e.p.map((v, i) => Math.abs(v - g.p[i])));
      worstAng = Math.max(worstAng, Math.abs(angleDelta(e.yaw, g.yaw)));
      assert.equal(g.activity, e.activity, `${id} activity at tick ${s.tick}`);
      assert.equal(g.level, e.level);
    }
  }
  assert.ok(worst <= 0.002, `max position error ${worst}`);
  assert.ok(worstAng <= 0.002, `max yaw error ${worstAng}`);
  // the recorder is detached after finish
  assert.ok(!rt.observers.includes(rec));
  // runtime events are carried with relative ticks
  assert.ok(takeEvents(take).some((e) => e.type === 'action' && e.status === 'blocked'));
  assert.ok(takeEvents(take).some((e) => e.type === 'action' && e.id === 'step:climb' && e.status === 'completed'));
});

test('take payload: 3 walkers × 60 s stays compact (bytes measured)', () => {
  const { take, report } = recordMinute();
  assert.equal(report.status, 'completed');
  // ~60 s of walking plus realistic yielding/sidestepping around people (walk.ts person encounters)
  assert.ok(takeDuration(take) >= 55 && takeDuration(take) <= 90, `duration ${takeDuration(take)}`);
  const full = stableStringify(take);
  const { finalState: _f, ...body } = take;
  const sizes = {
    total: full.length,
    withoutFinalState: stableStringify(body).length,
    tracks: stableStringify(take.tracks).length,
    changes: stableStringify(take.changes).length,
    events: stableStringify(take.events).length,
    finalState: stableStringify(take.finalState).length,
    gzip: gzipSync(full).length,
    samples: Object.values(take.tracks).reduce((s, t) => s + t.length, 0),
    ticks: take.ticks,
  };
  console.log('take payload (3 walkers, %ss):', takeDuration(take).toFixed(1), JSON.stringify(sizes));
  assert.ok(sizes.total < 40_000, `take is ${sizes.total} bytes`);
  assert.ok(sizes.samples < take.ticks * 3 * 0.35, `pose samples ${sizes.samples} vs ${take.ticks * 3} raw`);
  // a static entity costs a single sample
  assert.equal(take.tracks.panel.length, 1);
});

test('deterministic take bytes: identical runs produce byte-identical takes', () => {
  const a = recordMinute().take, b = recordMinute().take;
  assert.equal(stableStringify(a), stableStringify(b));
  assert.equal(a.id, b.id);
  assert.equal(a.id, takeIdOf(a));
});

test('replay camera independence: camera tracks never change the take, its hash or its final state', () => {
  const { take, h, plan } = recordMinute();
  const lib = new TakeLibrary();
  lib.put(take);
  const before = lib.takeHash(take.id);
  lib.attachCamera({ id: 'cam-orbit', takeId: take.id, kind: 'orbit', data: { target: 'n1', radius: 6 } });
  lib.attachCamera({ id: 'cam-dolly', takeId: take.id, kind: 'dolly', data: { keys: [[0, [0, 2, 0]], [30, [10, 2, 5]]] } });
  lib.attachCamera({ id: 'cam-orbit', takeId: take.id, kind: 'orbit', data: { target: 's1', radius: 9 } }); // edit
  assert.deepEqual(lib.cameras(take.id).map((c) => c.id), ['cam-dolly', 'cam-orbit']);
  assert.equal(lib.takeHash(take.id), before);
  assert.equal(lib.get(take.id).id, take.id);
  assert.equal(hashOf(replayFinalState(lib.get(take.id))), take.finalStateHash);
  assert.throws(() => lib.attachCamera({ id: 'x', takeId: 'nope', kind: 'orbit', data: null }), /no take/);
  // re-running the same plan under different cameras is the same performance
  const again = rehearse(h, 'ws', plan, config()).take;
  assert.equal(again.id, take.id);
  // persistence round trip keeps takes and cameras separate
  const lib2 = TakeLibrary.fromJSON(JSON.parse(JSON.stringify(lib.toJSON())));
  assert.equal(lib2.takeHash(take.id), before);
  assert.equal(lib2.cameras(take.id).length, 2);
});

test('replay isolation: sampling an old take never touches history, the live workspace or the take', () => {
  const h = pgHistory();
  const plan = bindTemplate(crossTemplate, crossBindings, { history: h, baseline: 'ws', registry: registry() });
  const lib = new TakeLibrary();
  const ex = execute(h, 'ws', plan, config(), { takes: lib });
  assert.ok(ex.ok);
  const take = lib.get(ex.take.id); // frozen
  assert.ok(Object.isFrozen(take.tracks.n1[0]));
  const hist = hashOf(h.toJSON());
  const head = h.head('ws').id;
  for (let t = -1; t <= takeDuration(take) + 1; t += 0.37) {
    const f = sampleTake(take, t);
    f.entities.n1.p[0] = 999; // mutating a frame is harmless
    f.entities.n1.state.x = 1;
  }
  const s = replayFinalState(take);
  s.entities.n1.pose.p[0] = 999;
  assert.equal(hashOf(h.toJSON()), hist);
  assert.equal(h.head('ws').id, head);
  assert.equal(takeIdOf(take), take.id);
  assert.equal(hashOf(replayFinalState(take)), take.finalStateHash);
  // replay does not depend on the runtime, registry, planner or history at all
  const src = readFileSync(new URL('../take/replay.ts', import.meta.url), 'utf8');
  const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(imports.filter((i) => /runtime|actions|sequence|history|spatial|locomotion|rehearsal/.test(i)), []);
});

test('tampered takes are rejected', () => {
  const { take } = recordMinute();
  const bad = structuredClone(take) as Take;
  bad.tracks.n1[3][1] += 1000;
  assert.throws(() => new TakeLibrary().put(bad), /does not match its content/);
  const bad2 = structuredClone(take) as Take;
  bad2.finalState.entities.n1.pose.p[0] += 1;
  assert.throws(() => replayFinalState(bad2), /corrupt/);
});

test('sampleTake: ends hold, shortest-arc yaw, entities appear/disappear', () => {
  const take: Take = {
    schema: 'mars-take/1', id: 'x', baselineStateHash: 'h', rulesVersion: RULES, dt: 0.05, startTick: 0, ticks: 20, keyframeEvery: 20,
    tracks: { a: [[0, 0, 0, 0, 3100], [10, 1000, 0, 0, -3100]], b: [[5, 0, 0, 0, 0]] },
    changes: [[0, 'a', 'present', true], [0, 'a', 'activity', 'walk'], [10, 'a', 'activity', 'idle'], [5, 'b', 'present', true], [15, 'b', 'present', false]],
    events: [], finalStateHash: '', finalState: null as any,
  };
  const mid = sampleTake(take, 0.25);
  assert.ok(Math.abs(mid.entities.a.p[0] - 0.5) < 1e-9);
  // 3.1 → -3.1 rad goes the short way through ±π, not through 0
  assert.ok(Math.abs(Math.abs(mid.entities.a.yaw) - Math.PI) < 0.01, `yaw ${mid.entities.a.yaw}`);
  assert.equal(mid.entities.a.activity, 'walk');
  assert.equal(sampleTake(take, 0.9).entities.a.p[0], 1);
  assert.equal(sampleTake(take, 0.9).entities.a.activity, 'idle');
  assert.equal(sampleTake(take, 0.1).entities.b, undefined);
  assert.ok(sampleTake(take, 0.5).entities.b);
  assert.equal(sampleTake(take, 0.9).entities.b, undefined);
});
