import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateReport, formatMarkdown, main } from './report.mjs';

const sha = 'a'.repeat(40), harness = 'b'.repeat(40);
function fixture(t, { complete = true, status = 'pass', exit = '0' } = {}) {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'release-diagnostics-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const run = join(dir, 'run'); mkdirSync(join(run, 'candidate/out/suite'), { recursive: true });
  const metadata = { sourceSha: sha, harnessRef: sha, harnessTree: harness, suiteCompleted: complete, node: '22', nodeVersion: 'v22.23.3', pnpmVersion: '10.27.0' };
  const receipt = { schemaVersion: 1, status, startedAt: '2026-10-28T02:00:00Z', endedAt: '2026-10-28T02:10:00Z',
    refs: { candidate: { sha } }, harness: { ref: sha, tree: harness }, scope: { resolved: 'full', steps: ['V5-server-full'] },
    newFailures: [], unexpectedSkips: [], blockers: [], runs: { candidate: { errors: [] } } };
  const put = (path, value) => { const file = join(dir, path); mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); return file; };
  put('run/receipt.json', receipt); put('run/candidate/out/RUN-METADATA.json', metadata);
  put('run/candidate/out/suite/SUMMARY.tsv', `step\texit\tseconds\tlog\nV5-server-full\t${exit}\t600\t/out/suite/V5-server-full.log\n`);
  put('run/candidate/out/suite/V5-server-full.log', 'TAP version 13\nok 1 - works\n');
  return { dir, run, metadata, receipt, put };
}

test('complete passing CPU receipt never becomes release-qualified or deployed', t => {
  const f = fixture(t), r = generateReport({ run: f.run });
  assert.equal(r.outcome.status, 'receipt-reports-clean-cpu-scope');
  assert.equal(r.release.releaseQualified.status, 'not-established');
  assert.equal(r.release.liveVerified.status, 'not-established');
  assert.equal(r.release.deployedAt, null); assert.equal(r.elapsed.driverWallSeconds, 600);
  assert.ok(r.retainedEvidence.every(a => /^[0-9a-f]{64}$/.test(a.sha256)));
});

test('stopped incomplete V5 with zero newFailures retains two real failed assertions', t => {
  const f = fixture(t, { complete: false, status: 'blocked', exit: 'SHARDS-MISSING' });
  const failures = [
    { title: 'calendar legacy parity one', line: 14, context: ['not ok 14 - calendar legacy parity one', "location: 'cache.test.ts:233:1'"] },
    { title: 'calendar legacy parity two', line: 15, context: ['not ok 15 - calendar legacy parity two'] },
  ];
  const snapshot = { at: '2026-10-28T02:05:00Z', app: 'ap-example', reads: [{ container: 'ta-example', data: { logs: [{ file: 'V5-server-full.log', failures }] } }] };
  const evidence = f.put('copied-progress.jsonl', [snapshot, snapshot].map(r => JSON.stringify(r)).join('\n'));
  const r = generateReport({ run: f.run, evidence: [evidence] });
  assert.equal(r.outcome.comparisonNewFailures, 0); assert.equal(r.outcome.observedDistinctFailingAssertions, 2);
  assert.equal(r.outcome.cpuReceiptClean, false); assert.equal(r.outcome.status, 'failure-observed-incomplete');
  assert.equal(r.outcome.firstUsefulError.stage, 'V5-server-full'); assert.match(r.outcome.firstUsefulError.text, /parity one/);
  assert.deepEqual(r.outcome.incompleteStages, ['V5-server-full']);
});

test('infrastructure interruption is not described as a proven product failure', t => {
  const f = fixture(t, { complete: false, status: 'blocked', exit: 'SHARDS-MISSING' });
  f.put('run/candidate/modal.log', "Preempted container\nMERGE PROBLEM: group v5-1: container failed: RemoteError('')\nStopping app - user stopped from CLI.\n");
  const r = generateReport({ run: f.run });
  assert.equal(r.outcome.status, 'incomplete-or-blocked');
  assert.ok(r.outcome.failureCategory.includes('infrastructure-interruption-observed'));
  assert.ok(!r.outcome.failureCategory.some(c => c.startsWith('test-or-build')));
});

