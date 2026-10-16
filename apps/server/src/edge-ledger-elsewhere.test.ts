// r3 resident-quality battery (cases 23, 29): refusals that sent an agent wandering. "ride a bike" / "go on the swings" in a
// world with no dock or swing anywhere say so terminally; when one exists beyond offer reach, the refusal names the nearest
// and where it is (walk there first). Callers without world knowledge keep the old place-specific wording.
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveCapability, type VocabContext, type VocabPlace} from './edge/ledger/vocabulary.ts';
import type {EdgeCapability} from './edge/contract.ts';
import {edenNavWorld, WORLD_SPOTS} from '../test/eden-nav-fixture.ts';

const park: VocabPlace = {id: 'region-park', name: 'Park with pond', kind: 'outdoor', center: [-20, 40]};
const places = [park];
const walk: EdgeCapability = {id: 'walk:region-park', verb: 'walk', label: 'Park with pond', available: true, target: {id: park.id, kind: 'place'}};
const ctx = (elsewhere?: VocabContext['elsewhere']): VocabContext => ({caps: [walk], places, root: ['eden'], me: [14, 4], elsewhere,
  target: c => {const p = places.find(x => x.id === c.target?.id); return {names: p ? [p.name] : [], around: [], at: p?.center ?? null};}});

test('spot-based refusals: terminal when none exists in this world, the nearest named when it is out of reach', () => {
  const none = ctx(() => null);
  const bike = resolveCapability('ride a bike', none);
  assert.equal(bike.kind, 'unknown'); if (bike.kind === 'unknown') {assert.equal(bike.code, 'bike.no-dock'); assert.match(bike.reason, /no bicycles anywhere in this world/); assert.match(bike.reason, /walking somewhere else to look for it will not help/);}
  for (const words of ['go on the swings', 'go play on the swings', 'play on the see-saw', 'lie in a hammock']) {
    const r = resolveCapability(words, none);
    assert.equal(r.kind, 'unknown', words); if (r.kind === 'unknown') assert.match(r.reason, /Nothing like it exists anywhere in this world/, words);
  }
  const far = ctx(verb => ({label: verb === 'cycle' ? 'Park gate bicycle dock' : 'Swing 1', place: 'Park with pond', placeId: 'region-park', distance: 412.4}));
  const b2 = resolveCapability('ride a bike', far);
  assert.equal(b2.kind, 'unknown'); if (b2.kind === 'unknown') {assert.match(b2.reason, /nearest is Park gate bicycle dock in Park with pond, about 412 m away: walk there first \(walk:region-park\), then ask again/); assert.doesNotMatch(b2.reason, /anywhere in this world/);}
  const s2 = resolveCapability('go on the swings', far);
  assert.equal(s2.kind, 'unknown'); if (s2.kind === 'unknown') assert.match(s2.reason, /^There is no swing offered here right now\. The nearest is Swing 1 in Park with pond/);
  // not spot-based (undefined) or no world knowledge: the place-specific wording is unchanged
  for (const c of [ctx(), ctx(() => undefined)]) {
    const old = resolveCapability('go on the swings', c);
    assert.equal(old.kind, 'unknown'); if (old.kind === 'unknown') assert.equal(old.reason, 'There is no swing offered here right now.');
  }
  // things that exist nowhere by definition keep their terminal wording
  const ducks = resolveCapability('feed the ducks', none);
  assert.equal(ducks.kind, 'unknown'); if (ducks.kind === 'unknown') assert.match(ducks.reason, /koi.*Nothing like it exists anywhere/);
});

test('ledger: CN5 Eden (no dock, no swing anywhere) refuses terminally; the World spots still offer both', {timeout: 600000}, async t => {
  const w = await edenNavWorld(1, {cn5: true}); t.after(() => {w.f.host.stop(); w.f.db.close();});
  const [a] = w.souls;
  const bike = await w.act(a, 'ride a bike') as {accepted: boolean; code?: string; reason?: string};
  assert.equal(bike.accepted, false); assert.equal(bike.code, 'bike.no-dock'); assert.match(bike.reason ?? '', /no bicycles anywhere in this world.*will not help/);
  const swing = await w.act(a, 'go on the swings') as {accepted: boolean; reason?: string};
  assert.equal(swing.accepted, false); assert.match(swing.reason ?? '', /Nothing like it exists anywhere in this world/);
  const v = await edenNavWorld(1, {cn5: true, spots: WORLD_SPOTS}); t.after(() => {v.f.host.stop(); v.f.db.close();});
  const [b] = v.souls;
  for (const words of ['go on the swings', 'ride a bike']) {
    const r = await v.act(b, words) as {accepted: boolean; reason?: string};
    assert.equal(r.accepted, true, words + ' ' + JSON.stringify(r));
  }
});

test('"pick up a book and give it to X" does the pick-up and says to act again for the give (case 35)', () => {
  const book: EdgeCapability = {id: 'pick-up:book', verb: 'pick-up', label: 'Pick up a book (a shelf in Library stacks, 57 m)', available: true};
  const c: VocabContext = {...ctx(), caps: [walk, book]};
  for (const words of ['pick up a book and give it to Liora Venn', 'pick up a book, and hand it to Liora Venn']) {
    const r = resolveCapability(words, c);
    assert.notEqual(r.kind, 'unknown', words); if (r.kind === 'unknown') continue;
    assert.equal(r.cap.id, 'pick-up:book'); assert.match((r as {note: string}).note, /Doing the first part now; act again for "(give|hand) it to Liora Venn" when its receipt completes/);
  }
  // an "and" that is not a second give step is untouched
  const one = resolveCapability('pick up a book and a pen', c);
  assert.ok(one.kind === 'unknown' || !/act again/.test((one as {note?: string}).note ?? ''));
});
