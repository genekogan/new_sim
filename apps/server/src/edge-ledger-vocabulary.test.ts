// PM-R057: natural names agents actually sent on live 4970 (walk:pond ×37, walk:eden-library-1 ×11, walk:library,
// walk:eden-commons, "hang out at the deck", hang-out:commons-deck[90], …) resolve when unambiguous, else did_you_mean.
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveCapability, parseCapability, type VocabContext, type VocabPlace} from './edge/ledger/vocabulary.ts';
import type {EdgeCapability} from './edge/contract.ts';

const places: VocabPlace[] = [
 {id: 'commons', name: 'Commons gathering lawn', center: [9, 5]}, {id: 'commons-deck', name: 'Presentation deck', center: [9, -2]},
 {id: 'shore-water', name: 'The pond (connected calm water)', center: [-20, 30]}, {id: 'shore-bank', name: 'Connected sloping bank', center: [-15, 25]},
 {id: 'social-eden-fire-circle', name: 'Campfire clearing', center: [24, -7]}, {id: 'social-eden-dining', name: 'Social dining', center: [23, 6]},
 {id: 'eden-classroom-1', name: 'Eden east classroom', center: [42, -6]}, {id: 'eden-library-1', name: 'Library', center: [74, -7]},
 {id: 'region-park.pond', name: 'Park pond', center: [-6, 112]}, {id: 'region-campus.library-annex', name: 'Library annex', center: [-12, -121]},
];
const at = new Map<string, [number, number]>([...places.map(p => [p.id, p.center] as [string, [number, number]]),
 ['eden-classroom-seat-01', [40, -8]], ['social-eden-fire', [24, -7]], ['commons-bench-east', [12, 6]], ['commons-bench-west', [6, 6]], ['s_moss', [2, 2]], ['s_tinker', [3, 1]]]);
const where = new Map([['eden-classroom-seat-01', 'eden-classroom-1'], ['social-eden-fire', 'social-eden-fire-circle'], ['commons-bench-east', 'commons'], ['commons-bench-west', 'commons']]);
const P = (verb: string, id: string, label?: string): EdgeCapability => ({id: `${verb}:${id}`, verb, label: label ?? places.find(p => p.id === id)?.name ?? id, available: true, target: {id, kind: 'place'}});
const O = (verb: string, id: string, label = id, available = true): EdgeCapability => ({id: `${verb}:${id}`, verb, label, available, target: {id, kind: 'object'}});
const caps: EdgeCapability[] = [
 ...['commons', 'commons-deck', 'shore-water', 'shore-bank', 'social-eden-fire-circle', 'social-eden-dining', 'eden-classroom-1'].flatMap(id => [P('walk', id), P('hang-out', id)]),
 O('walk', 'eden-classroom-seat-01'), O('sit', 'eden-classroom-seat-01'), O('sit', 'commons-bench-east'), O('sit', 'commons-bench-west', 'commons-bench-west', false),
 O('warm-by-fire', 'social-eden-fire', 'Warm up by the fire with whoever is there'), {id: 'swim:shore-water', verb: 'swim', label: 'Swim in the supported pond', available: true, target: {id: 'shore-water', kind: 'place'}},
 {id: 'rest:here', verb: 'rest', label: 'Rest here', available: true}, {id: 'go-near:s_moss', verb: 'go-near', label: 'Go near Moss', available: true, target: {id: 's_moss', kind: 'soul'}},
 {id: 'go-near:s_tinker', verb: 'go-near', label: 'Go near Moss the Tinker', available: true, target: {id: 's_tinker', kind: 'soul'}},
];
const ctx = (me: [number, number] = [10, 5]): VocabContext => ({caps, places, root: ['eden'], me, target: c => {
 const t = c.target; if (!t) return {names: [], around: [], at: null};
 const p = places.find(x => x.id === t.id), w = where.get(t.id), wp = w ? places.find(x => x.id === w) : undefined;
 return {names: p ? [p.name] : t.kind === 'soul' ? [c.label.replace('Go near ', '')] : [], around: wp ? [wp.id, wp.name] : [], at: at.get(t.id) ?? null};
}});
const to = (input: string, me?: [number, number]) => {const r = resolveCapability(input, ctx(me)); return r.kind === 'unknown' ? {unknown: r.didYouMean.map(d => d.id)} : r.cap.id;};

test('vocabulary: exact ids win; natural names resolve when unambiguous', () => {
 assert.equal(to('walk:commons'), 'walk:commons');
 assert.equal(to('walk:pond'), 'walk:shore-water', 'pond is the pond');
 assert.equal(to('swim:pond'), 'swim:shore-water');
 assert.equal(to('walk:eden-pond'), 'walk:shore-water', 'the world name is ignored when the rest still names something');
 assert.equal(to('walk:eden-commons'), 'walk:commons');
 assert.equal(to('hang-out:commons-gathering-lawn'), 'hang-out:commons', 'by place name');
 assert.equal(to('hang-out:commons-deck[90]'), 'hang-out:commons-deck', 'bracket junk ignored');
 assert.equal(to('hang out at the deck'), 'hang-out:commons-deck', 'free text verb + words');
 assert.equal(to('go to the deck'), 'walk:commons-deck', 'verb synonym');
 assert.equal(to('warm-by-fire:social-eden-fire-circle'), 'warm-by-fire:social-eden-fire', 'the place an object stands in');
 assert.equal(to('rest'), 'rest:here');assert.equal(to('rest:on-the-grass'), 'rest:here', 'single non-targeted capability');
 assert.equal(to('go-near:Moss'), 'go-near:s_moss', 'exact Soul name beats Moss the Tinker');
 assert.equal(to('sit:commons'), 'sit:commons-bench-east', 'two benches there, only one free');
 assert.equal(to('sit:here', [11, 6]), 'sit:commons-bench-east', 'nearest free seat within reach');
});
test('vocabulary: a known place without a target stands in its nearest whole place within 60 m', () => {
 const lib = resolveCapability('walk:eden-library-1', ctx());assert.equal(lib.kind, 'alias');assert.equal((lib as any).cap.id, 'walk:eden-classroom-1', 'a place, not the nearer seat fixture');assert.match((lib as any).note, /Library is not walkable ground yet/);
 assert.equal(to('walk:library'), 'walk:eden-classroom-1', 'Library (exact name) beats Library annex');
 const far = resolveCapability('walk:region-park.pond', ctx());assert.equal(far.kind, 'unknown');assert.match((far as any).reason, /not walkable ground yet/);
});
test('vocabulary: ambiguous or unknown names are refused with did_you_mean (closest offered first)', () => {
 const shore = to('walk:shore') as {unknown: string[]};assert.deepEqual(shore.unknown.slice(0, 2).sort(), ['walk:shore-bank', 'walk:shore-water']);
 const dining = to('walk:dining-common') as {unknown: string[]};assert.equal(dining.unknown[0], 'walk:social-eden-dining');
 const bogus = to('dance:moon') as {unknown: string[]};assert.equal(bogus.unknown.length, 5);
 const sit = resolveCapability('sit:here', ctx([-40, 40]));assert.equal(sit.kind, 'unknown');assert.match((sit as any).reason, /Nothing free to sit within a few metres/);
 assert.deepEqual(parseCapability('hang out at the deck', new Set(['hang-out'])), {verb: 'hang-out', rest: 'at the deck'});
});
