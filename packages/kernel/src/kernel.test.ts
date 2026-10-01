import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAll, bind, cardHash, changesOf, emptyKernel, kernelHash, linked, linksTo, playable, seedVocabulary, validateCard, whyNot, BASE_DECK, type Card, type KState } from './index.ts';

const VERBS = new Set(['walk_to', 'sit', 'stand', 'rest', 'converse', 'gather', 'wave', 'perform', 'ambient_wander']);
function world(): KState {
  const s = emptyKernel(); seedVocabulary(s);
  const mk = (id: string, kind: string, name: string, at: string | null) => assert.equal(applyAll(s, [{ op: 'appear', id, kind, name, at }], 'world').ok, true);
  mk('center', 'region', 'the center', null); mk('campfire', 'place', 'the campfire', 'center'); mk('bench', 'place', 'the bench', 'center');
  for (const n of ['rob', 'wren', 'oda']) { mk(n, 'soul', n[0].toUpperCase() + n.slice(1), 'bench'); s.decks[n] = { cards: [...BASE_DECK], manners: ['warmly'] }; }
  return s;
}
function play(s: KState, actor: string, name: string, target: string | null, manner?: string) {
  const card = s.vocab.cards[name]; assert.ok(card, `card ${name}`);
  assert.equal(whyNot(s, card, actor, target), null, `${actor} plays ${name}`);
  const { changes, nextId } = changesOf(s, card, bind(s, card, actor, target)!, manner);
  const r = applyAll(s, changes, actor); assert.deepEqual(r, { ok: true }); s.nextId = nextId; s.tick += 20;
  return changes;
}

const ASK_DJ: Card = {
  name: 'ask to be the dj', summary: 'Ask the host of a gathering to let you play the music', good_when: 'the intent is to DJ', not_for: 'there is already a DJ',
  target: { kind: 'gathering' }, derive: { host: { link: 'hosts', to: '$target' } },
  when: [{ at: ['$actor', '$target'] }, { noneLinkedTo: ['dj of', '$target'] }, { distinct: ['$actor', '$host'] }],
  then: [{ say: ['$actor', '$host', 'ask'], about: 'being the DJ at $target.name' }],
  approach: [{ verb: 'walk_to', params: { to: '$host', standoff: 1.3 } }], during: [{ verb: 'wave', params: { at: '$host', seconds: 2 } }], takes: 'seconds' };
const BE_DJ: Card = {
  name: 'be the dj', summary: 'Set up and play music at a gathering, once the host has agreed', good_when: 'the host said yes', not_for: 'no agreement yet',
  target: { kind: 'gathering' }, derive: { host: { link: 'hosts', to: '$target' } },
  when: [{ at: ['$actor', '$target'] }, { linked: ['agreed', '$host', '$actor'] }, { noneLinkedTo: ['dj of', '$target'] }],
  then: [{ link: ['dj of', '$actor', '$target'] }, { appear: { kind: 'dj kit', name: 'a DJ kit', at: '$target.at', states: { state: 'playing' } }, linkFromActor: 'made' }, { set: ['$target', 'music', 'playing'] }, { set: ['$actor', 'doing', 'playing music'] }],
  approach: [], during: [{ verb: 'perform', params: { seconds: 60 } }], wants: ['set up equipment', 'dj at a deck'], takes: 'minutes' };

test('coherence: an actor cannot change another Soul, and can only assert its own links', () => {
  const s = world();
  assert.equal(applyAll(s, [{ op: 'set', id: 'rob', key: 'doing', value: 'x' }], 'wren').ok, false);
  assert.equal(applyAll(s, [{ op: 'move', id: 'rob', to: 'campfire' }], 'wren').ok, false);
  assert.equal(applyAll(s, [{ op: 'link', kind: 'agreed', from: 'rob', to: 'wren' }], 'wren').ok, false);
  assert.equal(applyAll(s, [{ op: 'set', id: 'wren', key: 'doing', value: 'x' }], 'wren').ok, true);
  // a batch is atomic
  const h = kernelHash(s);
  assert.equal(applyAll(s, [{ op: 'set', id: 'wren', key: 'a', value: 1 }, { op: 'set', id: 'rob', key: 'a', value: 1 }], 'wren').ok, false);
  assert.equal(kernelHash(s), h);
});

