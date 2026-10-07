// DLG1: dialogue is visible to spectators; faded (absent) Souls cannot be invited; ignored invitations
// tell the inviter quickly; viewers learn the standing fade roster on join and every sweep.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {commsFixture} from './edge/comms/testing.ts';

const pair = (options = {}) => {
  const f = commsFixture(['Alice', 'Bob', 'Cleo'], options);
  f.at('Alice', 0, 0); f.at('Bob', 3, 0); f.at('Cleo', 0, 4);
  const seen: any[] = []; f.runtime.onSpectator(m => seen.push(m));
  return {f, seen};
};

test('say and conversation turns reach spectators with speaker, channel and text', async () => {
  const {f, seen} = pair();
  try {
    await f.post('Alice', '/v1/edge/say', {text: 'Morning, all.'});
    const cv = (await f.post('Alice', '/v1/edge/converse', {op: 'start', with: [f.id('Bob')], text: 'A word?'})).body.conversation.id;
    await f.post('Bob', '/v1/edge/converse', {op: 'accept', conversation: cv});
    await f.post('Bob', '/v1/edge/converse', {op: 'say', conversation: cv, text: 'Of course.'});
    await f.post('Bob', '/v1/edge/converse', {op: 'leave', conversation: cv});
    assert.deepEqual(seen.map(m => [m.type, m.kind]), [['edge', 'speech'], ['edge', 'conversation.turn'], ['edge', 'conversation.start'], ['edge', 'conversation.member'], ['edge', 'conversation.turn'], ['edge', 'conversation.member'], ['edge', 'conversation.closed']]);
    assert.deepEqual([seen[0].from.name, seen[0].text, seen[0].channel.kind], ['Alice', 'Morning, all.', 'earshot']);
    assert.deepEqual([seen[4].turn.from.name, seen[4].turn.text, seen[4].conversation], ['Bob', 'Of course.', cv]);
    assert.deepEqual(seen.filter(m => m.kind === 'conversation.member').map(m => [m.soul.name, m.change]), [['Bob', 'joined'], ['Bob', 'left']]);
  } finally { f.destroy(); }
});

test('an ignored invitation expires after 2 minutes and the inviter hears invite-expired', async () => {
  const {f} = pair();
  try {
    const cv = (await f.post('Alice', '/v1/edge/converse', {op: 'start', with: [f.id('Bob')], text: 'Hello?'})).body.conversation.id;
    f.clock.now += 60_000; f.runtime.sweep();
    assert.equal((await f.drain('Alice')).events.filter(e => e.kind.startsWith('conversation.')).length, 0, 'not yet');
    f.clock.now += 60_001; f.runtime.sweep();
    const alice = (await f.drain('Alice')).events.filter(e => e.kind.startsWith('conversation.'));
    assert.deepEqual(alice.map(e => [e.kind, e.change ?? e.reason, e.soul?.name ?? null, e.reason ?? null]), [['conversation.member', 'invite-expired', 'Bob', 'no-answer'], ['conversation.closed', 'invite-expired', null, 'invite-expired']]);
    assert.equal((await f.drain('Bob')).events.at(-1).reason, 'invite-expired');
    assert.equal((await f.post('Bob', '/v1/edge/converse', {op: 'accept', conversation: cv})).body.code, 'conversation.unknown');
  } finally { f.destroy(); }
});

test('faded Souls cannot be invited or hear; a pending invite to one expires at the next sweep; roster for viewers', async () => {
  const {f, seen} = pair({fading: true, conversationTimeoutMs: 3 * 3600_000, inviteTimeoutMs: 3 * 3600_000});  // isolate fading from timeouts
  try {
    f.runtime.sweep();                                        // first sight: everyone green
    assert.deepEqual(f.runtime.spectatorJoin()[0].souls, []);
    const cv = (await f.post('Alice', '/v1/edge/converse', {op: 'start', with: [f.id('Cleo')]})).body.conversation.id;
    f.clock.now += 61 * 60_000;
    await f.post('Alice', '/v1/edge/say', {text: 'Anyone?'});  // Alice acts: stays
    f.runtime.sweep();                                        // Bob and Cleo fade
    assert.equal(f.runtime.fading.status(f.id('Bob'))!.colour, 'gone');
    const refused = (await f.post('Alice', '/v1/edge/converse', {op: 'start', with: [f.id('Bob')]})).body;
    assert.deepEqual([refused.accepted, refused.code], [false, 'soul.faded']);
    assert.match(refused.reason, /Bob faded/);
    const alice = (await f.drain('Alice')).events.filter(e => e.kind.startsWith('conversation.'));
    assert.deepEqual(alice.map(e => [e.conversation, e.change ?? e.reason, e.reason ?? null]), [[cv, 'invite-expired', 'soul.faded'], [cv, 'invite-expired', 'invite-expired']]);
    const said = (await f.post('Alice', '/v1/edge/say', {text: 'Hello?'})).body;
    assert.equal(said.said.heardBy, 0, 'faded neighbours do not hear');
    const join = f.runtime.spectatorJoin();
    assert.deepEqual(join.map(m => [m.type, m.kind]), [['edge', 'fade.roster']]);
    assert.deepEqual((join[0].souls as any[]).map(s => [s.soulId, s.colour]).sort(), [['s_bob', 'gone'], ['s_cleo', 'gone']]);
    assert.ok(seen.some(m => m.kind === 'fade.roster' && (m.souls as any[]).length === 2), 'roster re-broadcast each sweep');
    await f.post('Bob', '/v1/edge/say', {text: 'I am back.'});  // any accepted act reclaims
    assert.equal(f.runtime.fading.status(f.id('Bob'))!.colour, 'green');
    assert.equal((await f.post('Alice', '/v1/edge/converse', {op: 'start', with: [f.id('Bob')]})).body.accepted, true);
  } finally { f.destroy(); }
});
