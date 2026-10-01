// The starting vocabulary: words the world begins with. All of it is data, and
// all of it could have been minted; none of it is known to the kernel.
import { cardHash } from './cards.ts';
import type { Card, KState, LinkKind, Manner } from './types.ts';

export const BASE_KINDS: Record<string, { summary: string }> = {
  soul: { summary: 'an inhabitant' },
  region: { summary: 'a large area of the world' },
  place: { summary: 'somewhere one can be: a bench, the campfire, the kiosk' },
  gathering: { summary: 'people together for a while, hosted by someone' },
};
export const BASE_LINKS: Record<string, LinkKind> = {
  said: { summary: 'last spoke to (made only by saying; lapses after two minutes)' },
  asked: { summary: 'has an open question to (made only by asking; closed by an answer, or after two minutes)' },
  knows: { summary: 'has met and talked with', mutual: true },
  hosts: { summary: 'is the host of', control: true },
  attends: { summary: 'is taking part in' },
  agreed: { summary: 'said yes to a request from (made only by saying yes; stands for thirty minutes)' },
  made: { summary: 'brought into being', control: true },
  holds: { summary: 'has in hand or in care', control: true },
};
export const BASE_MANNERS: Record<string, Manner> = {
  warmly: { summary: 'open, kind, glad to see people' },
  shyly: { summary: 'hesitant, soft-spoken, keeps a little distance' },
  boldly: { summary: 'direct, confident, takes the initiative' },
  playfully: { summary: 'teasing, light, looking for fun' },
  calmly: { summary: 'unhurried, steady, quiet' },
  curiously: { summary: 'asking questions, wanting to find out' },
  wearily: { summary: 'tired, brief, wanting rest' },
  grandly: { summary: 'theatrical, expansive, for an audience' },
};

// One play of a talking card is a whole exchange (both voices are rendered from it), so two people who have just spoken
// do not start another until what was said has faded (two minutes). Without this, each reply provokes a reply for ever.
const QUIET: Card['when'] = [{ notLinked: ['said', '$actor', '$target'] }, { notLinked: ['said', '$target', '$actor'] }];

