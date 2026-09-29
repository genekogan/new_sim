import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { latestGate, externalProof, gateLogReader, evidenceStatus } from './evidence-gate.mjs';
const integration = 'viewer/deploy/simulation-integration.mjs';
const gate = (steps, extra = {}) => ({ path: '.cloudflare/gate/run/report.json', reason: '', report: { steps, ...extra } });
const step = (name, rest = {}) => ({ step: name, status: 'pass', command: name === 'test' ? 'npm test' : '', log: `.cloudflare/gate/run/${name}.log`, ...rest });

test('external proofs affect row status; documentation never passes an executable claim', () => {
  const proof = externalProof(integration, { gate: gate([step('simulation-integration')]) });
  assert.equal(proof.result, 'pass');
  assert.deepEqual(evidenceStatus([{ result: 'pass' }], [proof]), { passed: 2, total: 2, status: 'PROVEN' });
  assert.equal(evidenceStatus([{ result: 'pass' }], [{ ...proof, result: 'missing' }]).status, 'PARTIAL');
  const reference = externalProof('docs/engineering/README.md', { gate: gate([]) });
  assert.equal(reference.result, 'reference');
  assert.deepEqual(evidenceStatus([], [reference]), { passed: 0, total: 0, status: 'UNPROVEN' });
});

test('external proof records failed, absent, stale and missing-file results honestly', () => {
  assert.equal(externalProof(integration, { gate: gate([step('simulation-integration', { status: 'fail' })]) }).result, 'fail');
  assert.equal(externalProof(integration, { gate: gate([]) }).result, 'missing');
  assert.equal(externalProof(integration, { gate: { ...gate([step('simulation-integration')]), reason: 'old revision' } }).result, 'stale');
  assert.equal(externalProof(integration, { gate: gate([step('simulation-integration')]), exists: false }).result, 'missing');
  assert.equal(externalProof(integration, { gate: gate([step('simulation-integration', { timedOut: true })]) }).result, 'fail');
});

test('Playwright citations require their spec in logs, and cannot hide skipped cases', () => {
  const path = 'viewer/e2e/poses.spec.ts', context = { gate: gate([step('e2e')]) };
  assert.equal(externalProof(path, { ...context, readLog: () => ' ✓ 1 e2e/poses.spec.ts:7:1 › seated (1s)' }).result, 'pass');
  assert.equal(externalProof(path, { ...context, readLog: () => ' ✓ 1 e2e/fire.spec.ts:7:1 › fire (1s)' }).result, 'unverified');
  assert.equal(externalProof(path, { ...context, readLog: () => ' ✓ 1 e2e/poses.spec.ts:7:1 › seated (1s)\n - 2 e2e/poses.spec.ts:9:1 › full' }).result, 'unverified');
});

test('deploy test proofs reject skipped aggregate; take generation is not take checking', () => {
  const path = 'viewer/deploy/history-ids.test.mjs';
  assert.equal(externalProof(path, { gate: gate([step('test', { skipped: '0', todo: '0' })]) }).result, 'pass');
  assert.equal(externalProof(path, { gate: gate([step('test', { todo: '1' })]) }).result, 'unverified');
  const take = 'viewer/deploy/record-campus-take.mjs';
  assert.equal(externalProof(take, { gate: gate([step('record-campus-take', { command: 'node deploy/record-campus-take.mjs' })]) }).result, 'missing');
  assert.equal(externalProof(take, { gate: gate([step('take-check', { command: 'node deploy/record-campus-take.mjs --check' })]) }).result, 'pass');
});

test('latest gate keeps latest failure; rejects old/dirty revisions and malformed reports', () => {
  const viewer = mkdtempSync(join(tmpdir(), 'mars-evidence-'));
  try {
    const write = (name, data) => { const d = join(viewer, '.cloudflare/gate', name); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'report.json'), JSON.stringify(data)); };
    const report = { finishedAt: '2026-09-29', gitHead: 'abcd', gitDirty: false, steps: [step('e2e')], ok: true };
    const git = (op) => op === 'status' ? '' : 'abcd';
    assert.equal(latestGate(viewer, undefined, git).report, null);
    write('001', report); write('002', { ...report, ok: false, steps: [step('e2e', { status: 'fail' })] });
    assert.equal(latestGate(viewer, undefined, git).report.ok, false);
    assert.match(latestGate(viewer, undefined, (op, arg) => op === 'status' ? '' : arg === 'HEAD' ? 'new' : 'old').reason, /differs/);
    write('003', { ...report, gitDirty: true });
    assert.match(latestGate(viewer, undefined, git).reason, /dirty/);
    write('004', { ...report, steps: null });
    assert.match(latestGate(viewer, undefined, git).reason, /unreadable/);
    write('005', report);
    assert.match(latestGate(viewer, undefined, (op) => op === 'status' ? ' M app/studio/a.ts' : 'abcd').reason, /uncommitted/);
    const log = join(viewer, '.cloudflare/gate/005/e2e.log'); writeFileSync(log, 'proof');
    assert.equal(gateLogReader(viewer)('.cloudflare/gate/005/e2e.log'), 'proof');
    assert.equal(gateLogReader(viewer)('../outside.log'), '');
  } finally { rmSync(viewer, { recursive: true, force: true }); }
});
