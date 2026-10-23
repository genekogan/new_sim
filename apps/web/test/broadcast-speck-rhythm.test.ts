// DIRECTOR2: a speck shot is left after EMPTY_SECONDS, but never sooner than MIN_CUT after its own cut (cut pair < 6 s in run2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leaveSpeck } from '../src/WorldBroadcast.ts';
import { MIN_CUT } from '../src/WorldDirector.ts';

test('DIRECTOR2: a speck framing waits for the cut rhythm before the director leaves it', () => {
  assert.equal(leaveSpeck(2, 2.5), false, 'cut to 2.5 s ago: stay');
  assert.equal(leaveSpeck(2, MIN_CUT), true, 'held MIN_CUT: leave');
  assert.equal(leaveSpeck(.5, 20), false, 'small only a moment: stay');
});
