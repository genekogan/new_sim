import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { readJson, readJsonl } from '../../lib/jsonl.mjs';
import { reviewRun, requestPrompt, REVIEWER_ROLE } from '../reviewer.mjs';
import { loadRun } from '../run.mjs';
import { runOracles } from '../oracles.mjs';
import { copyRuns, fakeReviewer } from './helpers.mjs';

test('reviewRun writes every step-5 artifact from a fake model', async () => {
  const { main } = copyRuns(); const calls = [];
  const out = await reviewRun({ runDir: main, call: fakeReviewer(calls), log: () => {} });
  for (const f of ['oracles.jsonl', 'reviews.jsonl', 'ledger.tsv', 'issues.md', 'issues.json', 'feature-requests.md', 'feature-requests.json', 'emergence.json', 'desires.tsv']) assert.ok(existsSync(join(main, f)), f);
  assert.equal(calls.length, 4, '3 requests + 1 session call');
  assert.equal(readJsonl(join(main, 'oracles.jsonl')).length, 45);
  const byId = Object.fromEntries(out.reviews.map((r) => [r.requestId, r]));
  assert.equal(byId.r1.fidelity, 'H');
  assert.equal(byId.r2.fidelity, 'M'); assert.equal(byId.r2.class, 'O4'); assert.equal(byId.r2.inputDepth, 'realistic');
  assert.equal(byId.r3.fidelity, 'P', 'H vetoed by failing physical oracles');
  assert.deepEqual(byId.r3.vetoed.by.sort(), ['arrival', 'no-progress', 'truthfulness-basic']);
  assert.equal(byId.r3.leaked, true);
  assert.equal(byId.r3.reason, 'The card said arrived.');
  assert.doesNotMatch(JSON.stringify(out.issues), /server-side|ledger\.ts|\bcode\b|implement/);
  const ledger = readFileSync(join(main, 'ledger.tsv'), 'utf8').trim().split('\n');
  assert.equal(ledger.length, 4); assert.match(ledger[3], /H→P by/);
  assert.equal(out.issues.length, 2);
  const i3 = out.issues.find((i) => i.requestIds.includes('r3'));
  assert.equal(i3.repro.director.mode, 'scripted'); assert.equal(i3.repro.director.script[0].text, 'go to the library');
  assert.ok(i3.evidence.some((p) => p.startsWith('evidence/r3.json#samples')) && i3.evidence.includes('shots/pip/185000.png'));
  const iDuck = out.issues.find((i) => i.requestIds.includes('r2'));
  assert.deepEqual(iDuck.earlierSessions, ['20261024-100000-fixture-newcomer-1'], 'frequency across earlier sessions');
  assert.equal(out.featureRequests.length, 1, 'the persona desire joins the duck request');
  assert.equal(out.featureRequests[0].desireCount, 1);
  assert.ok(out.featureRequests[0].wordings.includes('wave at the ducks by the fountain'));
  const em = readJson(join(main, 'emergence.json'));
  assert.equal(em.narrative.storyRating, 2); assert.equal(em.metric.souls, 1); assert.equal(em.metric.coLocation, null);
});

test('request prompt carries realistic and debug depth, bounded, with the contract; system has the rubric and role', async () => {
  const { main } = copyRuns(); const run = loadRun(main); const ev = run.evidence.find((e) => e.requestId === 'r2');
  const p = requestPrompt(run, ev, runOracles(ev, { run }));
  assert.match(p, /The player asked: "say hi to the duck"/);
  assert.match(p, /capability\.unknown/); assert.match(p, /caps --search duck/);
  assert.match(p, /Aw, she can't even say hi to a duck/);
  assert.match(p, /"inputDepth":"realistic"\|"debug"/);
  assert.ok(p.length < 16000, `prompt ${p.length} chars`);
  assert.match(REVIEWER_ROLE, /never write a cause/); assert.match(REVIEWER_ROLE, /"realistic" when the problem is visible from the screen, the card or the chat alone/);
  const calls = []; await reviewRun({ runDir: main, call: fakeReviewer(calls), log: () => {} });
  assert.match(calls[0].appendSystem, /Late diagnostics never grant hits/); assert.match(calls[0].appendSystem, /P never counts as H/);
  assert.ok(calls[0].allowedTools.every((t) => t.startsWith(`Read(${main}/`)), 'Reviewer may only read this run\'s shots');
});

test('a model answer without JSON is recorded as unresolved, not guessed', async () => {
  const { main } = copyRuns();
  const out = await reviewRun({ runDir: main, call: async () => ({ text: 'sorry', wallMs: 1, exit: 0 }), log: () => {} });
  assert.ok(out.reviews.every((r) => r.fidelity === 'unresolved' && r.harness));
});
