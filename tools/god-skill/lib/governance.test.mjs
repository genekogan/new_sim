import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amendmentLines, amendmentsText, decideBody, governanceText } from './governance.mjs';

test('decideBody: decline needs a reason, --text only with accept, ids and decisions are checked', () => {
  assert.deepEqual(decideBody('am_ab12', 'accept'), { decision: 'accept' });
  assert.deepEqual(decideBody('am_ab12', 'accept', { reason: ' ok ', text: '# New\n\ntext' }), { decision: 'accept', reason: 'ok', text: '# New\n\ntext' });
  assert.deepEqual(decideBody('am_ab12', 'decline', { reason: 'Too vague.' }), { decision: 'decline', reason: 'Too vague.' });
  assert.throws(() => decideBody('am_ab12', 'decline'), /needs --reason/);
  assert.throws(() => decideBody('am_ab12', 'decline', { reason: '  ' }), /needs --reason/);
  assert.throws(() => decideBody('am_ab12', 'decline', { reason: 'x', text: 'y' }), /only for accept/);
  assert.throws(() => decideBody('am_ab12', 'accept', { text: true }), /--text needs/);
  assert.throws(() => decideBody('nope', 'accept'), /usage: decide/);
  assert.throws(() => decideBody('am_ab12', 'yes'), /usage: decide/);
});

test('the texts show support, staleness, decisions and the switch (off by default)', () => {
  const open = { id: 'am_1', title: 'Quiet nights', text: 'Quiet after dark.', by: { name: 'Ada' }, status: 'open', support: 3, activeSupport: 2, supporters: ['Ada', 'Ben', 'Cy'], baseVersion: 1, stale: true, replacesWholeText: true };
  assert.deepEqual(amendmentLines(open), ['- am_1 “Quiet nights” by Ada · support 3 (2 active) · replaces the whole text · written for v1', '    Quiet after dark.', '    supporters: Ada, Ben, Cy']);
  const done = { id: 'am_2', title: 'Fences', text: 'No fences.', by: { name: 'Ben' }, status: 'declined', support: 1, activeSupport: 1, supporters: ['Ben'], decided: { by: 'god', reason: 'Already a rule.', version: null } };
  assert.deepEqual(amendmentLines(done), ['- am_2 “Fences” by Ben · declined by god', '    No fences.', '    reason: Already a rule.']);
  assert.match(amendmentsText({ version: 2, residentsDecide: false, residents: 3, needed: 2, amendments: [open, done] }), /^constitution v2 · 1 open amendment · residents decide: off/);
  assert.match(amendmentsText({ version: 0, residentsDecide: false, residents: 0, needed: 2, amendments: [] }), /no amendments yet/);
  const g = governanceText({ version: 2, residentsDecide: true, residents: 5, needed: 3, amendments: [open], prayers: { total: 4, answered: 1, waiting: 3 }, history: [{ version: 2, at: Date.UTC(2026, 9, 16, 3, 4), by: 'residents', note: 'the residents accepted amendment “Quiet nights” (Ada)' }] });
  assert.match(g, /residents decide: ON \(an amendment passes with 3 of 5 active residents\)/);
  assert.match(g, /prayers: 3 waiting, 1 answered \(4 in all\)/);
  assert.match(g, /v2 2026-10-16 03:04 by residents — the residents accepted/);
});
