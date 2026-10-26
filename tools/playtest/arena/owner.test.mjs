import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendCardRequest, cardViewRequest, publicSoulRequest, ownerSoulRequest, sentMessage, cardSummary } from './owner.mjs';
import { sendGodCardRequest, godCardViewRequest, godOnboardingText } from './god-seat.mjs';
const base = 'http://127.0.0.1:4995/w/pt-smoke', identity = 'agent-0123456789abcdef01234567';

test('owner card send builds the card route with the dev owner bearer', () => {
  const { url, init } = sendCardRequest({ base, soulId: 's_abc', identity, text: 'sit down' });
  assert.equal(url, `${base}/v1/edge/owner/s_abc/inbox`);
  assert.equal(init.method, 'POST'); assert.equal(init.headers.authorization, `Bearer dev:${identity}`);
  assert.deepEqual(JSON.parse(init.body), { text: 'sit down' });
  assert.equal(sendCardRequest({ base, soulId: 's_abc', identity: `dev:${identity}`, text: 'x' }).init.headers.authorization, `Bearer dev:${identity}`);
  assert.throws(() => sendCardRequest({ base, soulId: 's_abc', identity, text: '  ' }));
});

test('views: card GET, public soul, owner dashboard', () => {
  assert.equal(cardViewRequest({ base, soulId: 's_abc', identity }).init.method, 'GET');
  assert.equal(publicSoulRequest({ base, soulId: 's_abc' }).url, `${base}/v1/edge/public/souls/s_abc`);
  assert.equal(publicSoulRequest({ base, soulId: 's_abc' }).init.headers, undefined);
  assert.equal(ownerSoulRequest({ base, soulId: 's_abc', identity }).url, `${base}/v1/souls/s_abc`);
});

test('sentMessage and cardSummary read the owner inbox view', () => {
  const res = { ok: true, inbox: { connected: true, lastSeenAt: 1, latest: { id: 'm_1', text: 'sit down', state: 'sent', sentAt: 1000 }, queued: 1, presence: 'listening' } };
  assert.deepEqual(sentMessage(res, 'sit down').messageId, 'm_1');
  const acked = { ...res.inbox, latest: { ...res.inbox.latest, state: 'acknowledged', reply: 'Got it: sitting', acknowledgedAt: 2000, outcome: 'done', result: 'Sitting on the bench', resultAt: 9000 }, presence: 'working' };
  assert.deepEqual(cardSummary(acked), { messageId: 'm_1', text: 'sit down', state: 'acknowledged', ackText: 'Got it: sitting', resultText: 'Sitting on the bench', outcome: 'done',
    sentAt: 1000, ackAt: 2000, resultAt: 9000, presence: 'working', queued: 1, connected: true });
  assert.equal(cardSummary(null).messageId, null);
});

test('god card uses the GodPanel route as the dev world owner', () => {
  const { url, init } = sendGodCardRequest({ base, text: 'build a well' });
  assert.equal(url, `${base}/v1/god/inbox`); assert.equal(init.headers.authorization, 'Bearer dev:admin');
  assert.equal(godCardViewRequest({ base }).init.method, 'GET');
  assert.match(godOnboardingText(base), /\/god\/SKILL\.md \(register with dev:admin and mint/);
});
