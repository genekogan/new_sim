import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG } from '../world/catalog.ts';
import { DRAWING_ASSETS } from '../world/catalog-drawing.ts';
import {
  drawingWorkRuntime,
  drawingWorkParams,
} from '../scenarios/drawing-work.ts';
import { DRAWING_TOTAL_TICKS, readDrawing } from '../objects/drawing.ts';
import { itemEntity, placeOnSlot, surfaceSlot } from '../items/model.ts';
import { Spatial } from '../spatial/service.ts';
import type { Runtime } from '../runtime/runtime.ts';
for (const def of DRAWING_ASSETS) CATALOG[def.id] = def;
function read(rt: Runtime) {
  const r = readDrawing(rt, 'sketch-pad');
  assert.ok(!('code' in r));
  return r;
}
function until(rt: Runtime, done: () => boolean) {
  for (let i = 0; i < 4000 && !done(); i++) rt.step();
  assert.ok(done(), 'bounded drawing drained');
}
function clean(rt: Runtime) {
  assert.deepEqual(rt.violations, []);
  assert.equal(rt.world.entities.sketcher.human!.activity, 'idle');
  for (const resource of [
    'actor:sketcher',
    'hand:sketcher:right',
    'entity:sketch-pad',
    'entity:sketch-pencil',
    'entity:sketch-table',
    'surface:sketch-table#r0c3',
  ])
    assert.deepEqual(rt.holder(resource), [], resource);
  assert.equal(rt.world.entities['sketch-pencil'].support?.kind, 'resting-on');
}
test('ordinary take, approach, moving pencil strokes and put retain same identities and completed artwork', () => {
  const rt = drawingWorkRuntime(),
    ids = Object.keys(rt.world.entities),
    pad = structuredClone(rt.world.entities['sketch-pad'].pose),
    a = rt.submit('drawing_work', drawingWorkParams()),
    points = new Set<string>();
  until(rt, () => {
    if (a.phase === 'drawing')
      points.add(
        JSON.stringify(rt.world.entities.sketcher.human!.hands?.right),
      );
    return !rt.isActive(a.id);
  });
  assert.equal(a.status, 'completed', a.diagnostic?.message);
  assert.equal(read(rt).ticks, DRAWING_TOTAL_TICKS);
  assert.equal(read(rt).completedMarks.length, 8);
  assert.equal(read(rt).pencil, 'sketch-pencil');
  assert.ok(points.size > 100);
  assert.deepEqual(Object.keys(rt.world.entities), ids);
  assert.deepEqual(rt.world.entities['sketch-pad'].pose, pad);
  assert.deepEqual(
    [...rt.records.values()]
      .filter((r) => r.parent === a.id)
      .map((r) => r.verb),
    ['take_item', 'walk_to', 'put_item'],
  );
  clean(rt);
  const detached = read(rt);
  detached.completedMarks[0][0][0] = 99;
  assert.notEqual(read(rt).completedMarks[0][0][0], 99);
});
test('cancel retains exact partial stroke, returns pencil and explicitly resumes same artwork', () => {
  const rt = drawingWorkRuntime(),
    a = rt.submit('drawing_work', drawingWorkParams());
  until(rt, () => read(rt).ticks === 47);
  rt.cancel(a.id);
  until(rt, () => !rt.isActive(a.id));
  assert.equal(read(rt).ticks, 47);
  assert.equal(read(rt).completedMarks.length, 2);
  assert.equal(read(rt).status, 'unfinished');
  clean(rt);
  assert.equal(
    rt.submit('drawing_work', drawingWorkParams()).diagnostic?.code,
    'drawing.unfinished-task',
  );
  assert.equal(
    rt.submit('drawing_work', {
      ...drawingWorkParams(),
      task: 'different',
      resume: true,
    }).diagnostic?.code,
    'drawing.unfinished-task',
  );
  const b = rt.submit('drawing_work', { ...drawingWorkParams(), resume: true });
  until(rt, () => !rt.isActive(b.id));
  assert.equal(b.status, 'completed', b.diagnostic?.message);
  assert.equal(read(rt).ticks, 160);
  clean(rt);
});
test('preempting with ordinary walk waits for safe pencil return and retains unfinished marks', () => {
  const rt = drawingWorkRuntime(),
    a = rt.submit('drawing_work', drawingWorkParams());
  until(rt, () => read(rt).ticks >= 35);
  const b = rt.submit('walk_to', { actor: 'sketcher', x: 3, z: -3 });
  until(rt, () => !rt.isActive(b.id));
  assert.equal(a.status, 'cancelled');
  assert.equal(b.status, 'completed', b.diagnostic?.message);
  assert.equal(read(rt).ticks, 35);
  clean(rt);
});
test('same decisions replay identically', () => {
  const run = () => {
    const rt = drawingWorkRuntime(),
      a = rt.submit('drawing_work', drawingWorkParams());
    until(rt, () => read(rt).ticks === 47);
    rt.cancel(a.id);
    until(rt, () => !rt.isActive(a.id));
    const b = rt.submit('drawing_work', {
      ...drawingWorkParams(),
      resume: true,
    });
    until(rt, () => !rt.isActive(b.id));
    return {
      hash: rt.stateHash(),
      read: read(rt),
      records: [...rt.records.values()],
    };
  };
  assert.deepEqual(run(), run());
});
test('missing, wrong, unsupported, unavailable and occupied resources refuse with named diagnostics without mutation', () => {
  for (const [mutation, code, subject] of [
    [
      (rt: Runtime) => {
        delete rt.world.entities['sketch-pad'];
      },
      'drawing.missing-pad',
      'sketch-pad',
    ],
    [
      (rt: Runtime) => {
        delete rt.world.entities['sketch-pencil'];
      },
      'drawing.missing-pencil',
      'sketch-pencil',
    ],
    [
      (rt: Runtime) => {
        rt.world.entities['sketch-pad'].def = 'bowl';
      },
      'drawing.wrong-pad',
      'sketch-pad',
    ],
    [
      (rt: Runtime) => {
        rt.world.entities['sketch-pad'].support = { kind: 'ground' };
      },
      'drawing.pad-support',
      'sketch-pad',
    ],
    [
      (rt: Runtime) => {
        rt.world.entities['sketch-pad'].equipment = {
          kind: 'drawing',
          config: { available: false },
        };
      },
      'drawing.unavailable',
      'sketch-pad',
    ],
    [
      (rt: Runtime) => {
        rt.world.entities['sketch-table'].pose.pitch = 0.2;
      },
      'drawing.invalid-support',
      'sketch-table',
    ],
    [
      (rt: Runtime) => {
        const e = itemEntity('intruder', 'cup', [0, 0, 0]);
        const s = surfaceSlot(rt.world, 'sketch-table#r0c3');
        assert.ok(!('code' in s));
        placeOnSlot(e, s, 0);
        rt.world.entities[e.id] = e;
      },
      'drawing.return-occupied',
      'intruder',
    ],
  ] as const) {
    const rt = drawingWorkRuntime();
    mutation(rt);
    const before = rt.stateHash();
    const r = rt.submit('drawing_work', drawingWorkParams());
    assert.equal(r.status, 'failed');
    assert.equal(r.diagnostic?.code, code);
    assert.ok(r.diagnostic?.subjects?.includes(subject));
    assert.equal(rt.stateHash(), before);
  }
});
test('busy pencil and occupied hands never steal resources', () => {
  const rt = drawingWorkRuntime(),
    a = rt.submit('drawing_work', drawingWorkParams());
  assert.equal(
    rt.submit('drawing_work', drawingWorkParams(), { preempt: false })
      .diagnostic?.code,
    'drawing.occupied',
  );
  rt.cancel(a.id);
  until(rt, () => !rt.isActive(a.id));
  clean(rt);
  const cup = itemEntity('held-cup', 'cup', [0, 0, 0]);
  cup.support = { kind: 'in-hand', by: 'sketcher', hand: 'left' };
  cup.phase = undefined;
  rt.world.entities[cup.id] = cup;
  assert.equal(
    rt.submit('drawing_work', { ...drawingWorkParams(), resume: true })
      .diagnostic?.code,
    'drawing.hands-occupied',
  );
});
test('unavailable or moved pad during strokes safely drains physical ownership retaining marks', () => {
  for (const mode of ['unavailable', 'moved']) {
    const rt = drawingWorkRuntime(),
      a = rt.submit('drawing_work', drawingWorkParams());
    until(rt, () => read(rt).ticks === 30);
    if (mode === 'unavailable')
      rt.world.entities['sketch-pad'].equipment!.config.available = false;
    else rt.world.entities['sketch-pad'].pose.yaw = 0.2;
    until(rt, () => !rt.isActive(a.id));
    assert.equal(a.status, 'failed');
    assert.equal(
      a.diagnostic?.code,
      mode === 'unavailable'
        ? 'drawing.unavailable'
        : 'drawing.support-changed',
    );
    assert.equal(read(rt).ticks, 30);
    assert.equal(read(rt).status, 'unfinished');
    clean(rt);
  }
});
test('cancel before grasp drains and retains zero progress for continuation', () => {
  const rt = drawingWorkRuntime(),
    a = rt.submit('drawing_work', drawingWorkParams());
  rt.step();
  rt.cancel(a.id);
  until(rt, () => !rt.isActive(a.id));
  assert.equal(read(rt).ticks, 0);
  assert.equal(read(rt).status, 'unfinished');
  clean(rt);
});
test('blocked drawing table names obstacle before taking any resource', () => {
  const rt = drawingWorkRuntime();
  rt.services.spatial.base.obstacles.push({
    id: 'drawing-blocker',
    obb: { c: [0, 0], half: [2, 2], yaw: 0 },
    y0: 0,
    y1: 2,
    kind: 'wall',
  });
  rt.services.spatial = new Spatial(rt.services.spatial.base);
  const before = rt.stateHash(),
    a = rt.submit('drawing_work', drawingWorkParams());
  assert.equal(a.status, 'failed');
  assert.equal(a.diagnostic?.code, 'item.unreachable');
  assert.ok(a.diagnostic?.subjects?.includes('drawing-blocker'));
  assert.equal(rt.stateHash(), before);
});
test('occupied return slot blocks safe release, then drains after the explicit obstruction is removed', () => {
  const rt = drawingWorkRuntime(),
    a = rt.submit('drawing_work', drawingWorkParams());
  until(rt, () => read(rt).ticks === 47);
  const e = itemEntity('return-obstruction', 'cup', [0, 0, 0]),
    s = surfaceSlot(rt.world, 'sketch-table#r0c3');
  assert.ok(!('code' in s));
  placeOnSlot(e, s, 0);
  rt.world.entities[e.id] = e;
  rt.cancel(a.id);
  until(rt, () => a.status === 'blocked');
  assert.equal(a.diagnostic?.code, 'item.slot-occupied');
  assert.ok(a.diagnostic?.subjects?.includes('return-obstruction'));
  assert.equal(rt.world.entities['sketch-pencil'].support?.kind, 'in-hand');
  assert.equal(read(rt).ticks, 47);
  const records = rt.records.size;
  for (let i = 0; i < 20; i++) rt.step();
  assert.equal(
    rt.records.size,
    records,
    'blocked return does not spawn replacement child actions',
  );
  delete rt.world.entities['return-obstruction'];
  until(rt, () => !rt.isActive(a.id));
  assert.equal(a.status, 'cancelled');
  clean(rt);
});

test('repeated parent Cancel drains one physical pencil return without restarting cleanup', () => {
  const rt = drawingWorkRuntime(), p = drawingWorkParams(), r = rt.submit('drawing_work', p);
  until(rt, () => { const s = readDrawing(rt, p.pad); return !('code' in s) && s.ticks >= 31; });
  const partial = readDrawing(rt, p.pad); assert.ok(!('code' in partial));
  for (let i = 0; i < 200 && rt.isActive(r.id); i++) { rt.cancel(r.id); rt.step(); assert.deepEqual(rt.violations, []); }
  assert.equal(r.status, 'cancelled');
  assert.equal([...rt.records.values()].filter(q => q.verb === 'put_item').length, 1);
  const stopped = readDrawing(rt, p.pad); assert.ok(!('code' in stopped));
  assert.equal(stopped.ticks, partial.ticks);
  assert.equal(stopped.status, 'unfinished');
  assert.equal(rt.world.entities[p.pencil].support?.kind, 'resting-on');
  assert.ok([...rt.records.values()].every(q => !rt.isActive(q.id)));
});
