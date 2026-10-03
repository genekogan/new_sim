import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openJamRuntime, openJamBinding } from '../scenarios/open-jam.ts';
import { readOpenJam } from '../activities/open-jam.ts';
import { musicStation } from '../activities/computer-music.ts';
import { hashOf } from '../core/hash.ts';
import { canonicalEntityOrder, type Runtime } from '../runtime/runtime.ts';
import { human } from '../world/factory.ts';
function until(rt: Runtime, condition: () => boolean, ticks = 6500) {
  for (let i = 0; i < ticks && !condition(); i++) {
    rt.step();
    assert.deepEqual(rt.violations, []);
  }
  assert.ok(
    condition(),
    JSON.stringify(
      [...rt.records.values()].map((r) => [
        r.verb,
        r.status,
        r.phase,
        r.diagnostic,
      ]),
    ),
  );
}
function clean(rt: Runtime) {
  for (const actor of [
    'musician',
    'guest-musician',
    'listener',
    'dancer-a',
    'dancer-b',
  ]) {
    assert.deepEqual(rt.holder(`actor:${actor}`), []);
    assert.equal(rt.world.entities[actor].human!.hands, undefined);
  }
  for (const resource of [
    'open-jam:music-computer',
    'music:music-computer',
    'music-gathering:music-computer',
    'entity:music-computer',
    'slot:music-chair#seat',
    'slot:listener-chair#seat',
  ])
    assert.deepEqual(rt.holder(resource), []);
  assert.ok([...rt.records.values()].every((r) => !rt.isActive(r.id)));
}
for (const yaw of [0, Math.PI / 2])
  test(`two ordinary performer handoffs preserve computer/chair at ${yaw}`, () => {
    const rt = openJamRuntime(yaw),
      ids = Object.keys(rt.world.entities).sort(),
      before = structuredClone(rt.world.entities['music-computer'].pose),
      r = rt.submit('open_jam', openJamBinding(yaw));
    assert.notEqual(r.status, 'failed', r.diagnostic?.message);
    until(rt, () => !rt.isActive(r.id));
    assert.equal(r.status, 'completed', r.diagnostic?.message);
    assert.deepEqual(
      readOpenJam(rt, r.id)!.finished.map((s) => [s.actor, s.playedSeconds]),
      [
        ['musician', 12],
        ['guest-musician', 14],
      ],
    );
    assert.deepEqual(Object.keys(rt.world.entities).sort(), ids);
    assert.deepEqual(rt.world.entities['music-computer'].pose, before);
    clean(rt);
  });
