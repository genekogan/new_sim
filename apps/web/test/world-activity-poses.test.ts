import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACTIVITY_OVERLAYS, activityBase, activityFrame, makeProp, propFor, PROPS } from '../../../mars/viewer/app/engine-view/activity-poses.ts';

// ACTIVITIES-v1 §2 ids (Core mars:pose_v1) plus the exercise cycles the viewer draws when Core publishes them.
const OVERLAYS = ['read', 'browse', 'write', 'play-piano', 'play-music', 'paint', 'eat', 'drink', 'cook', 'play-game', 'craft', 'post-letter'];
// World-proposed overlay ids (CONTRACTS/proposals WORLD-EVENTS, WORLD-COMPUTERS): drawn now, offered once Core adds them.
const PROPOSED = ['use-computer', 'sing', 'listen'], GESTURES = ['bow', 'clap', 'nod', 'shake-head', 'cheer', 'point', 'pick-up', 'put-down', 'hug', 'handshake', 'high-five'], PROPOSED_MOVES = ['play-volleyball', 'play-petanque', 'play-frisbee', 'pull-ups', 'dips', 'bench-press', 'lift-weights'];
const WHOLE = ['lie', 'nap'], CYCLES = ['jumping-jacks', 'jump', 'dance', 'stretch', 'yoga', 'pushups', 'situps'];

test('every contract overlay layers on its base and has hand goals over time; props follow the contract', () => {
  for (const id of [...OVERLAYS, ...PROPOSED]) {
    assert.ok(ACTIVITY_OVERLAYS.has(id), id);
    assert.equal(activityBase(id, 'sit'), 'sit');assert.equal(activityBase(id), 'idle');assert.equal(activityBase(id, 'sit-ground'), 'sit-ground');
    for (const t of [0, 1.3, 7.9, 120]) {
      const f = activityFrame(id, 'sit', t, 'soul-a')!;
      assert.ok(f && f.hands && (f.hands[0] || f.hands[1]), id);
      for (const h of f.hands!) if (h) for (const v of h) assert.ok(Number.isFinite(v) && Math.abs(v) < 1.3, `${id} ${h}`);
    }
  }
  assert.equal(propFor('read'), 'book');assert.equal(propFor('drink'), 'cup');assert.equal(propFor('read', 'letter'), 'letter');assert.equal(propFor('read', 'sword'), 'book');assert.equal(propFor('play-piano'), null);
  for (const p of PROPS) assert.ok(makeProp(p).children.length > 0, p);
});

test('whole-body and exercise ids lay out or move the body; random access is a pure function of time and id', () => {
  for (const id of WHOLE) assert.equal(activityFrame(id, id, 3, 'x')!.lying!.face, 'back');
  assert.equal(activityFrame('pushups', 'pushups', 3, 'x')!.lying!.face, 'front');
  const jj = [0, .2, .4, .6].map((t) => activityFrame('jumping-jacks', 'idle', t, 'x')!);
  assert.ok(Math.max(...jj.map((f) => f.feetOut)) - Math.min(...jj.map((f) => f.feetOut)) > .1, 'legs open and close');
  for (const id of GESTURES) { assert.ok(ACTIVITY_OVERLAYS.has(id), id); assert.ok(activityFrame(id, 'idle', 1.7, 'q'), id); }
  for (const id of PROPOSED_MOVES) assert.ok(activityFrame(id, 'idle', 2.5, 'q')?.hands, id);
  for (const id of CYCLES) assert.deepEqual(activityFrame(id, 'idle', 5.5, 'q'), activityFrame(id, 'idle', 5.5, 'q'));
  assert.equal(activityFrame('idle', 'idle', 1, 'x'), null);assert.equal(activityFrame('walk', 'walk', 1, 'x'), null);
});

test('World activity spots: well-formed, unique, facing their furniture, on the contract', () => {
  const d = JSON.parse(readFileSync(new URL('../../../worlds/eden/activity-spots.v1.json', import.meta.url), 'utf8'));
  assert.equal(d.contract, 'activity-spots/1');assert.equal(d.world, 'eden');
  const ids = new Set<string>();
  for (const s of d.spots) {
    assert.ok(!ids.has(s.id), 'unique ' + s.id);ids.add(s.id);
    assert.ok([...OVERLAYS, ...PROPOSED, ...PROPOSED_MOVES, ...WHOLE, ...CYCLES].includes(s.activity), s.id);assert.ok(['sit', 'idle', 'lie', 'nap'].includes(s.base), s.id);
    const dist = Math.hypot(s.faceTo[0] - s.at[0], s.faceTo[1] - s.at[1]);assert.ok(dist > .3 && dist < 3.5, s.id + ' ' + dist);
    if (s.base === 'sit') assert.ok(s.seatHeight >= .2 && s.seatHeight <= 1.2, s.id);
  }
  assert.ok(d.spots.some((s: { activity: string }) => s.activity === 'paint') && d.spots.some((s: { activity: string }) => s.activity === 'play-piano') && d.shelves.length >= 4);
});
