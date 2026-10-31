#!/usr/bin/env node
// The merge train's decisions, for .github/workflows/merge-train.yml (the label flow is documented there).
//
//   node .github/scripts/merge-train.mjs next  --repo o/r [--maintainer login] [--output file]
//        the oldest `merge:ready` PR that can go now: pr, tier, head_ref, head_sha, base_ref, same_repo, more
//   node .github/scripts/merge-train.mjs wait  --repo o/r --sha <sha> [--checks a,b] [--timeout-min 60] [--output f]
//        polls check runs and commit statuses on <sha> until every required check concluded: result=pass|fail|timeout
//   node .github/scripts/merge-train.mjs merge --repo o/r --pr <n> --sha <sha>
//        squash-merges exactly <sha>
//   node .github/scripts/merge-train.mjs eject --repo o/r --pr <n> [--label needs:rebase] --message-file <file>
//        takes the PR off the train (removes merge:ready), adds the label, comments why
//
// Every GitHub call goes through `gh api` (GH_TOKEN).
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPolicy, tierFor } from '../../tools/proof/tier.mjs';

export const READY = 'merge:ready', REBASE = 'needs:rebase', APPROVED_LABEL = 'approved:maintainer';
export const DEFAULT_CHECKS = ['ci-ok', 'gitleaks', 'path-guard', 'scrub-guard', 'fragment', 'proof-ok'];
const AWAITING = '<!-- merge-train:awaiting-approval -->';
const rank = t => ['T0', 'T1', 'T2', 'T3', 'T4'].indexOf(t);

/** The maintainer has signed off: their latest decisive review is an approval, or they added `approved:maintainer`
 * themselves (GitHub does not let an author approve their own PR). */
export function maintainerApproved({ reviews = [], events = [], labels = [], maintainer }) {
  const decisive = reviews.filter(r => r?.user?.login === maintainer && ['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'].includes(r.state));
  if (decisive.at(-1)?.state === 'APPROVED') return true;
  if (!labels.includes(APPROVED_LABEL)) return false;
  const added = [...events].reverse().find(e => e?.event === 'labeled' && e.label?.name === APPROVED_LABEL);
  return added?.actor?.login === maintainer;
}

/** Why a ready PR cannot go now, or null when it can. */
export function blocker({ pr, tier, approved, defaultBranch }) {
  const labels = (pr.labels ?? []).map(l => l.name ?? l);
  if (pr.state && pr.state !== 'open') return 'closed';
  if (pr.draft) return 'draft';
  if (labels.includes(REBASE)) return 'needs-rebase';
  if (pr.base?.ref && pr.base.ref !== defaultBranch) return 'not-default-branch';
  if (rank(tier) >= 3 && !approved) return 'awaiting-approval';
  return null;
}

/** Folds check runs and commit statuses into one verdict over the required names (latest run per name wins). */
export function summarizeChecks({ runs = [], statuses = [], required = DEFAULT_CHECKS }) {
  const latest = new Map();
  for (const r of runs) { const prev = latest.get(r.name); if (!prev || r.id > prev.id) latest.set(r.name, r); }
  const status = new Map();
  for (const s of statuses) if (!status.has(s.context)) status.set(s.context, s); // API returns newest first
  const failed = [], pending = [], missing = [];
  for (const name of required) {
    const r = latest.get(name), s = status.get(name);
    if (r) {
      if (r.status !== 'completed') pending.push(name);
      else if (!['success', 'neutral', 'skipped'].includes(r.conclusion)) failed.push(`${name} (${r.conclusion})`);
    } else if (s) {
      if (s.state === 'pending') pending.push(name);
      else if (s.state !== 'success') failed.push(`${name} (${s.state})`);
    } else missing.push(name);
  }
  const state = failed.length ? 'fail' : pending.length || missing.length ? 'pending' : 'pass';
  return { state, failed, pending, missing };
}

export function parseChecks(text) {
  const list = String(text ?? '').split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_CHECKS;
}

// ── gh ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const ghRaw = (args, input) => execFileSync('gh', ['api', ...args], { encoding: 'utf8', input, maxBuffer: 1 << 26, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
const gh = (...args) => { const out = ghRaw(args); return out.trim() ? JSON.parse(out) : null; };
const ghAll = path => gh(path, '--paginate', '--slurp').flat();

function comment(repo, pr, body) { ghRaw([`repos/${repo}/issues/${pr}/comments`, '--input', '-'], JSON.stringify({ body })); }

