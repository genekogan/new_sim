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
test('vocabulary: several matches prefer the obvious one (nearest, with the others named); unknown names get did_you_mean', () => {
 const shore = resolveCapability('walk:shore', ctx());assert.equal(shore.kind, 'alias');assert.equal((shore as any).cap.id, 'walk:shore-bank', 'the nearer of the two');assert.match((shore as any).note, /walk:shore-water/);
 const dining = to('walk:dining-common') as {unknown: string[]};assert.equal(dining.unknown[0], 'walk:social-eden-dining');
 const bogus = resolveCapability('dance:moon', ctx());assert.equal(bogus.kind, 'unknown');assert.match((bogus as any).reason, /No "dance" capability/);assert.ok((bogus as any).didYouMean.some((d: any) => d.id === 'rest:here'), 'real things to do');
 const sit = resolveCapability('sit:here', ctx([-40, 40]));assert.equal(sit.kind, 'alias');assert.equal((sit as any).cap.id, 'rest:here');assert.match((sit as any).note, /No free seat within 30 m/);
 assert.deepEqual(parseCapability('hang out at the deck', new Set(['hang-out'])), {verb: 'hang-out', rest: 'at the deck'});
});
test('vocabulary: everyday sentences become activities (activities/1) and places resolve by name, synonym and description', () => {
 const verbs = new Set(['walk', 'read', 'lie', 'nap', 'sit', 'sit-ground', 'stroll', 'play-piano', 'stand', 'warm-by-fire']);
 assert.equal(parseCapability('find somewhere to read a book', verbs).verb, 'read');assert.equal(parseCapability('find somewhere to read a book', verbs).rest, '');
 assert.equal(parseCapability('read a book in the library', verbs).verb, 'read');
 assert.equal(parseCapability('lie down', verbs).verb, 'lie');assert.equal(parseCapability('take a nap on the grass', verbs).verb, 'nap');
 assert.equal(parseCapability('sit down', verbs).verb, 'sit');assert.equal(parseCapability('take a seat', verbs).verb, 'sit');assert.equal(parseCapability('sit on the grass', verbs).verb, 'sit-ground');
 assert.equal(parseCapability('take a walk through the park', verbs).verb, 'stroll');assert.equal(parseCapability('come back to the fire', verbs).verb, 'walk');
 assert.equal(parseCapability('play the piano', verbs).verb, 'play-piano');
 const here = (id: string, verb: string): EdgeCapability => ({id, verb, label: id, available: true});
 const park = {id: 'region-park', name: 'Park with pond', center: [-5, 114] as [number, number], parent: 'eden', kind: 'outdoor', walkable: true, description: 'A green park round an oval pond with reeds, a ring path and benches; a white gazebo'};
 const gazebo = {id: 'region-park.gazebo', name: 'Park gazebo', center: [-28, 110] as [number, number], parent: 'region-park', kind: 'pavilion', walkable: true};
 const woods = {id: 'eden-north-woods', name: 'Northern woodland', center: [5, -47] as [number, number], parent: 'eden', kind: 'outdoor', walkable: true};
 const fire = {id: 'social-eden-fire-circle', name: 'Campfire clearing', center: [24, -7] as [number, number], parent: 'field', kind: 'outdoor', walkable: true};
 const ps = [...places, park, gazebo, woods, fire];
 const cs: EdgeCapability[] = [...caps, ...[park, gazebo, woods].map(p => P('walk', p.id, p.name)), {id: 'stroll:region-park', verb: 'stroll', label: 'Stroll through Park with pond', available: true, target: {id: 'region-park', kind: 'place'}},
  here('sit:here', 'sit'), here('lie:here', 'lie'), here('nap:here', 'nap'), here('read:here', 'read'), {id: 'read:eden-library-1', verb: 'read', label: 'Read a book in Library', available: true, target: {id: 'eden-library-1', kind: 'place'}}, here('wander:here', 'wander')];
 const c2: VocabContext = {...ctx(), caps: cs, places: ps, target: c => {const p = ps.find(x => x.id === c.target?.id); return p ? {names: [p.name], around: [], at: p.center} : ctx().target(c);}};
 const go = (s: string) => {const r = resolveCapability(s, c2); return r.kind === 'unknown' ? 'unknown: ' + r.reason : r.cap.id;};
 assert.equal(go('sit down'), 'sit:here');assert.equal(go('take a seat'), 'sit:here');assert.equal(go('lie down'), 'lie:here');assert.equal(go('take a nap'), 'nap:here');
 assert.equal(go('find somewhere to read a book'), 'read:here');assert.equal(go('read a book in the library'), 'read:eden-library-1');
 assert.equal(go('walk:park'), 'walk:region-park', 'the park, not its gazebo');assert.equal(go('go to the park'), 'walk:region-park');
 assert.equal(go('take a walk through the park'), 'stroll:region-park');assert.equal(go('stroll'), 'wander:here');
 assert.equal(go('walk to the woods'), 'walk:eden-north-woods', 'synonym woods → woodland');assert.equal(go('walk:forest'), 'walk:eden-north-woods');
 assert.equal(go('come back to the fire'), 'walk:social-eden-fire-circle');assert.equal(go('walk:campfire'), 'walk:social-eden-fire-circle');
 assert.equal(go('walk:gazebo'), 'walk:region-park.gazebo');
});
test('vocabulary (audit P0a): "go for a X" resolves X; rides join the balloon; unsupported motions are refused honestly', () => {
 const join: EdgeCapability = {id: 'object:ride-eden-balloon:join', verb: 'object', label: 'Take a ride: walk to the boarding step and climb into the basket (Red balloon)', available: true, object: 'ride-eden-balloon', action: 'join'};
 const here = (id: string, verb: string): EdgeCapability => ({id, verb, label: id, available: true});
 const cs = [...caps, join, here('wander:here', 'wander'), here('dance:here', 'dance'), here('situps:here', 'situps'), here('pushups:here', 'pushups'), here('jumping-jacks:here', 'jumping-jacks'), here('nap:here', 'nap'), here('wave:s_moss', 'wave')];
 const c3: VocabContext = {...ctx(), caps: cs};
 const go = (s: string) => {const r = resolveCapability(s, c3); return r.kind === 'unknown' ? 'unknown' : r.cap.id;};
 assert.equal(go('go for a swim'), 'swim:shore-water');assert.equal(go('go for a walk'), 'wander:here');assert.equal(go('take a nap'), 'nap:here');
 assert.equal(go('go for a balloon ride'), join.id);assert.equal(go('ride the balloon'), join.id);assert.equal(go('fly in the balloon'), join.id);assert.equal(go('take a ride'), join.id);
 for (const s of ['go for a run', 'run to the deck', 'jog around', 'give Moss a hug', 'go for a jog']) {const r = resolveCapability(s, c3);assert.equal(r.kind, 'unknown', s);}
 assert.match((resolveCapability('go for a run', c3) as any).reason, /cannot run yet/);
 assert.equal(go('do some sit-ups'), 'situps:here');assert.equal(go('do push ups'), 'pushups:here');assert.equal(go('jumping jacks'), 'jumping-jacks:here');assert.equal(go('dance'), 'dance:here');
});
