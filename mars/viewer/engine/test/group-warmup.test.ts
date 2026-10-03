import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  groupWarmupRuntime,
  groupWarmupBinding,
} from '../scenarios/group-warmup.ts';
import {
  readGroupWarmup,
  WARMUP_RELEASE_TIME,
  WARMUP_PHASES,
} from '../activities/group-warmup.ts';
import { hashOf } from '../core/hash.ts';
import { type Runtime, DT } from '../runtime/runtime.ts';
import { FIXTURE } from '../world/factory.ts';
import { BODY_MODEL, postureGap } from '../body/model.ts';
import { dist3 } from '../items/body.ts';
import { MAX_HUMAN_STEP_PER_TICK } from '../runtime/invariants.ts';
function until(rt: Runtime, p: () => boolean, max = 4000) {
  for (let i = 0; i < max && !p(); i++) {
    rt.step();
    assert.deepEqual(rt.violations, []);
  }
  assert.ok(p(), 'bounded condition');
}
function clean(rt: Runtime) {
  for (const e of Object.values(rt.world.entities))
    if (e.human) {
      assert.deepEqual(rt.holder(`actor:${e.id}`), []);
      assert.equal(e.human.hands, undefined);
      assert.equal(e.human.activity, 'idle');
    }
  for (const r of rt.records.values())
    assert.equal(rt.isActive(r.id), false, `${r.id} active`);
  assert.deepEqual(rt.violations, []);
}
for (const yaw of [0, Math.PI / 2])
  test(`four independent followers complete phased planted warm-up yaw ${yaw}`, () => {
    const rt = groupWarmupRuntime(yaw),
      p = groupWarmupBinding(yaw),
      r = rt.submit('group_warmup', p);
    assert.notEqual(r.status, 'failed', r.diagnostic?.message);
    const phases = new Map<string, Set<string>>(),
      arrivals = new Map<string, number>(),
      planted = new Map<string, string>();
    let independent = false;
    until(rt, () => {
      const s = readGroupWarmup(rt, r.id)!;
      const active = s.participants.filter((m) =>
        WARMUP_PHASES.includes(m.state as (typeof WARMUP_PHASES)[number]),
      );
      if (new Set(active.map((m) => m.state)).size > 1) independent = true;
      for (const m of active) {
        if (!arrivals.has(m.actor)) arrivals.set(m.actor, rt.tick);
        if (!phases.has(m.actor)) phases.set(m.actor, new Set());
        phases.get(m.actor)!.add(m.state!);
        const e = rt.world.entities[m.actor];
        if (!planted.has(m.actor)) planted.set(m.actor, hashOf(e.pose));
        assert.equal(hashOf(e.pose), planted.get(m.actor));
        for (const hand of Object.values(m.hands ?? {}))
          assert.ok(
            postureGap(BODY_MODEL.posture.upright, e.pose.p, hand!) <= 0,
          );
      }
      return !rt.isActive(r.id);
    });
    assert.equal(r.status, 'completed', r.diagnostic?.message);
    assert.equal(independent, true);
    assert.equal(new Set(arrivals.values()).size, 5);
    for (const m of [p.instructor, ...p.followers])
      assert.equal(phases.get(m.actor)!.size, 4);
    clean(rt);
  });
