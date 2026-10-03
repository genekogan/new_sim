import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  musicGatheringRuntime,
  musicGatheringBinding,
} from '../scenarios/music-gathering.ts';
import {
  readMusicGathering,
  musicGatheringAttention,
  DANCE_RELEASE_TIME,
} from '../activities/music-gathering.ts';
import { musicStation } from '../activities/computer-music.ts';
import { hashOf } from '../core/hash.ts';
import { DT, type Runtime } from '../runtime/runtime.ts';
import { itemEntity, putInHand } from '../items/model.ts';
import { FIXTURE } from '../world/factory.ts';
import { SnapshotError } from '../runtime/snapshot.ts';
import { dist3 } from '../items/body.ts';
import { MAX_HUMAN_STEP_PER_TICK } from '../runtime/invariants.ts';
function until(rt: Runtime, condition: () => boolean, ticks = 5000) {
  for (let i = 0; i < ticks && !condition(); i++) rt.step();
  assert.ok(condition(), 'bounded condition');
  assert.deepEqual(rt.violations, []);
}
function state(rt: Runtime) {
  const s = musicStation(rt, 'music-computer');
  assert.ok(s && !('code' in s));
  return s;
}
function elapsedSeconds(rt: Runtime) {
  const s = musicStation(rt, 'music-computer');
  return s && !('code' in s) ? s.elapsed : 0;
}
function clean(rt: Runtime) {
  for (const actor of ['musician', 'listener', 'dancer-a', 'dancer-b']) {
    assert.deepEqual(rt.holder(`actor:${actor}`), []);
    assert.equal(rt.world.entities[actor].human!.hands, undefined);
  }
  for (const resource of [
    'music:music-computer',
    'music-gathering:music-computer',
    'entity:music-computer',
    'slot:music-chair#seat',
    'slot:listener-chair#seat',
  ])
    assert.deepEqual(rt.holder(resource), []);
  for (const r of rt.records.values())
    assert.equal(rt.isActive(r.id), false, `${r.id} still active`);
  assert.deepEqual(rt.violations, []);
}
for (const yaw of [0, Math.PI / 2])
  test(`complete four-person gathering at orientation ${yaw}`, () => {
    const rt = musicGatheringRuntime(yaw),
      p = musicGatheringBinding(yaw),
      r = rt.submit('music_gathering', p);
    assert.notEqual(r.status, 'failed', r.diagnostic?.message);
    until(
      rt,
      () => readMusicGathering(rt, r.id)?.dancers[0].state === 'dancing',
    );
    const join = rt.submit('music_gathering_control', {
      gathering: r.id,
      actor: 'dancer-b',
      command: 'join',
    });
    until(
      rt,
      () =>
        join.status === 'completed' &&
        readMusicGathering(rt, r.id)?.dancers[1].state === 'dancing',
    );
    const poses = p.dancers.map((d) =>
      structuredClone(rt.world.entities[d.actor].pose),
    );
    const first = rt.world.entities['dancer-a'].human!.hands!.left!,
      floors = new Set<string>();
    for (let i = 0; i < 100; i++) {
      rt.step();
      const s = readMusicGathering(rt, r.id)!;
      if (s.floorHolder) floors.add(s.floorHolder);
    }
    assert.notDeepEqual(
      rt.world.entities['dancer-a'].human!.hands!.left,
      first,
      'rhythm changes arm pose',
    );
    assert.deepEqual(
      p.dancers.map((d) => rt.world.entities[d.actor].pose),
      poses,
      'expression never moves roots',
    );
    assert.ok(floors.size >= 2, 'floor attention rotates');
    assert.ok(Object.keys(musicGatheringAttention(rt, r.id)).length >= 2);
    until(rt, () => !rt.isActive(r.id));
    assert.equal(r.status, 'completed', r.diagnostic?.message);
    assert.equal(state(rt).elapsed, 36);
    clean(rt);
  });
