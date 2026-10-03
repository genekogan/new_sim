import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { Runtime } from '../runtime/runtime.ts';
import { Spatial } from '../spatial/service.ts';
import type { SpatialScene } from '../spatial/types.ts';
import { createRegistry, ENGINE_INVARIANTS } from '../api/registry.ts';
import { emptyWorld, addAll, human, FIXTURE } from '../world/factory.ts';
import {
  readRoomSetup,
  type SetupRoomParams,
} from '../activities/room-setup.ts';
import { CATALOG } from '../world/catalog.ts';
import { itemEntity, surfaceSlot, placeOnSlot } from '../items/model.ts';
import { classroomScene, classroomWorld } from '../scenarios/classroom.ts';
import type { ActionDef } from '../actions/types.ts';

const scene: SpatialScene = {
  bounds: [-16, -16, 16, 16],
  levels: [{ id: 0, y: 0, label: 'ground' }],
  surfaces: [
    {
      id: 'ground',
      level: 0,
      y: 0,
      obb: { c: [0, 0], half: [16, 16], yaw: 0 },
    },
  ],
  obstacles: [],
  links: [],
};
function setup() {
  const world = addAll(
    emptyWorld('room-setup', scene),
    human('a', 3, -2),
    human('b', 3, 2),
    human('c', -4, -2),
    {
      id: 'table',
      def: 'table-6ft',
      kind: 'fixture',
      pose: { p: [3, 0, 0], yaw: 0 },
      support: { kind: 'ground' },
      provenance: FIXTURE,
    },
    {
      id: 'chair',
      def: 'camp-chair',
      kind: 'fixture',
      pose: { p: [-4, 0, 0], yaw: 0 },
      support: { kind: 'ground' },
      provenance: FIXTURE,
    },
  );
  const rt = new Runtime(
    world,
    createRegistry(),
    { spatial: new Spatial(scene) },
    ENGINE_INVARIANTS,
  );
  const p: SetupRoomParams = {
    layout: 'side',
    moves: [
      {
        fixture: 'table',
        actor: 'a',
        helpers: ['b'],
        to: { x: 7, z: 3, yaw: Math.PI / 2 },
      },
      { fixture: 'chair', actor: 'c', to: { x: -4, z: 4, yaw: Math.PI / 2 } },
    ],
  };
  return { rt, p };
}
function until(rt: Runtime, done: () => boolean, max = 7000) {
  for (let i = 0; i < max && !done(); i++) rt.step();
  assert.ok(
    done(),
    JSON.stringify(
      [...rt.records.values()].map((r) => [r.verb, r.status, r.diagnostic]),
    ),
  );
}
function clean(rt: Runtime) {
  assert.deepEqual(rt.holder('room-setup'), []);
  for (const id of ['a', 'b', 'c'])
    for (const res of [`actor:${id}`, `hand:${id}:left`, `hand:${id}:right`])
      assert.deepEqual(rt.holder(res), []);
  for (const id of ['table', 'chair'])
    assert.deepEqual(rt.holder(`entity:${id}`), []);
  assert.deepEqual(rt.holder('slot:chair#seat'), []);
  for (const s of CATALOG['table-6ft'].surfaceSlots!)
    assert.deepEqual(rt.holder(`surface-slot:table#${s.id}`), []);
  assert.deepEqual(rt.violations, []);
}
function done(rt: Runtime, id: string) {
  until(rt, () => !rt.isActive(id));
  assert.equal(
    rt.records.get(id)?.status,
    'completed',
    rt.records.get(id)?.diagnostic?.message,
  );
}
function cup(rt: Runtime) {
  const item = itemEntity('cup', 'cup', [0, 0, 0]),
    slot = surfaceSlot(rt.world, 'table#r0c1');
  assert.ok(!('code' in slot));
  placeOnSlot(item, slot, 0);
  rt.world.entities.cup = item;
}
test('serial real moves own physical resources themselves and finish usable explicit layout', () => {
  const { rt, p } = setup(),
    a = rt.submit('setup_room', p);
  assert.equal(a.status, 'executing', a.diagnostic?.message);
  assert.deepEqual(rt.holder('actor:a'), []);
  done(rt, a.id);
  const children = [...rt.records.values()].filter((r) => r.parent === a.id);
  assert.deepEqual(
    children.map((r) => (r.params as { fixture: string }).fixture),
    ['table', 'chair'],
  );
  assert.ok(children[1].requestedTick >= children[0].endedTick!);
  const read = readRoomSetup(rt, a.id)!;
  assert.equal(read.ready, true);
  assert.equal(read.completed.length, 2);
  assert.equal(read.partial, false);
  clean(rt);
});
for (const count of [4, 8] as const)
  test(`actual authored classroom${count} default/side setup uses existing fixtures`, () => {
    const w = classroomWorld(count);
    const rt = new Runtime(
      w,
      createRegistry(),
      { spatial: new Spatial(classroomScene()) },
      ENGINE_INVARIANTS,
    );
    done(
      rt,
      rt.submit('take_item', {
        actor: 'worker',
        item: 'break-bowl',
        hand: 'left',
      }).id,
    );
    done(
      rt,
      rt.submit('take_item', {
        actor: 'worker',
        item: 'break-spoon',
        hand: 'right',
      }).id,
    );
    const p: SetupRoomParams = {
      layout: 'side',
      moves: [
        {
          actor: 'guest1',
          helpers: ['guest2'],
          fixture: 'belongings-table',
          to: { x: 12, z: -2, yaw: 0 },
        },
        {
          actor: 'guest3',
          fixture: count === 4 ? 'seat8' : 'seat12',
          to: { x: 7.5, z: count === 4 ? 3 : 4.5, yaw: -Math.PI },
        },
      ],
    };
    done(rt, rt.submit('setup_room', p).id);
    p.layout = 'default';
    p.moves[0].to = { x: 10, z: -5, yaw: 0 };
    p.moves[1].to = { x: 4.5, z: count === 4 ? 3 : 6, yaw: -Math.PI };
    done(rt, rt.submit('setup_room', p).id);
    assert.deepEqual(rt.violations, []);
    assert.deepEqual(rt.holder('room-setup'), []);
  });
