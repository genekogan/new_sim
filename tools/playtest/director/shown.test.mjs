import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeShown, legibleText, cardText, requestsText, clip, fmtElapsed, LIMITS } from './shown.mjs';

const base = {
  elapsedSec: 125.4, screenshotPath: '/run/personas/pip/shown/3.png',
  legible: { card: { name: 'Pip', presence: 'listening', ack: 'on my way', result: null }, bubbles: ['Hi there!'], signs: ['The Old Mill'], toasts: [], roster: ['Pip', 'Tam'] },
  cardView: { latest: { id: 'msg_123abc', text: 'go to the mill', state: 'acked', ack: 'heading to the mill' }, presence: 'listening', queued: [{ id: 'msg_9' }] },
  chatRendered: '> go to the mill\n⏺ Bash(node x)\nOn it.',
  lastRequests: [{ atSec: 20, channel: 'card', text: 'go to the mill', requestId: 'pip-001' }],
};

test('composition has every part, in order, deterministically', () => {
  const a = composeShown(base);
  assert.equal(a, composeShown(structuredClone(base)));
  const order = ['[Glance at 2m 05s', 'Your screen: /run/personas/pip/shown/3.png', 'What you can read', 'The card:', 'New in the chat window', 'What you have asked so far', 'JSON object only'];
  let at = -1; for (const s of order) { const i = a.indexOf(s); assert.ok(i > at, s); at = i; }
  assert.match(a, /On the Soul card: name: Pip · status: listening · heard: on my way/);
  assert.match(a, /Speech: "Hi there!"/);
  assert.match(a, /Signs and place names: "The Old Mill"/);
  assert.match(a, /Your latest note: "go to the mill" \(acked\)/);
  assert.match(a, /Notes still waiting: 1/);
  assert.match(a, /at 0m 20s in the card: "go to the mill"/);
});

test('no ids leak from the card view or requests', () => {
  const a = composeShown(base);
  assert.ok(!a.includes('msg_123abc') && !a.includes('msg_9') && !a.includes('pip-001'));
});

test('empty inputs get placeholders', () => {
  const a = composeShown({});
  for (const s of ['could not see the screen', '(nothing readable)', '(empty)', '(nothing new)', '(nothing yet)']) assert.ok(a.includes(s), s);
});

test('truncation: legible head ≤ 1500, chat tail ≤ 2500', () => {
  const legible = 'L'.repeat(5000);
  assert.ok(legibleText(legible).length <= LIMITS.legible);
  assert.ok(legibleText({ bubbles: Array.from({ length: 200 }, (_, i) => `bubble ${i} ${'x'.repeat(50)}`) }).length <= LIMITS.legible);
  const chat = 'OLD'.repeat(2000) + 'NEWEST-LINE';
  const a = composeShown({ chatRendered: chat });
  const part = a.split('New in the chat window since your last glance:\n')[1].split('\n\nWhat you have asked')[0];
  assert.ok(part.length <= LIMITS.chat, String(part.length));
  assert.ok(part.endsWith('NEWEST-LINE'));
  assert.ok(part.startsWith('…(earlier part cut)'));
});

test('raw text is used only when nothing structured is present', () => {
  assert.equal(legibleText({ raw: 'just text' }), 'just text');
  assert.ok(!legibleText({ raw: 'RAW', signs: ['Mill'] }).includes('RAW'));
});

test('helpers', () => {
  assert.equal(fmtElapsed(0), '0m 00s'); assert.equal(fmtElapsed(61), '1m 01s');
  assert.equal(clip('abc', 5), 'abc');
  assert.equal(cardText('plain'), 'plain');
  assert.equal(requestsText([]), '');
  assert.match(cardText({ ack: 'heard', result: 'sat down' }), /Heard line: heard\nResult line: sat down/);
});