export const BASE_CARDS: Card[] = [
  { name: 'go to', summary: 'Walk to a place and be there', good_when: 'the intent names that place, or something is happening there', not_for: 'no reason to move',
    target: { kind: 'place' }, when: [{ notAt: ['$actor', '$target'] }, { notState: ['$actor', 'hosting', true] }], then: [{ move: ['$actor', '$target'] }, { set: ['$actor', 'doing', 'arriving'] }],
    approach: [{ verb: 'walk_to', params: { to: '$target', standoff: 1.2 } }], during: [{ verb: 'rest', params: { seconds: 15 } }], takes: 'minute' },
  { name: 'rest', summary: 'Rest where you are for a while', good_when: 'energy is low or the Soul wants quiet', not_for: 'energetic and something interesting is going on',
    target: null, when: [], then: [{ set: ['$actor', 'doing', 'resting'] }], approach: [], during: [{ verb: 'rest', params: { seconds: 90 } }], takes: 'minutes' },
  { name: 'wait', summary: 'Stay where you are and wait', good_when: 'waiting for someone to answer, or for something to begin', not_for: 'nothing to wait for',
    target: null, when: [], then: [{ set: ['$actor', 'doing', 'waiting'] }], approach: [], during: [{ verb: 'rest', params: { seconds: 20 } }], takes: 'seconds' },
  { name: 'wander', summary: 'Drift around the area with no aim', good_when: 'no intent and nothing nearby appeals', not_for: 'the intent names something specific',
    target: null, when: [{ notState: ['$actor', 'hosting', true] }], then: [{ move: ['$actor', '$region'] }, { set: ['$actor', 'doing', 'wandering'] }], approach: [], during: [{ verb: 'ambient_wander', params: { seconds: 60, radius: 14 } }], takes: 'minute' },
  { name: 'greet', summary: 'Greet someone who is here', good_when: 'someone new is close', not_for: 'already talking with them',
    target: { kind: 'soul', same_place: true }, when: [{ notLinked: ['said', '$actor', '$target'] }], then: [{ say: ['$actor', '$target', 'greet'] }],
    approach: [{ verb: 'walk_to', params: { to: '$target', standoff: 1.6 } }], during: [{ verb: 'wave', params: { at: '$target', seconds: 2 } }], takes: 'seconds' },
  { name: 'talk with', summary: 'Go to someone and have a conversation', good_when: 'the Soul wants company or the intent names them', not_for: 'the Soul wants to be alone',
    target: { kind: 'soul' }, when: [{ notState: ['$actor', 'hosting', true] }, ...QUIET], then: [{ move: ['$actor', '$target.at'] }, { say: ['$actor', '$target', 'chat'] }, { link: ['knows', '$actor', '$target'] }, { set: ['$actor', 'doing', 'talking with $target.name'] }],
    approach: [{ verb: 'walk_to', params: { to: '$target', standoff: 1.3 } }], during: [{ verb: 'converse', params: { with: '$target', seconds: 30 } }], takes: 'minute' },
  { name: 'chat', summary: 'Talk with someone who is right here, without going anywhere', good_when: 'someone is here and the Soul feels like talking, or is hosting and wants to welcome them', not_for: 'the Soul wants quiet',
    target: { kind: 'soul', same_place: true }, when: [...QUIET], then: [{ say: ['$actor', '$target', 'chat'] }, { link: ['knows', '$actor', '$target'] }, { set: ['$actor', 'doing', 'talking with $target.name'] }],
    approach: [{ verb: 'walk_to', params: { to: '$target', standoff: 1.3 } }], during: [{ verb: 'converse', params: { with: '$target', seconds: 20 } }], takes: 'seconds' },
  { name: 'say yes', summary: 'Agree to what someone just asked', good_when: 'someone asked for something reasonable and the Soul is willing', not_for: 'the request goes against the Soul’s nature',
    target: { kind: 'soul', same_place: true }, when: [{ linked: ['asked', '$target', '$actor'] }],
    then: [{ say: ['$actor', '$target', 'agree'] }], approach: [], during: [{ verb: 'wave', params: { at: '$target', seconds: 2 } }], takes: 'seconds' },
  { name: 'say no', summary: 'Decline what someone just asked', good_when: 'the request does not suit the Soul or the moment', not_for: 'a harmless request the Soul would enjoy granting',
    target: { kind: 'soul', same_place: true }, when: [{ linked: ['asked', '$target', '$actor'] }],
    then: [{ say: ['$actor', '$target', 'decline'] }], approach: [], during: [{ verb: 'rest', params: { seconds: 3 } }], takes: 'seconds' },
  { name: 'host a gathering', summary: 'Start a gathering at this place and invite whoever comes', good_when: 'the Soul likes bringing people together, or the intent is to host or throw a party', not_for: 'already hosting, or wants to be alone',
    target: { kind: 'place' }, when: [{ notState: ['$actor', 'hosting', true] }],
    then: [{ move: ['$actor', '$target'] }, { appear: { kind: 'gathering', name: '$actor.name’s gathering', at: '$target', states: { music: 'off' } }, linkFromActor: 'hosts' }, { link: ['attends', '$actor', '$new'] }, { set: ['$actor', 'hosting', true] }, { set: ['$actor', 'doing', 'hosting a gathering'] }],
    approach: [{ verb: 'walk_to', params: { to: '$target', standoff: 2 } }], during: [{ verb: 'gather', params: { at: '$target', seconds: 240 } }], wants: ['welcome guests', 'arrange a space'], takes: 'minutes' },
  { name: 'join', summary: 'Go to a gathering and take part', good_when: 'a gathering is on and the Soul wants company, or the intent names it', not_for: 'wants to be alone',
    target: { kind: 'gathering' }, when: [{ notLinked: ['attends', '$actor', '$target'] }, { notState: ['$actor', 'hosting', true] }],
    then: [{ move: ['$actor', '$target.at'] }, { link: ['attends', '$actor', '$target'] }, { set: ['$actor', 'doing', 'at $target.name'] }],
    approach: [{ verb: 'walk_to', params: { to: '$target', standoff: 2.5 } }], during: [{ verb: 'gather', params: { at: '$target', seconds: 120 } }], takes: 'minutes' },
  { name: 'leave', summary: 'Leave a gathering you are part of', good_when: 'tired, or it has run its course', not_for: 'enjoying it',
    target: { kind: 'gathering' }, when: [{ linked: ['attends', '$actor', '$target'] }, { notLinked: ['hosts', '$actor', '$target'] }],
    then: [{ unlink: ['attends', '$actor', '$target'] }, { set: ['$actor', 'doing', 'leaving'] }], approach: [], during: [{ verb: 'stand', params: {} }], takes: 'seconds' },
  { name: 'end the gathering', summary: 'Close a gathering you host', good_when: 'it has run long or everyone has drifted off', not_for: 'it is lively',
    target: { kind: 'gathering' }, when: [{ linked: ['hosts', '$actor', '$target'] }],
    then: [{ vanish: '$target' }, { set: ['$actor', 'hosting', null] }, { set: ['$actor', 'doing', 'winding down'] }], approach: [], during: [{ verb: 'stand', params: {} }], takes: 'seconds' },
  { name: 'perform', summary: 'Sing, dance or tell a story for whoever is near', good_when: 'others are close and the personality enjoys an audience', not_for: 'nobody is near, or shy or tired',
    target: null, when: [], then: [{ set: ['$actor', 'doing', 'performing'] }], approach: [], during: [{ verb: 'perform', params: { seconds: 30 } }], wants: ['sing', 'tell a story'], takes: 'seconds' },
  { name: 'dance', summary: 'Dance at a gathering where music is playing', good_when: 'music is playing and the Soul has energy', not_for: 'tired or withdrawn',
    target: { kind: 'gathering' }, when: [{ linked: ['attends', '$actor', '$target'] }, { state: ['$target', 'music', 'playing'] }],
    then: [{ set: ['$actor', 'doing', 'dancing'] }, { link: ['dancing at', '$actor', '$target'], forSeconds: 120 }], approach: [], during: [{ verb: 'perform', params: { what: 'dance', seconds: 40 } }], wants: ['dance to music'], takes: 'minute' },
];

/** Install the starting vocabulary into a fresh kernel. */
export function seedVocabulary(s: KState): void {
  Object.assign(s.vocab.kinds, BASE_KINDS); Object.assign(s.vocab.links, BASE_LINKS, { 'dancing at': { summary: 'is dancing at' } }); Object.assign(s.vocab.manners, BASE_MANNERS);
  for (const c of BASE_CARDS) s.vocab.cards[c.name] = { ...c, hash: cardHash(c), by: 'world', mintedAt: 0, origin: 'base' };
}
export const BASE_DECK = BASE_CARDS.map((c) => c.name);
