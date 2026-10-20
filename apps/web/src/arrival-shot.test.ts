// P7f: one arrival camera for the poster, LiveWorld and the broadcast's first shot (arrival-shot.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldArrivalPose } from './arrival-shot.ts';
import { entityArrivalPose } from './entity-arrival.ts';
import { entryWorldSouls, godTourViews } from './world-env.ts';
import { arrivalMark, arrivalOver } from './arrival-marks.ts';
import { WorldBroadcast } from './WorldBroadcast.ts';
import { openingMove } from './WorldTour.ts';
import { liftHorizon } from './broadcast-horizon.ts';

// a god world with two named landmarks (the bigger one is the broadcast's opening view) and flat ground
const thing = (id: string, name: string, x: number, z: number, half: number) => ({ id, name, def: 'house', in: { parent: 'world' }, x, z, half });
const things = [thing('e_small', 'kiosk', 40, 10, 2), thing('e_big', 'region-campus-library', -30, 20, 9)];
const layer = {
  model: {
    entities: new Map(things.map((t) => [t.id, t])),
    resolvedDef: () => ({ make: { kind: 'gen' }, tags: ['building'] }),
    footprint: (e: unknown) => { const t = e as (typeof things)[number]; return [{ c: [t.x, t.z] as [number, number], half: [t.half, t.half] as [number, number], y0: 0, y1: 6 }]; },
    editSeq: 7,
  },
  viewBounds: (): [number, number, number, number] => [-40, 0, 45, 30],
  entityCount: 2,
  groundAt: (x: number, z: number) => (Math.abs(x) < 500 && Math.abs(z) < 500 ? 1 : null),
  arrivalAt: () => null,
};

test('P7f: with Souls the arrival is the broadcast\'s opening view (its first establishing view, at the push\'s start)', () => {
  const views = godTourViews(layer, layer.groundAt), a = worldArrivalPose(layer, 390 / 844, 2);
  assert.equal(views[0].id, 'god:e_big');
  const lifted = liftHorizon(views[0].p, views[0].target);  // C1: Broadcast poses look a little less steeply down
  assert.notDeepEqual(lifted, [...views[0].target], 'the fixture looks down, so the lift shows');
  assert.deepEqual([a.eye, a.target, a.fov, a.opening], [[...views[0].p], lifted, 45, 'god:e_big']);
  const k0 = openingMove(views[0]).at(0);  // the broadcast's opening push starts exactly here (unlifted: WorldBroadcast lifts once)
  assert.deepEqual([a.eye, a.target, a.fov], [k0.position, liftHorizon(k0.position, k0.target), k0.fov]);
});

test('P7f: without Souls, or when the page does not say, the arrival frames what was built (as before)', () => {
  const framed = entityArrivalPose(layer.viewBounds(), 2, layer.groundAt, 45, 390 / 844, 1, null);
  for (const souls of [0, null]) {
    const a = worldArrivalPose(layer, 390 / 844, souls);
    assert.deepEqual([a.eye, a.target, a.opening], [framed.eye, framed.target, null]);
  }
  assert.equal(entryWorldSouls(), null, 'no window: unknown');
});

test('P7f: the broadcast\'s first shot starts exactly at the opening view, also once the arrival is over', () => {
  arrivalMark('first-live-frame'); assert.ok(arrivalOver());
  const views = godTourViews(layer, layer.groundAt), b = new WorldBroadcast();
  b.hints = () => ({ soulEntity: () => null, eden: false, daylight: 1, views });
  b.opening = views[0].id;
  const shot = b.sample({}, {}, {} as never, 10, 0.1, 390 / 844, 50, 0.016), a = worldArrivalPose(layer, 390 / 844, 2);
  assert.deepEqual([shot?.pose?.position, shot?.pose?.target, shot?.shot], [a.eye, a.target, 'tour:push:god:e_big'], 'the poster = the broadcast\'s first frame, lifted once');
  assert.equal(b.opening, null, 'used once');
});
