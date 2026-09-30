import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { createRegistry, ENGINE_INVARIANTS } from '../api/registry.ts';
import { Spatial } from '../spatial/service.ts';
import type { SpatialScene } from '../spatial/types.ts';
import { emptyWorld, addAll, human, FIXTURE } from '../world/factory.ts';
import {
  itemEntity,
  surfaceSlot,
  placeOnSlot,
  heldBy,
  graspPoint,
} from '../items/model.ts';
import { carryHand, bodyFrame } from '../items/body.ts';
import { readStow, type StowParams } from '../activities/index.ts';
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
function until(rt: Runtime, done: () => boolean, max = 4000) {
  for (let i = 0; i < max && !done(); i++) rt.step();
  assert.ok(
    done(),
    JSON.stringify(
      [...rt.records.values()]
        .filter((r) => rt.isActive(r.id))
        .map((r) => [r.verb, r.phase, r.diagnostic]),
    ),
  );
}
function setup(both = true) {
  const w = addAll(
    emptyWorld('stow-test', scene),
    human('a', 0, -3),
    human('b', 4, -3),
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
    w,
    createRegistry(),
    { spatial: new Spatial(scene) },
    ENGINE_INVARIANTS,
  );
  for (const [item, def, hand, dz] of (both
    ? [
        ['bowl', 'bowl', 'left', -0.2],
        ['spoon', 'spoon', 'right', 0.2],
      ]
    : [['bowl', 'bowl', 'left', 0]]) as [
    string,
    string,
    'left' | 'right',
    number,
  ][]) {
    w.entities[item] = itemEntity(item, def, [0.65, 0, -3 + dz], 0, {
      contents: def === 'bowl' ? { food: 'soup', fraction: 1 } : undefined,
    });
    const take = rt.submit('take_item', { actor: 'a', item, hand });
    assert.equal(take.status, 'executing');
    until(rt, () => !rt.isActive(take.id));
    assert.equal(take.status, 'completed');
  }
  const params: StowParams = {
    actor: 'a',
    placements: [
      { item: 'bowl', surfaceSlot: 'table#r0c0' },
      ...(both ? [{ item: 'spoon', surfaceSlot: 'table#r0c5' }] : []),
    ],
  };
  return { rt, params };
}
function clean(rt: Runtime, params: StowParams) {
  for (const r of [
    'actor:a',
    'hand:a:left',
    'hand:a:right',
    ...params.placements.flatMap((p) => [
      `entity:${p.item}`,
      `surface-slot:${p.surfaceSlot}`,
    ]),
  ])
    assert.deepEqual(rt.holder(r), [], r);
  assert.deepEqual(rt.violations, []);
}
function refusal(
  change: (rt: Runtime, p: StowParams) => void,
  expected: string,
  both = true,
) {
  const { rt, params } = setup(both);
  change(rt, params);
  const hash = rt.stateHash();
  const a = rt.submit('stow_items', params);
  assert.equal(a.status, 'failed');
  assert.equal(a.diagnostic?.code, expected);
  assert.equal(rt.stateHash(), hash);
  assert.equal(readStow(rt, a.id)?.status, 'failed');
  return { rt, params, a };
}
test('exact two approved placements execute serial physical puts and finish with empty hands', () => {
  const { rt, params } = setup(),
    action = rt.submit('stow_items', params);
  assert.equal(action.status, 'executing');
  assert.equal(readStow(rt, action.id)?.phase, 'preparing');
  for (let i = 0; i < 4000 && rt.isActive(action.id); i++) {
    rt.step();
    assert.ok(
      [...rt.records.values()].filter(
        (r) =>
          r.parent === action.id && r.verb === 'put_item' && rt.isActive(r.id),
      ).length <= 1,
    );
    if ((readStow(rt, action.id)?.completed.length ?? 0) < 2)
      assert.ok(
        heldBy(rt.world, 'a').length ||
          readStow(rt, action.id)?.completed.length === 2,
      );
  }
  assert.equal(action.status, 'completed', action.diagnostic?.message);
  assert.deepEqual(readStow(rt, action.id)?.completed, params.placements);
  assert.deepEqual(readStow(rt, action.id)?.remaining, []);
  assert.equal(readStow(rt, action.id)?.status, 'prepared');
  clean(rt, params);
  assert.ok(
    ![...rt.records.values()].some(
      (r) => r.verb === 'work_at' || r.verb === 'classroom_control',
    ),
  );
});
test('pending held spoon follows actor while parent reserves both hands and first put walks', () => {
  const { rt, params } = setup(),
    action = rt.submit('stow_items', params);
  until(rt, () =>
    [...rt.records.values()].some(
      (r) => r.parent === action.id && r.phase === 'approach',
    ),
  );
  for (let i = 0; i < 10; i++) {
    const expected = carryHand(bodyFrame(rt.world.entities.a), 'right');
    rt.step();
    const actual = graspPoint(rt.world.entities.spoon);
    assert.ok(
      actual.every((x, k) => Math.abs(x - expected[k]) < 1e-6),
      `pending held item must follow reserved parent movement: ${JSON.stringify({ actual, expected })}`,
    );
  }
  rt.cancel(action.id);
  until(rt, () => !rt.isActive(action.id));
  clean(rt, params);
});
for (const [name, change, code] of [
  [
    'incomplete',
    (_rt, p) => {
      p.placements.pop();
    },
    'stow.incomplete-placement',
  ],
  [
    'duplicate item',
    (_rt, p) => {
      p.placements[1].item = 'bowl';
    },
    'stow.duplicate-item',
  ],
  [
    'duplicate destination',
    (_rt, p) => {
      p.placements[1].surfaceSlot = p.placements[0].surfaceSlot;
    },
    'stow.duplicate-destination',
  ],
  [
    'missing item',
    (_rt, p) => {
      p.placements[0].item = 'missing';
    },
    'stow.item-missing',
  ],
  [
    'wrong item capability',
    (_rt, p) => {
      p.placements[0].item = 'table';
    },
    'stow.not-small-item',
  ],
  [
    'other actor item',
    (rt) => {
      rt.world.entities.bowl.support = {
        kind: 'in-hand',
        by: 'b',
        hand: 'left',
      };
    },
    'stow.not-held',
  ],
  [
    'missing surface',
    (_rt, p) => {
      p.placements[0].surfaceSlot = 'missing#r0c0';
    },
    'entity.unknown',
  ],
  [
    'no surface capability',
    (_rt, p) => {
      p.placements[0].surfaceSlot = 'a#r0c0';
    },
    'item.no-surface',
  ],
  [
    'missing child verb',
    (rt) => {
      rt.registry.delete('put_item');
    },
    'stow.put-missing',
  ],
  [
    'wrong level',
    (rt) => {
      rt.world.entities.a.human!.level = 1;
    },
    'stow.ground-scope',
  ],
] as [string, (rt: Runtime, p: StowParams) => void, string][])
  test(`invalid ${name} refuses without world mutation`, () => {
    refusal(change, code);
  });
