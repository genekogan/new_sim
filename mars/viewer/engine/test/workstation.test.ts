import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import { Spatial } from '../spatial/service.ts';
import type { SpatialScene } from '../spatial/types.ts';
import { emptyWorld, human, addAll, FIXTURE } from '../world/factory.ts';
import type { Entity } from '../world/types.ts';
import type { ActionDef } from '../actions/types.ts';
import { walkTo } from '../locomotion/walk.ts';
import { SOCIAL_ACTIONS } from '../social/actions.ts';
import { allSlots } from '../social/slots.ts';
import { rot2 } from '../core/math.ts';
import {
  readWorkstation,
  WORKSTATION_ACTIONS,
} from '../objects/workstation.ts';

function fixture(
  id: string,
  def: string,
  x: number,
  z: number,
  yaw = 0,
): Entity {
  return {
    id,
    def,
    kind: 'fixture',
    pose: { p: [x, 0, z], yaw },
    provenance: FIXTURE,
  };
}
function setup(yaw = 0) {
  const scene: SpatialScene = {
    bounds: [-12, -12, 12, 12],
    levels: [{ id: 0, y: 0, label: 'ground' }],
    surfaces: [
      {
        id: 'ground',
        level: 0,
        y: 0,
        obb: { c: [0, 0], half: [12, 12], yaw: 0 },
      },
    ],
    obstacles: [],
    links: [],
  };
  const chair = rot2([0, -1.2], yaw),
    start = rot2([0, -4], yaw);
  const w = addAll(
    emptyWorld('workstation-test', scene),
    fixture('desk', 'computer-workstation', 0, 0, yaw),
    fixture('chair', 'camp-chair', chair[0], chair[1], yaw),
    human('user', start[0], start[1]),
    human('other', -4, -4),
  );
  const reg = new Map<string, ActionDef>(
    [walkTo, ...SOCIAL_ACTIONS, ...WORKSTATION_ACTIONS].map((a) => [a.verb, a]),
  );
  const rt = new Runtime(
    w,
    reg,
    { spatial: new Spatial(scene) },
    DEFAULT_INVARIANTS,
  );
  const params = {
    actor: 'user',
    station: 'desk',
    seat: 'chair#seat',
    duration: 1,
    task: 'draft-note',
  };
  return { rt, params };
}
function until(rt: Runtime, done: () => boolean, ticks = 2400) {
  for (let n = 0; n < ticks && !done(); n++) rt.step();
  assert.ok(
    done(),
    JSON.stringify([...rt.records.values()].filter((r) => rt.isActive(r.id))),
  );
}
function state(rt: Runtime) {
  const s = readWorkstation(rt, 'desk');
  assert.ok(!('code' in s));
  return s;
}
function clean(rt: Runtime) {
  for (const key of [
    'actor:user',
    'actor:other',
    'workstation:desk',
    'entity:desk',
    'entity:chair',
  ])
    assert.deepEqual(rt.holder(key), [], key);
  for (const s of allSlots(rt)) assert.equal(s.claimedBy, undefined, s.id);
  assert.deepEqual(rt.violations, []);
}
for (const yaw of [0, Math.PI / 2])
  test(`workstation actually seats and finishes deterministic progress, yaw ${yaw}`, () => {
    const { rt, params } = setup(yaw);
    assert.equal(state(rt).status, 'idle');
    assert.equal(rt.world.entities.desk.equipment, undefined);
    const a = rt.submit('work_at', params);
    assert.equal(a.status, 'executing', a.diagnostic?.message);
    rt.step();
    assert.equal(state(rt).elapsed, 0, 'walking does not count as work');
    until(rt, () => a.phase === 'working');
    assert.equal(rt.world.entities.user.human!.activity, 'sit');
    until(rt, () => !rt.isActive(a.id));
    assert.equal(a.status, 'completed', a.diagnostic?.message);
    assert.equal(state(rt).status, 'completed');
    assert.equal(state(rt).progress, 1);
    assert.equal(state(rt).task, params.task);
    assert.equal(state(rt).user, 'user');
    assert.equal(rt.world.entities.user.human!.activity, 'idle');
    clean(rt);
  });
