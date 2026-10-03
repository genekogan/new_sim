import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../runtime/runtime.ts';
import { Spatial } from '../spatial/service.ts';
import { DEFAULT_INVARIANTS } from '../runtime/invariants.ts';
import type { SpatialScene } from '../spatial/types.ts';
import { emptyWorld, human, addAll, FIXTURE } from '../world/factory.ts';
import type { Entity } from '../world/types.ts';
import type { ActionDef } from '../actions/types.ts';
import { walkTo } from '../locomotion/walk.ts';
import { SOCIAL_ACTIONS } from '../social/actions.ts';
import { allSlots, slotsOf } from '../social/slots.ts';
import { CLASSROOM_ACTIONS, readClassroom } from '../activities/index.ts';
import type { ClassroomParams } from '../activities/index.ts';

function setup(audienceCount = 2, spare = true) {
  const scene: SpatialScene = {
    bounds: [-40, -40, 40, 40],
    levels: [{ id: 0, y: 0, label: 'ground' }],
    surfaces: [
      {
        id: 'ground',
        level: 0,
        y: 0,
        obb: { c: [0, 0], half: [40, 40], yaw: 0 },
      },
    ],
    obstacles: [],
    links: [],
  };
  const original = [
    'host',
    'p1',
    'p2',
    ...Array.from({ length: audienceCount }, (_, i) => `a${i}`),
  ];
  const ids = [...original, ...(spare ? ['late-chair'] : [])];
  const chairs: Entity[] = ids.map((_, i) => ({
    id: `chair${i}`,
    def: 'camp-chair',
    kind: 'fixture',
    pose: { p: [-14 + i * 2, 0, -4], yaw: 0 },
    provenance: FIXTURE,
  }));
  const w = addAll(
    emptyWorld('classroom-joining', scene),
    ...chairs,
    ...original.map((a, i) => human(a, -14 + i * 2, -11)),
    human('late', 12, -16),
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
  const rt = new Runtime(
    w,
    new Map<string, ActionDef>(
      [walkTo, ...SOCIAL_ACTIONS, ...CLASSROOM_ACTIONS].map((a) => [a.verb, a]),
    ),
    { spatial: new Spatial(scene) },
    DEFAULT_INVARIANTS,
  );
  const station = slotsOf(rt, 'station');
  assert.ok(Array.isArray(station));
  const params: ClassroomParams = {
    host: 'host',
    presenters: ['p1', 'p2'],
    audience: original.slice(3),
    seats: chairs.map((c) => `${c.id}#seat`),
    presenterStation: station[0].id,
    departure: Object.fromEntries(
      original.map((a, i) => [a, [-14 + i * 2, 15]]),
    ),
    requireDisplay: false,
    talkSeconds: 5,
    questionSeconds: 1,
    conversationSeconds: 0.3,
    maxPhaseSeconds: 100,
  };
  return { rt, params, original };
}

function until(rt: Runtime, done: () => boolean, max = 6000) {
  for (let i = 0; i < max && !done(); i++) rt.step();
  assert.ok(
    done(),
    `bounded action did not reach expected state: ${JSON.stringify([...rt.records.values()].filter((r) => rt.isActive(r.id)).map((r) => ({ verb: r.verb, status: r.status, phase: r.phase, diagnostic: r.diagnostic })))}`,
  );
}
function presenting(rt: Runtime, params: ClassroomParams) {
  const session = rt.submit('classroom_session', params);
  assert.equal(session.status, 'executing', session.diagnostic?.message);
  until(rt, () => readClassroom(rt, session.id)?.phase === 'presenting');
  return session;
}
function clearClaims(rt: Runtime) {
  for (const e of Object.values(rt.world.entities))
    if (e.kind === 'human')
      assert.deepEqual(rt.holder(`actor:${e.id}`), [], e.id);
  for (const s of allSlots(rt)) assert.equal(s.claimedBy, undefined, s.id);
  assert.deepEqual(rt.violations, []);
}

test('late human joins through a spare seat during a live talk and can ask a question', () => {
  const { rt, params } = setup();
  const session = presenting(rt, params);
  const floor = readClassroom(rt, session.id)!.floorHolder;
  const join = rt.submit('classroom_control', {
    session: session.id,
    intent: { kind: 'join', actor: 'late', departure: [12, 15] },
  });
  assert.equal(join.status, 'executing', join.diagnostic?.message);
  rt.step();
  assert.equal(readClassroom(rt, session.id)!.floorHolder, floor);
  assert.ok(readClassroom(rt, session.id)!.joining.includes('late'));
  assert.equal(
    readClassroom(rt, session.id)!.participants.find((p) => p.actor === 'late')
      ?.arrival,
    'joining',
  );
  assert.equal(
    rt.submit('classroom_control', {
      session: session.id,
      intent: { kind: 'question', actor: 'late' },
    }).diagnostic?.code,
    'classroom.question-ineligible',
  );
  until(
    rt,
    () =>
      readClassroom(rt, session.id)?.participants.find(
        (p) => p.actor === 'late',
      )?.arrival === 'seated',
  );
  assert.equal(rt.holder('actor:late')[0], session.id);
  const question = rt.submit('classroom_control', {
    session: session.id,
    intent: { kind: 'question', actor: 'late' },
  });
  assert.equal(question.status, 'executing', question.diagnostic?.message);
  until(rt, () => readClassroom(rt, session.id)?.phase === 'question');
  assert.equal(readClassroom(rt, session.id)?.attentionTarget?.actor, 'late');
  until(rt, () => !rt.isActive(session.id));
  assert.equal(session.status, 'completed', session.diagnostic?.message);
  clearClaims(rt);
});

test('excluded audience explicitly rejoins original seat after a short directive finishes', () => {
  const { rt, params } = setup();
  params.talkSeconds = 90;
  const session = presenting(rt, params);
  const originalSeat = readClassroom(rt, session.id)!.participants.find(
    (p) => p.actor === 'a0',
  )!.seat;
  const directive = rt.submit('walk_to', { actor: 'a0', x: 8, z: -9 });
  until(rt, () => !rt.isActive(directive.id));
  assert.equal(directive.status, 'completed');
  assert.equal(
    readClassroom(rt, session.id)!.participants.find((p) => p.actor === 'a0')
      ?.state,
    'excluded',
  );
  const join = rt.submit('classroom_control', {
    session: session.id,
    intent: { kind: 'join', actor: 'a0' },
  });
  assert.equal(join.status, 'executing', join.diagnostic?.message);
  rt.step();
  assert.equal(
    readClassroom(rt, session.id)!.participants.find((p) => p.actor === 'a0')
      ?.seat,
    originalSeat,
  );
  assert.equal(session.status, 'executing', session.diagnostic?.message);
  until(
    rt,
    () =>
      readClassroom(rt, session.id)?.participants.find((p) => p.actor === 'a0')
        ?.arrival === 'seated',
    1000,
  );
  rt.cancel(session.id);
  until(rt, () => !rt.isActive(session.id));
  clearClaims(rt);
});

test('busy, missing, held, no-seat and wrong-phase joins refuse atomically', () => {
  const { rt, params } = setup(2, false);
  const session = presenting(rt, params);
  const pose = [...rt.world.entities.late.pose.p];
  assert.equal(
    rt.submit('classroom_control', {
      session: session.id,
      intent: { kind: 'join', actor: 'late' },
    }).diagnostic?.code,
    'classroom.departure-missing',
  );
  const noSeat = rt.submit('classroom_control', {
    session: session.id,
    intent: { kind: 'join', actor: 'late', departure: [12, 15] },
  });
  assert.equal(noSeat.diagnostic?.code, 'classroom.join-no-seat');
  assert.deepEqual(rt.world.entities.late.pose.p, pose);
  assert.deepEqual(rt.holder('actor:late'), []);
  assert.equal(
    readClassroom(rt, session.id)!.participants.some((p) => p.actor === 'late'),
    false,
  );
  const busy = rt.submit('walk_to', { actor: 'late', x: 13, z: -10 });
  assert.equal(busy.status, 'executing');
  assert.equal(
    rt.submit('classroom_control', {
      session: session.id,
      intent: { kind: 'join', actor: 'late', departure: [12, 15] },
    }).diagnostic?.code,
    'classroom.join-busy',
  );
  rt.cancel(busy.id);
  rt.world.entities.late.human!.grip = { entity: 'test-load', slot: 'g0' };
  assert.equal(
    rt.submit('classroom_control', {
      session: session.id,
      intent: { kind: 'join', actor: 'late', departure: [12, 15] },
    }).diagnostic?.code,
    'actor.holding',
  );
  rt.world.entities.late.human!.grip = undefined;
  assert.equal(
    rt.submit('classroom_control', {
      session: session.id,
      intent: { kind: 'join', actor: 'missing', departure: [12, 15] },
    }).diagnostic?.code,
    'entity.unknown',
  );
  rt.submit('classroom_control', {
    session: session.id,
    intent: { kind: 'advance' },
  });
  until(rt, () => readClassroom(rt, session.id)?.phase === 'rotating');
  assert.equal(
    rt.submit('classroom_control', {
      session: session.id,
      intent: { kind: 'join', actor: 'late', departure: [12, 15] },
    }).diagnostic?.code,
    'classroom.join-phase',
  );
  rt.cancel(session.id);
  until(rt, () => !rt.isActive(session.id));
  clearClaims(rt);
});

test('cancel during joining safely stops seat walk and releases every claim', () => {
  const { rt, params } = setup();
  const session = presenting(rt, params);
  rt.submit('classroom_control', {
    session: session.id,
    intent: { kind: 'join', actor: 'late', departure: [12, 15] },
  });
  rt.step();
  assert.ok(readClassroom(rt, session.id)!.joining.includes('late'));
  rt.cancel(session.id);
  until(rt, () => !rt.isActive(session.id));
  assert.equal(session.status, 'cancelled');
  clearClaims(rt);
});

test('twelve distinct audience members cannot be bypassed with a spare seat', () => {
  const { rt, params } = setup(12, true);
  const session = presenting(rt, params);
  const join = rt.submit('classroom_control', {
    session: session.id,
    intent: { kind: 'join', actor: 'late', departure: [12, 15] },
  });
  assert.equal(join.diagnostic?.code, 'classroom.audience-full');
  assert.deepEqual(rt.holder('actor:late'), []);
  rt.cancel(session.id);
  until(rt, () => !rt.isActive(session.id));
  clearClaims(rt);
});
