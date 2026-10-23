// ACCEPT2 brief 10 (VERBS): owner phrases that must reach what the world offers. "lift weights at the gym" away from the gym
// parsed as an unknown verb "lift" (capability.unknown) although the world has a gym; now it names the nearest one. "row a boat
// on the pond" chose a punt the world then refused (punt.unsupported-water); a punt whose bank no longer qualifies is now
// offered as unavailable, so the resolver takes a punt that works.
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveCapability, type VocabContext, type VocabPlace} from './edge/ledger/vocabulary.ts';
import type {EdgeCapability} from './edge/contract.ts';
import {rideKind} from './edge/comms/objects/ride.ts';

const lawn: VocabPlace = {id: 'place-eden-south-lawn', name: 'South lawn', kind: 'outdoor', center: [0, 60]};
const walk: EdgeCapability = {id: 'walk:place-eden-south-lawn', verb: 'walk', label: 'South lawn', available: true, target: {id: lawn.id, kind: 'place'}};
const ctx = (caps: EdgeCapability[], elsewhere?: VocabContext['elsewhere']): VocabContext => ({caps, places: [lawn], root: ['eden'], me: [24, -10], elsewhere,
  target: c => c.target?.id === lawn.id ? {names: [lawn.name], around: [], at: lawn.center} : {names: [], around: ['pond'], at: c.id.includes('57df') ? [-128, 22] : [-3, 117]}});

test('lift weights away from the gym names the nearest gym, never an unknown "lift"', () => {
  const far = ctx([walk], v => v === 'lift-weights' ? {label: 'gym dumbbells', place: 'South lawn', placeId: lawn.id, distance: 318.2} : undefined);
  for (const words of ['lift weights at the gym', 'lift weights', 'do some weight lifting']) {
    const r = resolveCapability(words, far);
    assert.equal(r.kind, 'unknown', words);
    if (r.kind === 'unknown') {
      assert.doesNotMatch(r.reason, /No "lift" capability/, words);
      assert.match(r.reason, /The nearest is gym dumbbells in South lawn, about 318 m away: walk there first \(walk:place-eden-south-lawn\)/, words);
    }
  }
  // within offer reach but not offered: the only gym spot is taken (ACCEPT2 C8/C10: the other agent was lifting there)
  const busy = resolveCapability('lift weights at the gym', ctx([walk], v => v === 'lift-weights' ? {label: 'gym dumbbells', place: 'South lawn', placeId: lawn.id, distance: 99} : undefined));
  assert.equal(busy.kind, 'unknown'); if (busy.kind === 'unknown') assert.match(busy.reason, /^Lift weights \(dumbbell curls\) is not free right now: the nearest, gym dumbbells in South lawn \(about 99 m away\), is in use by someone/);
  // a world with no weights anywhere says so terminally
  const none = resolveCapability('lift weights at the gym', ctx([walk], v => v === 'lift-weights' ? null : undefined));
  assert.equal(none.kind, 'unknown'); if (none.kind === 'unknown') assert.match(none.reason, /Nothing like it exists anywhere in this world/);
});

test('a punt the world would refuse is offered unavailable; rowing takes the punt that works', () => {
  const view = (blocked?: {code: string; message: string}) => ({def: 'rowing-punt', capacity: 2, phase: 'parked', holding: false, flights: 0, seatsFree: 2, route: {seconds: 180}, door: [0, 0],
    departsInSeconds: null, riders: [], ...(blocked ? {blocked} : {})});
  const state = {carrier: 'punt-a', capacity: 2, phase: 'parked', riders: [], seatsFree: 2, departsInSeconds: null, holding: false, flights: 0, routeSeconds: 180, door: [0, 0] as [number, number], rowing: true};
  const actx = (v: unknown) => ({soul: {soulId: 's_x'}, roles: [], tick: 1, now: 0, nameOf: () => 'x', inPlace: false, carrier: () => v}) as never;
  const bad = rideKind.actions.join.available!(state, actx(view({code: 'punt.unsupported-water', message: 'The boarding plank and both exits need supported dry bank.'})));
  assert.equal(bad?.code, 'ride.blocked'); assert.match(bad!.reason, /cannot be boarded right now: The boarding plank/);
  assert.equal(rideKind.actions.join.available!(state, actx(view())), null);
  const punt = (id: string, available: boolean): EdgeCapability => ({id: `object:ride-${id}:join`, verb: 'object', action: 'join', object: `ride-${id}`, label: 'Board the punt', available});
  const r = resolveCapability('row a boat on the pond', ctx([walk, punt('punt-e_4c5022d6-f0db4e', false), punt('punt-e_57dfe115-11eca4', true)]));
  assert.equal(r.kind, 'alias'); if (r.kind === 'alias') assert.equal(r.cap.id, 'object:ride-punt-e_57dfe115-11eca4:join');
  const koi = (c: EdgeCapability) => ({names: [], around: c.id.includes('4c50') ? ['koi', 'pond'] : ['shore'], at: (c.id.includes('57df') ? [-128, 22] : [-3, 117]) as [number, number]});
  const caps = [walk, {...punt('punt-e_4c5022d6-f0db4e', false), blocked: {code: 'ride.blocked', reason: 'This punt cannot be boarded right now: no dry bank.'}}, punt('punt-e_57dfe115-11eca4', true)];
  const g = resolveCapability('row a boat on the pond', {...ctx(caps), target: koi});
  assert.equal(g.kind, 'alias'); if (g.kind === 'alias') {assert.equal(g.cap.id, 'object:ride-punt-e_57dfe115-11eca4:join'); assert.match(g.note, /punt-e_4c5022d6-f0db4e:join cannot be boarded right now \(This punt cannot be boarded right now: no dry bank\)/);}
  const k = resolveCapability('row on the koi pond', {...ctx(caps), target: koi});
  assert.equal(k.kind, 'unknown'); if (k.kind === 'unknown') {assert.equal(k.code, 'ride.blocked'); assert.match(k.reason, /object:ride-punt-e_57dfe115-11eca4:join \(Board the punt\) can; nothing else was chosen/);}
});

test('feed the ducks away from a duck bank names the nearest bank instead of saying there are no ducks', () => {
  const bank = (distance: number) => ctx([walk], v => v === 'feed-birds' ? {label: 'the bank of land park pond', place: 'Park pond', placeId: 'land-park-pond', distance} : undefined);
  const far = resolveCapability('feed the ducks', bank(320));
  assert.equal(far.kind, 'unknown'); if (far.kind === 'unknown') {
    assert.doesNotMatch(far.reason, /no ducks or birds/); assert.match(far.reason, /The nearest is the bank of land park pond in Park pond, about 320 m away: walk there first \(walk:land-park-pond\)/);
  }
  const busy = resolveCapability('feed the ducks', bank(60));
  assert.equal(busy.kind, 'unknown'); if (busy.kind === 'unknown') assert.match(busy.reason, /^Feeding the ducks is not free right now: .*about 60 m away\), is in use by someone/);
  const none = resolveCapability('feed the ducks', ctx([walk], v => v === 'feed-birds' ? null : undefined));
  assert.equal(none.kind, 'unknown'); if (none.kind === 'unknown') assert.match(none.reason, /There are no ducks or birds to feed here.*Nothing like it exists anywhere in this world/);
});