test('a build error is useful even without TAP assertions', t => {
  const f = fixture(t, { status: 'blocked', exit: '1' });
  f.put('run/candidate/out/suite/V5-server-full.log', 'Error: failed to compile module\n');
  const r = generateReport({ run: f.run }); assert.match(r.outcome.firstUsefulError.text, /failed to compile/);
});

test('expected fixture warning in a passing stage does not replace a failed assertion', t => {
  const f = fixture(t); f.put('run/candidate/out/suite/V5-server-full.log', '# fallback: Error: fixture missing body\n');
  let r = generateReport({ run: f.run }); assert.equal(r.outcome.firstUsefulError, null); assert.equal(r.outcome.status, 'receipt-reports-clean-cpu-scope');
  const evidence = f.put('assertion.jsonl', JSON.stringify({ reads: [{ data: { logs: [{ file: 'V5-server-full.log', failures: ['not ok 5 - actual failure'] }] } }] }));
  r = generateReport({ run: f.run, evidence: [evidence] }); assert.match(r.outcome.firstUsefulError.text, /actual failure/);
});

test('metadata/receipt identity disagreement prevents a clean report', t => {
  const f = fixture(t); f.metadata.sourceSha = 'c'.repeat(40); f.put('run/candidate/out/RUN-METADATA.json', f.metadata);
  const r = generateReport({ run: f.run });
  assert.equal(r.outcome.cpuReceiptClean, false); assert.match(r.identityMismatches[0], /sourceSha/);
});

test('group runtime mismatch prevents clean reporting and passing test titles do not imply infrastructure failure', t => {
  const f = fixture(t); f.put('run/candidate/out/suite/V5-server-full.log', '# Subtest: preemption policy rejects timeout\nok 1 - preemption policy rejects timeout\n');
  let r = generateReport({ run: f.run }); assert.deepEqual(r.outcome.failureCategory, []);
  f.put('run/candidate/out/groups/a/RUN-METADATA.json', { ...f.metadata, nodeVersion: 'v22.1.0' });
  r = generateReport({ run: f.run }); assert.equal(r.outcome.cpuReceiptClean, false); assert.match(r.identityMismatches[0], /nodeVersion/);
});

test('unrelated supplemental app assertions are rejected rather than assigned to this run', t => {
  const f = fixture(t); f.put('run/candidate/modal.log', 'ap-correct');
  const evidence = f.put('wrong.jsonl', JSON.stringify({ app: 'ap-wrong', reads: [{ data: { logs: [{ file: 'V5-server-full.log', failures: ['not ok 1 - unrelated'] }] } }] }));
  const r = generateReport({ run: f.run, evidence: [evidence] }); assert.equal(r.outcome.observedDistinctFailingAssertions, 0); assert.equal(r.outcome.cpuReceiptClean, false);
  assert.match(r.identityMismatches[0], /app mismatch/);
});

test('a passing receipt cannot hide a retained assertion failure or missing stage log', t => {
  const f = fixture(t); f.put('run/candidate/out/suite/V5-server-full.log', 'not ok 1 - genuine failure\n');
  let r = generateReport({ run: f.run }); assert.equal(r.outcome.cpuReceiptClean, false); assert.equal(r.outcome.status, 'failure-observed');
  rmSync(join(f.run, 'candidate/out/suite/V5-server-full.log'));
  r = generateReport({ run: f.run }); assert.equal(r.outcome.complete, false); assert.equal(r.outcome.missingLogs.length, 1);
});

test('cost is matched to exactly one retained app and stays an estimate', t => {
  const f = fixture(t); f.put('run/candidate/modal.log', 'https://modal.com/apps/owner/main/ap-example');
  const ledger = f.put('ledger.json', { method: 'requested-resource envelope', requestedPerGate: { totalCpu: 20, totalMemoryGiB: 40 }, runs: [{ name: 'other', app: 'ap-example', estimateUsd: 0.4595, actualInvoiceUsd: null, wallSeconds: 1000 }] });
  const r = generateReport({ run: f.run, costLedger: ledger });
  assert.equal(r.cost.estimateUsd, 0.4595); assert.equal(r.cost.actualInvoiceUsd, null);
  assert.match(formatMarkdown(r), /Actual invoice: unknown/); assert.match(r.cost.label, /not invoice/);
  assert.equal(r.groups.length, 0);
});

