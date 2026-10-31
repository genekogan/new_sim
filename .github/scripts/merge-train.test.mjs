import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blocker, maintainerApproved, next, parseChecks, summarizeChecks, wait, DEFAULT_CHECKS } from './merge-train.mjs';

const M = 'owner';

test('maintainer approval: latest decisive review, or the label added by the maintainer', () => {
  const r = (login, state) => ({ user: { login }, state });
  assert.equal(maintainerApproved({ reviews: [r(M, 'APPROVED')], maintainer: M }), true);
  assert.equal(maintainerApproved({ reviews: [r(M, 'APPROVED'), r(M, 'COMMENTED')], maintainer: M }), true);
  assert.equal(maintainerApproved({ reviews: [r(M, 'APPROVED'), r(M, 'CHANGES_REQUESTED')], maintainer: M }), false);
  assert.equal(maintainerApproved({ reviews: [r('someone', 'APPROVED')], maintainer: M }), false);
  const ev = actor => [{ event: 'labeled', label: { name: 'approved:maintainer' }, actor: { login: actor } }];
  assert.equal(maintainerApproved({ labels: ['approved:maintainer'], events: ev(M), maintainer: M }), true);
  assert.equal(maintainerApproved({ labels: ['approved:maintainer'], events: ev('someone'), maintainer: M }), false);
  assert.equal(maintainerApproved({ labels: [], events: ev(M), maintainer: M }), false);
});

test('blocker: T0-T2 go on green, T3-T4 wait for approval; drafts, needs:rebase and other bases wait', () => {
  const pr = (o = {}) => ({ state: 'open', draft: false, labels: [{ name: 'merge:ready' }], base: { ref: 'main' }, ...o });
  for (const t of ['T0', 'T1', 'T2']) assert.equal(blocker({ pr: pr(), tier: t, approved: false, defaultBranch: 'main' }), null);
  for (const t of ['T3', 'T4']) {
    assert.equal(blocker({ pr: pr(), tier: t, approved: false, defaultBranch: 'main' }), 'awaiting-approval');
    assert.equal(blocker({ pr: pr(), tier: t, approved: true, defaultBranch: 'main' }), null);
  }
  assert.equal(blocker({ pr: pr({ draft: true }), tier: 'T0', defaultBranch: 'main' }), 'draft');
  assert.equal(blocker({ pr: pr({ labels: [{ name: 'needs:rebase' }] }), tier: 'T0', defaultBranch: 'main' }), 'needs-rebase');
  assert.equal(blocker({ pr: pr({ base: { ref: 'release' } }), tier: 'T0', defaultBranch: 'main' }), 'not-default-branch');
});

test('summarizeChecks: latest run per name, statuses as fallback, missing counts as pending', () => {
  const run = (id, name, status, conclusion = null) => ({ id, name, status, conclusion });
  const required = ['ci-ok', 'proof-ok', 'legacy'];
  assert.equal(summarizeChecks({ runs: [run(1, 'ci-ok', 'completed', 'success')], required }).state, 'pending');
  const all = summarizeChecks({ runs: [run(1, 'ci-ok', 'completed', 'success'), run(2, 'proof-ok', 'completed', 'failure'), run(3, 'proof-ok', 'completed', 'success')], statuses: [{ context: 'legacy', state: 'success' }], required });
  assert.equal(all.state, 'pass');
  const fail = summarizeChecks({ runs: [run(1, 'ci-ok', 'completed', 'cancelled'), run(2, 'proof-ok', 'in_progress')], statuses: [{ context: 'legacy', state: 'success' }], required });
  assert.equal(fail.state, 'fail');
  assert.deepEqual(fail.failed, ['ci-ok (cancelled)']);
  assert.deepEqual(parseChecks(''), DEFAULT_CHECKS);
  assert.deepEqual(parseChecks('a, b c'), ['a', 'b', 'c']);
});