test('individual late join and leave preserve steady performer/listener/other dancer progress', () => {
  const rt = musicGatheringRuntime(),
    r = rt.submit('music_gathering', musicGatheringBinding());
  until(rt, () => elapsedSeconds(rt) >= 3);
  const before = state(rt).elapsed;
  const joined = rt.submit('music_gathering_control', {
    gathering: r.id,
    actor: 'dancer-b',
    command: 'join',
  });
  until(
    rt,
    () =>
      joined.status === 'completed' &&
      readMusicGathering(rt, r.id)!.dancers[1].state === 'dancing',
  );
  const leave = rt.submit('music_gathering_control', {
    gathering: r.id,
    actor: 'dancer-a',
    command: 'leave',
  });
  until(
    rt,
    () =>
      leave.status === 'completed' && rt.holder('actor:dancer-a').length === 0,
  );
  assert.ok(state(rt).elapsed > before);
  assert.equal(readMusicGathering(rt, r.id)!.dancers[1].state, 'dancing');
  assert.equal(rt.world.entities.listener.human!.activity, 'sit');
  until(rt, () => !rt.isActive(r.id));
  clean(rt);
});
for (const elapsed of [0, 4])
  test(`safe Pause and same-score Resume after ${elapsed}s`, () => {
    const rt = musicGatheringRuntime(),
      p = musicGatheringBinding(),
      r = rt.submit('music_gathering', p);
    if (elapsed) until(rt, () => elapsedSeconds(rt) >= elapsed);
    else until(rt, () => musicStation(rt, 'music-computer') !== undefined);
    rt.cancel(r.id);
    until(rt, () => !rt.isActive(r.id));
    assert.equal(r.status, 'cancelled');
    clean(rt);
    const stopped = state(rt).elapsed,
      config = structuredClone(
        rt.world.entities['music-computer'].equipment!.config,
      );
    const resumed = rt.submit('music_gathering', {
      ...p,
      resume: true,
      resumeFrom: r.id,
    });
    assert.notEqual(resumed.status, 'failed', resumed.diagnostic?.message);
    until(rt, () => elapsedSeconds(rt) > stopped);
    assert.equal(state(rt).score, 'bright');
    assert.equal(
      rt.world.entities['music-computer'].equipment!.config.programData,
      config.programData,
    );
    until(rt, () => !rt.isActive(resumed.id));
    assert.equal(resumed.status, 'completed', resumed.diagnostic?.message);
    assert.equal(state(rt).elapsed, 36);
    clean(rt);
  });
test('dancer directive lowers hands then leaves other commitments uninterrupted; explicit join after walk', () => {
  const rt = musicGatheringRuntime(),
    r = rt.submit('music_gathering', musicGatheringBinding());
  until(rt, () => elapsedSeconds(rt) >= 4);
  const before = state(rt).elapsed;
  const walk = rt.submit('walk_to', { actor: 'dancer-a', x: -6, z: 1 });
  until(rt, () => !rt.isActive(walk.id));
  assert.equal(walk.status, 'completed', walk.diagnostic?.message);
  assert.equal(rt.isActive(r.id), true);
  assert.ok(state(rt).elapsed > before);
  assert.equal(readMusicGathering(rt, r.id)!.dancers[0].withdrawn, true);
  assert.equal(rt.world.entities['dancer-a'].human!.hands, undefined);
  const join = rt.submit('music_gathering_control', {
    gathering: r.id,
    actor: 'dancer-a',
    command: 'join',
  });
  until(
    rt,
    () =>
      join.status === 'completed' &&
      readMusicGathering(rt, r.id)!.dancers[0].state === 'dancing',
  );
  until(rt, () => !rt.isActive(r.id));
  clean(rt);
});
test('performer directive safely stops gathering; retained score and withdrawals resume explicitly', () => {
  const rt = musicGatheringRuntime(),
    p = musicGatheringBinding(),
    r = rt.submit('music_gathering', p);
  until(rt, () => elapsedSeconds(rt) >= 4);
  const leave = rt.submit('music_gathering_control', {
    gathering: r.id,
    actor: 'dancer-a',
    command: 'leave',
  });
  until(
    rt,
    () =>
      leave.status === 'completed' && rt.holder('actor:dancer-a').length === 0,
  );
  const walk = rt.submit('walk_to', { actor: 'musician', x: 6, z: -4 });
  until(rt, () => !rt.isActive(walk.id) && !rt.isActive(r.id));
  assert.equal(walk.status, 'completed');
  assert.equal(r.status, 'cancelled');
  clean(rt);
  const resumed = rt.submit('music_gathering', {
    ...p,
    resume: true,
    resumeFrom: r.id,
  });
  until(rt, () => elapsedSeconds(rt) >= 10);
  assert.equal(readMusicGathering(rt, resumed.id)!.dancers[0].withdrawn, true);
  assert.deepEqual(rt.holder('actor:dancer-a'), []);
  until(rt, () => !rt.isActive(resumed.id));
  assert.equal(resumed.status, 'completed');
  clean(rt);
});
for (const phase of ['approaching-floor', 'awaiting-score', 'dancing'])
  test(`cancellation at ${phase} drains only owned resources`, () => {
    const rt = musicGatheringRuntime(),
      r = rt.submit('music_gathering', musicGatheringBinding());
    until(rt, () => readMusicGathering(rt, r.id)?.dancers[0].state === phase);
    rt.cancel(r.id);
    until(rt, () => !rt.isActive(r.id));
    clean(rt);
  });
