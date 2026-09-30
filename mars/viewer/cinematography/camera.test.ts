import test from 'node:test';
import assert from 'node:assert/strict';
import { Director } from './director.ts';
import { Advisory } from './provider.ts';
import { feasibleShots } from './shots.ts';
import { safePose, execute } from './physical.ts';
import { Observer, cameraScene } from './observation.ts';
import { replayFrame } from './replay.ts';
import { JevProvider } from './jev-server.ts';
import {
  classroomWorld,
  classroomScene,
} from '../engine/scenarios/classroom.ts';
import type { Observation, Reply, Request } from './types.ts';
const reply: Reply = {
  choice: 'HOLD',
  model: 'mock',
  inputTokens: 2,
  outputTokens: 1,
  latencyMs: 10,
  costUSD: 0,
};
function observation(time = 0): Observation {
  return {
    schema: 'mars-camera-observation/1',
    session: 'test-1',
    tick: Math.round(time * 20),
    time,
    semanticVersion: 1,
    geometryVersion: 1,
    eventCursor: 1,
    subjects: {
      a: { p: [0, 0, 0], yaw: 0, kind: 'human', height: 1.7 },
      b: { p: [3, 0, 0], yaw: 0, kind: 'human', height: 1.7 },
    },
    activity: {
      phase: 'presenting',
      speaker: 'a',
      focus: 'a',
      members: ['a', 'b'],
      departing: [],
    },
    scene: {
      bounds: [-20, -20, 20, 20],
      levels: [],
      surfaces: [],
      obstacles: [],
      links: [],
    },
  };
}
void test('camera observation never mutates engine world; explicit same-tick reset changes epoch', () => {
  const world = classroomWorld(),
    before = JSON.stringify(world),
    a = new Observer();
  a.reset('one');
  const scene = cameraScene(world, classroomScene());
  const first = a.read(world, 0, 0, scene);
  a.reset('two');
  const second = a.read(world, 0, 0, scene);
  assert.notEqual(first.session, second.session);
  assert.equal(JSON.stringify(world), before);
  assert.equal(first.semanticVersion, 1);
});
void test('pose ticks do not bump semantic version; geometry change does', () => {
  const world = classroomWorld(),
    a = new Observer();
  a.reset('one');
  const first = a.read(world, 0, 0, classroomScene());
  world.entities.guest1.pose.p[0] += 1;
  assert.equal(
    a.read(world, 1, 0.05, classroomScene()).semanticVersion,
    first.semanticVersion,
  );
  assert.equal(
    a.read(world, 2, 0.1, classroomScene(), undefined, 2).semanticVersion,
    first.semanticVersion + 1,
  );
});
void test('minimum hold refuses rapid focus cuts; releases once meaning changes', () => {
  const d = new Director('clear');
  d.update(observation());
  const id = d.selectedId;
  const next = observation(1);
  next.activity = { ...next.activity, phase: 'question', focus: 'b' };
  next.semanticVersion = 2;
  d.update(next);
  assert.equal(d.selectedId, id);
  next.time = 5;
  next.tick = 100;
  d.update(next);
  assert.match(d.selectedId!, /b/);
});
void test('restrained policy holds longer and is editorially different', () => {
  const a = new Director('clear'),
    b = new Director('restrained');
  a.update(observation());
  b.update(observation());
  assert.notEqual(a.selectedId, b.selectedId);
  const next = observation(5);
  next.activity = { ...next.activity, phase: 'question', focus: 'b' };
  const id = b.selectedId;
  b.update(next);
  assert.equal(b.selectedId, id);
});
void test('operator subject wins then explicit expiry returns to auto', () => {
  const d = new Director();
  d.update(observation());
  d.takeover({ subject: 'b', expires: 3 });
  d.update(observation(1));
  assert.ok(d.current?.subjects.includes('b'));
  const epoch = d.epoch;
  d.update(observation(4));
  assert.equal(d.operator, undefined);
  assert.ok(d.epoch > epoch);
  assert.ok(d.current?.subjects.includes('a'));
});
void test('manual pose validates even when operator owns shot', () => {
  const d = new Director();
  d.takeover({
    pose: { position: [0, -1, 0], target: [0, 1, 0], fov: 45 },
    expires: 8,
  });
  const out = d.update(observation());
  assert.ok(out.pose); // initial session reset deliberately clears previous control
  d.takeover({
    pose: { position: [0, -1, 0], target: [0, 1, 0], fov: 45 },
    expires: 8,
  });
  assert.equal(d.update(observation(1)).pose, undefined);
  assert.match(d.diagnostics.at(-1)!, /placement-invalid/);
});
void test('external stale semantic version and operator epoch discarded', () => {
  const d = new Director();
  d.update(observation());
  const req = d.request()!;
  d.accept({ ...reply, choice: 'follow:b' }, req);
  const next = observation(5);
  next.semanticVersion = 2;
  d.update(next);
  assert.match(d.diagnostics.at(-1)!, /external-stale/);
  d.accept({ ...reply, choice: 'follow:b' }, d.request()!);
  d.takeover({ subject: 'a', expires: 10 });
  d.update(observation(6));
  assert.equal(d.current?.subjects.includes('b'), false);
});
void test('external unknown choice falls back without changing local director', () => {
  const d = new Director();
  d.update(observation());
  d.accept({ ...reply, choice: 'INVALID' }, d.request()!);
  d.update(observation(5));
  assert.match(d.diagnostics.at(-1)!, /external-invalid/);
  assert.ok(d.pose);
});
void test('accepted external decisions are logged with application time', () => {
  const d = new Director();
  d.update(observation());
  const req = d.request()!;
  d.accept({ ...reply, choice: 'follow:b' }, req);
  d.update(observation(5));
  const applied = d.decisions.at(-1)!;
  assert.equal(applied.source, 'external');
  assert.equal(applied.time, 5);
  assert.equal(applied.shot, 'follow:b');
});
void test('invalid geometry and NaN never admitted', () => {
  const o = observation();
  assert.equal(
    safePose(o, { position: [NaN, 1, 0], target: [0, 0, 0], fov: 45 }),
    false,
  );
  assert.equal(
    safePose(o, { position: [0, 1, 0], target: [1, 1, 0], fov: 45 }),
    false,
  );
  assert.ok(feasibleShots(o).every((s) => safePose(o, s.pose)));
});
void test('continuous crossing of wall is explicitly a cut', () => {
  const o = observation();
  o.subjects = {};
  o.scene.obstacles = [
    { id: 'wall', obb: { c: [0, 0], half: [0.1, 4], yaw: 0 }, y0: 0, y1: 4 },
  ];
  const out = execute(
    o,
    { position: [-2, 2, 0], target: [-3, 2, 0], fov: 45 },
    { position: [2, 2, 0], target: [3, 2, 0], fov: 45 },
    false,
    3,
    [],
  );
  assert.equal(out.cut, true);
  assert.match(out.reason, /sweep-cut/);
});
void test('occlusion admits alternate framing; moving furniture invalidates previous pose', () => {
  const o = observation(),
    shots = feasibleShots(o);
  assert.ok(shots.length);
  const p = shots[0].pose.position;
  o.scene.obstacles.push({
    id: 'moved-furniture',
    obb: { c: [p[0], p[2]], half: [1, 1], yaw: 0 },
    y0: 0,
    y1: 10,
  });
  assert.equal(safePose(o, shots[0].pose), false);
  const newer = feasibleShots(o);
  assert.ok(newer.length);
  assert.ok(newer.every((s) => safePose(o, s.pose)));
});
void test('no feasible placement yields explicit limitation', () => {
  const o = observation();
  o.scene.obstacles = [
    {
      id: 'solid-room',
      obb: { c: [0, 0], half: [100, 100], yaw: 0 },
      y0: 0,
      y1: 100,
    },
  ];
  const d = new Director();
  const out = d.update(o);
  assert.equal(out.pose, undefined);
  assert.match(out.reason, /no-feasible/);
});
void test('recorded program frames replay cuts without interpolation through wall', () => {
  const a = {
      position: [-2, 2, 0] as [number, number, number],
      target: [0, 1, 0] as [number, number, number],
      fov: 45,
    },
    b = { ...a, position: [2, 2, 0] as [number, number, number] };
  const frames = [
    { time: 0, pose: a, cut: false },
    { time: 2, pose: b, cut: true },
  ];
  assert.deepEqual(replayFrame(frames, 1)?.pose, a);
  assert.deepEqual(replayFrame(frames, 2)?.pose, b);
});
const request = (): Request => {
  const d = new Director();
  d.update(observation());
  return d.request()!;
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
void test('single in-flight and1Hz cap; asynchronous failure leaves local camera live', async () => {
  let resolve!: (r: Reply) => void;
  const a = new Advisory({ choose: () => new Promise((r) => (resolve = r)) });
  let applied = 0;
  assert.equal(
    a.ask(request(), 0, () => applied++),
    true,
  );
  assert.equal(
    a.ask(request(), 2000, () => applied++),
    false,
  );
  resolve(reply);
  await wait(1);
  assert.equal(applied, 1);
  assert.equal(
    a.ask(request(), 200, () => applied++),
    false,
  );
  a.dispose();
  const fail = new Advisory({
    choose: async () => {
      throw Error('network');
    },
  });
  fail.ask(request(), 0, () => assert.fail());
  await wait(1);
  assert.equal(fail.failures, 1);
  assert.ok(new Director().update(observation()).pose);
  fail.dispose();
});
void test('timeout/cleanup aborts transport; disposed response never applied', async () => {
  let aborted = false;
  const a = new Advisory(
    {
      choose: (_, signal) =>
        new Promise((_, reject) =>
          signal.addEventListener('abort', () => {
            aborted = true;
            reject(Error('aborted'));
          }),
        ),
    },
    10,
  );
  a.ask(request(), 0, () => assert.fail());
  await wait(20);
  assert.equal(aborted, true);
  assert.equal(a.busy, false);
  assert.equal(a.failures, 1);
  a.dispose();
  assert.equal(
    a.ask(request(), 2000, () => assert.fail()),
    false,
  );
});
void test('physical recovery cut resets editorial hold', () => {
  const d = new Director();
  const o = observation();
  d.update(o);
  const next = observation(10);
  const p = d.pose!.position;
  next.scene.obstacles = [
    {
      id: 'camera obstruction',
      obb: { c: [p[0], p[2]], half: [0.4, 0.4], yaw: 0 },
      y0: 0,
      y1: 10,
    },
  ];
  const result = d.update(next);
  assert.equal(result.cut, true);
  assert.equal(d.since, 10);
});
void test('operator stillness pins a valid pose through moving semantic subjects', () => {
  const d = new Director();
  d.update(observation());
  const pose = structuredClone(d.pose!);
  d.takeover({ movement: 'still', expires: 10 });
  const next = observation(1);
  next.subjects.a.p[0] += 1;
  d.update(next);
  assert.deepEqual(d.pose, pose);
});
void test('Jev reserves costs before overlapping calls and accounts unknown outcomes offline', async () => {
  const original = globalThis.fetch;
  let finish: ((response: Response) => void) | undefined;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Promise<Response>((resolve) => {
      finish = resolve;
    });
  };
  try {
    const provider = new JevProvider('mock-only', {
      budgetUSD: 0.003,
      maxCalls: 2,
    });
    const first = provider.choose(request(), new AbortController().signal);
    await assert.rejects(
      provider.choose(request(), new AbortController().signal),
      /spending-cap/,
    );
    assert.equal(calls, 1);
    finish!(
      Response.json({
        model: 'jev-1.13.0',
        answers: { shot: { type: 'choice', choice: 'HOLD' } },
        usage: { input_tokens: 100, output_tokens: 1 },
      }),
    );
    await first;
    assert.equal(provider.inputTokens, 100);
    assert.equal(provider.reservedUSD, 0);
    globalThis.fetch = async () => {
      throw Error('offline simulated network error');
    };
    await assert.rejects(
      provider.choose(request(), new AbortController().signal),
    );
    assert.equal(provider.reservedUSD, 0);
    assert.ok(provider.costUSD > 0.0026);
    await assert.rejects(
      provider.choose(request(), new AbortController().signal),
      /call-cap/,
    );
  } finally {
    globalThis.fetch = original;
  }
});
