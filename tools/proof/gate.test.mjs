import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APPROVED_LABEL, labelAddedBy, maintainerSignOff, needsSignOff } from './gate.mjs';
import { loadPolicy, tierFor } from './tier.mjs';

const M = 'maint';
const review = (login, state, commit_id = 'aaa111') => ({ user: { login }, state, commit_id });
const labeled = (login, name = APPROVED_LABEL) => ({ event: 'labeled', label: { name }, actor: { login } });
const unlabeled = (login, name = APPROVED_LABEL) => ({ event: 'unlabeled', label: { name }, actor: { login } });

test('only T3 and T4 need sign-off', () => {
  assert.deepEqual(['T0', 'T1', 'T2', 'T3', 'T4'].map(needsSignOff), [false, false, false, true, true]);
  // Tiers come from tier.mjs: a T3 path or a tier:T3 label puts a PR behind the gate; a T2 path does not.
  const policy = loadPolicy();
  assert.equal(needsSignOff(tierFor(['packages/kernel/src/a.ts'], policy).tier), true);
  assert.equal(needsSignOff(tierFor(['docs/a.md'], policy, ['tier:T3']).tier), true);
  assert.equal(needsSignOff(tierFor(['apps/web/src/a.ts'], policy, ['tier:T0']).tier), false);
});

test('the maintainer\'s latest decisive review decides', () => {
  assert.equal(maintainerSignOff({ reviews: [review(M, 'APPROVED')], maintainer: M }).ok, true);
  assert.equal(maintainerSignOff({ reviews: [review(M, 'APPROVED'), review(M, 'COMMENTED')], maintainer: M }).via, 'review');
  const changes = maintainerSignOff({ reviews: [review(M, 'APPROVED'), review(M, 'CHANGES_REQUESTED')], maintainer: M });
  assert.equal(changes.ok, false);
  assert.match(changes.detail, /requested changes/);
  assert.equal(maintainerSignOff({ reviews: [review(M, 'APPROVED'), review(M, 'DISMISSED')], maintainer: M }).ok, false);
  assert.equal(maintainerSignOff({ reviews: [review(M, 'CHANGES_REQUESTED'), review(M, 'APPROVED')], maintainer: M }).ok, true);
});

test('someone else\'s approval, or none, does not count', () => {
  const r = maintainerSignOff({ reviews: [review('agent', 'APPROVED')], maintainer: M });
  assert.equal(r.ok, false);
  assert.match(r.detail, /no approval from @maint/);
  assert.equal(maintainerSignOff({ maintainer: M }).ok, false);
});

test('an approval of an older commit counts, with a warning', () => {
  const r = maintainerSignOff({ reviews: [review(M, 'APPROVED', 'aaa111')], maintainer: M, head: 'bbb222' });
  assert.equal(r.ok, true);
  assert.match(r.warning, /head is now bbb222/);
  assert.equal(maintainerSignOff({ reviews: [review(M, 'APPROVED', 'bbb222')], maintainer: M, head: 'bbb222' }).warning, null);
});

test('approved:maintainer counts only when the maintainer added it last', () => {
  const labels = [APPROVED_LABEL];
  assert.equal(maintainerSignOff({ labels, events: [labeled(M)], maintainer: M }).via, 'label');
  const other = maintainerSignOff({ labels, events: [labeled('agent')], maintainer: M });
  assert.equal(other.ok, false);
  assert.match(other.detail, /added by @agent, not @maint/);
  // Removed and re-added by someone else: the latest add is what counts.
  assert.equal(maintainerSignOff({ labels, events: [labeled(M), unlabeled('agent'), labeled('agent')], maintainer: M }).ok, false);
  // Label events without the label on the PR now: no sign-off.
  assert.equal(maintainerSignOff({ labels: [], events: [labeled(M)], maintainer: M }).ok, false);
  assert.equal(labelAddedBy([labeled('a'), labeled('b', 'other'), labeled('c')], APPROVED_LABEL), 'c');
  assert.equal(labelAddedBy([], APPROVED_LABEL), null);
});