for (const allowGround of [false, true])
  test(`ground stow explicitly unsupported even allowGround=${allowGround}`, () => {
    refusal((_rt, p) => {
      p.allowGround = allowGround;
      p.placements[0].surfaceSlot = 'ground';
    }, 'stow.ground-unsupported');
  });
test('occupied destination, blocked approach and busy ownership refuse before movement', () => {
  refusal((rt, p) => {
    const s = surfaceSlot(rt.world, p.placements[0].surfaceSlot);
    assert.ok(!('code' in s));
    const cup = itemEntity('cup', 'cup', [0, 0, 0]);
    placeOnSlot(cup, s, 0);
    rt.world.entities.cup = cup;
  }, 'item.slot-occupied');
  refusal((rt) => {
    rt.services.spatial = new Spatial({
      ...scene,
      obstacles: [
        {
          id: 'sealed-table',
          kind: 'wall',
          obb: { c: [0, 0], half: [2, 2], yaw: 0 },
          y0: 0,
          y1: 3,
        },
      ],
    });
  }, 'item.unreachable');
  const { rt, params } = setup(),
    eat = rt.submit('eat', {
      actor: 'a',
      bowl: 'bowl',
      spoon: 'spoon',
      cycles: 1,
    });
  assert.equal(eat.status, 'executing');
  const stow = rt.submit('stow_items', params);
  assert.equal(stow.status, 'failed');
  assert.ok(
    ['stow.not-standing', 'stow.busy'].includes(stow.diagnostic?.code ?? ''),
  );
  assert.ok(rt.isActive(eat.id));
});
for (const when of [
  'preparing',
  'approach',
  'reach',
  'withdraw',
  'second-reach',
] as const)
  test(`cancel at ${when} preserves released and remaining support`, () => {
    const { rt, params } = setup(),
      action = rt.submit('stow_items', params);
    if (when !== 'preparing')
      until(rt, () => {
        const children = [...rt.records.values()].filter(
          (r) => r.parent === action.id && r.verb === 'put_item',
        );
        return when === 'second-reach'
          ? children.length === 2 && children[1].phase === 'reach'
          : children.some((r) => r.phase === when);
      });
    const completed = readStow(rt, action.id)!.completed.length,
      before = params.placements.map((p) => rt.world.entities[p.item].support);
    rt.cancel(action.id);
    assert.equal(readStow(rt, action.id)?.status, 'stopping');
    assert.ok(rt.holder('actor:a').includes(action.id));
    until(rt, () => !rt.isActive(action.id));
    assert.equal(action.status, 'cancelled');
    assert.equal(readStow(rt, action.id)?.completed.length, completed);
    assert.deepEqual(
      params.placements.map((p) => rt.world.entities[p.item].support),
      before,
    );
    clean(rt, params);
    const remaining = readStow(rt, action.id)!.remaining;
    assert.equal(remaining.length, 2 - completed);
    if (remaining.length) assert.equal(rt.holder('holds:a').length, 1);
  });