for (const [name, change, cause] of [
  ['contents', (rt: Runtime) => cup(rt), 'move_fixture.contents'],
  [
    'occupied',
    (rt: Runtime) => (rt.world.entities.occupant = human('occupant', -4, 0)),
    'move_fixture.occupied',
  ],
  [
    'held helper',
    (rt: Runtime) => {
      const e = itemEntity('spoon', 'spoon', [3, 0, 2.45]);
      rt.world.entities.spoon = e;
      done(
        rt,
        rt.submit('take_item', { actor: 'b', item: 'spoon', hand: 'right' }).id,
      );
    },
    'move_fixture.hands-full',
  ],
  [
    'duplicate crew',
    (_rt: Runtime, p: SetupRoomParams) => (p.moves[0].helpers = ['a']),
    'move_fixture.duplicate-crew',
  ],
  [
    'missing crew',
    (_rt: Runtime, p: SetupRoomParams) => (p.moves[0].helpers = ['missing']),
    'move_fixture.actor-invalid',
  ],
] as const)
  test(`both-move preflight refuses ${name} before physical commitment`, () => {
    const { rt, p } = setup();
    change(rt, p);
    const hash = rt.stateHash(),
      a = rt.submit('setup_room', p);
    assert.equal(a.status, 'failed');
    assert.equal(a.diagnostic?.code, 'setup_room.preflight');
    assert.equal(
      (a.diagnostic?.details?.cause as { code: string } | undefined)?.code,
      cause,
    );
    assert.equal(rt.stateHash(), hash);
    assert.equal(
      [...rt.records.values()].filter((r) => r.parent === a.id).length,
      0,
    );
  });
