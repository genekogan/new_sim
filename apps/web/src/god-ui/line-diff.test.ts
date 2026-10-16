// node --test apps/web/src/god-ui/line-diff.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { changedOnly, lineDiff } from './line-diff.ts';

test('a returning visitor sees the lines that changed, with a line of context', () => {
  const before = '# Test Hill\n\nBe kind.\nBuild slowly.\n\nQuiet after dark.';
  const after = '# Test Hill\n\nBe kind.\nBuild slowly.\n\nQuiet after ten.\n\n## Amendment 1: Trees\n\nPlant one tree.';
  const d = lineDiff(before, after);
  assert.deepEqual(d.filter((x) => x.kind === 'removed').map((x) => x.text), ['Quiet after dark.']);
  assert.deepEqual(d.filter((x) => x.kind === 'added').map((x) => x.text), ['Quiet after ten.', '', '## Amendment 1: Trees', '', 'Plant one tree.']);
  const c = changedOnly(d);
  assert.equal(c[0].kind, 'gap', 'unchanged lines far from a change collapse');
  assert.ok(c.some((x) => x.kind === 'same' && 'text' in x && x.text === 'Build slowly.'), 'one line of context');
  assert.ok(!c.some((x) => x.kind === 'same' && 'text' in x && x.text === '# Test Hill'));
  assert.deepEqual(lineDiff('a', 'a'), [{ kind: 'same', text: 'a' }]);
  assert.deepEqual(changedOnly(lineDiff('a\nb', 'a\nb')), []);
});
