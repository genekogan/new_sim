import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMidRequest, fakeJev, interpretMid, pick, buildTranslateRequest, interpretTranslate, sanitizePlan, type MidContext } from './index.ts';

const ctx: MidContext = {
  world: { time: 'late afternoon', weather: 'clear', happening: 'a gathering at the campfire (3 souls)' },
  soul: { name: 'Verdelis', about: 'a shy gardener', intent: 'attend the campfire', ownerNote: null, hasIntent: true, intentIsNew: false, energy: 'tired', where: 'the center', doing: 'standing around', recent: [] },
  nearby: [{ who: 'the campfire', what: 'campfire', distance: 'near', doing: '3 souls here' }],
  nudge: null, running: false, trigger: 'test',
  options: [
    { id: 'attend:campfire', template: 'attend', label: 'Walk to the campfire', steps: [{ verb: 'walk_to', params: {} }], durationHint: 'minutes' },
    { id: 'wander', template: 'wander', label: 'Drift', steps: [{ verb: 'ambient_wander', params: {} }], durationHint: 'minute' },
  ],
};
test('mid request: readable option names, conditions on every option, no status-quo option when idle', () => {
  const { request, keys } = buildMidRequest(ctx);
  const crit = (request.questions.next as any).criteria;
  assert.deepEqual(Object.keys(crit), ['walk_to_the_campfire', 'drift']);
  assert.deepEqual([...keys.values()], ['attend:campfire', 'wander']);
  for (const v of Object.values(crit) as any[]) { assert.ok(v.what && v.good_when && v.not_for); }
  assert.equal(request.questions.keep_going, undefined);
  assert.ok(!JSON.stringify(request.state).match(/\d+\.\d+/), 'no raw numbers in state');
  assert.equal(request.model, 'jev-1.13.0');
});
test('mid request asks keep_going only while running and not on a new intent', () => {
  assert.ok(buildMidRequest({ ...ctx, running: true }).request.questions.keep_going);
  assert.equal(buildMidRequest({ ...ctx, running: true, soul: { ...ctx.soul, intentIsNew: true } }).request.questions.keep_going, undefined);
});
test('interpretMid maps names back to option ids and is seed-deterministic', () => {
  const { request, keys } = buildMidRequest(ctx);
  const res = fakeJev(request).response;
  const a = interpretMid(res, ctx, keys, 's:1'), b = interpretMid(res, ctx, keys, 's:1');
  assert.equal(a.option, b.option);
  assert.ok(['attend:campfire', 'wander'].includes(a.option));
});
test('pick: argmax when clear, never picks near-zero options', () => {
  assert.equal(pick({ a: 0.7, b: 0.3 }, 0.99, { argmaxAt: 0.6 }).key, 'a');
  for (let u = 0; u < 1; u += 0.01) assert.notEqual(pick({ a: 0.55, b: 0.43, c: 0.02 }, u, { argmaxAt: 0.8 }).key, 'c');
  assert.equal(pick({ a: 0.55, b: 0.43, c: 0.02 }, 0.9, { argmaxAt: 0.8 }).key, 'b');
});
test('translate: unsure escapes', () => {
  const { request, targetKeys } = buildTranslateRequest('asdf', 'V', [{ id: 'kiosk', name: 'the kiosk', kind: 'kiosk', distance: 'near' }]);
  const out = interpretTranslate({ model: 'x', usage: { input_tokens: 0, output_tokens: 0 }, answers: { goal: { type: 'choice', choice: 'unsure', confidence: 0.9, probabilities: {} }, target: { type: 'choice', choice: 'none_of_these', confidence: 0.9, probabilities: {} }, actionable: { type: 'noul', noul: 0.1 } } }, 'asdf', targetKeys);
  assert.equal(out.ok, false);
  assert.ok(request.questions.goal);
  assert.equal(targetKeys.get('the_kiosk'), 'kiosk');
});
test('narrator plan sanitizer drops invented targets', () => {
  const d = { region: 'center', label: 'c', time: '', weather: '', places: [{ id: 'campfire', name: 'x', state: '' }], souls: [{ name: 'A', about: '', intent: '', mood: '', energy: '', doing: '', wants_company: '' }], recent: [], neighbours: [], previous_summary: null };
  const p = sanitizePlan({ summary: 's', beats: [{ at_min: 1, kind: 'soul', directive: 'rest', targets: ['Ghost'], flavor: 'f' }, { at_min: 2, kind: 'scene', directive: 'gathering', targets: ['campfire'], flavor: '"q"' }] }, d);
  assert.equal(p.beats.length, 1);
  assert.equal(p.beats[0].flavor, 'q');
});
