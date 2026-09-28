// Camera over recorded takes: the take sampler agrees with sampleTake, and a
// shot list becomes one uniform, cut-separated track that never touches the take.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashOf } from '../core/hash.ts';
import { bindTemplate } from '../sequence/bind.ts';
import { rehearse } from '../rehearsal/rehearse.ts';
import { sampleTake, takeDuration } from '../take/replay.ts';
import { provingGround } from '../scenes/proving-ground.ts';
import { takeSampler } from '../camera/take-sampler.ts';
import { planShotList, type ShotWindow } from '../camera/shotlist.ts';
import { sampleTrack, subjectReader, toCameraTrack } from '../camera/track.ts';
import { shotSubjects, subjectPoints } from '../camera/shots.ts';
import { config, minuteBindings, minuteTemplate, pgHistory, registry } from './sequence-fixtures.ts';

function minuteTake() {
  const h = pgHistory();
  const plan = bindTemplate(minuteTemplate, minuteBindings, { history: h, baseline: 'ws', registry: registry() });
  return rehearse(h, 'ws', plan, config()).take;
}

const wrapDiff = (a: number, b: number) => Math.abs(((a - b + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);

test('takeSampler: same entities and poses as sampleTake at any time; components get box points', () => {
  const take = minuteTake();
  const s = takeSampler(take);
  const dur = takeDuration(take);
  for (let k = 0; k <= 40; k++) {
    const t = (dur * k) / 40 + (k % 3) * 0.013;
    const a = sampleTake(take, t).entities, b = s(t);
    assert.deepEqual(Object.keys(b).sort(), Object.keys(a).sort(), `t=${t}`);
    for (const id of Object.keys(a)) {
      for (let j = 0; j < 3; j++) assert.ok(Math.abs(a[id].p[j] - b[id].p[j]) < 1e-9, `${id} p${j} at t=${t}`);
      assert.ok(wrapDiff(a[id].yaw, b[id].yaw) < 1e-9, `${id} yaw at t=${t}`);
    }
  }
  const panel = s(1).panel;
  assert.equal(panel.points?.length, 9, 'component subject = centre + 8 box corners');
  assert.ok(s(1).n1.points === undefined, 'humans use the default standing points');
  assert.equal(panel.occluders?.length, 1, 'a panel occludes with its slab');
  assert.equal(s(1).n1.occluders, undefined, 'people occlude as capsules, not boxes');
});

test('planShotList: contiguous windows → one uniform track, a cut at every shot boundary, take untouched', () => {
  const take = minuteTake();
  const before = hashOf(take);
  const dur = Math.floor(takeDuration(take) * 10) / 10;
  const mid = Math.round(dur * 5) / 10;
  const shots: ShotWindow[] = [
    { label: 'follow n1', t0: 0, t1: mid, spec: { kind: 'follow', subject: 'n1', offset: [-5, 2.5, 0], lookHeight: 1.2, damping: 0.6 } },
    { label: 'group', t0: mid, t1: dur, spec: { kind: 'frameGroup', subjects: ['n1', 's1'], azimuth: -Math.PI / 2, elevation: 0.5 } },
  ];
  const plan = planShotList(shots, takeSampler(take), provingGround(), { hz: 10 });
  assert.equal(plan.samples.length, Math.round(dur * 10) + 1);
  plan.samples.forEach((p, i) => assert.ok(Math.abs(p.t - i / 10) < 1e-6, `sample ${i} at ${p.t}`));
  const boundary = Math.round(mid * 10);
  assert.equal(plan.samples[boundary].cut, true, 'second shot starts with a cut');
  assert.ok(plan.report.cuts.some((c) => c.reason === 'shot list: group' && Math.abs(c.t - mid) < 1e-6), 'boundary cut reported');
  assert.deepEqual(plan.report.cuts.map((c) => c.t), [...plan.report.cuts.map((c) => c.t)].sort((a, b) => a - b), 'cuts in time order');
  assert.equal(plan.shots.length, 2);
  assert.equal(plan.report.invalidSamples, 0);
  const track = toCameraTrack('cam', take.id, plan);
  const held = sampleTrack(track.data as never, mid - 0.05);
  assert.deepEqual(held.position, plan.samples[boundary - 1].position, 'the outgoing shot holds up to the cut (no blend across it)');
  assert.equal(hashOf(take), before, 'planning never mutates the take');
  // the scored subjects are stored per sample (ids by set index, points only when they change)
  const read = subjectReader(plan.subjects), sampler = takeSampler(take);
  assert.equal(plan.subjects.set.length, plan.samples.length);
  assert.ok(plan.subjects.points.length < plan.samples.length * 2, 'points written only when they change');
  for (let i = 0; i < plan.samples.length; i += 7) {
    const shot = shots.find((w) => plan.samples[i].t < w.t1 - 1e-9) ?? shots[1];
    const r = read(i), want = shotSubjects(shot.spec);
    assert.deepEqual(r.ids, want, `ids at sample ${i}`);
    for (const id of want) {
      const ref = subjectPoints(sampler(plan.samples[i].t)[id]);
      assert.equal(r.points[id].length, ref.length);
      r.points[id].forEach((p, k) => p.forEach((v, j) => assert.ok(Math.abs(v - ref[k][j]) <= 0.005 + 1e-9, `${id} point ${k} at sample ${i}`)));
    }
  }
  assert.throws(() => planShotList([shots[0], { ...shots[1], t0: mid + 1 }], takeSampler(take), provingGround(), { hz: 10 }), /does not start where/);
});
