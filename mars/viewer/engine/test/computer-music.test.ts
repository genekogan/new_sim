import { test } from 'node:test';
import assert from 'node:assert/strict';
import { musicRuntime, MUSIC_BINDING } from '../scenarios/computer-music.ts';
import {
  MUSIC_SCORES,
  musicStation,
  readComputerMusic,
} from '../activities/computer-music.ts';
import { readWorkstation } from '../objects/workstation.ts';
import { Runtime } from '../runtime/runtime.ts';
import { SnapshotError } from '../runtime/snapshot.ts';
import { createRegistry, ENGINE_INVARIANTS } from '../api/registry.ts';
import { READING_SCENE } from '../scenarios/reading.ts';
import { Spatial } from '../spatial/service.ts';
function station(rt: Runtime) {
  const s = musicStation(rt, MUSIC_BINDING.station);
  assert.ok(s && !('code' in s));
  return s;
}
function until(rt: Runtime, done: () => boolean) {
  for (let i = 0; i < 5000 && !done(); i++) rt.step();
  assert.ok(done(), 'bounded completion');
  assert.deepEqual(rt.violations, []);
}
function clean(rt: Runtime) {
  for (const actor of ['musician', 'listener-a', 'listener-b'])
    assert.deepEqual(rt.holder(`actor:${actor}`), []);
  for (const seat of ['music-chair', 'listener-chair-a', 'listener-chair-b'])
    assert.deepEqual(rt.holder(`slot:${seat}#seat`), []);
  assert.deepEqual(rt.holder('entity:music-computer'), []);
  assert.deepEqual(rt.holder('music:music-computer'), []);
  assert.deepEqual(rt.violations, []);
}
for (const yaw of [0, Math.PI / 2])
  test(`ordinary computer execution and optional listening complete with coherent score at yaw ${yaw}`, () => {
    const rt = musicRuntime(yaw),
      pose = structuredClone(rt.world.entities['music-computer'].pose),
      a = rt.submit('computer_music', MUSIC_BINDING),
      notes = new Set<number>();
    let heard = false;
    until(rt, () => {
      const s = musicStation(rt, MUSIC_BINDING.station);
      if (s && !('code' in s) && s.note !== null) {
        notes.add(s.note);
        heard ||= readComputerMusic(rt, a.id)!.listeners.every(
          (l) => l.state === 'listening',
        );
      }
      return !rt.isActive(a.id);
    });
    assert.equal(a.status, 'completed', a.diagnostic?.message);
    assert.equal(a.outputs?.finished, true);
    assert.equal(station(rt).elapsed, 24);
    assert.equal(station(rt).note, null);
    assert.deepEqual([...notes], [...new Set(MUSIC_SCORES.gentle)]);
    assert.ok(heard);
    assert.deepEqual(rt.world.entities['music-computer'].pose, pose);
    clean(rt);
  });
