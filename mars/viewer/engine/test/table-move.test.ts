import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { Spatial } from '../spatial/service.ts';
import type { SpatialScene } from '../spatial/types.ts';
import { createRegistry, ENGINE_INVARIANTS } from '../api/registry.ts';
import { emptyWorld, addAll, human, FIXTURE } from '../world/factory.ts';
import { readFixtureMove, type MoveFixtureParams } from '../carry/fixture.ts';
import { angleDelta, hypot } from '../core/math.ts';
import { itemEntity, surfaceSlot, placeOnSlot } from '../items/model.ts';
import { CATALOG } from '../world/catalog.ts';
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
function setup() {
  const world = addAll(
    emptyWorld('table-move', scene),
    human('a', 0, -2),
    human('b', 0, 2),
    human('c', -3, 0),
    {
      id: 'table',
      def: 'table-6ft',
      kind: 'fixture',
      pose: { p: [0, 0, 0], yaw: 0 },
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
  const p: MoveFixtureParams = {
    actor: 'a',
    helpers: ['b'],
    fixture: 'table',
    to: { x: 5, z: 3, yaw: Math.PI / 2 },
  };
  return { rt, p };
}
function until(rt: Runtime, done: () => boolean, max = 4000) {
  for (let i = 0; i < max && !done(); i++) rt.step();
  assert.ok(
    done(),
    JSON.stringify(
      [...rt.records.values()].map((r) => [r.verb, r.status, r.diagnostic]),
    ),
  );
}
function clean(rt: Runtime) {
  for (const actor of ['a', 'b']) {
    for (const key of [
      `actor:${actor}`,
      `hand:${actor}:left`,
      `hand:${actor}:right`,
    ])
      assert.deepEqual(rt.holder(key), []);
    assert.equal(rt.world.entities[actor].human!.grip, undefined);
  }
  assert.deepEqual(rt.holder('entity:table'), []);
  for (const s of CATALOG['table-6ft'].surfaceSlots!)
    assert.deepEqual(rt.holder(`surface-slot:table#${s.id}`), []);
  assert.equal(rt.world.entities.table.reservedBy, undefined);
  assert.deepEqual(rt.violations, []);
}
function addSupported(rt: Runtime, id: string, def: string, slot: string) {
  const item = itemEntity(id, def, [0, 0, 0]),
    s = surfaceSlot(rt.world, slot);
  assert.ok(!('code' in s));
  placeOnSlot(item, s, 0);
  rt.world.entities[id] = item;
}
function finish(rt: Runtime, id: string) {
  until(rt, () => !rt.isActive(id));
  assert.equal(
    rt.records.get(id)!.status,
    'completed',
    rt.records.get(id)!.diagnostic?.message,
  );
}
test('two real people continuously lift/carry/lower an upright table and ordinary put uses relocated top', () => {
  const { rt, p } = setup(),
    action = rt.submit('move_fixture', p);
  assert.equal(action.status, 'executing', action.diagnostic?.message);
  let prior = structuredClone(rt.world.entities.table.pose),
    held = 0;
  for (let i = 0; i < 4000 && rt.isActive(action.id); i++) {
    rt.step();
    const table = rt.world.entities.table;
    assert.ok(
      hypot(
        table.pose.p[0] - prior.p[0],
        table.pose.p[1] - prior.p[1],
        table.pose.p[2] - prior.p[2],
      ) +
        Math.abs(angleDelta(table.pose.yaw, prior.yaw)) * 0.915 <
        0.15,
    );
    prior = structuredClone(table.pose);
    assert.equal(table.kind, 'fixture');
    assert.equal(table.def, 'table-6ft');
    assert.equal(table.pose.pitch ?? 0, 0);
    assert.equal(table.pose.roll ?? 0, 0);
    if (table.support?.kind === 'held') {
      held++;
      assert.deepEqual(table.support.by, ['a', 'b']);
      assert.ok(
        hypot(
          rt.world.entities.a.pose.p[0] - rt.world.entities.b.pose.p[0],
          rt.world.entities.a.pose.p[2] - rt.world.entities.b.pose.p[2],
        ) > 0.56,
      );
    }
    if (readFixtureMove(rt, action.id)?.phase === 'move')
      for (const [actor, sign] of [
        ['a', 1],
        ['b', -1],
      ] as const)
        assert.ok(
          Math.abs(
            angleDelta(
              rt.world.entities[actor].pose.yaw,
              table.pose.yaw + (sign * Math.PI) / 2,
            ),
          ) < 1e-6,
        );
    assert.deepEqual(rt.violations, []);
  }
  assert.equal(action.status, 'completed');
  assert.ok(held > 20);
  assert.deepEqual(rt.world.entities.table.pose.p, [5, 0, 3]);
  assert.ok(
    Math.abs(angleDelta(rt.world.entities.table.pose.yaw, p.to.yaw)) < 1e-6,
  );
  assert.equal(rt.world.entities.table.phase, undefined);
  clean(rt);
  rt.world.entities.bowl = itemEntity('bowl', 'bowl', [-3, 0, 0.45]);
  finish(
    rt,
    rt.submit('take_item', { actor: 'c', item: 'bowl', hand: 'left' }).id,
  );
  const put = rt.submit('put_item', {
    actor: 'c',
    item: 'bowl',
    surfaceSlot: 'table#r0c2',
  });
  finish(rt, put.id);
  assert.deepEqual(rt.world.entities.bowl.support, {
    kind: 'resting-on',
    on: 'table',
    slot: 'r0c2',
  });
  const s = surfaceSlot(rt.world, 'table#r0c2');
  assert.ok(!('code' in s));
  assert.deepEqual(rt.world.entities.bowl.pose.p, s.p);
  until(
    rt,
    () =>
      rt.holder('actor:a').length === 0 && rt.holder('actor:b').length === 0,
  );
  clean(rt);
});
for (const phase of ['gather', 'lift', 'move', 'set-down', 'release'])
  test(`table cancellation ${phase} retains support until safe release`, () => {
    const { rt, p } = setup(),
      a = rt.submit('move_fixture', p);
    if (phase !== 'gather')
      until(rt, () => readFixtureMove(rt, a.id)?.phase === phase);
    rt.cancel(a.id);
    if (rt.isActive(a.id)) {
      assert.ok(rt.holder('entity:table').includes(a.id));
      assert.ok(rt.holder('actor:b').includes(a.id));
    }
    until(rt, () => !rt.isActive(a.id));
    assert.equal(a.status, 'cancelled');
    assert.equal(rt.world.entities.table.support?.kind, 'ground');
    assert.equal(rt.world.entities.table.phase, undefined);
    clean(rt);
  });
for (const [name, change, code] of [
  [
    'no helper',
    (_rt: Runtime, p: MoveFixtureParams) => (p.helpers = undefined),
    'carry.crew-too-small',
  ],
  [
    'duplicate',
    (_rt: Runtime, p: MoveFixtureParams) => (p.helpers = ['a']),
    'move_fixture.duplicate-crew',
  ],
  [
    'missing helper',
    (_rt: Runtime, p: MoveFixtureParams) => (p.helpers = ['missing']),
    'move_fixture.actor-invalid',
  ],
  [
    'busy helper',
    (rt: Runtime) => (rt.world.entities.b.human!.activity = 'talk'),
    'move_fixture.actor-busy',
  ],
  [
    'bowl on table',
    (rt: Runtime) => addSupported(rt, 'bowl', 'bowl', 'table#r0c1'),
    'move_fixture.contents',
  ],
  [
    'not grounded',
    (rt: Runtime) => (rt.world.entities.table.support = undefined),
    'move_fixture.not-grounded',
  ],
  [
    'connected',
    (rt: Runtime) =>
      (rt.world.entities.table.connections = [
        { socket: 'x', to: 'other', toSocket: 'y' },
      ]),
    'move_fixture.connected',
  ],
] as const)
  test(`table refuses ${name} without mutation`, () => {
    const { rt, p } = setup();
    change(rt, p);
    const before = rt.stateHash(),
      a = rt.submit('move_fixture', p);
    assert.equal(a.status, 'failed');
    assert.equal(a.diagnostic?.code, code);
    assert.equal(rt.stateHash(), before);
  });
test('empty table cannot be moved until real bowl/spoon are taken and explicit stow frees both crew', () => {
  const { rt, p } = setup();
  addSupported(rt, 'bowl', 'bowl', 'table#r0c1');
  addSupported(rt, 'spoon', 'spoon', 'table#r2c1');
  assert.equal(
    rt.submit('move_fixture', p).diagnostic?.code,
    'move_fixture.contents',
  );
  finish(
    rt,
    rt.submit('take_item', { actor: 'a', item: 'bowl', hand: 'left' }).id,
  );
  finish(
    rt,
    rt.submit('take_item', { actor: 'b', item: 'spoon', hand: 'right' }).id,
  );
  assert.equal(
    rt.submit('move_fixture', p).diagnostic?.code,
    'move_fixture.hands-full',
  );
  rt.world.entities.return = {
    id: 'return',
    def: 'table-6ft',
    kind: 'fixture',
    pose: { p: [-5, 0, 0], yaw: 0 },
    support: { kind: 'ground' },
    provenance: FIXTURE,
  };
  finish(
    rt,
    rt.submit('stow_items', {
      actor: 'a',
      placements: [{ item: 'bowl', surfaceSlot: 'return#r0c1' }],
    }).id,
  );
  finish(
    rt,
    rt.submit('stow_items', {
      actor: 'b',
      placements: [{ item: 'spoon', surfaceSlot: 'return#r2c1' }],
    }).id,
  );
  finish(rt, rt.submit('move_fixture', p).id);
  assert.deepEqual(rt.violations, []);
  clean(rt);
});
test('all pending surface reservations refuse movement and moving table rejects ordinary put', () => {
  const { rt, p } = setup();
  rt.world.entities.bowl = itemEntity('bowl', 'bowl', [-3, 0, 0.45]);
  finish(
    rt,
    rt.submit('take_item', { actor: 'c', item: 'bowl', hand: 'left' }).id,
  );
  const put = rt.submit('put_item', {
    actor: 'c',
    item: 'bowl',
    surfaceSlot: 'table#r0c1',
  });
  assert.equal(put.status, 'executing');
  assert.equal(
    rt.submit('move_fixture', p).diagnostic?.code,
    'move_fixture.reserved',
  );
  rt.cancel(put.id);
  until(rt, () => !rt.isActive(put.id));
  const a = rt.submit('move_fixture', p);
  assert.equal(a.status, 'executing', a.diagnostic?.message);
  until(rt, () => readFixtureMove(rt, a.id)?.phase === 'move');
  const denied = rt.submit('put_item', {
    actor: 'c',
    item: 'bowl',
    surfaceSlot: 'table#r2c5',
  });
  assert.equal(denied.status, 'failed');
  assert.equal(denied.diagnostic?.code, 'reservation.conflict');
  assert.equal(rt.world.entities.bowl.support?.kind, 'in-hand');
  rt.cancel(a.id);
  until(rt, () => !rt.isActive(a.id));
  clean(rt);
});
test('contents added before pickup refuse and do not strand gather claims', () => {
  const { rt, p } = setup(),
    a = rt.submit('move_fixture', p);
  addSupported(rt, 'cup', 'cup', 'table#r0c1');
  until(rt, () => !rt.isActive(a.id));
  assert.equal(a.diagnostic?.code, 'move_fixture.contents');
  assert.equal(rt.world.entities.table.support?.kind, 'ground');
  clean(rt);
});
for (const mode of ['human', 'static'])
  test(`table lowering invalidation ${mode} retains held load then resumes`, () => {
    const { rt, p } = setup();
    rt.world.entities.c.pose.p = [3.8, 0, 4.2];
    const a = rt.submit('move_fixture', p);
    until(rt, () => readFixtureMove(rt, a.id)?.phase === 'set-down');
    let walk: string | undefined;
    if (mode === 'static')
      rt.world.entities.cup = itemEntity('cup', 'cup', [5, 0, 3]);
    else {
      walk = rt.submit('walk_to', { actor: 'c', x: 4.25, z: 4.2 }).id;
    }
    until(
      rt,
      () =>
        a.status === 'blocked' &&
        a.diagnostic?.code ===
          `move_fixture.lowering-${mode === 'human' ? 'occupied' : 'blocked'}`,
    );
    const pose = structuredClone(rt.world.entities.table.pose);
    for (let i = 0; i < 600; i++) rt.step();
    assert.deepEqual(rt.world.entities.table.pose, pose);
    assert.equal(rt.world.entities.table.support?.kind, 'held');
    assert.ok(rt.holder('actor:b').includes(a.id));
    assert.ok(rt.holder('surface-slot:table#r2c5').includes(a.id));
    assert.deepEqual(rt.violations, []);
    if (mode === 'static') {
      rt.cancel(a.id);
      assert.equal(a.diagnostic?.code, 'move_fixture.lowering-blocked');
      assert.ok(rt.isActive(a.id));
      assert.equal(rt.world.entities.table.support?.kind, 'held');
      delete rt.world.entities.cup;
    } else {
      until(rt, () => !rt.isActive(walk!));
      const away = rt.submit('walk_to', { actor: 'c', x: 2, z: 6 });
      assert.equal(away.status, 'executing');
    }
    finish(rt, a.id);
    clean(rt);
  });
test('blocked narrow corridor fits a person but refuses whole upright table and crew', () => {
  const { rt, p } = setup();
  rt.services.spatial = new Spatial({
    ...scene,
    obstacles: [
      {
        id: 'wall1',
        kind: 'wall',
        obb: { c: [2, -6.2], half: [0.2, 5.8], yaw: 0 },
        y0: 0,
        y1: 3,
      },
      {
        id: 'wall2',
        kind: 'wall',
        obb: { c: [2, 6.2], half: [0.2, 5.8], yaw: 0 },
        y0: 0,
        y1: 3,
      },
    ],
  });
  finish(rt, rt.submit('walk_to', { actor: 'c', x: 3.5, z: 0 }).id);
  p.to = { x: 5, z: 0, yaw: 0 };
  const a = rt.submit('move_fixture', p);
  assert.equal(a.status, 'failed');
  assert.ok(
    ['carry.no-route', 'carry.clearance'].includes(a.diagnostic?.code ?? ''),
  );
});
test('table move active snapshot refusal, deterministic repetition and completed persistence', () => {
  function run() {
    const { rt, p } = setup(),
      a = rt.submit('move_fixture', p);
    until(rt, () => readFixtureMove(rt, a.id)?.phase === 'move');
    assert.throws(
      () => rt.snapshot(),
      (e: unknown) =>
        !!e &&
        typeof e === 'object' &&
        'code' in e &&
        e.code === 'snapshot.non-resumable',
    );
    finish(rt, a.id);
    const snap = rt.snapshot(),
      restored = Runtime.restore(
        snap,
        createRegistry(),
        { spatial: new Spatial(scene) },
        ENGINE_INVARIANTS,
      );
    assert.equal(restored.stateHash(), rt.stateHash());
    assert.deepEqual(readFixtureMove(restored, a.id)?.crew, ['a', 'b']);
    clean(rt);
    return rt.stateHash();
  }
  assert.equal(run(), run());
});

test('pending real take refuses contents until release; moving table never gains supported items', () => {
  const { rt, p } = setup();
  addSupported(rt, 'bowl', 'bowl', 'table#r0c1');
  const take = rt.submit('take_item', {
    actor: 'c',
    item: 'bowl',
    hand: 'left',
  });
  until(rt, () => take.phase === 'reach');
  assert.equal(
    rt.submit('move_fixture', p).diagnostic?.code,
    'move_fixture.contents',
  );
  until(rt, () => take.phase === 'withdraw');
  assert.equal(rt.world.entities.bowl.support?.kind, 'in-hand');
  const move = rt.submit('move_fixture', p);
  assert.equal(move.status, 'executing', move.diagnostic?.message);
  finish(rt, take.id);
  finish(rt, move.id);
  assert.equal(rt.world.entities.bowl.support?.kind, 'in-hand');
  clean(rt);
});
for (const yaw of [0, -Math.PI / 2, Math.PI])
  test(`table exact directional heading ${yaw}`, () => {
    const { rt, p } = setup();
    p.to.yaw = yaw;
    finish(rt, rt.submit('move_fixture', p).id);
    assert.ok(
      Math.abs(angleDelta(rt.world.entities.table.pose.yaw, yaw)) < 1e-6,
    );
    clean(rt);
  });

test('chair remains one carrier and held helper small items refuse explicitly', () => {
  const chair = setup();
  chair.rt.world.entities.table.def = 'camp-chair';
  assert.equal(
    chair.rt.submit('move_fixture', chair.p).diagnostic?.code,
    'carry.crew-too-large',
  );
  const { rt, p } = setup();
  rt.world.entities.spoon = itemEntity('spoon', 'spoon', [0, 0, 2.45]);
  finish(
    rt,
    rt.submit('take_item', { actor: 'b', item: 'spoon', hand: 'right' }).id,
  );
  const before = rt.stateHash(),
    move = rt.submit('move_fixture', p);
  assert.equal(move.diagnostic?.code, 'move_fixture.hands-full');
  assert.ok(move.diagnostic?.subjects?.includes('b'));
  assert.ok(move.diagnostic?.subjects?.includes('spoon'));
  assert.equal(rt.stateHash(), before);
  assert.equal(rt.world.entities.spoon.support?.kind, 'in-hand');
});
for (const phase of ['placed', 'staged', 'stored'] as const)
  test(`table preserves resting phase ${phase}`, () => {
    const { rt, p } = setup();
    rt.world.entities.table.phase = phase;
    finish(rt, rt.submit('move_fixture', p).id);
    assert.equal(rt.world.entities.table.phase, phase);
    clean(rt);
  });
test('one worker holds removed bowl and spoon while two free guests move table then returns both', () => {
  const { rt, p } = setup();
  addSupported(rt, 'bowl', 'bowl', 'table#r0c1');
  addSupported(rt, 'spoon', 'spoon', 'table#r2c1');
  finish(
    rt,
    rt.submit('take_item', { actor: 'c', item: 'bowl', hand: 'left' }).id,
  );
  finish(
    rt,
    rt.submit('take_item', { actor: 'c', item: 'spoon', hand: 'right' }).id,
  );
  const move = rt.submit('move_fixture', p);
  assert.equal(move.status, 'executing', move.diagnostic?.message);
  finish(rt, move.id);
  assert.deepEqual(rt.world.entities.bowl.support, {
    kind: 'in-hand',
    by: 'c',
    hand: 'left',
  });
  assert.deepEqual(rt.world.entities.spoon.support, {
    kind: 'in-hand',
    by: 'c',
    hand: 'right',
  });
  finish(
    rt,
    rt.submit('put_item', {
      actor: 'c',
      item: 'bowl',
      surfaceSlot: 'table#r0c1',
    }).id,
  );
  finish(
    rt,
    rt.submit('put_item', {
      actor: 'c',
      item: 'spoon',
      surfaceSlot: 'table#r2c1',
    }).id,
  );
  until(
    rt,
    () =>
      rt.holder('actor:a').length === 0 && rt.holder('actor:b').length === 0,
  );
  for (const id of ['bowl', 'spoon']) {
    assert.equal(rt.world.entities[id].support?.kind, 'resting-on');
    const s = surfaceSlot(rt.world, `table#${id === 'bowl' ? 'r0c1' : 'r2c1'}`);
    assert.ok(!('code' in s));
    assert.deepEqual(rt.world.entities[id].pose.p, s.p);
  }
  clean(rt);
});
