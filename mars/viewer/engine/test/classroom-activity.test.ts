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
import { slotsOf, allSlots } from '../social/slots.ts';
import { CLASSROOM_ACTIONS, readClassroom } from '../activities/index.ts';
import type { ClassroomDisplay, ClassroomParams } from '../activities/index.ts';

function setup(audienceCount = 4, arrangement = 0, spare = false) {
  const scene: SpatialScene = {
    bounds: [-30, -30, 30, 30],
    levels: [{ id: 0, y: 0, label: 'ground' }],
    surfaces: [
      {
        id: 'ground',
        level: 0,
        y: 0,
        obb: { c: [0, 0], half: [30, 30], yaw: 0 },
      },
    ],
    obstacles: [],
    links: [],
  };
  const actors = [
    'host',
    'p1',
    'p2',
    ...Array.from({ length: audienceCount }, (_, i) => `a${i}`),
  ];
  const chairs: Entity[] = actors
    .concat(spare ? ['spare'] : [])
    .map((_, i) => ({
      id: `chair${i}`,
      def: 'camp-chair',
      kind: 'fixture',
      pose: {
        p: [-10 + i * 2, 0, arrangement ? -3 - (i % 2) * 2 : -4],
        yaw: 0,
      },
      provenance: FIXTURE,
    }));
  const w = addAll(
    emptyWorld('classroom-test', scene),
    ...chairs,
    ...actors.map((a, i) => human(a, -10 + i * 2, -11)),
  );
  w.regions.station = {
    id: 'station',
    kind: 'place',
    label: 'presenter station',
    polygon: [
      [-2, 0],
      [2, 0],
      [2, 4],
      [-2, 4],
    ],
    provenance: FIXTURE,
    layout: { focus: [0, -5], spacing: 2, rowGap: 2, kind: 'stand' },
  } as (typeof w.regions)[string];
  const reg = new Map<string, ActionDef>(
    [walkTo, ...SOCIAL_ACTIONS, ...CLASSROOM_ACTIONS].map((a) => [a.verb, a]),
  );
  const focuses: { phase: string; floor?: string; attention?: string }[] = [];
  const service: ClassroomDisplay = {
    supports: (_rt, d) =>
      d === 'screen'
        ? null
        : {
            code: 'display.unavailable',
            message: `${d} is unavailable`,
            subjects: [d],
          },
    focus: (rt, s) => {
      assert.deepEqual(rt.holder(`display:${s.displayId}`), [s.session]);
      focuses.push({
        phase: s.phase,
        floor: s.floorHolder,
        attention: s.attentionTarget?.actor,
      });
      return null;
    },
    clear: (rt, session, d) => {
      assert.deepEqual(rt.holder(`display:${d}`), [session]);
      return null;
    },
  };
  const rt = new Runtime(
    w,
    reg,
    { spatial: new Spatial(scene), classroomDisplay: service },
    DEFAULT_INVARIANTS,
  );
  const stations = slotsOf(rt, 'station');
  assert.ok(Array.isArray(stations));
  const params: ClassroomParams = {
    host: 'host',
    presenters: ['p1', 'p2'],
    audience: actors.slice(3),
    seats: chairs.map((c) => `${c.id}#seat`),
    presenterStation: stations[0].id,
    displayId: 'screen',
    departure: Object.fromEntries(actors.map((a, i) => [a, [-12 + i * 2, 13]])),
    conversationPoints: [
      [-8, 5],
      [2, 5],
      [12, 5],
    ],
    talkSeconds: 0.5,
    questionSeconds: 0.3,
    conversationSeconds: 0.4,
    maxPhaseSeconds: 90,
  };
  return { rt, params, actors, focuses };
}
function until(rt: Runtime, f: () => boolean, max = 3600) {
  for (let i = 0; i < max && !f(); i++) rt.step();
  assert.ok(
    f(),
    JSON.stringify(
      [...rt.records.values()]
        .filter((r) => rt.isActive(r.id))
        .map((r) => ({
          id: r.id,
          verb: r.verb,
          phase: r.phase,
          diagnostic: r.diagnostic,
        })),
    ),
  );
}
function assertClean(rt: Runtime, actors: string[]) {
  for (const actor of actors)
    assert.deepEqual(rt.holder(`actor:${actor}`), [], actor);
  for (const s of allSlots(rt)) assert.equal(s.claimedBy, undefined, s.id);
  assert.deepEqual(rt.holder('display:screen'), []);
  assert.deepEqual(rt.violations, []);
}
for (const [size, arrangement] of [
  [4, 0],
  [8, 1],
])
  test(`classroom completes physical cycle, questions and attention: arrangement ${arrangement}, audience ${size}`, () => {
    const { rt, params, actors, focuses } = setup(size, arrangement);
    const a = rt.submit('classroom_session', params);
    assert.equal(a.status, 'executing', a.diagnostic?.message);
    rt.submit('classroom_control', {
      session: a.id,
      intent: { kind: 'question', actor: 'a0' },
    });
    until(rt, () => !rt.isActive(a.id), 6000);
    assert.equal(a.status, 'completed', a.diagnostic?.message);
    assert.ok(
      focuses.some(
        (f) =>
          f.phase === 'question' && f.attention === 'a0' && f.floor === 'p1',
      ),
    );
    assert.ok(
      focuses.some((f) => f.phase === 'presenting' && f.attention === 'p1'),
    );
    assert.ok(
      focuses.some((f) => f.phase === 'presenting' && f.floor === 'p2'),
    );
    assert.ok(
      [...rt.records.values()].some(
        (r) => r.verb === 'converse' && r.status === 'completed',
      ),
    );
    for (const actor of actors) {
      const q = params.departure[actor],
        p = rt.world.entities[actor].pose.p;
      assert.ok(Math.hypot(p[0] - q[0], p[2] - q[1]) < 0.06, actor);
    }
    assertClean(rt, actors);
  });