test('interruption safely releases children and quiescent JSON restore resumes the same recorded program', () => {
  const rt = musicRuntime(),
    a = rt.submit('computer_music', MUSIC_BINDING);
  until(rt, () => {
    const s = musicStation(rt, MUSIC_BINDING.station);
    return !!s && !('code' in s) && s.elapsed >= 4;
  });
  const hash = rt.stateHash();
  assert.throws(
    () => rt.snapshot({ allowDrop: true }),
    (e) =>
      e instanceof SnapshotError &&
      e.code === 'snapshot.drop-unsafe' &&
      e.subjects.includes(MUSIC_BINDING.station),
  );
  assert.equal(rt.stateHash(), hash);
  rt.cancel(a.id);
  until(rt, () => !rt.isActive(a.id));
  assert.equal(a.status, 'cancelled');
  assert.equal(station(rt).status, 'unfinished');
  assert.equal(station(rt).note, null);
  clean(rt);
  const copy = Runtime.restore(
    JSON.parse(JSON.stringify(rt.snapshot())),
    createRegistry(),
    { spatial: new Spatial(READING_SCENE) },
    ENGINE_INVARIANTS,
  );
  assert.deepEqual(station(copy), station(rt));
  assert.equal(
    copy.submit('computer_music', {
      ...MUSIC_BINDING,
      resume: true,
      period: 0.75,
    }).diagnostic?.code,
    'music.unfinished-program',
  );
  const b = copy.submit('computer_music', { ...MUSIC_BINDING, resume: true });
  until(copy, () => !copy.isActive(b.id));
  assert.equal(b.status, 'completed', b.diagnostic?.message);
  assert.equal(station(copy).elapsed, 24);
  clean(copy);
});
test('a directed listener leaves while performer purpose and the other listener continue', () => {
  const rt = musicRuntime(),
    a = rt.submit('computer_music', MUSIC_BINDING);
  until(
    rt,
    () =>
      readComputerMusic(rt, a.id)?.listeners.every(
        (l) => l.state === 'listening',
      ) ?? false,
  );
  const walk = rt.submit('walk_to', { actor: 'listener-a', x: -6, z: -4 });
  until(rt, () => !rt.isActive(walk.id));
  assert.equal(walk.status, 'completed', walk.diagnostic?.message);
  assert.ok(rt.isActive(a.id));
  assert.equal(readComputerMusic(rt, a.id)!.listeners[0].state, 'left');
  assert.equal(readComputerMusic(rt, a.id)!.listeners[1].state, 'listening');
  until(rt, () => !rt.isActive(a.id));
  assert.equal(a.status, 'completed');
  assert.equal(station(rt).elapsed, 24);
  clean(rt);
});
test('player control of performer drains owned audience and retains unfinished music instead of competing for movement', () => {
  const rt = musicRuntime(),
    a = rt.submit('computer_music', MUSIC_BINDING);
  until(rt, () => {
    const s = musicStation(rt, MUSIC_BINDING.station);
    return !!s && !('code' in s) && s.elapsed >= 2;
  });
  const walk = rt.submit('walk_to', { actor: 'musician', x: 6, z: -4 });
  until(rt, () => !rt.isActive(walk.id) && !rt.isActive(a.id));
  assert.equal(walk.status, 'completed', walk.diagnostic?.message);
  assert.equal(a.status, 'cancelled');
  assert.equal(a.diagnostic?.code, 'music.directed-away');
  assert.equal(station(rt).status, 'unfinished');
  assert.equal(station(rt).note, null);
  clean(rt);
});
test('duplicate roles, missing computer and incompatible chairs refuse without world mutation', () => {
  for (const variant of [
    {
      ...MUSIC_BINDING,
      listeners: [{ actor: 'musician', seat: 'listener-chair-a#seat' }],
    },
    { ...MUSIC_BINDING, station: 'missing' },
  ]) {
    const rt = musicRuntime(),
      before = rt.stateHash(),
      a = rt.submit('computer_music', variant);
    assert.equal(a.status, 'failed');
    assert.equal(rt.stateHash(), before);
    assert.equal(rt.records.size, 1);
  }
  const rt = musicRuntime();
  rt.world.entities['listener-chair-a'].pose.yaw = Math.PI;
  const before = rt.stateHash();
  assert.equal(
    rt.submit('computer_music', MUSIC_BINDING).diagnostic?.code,
    'music.listener-facing',
  );
  assert.equal(rt.stateHash(), before);
});
test('foreign occupied participant is preserved; no failed start cancels its seat hold', () => {
  const rt = musicRuntime(),
    seat = rt.submit('sit', {
      actor: 'listener-a',
      slot: 'listener-chair-a#seat',
    });
  until(rt, () => seat.phase === 'occupied');
  const before = rt.stateHash();
  assert.equal(
    rt.submit('computer_music', MUSIC_BINDING).diagnostic?.code,
    'music.listener-busy',
  );
  assert.equal(rt.stateHash(), before);
  assert.ok(rt.isActive(seat.id));
  assert.deepEqual(rt.holder('actor:listener-a'), [seat.id]);
});
test('unavailable computer mid-performance retains owned progress and cleans listener resources', () => {
  const rt = musicRuntime(),
    a = rt.submit('computer_music', MUSIC_BINDING);
  until(rt, () => {
    const s = musicStation(rt, MUSIC_BINDING.station);
    return !!s && !('code' in s) && s.elapsed >= 2;
  });
  rt.world.entities[MUSIC_BINDING.station].equipment!.config.available = false;
  assert.equal(
    station(rt).note,
    null,
    'unavailable output stops before the next physical cleanup tick',
  );
  until(rt, () => !rt.isActive(a.id));
  assert.equal(a.status, 'failed');
  assert.equal(a.diagnostic?.code, 'workstation.unavailable');
  assert.equal(station(rt).status, 'unfinished');
  assert.equal(station(rt).note, null);
  clean(rt);
});
test('solo variation and recorded repeated music decisions are deterministic', () => {
  function run() {
    const rt = musicRuntime(),
      a = rt.submit('computer_music', {
        ...MUSIC_BINDING,
        listeners: [],
        score: 'bright',
        period: 0.75,
        duration: 8,
      });
    until(rt, () => !rt.isActive(a.id));
    assert.equal(a.status, 'completed', a.diagnostic?.message);
    clean(rt);
    return { hash: rt.stateHash(), records: [...rt.records.values()] };
  }
  assert.deepEqual(run(), run());
});
test('a human-readable work label alone does not create a music capability or audible output', () => {
  const rt = musicRuntime(),
    a = rt.submit('work_at', {
      actor: 'musician',
      station: MUSIC_BINDING.station,
      seat: MUSIC_BINDING.seat,
      duration: 2,
      task: 'Electronic music · gentle',
    });
  until(rt, () => {
    const s = readWorkstation(rt, MUSIC_BINDING.station);
    return !('code' in s) && s.elapsed >= 0.5;
  });
  const before = rt.stateHash();
  assert.equal(musicStation(rt, MUSIC_BINDING.station), undefined);
  assert.equal(rt.stateHash(), before);
  rt.cancel(a.id);
  until(rt, () => !rt.isActive(a.id));
  clean(rt);
});

test('completed music metadata cannot turn a later identically labelled ordinary task into performance', () => {
  const rt = musicRuntime(),
    a = rt.submit('computer_music', {
      ...MUSIC_BINDING,
      listeners: [],
      duration: 2,
    });
  until(rt, () => !rt.isActive(a.id));
  const task = readWorkstation(rt, MUSIC_BINDING.station);
  assert.ok(!('code' in task));
  const work = rt.submit('work_at', {
    actor: 'musician',
    station: MUSIC_BINDING.station,
    seat: MUSIC_BINDING.seat,
    duration: 2,
    task: task.task,
  });
  until(rt, () => {
    const s = readWorkstation(rt, MUSIC_BINDING.station);
    return !('code' in s) && s.phase === 'working';
  });
  assert.equal(musicStation(rt, MUSIC_BINDING.station), undefined);
  rt.cancel(work.id);
  until(rt, () => !rt.isActive(work.id));
  clean(rt);
});
