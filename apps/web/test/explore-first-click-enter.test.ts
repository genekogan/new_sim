import test from 'node:test';
import assert from 'node:assert/strict';
import { exploreAvailable, firstExploreResult } from '../src/explore-control.ts';

const live = (loading = false, unavailableReason: string | null = null) => ({ presentation: 'live' as const, loading, unavailableReason });

test('Explore stays mounted through a viewer blip once the live view was ready (V1 first click)', () => {
  // Real-Chrome repro (dev world, server paused 20 s): on reconnect the scene re-mounts and the viewer reports loading,
  // which unmounted Explore twice and closed its open dialog. The control must survive that sequence.
  let seen = false;
  const step = (s: Parameters<typeof exploreAvailable>[1]) => (seen = exploreAvailable(seen, s));
  assert.equal(step(null), false, 'no viewer yet');
  assert.equal(step(live(true)), false, 'not before the first ready frame');
  assert.equal(step(live(false, 'Waiting for a recorded world frame.')), false);
  assert.equal(step(live()), true, 'ready: shown');
  assert.equal(step(live(true)), true, 'a later loading blip keeps it');
  assert.equal(step(live(false, 'Reconnecting to the world.')), true, 'a reconnect keeps it');
  assert.equal(step(live(false, 'No recording covers that moment; displaying the nearest recorded frame.')), true, 'a frame gap keeps it');
  assert.equal(step({ presentation: 'history', loading: false, unavailableReason: null }), false, 'history playback hides it');
  assert.equal(step(live(true)), false, 'and back in live it waits for ready again');
  assert.equal(step(live()), true);
});

test('Enter picks the first shown Explore result: a Soul above locations, else the first location', () => {
  const places = [{ id: 'region:library', label: 'Library' }, { id: 'region:cafe', label: 'Café' }];
  assert.deepEqual(firstExploreResult('lib', [], places), { kind: 'place', id: 'region:library' });
  const ada = { id: 's_ada', name: 'Ada' };
  assert.deepEqual(firstExploreResult('a', [ada], places), { kind: 'soul', soul: ada });
  assert.equal(firstExploreResult('zzz', [], []), null, 'nothing shown: nothing picked');
  assert.equal(firstExploreResult('   ', [ada], places), null, 'an empty search is not a pick');
});