test('per-tick grounded arm continuity through dance and director safe release', () => {
  const rt = musicGatheringRuntime(),
    r = rt.submit('music_gathering', musicGatheringBinding());
  until(rt, () => elapsedSeconds(rt) >= 3);
  let prev = structuredClone(rt.world.entities['dancer-a'].human!.hands!),
    maximum = 0;
  for (let i = 0; i < 40; i++) {
    rt.step();
    const next = rt.world.entities['dancer-a'].human!.hands!;
    maximum = Math.max(
      maximum,
      dist3(prev.left!, next.left!),
      dist3(prev.right!, next.right!),
    );
    prev = structuredClone(next);
  }
  const walk = rt.submit('walk_to', { actor: 'dancer-a', x: -6, z: 1 });
  const start = rt.tick;
  while (
    rt
      .holder('actor:dancer-a')
      .some((a) => rt.records.get(a)?.verb === 'grounded_dance')
  ) {
    rt.step();
    const next = rt.world.entities['dancer-a'].human!.hands;
    if (next) {
      maximum = Math.max(
        maximum,
        dist3(prev.left!, next.left!),
        dist3(prev.right!, next.right!),
      );
      prev = structuredClone(next);
    }
  }
  assert.ok(rt.tick - start >= DANCE_RELEASE_TIME / DT - 1);
  assert.ok(maximum <= MAX_HUMAN_STEP_PER_TICK, `hand continuity ${maximum}`);
  until(rt, () => !rt.isActive(walk.id));
  rt.cancel(r.id);
  until(rt, () => !rt.isActive(r.id));
  clean(rt);
});
const invalid: [
  string,
  (rt: Runtime, p: ReturnType<typeof musicGatheringBinding>) => void,
  string,
][] = [
  [
    'duplicate participant',
    (_rt, p) => {
      p.dancers[0].actor = p.performer;
    },
    'music-gathering.duplicate-role',
  ],
  [
    'overlapping envelopes',
    (_rt, p) => {
      p.dancers[1].at = [...p.dancers[0].at];
    },
    'music-gathering.floor-overlap',
  ],
  [
    'unsupported level',
    (rt) => {
      rt.world.entities['dancer-a'].human!.level = 1;
    },
    'music-gathering.ground-required',
  ],
  [
    'floor edge',
    (_rt, p) => {
      p.dancers[0].at = [-7.9, 0];
    },
    'music-gathering.floor-distance',
  ],
  [
    'missing actor',
    (rt) => {
      delete rt.world.entities['dancer-a'];
    },
    'entity.unknown',
  ],
  [
    'missing computer',
    (rt) => {
      delete rt.world.entities['music-computer'];
    },
    'workstation.unknown',
  ],
  [
    'obstructed dance floor',
    (rt) => {
      rt.world.entities.blocker = {
        id: 'blocker',
        def: 'table-6ft',
        kind: 'fixture',
        pose: { p: [-2, 0, 0], yaw: 0 },
        support: { kind: 'ground' },
        provenance: FIXTURE,
      };
    },
    'music-gathering.floor-clearance',
  ],
  [
    'occupied dance floor',
    (rt) => {
      rt.world.entities['dancer-b'].pose.p = [-2, 0, 0];
    },
    'music-gathering.floor-occupied',
  ],
  [
    'foreign actor claim',
    (rt) => {
      rt.submit('face', { actor: 'dancer-a', target: { point: [0, 0] } });
    },
    'music-gathering.participant-busy',
  ],
];
for (const [name, change, code] of invalid)
  test(`admission refuses ${name} before effects`, () => {
    const rt = musicGatheringRuntime(),
      p = musicGatheringBinding();
    change(rt, p);
    const before = hashOf(rt.world);
    const r = rt.submit('music_gathering', p);
    assert.equal(r.status, 'failed');
    assert.equal(r.diagnostic?.code, code, r.diagnostic?.message);
    assert.equal(hashOf(rt.world), before);
    assert.deepEqual(rt.holder('music-gathering:music-computer'), []);
  });
