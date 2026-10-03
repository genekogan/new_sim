import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { latestGate, externalProof, gateLogReader, evidenceStatus } from './evidence-gate.mjs';
const integrationLog = 'PASS: MCP handshake + 20 legacy tools + 16 engine tools, each called\nPASS: authenticate before body parsing, method restrictions, prototype keys and body size limits.';
const unitLog = '# tests 10\n# pass 10\n# fail 0\n# skipped 0\n# todo 0';
const integration = 'viewer/deploy/simulation-integration.mjs';
const gate = (steps, extra = {}) => ({ path: '.cloudflare/gate/run/report.json', reason: '', report: { steps, ...extra } });
const step = (name, rest = {}) => ({ step: name, status: 'pass', command: name === 'test' ? 'npm test' : '', log: `.cloudflare/gate/run/${name}.log`, ...rest });

test('external proofs affect row status; documentation never passes an executable claim', () => {
  const proof = externalProof(integration, { gate: gate([step('simulation-integration')]), readLog: () => integrationLog });
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
  assert.equal(externalProof(path, { gate: gate([step('test', { skipped: '0', todo: '0' })]), readLog: () => unitLog }).result, 'pass');
  assert.equal(externalProof(path, { gate: gate([step('test', { todo: '1' })]) }).result, 'unverified');
  const take = 'viewer/deploy/record-campus-take.mjs';
  assert.equal(externalProof(take, { gate: gate([step('record-campus-take', { command: 'node deploy/record-campus-take.mjs' })]) }).result, 'missing');
  assert.equal(externalProof(take, { gate: gate([step('take-check', { command: 'node deploy/record-campus-take.mjs --check' })]), readLog: () => 'check        public/engine/takes/campus.json OK (take id, final state, camera track and bytes match)' }).result, 'pass');
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


test('green JSON without an execution log or completion record cannot prove a citation', () => {
  for (const [path, name] of [[integration, 'simulation-integration'], ['viewer/deploy/history-ids.test.mjs', 'test'], ['viewer/deploy/determinism-probe.mjs', 'determinism-probe']]) {
    for (const log of ['', '$ command started\n']) assert.equal(externalProof(path, { gate: gate([step(name)]), readLog: () => log }).result, 'unverified');
  }
  const path = 'viewer/e2e/poses.spec.ts';
  assert.equal(externalProof(path, { gate: gate([step('e2e')]), readLog: () => 'diagnostic: ok e2e/poses.spec.ts:1:1 was mentioned' }).result, 'unverified');
  assert.equal(externalProof(path, { gate: gate([step('e2e')]), readLog: () => '\u001b[32m ✓ 1 e2e/poses.spec.ts:7:1 › seated (1s)\u001b[0m\n\u001b[33m - 2 e2e/poses.spec.ts:9:1 › full\u001b[0m' }).result, 'unverified');
  assert.equal(externalProof('viewer/deploy/determinism-probe.mjs', { gate: gate([step('determinism-probe')]), readLog: () => 'status completed\nfinalStateHash '+ 'a'.repeat(64) }).result, 'pass');
  assert.equal(externalProof('viewer/deploy/history-ids.test.mjs', { gate: gate([step('test')]), readLog: () => unitLog.replace('# skipped 0', '# skipped 1') }).result, 'unverified');
});


test('a newer report-less gate attempt blocks older green evidence at the same HEAD', () => {
  const viewer = mkdtempSync(join(tmpdir(), 'mars-evidence-interrupted-'));
  try {
    const directory = join(viewer, '.cloudflare/gate');
    mkdirSync(join(directory, '001'), { recursive: true });
    writeFileSync(join(directory, '001/report.json'), JSON.stringify({ finishedAt: '2026-09-29', gitHead: 'abcd', gitDirty: false, steps: [step('simulation-integration')], ok: true }));
    const git = (op) => op === 'status' ? '' : 'abcd';
    assert.equal(latestGate(viewer, undefined, git).report.ok, true);
    mkdirSync(join(directory, '002'));
    writeFileSync(join(directory, '002/lint.log'), '$ npm run lint');
    writeFileSync(join(directory, 'zzz-unrelated-file'), 'not a gate attempt');
    const current = latestGate(viewer, undefined, git);
    assert.equal(current.path, '.cloudflare/gate/002/report.json');
    assert.equal(current.report, null);
    assert.match(current.reason, /unreadable gate report/);
    assert.equal(externalProof(integration, { gate: current, readLog: () => integrationLog }).result, 'missing');
  } finally { rmSync(viewer, { recursive: true, force: true }); }
});
