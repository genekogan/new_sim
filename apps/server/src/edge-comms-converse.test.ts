// C6: private, membership-based conversations.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {EDGE_CONTRACT} from './edge/contract.ts';
import {commsFixture} from './edge/comms/testing.ts';

const kinds = (events: any[], prefix = 'conversation.') => events.filter(e => e.kind.startsWith(prefix));

async function trio() {
  const f = commsFixture(['Alice', 'Bob', 'Cleo', 'Dan']);
  f.at('Alice', 0, 0); f.at('Bob', 3, 0); f.at('Cleo', 0, 4); f.at('Dan', 30, 0);
  return f;
}

test('start invites only Souls within 6 m; the invitee receives the opening line', async () => {
  const f = await trio();
  try {
    const far = await f.post('Alice', '/v1/edge/converse', {op: 'start', with: [f.id('Dan')]});
    assert.equal(far.status, 200); assert.equal(far.body.contract, EDGE_CONTRACT);
    assert.equal(far.body.accepted, false); assert.equal(far.body.code, 'conversation.out-of-range');
    assert.equal((await f.post('Alice', '/v1/edge/converse', {op: 'start', with: [f.id('Alice')]})).body.code, 'conversation.self');
    assert.equal((await f.post('Alice', '/v1/edge/converse', {op: 'start', with: ['s_ghost']})).body.code, 'soul.unknown');
    assert.equal((await f.post('Alice', '/v1/edge/converse', {op: 'start', with: []})).status, 400);
    assert.equal((await f.post('Alice', '/v1/edge/converse', {op: 'dance', conversation: 'cv_x'})).status, 400);
    const ok = await f.post('Alice', '/v1/edge/converse', {op: 'start', with: [f.id('Bob')], text: 'Got a minute?'});
    assert.equal(ok.body.accepted, true);
    assert.match(ok.body.conversation.id, /^cv_/);
    assert.deepEqual(ok.body.conversation.members, [{soulId: 's_alice', name: 'Alice'}]);
    assert.deepEqual(ok.body.conversation.invited, [{soulId: 's_bob', name: 'Bob'}]);
    const invite = kinds((await f.drain('Bob')).events);
    assert.deepEqual(invite.map(e => [e.kind, e.conversation, e.from.name, e.text, e.untrusted]), [['conversation.invite', ok.body.conversation.id, 'Alice', 'Got a minute?', true]]);
    assert.equal(kinds((await f.drain('Cleo')).events).length, 0);
  } finally { f.destroy(); }
});

test('only members receive turns, even a non-member standing right beside them', async () => {
  const f = await trio();
  try {
    const cv = (await f.post('Alice', '/v1/edge/converse', {op: 'start', with: [f.id('Bob')]})).body.conversation.id;
    const acc = await f.post('Bob', '/v1/edge/converse', {op: 'accept', conversation: cv});
    assert.equal(acc.body.accepted, true); assert.equal(acc.body.conversation.members.length, 2);
    assert.deepEqual(kinds((await f.drain('Alice')).events).map(e => [e.kind, e.change, e.soul.name]), [['conversation.member', 'joined', 'Bob']]);
    const said = await f.post('Alice', '/v1/edge/converse', {op: 'say', conversation: cv, text: 'just between us'});
    assert.equal(said.body.accepted, true); assert.equal(said.body.heardBy, 1); assert.equal(said.body.turn.seq, 1);
    const turns = kinds((await f.drain('Bob')).events).filter(e => e.kind === 'conversation.turn');
    assert.deepEqual(turns.map(e => [e.turn.from.name, e.turn.text, e.untrusted]), [['Alice', 'just between us', true]]);
    assert.equal(kinds((await f.drain('Cleo')).events).length, 0, 'Cleo is 4 m away but not a member');
    const intrude = await f.post('Cleo', '/v1/edge/converse', {op: 'say', conversation: cv, text: 'hi'});
    assert.equal(intrude.body.accepted, false); assert.equal(intrude.body.code, 'conversation.unknown');
    assert.equal((await f.get('Cleo', `/v1/edge/conversations/${cv}/turns`)).status, 404);
    const hist = await f.get('Bob', `/v1/edge/conversations/${cv}/turns`);
    assert.deepEqual(hist.body.turns.map((t: any) => [t.seq, t.text]), [[1, 'just between us']]);
  } finally { f.destroy(); }
});

test('a nearby third party asks to join and any member admits them; they read only later turns', async () => {
  const f = await trio();
  try {
    const cv = (await f.post('Alice', '/v1/edge/converse', {op: 'start', with: [f.id('Bob')]})).body.conversation.id;
    await f.post('Bob', '/v1/edge/converse', {op: 'accept', conversation: cv});
    await f.post('Alice', '/v1/edge/converse', {op: 'say', conversation: cv, text: 'before Cleo'});
    const listed = await f.get('Cleo', '/v1/edge/conversations');
    assert.deepEqual(listed.body.nearby.map((c: any) => c.id), [cv]);
    assert.equal(listed.body.conversations.length, 0);
    assert.equal((await f.post('Dan', '/v1/edge/converse', {op: 'ask', conversation: cv})).body.code, 'conversation.out-of-range');
    const ask = await f.post('Cleo', '/v1/edge/converse', {op: 'ask', conversation: cv});
    assert.equal(ask.body.accepted, true); assert.equal(ask.body.conversation.role, 'asked');
    assert.ok(kinds((await f.drain('Bob')).events).some(e => e.change === 'asked' && e.soul.name === 'Cleo'));
    assert.equal((await f.post('Cleo', '/v1/edge/converse', {op: 'accept', conversation: cv, soul: f.id('Cleo')})).body.code, 'conversation.not-member');
    const admit = await f.post('Bob', '/v1/edge/converse', {op: 'accept', conversation: cv, soul: f.id('Cleo')});
    assert.equal(admit.body.accepted, true); assert.equal(admit.body.conversation.members.length, 3);
    assert.ok(kinds((await f.drain('Cleo')).events).some(e => e.change === 'joined' && e.soul.name === 'Cleo'));
    await f.post('Bob', '/v1/edge/converse', {op: 'say', conversation: cv, text: 'welcome'});
    assert.deepEqual(kinds((await f.drain('Cleo')).events).filter(e => e.kind === 'conversation.turn').map(e => e.turn.text), ['welcome']);
    const hist = await f.get('Cleo', `/v1/edge/conversations/${cv}/turns`);
    assert.deepEqual(hist.body.turns.map((t: any) => t.text), ['welcome'], 'no turns from before joining');
  } finally { f.destroy(); }
});

