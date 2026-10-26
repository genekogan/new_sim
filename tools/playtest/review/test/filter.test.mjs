import test from 'node:test';
import assert from 'node:assert/strict';
import { scrub, scrubText } from '../filter.mjs';
import { lastJson } from '../../lib/claude-p.mjs';

test('each forbidden pattern strips its sentence and flags leaked', () => {
  const bad = ['It lives in apps/server/src/edge/ledger.ts.', 'The handler in nav.mjs times out.', 'A fix would help.', 'The team should implement a retry.', 'The code drops it.', 'This is server-side.', 'resolveCapability picks the park.', 'Calling act() twice.', 'See /opt/eden3/current for logs.'];
  for (const b of bad) { const r = scrubText(`Pip stood still. ${b} The card lied.`); assert.equal(r.value, 'Pip stood still. The card lied.', b); assert.equal(r.hits.length, 1, b); }
});
test('clean product language passes untouched', () => {
  const s = 'Pip walked into the market and stopped for a minute. The card said she had arrived at the library.';
  assert.deepEqual(scrubText(s), { value: s, hits: [] });
});
test('scrub walks nested prose, exempts player wording and evidence pointers, flags leaked', () => {
  const r = scrub({ reason: 'Wrong. The code is broken.', issue: { title: 'Card lies', asked: 'fix my hair in the code', evidence: ['evidence/r3.json#samples[2]'], happened: 'Only a fix.' }, featureRequest: { personaWording: 'fix the fence' } });
  assert.equal(r.leaked, true);
  assert.equal(r.value.reason, 'Wrong.');
  assert.equal(r.value.issue.asked, 'fix my hair in the code');
  assert.deepEqual(r.value.issue.evidence, ['evidence/r3.json#samples[2]']);
  assert.equal(r.value.issue.happened, '[removed: diagnostic content]');
  assert.equal(r.value.featureRequest.personaWording, 'fix the fence');
  assert.deepEqual(r.hits.map((h) => h.field), ['reason', 'issue.happened']);
  assert.equal(scrub({ reason: 'Fine.' }).leaked, false);
});
test('lastJson: fenced, prose-wrapped, nested, last of several, none', () => {
  assert.deepEqual(lastJson('ok\n```json\n{"a":1}\n```\nbye'), { a: 1 });
  assert.deepEqual(lastJson('Answer: {"fidelity":"M","issue":{"title":"x","evidence":["a"]}} thanks'), { fidelity: 'M', issue: { title: 'x', evidence: ['a'] } });
  assert.deepEqual(lastJson('{"a":1} then {"b":2}'), { b: 2 });
  assert.deepEqual(lastJson('```json\n{"a":1}\n```\n```json\n{"b":{"c":3}}\n```'), { b: { c: 3 } });
  assert.equal(lastJson('no json here'), null);
  assert.equal(lastJson(null), null);
});