test('pause/resume retains current score and completed round history', () => {
  const rt = openJamRuntime(),
    r = rt.submit('open_jam', openJamBinding());
  until(rt, () => {
    const m = musicStation(rt, 'music-computer');
    return !!m && !('code' in m) && m.elapsed >= 3;
  });
  rt.submit('open_jam_control', { jam: r.id, command: 'pause' });
  until(rt, () => readOpenJam(rt, r.id)?.mode === 'paused');
  const stopped = musicStation(rt, 'music-computer');
  assert.ok(stopped && !('code' in stopped));
  assert.equal(stopped.status, 'unfinished');
  assert.deepEqual(rt.holder('actor:musician'), []);
  rt.submit('open_jam_control', { jam: r.id, command: 'resume' });
  until(rt, () => readOpenJam(rt, r.id)!.finished.length === 1);
  const first = structuredClone(readOpenJam(rt, r.id)!.finished);
  until(
    rt,
    () =>
      readOpenJam(rt, r.id)!.index === 1 &&
      readOpenJam(rt, r.id)!.mode === 'playing',
  );
  rt.submit('open_jam_control', { jam: r.id, command: 'pause' });
  until(rt, () => readOpenJam(rt, r.id)?.mode === 'paused');
  assert.deepEqual(readOpenJam(rt, r.id)!.finished, first);
  rt.submit('open_jam_control', { jam: r.id, command: 'resume' });
  until(rt, () => !rt.isActive(r.id));
  assert.equal(r.status, 'completed');
  clean(rt);
});
test('end releases physical children while retaining completed/unfinished effects', () => {
  const rt = openJamRuntime(),
    r = rt.submit('open_jam', openJamBinding());
  until(rt, () => {
    const s = musicStation(rt, 'music-computer');
    return !!s && !('code' in s) && s.elapsed >= 2;
  });
  rt.submit('open_jam_control', { jam: r.id, command: 'end' });
  until(rt, () => !rt.isActive(r.id));
  assert.equal(r.status, 'cancelled');
  const station = musicStation(rt, 'music-computer');
  assert.ok(station && !('code' in station));
  assert.equal(station.status, 'unfinished');
  clean(rt);
});
test('duplicate performers and unavailable equipment decline before acquiring resources', () => {
  const rt = openJamRuntime(),
    p = openJamBinding();
  p.rounds[1].actor = p.rounds[0].actor;
  assert.equal(
    rt.submit('open_jam', p).diagnostic?.code,
    'open-jam.duplicate-role',
  );
  rt.world.entities['music-computer'].equipment = {
    kind: 'workstation',
    config: { available: false },
  };
  assert.equal(
    rt.submit('open_jam', openJamBinding()).diagnostic?.code,
    'workstation.unavailable',
  );
  clean(rt);
});
test('same decisions reproduce same authoritative world and round history', () => {
  const run = () => {
    const rt = openJamRuntime(),
      r = rt.submit('open_jam', openJamBinding());
    until(rt, () => !rt.isActive(r.id));
    return hashOf({ world: rt.world, jam: readOpenJam(rt, r.id) });
  };
  assert.equal(run(), run());
});
test('directing a performer pauses the jam until explicit resumption', () => {
  const rt = openJamRuntime(),
    r = rt.submit('open_jam', openJamBinding());
  until(rt, () => {
    const s = musicStation(rt, 'music-computer');
    return !!s && !('code' in s) && s.elapsed >= 2;
  });
  const directed = rt.submit('walk_to', { actor: 'musician', x: 6, z: -4 });
  assert.notEqual(directed.status, 'failed', directed.diagnostic?.message);
  until(
    rt,
    () =>
      directed.status === 'completed' &&
      readOpenJam(rt, r.id)?.mode === 'paused',
  );
  assert.equal(
    readOpenJam(rt, r.id)?.diagnostic?.code,
    'open-jam.performer-directed',
  );
  const stopped = hashOf(rt.world.entities);
  for (let i = 0; i < 40; i++) rt.step();
  assert.equal(hashOf(rt.world.entities), stopped);
  rt.submit('open_jam_control', { jam: r.id, command: 'resume' });
  until(rt, () => !rt.isActive(r.id));
  assert.equal(r.status, 'completed');
  clean(rt);
});
test('an occupied next chair waits truthfully, then ordinary handoff recovers', () => {
  const rt = openJamRuntime();
  rt.world.entities.spectator = human('spectator', 7, 5);
  canonicalEntityOrder(rt.world);
  const r = rt.submit('open_jam', openJamBinding());
  until(
    rt,
    () =>
      readOpenJam(rt, r.id)!.index === 1 &&
      readOpenJam(rt, r.id)!.mode === 'binding',
  );
  const occupying = rt.submit(
    'sit',
    { actor: 'spectator', slot: 'music-chair#seat' },
    { preempt: false },
  );
  assert.notEqual(occupying.status, 'failed', occupying.diagnostic?.message);
  until(
    rt,
    () => occupying.phase === 'occupied' && !!readOpenJam(rt, r.id)!.diagnostic,
  );
  assert.equal(
    readOpenJam(rt, r.id)!.diagnostic!.code,
    'workstation.seat-occupied',
  );
  assert.equal(readOpenJam(rt, r.id)!.finished.length, 1);
  const clear = rt.submit('walk_to', { actor: 'spectator', x: 7, z: 5 });
  assert.notEqual(clear.status, 'failed', clear.diagnostic?.message);
  until(rt, () => !rt.isActive(r.id));
  assert.equal(r.status, 'completed');
  until(rt, () => !rt.isActive(clear.id));
  clean(rt);
});
test('unavailable equipment between rounds waits with retained completion', () => {
  const rt = openJamRuntime(),
    r = rt.submit('open_jam', openJamBinding());
  until(
    rt,
    () =>
      readOpenJam(rt, r.id)!.finished.length === 1 &&
      readOpenJam(rt, r.id)!.mode === 'clearing',
  );
  rt.world.entities['music-computer'].equipment!.config.available = false;
  until(
    rt,
    () => readOpenJam(rt, r.id)!.diagnostic?.code === 'workstation.unavailable',
  );
  assert.equal(readOpenJam(rt, r.id)!.finished.length, 1);
  rt.world.entities['music-computer'].equipment!.config.available = true;
  until(rt, () => !rt.isActive(r.id));
  assert.equal(r.status, 'completed');
  clean(rt);
});
test('a dancer who leaves is not silently invited into the next round', () => {
  const rt = openJamRuntime(),
    r = rt.submit('open_jam', openJamBinding());
  until(
    rt,
    () => readOpenJam(rt, r.id)?.current?.dancers[0].state === 'dancing',
  );
  const leave = rt.submit('music_gathering_control', {
    gathering: readOpenJam(rt, r.id)!.current!.action,
    actor: 'dancer-a',
    command: 'leave',
  });
  until(
    rt,
    () =>
      leave.status === 'completed' &&
      readOpenJam(rt, r.id)!.departed.includes('dancer-a'),
  );
  until(
    rt,
    () =>
      readOpenJam(rt, r.id)!.index === 1 &&
      readOpenJam(rt, r.id)!.mode === 'playing',
  );
  assert.equal(readOpenJam(rt, r.id)!.current!.bindings.dancers[0].join, false);
  assert.deepEqual(rt.holder('actor:dancer-a'), []);
  until(rt, () => !rt.isActive(r.id));
  assert.equal(r.status, 'completed');
  clean(rt);
});
test('Pause at a completed-child boundary never repeats the finished score', () => {
  const rt = openJamRuntime(),
    r = rt.submit('open_jam', openJamBinding());
  until(rt, () => {
    const s = readOpenJam(rt, r.id);
    return s?.mode === 'playing' && s.current?.status === 'completed';
  });
  rt.submit('open_jam_control', { jam: r.id, command: 'pause' });
  until(rt, () => readOpenJam(rt, r.id)!.mode === 'paused');
  assert.equal(readOpenJam(rt, r.id)!.finished.length, 1);
  rt.submit('open_jam_control', { jam: r.id, command: 'resume' });
  until(rt, () => !rt.isActive(r.id));
  assert.equal(readOpenJam(rt, r.id)!.finished.length, 2);
  assert.equal(
    [...rt.records.values()].filter(
      (r) =>
        r.verb === 'computer_music' &&
        (r.params as { performer: string }).performer === 'musician',
    ).length,
    1,
  );
  clean(rt);
});
test('rapid accepted dancer Leave then performer direction retains departure across rounds', () => {
  const rt = openJamRuntime(), r = rt.submit('open_jam', openJamBinding());
  until(rt, () => readOpenJam(rt, r.id)?.current?.dancers[0].state === 'dancing');
  const leave = rt.submit('music_gathering_control', { gathering: readOpenJam(rt, r.id)!.current!.action, actor: 'dancer-a', command: 'leave' });
  const directed = rt.submit('walk_to', { actor: 'musician', x: 6, z: -4 });
  until(rt, () => directed.status === 'completed' && readOpenJam(rt, r.id)?.mode === 'paused');
  assert.equal(leave.status, 'completed', leave.diagnostic?.message);
  assert.ok(readOpenJam(rt, r.id)!.departed.includes('dancer-a'));
  rt.submit('open_jam_control', { jam: r.id, command: 'resume' });
  until(rt, () => readOpenJam(rt, r.id)!.index === 1 && readOpenJam(rt, r.id)!.mode === 'playing');
  assert.equal(readOpenJam(rt, r.id)!.current!.bindings.dancers[0].join, false);
  assert.deepEqual(rt.holder('actor:dancer-a'), []);
  until(rt, () => !rt.isActive(r.id)); assert.equal(r.status, 'completed'); clean(rt);
});