test('late occupied second destination gives deterministic partial failure and keeps spoon held', () => {
  const run = () => {
    const { rt, params } = setup(),
      action = rt.submit('stow_items', params);
    until(rt, () => readStow(rt, action.id)?.completed.length === 1);
    const s = surfaceSlot(rt.world, params.placements[1].surfaceSlot);
    assert.ok(!('code' in s));
    const cup = itemEntity('intruder', 'cup', [0, 0, 0]);
    placeOnSlot(cup, s, 0);
    rt.world.entities.intruder = cup;
    until(rt, () => !rt.isActive(action.id));
    assert.equal(action.status, 'failed');
    assert.equal(action.diagnostic?.code, 'item.slot-occupied');
    clean(rt, params);
    assert.equal(rt.world.entities.spoon.support?.kind, 'in-hand');
    assert.equal(readStow(rt, action.id)?.completed.length, 1);
    assert.deepEqual(readStow(rt, action.id)?.remaining, ['spoon']);
    return {
      hash: rt.stateHash(),
      events: rt.events,
      state: readStow(rt, action.id),
    };
  };
  assert.deepEqual(run(), run());
});
test('active stow snapshots refuse explicitly; completed objects still snapshot/restore', () => {
  const { rt, params } = setup(),
    action = rt.submit('stow_items', params),
    before = rt.stateHash();
  assert.throws(
    () => rt.snapshot(),
    (e: unknown) =>
      !!e &&
      typeof e === 'object' &&
      'code' in e &&
      e.code === 'snapshot.non-resumable',
  );
  assert.equal(rt.stateHash(), before);
  until(rt, () => !rt.isActive(action.id));
  assert.equal(action.status, 'completed');
  const snap = JSON.parse(JSON.stringify(rt.snapshot())),
    restored = Runtime.restore(
      snap,
      createRegistry(),
      { spatial: new Spatial(scene) },
      ENGINE_INVARIANTS,
    );
  assert.equal(restored.stateHash(), rt.stateHash());
  assert.equal(readStow(restored, action.id)?.status, 'prepared');
  clean(restored, params);
});

test('fixed deadline safely cancels nonprogressing physical put and frees parent claims', () => {
  const { rt, params } = setup();
  const put = rt.registry.get('put_item')!;
  rt.registry.set('put_item', {
    ...put,
    step: () => ({ status: 'running', phase: 'blocked-test' }),
  });
  const action = rt.submit('stow_items', params);
  until(rt, () => !rt.isActive(action.id), 2450);
  assert.equal(action.status, 'failed');
  assert.equal(action.diagnostic?.code, 'stow.timeout');
  assert.deepEqual(readStow(rt, action.id)?.remaining, ['bowl', 'spoon']);
  assert.deepEqual(readStow(rt, action.id)?.completed, []);
  clean(rt, params);
  assert.ok(
    ![...rt.records.values()].some(
      (r) => r.parent === action.id && rt.isActive(r.id),
    ),
  );
});
for (const change of ['move', 'remove'] as const)
  test(`second approved surface ${change} refuses without choosing replacement`, () => {
    const { rt, params } = setup(),
      action = rt.submit('stow_items', params);
    until(rt, () => readStow(rt, action.id)?.completed.length === 1);
    if (change === 'move') rt.world.entities.table.pose.p[0] += 1;
    else delete rt.world.entities.table;
    until(rt, () => !rt.isActive(action.id));
    assert.equal(action.status, 'failed');
    assert.equal(
      action.diagnostic?.code,
      change === 'move' ? 'stow.destination-changed' : 'entity.unknown',
    );
    assert.deepEqual(readStow(rt, action.id)?.remaining, ['spoon']);
    // External deletion/movement deliberately invalidates placed support, so assert claim cleanup, not a false invariant guarantee.
    for (const r of [
      'actor:a',
      'hand:a:left',
      'hand:a:right',
      'entity:spoon',
      'surface-slot:table#r0c5',
    ])
      assert.deepEqual(rt.holder(r), []);
  });
test('stow refuses seated ownership without implicitly standing or cancelling its holder', () => {
  const { rt, params } = setup();
  rt.world.entities.chair = {
    id: 'chair',
    def: 'camp-chair',
    kind: 'fixture',
    pose: { p: [3, 0, -1], yaw: 0 },
    support: { kind: 'ground' },
    provenance: FIXTURE,
  };
  const sit = rt.submit('sit', { actor: 'a', slot: 'chair#seat' });
  assert.equal(sit.status, 'executing');
  until(rt, () => sit.phase === 'occupied');
  const before = rt.stateHash(),
    stow = rt.submit('stow_items', params);
  assert.equal(stow.status, 'failed');
  assert.equal(stow.diagnostic?.code, 'stow.not-standing');
  assert.equal(rt.stateHash(), before);
  assert.ok(rt.isActive(sit.id));
  assert.deepEqual(rt.holder('actor:a'), [sit.id]);
  assert.deepEqual(
    heldBy(rt.world, 'a').map((x) => x.item.id),
    ['bowl', 'spoon'],
  );
  assert.deepEqual(rt.violations, []);
});