test('validation rejects cards that break the grammar or use verbs the engine lacks', () => {
  const s = world();
  const bad = validateCard({ ...ASK_DJ, name: 'steal the party', then: [{ link: ['hosts', '$host', '$target'] }, { move: ['$host', '$target'] }], during: [{ verb: 'teleport', params: {} }] }, s, VERBS);
  assert.equal(bad.ok, false);
  if (!bad.ok) { assert.ok(bad.problems.some((p) => p.includes('must start from the actor'))); assert.ok(bad.problems.some((p) => p.includes('only its actor'))); assert.ok(bad.problems.some((p) => p.includes('no verb "teleport"'))); }
  assert.equal(validateCard(ASK_DJ, s, VERBS).ok, true);
  assert.equal(validateCard({ ...ASK_DJ, then: [{ appear: { kind: 'soul', name: 'x', at: '$target' } }] }, s, VERBS).ok, false);
});

test('the DJ story: host, join, ask, agree, become the DJ, others dance: all from independent plays', () => {
  const s = world();
  for (const c of [ASK_DJ, BE_DJ]) { const v = validateCard(c, s, VERBS); assert.equal(v.ok, true); s.vocab.cards[c.name] = { ...c, hash: cardHash(c), by: 'wren', mintedAt: s.tick, origin: 'compiled' }; s.decks.wren.cards.push(c.name); }
  s.vocab.links['dj of'] = { summary: 'plays the music at', control: true };
  play(s, 'rob', 'host a gathering', 'campfire');
  const party = Object.values(s.things).find((t) => t.kind === 'gathering')!;
  assert.equal(party.name, 'Rob’s gathering'); assert.equal(party.at, 'campfire');
  assert.ok(linked(s, 'hosts', 'rob', party.id));
  // Wren cannot ask yet (not there), cannot be the DJ (no agreement), nobody can dance (no music)
  assert.match(whyNot(s, s.vocab.cards['ask to be the dj'], 'wren', party.id)!, /condition not met/);
  assert.ok(whyNot(s, s.vocab.cards['dance'], 'oda', party.id));
  play(s, 'wren', 'join', party.id);
  assert.equal(s.things.wren.at, 'campfire');
  const asked = play(s, 'wren', 'ask to be the dj', party.id, 'boldly');
  assert.deepEqual(asked[0], { op: 'say', from: 'wren', to: 'rob', act: 'ask', about: 'being the DJ at Rob’s gathering', manner: 'boldly' });
  assert.ok(whyNot(s, s.vocab.cards['be the dj'], 'wren', party.id), 'still needs Rob to agree');
  // Rob's own options now include answering
  const robCan = playable(s, 'rob', ['wren', 'oda', party.id, 'campfire', 'bench']).map((p) => p.id);
  assert.ok(robCan.includes('say yes@wren') && robCan.includes('say no@wren'));
  play(s, 'rob', 'say yes', 'wren', 'warmly');
  play(s, 'wren', 'be the dj', party.id);
  assert.equal(s.things[party.id].states.music, 'playing');
  assert.equal(linksTo(s, party.id, 'dj of')[0].from, 'wren');
  assert.ok(Object.values(s.things).some((t) => t.kind === 'dj kit' && t.by === 'wren'));
  // now others can dance, once they have joined
  assert.ok(whyNot(s, s.vocab.cards['dance'], 'oda', party.id));
  play(s, 'oda', 'join', party.id); play(s, 'oda', 'dance', party.id); play(s, 'rob', 'dance', party.id);
  assert.equal(s.things.oda.states.doing, 'dancing');
  // Oda cannot stop the music (Wren and Rob control the gathering); a second DJ is not possible
  assert.equal(applyAll(s, [{ op: 'set', id: party.id, key: 'music', value: 'off' }], 'oda').ok, false);
  s.decks.oda.cards.push('be the dj');
  assert.ok(whyNot(s, s.vocab.cards['be the dj'], 'oda', party.id));
  // nobody can simply declare control: Oda has no agreement from Rob or Wren
  s.vocab.links['boss of'] = { summary: 'runs', control: true };
  assert.equal(applyAll(s, [{ op: 'link', kind: 'boss of', from: 'oda', to: party.id }], 'oda').ok, false);
  assert.equal(applyAll(s, [{ op: 'link', kind: 'boss of', from: 'oda', to: 'campfire' }], 'oda').ok, false, 'places made by the world cannot be seized');
  // the host ends it; links to it disappear
  play(s, 'rob', 'end the gathering', party.id);
  assert.equal(s.things[party.id], undefined); assert.equal(linksTo(s, party.id).length, 0);
});

test('changes are deterministic and replayable', () => {
  const run = () => { const s = world(); play(s, 'rob', 'host a gathering', 'campfire'); const p = Object.values(s.things).find((t) => t.kind === 'gathering')!; play(s, 'oda', 'join', p.id); play(s, 'oda', 'talk with', 'rob', 'shyly'); return kernelHash(s); };
  assert.equal(run(), run());
});