test('leaving down to one member closes; declining a lone invitation closes', async () => {
  const f = await trio();
  try {
    const cv = (await f.post('Alice', '/v1/edge/converse', {op: 'start', with: [f.id('Bob')]})).body.conversation.id;
    await f.post('Bob', '/v1/edge/converse', {op: 'accept', conversation: cv});
    const left = await f.post('Bob', '/v1/edge/converse', {op: 'leave', conversation: cv});
    assert.equal(left.body.accepted, true); assert.equal(left.body.conversation.state, 'closed');
    assert.deepEqual(kinds((await f.drain('Alice')).events).slice(-2).map(e => [e.kind, e.change ?? e.reason]), [['conversation.member', 'left'], ['conversation.closed', 'one-member']]);
    assert.equal((await f.post('Alice', '/v1/edge/converse', {op: 'say', conversation: cv, text: 'hello?'})).body.code, 'conversation.closed');
    const cv2 = (await f.post('Alice', '/v1/edge/converse', {op: 'start', with: [f.id('Cleo')]})).body.conversation.id;
    const dec = await f.post('Cleo', '/v1/edge/converse', {op: 'decline', conversation: cv2});
    assert.equal(dec.body.conversation.state, 'closed');
    assert.equal(kinds((await f.drain('Alice')).events).at(-1).reason, 'one-member');
  } finally { f.destroy(); }
});

test('a member silent for 10 minutes drops; the conversation closes at one member', async () => {
  const f = await trio();
  try {
    const cv = (await f.post('Alice', '/v1/edge/converse', {op: 'start', with: [f.id('Bob'), f.id('Cleo')]})).body.conversation.id;
    await f.post('Bob', '/v1/edge/converse', {op: 'accept', conversation: cv});
    await f.post('Cleo', '/v1/edge/converse', {op: 'accept', conversation: cv});
    f.clock.now += 5 * 60_000;
    await f.post('Alice', '/v1/edge/converse', {op: 'say', conversation: cv, text: 'still here'});
    await f.post('Bob', '/v1/edge/converse', {op: 'say', conversation: cv, text: 'me too'});
    f.clock.now += 5 * 60_000 + 1;                      // Cleo silent 10 min
    f.runtime.sweep();
    const after = await f.get('Alice', '/v1/edge/conversations');
    assert.deepEqual(after.body.conversations[0].members.map((m: any) => m.name), ['Alice', 'Bob']);
    assert.ok(kinds((await f.drain('Cleo')).events).some(e => e.change === 'dropped' && e.soul.name === 'Cleo'));
    await f.post('Bob', '/v1/edge/converse', {op: 'say', conversation: cv, text: 'Alice?'});
    f.clock.now += 5 * 60_000 + 1;                       // Alice silent 10 min, Bob only 5
    f.runtime.sweep();
    const bob = kinds((await f.drain('Bob')).events);
    assert.deepEqual(bob.slice(-2).map(e => [e.kind, e.change ?? e.reason]), [['conversation.member', 'dropped'], ['conversation.closed', 'inactive']]);
  } finally { f.destroy(); }
});

test('an unanswered invitation expires after the timeout', async () => {
  const f = await trio();
  try {
    const cv = (await f.post('Alice', '/v1/edge/converse', {op: 'start', with: [f.id('Bob')]})).body.conversation.id;
    f.clock.now += 10 * 60_000 + 1;
    f.runtime.sweep();
    assert.equal(kinds((await f.drain('Bob')).events).at(-1).reason, 'invite-expired');
    assert.equal((await f.post('Bob', '/v1/edge/converse', {op: 'accept', conversation: cv})).body.code, 'conversation.unknown');
  } finally { f.destroy(); }
});

test('conversations and turns survive a restart', async () => {
  const first = await trio();
  const cv = (await first.post('Alice', '/v1/edge/converse', {op: 'start', with: [first.id('Bob')]})).body.conversation.id;
  await first.post('Bob', '/v1/edge/converse', {op: 'accept', conversation: cv});
  await first.post('Alice', '/v1/edge/converse', {op: 'say', conversation: cv, text: 'one'});
  first.close();
  const again = commsFixture(['Alice', 'Bob', 'Cleo', 'Dan'], {}, {dir: first.dir, db: first.db, clock: first.clock});
  try {
    const said = await again.post('Bob', '/v1/edge/converse', {op: 'say', conversation: cv, text: 'two'});
    assert.equal(said.body.accepted, true); assert.equal(said.body.turn.seq, 2);
    const hist = await again.get('Alice', `/v1/edge/conversations/${cv}/turns`);
    assert.deepEqual(hist.body.turns.map((t: any) => t.text), ['one', 'two']);
  } finally { again.destroy(); }
});
