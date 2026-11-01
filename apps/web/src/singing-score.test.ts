// Entry 36: a singer at a microphone sings the melody of the music she sings along with, on the same score clock.
import test from 'node:test'; import assert from 'node:assert/strict';
import { PIANO_STEP, accompanistOf, pianoNotes, sungNotes, voiceAt } from '../../../mars/viewer/app/engine-view/piano-score.ts';
import { activityFrame, MIC_HAND, SING_LET_GO } from '../../../mars/viewer/app/engine-view/activity-poses.ts';

test('the sung notes are the pianist\'s melody an octave down, at the same onsets, for every viewer', () => {
  for (const seed of ['h_a', 'h_b', 'h_cb33a8d209', 'h_2a6daed123']) {
    const sung = sungNotes({ seed, kind: 'piano' }, 100, 132), melody = pianoNotes(seed, 100, 132).filter(n => n.hand === 1);
    assert.equal(sung.length, melody.length, `${seed}: one sung note per melody note`);
    sung.forEach((n, i) => { assert.equal(n.t, melody[i].t, 'same onset'); assert.equal(n.midi, melody[i].midi - 12, 'the melody, one octave down'); });
    // a sung note is held until the next one starts (legato) or, at a phrase end, released a step early for a breath
    sung.forEach((n, i) => { const next = sung[i + 1]; if (!next) return; const gap = next.t - n.t;
      if (n.breath) { assert.ok(gap >= 3 * PIANO_STEP - 1e-9); assert.ok(Math.abs(n.dur - (gap - PIANO_STEP)) < 1e-9); assert.ok(next.first, 'a breath opens a new phrase'); }
      else assert.ok(Math.abs(n.dur - gap) < 1e-9, 'legato: held to the next note'); });
    assert.ok(sung.some(n => n.breath) && sung.some(n => n.syl === 'la') && sung.some(n => n.syl === 'oo') && sung.some(n => n.syl === 'ah' || n.syl === 'oh'), 'phrases, breaths and three vowels');
    assert.ok(sung.every(n => n.midi >= 55 && n.midi <= 72), 'a comfortable range (G3–C5)');
    assert.deepEqual(sungNotes({ seed, kind: 'piano' }, 100, 116), sungNotes({ seed, kind: 'piano' }, 100, 107.3).concat(sungNotes({ seed, kind: 'piano' }, 107.3, 116)), 'windows compose: tick timing cannot change the notes');
  }
});

test('she sings along with the nearest pianist within earshot of the mic, else a drummer, else not at all', () => {
  const me = [0, 0, 0] as const;
  assert.equal(accompanistOf(me, []), null);
  assert.equal(accompanistOf(me, [{ id: 'far', p: [20, 0, 0], kind: 'piano' }]), null, 'beyond 12 m');
  assert.deepEqual(accompanistOf(me, [{ id: 'd', p: [1, 0, 0], kind: 'drums' }, { id: 'p', p: [5, 0, 0], kind: 'piano' }]), { seed: 'p', kind: 'piano' }, 'the melody instrument first');
  assert.deepEqual(accompanistOf(me, [{ id: 'd', p: [1, 0, 0], kind: 'drums' }]), { seed: 'd', kind: 'drums' });
  assert.deepEqual(accompanistOf(me, [{ id: 'b', p: [3, 0, 0], kind: 'piano' }, { id: 'a', p: [0, 0, 3], kind: 'piano' }]), { seed: 'a', kind: 'piano' }, 'ties: by id');
});

test('her head and breath follow the notes; the hand holds the mic at a natural height and lets go smoothly', () => {
  const who = { seed: 'h_a', kind: 'piano' as const }, sung = sungNotes(who, 100, 116);
  const held = sung.find(n => n.dur >= 0.5)!, breathy = sung.find(n => n.breath)!;
  assert.ok(voiceAt(who, held.t + 0.3).open > 0.9, 'open on a held note');
  assert.ok(voiceAt(who, breathy.t + breathy.dur + PIANO_STEP / 2).breath > 0.8, 'the in-breath at a phrase end');
  assert.ok(MIC_HAND[2] >= 1.36 && MIC_HAND[2] <= 1.44, 'the grip between chest and chin');
  let prev: number[] | null = null;
  for (let s = 0; s <= 1.2; s += 0.05) { const f = activityFrame('sing', 'idle', 100 + s, 'h_x', { since: s, accompanist: who })!; assert.deepEqual(f.rootHands?.[1], MIC_HAND); const w = f.handW![1]; if (prev) assert.ok(Math.abs(w - prev[0]) <= 0.09, 'the reach eases in: ' + w); prev = [w]; }
  const full = activityFrame('sing', 'idle', 105, 'h_x', { since: 5, accompanist: who })!;
  assert.equal(full.handW![1], 1); assert.ok(Math.abs(full.side) <= 0.046, 'a gentle sway');
  prev = null;
  for (let s = 0; s <= SING_LET_GO; s += 0.05) { const f = activityFrame('sing', 'idle', 110 + s, 'h_x', { since: 9, released: s, accompanist: null })!; const w = f.handW![1]; if (prev) assert.ok(Math.abs(w - prev[0]) <= 0.1, 'lets go smoothly: ' + w); prev = [w]; }
  assert.equal(activityFrame('sing', 'idle', 111, 'h_x', { since: 9, released: SING_LET_GO, accompanist: null })!.handW![1], 0);
  // the sway is on the beat: two beats a sway, the same for every singer
  const a = activityFrame('sing', 'idle', 120, 'h_x', { since: 9, accompanist: who })!, b = activityFrame('sing', 'idle', 120, 'h_y', { since: 9, accompanist: who })!, c = activityFrame('sing', 'idle', 120.5, 'h_x', { since: 9, accompanist: who })!;
  assert.ok(Math.abs(a.side - b.side) < 1e-9 && Math.abs(a.side + c.side) < 1e-9);
});
