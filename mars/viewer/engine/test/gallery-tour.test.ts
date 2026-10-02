import test from 'node:test';
import assert from 'node:assert/strict';
import {
  galleryTourRuntime,
  galleryTourBinding,
} from '../scenarios/gallery-tour.ts';
import { readGalleryTour } from '../activities/gallery-tour.ts';
import { drawingIssue } from '../objects/drawing.ts';
import { human } from '../world/factory.ts';
import { slotById } from '../social/slots.ts';
import type { Runtime } from '../runtime/runtime.ts';
const read = (rt: Runtime, id: string) => {
  const s = readGalleryTour(rt, id);
  assert.ok(s);
  return s;
};
function until(rt: Runtime, done: () => boolean, max = 6000) {
  for (let n = 0; n < max && !done(); n++) {
    rt.step();
    assert.deepEqual(rt.violations, []);
    for (const e of Object.values(rt.world.entities))
      if (e.def === 'drawing-pad') {
        const d = drawingIssue(rt, e.id);
        assert.ok(!d || d.code === 'drawing.unavailable', d?.message);
        assert.equal(e.support?.kind, 'resting-on');
      }
  }
  assert.ok(
    done(),
    JSON.stringify(
      [...rt.records.values()]
        .filter((r) => rt.isActive(r.id))
        .map((r) => [r.verb, r.phase, r.diagnostic]),
    ),
  );
}
function control(rt: Runtime, id: string, intent: unknown) {
  const c = rt.submit('gallery_tour_control', { tour: id, intent });
  assert.notEqual(c.status, 'failed', c.diagnostic?.message);
  return c;
}
function start() {
  const rt = galleryTourRuntime(),
    p = galleryTourBinding(),
    a = rt.submit('gallery_tour', p);
  assert.equal(a.status, 'executing');
  return { rt, p, a };
}
function clean(rt: Runtime, id: string) {
  assert.deepEqual(rt.violations, []);
  for (const c of read(rt, id).ownedActions) assert.ok(!rt.isActive(c));
  for (const r of rt.records.values()) assert.ok(!rt.isActive(r.id));
  for (const e of Object.values(rt.world.entities))
    if (e.human) {
      assert.ok(e.human.task == null);
      assert.deepEqual(rt.holder(`actor:${e.id}`), []);
      assert.deepEqual(rt.holder(`gallery-tour:${e.id}`), []);
      assert.deepEqual(rt.holder(`art-sharing:${e.id}`), []);
    }
  for (const s of read(rt, id).history) {
    assert.deepEqual(rt.holder(`entity:${s.pad}`), []);
    for (const m of s.sharing.participants)
      assert.deepEqual(rt.holder(`slot:${m.slot}`), []);
  }
}
function formed(rt: Runtime, id: string, index = 0) {
  until(
    rt,
    () =>
      read(rt, id).index === index && read(rt, id).current?.mode === 'sharing',
  );
}
function artifacts(rt: Runtime) {
  return Object.values(rt.world.entities)
    .filter((e) => e.def === 'drawing-pad')
    .map((e) => ({
      id: e.id,
      pose: e.pose,
      support: e.support,
      ticks: e.equipment!.config.drawTicks,
    }));
}
test('three supported real artifacts: arrivals, actual attention/turns, ordinary departures, stable identities and deterministic replay', () => {
  const run = () => {
    const { rt, p, a } = start(),
      before = structuredClone(artifacts(rt));
    formed(rt, a.id);
    const s = read(rt, a.id);
    assert.equal(s.current!.attentionTarget!.entity, p.stops[0].sharing.pad);
    for (const m of s.current!.participants.filter((m) => m.active)) {
      assert.ok(m.physicallyViewing);
      assert.equal(
        rt.world.entities[m.actor].human!.activity,
        m.speaking ? 'talk' : 'listen',
      );
      assert.equal(rt.world.entities[m.actor].pose.p[1], 0);
    }
    until(rt, () => !rt.isActive(a.id));
    const end = read(rt, a.id);
    assert.equal(end.finished, true);
    assert.equal(end.history.length, 3);
    assert.deepEqual(
      end.history.map((h) => h.pad),
      p.stops.map((s) => s.sharing.pad),
    );
    assert.deepEqual(artifacts(rt), before);
    for (let i = 1; i < 3; i++) {
      const previous = end.history[i - 1].sharing.session,
        next = end.history[i].sharing.session;
      const walks = [...rt.records.values()].filter(
        (r) =>
          r.verb === 'walk_to' &&
          r.parent === a.id &&
          r.requestedTick >= rt.records.get(previous)!.endedTick! &&
          r.requestedTick < rt.records.get(next)!.requestedTick,
      );
      assert.equal(walks.length, 3);
      assert.ok(
        walks.every(
          (r) =>
            r.status === 'completed' &&
            r.endedTick! <= rt.records.get(next)!.requestedTick,
        ),
      );
    }
    clean(rt, a.id);
    return {
      history: end.history,
      poses: Object.values(rt.world.entities)
        .filter((e) => e.human)
        .map((e) => e.pose),
    };
  };
  assert.deepEqual(run(), run());
});
test('physical question and answer are retained per stop', () => {
  const { rt, a } = start();
  formed(rt, a.id);
  control(rt, a.id, { kind: 'ask', actor: 'art-visitor1' });
  until(rt, () =>
    read(rt, a.id).current!.effects.some((e) => e.kind === 'answer'),
  );
  until(rt, () => !rt.isActive(a.id));
  const h = read(rt, a.id).history[0];
  const q = h.sharing.effects.find((e) => e.kind === 'question')!,
    answer = h.sharing.effects.find((e) => e.kind === 'answer')!;
  assert.equal(q.actor, 'art-visitor1');
  assert.equal(answer.replyTo, q.index);
  assert.equal(q.pad, h.pad);
  clean(rt, a.id);
});
test('Pause preserves exact circle clock/history; Resume same circle; End differs from completed tour and releases everything', () => {
  const { rt, a } = start();
  formed(rt, a.id);
  for (let i = 0; i < 12; i++) rt.step();
  const before = read(rt, a.id);
  control(rt, a.id, { kind: 'pause' });
  until(rt, () => read(rt, a.id).mode === 'paused');
  for (let i = 0; i < 40; i++) rt.step();
  const paused = read(rt, a.id);
  assert.equal(paused.current!.elapsed, before.current!.elapsed);
  assert.deepEqual(paused.current!.effects, before.current!.effects);
  control(rt, a.id, { kind: 'resume' });
  formed(rt, a.id);
  assert.equal(read(rt, a.id).current!.session, before.current!.session);
  control(rt, a.id, { kind: 'end' });
  until(rt, () => !rt.isActive(a.id));
  assert.equal(read(rt, a.id).finished, false);
  assert.equal(a.status, 'cancelled');
  clean(rt, a.id);
});
test('Leave persists at later stops, named insufficient audience waits without record spam, declared optional Join restores tour', () => {
  const { rt, a } = start();
  formed(rt, a.id);
  control(rt, a.id, { kind: 'leave', actor: 'art-visitor1', to: [-8, -5] });
  until(
    rt,
    () =>
      read(rt, a.id).index === 1 &&
      read(rt, a.id).diagnostic?.code === 'gallery_tour.insufficient-audience',
  );
  const count = rt.records.size;
  for (let i = 0; i < 100; i++) rt.step();
  assert.equal(rt.records.size, count);
  assert.equal(
    read(rt, a.id).members.find((m) => m.actor === 'art-visitor1')!.state,
    'left',
  );
  control(rt, a.id, { kind: 'join', actor: 'art-visitor3' });
  until(rt, () => !rt.isActive(a.id));
  const end = read(rt, a.id);
  assert.equal(end.finished, true);
  assert.ok(
    end.history
      .slice(1)
      .every(
        (h) =>
          !h.sharing.participants.find((m) => m.actor === 'art-visitor1')!
            .active &&
          h.sharing.participants.find((m) => m.actor === 'art-visitor3')!
            .active,
      ),
  );
  clean(rt, a.id);
});
test('occupied viewing place waits with named cause and bounded retry without preemption or failed children', () => {
  const { rt, a, p } = start();
  const slot = slotById(rt, p.stops[0].sharing.visitors[0].slot);
  assert.ok(!('code' in slot));
  rt.world.entities.blocker = human('blocker', slot.p[0], slot.p[1]);
  until(rt, () => read(rt, a.id).mode === 'waiting');
  assert.equal(
    read(rt, a.id).diagnostic!.details!.cause &&
      (read(rt, a.id).diagnostic!.details!.cause as { code: string }).code,
    'art_sharing.place-occupied',
  );
  const count = rt.records.size;
  for (let i = 0; i < 440; i++) rt.step();
  assert.equal(rt.records.size, count);
  assert.equal(read(rt, a.id).retry.automatic, false);
  const leave = rt.submit('walk_to', { actor: 'blocker', x: -12, z: 8 });
  until(rt, () => !rt.isActive(leave.id));
  control(rt, a.id, { kind: 'resume' });
  until(rt, () => !rt.isActive(a.id));
  clean(rt, a.id);
});
test('unavailable artifact waits instead of skipping; explicit End releases tour without creating circles', () => {
  const { rt, a, p } = start();
  rt.world.entities[p.stops[0].sharing.pad].equipment!.config.available = false;
  until(rt, () => read(rt, a.id).mode === 'waiting');
  assert.equal(
    read(rt, a.id).diagnostic!.code,
    'gallery_tour.stop-unavailable',
  );
  assert.equal(rt.records.size, 1);
  control(rt, a.id, { kind: 'end' });
  until(rt, () => !rt.isActive(a.id));
  assert.equal(read(rt, a.id).history.length, 0);
  clean(rt, a.id);
});
test('directed host safely waits for explicit Resume with exact retained circle; directed visitor is withdrawn at next stop', () => {
  const { rt, a } = start();
  formed(rt, a.id);
  const before = read(rt, a.id).current!.elapsed;
  const direction = rt.submit('walk_to', { actor: 'sketcher', x: -5, z: -5 });
  until(
    rt,
    () => read(rt, a.id).mode === 'paused' && !rt.isActive(direction.id),
  );
  assert.equal(read(rt, a.id).current!.elapsed, before);
  control(rt, a.id, { kind: 'resume' });
  formed(rt, a.id);
  const visitor = rt.submit('walk_to', { actor: 'art-visitor2', x: -2, z: -5 });
  until(rt, () => !rt.isActive(visitor.id));
  until(
    rt,
    () => read(rt, a.id).index === 1 && read(rt, a.id).mode === 'waiting',
  );
  assert.equal(
    read(rt, a.id).members.find((m) => m.actor === 'art-visitor2')!.state,
    'directed-away',
  );
  control(rt, a.id, { kind: 'join', actor: 'art-visitor3' });
  until(rt, () => !rt.isActive(a.id));
  clean(rt, a.id);
});
test('invalid duplicate artwork and undeclared Join refuse explicitly without movement', () => {
  const rt = galleryTourRuntime(),
    p = galleryTourBinding(),
    poses = Object.values(rt.world.entities)
      .filter((e) => e.human)
      .map((e) => structuredClone(e.pose));
  p.stops[1].sharing.pad = p.stops[0].sharing.pad;
  const a = rt.submit('gallery_tour', p);
  assert.equal(a.status, 'failed');
  assert.equal(a.diagnostic!.code, 'gallery_tour.definition');
  assert.deepEqual(
    Object.values(rt.world.entities)
      .filter((e) => e.human)
      .map((e) => e.pose),
    poses,
  );
  const s = rt.submit('gallery_tour', galleryTourBinding());
  const c = rt.submit('gallery_tour_control', {
    tour: s.id,
    intent: { kind: 'join', actor: 'stranger' },
  });
  assert.equal(c.status, 'failed');
  assert.equal(c.diagnostic!.code, 'gallery_tour.participant');
  rt.cancel(s.id);
  until(rt, () => !rt.isActive(s.id));
});
test('missing artwork has named bounded wait and no child record spam', () => {
  const { rt, a, p } = start();
  delete rt.world.entities[p.stops[0].sharing.pad];
  until(rt, () => read(rt, a.id).mode === 'waiting');
  const d = read(rt, a.id).diagnostic!;
  assert.equal(d.code, 'gallery_tour.stop-unavailable');
  assert.equal(
    (d.details!.cause as { code: string }).code,
    'art_sharing.artifact',
  );
  assert.ok(d.subjects!.includes(p.stops[0].sharing.pad));
  for (let n = 0; n < 440; n++) rt.step();
  assert.equal(rt.records.size, 1);
  assert.equal(read(rt, a.id).retry.automatic, false);
  control(rt, a.id, { kind: 'end' });
  until(rt, () => !rt.isActive(a.id));
  clean(rt, a.id);
});
test('Pause at completed-stop boundary and during departure preserves history without repeating a stop', () => {
  const { rt, a } = start();
  formed(rt, a.id);
  until(
    rt,
    () =>
      !!read(rt, a.id).current?.finished &&
      !rt.isActive(read(rt, a.id).current!.session),
  );
  control(rt, a.id, { kind: 'pause' });
  until(rt, () => read(rt, a.id).mode === 'paused');
  assert.equal(read(rt, a.id).history.length, 1);
  control(rt, a.id, { kind: 'resume' });
  until(
    rt,
    () =>
      read(rt, a.id).mode === 'clearing' &&
      Object.values(read(rt, a.id).departures).some((id) => rt.isActive(id)),
  );
  control(rt, a.id, { kind: 'pause' });
  until(rt, () => read(rt, a.id).mode === 'paused');
  assert.equal(read(rt, a.id).history.length, 1);
  control(rt, a.id, { kind: 'resume' });
  until(rt, () => !rt.isActive(a.id));
  assert.equal(read(rt, a.id).history.length, 3);
  clean(rt, a.id);
});
test('declared late Join is physically admitted and End cancels its ordinary Leave without orphan claims', () => {
  const { rt, a } = start();
  formed(rt, a.id);
  control(rt, a.id, { kind: 'join', actor: 'art-visitor3' });
  until(
    rt,
    () =>
      read(rt, a.id).current!.participants.find(
        (m) => m.actor === 'art-visitor3',
      )!.physicallyViewing,
  );
  control(rt, a.id, { kind: 'leave', actor: 'art-visitor3', to: [8, 8] });
  control(rt, a.id, { kind: 'end' });
  until(rt, () => !rt.isActive(a.id));
  clean(rt, a.id);
});
test('visitor directed during Pause is not automatically reclaimed when circle resumes', () => {
  const { rt, a } = start();
  formed(rt, a.id);
  control(rt, a.id, { kind: 'pause' });
  until(rt, () => read(rt, a.id).mode === 'paused');
  const direction = rt.submit('walk_to', {
    actor: 'art-visitor1',
    x: -8,
    z: -5,
  });
  until(rt, () => !rt.isActive(direction.id));
  const pose = structuredClone(rt.world.entities['art-visitor1'].pose);
  control(rt, a.id, { kind: 'resume' });
  formed(rt, a.id);
  assert.equal(
    read(rt, a.id).current!.participants.find(
      (m) => m.actor === 'art-visitor1',
    )!.active,
    false,
  );
  assert.deepEqual(rt.world.entities['art-visitor1'].pose, pose);
  until(
    rt,
    () => read(rt, a.id).index === 1 && read(rt, a.id).mode === 'waiting',
  );
  assert.equal(
    read(rt, a.id).members.find((m) => m.actor === 'art-visitor1')!.state,
    'directed-away',
  );
  control(rt, a.id, { kind: 'join', actor: 'art-visitor3' });
  until(rt, () => !rt.isActive(a.id));
  clean(rt, a.id);
});
test('two-stop bounded definition also completes and detached readout cannot mutate retained history', () => {
  const rt = galleryTourRuntime(),
    p = galleryTourBinding();
  p.stops = p.stops.slice(0, 2);
  const a = rt.submit('gallery_tour', p);
  until(rt, () => !rt.isActive(a.id));
  const first = read(rt, a.id);
  assert.equal(first.history.length, 2);
  first.history[0].pad = 'forged';
  first.members[0].active = false;
  assert.equal(read(rt, a.id).history[0].pad, p.stops[0].sharing.pad);
  assert.equal(read(rt, a.id).members[0].active, true);
  clean(rt, a.id);
});