test('wait polls until the checks conclude, and times out', async () => {
  let calls = 0;
  const api = { ghAll: path => {
    if (path.includes('/statuses')) return [];
    calls++;
    return [{ check_runs: [{ id: 1, name: 'ci-ok', status: calls < 3 ? 'in_progress' : 'completed', conclusion: calls < 3 ? null : 'success' }] }];
  } };
  const r = await wait({ repo: 'o/r', sha: 's', required: ['ci-ok'], api, sleep: async () => {}, pollSec: 0 });
  assert.equal(r.result, 'pass');
  assert.equal(calls, 3);
  let t = 0;
  const stuck = await wait({ repo: 'o/r', sha: 's', required: ['ci-ok'], timeoutMin: 1, api: { ghAll: () => [] }, sleep: async () => {}, now: () => (t += 30_000) });
  assert.equal(stuck.result, 'timeout');
  assert.deepEqual(stuck.missing, ['ci-ok']);
});

test('wait: a failure must hold for two polls, so a re-run started by an approval is not missed', async () => {
  let calls = 0;
  const run = (id, status, conclusion) => [{ check_runs: [{ id, name: 'proof-ok', status, conclusion }] }];
  const rerun = { ghAll: path => path.includes('/statuses') ? [] : (++calls === 1 ? run(1, 'completed', 'failure') : calls === 2 ? run(2, 'queued', null) : run(2, 'completed', 'success')) };
  assert.equal((await wait({ repo: 'o/r', sha: 's', required: ['proof-ok'], api: rerun, sleep: async () => {}, pollSec: 0 })).result, 'pass');
  calls = 0;
  const failing = { ghAll: path => path.includes('/statuses') ? [] : (calls++, run(1, 'completed', 'failure')) };
  const r = await wait({ repo: 'o/r', sha: 's', required: ['proof-ok'], api: failing, sleep: async () => {}, pollSec: 0 });
  assert.equal(r.result, 'fail');
  assert.equal(calls, 2);
  assert.deepEqual(r.failed, ['proof-ok (failure)']);
});

test('next: oldest eligible PR first; an unapproved T3 is skipped with one comment', () => {
  const prs = {
    5: { number: 5, title: 'engine', labels: [{ name: 'merge:ready' }], head: { ref: 'agent/5-x', sha: 'a5', repo: { full_name: 'o/r' } }, base: { ref: 'main' } },
    9: { number: 9, title: 'docs', labels: [{ name: 'merge:ready' }], head: { ref: 'agent/9-y', sha: 'a9', repo: { full_name: 'o/r' } }, base: { ref: 'main' } },
    12: { number: 12, title: 'more', labels: [{ name: 'merge:ready' }], head: { ref: 'agent/12-z', sha: 'a12', repo: { full_name: 'o/r' } }, base: { ref: 'main' } },
  };
  const files = { 5: ['packages/engine-mars/src/nav.ts'], 9: ['docs/a.md'], 12: ['apps/web/src/x.ts'] };
  const comments = [];
  const api = {
    gh: path => path === 'repos/o/r' ? { default_branch: 'main' } : prs[Number(path.split('/').pop())],
    ghAll: path => {
      if (path.startsWith('repos/o/r/issues?')) return [12, 9, 5].map(number => ({ number, pull_request: {} })).concat([{ number: 3 }]);
      const n = Number(path.split('/')[4]);
      if (path.includes('/files')) return files[n].map(filename => ({ filename }));
      if (path.includes('/reviews')) return [];
      if (path.includes('/comments')) return [];
      return [];
    },
    comment: (repo, n, body) => comments.push({ n, body }),
  };
  const r = next({ repo: 'o/r', maintainer: M, api });
  assert.equal(r.pr, 9);
  assert.equal(r.tier, 'T0');
  assert.equal(r.same_repo, true);
  assert.equal(r.more, true);
  assert.deepEqual(r.skipped, [{ pr: 5, tier: 'T3', why: 'awaiting-approval' }]);
  assert.equal(comments.length, 1);
  assert.match(comments[0].body, /T3, so it waits/);
});
