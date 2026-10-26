import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { combineReceipts } from './ship-receipt.mjs';

const SHA = 'a'.repeat(40);
const gate = (over = {}) => ({ schemaVersion: 1, status: 'quarantined', blockers: [], exclusions: ['V7', 'V8'], refs: { baseline: { sha: 'b'.repeat(40) }, candidate: { sha: SHA } }, newFailures: [], quarantined: [{}], ...over });
const v7 = (over = {}) => ({ schemaVersion: 1, step: 'V7', source: SHA, dirty: false, status: 'pass', checks: [{ id: 'x', ok: true }], failed: [], ...over });

test('same clean candidate combines; status follows the gate; V8 remains excluded', () => {
  const r = combineReceipts(gate(), v7());
  assert.equal(r.status, 'quarantined');
  assert.deepEqual(r.remainingExclusions, ['V8']);
  assert.equal(combineReceipts(gate({ status: 'pass' }), v7()).status, 'pass');
});

test('mismatched sha, dirty V7, failing V7 or blocked gate are blocked', () => {
  assert.equal(combineReceipts(gate(), v7({ source: 'c'.repeat(40) })).status, 'blocked');
  assert.equal(combineReceipts(gate(), v7({ dirty: true })).status, 'blocked');
  assert.equal(combineReceipts(gate(), v7({ status: 'fail', failed: ['x'] })).status, 'blocked');
  assert.equal(combineReceipts(gate(), v7({ checks: [{ id: 'x', ok: false }] })).status, 'blocked');
  assert.equal(combineReceipts(gate({ status: 'blocked', blockers: ['boom'] }), v7()).status, 'blocked');
  assert.equal(combineReceipts(gate({ exclusions: ['V8'] }), v7()).status, 'blocked');
});

test('CLI writes ship-receipt.json next to the gate receipt and exits by status', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ship-receipt-'));
  try {
    writeFileSync(join(dir, 'receipt.json'), JSON.stringify(gate()));
    writeFileSync(join(dir, 'v7.json'), JSON.stringify(v7()));
    const ok = spawnSync(process.execPath, [new URL('./ship-receipt.mjs', import.meta.url).pathname, join(dir, 'receipt.json'), join(dir, 'v7.json')], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /^RELEASE_SHIP QUARANTINED candidate=a{40} .*remaining=V8 blockers=0/);
    const r = JSON.parse(readFileSync(join(dir, 'ship-receipt.json'), 'utf8'));
    assert.equal(r.gate.sha256.length, 64); assert.equal(r.v7.status, 'pass');
    writeFileSync(join(dir, 'v7.json'), JSON.stringify(v7({ source: 'c'.repeat(40) })));
    const bad = spawnSync(process.execPath, [new URL('./ship-receipt.mjs', import.meta.url).pathname, join(dir, 'receipt.json'), join(dir, 'v7.json'), '--out', join(dir, 'x.json')], { encoding: 'utf8' });
    assert.equal(bad.status, 1); assert.match(bad.stdout, /^RELEASE_SHIP BLOCKED/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('a scoped or not-gated candidate gate never makes a ship receipt; a full-scope gate does', () => {
  for (const resolved of ['scoped', 'none']) {
    const r = combineReceipts(gate({ scope: { mode: 'auto', resolved } }), v7());
    assert.equal(r.status, 'blocked'); assert.match(r.blockers.join('\n'), new RegExp(`gate scope ${resolved}`));
  }
  assert.equal(combineReceipts(gate({ scope: { mode: 'auto', resolved: 'full' } }), v7()).status, 'quarantined');
});