test('classroom deterministic world, action events and attention', () => {
  const execute = () => {
    const { rt, params, focuses } = setup();
    const a = rt.submit('classroom_session', params);
    rt.submit('classroom_control', {
      session: a.id,
      intent: { kind: 'question', actor: 'a1' },
    });
    until(rt, () => !rt.isActive(a.id), 6000);
    return { hash: rt.stateHash(), events: rt.events, focuses };
  };
  assert.deepEqual(execute(), execute());
});
test('occupied seat uses spare eligible fixture, insufficient seats refuse', () => {
  const { rt, params, actors } = setup(4, 0, true);
  addAll(rt.world, human('outsider', -10, -8));
  const seat = rt.submit('sit', { actor: 'outsider', slot: params.seats[0] });
  until(rt, () => seat.phase === 'occupied');
  const a = rt.submit('classroom_session', params);
  assert.equal(a.status, 'executing', a.diagnostic?.message);
  assert.ok(
    readClassroom(rt, a.id)!.participants.every(
      (p) => p.seat !== params.seats[0],
    ),
  );
  until(rt, () => !rt.isActive(a.id), 6000);
  assert.equal(a.status, 'completed', a.diagnostic?.message);
  assert.equal(rt.isActive(seat.id), true);
  rt.cancel(seat.id);
  until(rt, () => !rt.isActive(seat.id));
  assertClean(rt, [...actors, 'outsider']);
});
test('directed interruption excludes seated audience and others finish', () => {
  const { rt, params, actors } = setup();
  const a = rt.submit('classroom_session', params);
  until(rt, () => readClassroom(rt, a.id)?.phase === 'presenting');
  const directive = rt.submit('walk_to', { actor: 'a0', x: -20, z: 0 });
  assert.equal(directive.phase, 'pre-empting');
  until(rt, () => !rt.isActive(a.id) && !rt.isActive(directive.id), 6000);
  assert.equal(a.status, 'completed', a.diagnostic?.message);
  assert.equal(directive.status, 'completed', directive.diagnostic?.message);
  assert.equal(
    readClassroom(rt, a.id)!.participants.find((p) => p.actor === 'a0')!.state,
    'excluded',
  );
  assertClean(rt, actors);
});
test('registered departure and cancellation wait for safe seat stops', () => {
  const { rt, params, actors } = setup();
  const a = rt.submit('classroom_session', params);
  until(rt, () => readClassroom(rt, a.id)?.phase === 'presenting');
  rt.submit('classroom_control', {
    session: a.id,
    intent: { kind: 'depart', actor: 'a0' },
  });
  rt.step();
  assert.equal(
    readClassroom(rt, a.id)!.participants.find((p) => p.actor === 'a0')!.state,
    'excluded',
  );
  rt.submit('classroom_control', { session: a.id, intent: { kind: 'cancel' } });
  rt.step();
  assert.equal(rt.isActive(a.id), true);
  assert.ok(rt.holder(`slot:${params.presenterStation}`).includes(a.id));
  until(rt, () => !rt.isActive(a.id));
  assert.equal(a.status, 'cancelled');
  until(rt, () => ![...rt.records.values()].some((r) => rt.isActive(r.id)));
  assertClean(rt, actors);
});
test('invalid membership, display and controls name concrete diagnostics', () => {
  const { rt, params, actors } = setup();
  const duplicate = rt.submit('classroom_session', {
    ...params,
    audience: ['p1', ...params.audience],
  });
  assert.equal(duplicate.diagnostic?.code, 'classroom.duplicate-participant');
  const unavailable = rt.submit('classroom_session', {
    ...params,
    displayId: 'missing-screen',
  });
  assert.equal(unavailable.diagnostic?.code, 'display.unavailable');
  const missing = rt.submit('classroom_session', {
    ...params,
    displayId: undefined,
  });
  assert.equal(missing.diagnostic?.code, 'classroom.display-required');
  const a = rt.submit('classroom_session', {
    ...params,
    displayId: undefined,
    requireDisplay: false,
  });
  assert.equal(a.status, 'executing');
  const stranger = rt.submit('classroom_control', {
    session: a.id,
    intent: { kind: 'question', actor: 'stranger' },
  });
  assert.equal(stranger.diagnostic?.code, 'classroom.participant-ineligible');
  const presenter = rt.submit('classroom_control', {
    session: a.id,
    intent: { kind: 'question', actor: 'p1' },
  });
  assert.equal(presenter.diagnostic?.code, 'classroom.question-ineligible');
  rt.cancel(a.id);
  until(rt, () => !rt.isActive(a.id));
  assertClean(rt, actors);
});
test('host loss ends with named failure after coherent safe cleanup', () => {
  const { rt, params, actors } = setup();
  const a = rt.submit('classroom_session', params);
  until(rt, () => readClassroom(rt, a.id)?.phase === 'presenting');
  const directive = rt.submit('walk_to', { actor: 'host', x: -20, z: 1 });
  until(rt, () => !rt.isActive(a.id) && !rt.isActive(directive.id));
  assert.equal(a.status, 'failed');
  assert.equal(a.diagnostic?.code, 'classroom.host-left');
  assertClean(rt, actors);
});
test('presenter directive yields floor and rotates to remaining presenter', () => {
  const { rt, params, actors, focuses } = setup();
  const a = rt.submit('classroom_session', params);
  until(rt, () => readClassroom(rt, a.id)?.phase === 'presenting');
  const directive = rt.submit('walk_to', { actor: 'p1', x: -20, z: 2 });
  until(rt, () => !rt.isActive(a.id) && !rt.isActive(directive.id), 6000);
  assert.equal(a.status, 'completed', a.diagnostic?.message);
  assert.ok(focuses.some((f) => f.floor === 'p2' && f.phase === 'presenting'));
  assertClean(rt, actors);
});
test('unavailable display during session safely cleans up; timeout preserves waiting reason', () => {
  const { rt, params, actors } = setup();
  const a = rt.submit('classroom_session', params);
  until(rt, () => readClassroom(rt, a.id)?.phase === 'presenting');
  (rt.services.classroomDisplay as ClassroomDisplay).supports = (
    _rt,
    displayId,
  ) => ({
    code: 'display.unavailable',
    message: `${displayId} was switched off`,
    subjects: [displayId],
  });
  until(rt, () => !rt.isActive(a.id));
  assert.equal(a.status, 'failed');
  assert.equal(a.diagnostic?.code, 'display.unavailable');
  assertClean(rt, actors);
  const timed = setup();
  const b = timed.rt.submit('classroom_session', {
    ...timed.params,
    maxPhaseSeconds: 0.1,
  });
  until(timed.rt, () => !timed.rt.isActive(b.id));
  assert.equal(b.diagnostic?.code, 'classroom.phase-timeout');
  assert.match(b.diagnostic!.message, /arriving.*fixture seats/);
  assertClean(timed.rt, timed.actors);
});
test('insufficient seats and held participants refuse without new ownership', () => {
  const { rt, params, actors } = setup();
  addAll(rt.world, human('outsider', -10, -8));
  const seat = rt.submit('sit', { actor: 'outsider', slot: params.seats[0] });
  until(rt, () => seat.phase === 'occupied');
  const a = rt.submit('classroom_session', params);
  assert.equal(a.diagnostic?.code, 'classroom.seats-unavailable');
  assert.ok(a.diagnostic!.subjects!.includes(params.seats[0]));
  rt.cancel(seat.id);
  until(rt, () => !rt.isActive(seat.id));
  rt.world.entities.a0.human!.grip = { entity: 'held', slot: 'g0' };
  const b = rt.submit('classroom_session', params);
  assert.equal(b.diagnostic?.code, 'actor.holding');
  delete rt.world.entities.a0.human!.grip;
  assertClean(rt, [...actors, 'outsider']);
});
test('conversation member directive excludes that participant and does not leak group returns', () => {
  const { rt, params, actors } = setup();
  const a = rt.submit('classroom_session', {
    ...params,
    conversationSeconds: 2,
  });
  until(
    rt,
    () =>
      readClassroom(rt, a.id)?.phase === 'conversing' &&
      [...rt.records.values()].some(
        (r) =>
          r.verb === 'converse' &&
          r.phase === 'talking' &&
          (r.params as { actors: string[] }).actors.includes('a0'),
      ),
  );
  const directive = rt.submit('walk_to', { actor: 'a0', x: -20, z: 4 });
  until(rt, () => !rt.isActive(a.id) && !rt.isActive(directive.id), 6000);
  assert.equal(a.status, 'completed', a.diagnostic?.message);
  assert.equal(
    readClassroom(rt, a.id)!.participants.find((p) => p.actor === 'a0')!.state,
    'excluded',
  );
  assertClean(rt, actors);
});
test('external directive pre-empts a departing ground walk without ending other departures', () => {
  const { rt, params, actors } = setup();
  const a = rt.submit('classroom_session', params);
  until(rt, () => readClassroom(rt, a.id)?.phase === 'departing');
  const directive = rt.submit('walk_to', { actor: 'a0', x: -20, z: 4 });
  assert.notEqual(directive.status, 'failed', directive.diagnostic?.message);
  until(rt, () => !rt.isActive(a.id) && !rt.isActive(directive.id), 6000);
  assert.equal(a.status, 'completed', a.diagnostic?.message);
  assert.equal(directive.status, 'completed');
  assertClean(rt, actors);
});
test('disappearing display adapter is named and cleanup preserves ownership through safe stop', () => {
  const { rt, params, actors } = setup();
  const a = rt.submit('classroom_session', params);
  until(rt, () => readClassroom(rt, a.id)?.phase === 'presenting');
  delete rt.services.classroomDisplay;
  rt.step();
  assert.equal(rt.isActive(a.id), true);
  assert.deepEqual(rt.holder('display:screen'), [a.id]);
  until(rt, () => !rt.isActive(a.id));
  assert.equal(a.diagnostic?.code, 'classroom.display-unavailable');
  assertClean(rt, actors);
});
test('usable access links are explicitly outside the bounded classroom scope', () => {
  const { rt, params, actors } = setup();
  (rt.services.spatial as Spatial).base.links.push({
    id: 'stairs-unsupported',
    kind: 'stairs',
    usable: true,
    from: { level: 0, p: [0, 0], y: 0 },
    to: { level: 1, p: [0, 3], y: 3 },
    width: 1,
    heading: 0,
    path: [
      [0, 0, 0],
      [0, 3, 3],
    ],
  });
  const a = rt.submit('classroom_session', params);
  assert.equal(a.diagnostic?.code, 'classroom.access-unsupported');
  assert.match(a.diagnostic!.message, /stairs-unsupported/);
  assertClean(rt, actors);
});
test('failed arrival route names the obstruction and leaves no committed session claims', () => {
  const { rt, params, actors } = setup();
  rt.world.entities.host.pose.p = [40, 0, 40];
  const a = rt.submit('classroom_session', params);
  assert.equal(a.status, 'failed');
  assert.equal(a.diagnostic?.code, 'classroom.seat-route-unavailable');
  assert.ok(a.diagnostic!.subjects!.includes('host'));
  assertClean(rt, actors);
});
test('staggered late arrivals wait for actual seating before assigning the floor', () => {
  const { rt, params, actors } = setup();
  const a = rt.submit('classroom_session', {
    ...params,
    arrivalStaggerSeconds: 0.5,
  });
  assert.equal(
    [...rt.records.values()].filter(
      (r) => r.parent === a.id && r.verb === 'sit',
    ).length,
    1,
  );
  rt.step();
  assert.equal(readClassroom(rt, a.id)!.floorHolder, undefined);
  until(rt, () => readClassroom(rt, a.id)?.phase === 'presenting');
  assert.ok(rt.tick > (actors.length - 1) * 10);
  until(rt, () => !rt.isActive(a.id), 6000);
  assert.equal(a.status, 'completed', a.diagnostic?.message);
  assertClean(rt, actors);
});
test('manual audience hold cancellation excludes it while session continues', () => {
  const { rt, params, actors } = setup();
  const a = rt.submit('classroom_session', params);
  until(rt, () => readClassroom(rt, a.id)?.phase === 'presenting');
  const hold = [...rt.records.values()].find(
    (r) =>
      r.parent === a.id &&
      r.verb === 'sit' &&
      (r.params as { actor: string }).actor === 'a0',
  )!;
  rt.cancel(hold.id);
  until(rt, () => !rt.isActive(a.id), 6000);
  assert.equal(a.status, 'completed', a.diagnostic?.message);
  assert.equal(
    readClassroom(rt, a.id)!.participants.find((p) => p.actor === 'a0')!.state,
    'excluded',
  );
  assertClean(rt, actors);
});
test('short conversation directive cannot automatically return an excluded member', () => {
  const { rt, params, actors } = setup();
  const a = rt.submit('classroom_session', {
    ...params,
    conversationSeconds: 10,
  });
  until(rt, () =>
    [...rt.records.values()].some(
      (r) =>
        r.verb === 'converse' &&
        r.phase === 'talking' &&
        (r.params as { actors: string[] }).actors.includes('a0'),
    ),
  );
  const directive = rt.submit('walk_to', { actor: 'a0', x: -12, z: 5 });
  until(rt, () => !rt.isActive(a.id) && !rt.isActive(directive.id), 6000);
  assert.equal(a.status, 'completed', a.diagnostic?.message);
  const p = rt.world.entities.a0.pose.p;
  assert.ok(
    Math.hypot(p[0] + 12, p[2] - 5) < 0.06,
    'excluded member remains where its directive ended',
  );
  assertClean(rt, actors);
});