test('ambiguous cost attribution is rejected', t => {
  const f = fixture(t); f.put('run/candidate/modal.log', 'ap-one ap-two');
  const ledger = f.put('ledger.json', { runs: [{ app: 'ap-one', estimateUsd: 1 }, { app: 'ap-two', estimateUsd: 2 }] });
  const r = generateReport({ run: f.run, costLedger: ledger });
  assert.equal(r.cost.estimateUsd, null); assert.ok(r.issues.some(i => /ambiguous/.test(i)));
});

test('container snapshots expose observed lower bounds, not billed lifetimes', t => {
  const f = fixture(t);
  const evidence = f.put('progress.jsonl', JSON.stringify({ at: '2026-10-28T02:05:00Z', inventory: [{ container_id: 'ta-example', start_time: '2026-10-27 22:00:00-04:00' }] }));
  const r = generateReport({ run: f.run, evidence: [evidence] });
  assert.equal(r.containers[0].observedElapsedSecondsLowerBound, 300);
  assert.equal(r.containers[0].elapsedContainerSeconds, null); assert.equal(r.containers[0].requestedCpu, null);
});

test('deployment timestamp requires timezone and source-matched evidence', t => {
  const f = fixture(t); const path = f.put('release.json', { sourceSha: sha, build: 'we-aaaaaaaaaaaa', deployedAt: '2026-10-28T02:00:00' });
  let r = generateReport({ run: f.run, releaseEvidence: path });
  assert.equal(r.release.deployedAt, null); assert.ok(r.issues.some(i => /timezone/.test(i)));
  f.put('proof.txt', 'retained owner evidence'); f.put('release.json', { sourceSha: sha, build: 'we-aaaaaaaaaaaa', deployedAt: '2026-10-27T22:00:00-04:00', liveVerified: ['proof.txt'] });
  r = generateReport({ run: f.run, releaseEvidence: path });
  assert.equal(r.release.deployedAt, '2026-10-27T22:00:00-04:00'); assert.equal(r.release.liveVerified.status, 'reported-with-retained-evidence');
  assert.match(r.release.liveVerified.reason, /not certified/);
});

test('source mismatch rejects release claims', t => {
  const f = fixture(t), path = f.put('release.json', { sourceSha: 'd'.repeat(40), build: 'wrong', deployedAt: '2026-10-28T02:00:00Z' });
  const r = generateReport({ run: f.run, releaseEvidence: path }); assert.equal(r.release.build, null); assert.equal(r.release.deployedAt, null);
});

test('CLI writes only a fresh external report directory and cannot overwrite evidence', t => {
  const f = fixture(t); const out = join(f.dir, 'report');
  assert.equal(main(['--run', f.run, '--out', out]), 0);
  assert.equal(JSON.parse(readFileSync(join(out, 'report.json'))).kind, 'release-diagnostic-report');
  assert.throws(() => main(['--run', f.run, '--out', out]), /new directory/);
  assert.throws(() => main(['--run', f.run, '--out', join(f.run, 'new')]), /outside retained/);
});

test('missing receipt/metadata is unknown and receipt paths are never followed', t => {
  const f = fixture(t); rmSync(join(f.run, 'receipt.json')); rmSync(join(f.run, 'candidate/out/RUN-METADATA.json'));
  const r = generateReport({ run: f.run }); assert.equal(r.outcome.cpuReceiptClean, false); assert.equal(r.identity.sourceSha, null);
});

test('symlink evidence is refused', t => {
  const f = fixture(t); const target = f.put('plain.txt', 'evidence'); const link = join(f.dir, 'link.txt'); symlinkSync(target, link);
  assert.throws(() => generateReport({ run: f.run, evidence: [link] }), /symlink/);
});
