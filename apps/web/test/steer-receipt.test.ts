import { test } from 'node:test';
import assert from 'node:assert/strict';
import { steerReceipt } from '../src/steer-receipt.ts';

test('current mandate receipt is acceptance even if a future field claims completion', () => {
  const got = steerReceipt(200, { ok: true, text: 'join the campfire', seq: 42, tick: 100, phase: 'completed', rule: { status: 'active' } }, 'mandate');
  assert.deepEqual(got, { kind: 'accepted', title: 'Rule accepted', detail: 'join the campfire', seq: 42, tick: 100 });
});

test('current command receipt preserves only canonical references and understood words', () => {
  assert.deepEqual(steerReceipt(200, { ok: true, text: 'rest', seq: 0, tick: 0, minted: ['rest'], private: 'not surfaced' }, 'command'),
    { kind: 'accepted', title: 'Direction accepted', detail: 'rest', seq: 0, tick: 0 });
});

test('HTTP success with a rejected interpretation is a refusal', () => {
  assert.equal(steerReceipt(200, { ok: false, reason: 'No known target named moon' }, 'command').detail, 'No known target named moon');
  assert.equal(steerReceipt(200, { ok: false, text: 'rest' }, 'mandate').kind, 'refused');
});

test('unknown or incomplete successful bodies never imply acceptance', () => {
  for (const body of [null, 'ok', [], {}, { ok: 'true', text: 'rest' }, { ok: true }, { ok: true, text: ' ' }]) {
    assert.equal(steerReceipt(200, body, 'command').kind, 'unconfirmed');
  }
});

test('lost, partial and server-error responses preserve mutation uncertainty', () => {
  for (const status of [0, 202, 204, 500, 503]) {
    const got = steerReceipt(status, { message: 'try again' }, 'mandate');
    assert.equal(got.kind, 'unconfirmed');
    assert.match(got.detail, /may have saved/);
    assert.match(got.detail, /history before/);
  }
});

test('authority and capacity rejections do not get promoted by an ok body', () => {
  for (const status of [400, 401, 403, 404, 409, 429]) {
    assert.equal(steerReceipt(status, { ok: true, text: 'rest', message: 'not allowed' }, 'mandate').kind, 'refused');
  }
});

test('exact intent uses actual top-level HTTP references, rejecting internal method shape', () => {
  assert.deepEqual(steerReceipt(200, { ok: true, intent: { goal: 'rest' }, text: 'rest', seq: 7, tick: 12 }, 'intent'),
    { kind: 'accepted', title: 'Direction accepted', detail: 'rest', seq: 7, tick: 12 });
  assert.equal(steerReceipt(200, { text: 'rest', intent: { goal: 'rest' } }, 'intent').kind, 'unconfirmed');
  assert.equal(steerReceipt(200, { intent: { goal: 'rest' }, text: 'rest', event: { seq: 7, tick: 12 } }, 'intent').kind, 'unconfirmed');
});

test('malformed indices are not usable event links', () => {
  for (const value of [-1, 1.5, Infinity, '42', NaN]) {
    const got = steerReceipt(200, { ok: true, text: 'rest', seq: value, tick: value }, 'command');
    assert.equal(got.seq, undefined);
    assert.equal(got.tick, undefined);
  }
});
