import test from 'node:test';
import assert from 'node:assert/strict';
import {
  galleryTourRuntime,
  galleryTourBinding,
} from '../scenarios/gallery-tour.ts';
import { readGalleryTour } from '../activities/gallery-tour.ts';

test('short gallery late Join admits clear host direction, retains discussion and completes after explicit Resume', () => {
  const rt = galleryTourRuntime(),
    p = galleryTourBinding();
  p.stops = p.stops.slice(0, 2);
  const tour = rt.submit('gallery_tour', p);
  assert.equal(tour.status, 'executing');
  const read = () => {
    const s = readGalleryTour(rt, tour.id);
    assert.ok(s);
    return s;
  };
  const until = (done: () => boolean) => {
    for (let i = 0; i < 3000 && !done(); i++) {
      rt.step();
      assert.deepEqual(rt.violations, []);
      for (const stop of p.stops)
        assert.equal(
          rt.world.entities[stop.sharing.pad].support?.kind,
          'resting-on',
        );
    }
    assert.ok(done(), JSON.stringify(read()));
  };
  const control = (intent: unknown) => {
    const r = rt.submit('gallery_tour_control', { tour: tour.id, intent });
    assert.notEqual(r.status, 'failed', r.diagnostic?.message);
  };
  until(() => read().current?.mode === 'sharing');
  control({ kind: 'leave', actor: 'art-visitor1', to: [-7.5, -3] });
  until(() => read().index === 1 && read().mode === 'waiting');
  assert.equal(read().diagnostic?.code, 'gallery_tour.insufficient-audience');
  control({ kind: 'join', actor: 'art-visitor3' });
  until(() => read().index === 1 && read().current?.mode === 'sharing');
  for (let i = 0; i < 6; i++) rt.step();
  const before = read(),
    walker = rt.registry.get('walk_to')!;
  // The original endpoint intersects the actual wall and must remain a hard refusal.
  const bad = walker.plan(rt, { actor: 'sketcher', x: -10, z: -8 });
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    assert.equal(bad.diagnostic.code, 'route.goal-blocked');
    assert.match(bad.diagnostic.message, /left-wall/);
  }
  const params = { actor: 'sketcher', x: -8, z: -8 };
  assert.equal(walker.plan(rt, params).ok, true);
  const direction = rt.submit('walk_to', params);
  assert.notEqual(direction.status, 'failed', direction.diagnostic?.message);
  until(() => read().mode === 'paused' && !rt.isActive(direction.id));
  assert.equal(rt.records.get(direction.id)?.status, 'completed');
  assert.deepEqual(rt.world.entities.sketcher.pose.p, [-8, 0, -8]);
  assert.equal(read().current!.elapsed, before.current!.elapsed);
  assert.deepEqual(read().current!.effects, before.current!.effects);
  assert.deepEqual(read().history, before.history);
  assert.equal(
    read().members.find((m) => m.actor === 'art-visitor1')!.active,
    false,
  );
  control({ kind: 'resume' });
  until(() => !rt.isActive(tour.id));
  assert.equal(read().finished, true);
  assert.equal(read().history.length, 2);
  assert.deepEqual(
    read().history.map((s) => s.pad),
    p.stops.map((s) => s.sharing.pad),
  );
  assert.deepEqual(rt.violations, []);
  for (const r of rt.records.values()) assert.ok(!rt.isActive(r.id));
  for (const e of Object.values(rt.world.entities))
    if (e.human) {
      assert.ok(e.human.task == null);
      assert.deepEqual(rt.holder(`actor:${e.id}`), []);
      assert.deepEqual(rt.holder(`gallery-tour:${e.id}`), []);
      assert.deepEqual(rt.holder(`art-sharing:${e.id}`), []);
    }
  for (const stop of read().history) {
    assert.deepEqual(rt.holder(`entity:${stop.pad}`), []);
    for (const person of stop.sharing.participants)
      assert.deepEqual(rt.holder(`slot:${person.slot}`), []);
  }
});
