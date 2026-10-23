// GEST-LIVE 2026-10-23: "take the book" while another Soul offers a book must reach the server's resolver (which accepts the
// pending give) instead of being rewritten client-side into "pick up a book" (a pick-up from a shelf).
import test from 'node:test';import assert from 'node:assert/strict';
import {rewrite} from './eden-agent.mjs';
test('take/grab an item are left for the server resolver; pick up still rewrites', () => {
  assert.equal(rewrite('take the book'), null);
  assert.equal(rewrite('grab the flower'), null);
  assert.equal(rewrite('pick up the book')?.words, 'pick up a book');
  assert.equal(rewrite('fetch a cup')?.words, 'pick up a cup');
});