test('foreign unfinished computer task never overwritten', () => {
  const rt = musicGatheringRuntime();
  const foreign = rt.submit('work_at', {
    actor: 'listener',
    station: 'music-computer',
    seat: 'music-chair#seat',
    task: 'Foreign original purpose',
    duration: 20,
  });
  until(rt, () => rt.records.get(foreign.id)?.phase === 'working');
  const before = hashOf(rt.world.entities['music-computer']);
  const r = rt.submit('music_gathering', musicGatheringBinding());
  assert.equal(r.status, 'failed');
  assert.equal(hashOf(rt.world.entities['music-computer']), before);
  assert.equal(rt.isActive(foreign.id), true);
  rt.cancel(foreign.id);
  until(rt, () => !rt.isActive(foreign.id));
});
test('held utensil refuses dance and remains physically owned', () => {
  const rt = musicGatheringRuntime(),
    spoon = itemEntity('spoon', 'spoon', [-5, 0, 0]);
  rt.world.entities.spoon = spoon;
  putInHand(spoon, 'dancer-a', 'right');
  const r = rt.submit('music_gathering', musicGatheringBinding());
  assert.equal(r.status, 'failed');
  assert.equal(r.diagnostic?.code, 'music-gathering.hands-occupied');
  assert.equal(spoon.support?.kind, 'in-hand');
});
test('two exact executions retain deterministic worlds, records and floor sequence', () => {
  const run = () => {
    const rt = musicGatheringRuntime(),
      r = rt.submit('music_gathering', musicGatheringBinding());
    until(rt, () => elapsedSeconds(rt) >= 3);
    rt.submit('music_gathering_control', {
      gathering: r.id,
      actor: 'dancer-b',
      command: 'join',
    });
    until(rt, () => !rt.isActive(r.id));
    clean(rt);
    return hashOf({ world: rt.world, records: [...rt.records.values()] });
  };
  assert.equal(run(), run());
});
test('active gathering refuses logical snapshot restoration explicitly', () => {
  const rt = musicGatheringRuntime(),
    r = rt.submit('music_gathering', musicGatheringBinding());
  until(rt, () => elapsedSeconds(rt) >= 3);
  assert.throws(
    () => rt.snapshot(),
    (error: unknown) =>
      error instanceof SnapshotError &&
      error.diagnostic.code === 'snapshot.non-resumable',
  );
  rt.cancel(r.id);
  until(rt, () => !rt.isActive(r.id));
  clean(rt);
});
test('retained withdrawn dancer remains under foreign directive while score resumes', () => {
  const rt = musicGatheringRuntime(),
    p = musicGatheringBinding(),
    r = rt.submit('music_gathering', p);
  until(rt, () => elapsedSeconds(rt) >= 4);
  const walk = rt.submit('walk_to', { actor: 'dancer-a', x: -7, z: 5 });
  rt.cancel(r.id);
  until(rt, () => !rt.isActive(r.id));
  assert.equal(rt.isActive(walk.id), true);
  const resumed = rt.submit('music_gathering', {
    ...p,
    resume: true,
    resumeFrom: r.id,
  });
  assert.notEqual(resumed.status, 'failed', resumed.diagnostic?.message);
  until(rt, () => elapsedSeconds(rt) >= 8);
  assert.equal(readMusicGathering(rt, resumed.id)!.dancers[0].withdrawn, true);
  until(rt, () => !rt.isActive(resumed.id) && !rt.isActive(walk.id));
  assert.equal(walk.status, 'completed');
  clean(rt);
});
test('listener director departure remains withdrawn after gathering Pause/Resume', () => {
  const rt = musicGatheringRuntime(),
    p = musicGatheringBinding(),
    r = rt.submit('music_gathering', p);
  until(rt, () => elapsedSeconds(rt) >= 4);
  const walk = rt.submit('walk_to', { actor: 'listener', x: 6, z: -4 });
  until(rt, () => !rt.isActive(walk.id));
  rt.cancel(r.id);
  until(rt, () => !rt.isActive(r.id));
  const stopped = elapsedSeconds(rt);
  const resumed = rt.submit('music_gathering', {
    ...p,
    resume: true,
    resumeFrom: r.id,
  });
  assert.notEqual(resumed.status, 'failed', resumed.diagnostic?.message);
  until(rt, () => elapsedSeconds(rt) > stopped);
  assert.deepEqual(rt.holder('actor:listener'), []);
  assert.deepEqual(
    readMusicGathering(rt, resumed.id)!.music!.bindings.listeners,
    [],
  );
  until(rt, () => !rt.isActive(resumed.id));
  clean(rt);
});
test('late Join refuses foreign claim without disrupting existing score', () => {
  const rt = musicGatheringRuntime(),
    r = rt.submit('music_gathering', musicGatheringBinding());
  until(rt, () => elapsedSeconds(rt) >= 3);
  const foreign = rt.submit('face', {
    actor: 'dancer-b',
    target: { point: [0, 0] },
  });
  const join = rt.submit('music_gathering_control', {
    gathering: r.id,
    actor: 'dancer-b',
    command: 'join',
  });
  assert.equal(join.diagnostic?.code, 'music-gathering.participant-busy');
  assert.equal(rt.isActive(foreign.id), true);
  const before = state(rt).elapsed;
  rt.step();
  assert.ok(state(rt).elapsed > before);
  rt.cancel(foreign.id);
  until(rt, () => !rt.isActive(r.id));
  clean(rt);
});
test('direct dance admission refuses overlapping active floor intentions before either arrives', () => {
  const rt = musicGatheringRuntime();
  const a = rt.submit('grounded_dance', {
    actor: 'dancer-a',
    station: 'music-computer',
    at: [-2, 0],
    face: 0,
  });
  const b = rt.submit('grounded_dance', {
    actor: 'dancer-b',
    station: 'music-computer',
    at: [-2, 0.5],
    face: 0,
  });
  assert.equal(b.diagnostic?.code, 'music-gathering.floor-overlap');
  rt.cancel(a.id);
  until(rt, () => !rt.isActive(a.id));
  clean(rt);
});
test('resume refuses a changed original duration or dance binding', () => {
  const rt = musicGatheringRuntime(),
    p = musicGatheringBinding(),
    r = rt.submit('music_gathering', p);
  until(rt, () => elapsedSeconds(rt) >= 3);
  rt.cancel(r.id);
  until(rt, () => !rt.isActive(r.id));
  const before = hashOf(rt.world);
  const changed = rt.submit('music_gathering', {
    ...p,
    duration: 40,
    resume: true,
    resumeFrom: r.id,
  });
  assert.equal(changed.status, 'failed');
  assert.equal(hashOf(rt.world), before);
  clean(rt);
});

test('grounded dance refuses a missing workstation rather than holding a silent invented score', () => {
  const rt = musicGatheringRuntime();
  const before = hashOf(rt.world);
  const r = rt.submit('grounded_dance', {
    actor: 'dancer-a',
    station: 'absent',
    at: [-2, 0],
    face: 0,
  });
  assert.equal(r.diagnostic?.code, 'workstation.unknown');
  assert.equal(hashOf(rt.world), before);
  clean(rt);
});
