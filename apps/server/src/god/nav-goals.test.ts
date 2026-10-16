import test from 'node:test';
import assert from 'node:assert/strict';
import { GodNav, type NavHost } from './nav.ts';

type Vec2 = [number, number];
/** Target-selection unit fixture: exact local standing space and reachability, independent of raster resolution. */
function house(degrees: number, offCentre = false, pocket?: Vec2) {
  const yaw = degrees * Math.PI / 180, c = Math.cos(yaw), s = Math.sin(yaw), origin: Vec2 = [13.17, -7.23];
  const world = ([x, z]: Vec2): Vec2 => [origin[0] + x * c + z * s, origin[1] - x * s + z * c];
  const local = ([x, z]: Vec2): Vec2 => [(x - origin[0]) * c - (z - origin[1]) * s, (x - origin[0]) * s + (z - origin[1]) * c];
  const entity = { id: 'house', name: 'house', def: 'house@1', in: { parent: 'world' } };
  const def = { name: 'house', form: 'point', components: {}, tags: ['building'], make: { kind: 'mesh' } };
  const polygon = offCentre ? [[2.6, -3], [3.4, -3], [3.4, 4], [2.6, 4]] : [[-4, -3], [4, -3], [4, 4], [-4, 4]];
  const baked = { rooms: [{ id: 'living', polygon }],
    slots: [{ id: 'living', kind: 'room', p: [offCentre ? 3 : 0, 0, 0.5], yaw: 0 }],
    openings: [{ id: 'front-door', kind: 'door', at: [offCentre ? 3 : 0, 4], yaw: 0, width: 1, state: 'open' }] };
  const attempts: Vec2[] = [];
  const nav = new GodNav({ model: {
    entities: new Map([['house', entity]]), editSeq: 1,
    ground: () => ({ waters: [] }), resolvedDef: () => def, bake: () => baked,
    worldPose: () => ({ x: origin[0], y: 0, z: origin[1], yaw, s: 1 }),
    pathOf: () => 'house', get: () => undefined,
  }, engine: { world: { tick: 0, entities: {} },
    standableNearV1: (at: Vec2) => {
      const [x, z] = local(at);
      // A narrow entrance wing offset from the building centre. There is standing room only along its actual
      // opening normal; a radial approach is in the side wall. Outside the front wall is ordinary open ground.
      return !offCentre || z >= 4 || (x >= 2.6 && x <= 3.4) ? at : null;
    },
    reachV1: (_from: unknown, to: { p: Vec2 }) => {
      const p = local(to.p); attempts.push(p);
      return { ok: !!pocket && Math.hypot(p[0] - pocket[0], p[1] - pocket[1]) < 0.04 };
    },
  }, levelAt: () => 0, engineOwned: () => false } as unknown as NavHost);
  return { nav, world, local, attempts };
}

test('off-centre entrances use the opening normal at every building yaw', () => {
  for (const degrees of [0, 30, 37, 45, 60, 82]) {
    const { nav, world, local } = house(degrees, true);
    const building = nav.thing('house')!;
    const goal = nav.goal(building, world([3, 8]));
    assert.ok(goal, `${degrees}: an indoor goal exists`);
    const p = local(goal.p);
    assert.ok(Math.abs(p[0] - 3) < 0.02 && Math.abs(p[1] - 3) < 0.02, `${degrees}: inside along the door normal, got ${p}`);
    const approach = local(building.stands![0]);
    assert.ok(Math.abs(approach[0] - 3) < 0.002 && Math.abs(approach[1] - 5.2) < 0.002, `${degrees}: approach is normal to the opening`);
  }
});

test('a reachable furnished-room pocket stays offered after the building turns', () => {
  for (const degrees of [0, 30, 37, 45, 60, 82]) {
    const pocket: Vec2 = [-0.1, 0.3];
    const { nav, world, local } = house(degrees, false, pocket);
    const goal = nav.goal(nav.thing('house/living')!, world([0, 8]));
    assert.ok(goal, `${degrees}: the reachable pocket is found`);
    const p = local(goal.p);
    assert.ok(Math.hypot(p[0] - pocket[0], p[1] - pocket[1]) < 0.04, `${degrees}: goal stays in the reachable pocket`);
  }
});

test('furnished-room fallback samples rotate with the room, preserving bounded reach checks', () => {
  let baseline: Vec2[] | undefined;
  for (const degrees of [0, 30, 37, 45, 60, 82]) {
    const { nav, world, attempts } = house(degrees);
    assert.equal(nav.goal(nav.thing('house/living')!, world([0, 8])), null, 'the exact reach oracle refuses every pocket');
    assert.ok(attempts.length > 1 && attempts.length <= 15, 'centre plus at most fourteen fallback reach checks');
    if (!baseline) baseline = attempts;
    else {
      assert.equal(attempts.length, baseline.length);
      // Published goals round world coordinates to centimetres; compare local samples within that rounding envelope.
      for (let i = 0; i < attempts.length; i++) assert.ok(Math.hypot(attempts[i][0] - baseline[i][0], attempts[i][1] - baseline[i][1]) < 0.015,
        `${degrees}: local fallback ${i} changed from ${baseline[i]} to ${attempts[i]}`);
    }
  }
});
