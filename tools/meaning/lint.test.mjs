import test from 'node:test';
import assert from 'node:assert/strict';
import { lintMeaning } from './lint.mjs';

test('standalone grounded purpose and multilingual public names need no rewriting', () => {
  const block = { title: 'Chiba 講堂', what: 'The campus lecture hall. Its presenter chair faces the audience bleachers.', aliases: ['Chiba', 'lecture hall'], parts: [{ id: 'podium', title: 'Presenter’s chair', what: 'The presentation seat beside the desk.' }] };
  assert.deepEqual(lintMeaning('e_deadbeef', block), []);
});
test('writing diagnostics locate fixable issues without altering supplied meaning', () => {
  const block = { title: 'region-stage', what: 'Use only the actions for e_deadbeef.', aliases: ['Main Hall', 'main-hall'], parts: [{ id: 'seat', title: 'Presenter chair', what: 'Presenter chair!' }] };
  const before = JSON.stringify(block), result = lintMeaning('hall', block);
  assert.deepEqual(result.map(d => [d.code, d.field]), [
    ['meaning.title.internal-ref', 'title'], ['meaning.purpose.internal-prose', 'what'],
    ['meaning.alias.duplicate', 'aliases[1]'], ['meaning.purpose.repeats-title', 'parts[0].what'],
  ]);
  assert.ok(result.every(d => d.ref === 'hall' && d.severity === 'warning' && d.suggestion.length > 20));
  assert.equal(JSON.stringify(block), before);
});
test('minor scenery missing a name is advisory, not fabricated meaning', () => {
  const block = { salience: 0 };
  assert.equal(lintMeaning('tile', block)[0].code, 'meaning.title.missing');
  assert.deepEqual(block, { salience: 0 });
});
