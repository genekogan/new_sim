import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMidRequest, fakeJev, interpretMid, sample, buildTranslateRequest, interpretTranslate, sanitizePlan, type MidContext } from './index.ts';

const ctx: MidContext = {
  world: { time: 'late afternoon', weather: 'clear', happening: 'a gathering at the campfire (3 souls)' },
  soul: { name: 'Verdelis', about: 'a shy gardener', intent: 'attend the campfire', energy: 'tired', mood: 'curious', doing: 'standing around', recent: [] },
  nearby: [{ who: 'the campfire', what: 'campfire', distance: 'near', doing: '3 souls here' }],
  nudge: null, running: false, trigger: 'test',
  options: [
    { id: 'attend:campfire', template: 'attend', label: 'Walk to the campfire', steps: [{ verb: 'walk_to', params: {} }], durationHint: 'minutes' },
    { id: 'wander', template: 'wander', label: 'Drift', steps: [{ verb: 'ambient_wander', params: {} }], durationHint: 'minute' },
  ],
};
test('mid request has one criterion per option and no continue when idle', () => {
  const r = buildMidRequest(ctx);
  assert.deepEqual(Object.keys((r.questions.next as any).criteria), ['attend:campfire', 'wander']);
  assert.ok(!JSON.stringify(r.state).match(/\d+\.\d+/), 'no raw numbers in state');
});
test('interpretMid only returns valid option ids and is seed-deterministic', () => {
  const res = fakeJev(buildMidRequest(ctx)).response;
  const a = interpretMid(res, ctx, 's:1'), b = interpretMid(res, ctx, 's:1');
  assert.equal(a.option, b.option);
  assert.ok(['attend:campfire', 'wander'].includes(a.option));
});
test('sample respects floor and distribution', () => {
  assert.equal(sample({ a: 1, b: 0 }, 0.0), 'a');
  assert.equal(sample({ a: 1, b: 0 }, 0.999), 'b');
});
test('translate: unsure escapes', () => {
  const req = buildTranslateRequest('asdf', 'V', [{ id: 'kiosk', name: 'the kiosk', kind: 'kiosk', distance: 'near' }]);
  const out = interpretTranslate({ model: 'x', usage: { input_tokens: 0, output_tokens: 0 }, answers: { goal: { type: 'choice', choice: 'unsure', confidence: 0.9, probabilities: {} }, target: { type: 'choice', choice: 'none', confidence: 0.9, probabilities: {} }, actionable: { type: 'noul', noul: 0.1 } } }, 'asdf');
  assert.equal(out.ok, false);
  assert.ok(req.questions.goal);
});
test('narrator plan sanitizer drops invented targets', () => {
  const d = { region: 'center', label: 'c', time: '', weather: '', places: [{ id: 'campfire', name: 'x', state: '' }], souls: [{ name: 'A', about: '', intent: '', mood: '', energy: '', doing: '', wants_company: '' }], recent: [], neighbours: [], previous_summary: null };
  const p = sanitizePlan({ summary: 's', beats: [{ at_min: 1, kind: 'soul', directive: 'rest', targets: ['Ghost'], flavor: 'f' }, { at_min: 2, kind: 'scene', directive: 'gathering', targets: ['campfire'], flavor: '"q"' }] }, d);
  assert.equal(p.beats.length, 1);
  assert.equal(p.beats[0].flavor, 'q');
});