test('continuous hands and interruption lower before foreign walking takes actor', () => {
  const rt = groupWarmupRuntime(),
    r = rt.submit('group_warmup', groupWarmupBinding());
  until(rt, () => readGroupWarmup(rt, r.id)!.participants[1].state === 'raise');
  const actor = 'follower-1';
  let previous = structuredClone(rt.world.entities[actor].human!.hands!),
    maximum = 0;
  for (let i = 0; i < 100; i++) {
    rt.step();
    const next = rt.world.entities[actor].human!.hands!;
    maximum = Math.max(
      maximum,
      dist3(previous.left!, next.left!),
      dist3(previous.right!, next.right!),
    );
    previous = structuredClone(next);
  }
  const walk = rt.submit('walk_to', { actor, x: -6, z: -4 }),
    tick = rt.tick;
  until(rt, () => {
    const next = rt.world.entities[actor].human!.hands;
    if (next) {
      maximum = Math.max(
        maximum,
        dist3(previous.left!, next.left!),
        dist3(previous.right!, next.right!),
      );
      previous = structuredClone(next);
    }
    return !rt
      .holder(`actor:${actor}`)
      .some((id) => rt.records.get(id)?.verb === 'warmup_participant');
  });
  assert.ok(rt.tick - tick >= WARMUP_RELEASE_TIME / DT - 1);
  assert.ok(maximum <= MAX_HUMAN_STEP_PER_TICK, `maximum ${maximum}`);
  until(rt, () => !rt.isActive(walk.id));
  assert.equal(walk.status, 'completed');
  assert.equal(readGroupWarmup(rt, r.id)!.participants[1].withdrawn, true);
  rt.cancel(r.id);
  until(rt, () => !rt.isActive(r.id));
  clean(rt);
});
test('leave and rejoin use independent safe release while instructor continues', () => {
  const rt = groupWarmupRuntime(),
    r = rt.submit('group_warmup', groupWarmupBinding());
  until(rt, () => readGroupWarmup(rt, r.id)!.participants[2].state === 'raise');
  const clock = readGroupWarmup(rt, r.id)!.elapsed;
  rt.submit('group_warmup_control', {
    warmup: r.id,
    command: 'leave',
    actor: 'follower-2',
  });
  until(rt, () => rt.holder('actor:follower-2').length === 0);
  assert.ok(readGroupWarmup(rt, r.id)!.elapsed > clock);
  const join = rt.submit('group_warmup_control', {
    warmup: r.id,
    command: 'join',
    actor: 'follower-2',
  });
  assert.notEqual(join.status, 'failed', join.diagnostic?.message);
  until(rt, () => readGroupWarmup(rt, r.id)!.participants[2].state === 'open');
  until(rt, () => !rt.isActive(r.id));
  clean(rt);
});
test('Pause releases claims, Resume retains timing/withdrawals; End prevents Resume', () => {
  const rt = groupWarmupRuntime(),
    p = groupWarmupBinding(),
    r = rt.submit('group_warmup', p);
  until(rt, () => readGroupWarmup(rt, r.id)!.elapsed >= 6);
  rt.submit('group_warmup_control', {
    warmup: r.id,
    command: 'leave',
    actor: 'follower-3',
  });
  rt.submit('group_warmup_control', { warmup: r.id, command: 'pause' });
  until(rt, () => !rt.isActive(r.id));
  const elapsed = readGroupWarmup(rt, r.id)!.elapsed;
  clean(rt);
  const resumed = rt.submit('group_warmup', { ...p, resumeFrom: r.id });
  assert.notEqual(resumed.status, 'failed', resumed.diagnostic?.message);
  assert.equal(readGroupWarmup(rt, resumed.id)!.elapsed, elapsed);
  until(rt, () => readGroupWarmup(rt, resumed.id)!.elapsed > elapsed);
  assert.equal(
    readGroupWarmup(rt, resumed.id)!.participants[3].withdrawn,
    true,
  );
  rt.submit('group_warmup_control', { warmup: resumed.id, command: 'end' });
  until(rt, () => !rt.isActive(resumed.id));
  assert.equal(readGroupWarmup(rt, resumed.id)!.ended, true);
  assert.equal(resumed.status, 'cancelled');
  assert.equal(
    rt.submit('group_warmup', { ...p, resumeFrom: resumed.id }).diagnostic
      ?.code,
    'group-warmup.resume-binding',
  );
  clean(rt);
});
for (const phase of ['approaching-place', 'settle', 'raise', 'open', 'lower'])
  test(`cancellation during ${phase} drains ownership`, () => {
    const rt = groupWarmupRuntime(),
      r = rt.submit('group_warmup', groupWarmupBinding());
    until(rt, () => readGroupWarmup(rt, r.id)!.participants[0].state === phase);
    rt.cancel(r.id);
    until(rt, () => !rt.isActive(r.id));
    clean(rt);
  });