export function next({ repo, maintainer, api = { gh, ghAll, comment } }) {
  const repoInfo = api.gh(`repos/${repo}`);
  const defaultBranch = repoInfo.default_branch;
  const candidates = api.ghAll(`repos/${repo}/issues?state=open&labels=${encodeURIComponent(READY)}&per_page=100`)
    .filter(i => i.pull_request).map(i => i.number).sort((a, b) => a - b);
  const policy = loadPolicy();
  const skipped = [];
  for (const [i, n] of candidates.entries()) {
    const pr = api.gh(`repos/${repo}/pulls/${n}`);
    const labels = (pr.labels ?? []).map(l => l.name);
    const files = api.ghAll(`repos/${repo}/pulls/${n}/files?per_page=100`).flatMap(f => [f.filename, f.previous_filename]).filter(Boolean);
    const { tier } = tierFor(files, policy, labels);
    let approved = false;
    if (rank(tier) >= 3) {
      approved = maintainerApproved({ reviews: api.ghAll(`repos/${repo}/pulls/${n}/reviews?per_page=100`),
        events: labels.includes(APPROVED_LABEL) ? api.ghAll(`repos/${repo}/issues/${n}/events?per_page=100`) : [], labels, maintainer });
    }
    const why = blocker({ pr, tier, approved, defaultBranch });
    if (why === 'awaiting-approval') {
      const comments = api.ghAll(`repos/${repo}/issues/${n}/comments?per_page=100`);
      if (!comments.some(c => String(c.body).startsWith(AWAITING))) {
        api.comment(repo, n, `${AWAITING}\nMerge train: this PR is ${tier}, so it waits for @${maintainer}'s approving review (or, on a PR they authored, the \`${APPROVED_LABEL}\` label added by them). It stays queued and goes on the next run after approval.`);
      }
    }
    if (why) { skipped.push({ pr: n, tier, why }); continue; }
    return {
      pr: n, tier, head_ref: pr.head.ref, head_sha: pr.head.sha, base_ref: pr.base.ref, title: pr.title,
      same_repo: pr.head.repo?.full_name === repo, more: candidates.length - i - 1 > 0, skipped,
    };
  }
  return { pr: '', more: false, skipped };
}

export async function wait({ repo, sha, required, timeoutMin = 60, pollSec = 20, api = { ghAll, gh }, sleep = ms => new Promise(r => setTimeout(r, ms)), now = Date.now }) {
  const deadline = now() + timeoutMin * 60_000;
  let s;
  for (;;) {
    const runs = api.ghAll(`repos/${repo}/commits/${sha}/check-runs?per_page=100`).flatMap(p => p.check_runs ?? p);
    const statuses = api.ghAll(`repos/${repo}/commits/${sha}/statuses?per_page=100`);
    s = summarizeChecks({ runs, statuses, required });
    if (s.state !== 'pending') return { result: s.state, ...s };
    if (now() >= deadline) return { result: 'timeout', ...s };
    await sleep(pollSec * 1000);
  }
}

function out(file, obj) {
  const lines = Object.entries(obj).filter(([, v]) => typeof v !== 'object').map(([k, v]) => `${k}=${String(v).replace(/\n/g, ' ')}`);
  if (file) appendFileSync(file, `${lines.join('\n')}\n`);
  console.log(JSON.stringify(obj, null, 2));
}

async function main([mode, ...argv]) {
  const opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const repo = opt('--repo') ?? process.env.GITHUB_REPOSITORY;
  if (!repo) { console.error('--repo is required'); return 2; }
  if (mode === 'next') {
    out(opt('--output'), next({ repo, maintainer: opt('--maintainer') ?? process.env.MAINTAINER ?? repo.split('/')[0] }));
    return 0;
  }
  if (mode === 'wait') {
    const r = await wait({ repo, sha: opt('--sha'), required: parseChecks(opt('--checks') ?? process.env.CHECKS), timeoutMin: Number(opt('--timeout-min') ?? 60) });
    out(opt('--output'), { result: r.result, failed: r.failed.join(', '), pending: [...r.pending, ...r.missing].join(', ') });
    return 0;
  }
  if (mode === 'merge') {
    const pr = gh(`repos/${repo}/pulls/${opt('--pr')}`);
    gh('-X', 'PUT', `repos/${repo}/pulls/${opt('--pr')}/merge`, '-f', 'merge_method=squash', '-f', `sha=${opt('--sha')}`, '-f', `commit_title=${pr.title} (#${pr.number})`);
    console.log(`merged #${pr.number} at ${opt('--sha')}`);
    return 0;
  }
  if (mode === 'eject') {
    const pr = opt('--pr');
    try { ghRaw(['-X', 'DELETE', `repos/${repo}/issues/${pr}/labels/${encodeURIComponent(READY)}`]); } catch { /* already gone */ }
    if (opt('--label')) ghRaw([`repos/${repo}/issues/${pr}/labels`, '--input', '-'], JSON.stringify({ labels: [opt('--label')] }));
    comment(repo, pr, readFileSync(opt('--message-file'), 'utf8'));
    console.log(`ejected #${pr}${opt('--label') ? ` with ${opt('--label')}` : ''}`);
    return 0;
  }
  console.error('usage: merge-train.mjs next | wait | merge | eject (see the header)');
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