test('interrupted work retains progress, explicit same-user/task resume completes it', () => {
  const { rt, params } = setup();
  const a = rt.submit('work_at', { ...params, duration: 5 });
  until(rt, () => state(rt).elapsed >= 1);
  const elapsed = state(rt).elapsed;
  rt.cancel(a.id);
  assert.equal(rt.isActive(a.id), true);
  assert.ok(rt.holder('workstation:desk').includes(a.id));
  assert.ok(rt.holder('slot:chair#seat').includes(a.id));
  rt.step();
  assert.equal(rt.world.entities.user.human!.activity, 'stand-up');
  until(rt, () => !rt.isActive(a.id));
  assert.equal(a.status, 'cancelled');
  assert.equal(state(rt).status, 'unfinished');
  assert.equal(state(rt).elapsed, elapsed);
  clean(rt);
  const implicitly = rt.submit('work_at', { ...params, duration: 5 });
  assert.equal(implicitly.diagnostic?.code, 'workstation.unfinished-task');
  const wrong = rt.submit('work_at', {
    ...params,
    actor: 'other',
    duration: 5,
    resume: true,
  });
  assert.equal(wrong.diagnostic?.code, 'workstation.unfinished-task');
  const b = rt.submit('work_at', { ...params, duration: 5, resume: true });
  assert.equal(b.status, 'executing', b.diagnostic?.message);
  until(rt, () => !rt.isActive(b.id));
  assert.equal(b.status, 'completed');
  assert.equal(state(rt).elapsed, 5);
  assert.equal(state(rt).progress, 1);
  clean(rt);
});
test('director interruption waits for safe stand-up then moves through normal Runtime', () => {
  const { rt, params } = setup();
  const a = rt.submit('work_at', { ...params, duration: 10 });
  until(rt, () => state(rt).elapsed >= 0.5);
  const directive = rt.submit('walk_to', { actor: 'user', x: 4, z: -4 });
  assert.equal(directive.phase, 'pre-empting');
  assert.equal(rt.isActive(a.id), true);
  until(rt, () => !rt.isActive(a.id) && !rt.isActive(directive.id));
  assert.equal(a.status, 'cancelled');
  assert.equal(directive.status, 'completed');
  assert.equal(state(rt).status, 'unfinished');
  assert.ok(state(rt).elapsed >= 0.5);
  clean(rt);
});
test('missing/wrong/held actors and far/wrong-facing seats give concrete refusal', () => {
  const { rt, params } = setup();
  assert.equal(
    rt.submit('work_at', { ...params, actor: 'nobody' }).diagnostic?.code,
    'entity.unknown',
  );
  assert.equal(
    rt.submit('work_at', { ...params, actor: 'chair' }).diagnostic?.code,
    'actor.not-human',
  );
  assert.equal(
    rt.submit('work_at', { ...params, station: 'chair' }).diagnostic?.code,
    'workstation.no-capability',
  );
  assert.equal(
    rt.submit('work_at', { ...params, station: 'missing' }).diagnostic?.code,
    'workstation.unknown',
  );
  rt.world.entities.user.human!.grip = { entity: 'load', slot: 'g0' };
  assert.equal(rt.submit('work_at', params).diagnostic?.code, 'actor.holding');
  delete rt.world.entities.user.human!.grip;
  rt.world.entities.chair.pose.p[0] = 5;
  const far = rt.submit('work_at', params);
  assert.equal(far.diagnostic?.code, 'workstation.seat-incompatible');
  assert.ok(far.diagnostic!.subjects!.includes('chair#seat'));
  rt.world.entities.chair.pose.p[0] = 0;
  rt.world.entities.chair.pose.yaw = Math.PI;
  assert.equal(
    rt.submit('work_at', params).diagnostic?.code,
    'workstation.seat-incompatible',
  );
  clean(rt);
});
test('occupied chair and duplicate workstation use refuse, preserving the existing owners', () => {
  const { rt, params } = setup();
  const sitter = rt.submit('sit', { actor: 'other', slot: 'chair#seat' });
  until(rt, () => sitter.phase === 'occupied');
  assert.equal(
    rt.submit('work_at', params).diagnostic?.code,
    'workstation.seat-occupied',
  );
  rt.cancel(sitter.id);
  until(rt, () => !rt.isActive(sitter.id));
  const move = rt.submit('walk_to', { actor: 'other', x: -4, z: -4 });
  until(rt, () => !rt.isActive(move.id));
  const a = rt.submit('work_at', { ...params, duration: 5 });
  assert.equal(a.status, 'executing');
  const b = rt.submit('work_at', { ...params, actor: 'other' });
  assert.equal(b.diagnostic?.code, 'workstation.busy');
  assert.ok(rt.holder('workstation:desk').includes(a.id));
  rt.cancel(a.id);
  until(rt, () => !rt.isActive(a.id));
  clean(rt);
});
test('station invalidation safely stops and persists unfinished task state', () => {
  const { rt, params } = setup();
  const a = rt.submit('work_at', { ...params, duration: 10 });
  until(rt, () => state(rt).elapsed >= 0.5);
  rt.world.entities.desk.equipment!.config.available = false;
  until(rt, () => !rt.isActive(a.id));
  assert.equal(a.status, 'failed');
  assert.equal(a.diagnostic?.code, 'workstation.unavailable');
  assert.equal(state(rt).status, 'unfinished');
  assert.equal(state(rt).available, false);
  clean(rt);
});
test('progress and action events are deterministic', () => {
  const execute = () => {
    const { rt, params } = setup();
    const a = rt.submit('work_at', params);
    until(rt, () => !rt.isActive(a.id));
    return { hash: rt.stateHash(), events: rt.events, state: state(rt) };
  };
  assert.deepEqual(execute(), execute());
});
test('cancel before seating records zero progress and safely releases all claims', () => {
  const { rt, params } = setup();
  const a = rt.submit('work_at', params);
  rt.cancel(a.id);
  assert.equal(rt.isActive(a.id), true);
  until(rt, () => !rt.isActive(a.id));
  assert.equal(a.status, 'cancelled');
  assert.equal(state(rt).status, 'unfinished');
  assert.equal(state(rt).elapsed, 0);
  clean(rt);
});
test('manual seat release stops task, and mismatched resume cannot overwrite it', () => {
  const { rt, params } = setup();
  const a = rt.submit('work_at', { ...params, duration: 5 });
  until(rt, () => state(rt).elapsed >= 0.5);
  const seat = [...rt.records.values()].find(
    (r) => r.parent === a.id && r.verb === 'sit',
  )!;
  rt.cancel(seat.id);
  until(rt, () => !rt.isActive(a.id));
  assert.equal(a.status, 'failed');
  assert.equal(a.diagnostic?.code, 'workstation.seat-released');
  const before = structuredClone(rt.world.entities.desk.equipment);
  const wrongTask = rt.submit('work_at', {
    ...params,
    duration: 5,
    task: 'different-task',
    resume: true,
  });
  assert.equal(wrongTask.diagnostic?.code, 'workstation.unfinished-task');
  const wrongDuration = rt.submit('work_at', {
    ...params,
    duration: 6,
    resume: true,
  });
  assert.equal(wrongDuration.diagnostic?.code, 'workstation.unfinished-task');
  assert.deepEqual(rt.world.entities.desk.equipment, before);
  clean(rt);
});
test('live snapshots explicitly refuse instead of claiming untested continuation', () => {
  const { rt, params } = setup();
  const a = rt.submit('work_at', params);
  assert.throws(
    () => rt.snapshot(),
    (e: unknown) =>
      !!e &&
      typeof e === 'object' &&
      'code' in e &&
      e.code === 'snapshot.non-resumable',
  );
  rt.cancel(a.id);
  until(rt, () => !rt.isActive(a.id));
  clean(rt);
});