const invalid: [
  string,
  (rt: Runtime, p: ReturnType<typeof groupWarmupBinding>) => void,
  string,
][] = [
  [
    'overlapping places',
    (_rt, p) => {
      p.followers[0].at = [...p.instructor.at];
    },
    'floor-overlap',
  ],
  [
    'unsupported floor',
    (rt) => {
      rt.world.entities['follower-1'].human!.level = 1;
    },
    'ground-required',
  ],
  [
    'obstacle',
    (rt, p) => {
      rt.world.entities.blocker = {
        id: 'blocker',
        def: 'table-6ft',
        kind: 'fixture',
        pose: { p: [p.followers[0].at[0], 0, p.followers[0].at[1]], yaw: 0 },
        support: { kind: 'ground' },
        provenance: FIXTURE,
      };
    },
    'floor-clearance',
  ],
  [
    'occupied place',
    (rt, p) => {
      rt.world.entities['follower-2'].pose.p = [
        p.followers[0].at[0],
        0,
        p.followers[0].at[1],
      ];
    },
    'floor-occupied',
  ],
  [
    'busy follower',
    (rt) => {
      rt.submit('face', { actor: 'follower-1', target: { point: [0, 0] } });
    },
    'participant-busy',
  ],
];
for (const [name, change, code] of invalid)
  test(`refuses ${name} without effects`, () => {
    const rt = groupWarmupRuntime(),
      p = groupWarmupBinding();
    change(rt, p);
    const before = hashOf(rt.world),
      r = rt.submit('group_warmup', p);
    assert.equal(r.status, 'failed');
    assert.equal(
      r.diagnostic?.code,
      `group-warmup.${code}`,
      r.diagnostic?.message,
    );
    assert.equal(hashOf(rt.world), before);
    assert.deepEqual(rt.holder('warmup:guide'), []);
  });
test('deterministic replay including pause/resume and detached readout', () => {
  const run = () => {
    const rt = groupWarmupRuntime(),
      p = groupWarmupBinding(),
      r = rt.submit('group_warmup', p);
    until(rt, () => readGroupWarmup(rt, r.id)!.elapsed >= 7);
    const detached = readGroupWarmup(rt, r.id)!;
    detached.bindings.instructor.at[0] = 499;
    assert.equal(readGroupWarmup(rt, r.id)!.bindings.instructor.at[0], 2);
    rt.cancel(r.id);
    until(rt, () => !rt.isActive(r.id));
    const resumed = rt.submit('group_warmup', { ...p, resumeFrom: r.id });
    until(rt, () => !rt.isActive(resumed.id));
    clean(rt);
    return hashOf({
      world: rt.world,
      records: [...rt.records.values()],
      readout: readGroupWarmup(rt, resumed.id),
    });
  };
  assert.equal(run(), run());
});

test('instructor directive pauses retained progress and explicitly resumes after ordinary departure', () => {
  const rt = groupWarmupRuntime(),
    p = groupWarmupBinding(),
    r = rt.submit('group_warmup', p);
  until(rt, () => readGroupWarmup(rt, r.id)!.elapsed >= 6);
  const walk = rt.submit('walk_to', { actor: 'guide', x: 5, z: 4 });
  until(rt, () => !rt.isActive(r.id) && !rt.isActive(walk.id));
  assert.equal(walk.status, 'completed');
  assert.equal(r.status, 'cancelled');
  const stopped = readGroupWarmup(rt, r.id)!;
  assert.equal(stopped.ended, false);
  assert.ok(stopped.elapsed >= 6);
  clean(rt);
  const resumed = rt.submit('group_warmup', { ...p, resumeFrom: r.id });
  assert.notEqual(resumed.status, 'failed', resumed.diagnostic?.message);
  assert.equal(readGroupWarmup(rt, resumed.id)!.elapsed, stopped.elapsed);
  until(rt, () => !rt.isActive(resumed.id));
  assert.equal(resumed.status, 'completed');
  assert.equal(readGroupWarmup(rt, resumed.id)!.ended, true);
  clean(rt);
});

test('accepted Pause freezes instructor time at admission while physical hand lowering continues', () => {
  const rt = groupWarmupRuntime(), r = rt.submit('group_warmup', groupWarmupBinding());
  until(rt, () => readGroupWarmup(rt, r.id)!.elapsed >= 5);
  const elapsed = readGroupWarmup(rt, r.id)!.elapsed;
  const pause = rt.submit('group_warmup_control', { warmup: r.id, command: 'pause' });
  until(rt, () => !rt.isActive(r.id));
  assert.equal(pause.status, 'completed');
  assert.equal(readGroupWarmup(rt, r.id)!.elapsed, elapsed); clean(rt);
});