test('duplicate fixtures and unsupported kinds refuse named admission', () => {
  for (const duplicate of [true, false]) {
    const { rt, p } = setup();
    if (duplicate) p.moves[1] = p.moves[0];
    else rt.world.entities.chair.def = 'campfire';
    const a = rt.submit('setup_room', p);
    assert.equal(
      a.diagnostic?.code,
      `setup_room.${duplicate ? 'duplicate-fixture' : 'unsupported'}`,
    );
    clean(rt);
  }
});
test('competing coordinators and reserved pending chair refuse without preemption', () => {
  const { rt, p } = setup(),
    a = rt.submit('setup_room', p),
    other = rt.submit('setup_room', p);
  assert.equal(other.diagnostic?.code, 'reservation.conflict');
  assert.ok(rt.isActive(a.id));
  rt.cancel(a.id);
  until(rt, () => !rt.isActive(a.id));
  const sit = rt.submit('sit', { actor: 'c', slot: 'chair#seat' });
  assert.equal(sit.status, 'executing');
  const denied = rt.submit('setup_room', p);
  assert.equal(denied.status, 'failed');
  assert.ok(rt.isActive(sit.id));
  rt.cancel(sit.id);
  until(rt, () => !rt.isActive(sit.id));
  clean(rt);
});
for (const phase of ['gather', 'lift', 'move', 'set-down', 'release'])
  test(`coordinator cancel waits for real ${phase} safe stop`, () => {
    const { rt, p } = setup(),
      a = rt.submit('setup_room', p);
    until(rt, () => readRoomSetup(rt, a.id)?.current?.phase === phase);
    rt.cancel(a.id);
    assert.ok(rt.isActive(a.id));
    assert.ok(rt.holder('room-setup').includes(a.id));
    until(rt, () => !rt.isActive(a.id));
    assert.equal(a.status, 'cancelled');
    assert.equal(rt.world.entities.table.support?.kind, 'ground');
    assert.equal(rt.world.entities.chair.pose.p[2], 0);
    clean(rt);
  });
test('safe blocked lowering retains parent and crew claims until actual footprint clears', () => {
  const { rt, p } = setup(),
    a = rt.submit('setup_room', p);
  until(rt, () => readRoomSetup(rt, a.id)?.current?.phase === 'set-down');
  rt.world.entities.blocker = itemEntity('blocker', 'cup', [7, 0, 3]);
  rt.step();
  rt.cancel(a.id);
  for (let i = 0; i < 600; i++) rt.step();
  assert.ok(rt.isActive(a.id));
  assert.equal(readRoomSetup(rt, a.id)?.current?.held, true);
  assert.equal(
    readRoomSetup(rt, a.id)?.diagnostic?.code,
    'move_fixture.lowering-blocked',
  );
  for (const key of [
    'actor:a',
    'actor:b',
    'hand:a:left',
    'hand:a:right',
    'hand:b:left',
    'hand:b:right',
    'entity:table',
    ...CATALOG['table-6ft'].surfaceSlots!.map(
      (s) => `surface-slot:table#${s.id}`,
    ),
  ])
    assert.ok(
      rt.holder(key).includes(readRoomSetup(rt, a.id)!.current!.action),
    );
  assert.ok(rt.holder('room-setup').length);
  assert.deepEqual(rt.violations, []);
  delete rt.world.entities.blocker;
  until(rt, () => !rt.isActive(a.id));
  assert.equal(a.status, 'cancelled');
  clean(rt);
});
test('external child cancellation ends partial setup after physical cleanup', () => {
  const { rt, p } = setup(),
    a = rt.submit('setup_room', p);
  until(rt, () => readRoomSetup(rt, a.id)?.current?.phase === 'move');
  rt.cancel(readRoomSetup(rt, a.id)!.current!.action);
  until(rt, () => !rt.isActive(a.id));
  assert.equal(a.status, 'failed');
  assert.equal(a.diagnostic?.code, 'setup_room.child-stopped');
  assert.equal(rt.world.entities.table.support?.kind, 'ground');
  clean(rt);
});
test('pending crew acquired after preflight refuses next child with completed placement preserved', () => {
  const { rt, p } = setup(),
    a = rt.submit('setup_room', p);
  until(rt, () => readRoomSetup(rt, a.id)?.current?.phase === 'move');
  const foreign = rt.submit('sit', { actor: 'c', slot: 'chair#seat' });
  until(rt, () => !rt.isActive(a.id));
  assert.equal(a.diagnostic?.code, 'setup_room.child-refused');
  assert.equal(readRoomSetup(rt, a.id)?.completed.length, 1);
  assert.equal(readRoomSetup(rt, a.id)?.partial, true);
  assert.ok(rt.isActive(foreign.id));
  rt.cancel(foreign.id);
  until(rt, () => !rt.isActive(foreign.id));
  clean(rt);
});
test('external prior-placement change cannot report ready', () => {
  const { rt, p } = setup(),
    a = rt.submit('setup_room', p);
  until(rt, () => readRoomSetup(rt, a.id)?.current?.fixture === 'chair');
  rt.world.entities.table.pose.p[2] += 2;
  until(rt, () => !rt.isActive(a.id));
  assert.equal(a.diagnostic?.code, 'setup_room.layout-changed');
  assert.equal(readRoomSetup(rt, a.id)?.ready, false);
  assert.equal(readRoomSetup(rt, a.id)?.completed.length, 2);
  clean(rt);
});
test('active setup snapshots refuse and terminal readout survives JSON restore deterministically', () => {
  function run() {
    const { rt, p } = setup(),
      a = rt.submit('setup_room', p);
    assert.throws(
      () => rt.snapshot(),
      (e: unknown) =>
        !!e &&
        typeof e === 'object' &&
        'code' in e &&
        e.code === 'snapshot.non-resumable',
    );
    done(rt, a.id);
    const restored = Runtime.restore(
      JSON.parse(JSON.stringify(rt.snapshot())),
      createRegistry(),
      { spatial: new Spatial(scene) },
      ENGINE_INVARIANTS,
    );
    assert.equal(restored.stateHash(), rt.stateHash());
    assert.deepEqual(readRoomSetup(restored, a.id), readRoomSetup(rt, a.id));
    delete restored.services.roomSetups;
    assert.equal(readRoomSetup(restored, a.id)?.ready, true);
    assert.equal(readRoomSetup(restored, a.id)?.completed.length, 2);
    clean(restored);
    return rt.stateHash();
  }
  assert.equal(run(), run());
});
const stuck: ActionDef<unknown, unknown, unknown> = {
  verb: 'move_fixture',
  description: 'test-only nonprogressing physical child',
  schema: z.unknown(),
  reservations: () => [],
  plan: () => ({ ok: true, program: {} }),
  start: () => ({}),
  step: () => ({ status: 'running' }),
  cancel: () => ({ ok: true }),
};
test('fixed180-second deadline starts cleanup of nonprogressing child', () => {
  const { rt, p } = setup();
  rt.registry.set('move_fixture', stuck);
  const a = rt.submit('setup_room', p);
  until(rt, () => !rt.isActive(a.id), 3700);
  assert.equal(a.diagnostic?.code, 'setup_room.timeout');
  assert.ok(rt.tick >= 3600 && rt.tick < 3650);
  assert.equal(readRoomSetup(rt, a.id)?.completed.length, 0);
  clean(rt);
});
test('one explicit chair move is supported; infeasible second target refuses whole preflight', () => {
  const valid = setup();
  valid.p.moves = valid.p.moves.slice(1);
  done(valid.rt, valid.rt.submit('setup_room', valid.p).id);
  clean(valid.rt);
  const { rt, p } = setup();
  p.moves[1].to.x = 30;
  const hash = rt.stateHash(),
    a = rt.submit('setup_room', p);
  assert.equal(a.status, 'failed');
  assert.equal(a.diagnostic?.code, 'setup_room.preflight');
  assert.equal(rt.stateHash(), hash);
  clean(rt);
});

