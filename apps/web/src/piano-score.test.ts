// Entry 14: the piano's sound and the hands read one score at depicted world seconds.
import test from 'node:test';import assert from 'node:assert/strict';
import {pianoNotes,pianoHands,PIANO_STEP,STRIKE} from '../../../mars/viewer/app/engine-view/piano-score.ts';
test('every note onset is a key strike of that hand, at the same world second, for every viewer',()=>{
 for(const seed of ['h_a','h_b','h_cb33a8d209','h_2a6daed123']){
  const notes=pianoNotes(seed,100,116);assert.ok(notes.length>40,'a real tune: '+notes.length);
  for(const n of notes){const [l,r]=pianoHands(seed,n.t);assert.equal((n.hand===0?l:r).press,1,`${seed} strike at ${n.t}`);const later=pianoHands(seed,n.t+STRIKE*.5);assert.ok((n.hand===0?later[0]:later[1]).press<=.5+1e-9);}
  assert.deepEqual(pianoNotes(seed,100,108).map(n=>[n.t,n.midi,n.hand]),pianoNotes(seed,100,104).concat(pianoNotes(seed,104,108)).map(n=>[n.t,n.midi,n.hand]),'windows compose: schedule order cannot change the notes');
  assert.ok(notes.every(n=>Math.abs(n.t/PIANO_STEP-Math.round(n.t/PIANO_STEP))<1e-9),'on the step grid');
 }
 assert.notDeepEqual(pianoNotes('h_a',0,8).map(n=>n.midi),pianoNotes('h_b',0,8).map(n=>n.midi).length?pianoNotes('h_c',0,8).map(n=>n.midi):[],'players differ (seeded)');
});
test('between notes no key is held down',()=>{const [l,r]=pianoHands('h_a',100+PIANO_STEP*.9);assert.ok(l.press<1&&r.press<1);});
