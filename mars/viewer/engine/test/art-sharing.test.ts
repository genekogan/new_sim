import test from 'node:test';
import assert from 'node:assert/strict';
import {
  artSharingRuntime,
  artSharingBinding,
  installArtSharingPlaces,
} from '../scenarios/art-sharing.ts';
import { readArtSharing } from '../activities/art-sharing.ts';
import { readDrawing } from '../objects/drawing.ts';
import { drawingWorkParams } from '../scenarios/drawing-work.ts';
import type { Runtime } from '../runtime/runtime.ts';
import { human } from '../world/factory.ts';
import { Spatial } from '../spatial/service.ts';
import {
  angleDelta,
  rot2,
  add2,
  sub2,
  heading,
  type Vec2,
} from '../core/math.ts';
import type { SocialRegion } from '../social/slots.ts';
import { slotById } from '../social/slots.ts';
function until(rt: Runtime, done: () => boolean, max = 6000) {
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
function read(rt: Runtime, id: string) {
  const r = readArtSharing(rt, id);
  assert.ok(r);
  return r;
}
function artwork(rt: Runtime) {
  const e = rt.world.entities['sketch-pad'];
  return structuredClone({
    id: e.id,
    pose: e.pose,
    support: e.support,
    ticks: e.equipment?.config.drawTicks,
    task: e.equipment?.config.task,
    pencil: e.equipment?.config.pencil,
    user: e.equipment?.config.user,
  });
}
function start(rt = artSharingRuntime(), duration = 32, turnSeconds = 4) {
  const a = rt.submit('art_sharing', {
    ...artSharingBinding(),
    duration,
    turnSeconds,
  });
  assert.equal(a.status, 'executing', a.diagnostic?.message);
  return { rt, a };
}
function control(rt: Runtime, id: string, intent: unknown) {
  const c = rt.submit('art_sharing_control', { session: id, intent });
  assert.notEqual(c.status, 'failed', c.diagnostic?.message);
  return c;
}
function formed(rt: Runtime, id: string) {
  until(rt, () => read(rt, id).mode === 'sharing');
}
function clean(rt: Runtime, id: string) {
  assert.deepEqual(rt.violations, []);
  for (const child of read(rt, id).ownedActions) assert.ok(!rt.isActive(child));
  for (const m of read(rt, id).participants) {
    assert.deepEqual(rt.holder(`actor:${m.actor}`), []);
    assert.deepEqual(rt.holder(`slot:${m.slot}`), []);
  }
  assert.deepEqual(rt.holder('entity:sketch-pad'), []);
  assert.deepEqual(rt.holder('entity:sketch-table'), []);
}
test('host and visitors physically view the actual retained pad, take floors and keep completed discussion effects', () => {
  const { rt, a } = start(),
    before = artwork(rt);
  formed(rt, a.id);
  const r = read(rt, a.id);
  assert.equal(r.floorHolder, 'sketcher');
  assert.equal(r.attentionTarget?.entity, 'sketch-pad');
  assert.deepEqual(r.attentionTarget?.point, [
    before.pose.p[0],
    before.pose.p[1] + 0.012,
    before.pose.p[2],
  ]);
  assert.equal(r.artifact?.marks.length, 8);
  for (const m of r.participants.filter((m) => m.active)) {
    assert.ok(m.physicallyViewing);
    const slot = slotById(rt, m.slot);
    assert.ok(!('code' in slot));
    const person = rt.world.entities[m.actor];
    assert.ok(Math.abs(angleDelta(person.pose.yaw, slot.yaw)) < 0.05);
    assert.equal(person.human!.activity, m.speaking ? 'talk' : 'listen');
  }
  until(rt, () => !rt.isActive(a.id));
  assert.equal(a.status, 'completed', a.diagnostic?.message);
  const ended = read(rt, a.id);
  assert.equal(ended.finished, true);
  assert.equal(ended.elapsed, 32);
  assert.equal(ended.floorHolder, undefined);
  assert.equal(ended.attentionTarget, undefined);
  assert.ok(ended.effects.length >= 7);
  assert.ok(ended.effects.some((e) => e.actor === 'art-visitor1'));
  assert.ok(
    ended.effects.every((e) => e.pad === 'sketch-pad' && e.marks === 8),
  );
  assert.equal(
    rt.world.entities['sketch-pad'].equipment!.config.sharingTurns,
    ended.effects.length,
  );
  assert.deepEqual(artwork(rt), before);
  clean(rt, a.id);
  ended.effects[0].actor = 'tampered';
  ended.artifact!.marks[0][0][0] = 99;
  assert.notEqual(read(rt, a.id).effects[0].actor, 'tampered');
  assert.notEqual(read(rt, a.id).artifact!.marks[0][0][0], 99);
});
test('same physical drawing action produces the pad shared next, including safely unfinished drawings', () => {
  for (const partial of [false, true]) {
    const rt = artSharingRuntime(false),
      draw = rt.submit('drawing_work', drawingWorkParams());
    assert.equal(draw.status, 'executing');
    if (partial) {
      until(rt, () => {
        const r = readDrawing(rt, 'sketch-pad');
        return !('code' in r) && r.ticks >= 47;
      });
      rt.cancel(draw.id);
    }
    until(rt, () => !rt.isActive(draw.id));
    assert.equal(draw.status, partial ? 'cancelled' : 'completed');
    const before = artwork(rt),
      { a } = start(rt, 8, 2);
    until(rt, () => !rt.isActive(a.id));
    assert.equal(a.status, 'completed', a.diagnostic?.message);
    assert.deepEqual(artwork(rt), before);
    assert.equal(read(rt, a.id).artifact!.marks.length, partial ? 2 : 8);
    clean(rt, a.id);
  }
});
test('host and visitors ask, answer and request the floor about this artifact', () => {
  const { rt, a } = start(undefined, 90, 1);
  formed(rt, a.id);
  control(rt, a.id, { kind: 'ask', actor: 'art-visitor1' });
  until(rt, () => read(rt, a.id).effects.some((e) => e.kind === 'question'));
  assert.equal(
    read(rt, a.id).effects.find((e) => e.kind === 'question')!.actor,
    'art-visitor1',
  );
  until(rt, () =>
    read(rt, a.id).effects.some(
      (e) => e.kind === 'answer' && e.actor === 'sketcher',
    ),
  );
  formed(rt, a.id);
  control(rt, a.id, { kind: 'ask', actor: 'sketcher' });
  until(rt, () =>
    read(rt, a.id).effects.some(
      (e) => e.kind === 'question' && e.actor === 'sketcher',
    ),
  );
  control(rt, a.id, { kind: 'answer', actor: 'art-visitor2' });
  until(rt, () =>
    read(rt, a.id).effects.some(
      (e) => e.kind === 'answer' && e.actor === 'art-visitor2',
    ),
  );
  const answer = read(rt, a.id).effects.find(
    (e) => e.kind === 'answer' && e.actor === 'art-visitor2',
  )!;
  assert.equal(read(rt, a.id).effects[answer.replyTo!].actor, 'sketcher');
  control(rt, a.id, { kind: 'floor', actor: 'art-visitor1' });
  until(rt, () => read(rt, a.id).floorHolder === 'art-visitor1');
  assert.equal(read(rt, a.id).attentionTarget?.entity, 'sketch-pad');
  control(rt, a.id, { kind: 'end' });
  until(rt, () => !rt.isActive(a.id));
  assert.equal(read(rt, a.id).finished, false);
  clean(rt, a.id);
});
test('late visitor joins the actual declared place; floor holder can leave by an independent ordinary walk', () => {
  const { rt, a } = start(undefined, 90, 1);
  formed(rt, a.id);
  control(rt, a.id, { kind: 'join', actor: 'art-visitor3' });
  until(
    rt,
    () =>
      read(rt, a.id).participants.find((m) => m.actor === 'art-visitor3')!
        .physicallyViewing,
  );
  control(rt, a.id, { kind: 'floor', actor: 'art-visitor2' });
  until(rt, () => read(rt, a.id).floorHolder === 'art-visitor2');
  control(rt, a.id, { kind: 'leave', actor: 'art-visitor2', to: [4, -3] });
  rt.step();
  const member = read(rt, a.id).participants.find(
    (m) => m.actor === 'art-visitor2',
  )!;
  assert.equal(member.state, 'left');
  assert.equal(member.physicallyViewing, false);
  assert.notEqual(read(rt, a.id).floorHolder, 'art-visitor2');
  const departure = member.departure!;
  assert.equal(rt.records.get(departure)!.verb, 'walk_to');
  assert.equal(rt.records.get(departure)!.parent, undefined);
  until(rt, () => !rt.isActive(departure));
  assert.equal(rt.records.get(departure)!.status, 'completed');
  control(rt, a.id, { kind: 'end' });
  until(rt, () => !rt.isActive(a.id));
  clean(rt, a.id);
});
test('visitor directive releases only that participant and session cleanup leaves the foreign directive intact', () => {
  const { rt, a } = start(undefined, 90, 4);
  formed(rt, a.id);
  const before = artwork(rt),
    walk = rt.submit('walk_to', { actor: 'art-visitor1', x: -5, z: -4 });
  assert.notEqual(walk.status, 'failed', walk.diagnostic?.message);
  rt.step();
  assert.equal(
    read(rt, a.id).participants.find((m) => m.actor === 'art-visitor1')!.state,
    'directed-away',
  );
  assert.equal(
    read(rt, a.id).participants.filter((m) => m.physicallyViewing).length,
    2,
  );
  control(rt, a.id, { kind: 'end' });
  until(rt, () => !rt.isActive(a.id));
  assert.ok(rt.isActive(walk.id), 'foreign directive survives circle cleanup');
  until(rt, () => !rt.isActive(walk.id));
  assert.equal(walk.status, 'completed');
  assert.deepEqual(artwork(rt), before);
  clean(rt, a.id);
});
test('pause and host directive preserve partial discussion and explicitly resume the same artwork', () => {
  const { rt, a } = start(undefined, 24, 4);
  formed(rt, a.id);
  until(rt, () => read(rt, a.id).elapsed >= 5);
  control(rt, a.id, { kind: 'pause' });
  until(rt, () => read(rt, a.id).mode === 'paused');
  const paused = read(rt, a.id);
  assert.equal(paused.floorHolder, undefined);
  assert.ok(paused.participants.every((m) => !m.physicallyViewing));
  const before = artwork(rt);
  for (let i = 0; i < 20; i++) rt.step();
  assert.equal(read(rt, a.id).elapsed, paused.elapsed);
  assert.deepEqual(read(rt, a.id).effects, paused.effects);
  control(rt, a.id, { kind: 'resume' });
  formed(rt, a.id);
  const walk = rt.submit('walk_to', { actor: 'sketcher', x: 0, z: -4 });
  until(rt, () => !rt.isActive(walk.id) && read(rt, a.id).mode === 'waiting');
  assert.equal(read(rt, a.id).diagnostic?.code, 'art_sharing.host-directed');
  const retained = read(rt, a.id).elapsed;
  control(rt, a.id, { kind: 'resume' });
  until(rt, () => !rt.isActive(a.id));
  assert.equal(a.status, 'completed', a.diagnostic?.message);
  assert.ok(read(rt, a.id).elapsed > retained);
  assert.equal(read(rt, a.id).elapsed, 24);
  assert.deepEqual(artwork(rt), before);
  clean(rt, a.id);
});
test('invalid, missing, blank, active or unavailable artwork refuses without physical mutation', () => {
  for (const [change, code] of [
    [
      (rt: Runtime) => {
        delete rt.world.entities['sketch-pad'];
      },
      'art_sharing.artifact',
    ],
    [
      (rt: Runtime) => {
        rt.world.entities['sketch-pad'].def = 'bowl';
      },
      'art_sharing.artifact',
    ],
    [
      (rt: Runtime) => {
        rt.world.entities['sketch-pad'].equipment!.config.drawTicks = 19;
      },
      'art_sharing.blank-artifact',
    ],
    [
      (rt: Runtime) => {
        rt.world.entities['sketch-pad'].equipment!.config.status = 'active';
      },
      'art_sharing.blank-artifact',
    ],
    [
      (rt: Runtime) => {
        rt.world.entities['sketch-pad'].equipment!.config.available = false;
      },
      'art_sharing.artifact',
    ],
    [
      (rt: Runtime) => {
        rt.world.entities['sketch-pad'].support = { kind: 'ground' };
      },
      'art_sharing.artifact',
    ],
  ] as const) {
    const rt = artSharingRuntime();
    change(rt);
    const before = rt.stateHash(),
      a = rt.submit('art_sharing', artSharingBinding());
    assert.equal(a.status, 'failed');
    assert.equal(a.diagnostic?.code, code);
    assert.ok(a.diagnostic?.subjects?.includes('sketch-pad'));
    assert.equal(rt.stateHash(), before);
  }
});
test('occupied, claimed, blocked and wrongly facing viewing places fail before anyone walks', () => {
  for (const [change, code, subject] of [
    [
      (rt: Runtime) => {
        const s = slotById(rt, 'art-left#r1c0');
        assert.ok(!('code' in s));
        rt.world.entities.intruder = human('intruder', s.p[0], s.p[1]);
      },
      'art_sharing.place-occupied',
      'intruder',
    ],
    [
      (rt: Runtime) => {
        const s = slotById(rt, 'art-left#r1c0');
        assert.ok(!('code' in s));
        rt.world.entities.intruder = human('intruder', -5, -5);
        rt.submit('take_slot', { actor: 'intruder', slot: s.id });
      },
      'art_sharing.place-occupied',
      'art-left#r1c0',
    ],
    [
      (rt: Runtime) => {
        const r = rt.world.regions['art-left'] as SocialRegion;
        r.layout!.focus = [-0.15, 0.1];
      },
      'art_sharing.viewing-orientation',
      'sketch-pad',
    ],
    [
      (rt: Runtime) => {
        rt.services.spatial.base.obstacles.push({
          id: 'viewing-wall',
          obb: { c: [-0.95, -0.25], half: [0.04, 0.18], yaw: 0 },
          y0: 0,
          y1: 2,
          kind: 'wall',
        });
        rt.services.spatial = new Spatial(rt.services.spatial.base);
      },
      'art_sharing.view-blocked',
      'viewing-wall',
    ],
  ] as const) {
    const rt = artSharingRuntime();
    change(rt);
    const before = rt.stateHash(),
      a = rt.submit('art_sharing', artSharingBinding());
    assert.equal(a.status, 'failed', a.diagnostic?.message);
    assert.equal(a.diagnostic?.code, code);
    assert.ok(a.diagnostic?.subjects?.includes(subject));
    assert.equal(rt.stateHash(), before);
  }
});
test('rotated physical table and declared places keep correct artifact-facing headings', () => {
  const rt = artSharingRuntime();
  const yaw = Math.PI / 2;
  for (const e of Object.values(rt.world.entities)) {
    const q = rot2([e.pose.p[0], e.pose.p[2]], yaw);
    e.pose.p[0] = q[0];
    e.pose.p[2] = q[1];
    e.pose.yaw += yaw;
  }
  installArtSharingPlaces(rt.world);
  const { a } = start(rt, 8, 2);
  formed(rt, a.id);
  for (const m of read(rt, a.id).participants.filter((m) => m.active)) {
    const s = slotById(rt, m.slot);
    assert.ok(!('code' in s));
    assert.ok(
      Math.abs(angleDelta(rt.world.entities[m.actor].pose.yaw, s.yaw)) < 0.05,
    );
  }
  until(rt, () => !rt.isActive(a.id));
  assert.equal(a.status, 'completed', a.diagnostic?.message);
  clean(rt, a.id);
});
test('artifact intervention pauses and refuses silent rebind, preserving committed discussion', () => {
  const { rt, a } = start(undefined, 24, 2);
  formed(rt, a.id);
  until(rt, () => read(rt, a.id).effects.length >= 2);
  const effects = read(rt, a.id).effects;
  rt.world.entities['sketch-pad'].pose.yaw = 0.2;
  until(rt, () => read(rt, a.id).mode === 'waiting');
  assert.equal(read(rt, a.id).diagnostic?.code, 'art_sharing.artifact-changed');
  assert.deepEqual(read(rt, a.id).effects, effects);
  assert.equal(
    rt.submit('art_sharing_control', {
      session: a.id,
      intent: { kind: 'resume' },
    }).diagnostic?.code,
    'art_sharing.artifact-changed',
  );
  rt.world.entities['sketch-pad'].pose.yaw = 0;
  control(rt, a.id, { kind: 'resume' });
  until(rt, () => !rt.isActive(a.id));
  assert.equal(a.status, 'completed');
  clean(rt, a.id);
});
test('identical controls reproduce actual world, effects and action records', () => {
  const run = () => {
    const { rt, a } = start(undefined, 16, 2);
    formed(rt, a.id);
    until(rt, () => read(rt, a.id).elapsed >= 3);
    control(rt, a.id, { kind: 'ask', actor: 'art-visitor1' });
    rt.step();
    control(rt, a.id, { kind: 'pause' });
    until(rt, () => read(rt, a.id).mode === 'paused');
    control(rt, a.id, { kind: 'resume' });
    until(rt, () => !rt.isActive(a.id));
    clean(rt, a.id);
    return {
      world: rt.stateHash(),
      records: [...rt.records.values()],
      readout: read(rt, a.id),
      events: rt.events,
    };
  };
  assert.deepEqual(run(), run());
});
test('invalid controls and incomplete formation refuse without changing membership or retained artwork', () => {
  const { rt, a } = start(undefined, 60, 2),
    before = artwork(rt);
  assert.equal(
    rt.submit('art_sharing_control', {
      session: a.id,
      intent: { kind: 'ask', actor: 'art-visitor1' },
    }).diagnostic?.code,
    'art_sharing.not-viewing',
  );
  formed(rt, a.id);
  for (const [intent, code] of [
    [{ kind: 'join', actor: 'art-visitor1' }, 'art_sharing.already-present'],
    [
      { kind: 'leave', actor: 'sketcher', to: [0, -4] },
      'art_sharing.host-leave',
    ],
    [
      { kind: 'answer', actor: 'art-visitor1' },
      'art_sharing.answer-ineligible',
    ],
    [{ kind: 'floor', actor: 'unknown-person' }, 'art_sharing.participant'],
  ] as const) {
    const state = rt.stateHash(),
      snapshot = read(rt, a.id);
    assert.equal(
      rt.submit('art_sharing_control', { session: a.id, intent }).diagnostic
        ?.code,
      code,
    );
    assert.equal(rt.stateHash(), state);
    assert.deepEqual(read(rt, a.id), snapshot);
  }
  const late = slotById(rt, 'art-late#r1c0');
  assert.ok(!('code' in late));
  rt.world.entities.intruder = human('intruder', late.p[0], late.p[1]);
  const state = rt.stateHash();
  assert.equal(
    rt.submit('art_sharing_control', {
      session: a.id,
      intent: { kind: 'join', actor: 'art-visitor3' },
    }).diagnostic?.code,
    'art_sharing.place-occupied',
  );
  assert.equal(rt.stateHash(), state);
  assert.equal(
    read(rt, a.id).participants.find((m) => m.actor === 'art-visitor3')!.state,
    'invited',
  );
  delete rt.world.entities.intruder;
  control(rt, a.id, { kind: 'end' });
  until(rt, () => !rt.isActive(a.id));
  assert.deepEqual(artwork(rt), before);
  clean(rt, a.id);
});
test('unavailable artifact drains all physical holds and requires explicit resource repair before continuation', () => {
  const { rt, a } = start(undefined, 16, 2);
  formed(rt, a.id);
  until(rt, () => read(rt, a.id).elapsed >= 3);
  const elapsed = read(rt, a.id).elapsed,
    effects = read(rt, a.id).effects;
  rt.world.entities['sketch-pad'].equipment!.config.available = false;
  until(rt, () => read(rt, a.id).mode === 'waiting');
  assert.ok(read(rt, a.id).participants.every((m) => !m.physicallyViewing));
  assert.equal(read(rt, a.id).floorHolder, undefined);
  assert.deepEqual(read(rt, a.id).effects, effects);
  assert.equal(read(rt, a.id).elapsed, elapsed);
  assert.equal(
    rt.submit('art_sharing_control', {
      session: a.id,
      intent: { kind: 'resume' },
    }).diagnostic?.code,
    'art_sharing.artifact',
  );
  rt.world.entities['sketch-pad'].equipment!.config.available = true;
  control(rt, a.id, { kind: 'resume' });
  until(rt, () => !rt.isActive(a.id));
  assert.equal(a.status, 'completed');
  clean(rt, a.id);
});
test('loss of all visitors pauses until explicit declared rejoin and resume', () => {
  const { rt, a } = start(undefined, 16, 2);
  formed(rt, a.id);
  for (const [actor, x] of [
    ['art-visitor1', -5],
    ['art-visitor2', 5],
  ] as const)
    rt.submit('walk_to', { actor, x, z: -4 });
  until(
    rt,
    () =>
      read(rt, a.id).mode === 'waiting' &&
      ['art-visitor1', 'art-visitor2'].every(
        (actor) => !rt.holder(`actor:${actor}`).length,
      ),
  );
  assert.equal(read(rt, a.id).diagnostic?.code, 'art_sharing.audience-left');
  assert.equal(read(rt, a.id).floorHolder, undefined);
  // Resume logically with the retained host, then explicit join restores a real viewer before time advances.
  control(rt, a.id, { kind: 'resume' });
  control(rt, a.id, { kind: 'join', actor: 'art-visitor1' });
  until(rt, () => !rt.isActive(a.id));
  assert.equal(a.status, 'completed', a.diagnostic?.message);
  clean(rt, a.id);
});
test('four declared visitors and host form safely around the same artwork with no shared body places', () => {
  const rt = artSharingRuntime(),
    pad = rt.world.entities['sketch-pad'],
    spot: Vec2 = [-0.8, -1.15],
    focus: Vec2 = [pad.pose.p[0], pad.pose.p[2]],
    yaw = heading(sub2(focus, spot)),
    centre = add2(spot, rot2([0.3, 0], yaw));
  rt.world.entities['art-visitor4'] = human('art-visitor4', -3, -5);
  const region: SocialRegion = {
    id: 'art-fourth',
    label: 'hypothetical fourth viewing place',
    kind: 'place',
    level: 0,
    provenance: { origin: 'test-fixture', confidence: 'hypothetical' },
    polygon: [
      [-0.4, -0.15],
      [0.4, -0.15],
      [0.4, 0.15],
      [-0.4, 0.15],
    ].map((p) => add2(centre, rot2(p as Vec2, yaw))),
    layout: { focus, spacing: 1, rowGap: 0.7, kind: 'stand' },
  };
  rt.world.regions[region.id] = region;
  const p = artSharingBinding();
  for (const visitor of p.visitors) visitor.join = true;
  p.visitors.push({ actor: 'art-visitor4', slot: 'art-fourth#r1c0' });
  const a = rt.submit('art_sharing', { ...p, duration: 8, turnSeconds: 1 });
  assert.equal(a.status, 'executing', a.diagnostic?.message);
  formed(rt, a.id);
  assert.equal(
    read(rt, a.id).participants.filter((m) => m.physicallyViewing).length,
    5,
  );
  until(rt, () => !rt.isActive(a.id));
  assert.equal(a.status, 'completed', a.diagnostic?.message);
  clean(rt, a.id);
});