test('cancelled partial physical placement is visible without undo; later changed completed layout loses readiness', () => {
  const { rt, p } = setup(),
    a = rt.submit('setup_room', p);
  until(rt, () => readRoomSetup(rt, a.id)?.current?.phase === 'move');
  for (let i = 0; i < 25; i++) rt.step();
  rt.cancel(a.id);
  until(rt, () => !rt.isActive(a.id));
  assert.equal(a.status, 'cancelled');
  assert.equal(readRoomSetup(rt, a.id)?.partial, true);
  assert.equal(readRoomSetup(rt, a.id)?.ready, false);
  assert.equal(rt.world.entities.table.support?.kind, 'ground');
  clean(rt);
  const next = setup(),
    record = next.rt.submit('setup_room', next.p);
  done(next.rt, record.id);
  next.rt.world.entities.chair.pose.p[0] += 2;
  assert.equal(readRoomSetup(next.rt, record.id)?.ready, false);
  assert.equal(readRoomSetup(next.rt, record.id)?.phase, 'changed');
  assert.equal(
    readRoomSetup(next.rt, record.id)?.diagnostic?.code,
    'setup_room.layout-changed',
  );
});

test('invalid setup schema cannot crash the read-only setup monitor', () => {
  const { rt, p } = setup();
  const malformed = structuredClone(p) as unknown as { moves: { helpers?: unknown }[] };
  malformed.moves[0].helpers = 3;
  const hash = rt.stateHash();
  const rec = rt.submit('setup_room', malformed);
  assert.equal(rec.status, 'failed');
  assert.ok(rec.diagnostic);
  assert.equal(readRoomSetup(rt, rec.id), undefined);
  assert.equal(rt.stateHash(), hash);
  clean(rt);
});
