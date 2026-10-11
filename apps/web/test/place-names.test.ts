import assert from 'node:assert/strict';
import {test} from 'node:test';
import {placeName,doingText,activityWords} from '../src/place-names.ts';
import {connectionLost,arrivalStage,heldLabel} from '../src/viewer-arrival.ts';

test('VF1: ids in a doing line read as human names, never raw ids', () => {
  assert.equal(placeName('commons-bench-east'), 'East bench, Commons gathering lawn');
  assert.equal(placeName('commons-mat-3'), 'Sleeping mat 3');
  assert.equal(placeName('walk:region-park'), placeName('region-park'));
  assert.equal(placeName('lib-armchair-sage'), 'Sage armchair in the library reading corner');
  assert.equal(placeName('social-eden-fire-bench-north', id => id === 'social-eden-fire-bench-north' ? 'Fire Bench North' : null), 'Fire Bench North');
  assert.equal(placeName('social-eden-fire-bench-north'), 'North fire bench');
  assert.equal(doingText('commons-bench-east', 'sit', 's_0123456789'), 'Sitting · East bench, Commons gathering lawn');
  assert.equal(doingText('read:lib-armchair-sage', undefined), 'Reading · Sage armchair in the library reading corner');
  assert.equal(doingText('standing around', 'idle'), 'Standing around');
  assert.equal(doingText(undefined, 'walk'), 'Walking');
  assert.equal(activityWords('mars:sit-ground'), 'Sitting on the grass');
  assert.equal(doingText('Sit down on the nearest free seat (eden-classroom-seat-16, 28 m)', 'walk'), 'Sit down on the nearest free seat (Classroom seat 16, 28 m)');
  assert.equal(doingText('Stroll through region-park', 'walk'), 'Stroll through '+placeName('region-park'));
  assert.equal(doingText('A well-known stroll', 'walk'), 'A well-known stroll');
  for (const raw of ['commons-bench-east', 'commons-table', 'region-park.gazebo', 'eden-library-1', 'xyz-abc-def'])
    assert.doesNotMatch(doingText(raw, 'sit'), /[a-z]-[a-z]/, raw);
});

test('VF1: "Reconnecting" only after a lost open socket stays down past the grace', () => {
  const conn = { stats: { state: 'connecting', reconnects: 0 } };
  assert.equal(connectionLost(conn, 0), false);           // first connect is arriving
  assert.equal(connectionLost(conn, 60_000), false);
  conn.stats.state = 'open'; assert.equal(connectionLost(conn, 61_000), false);
  conn.stats.state = 'closed'; conn.stats.reconnects = 1;
  assert.equal(connectionLost(conn, 62_000), false);      // a blink is invisible
  assert.equal(connectionLost(conn, 64_500), false);
  assert.equal(connectionLost(conn, 65_100), true);
  conn.stats.state = 'open'; assert.equal(connectionLost(conn, 66_000), false);
  assert.equal(arrivalStage(null, true), 'Connecting to the world');
  assert.equal(arrivalStage('Loading the scenery for this recording.', false), 'Loading the scenery');
  assert.equal(heldLabel('Reconnecting; displaying the last recorded frame.'), 'Reconnecting…');
  assert.equal(heldLabel('No recording covers that moment; displaying the nearest recorded frame.'), 'Catching up');
});

test('Arrival card carries the initial-assets progress; nothing measurable shows no bar; failure steps aside', async () => {
  const {arrivalProgress, initialPending} = await import('../src/viewer-arrival.ts');
  const p = (stage: string, more: Partial<{required:number;completed:number;bytesLoaded:number;bytesTotal:number|null}> = {}) =>
    ({generation: 1, stage, required: 0, completed: 0, failed: [], bytesLoaded: 0, bytesTotal: null, ...more}) as Parameters<typeof arrivalProgress>[0];
  assert.equal(arrivalProgress(null), null);
  assert.equal(arrivalProgress(p('waiting')), null);
  assert.equal(arrivalProgress(p('downloading')), null);
  assert.equal(arrivalProgress(p('downloading', {bytesLoaded: 25, bytesTotal: 100, required: 4, completed: 3})), 0.25);
  assert.equal(arrivalProgress(p('downloading', {required: 4, completed: 1})), 0.25);
  assert.equal(arrivalProgress(p('downloading', {bytesLoaded: 150, bytesTotal: 100})), 1);
  assert.equal(arrivalProgress(p('preparing', {required: 4, completed: 4})), 1);
  assert.equal(arrivalProgress(p('first-frame')), 1);
  assert.equal(arrivalProgress(p('failed', {required: 1})), null);
  assert.equal(initialPending(null), false);
  for (const stage of ['waiting', 'downloading', 'preparing', 'first-frame', 'cancelled']) assert.equal(initialPending(p(stage)), true, stage);
  assert.equal(initialPending(p('ready')), false);
  assert.equal(initialPending(p('failed')), false);
});
