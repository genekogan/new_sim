import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { Runtime } from '../runtime/runtime.ts';
import { Spatial, entityFootprint } from '../spatial/service.ts';
import type { SpatialScene } from '../spatial/types.ts';
import { createRegistry, ENGINE_INVARIANTS } from '../api/registry.ts';
import { emptyWorld, addAll, human, FIXTURE } from '../world/factory.ts';
import { readFixtureMove, type MoveFixtureParams } from '../carry/fixture.ts';
import {
  carryIntegrity,
  humanLoadClearance,
  fixtureCarryReach,
} from '../carry/invariants.ts';
import { maxStepPerTick } from '../runtime/invariants.ts';
import { activeLoadDiscs } from '../carry/actions.ts';
import { hypot, angleDelta, obbOverlap } from '../core/math.ts';
import { itemEntity } from '../items/model.ts';
import type { ActionDef } from '../actions/types.ts';
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
  const w = addAll(
    emptyWorld('fixture-move', scene),
    human('a', 0, -2),
    human('b', 4, -2),
    {
      id: 'chair',
      def: 'camp-chair',
      kind: 'fixture',
      pose: { p: [0, 0, 0], yaw: 0 },
      support: { kind: 'ground' },
      provenance: FIXTURE,
    },
  );
  const rt = new Runtime(
    w,
    createRegistry(),
    { spatial: new Spatial(scene) },
    ENGINE_INVARIANTS,
  );
  const p: MoveFixtureParams = {
    actor: 'a',
    fixture: 'chair',
    to: { x: 5, z: 3, yaw: Math.PI / 2 },
  };
  return { rt, p };
}
function until(rt: Runtime, done: () => boolean, max = 3000) {
  for (let i = 0; i < max && !done(); i++) rt.step();
  assert.ok(
    done(),
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
  for (const resource of [
    'actor:a',
    'hand:a:left',
    'hand:a:right',
    'entity:chair',
    'slot:chair#seat',
  ])
    assert.deepEqual(rt.holder(resource), [], resource);
  assert.equal(rt.world.entities.a.human!.grip, undefined);
  assert.equal(rt.world.entities.chair.reservedBy, undefined);
  assert.deepEqual(rt.violations, []);
}
function refuse(
  change: (rt: Runtime, p: MoveFixtureParams) => void,
  code: string,
) {
  const { rt, p } = setup();
  change(rt, p);
  const before = rt.stateHash(),
    a = rt.submit('move_fixture', p);
  assert.equal(a.status, 'failed', a.diagnostic?.message);
  assert.equal(a.diagnostic?.code, code);
  assert.equal(rt.stateHash(), before);
  return { rt, p, a };
}
test('real chair lift/carry/turn/setdown retains fixture identity and usable exact-heading seat', () => {
  const { rt, p } = setup(),
    a = rt.submit('move_fixture', p);
  assert.equal(a.status, 'executing', a.diagnostic?.message);
  let held = 0,
    last = [...rt.world.entities.chair.pose.p],
    yaw = 0;
  for (let i = 0; i < 3000 && rt.isActive(a.id); i++) {
    rt.step();
    const chair = rt.world.entities.chair;
    assert.equal(chair.kind, 'fixture');
    assert.equal(chair.def, 'camp-chair');
    assert.ok(
      hypot(
        chair.pose.p[0] - last[0],
        chair.pose.p[1] - last[1],
        chair.pose.p[2] - last[2],
      ) +
        Math.abs(angleDelta(chair.pose.yaw, yaw)) * 0.425 <
        0.15,
    );
    last = [...chair.pose.p];
    yaw = chair.pose.yaw;
    if (chair.support?.kind === 'held') {
      held++;
      assert.deepEqual(chair.support.by, ['a']);
      assert.equal(rt.world.entities.a.human!.grip?.entity, 'chair');
      assert.ok(activeLoadDiscs(rt).some((d) => d.entity === 'chair'));
    }
    if (readFixtureMove(rt, a.id)?.phase === 'move')
      assert.ok(
        Math.abs(
          angleDelta(
            rt.world.entities.a.pose.yaw,
            chair.pose.yaw + Math.PI / 2,
          ),
        ) < 1e-6,
      );
    assert.deepEqual(rt.violations, []);
  }
  assert.equal(a.status, 'completed', a.diagnostic?.message);
  assert.ok(held > 20);
  assert.deepEqual(rt.world.entities.chair.support, { kind: 'ground' });
  assert.equal(rt.world.entities.chair.phase, undefined);
  assert.ok(
    Math.abs(angleDelta(rt.world.entities.chair.pose.yaw, p.to.yaw)) < 1e-6,
  );
  assert.deepEqual(rt.world.entities.chair.pose.p, [5, 0, 3]);
  clean(rt);
  const sit = rt.submit('sit', { actor: 'b', slot: 'chair#seat' });
  assert.equal(sit.status, 'executing');
  until(rt, () => sit.phase === 'occupied');
  assert.ok(
    hypot(
      rt.world.entities.b.pose.p[0] - 5,
      rt.world.entities.b.pose.p[2] - 3,
    ) < 1e-6,
  );
  rt.cancel(sit.id);
  until(rt, () => !rt.isActive(sit.id));
  assert.deepEqual(rt.violations, []);
});
for (const phase of [undefined, 'placed', 'staged', 'stored'] as const)
  test(`preserves original fixture resting phase ${phase}`, () => {
    const { rt, p } = setup();
    rt.world.entities.chair.phase = phase;
    const a = rt.submit('move_fixture', p);
    until(rt, () => !rt.isActive(a.id));
    assert.equal(a.status, 'completed', a.diagnostic?.message);
    assert.equal(rt.world.entities.chair.phase, phase);
    clean(rt);
  });
for (const [name, change, code] of [
  [
    'missing fixture',
    (_rt, p) => (p.fixture = 'missing'),
    'move_fixture.missing',
  ],
  [
    'wrong fixture',
    (rt) => (rt.world.entities.chair.def = 'table-6ft'),
    'move_fixture.unsupported',
  ],
  [
    'missing actor',
    (_rt, p) => (p.actor = 'missing'),
    'move_fixture.actor-invalid',
  ],
  [
    'nonhuman actor',
    (_rt, p) => (p.actor = 'chair'),
    'move_fixture.actor-invalid',
  ],
  [
    'occupied chair',
    (rt) => (rt.world.entities.b.pose.p = [0, 0, 0]),
    'move_fixture.occupied',
  ],
  [
    'tilted chair',
    (rt) => (rt.world.entities.chair.pose.roll = 0.2),
    'move_fixture.not-grounded',
  ],
  [
    'unsupported chair',
    (rt) => (rt.world.entities.chair.support = { kind: 'none' }),
    'move_fixture.not-grounded',
  ],
  [
    'connections',
    (rt) =>
      (rt.world.entities.chair.connections = [
        { socket: 'x', to: 'b', toSocket: 'x' },
      ]),
    'move_fixture.connected',
  ],
  [
    'contents',
    (rt) => {
      rt.world.entities.bowl = itemEntity('bowl', 'bowl', [0, 0.4, 0]);
      rt.world.entities.bowl.support = { kind: 'resting-on', on: 'chair' };
    },
    'move_fixture.contents',
  ],
  [
    'wrong level',
    (rt) => (rt.world.entities.a.human!.level = 1),
    'move_fixture.ground-scope',
  ],
  ['off-floor target', (_rt, p) => (p.to.x = 12), 'carry.target-blocked'],
] as [string, (rt: Runtime, p: MoveFixtureParams) => void, string][])
  test(`refusal ${name} does not mutate world`, () => {
    refuse(change, code);
  });
test('held real bowl requires explicit stow before fixture moving', () => {
  const { rt, p } = setup();
  rt.world.entities.bowl = itemEntity('bowl', 'bowl', [0.6, 0, -2]);
  const take = rt.submit('take_item', {
    actor: 'a',
    item: 'bowl',
    hand: 'left',
  });
  until(rt, () => !rt.isActive(take.id));
  assert.equal(take.status, 'completed');
  const before = rt.stateHash(),
    a = rt.submit('move_fixture', p);
  assert.equal(a.diagnostic?.code, 'move_fixture.hands-full');
  assert.match(a.diagnostic!.message, /a.*bowl.*chair/);
  assert.equal(rt.stateHash(), before);
});
test('occupied sit and arriving reservation are never preempted by moving chair', () => {
  for (const seated of [false, true]) {
    const { rt, p } = setup(),
      sit = rt.submit('sit', { actor: 'b', slot: 'chair#seat' });
    if (seated) until(rt, () => sit.phase === 'occupied');
    const before = rt.stateHash(),
      a = rt.submit('move_fixture', p);
    assert.equal(a.status, 'failed');
    assert.equal(
      a.diagnostic?.code,
      seated ? 'move_fixture.occupied' : 'move_fixture.reserved',
    );
    assert.equal(rt.stateHash(), before);
    assert.ok(rt.isActive(sit.id));
  }
});
test('busy mover actor is not silently stood up', () => {
  const { rt, p } = setup();
  rt.world.entities.other = {
    id: 'other',
    def: 'camp-chair',
    kind: 'fixture',
    pose: { p: [-4, 0, -4], yaw: 0 },
    support: { kind: 'ground' },
    provenance: FIXTURE,
  };
  const sit = rt.submit('sit', { actor: 'a', slot: 'other#seat' });
  until(rt, () => sit.phase === 'occupied');
  const before = rt.stateHash(),
    a = rt.submit('move_fixture', p);
  assert.equal(a.diagnostic?.code, 'move_fixture.actor-busy');
  assert.equal(rt.stateHash(), before);
  assert.ok(rt.isActive(sit.id));
});
test('concurrent move and sit lose to authoritative fixture/seat claims', () => {
  const { rt, p } = setup(),
    a = rt.submit('move_fixture', p);
  const b = rt.submit('move_fixture', { ...p, actor: 'b' }),
    sit = rt.submit('sit', { actor: 'b', slot: 'chair#seat' });
  assert.equal(b.diagnostic?.code, 'move_fixture.reserved');
  assert.equal(sit.diagnostic?.code, 'reservation.conflict');
  rt.cancel(a.id);
  until(rt, () => !rt.isActive(a.id));
  clean(rt);
});
for (const phase of ['gather', 'lift', 'move', 'set-down', 'release'])
  test(`safe cancellation during ${phase} retains support until grounded`, () => {
    const { rt, p } = setup(),
      a = rt.submit('move_fixture', p);
    if (phase !== 'gather')
      until(rt, () => readFixtureMove(rt, a.id)?.phase === phase);
    rt.cancel(a.id);
    if (rt.isActive(a.id)) {
      assert.ok(rt.holder('entity:chair').includes(a.id));
      assert.equal(readFixtureMove(rt, a.id)?.stopping, true);
    }
    until(rt, () => !rt.isActive(a.id));
    assert.equal(a.status, 'cancelled');
    assert.deepEqual(rt.world.entities.chair.support, { kind: 'ground' });
    assert.equal(rt.world.entities.chair.phase, undefined);
    clean(rt);
  });
test('late source move/occupancy before pickup fails safely', () => {
  for (const mode of ['move', 'occupy']) {
    const { rt, p } = setup(),
      a = rt.submit('move_fixture', p);
    if (mode === 'move') rt.world.entities.chair.pose.p[0] += 1;
    else rt.world.entities.b.pose.p = [0, 0, 0];
    rt.step();
    assert.equal(a.status, 'failed');
    assert.equal(
      a.diagnostic?.code,
      mode === 'move' ? 'move_fixture.source-changed' : 'move_fixture.occupied',
    );
    assert.deepEqual(rt.world.entities.chair.support, { kind: 'ground' });
    for (const r of [
      'actor:a',
      'hand:a:left',
      'hand:a:right',
      'entity:chair',
      'slot:chair#seat',
    ])
      assert.deepEqual(rt.holder(r), []);
  }
});
test('recognized fixture load participates in static/human load and motion invariants', () => {
  const { rt, p } = setup(),
    a = rt.submit('move_fixture', p);
  until(rt, () => readFixtureMove(rt, a.id)?.phase === 'move');
  assert.ok(activeLoadDiscs(rt).length);
  const chair = rt.world.entities.chair;
  assert.ok(
    !obbOverlap(entityFootprint(chair).obb, {
      c: [10, 10],
      half: [1, 1],
      yaw: 0,
    }),
  );
  rt.cancel(a.id);
  until(rt, () => !rt.isActive(a.id));
  clean(rt);
});
test('fixture action refuses active snapshots; completed grounded chair persists', () => {
  const { rt, p } = setup(),
    a = rt.submit('move_fixture', p);
  assert.throws(
    () => rt.snapshot(),
    (e: unknown) =>
      !!e &&
      typeof e === 'object' &&
      'code' in e &&
      e.code === 'snapshot.non-resumable',
  );
  until(rt, () => !rt.isActive(a.id));
  const restored = Runtime.restore(
    JSON.parse(JSON.stringify(rt.snapshot())),
    createRegistry(),
    { spatial: new Spatial(scene) },
    ENGINE_INVARIANTS,
  );
  assert.equal(restored.stateHash(), rt.stateHash());
  assert.equal(readFixtureMove(restored, a.id)?.status, 'completed');
  clean(restored);
});
test('repeatable chair movement outcome and marks', () => {
  const run = () => {
    const { rt, p } = setup(),
      a = rt.submit('move_fixture', p);
    until(rt, () => !rt.isActive(a.id));
    return { hash: rt.stateHash(), events: rt.events, outputs: a.outputs };
  };
  assert.deepEqual(run(), run());
});

test('access links and hand reservations are explicit refusals', () => {
  refuse((rt) => {
    rt.services.spatial = new Spatial({
      ...scene,
      links: [{ id: 'flight', usable: true } as SpatialScene['links'][number]],
    });
  }, 'move_fixture.ground-scope');
  const { rt, p } = setup();
  const hold: ActionDef = {
    verb: 'test_hand_claim',
    description: 'reservation fixture',
    schema: z.object({}),
    reservations: () => [{ resource: 'hand:a:left', mode: 'exclusive' }],
    plan: () => ({ ok: true, program: null }),
    start: () => null,
    step: () => ({ status: 'running' }),
    cancel: () => ({ ok: true }),
  };
  rt.registry.set(hold.verb, hold);
  const h = rt.submit(hold.verb, {}),
    before = rt.stateHash(),
    a = rt.submit('move_fixture', p);
  assert.equal(a.diagnostic?.code, 'move_fixture.reserved');
  assert.equal(rt.stateHash(), before);
  assert.ok(rt.isActive(h.id));
  rt.cancel(h.id);
  clean(rt);
});

test('fixture integrity detects real grip drift and bystander overlap independently', () => {
  const { rt, p } = setup(),
    a = rt.submit('move_fixture', p);
  until(rt, () => readFixtureMove(rt, a.id)?.phase === 'move');
  const actor = [...rt.world.entities.a.pose.p] as [number, number, number];
  rt.world.entities.a.pose.p[0] += 1.1;
  assert.ok(carryIntegrity(rt).some((d) => d.code === 'carry.grip-drift'));
  assert.ok(
    fixtureCarryReach(rt).some((d) => d.code === 'carry.fixture-reach'),
  );
  rt.world.entities.a.pose.p = actor;
  const bystander = [...rt.world.entities.b.pose.p] as [number, number, number];
  const chair = rt.world.entities.chair;
  rt.world.entities.b.pose.p = [chair.pose.p[0], 0, chair.pose.p[2]];
  assert.ok(
    humanLoadClearance(rt).some((d) => d.code === 'collision.human-load'),
  );
  rt.world.entities.b.pose.p = bystander;
  rt.cancel(a.id);
  until(rt, () => !rt.isActive(a.id));
  clean(rt);
});
test('unsafe lowering refuses and keeps held fixture plus claims until obstacle is removed', () => {
  const { rt, p } = setup(),
    a = rt.submit('move_fixture', p);
  until(rt, () => readFixtureMove(rt, a.id)?.phase === 'move');
  const chair = rt.world.entities.chair;
  rt.world.entities.blocker = {
    id: 'blocker',
    def: 'camp-chair',
    kind: 'fixture',
    pose: { p: [chair.pose.p[0], 0, chair.pose.p[2]], yaw: 0 },
    support: { kind: 'ground' },
    provenance: FIXTURE,
  };
  assert.ok(carryIntegrity(rt).some((d) => d.code === 'carry.load-static'));
  rt.cancel(a.id);
  assert.equal(a.diagnostic?.code, 'move_fixture.lowering-blocked');
  assert.ok(rt.isActive(a.id));
  assert.equal(chair.support?.kind, 'held');
  assert.ok(rt.holder('entity:chair').includes(a.id));
  assert.ok(rt.holder('hand:a:left').includes(a.id));
  delete rt.world.entities.blocker;
  rt.cancel(a.id);
  until(rt, () => !rt.isActive(a.id));
  assert.equal(a.status, 'cancelled');
  clean(rt);
});
test('carried fixture motion bound detects an unsupported jump', () => {
  const { rt } = setup();
  rt.world.entities.chair.phase = 'carried';
  maxStepPerTick(rt);
  rt.world.tick++;
  rt.world.entities.chair.pose.p[0] += 3;
  assert.ok(maxStepPerTick(rt).some((d) => d.code === 'motion.teleport'));
});
test('unreachable target and late occupied setdown stay within validated execution', () => {
  const blocked = setup();
  blocked.rt.services.spatial = new Spatial({
    ...scene,
    obstacles: [
      {
        id: 'wall',
        kind: 'wall',
        obb: { c: [2, 0], half: [0.15, 12], yaw: 0 },
        y0: 0,
        y1: 3,
      },
    ],
  });
  const before = blocked.rt.stateHash(),
    refusal = blocked.rt.submit('move_fixture', blocked.p);
  assert.equal(refusal.status, 'failed');
  assert.ok(
    ['carry.no-route', 'carry.clearance'].includes(
      refusal.diagnostic?.code ?? '',
    ),
  );
  assert.equal(blocked.rt.stateHash(), before);
  const { rt, p } = setup(),
    action = rt.submit('move_fixture', p);
  until(rt, () => readFixtureMove(rt, action.id)?.phase === 'move');
  const approach = rt.submit('walk_to', { actor: 'b', x: 5, z: 3 });
  assert.equal(approach.status, 'executing');
  until(rt, () => !rt.isActive(action.id));
  assert.equal(action.status, 'completed', action.diagnostic?.message);
  assert.equal(rt.world.entities.chair.support?.kind, 'ground');
  assert.deepEqual(rt.violations, []);
  if (rt.isActive(approach.id)) rt.cancel(approach.id);
  clean(rt);
});

for (const yaw of [0, Math.PI / 2, -Math.PI / 2, Math.PI])
  test(`explicit directional destination yaw ${yaw}`, () => {
    const { rt, p } = setup();
    p.to.yaw = yaw;
    const a = rt.submit('move_fixture', p);
    until(rt, () => !rt.isActive(a.id));
    assert.equal(a.status, 'completed', a.diagnostic?.message);
    assert.ok(
      Math.abs(angleDelta(rt.world.entities.chair.pose.yaw, yaw)) < 1e-6,
    );
    clean(rt);
  });
test('a human arriving during lowering pauses held support and resumes safely', () => {
  const { rt, p } = setup();
  rt.world.entities.b.pose.p = [4.38, 0, 4];
  const a = rt.submit('move_fixture', p);
  until(rt, () => readFixtureMove(rt, a.id)?.phase === 'set-down');
  const walk = rt.submit('walk_to', { actor: 'b', x: 4.38, z: 3.62 });
  assert.equal(walk.status, 'executing', walk.diagnostic?.message);
  until(
    rt,
    () =>
      a.status === 'blocked' &&
      a.diagnostic?.code === 'move_fixture.lowering-occupied',
  );
  const paused = structuredClone(rt.world.entities.chair.pose);
  for (let i = 0; i < 600; i++) rt.step();
  assert.equal(rt.world.entities.chair.support?.kind, 'held');
  assert.deepEqual(rt.world.entities.chair.pose, paused);
  assert.ok(rt.isActive(a.id));
  assert.ok(rt.holder('entity:chair').includes(a.id));
  assert.deepEqual(rt.violations, []);
  until(rt, () => !rt.isActive(walk.id));
  const away = rt.submit('walk_to', { actor: 'b', x: 8, z: 5 });
  assert.equal(away.status, 'executing', away.diagnostic?.message);
  until(rt, () => !rt.isActive(a.id));
  assert.equal(a.status, 'completed', a.diagnostic?.message);
  until(rt, () => !rt.isActive(away.id));
  clean(rt);
});
test('ground footprint added during lowering cannot strand or release a suspended chair', () => {
  const { rt, p } = setup(),
    a = rt.submit('move_fixture', p);
  until(rt, () => readFixtureMove(rt, a.id)?.phase === 'set-down');
  rt.world.entities.cup = itemEntity('cup', 'cup', [5, 0, 3]);
  rt.step();
  assert.equal(a.diagnostic?.code, 'move_fixture.lowering-blocked');
  const paused = structuredClone(rt.world.entities.chair.pose);
  for (let i = 0; i < 600; i++) rt.step();
  assert.ok(rt.isActive(a.id));
  assert.deepEqual(rt.world.entities.chair.pose, paused);
  assert.equal(rt.world.entities.chair.support?.kind, 'held');
  assert.ok(rt.holder('entity:chair').includes(a.id));
  assert.deepEqual(rt.violations, []);
  rt.cancel(a.id);
  assert.ok(rt.isActive(a.id));
  delete rt.world.entities.cup;
  rt.cancel(a.id);
  until(rt, () => !rt.isActive(a.id));
  assert.equal(a.status, 'cancelled');
  clean(rt);
});
test('changed resting phase before pickup refuses rather than restoring an obsolete phase', () => {
  const { rt, p } = setup(),
    a = rt.submit('move_fixture', p);
  rt.world.entities.chair.phase = 'placed';
  until(rt, () => !rt.isActive(a.id));
  assert.equal(a.status, 'failed');
  assert.equal(a.diagnostic?.code, 'move_fixture.source-changed');
  assert.equal(rt.world.entities.chair.phase, 'placed');
  assert.equal(rt.world.entities.chair.support?.kind, 'ground');
  clean(rt);
});
