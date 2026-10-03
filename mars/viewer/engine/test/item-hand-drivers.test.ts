import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { createRegistry, ENGINE_INVARIANTS } from '../api/registry.ts';
import { Spatial } from '../spatial/service.ts';
import type { SpatialScene } from '../spatial/types.ts';
import { emptyWorld, addAll, human, FIXTURE } from '../world/factory.ts';
import {
  itemEntity,
  graspPoint,
} from '../items/model.ts';
import { carryHand, bodyFrame } from '../items/body.ts';
import { z } from 'zod';
import { dsin, dcos, hypot } from '../core/math.ts';
import type { ActionDef } from '../actions/types.ts';
type StowParams = {
  actor: string;
  placements: { item: string; surfaceSlot: string }[];
};
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

function carryMatches(rt: Runtime, hand: 'left' | 'right', expected: number[]) {
  const actual = graspPoint(
    rt.world.entities[hand === 'left' ? 'bowl' : 'spoon'],
  );
  assert.ok(
    actual.every((x, k) => Math.abs(x - expected[k]) < 1e-6),
    JSON.stringify({ actual, expected }),
  );
}
for (const parent of [false, true])
  for (const motion of ['approach', 'turn'])
    test(`two held items follow ordinary carry during put approach/turn; reservation-only parent=${parent}, motion=${motion}`, () => {
      const { rt } = setup();
      if (motion === 'turn') {
        const plan = rt.registry
          .get('put_item')!
          .plan(rt, { actor: 'a', item: 'bowl', surfaceSlot: 'table#r0c0' });
        assert.ok(plan.ok);
        const station = (
          plan.program as { station: { p: [number, number]; yaw: number } }
        ).station;
        const walk = rt.submit('walk_to', {
          actor: 'a',
          x: station.p[0],
          z: station.p[1],
        });
        until(rt, () => !rt.isActive(walk.id));
        assert.equal(walk.status, 'completed');
        const face = rt.submit('face', {
          actor: 'a',
          target: {
            point: [
              station.p[0] + dsin(station.yaw + Math.PI),
              station.p[1] + dcos(station.yaw + Math.PI),
            ],
          },
        });
        until(rt, () => !rt.isActive(face.id));
        assert.equal(face.status, 'completed');
        rt.step();
      }
      let parentID: string | undefined;
      if (parent) {
        const composite: ActionDef = {
          verb: 'reserve_hands',
          description: 'test reservation-only coordinator',
          schema: z.object({}),
          drivesReservedHands: false,
          reservations: () =>
            [
              'actor:a',
              'hand:a:left',
              'hand:a:right',
              'entity:bowl',
              'surface-slot:table#r0c0',
            ].map((resource) => ({ resource, mode: 'exclusive' })),
          plan: () => ({ ok: true, program: null }),
          start: () => null,
          step: () => ({ status: 'running' }),
          cancel: () => ({ ok: true }),
        };
        rt.registry.set(composite.verb, composite);
        parentID = rt.submit(composite.verb, {}).id;
      }
      const put = rt.submit(
        'put_item',
        { actor: 'a', item: 'bowl', surfaceSlot: 'table#r0c0' },
        { parent: parentID },
      );
      assert.equal(put.status, 'executing');
      let approach = 0,
        turn = 0,
        reached = false;
      for (let i = 0; i < 4000 && rt.isActive(put.id); i++) {
        const before = bodyFrame(rt.world.entities.a),
          phase = put.phase,
          prior = [...graspPoint(rt.world.entities.spoon)];
        rt.step();
        if (phase === 'approach' || phase === 'turn') {
          // Runtime steps the pre-existing holder before this newer mover: exact ordinary carry cadence.
          carryMatches(rt, 'right', carryHand(before, 'right'));
          assert.ok(
            hypot(
              graspPoint(rt.world.entities.spoon)[0] - prior[0],
              graspPoint(rt.world.entities.spoon)[1] - prior[1],
              graspPoint(rt.world.entities.spoon)[2] - prior[2],
            ) < 0.1,
            'ordinary carry delta remains bounded',
          );
          if (put.phase === 'approach' || put.phase === 'turn')
            carryMatches(rt, 'left', carryHand(before, 'left'));
          if (phase === 'approach') approach++;
          else turn++;
        }
        if (put.phase === 'reach') {
          reached = true;
          assert.deepEqual(rt.world.entities.bowl.support, {
            kind: 'in-hand',
            by: 'a',
            hand: 'left',
          });
          assert.deepEqual(
            graspPoint(rt.world.entities.bowl),
            rt.world.entities.a.human!.hands!.left,
          );
        }
        assert.deepEqual(rt.world.entities.spoon.support, {
          kind: 'in-hand',
          by: 'a',
          hand: 'right',
        });
      }
      assert.equal(put.status, 'completed');
      assert.ok(
        (motion === 'approach' ? approach : turn) > 2 && reached,
        JSON.stringify({ approach, turn, reached }),
      );
      assert.deepEqual(rt.violations, []);
      if (parentID) rt.cancel(parentID);
      assert.deepEqual(rt.holder('hand:a:left'), []);
      assert.deepEqual(rt.holder('hand:a:right'), []);
    });
test('unknown reserved-hand actions retain legacy driver ownership', () => {
  const { rt } = setup();
  const a: ActionDef = {
    verb: 'legacy_driver',
    description: 'legacy test',
    schema: z.object({}),
    reservations: () => [{ resource: 'hand:a:right', mode: 'exclusive' }],
    plan: () => ({ ok: true, program: null }),
    start: () => null,
    step: () => ({ status: 'running' }),
    cancel: () => ({ ok: true }),
  };
  rt.registry.set(a.verb, a);
  const r = rt.submit(a.verb, {}),
    before = [...rt.world.entities.spoon.pose.p];
  rt.world.entities.a.pose.p[0] += 1;
  rt.step();
  assert.deepEqual(rt.world.entities.spoon.pose.p, before);
  rt.cancel(r.id);
  rt.step();
  carryMatches(rt, 'right', carryHand(bodyFrame(rt.world.entities.a), 'right'));
});
