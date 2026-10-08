import assert from 'node:assert/strict';
import {test} from 'node:test';
import {worldClockAt,worldTimeText} from '../src/world-clock.ts';
import {popupMs} from '../src/dialogue-speaking.ts';

const chunk=(start:number,iso:string)=>({fromTick:start,toTick:start+20,take:{startTick:start,ticks:20,finalState:{env:{datetime:iso}}}});

test('world time comes from the streamed clock, placed at the shown tick at the stream\'s own rate', () => {
  // Live Eden: 20 ticks per chunk, 24 world seconds per chunk (one world day per real hour).
  const chunks=[chunk(3655988,'2026-11-23T00:40:09.600Z'),chunk(3656008,'2026-11-23T00:40:33.600Z'),chunk(3656028,'2026-11-23T00:40:57.600Z')];
  assert.equal(worldClockAt(chunks,3656048),'2026-11-23T00:40:57.600Z');
  // Replay delay / history: earlier ticks read earlier times on the same scale (60 s real = 24 world min).
  assert.equal(worldClockAt(chunks,3656048-1200),'2026-11-23T00:16:57.600Z');
  assert.equal(worldTimeText(worldClockAt(chunks,3656048)),'Mon · 12:40 am');
  assert.equal(worldTimeText('2026-10-03T19:42:00'),'Sat · 7:42 pm');
  assert.equal(worldTimeText('2026-10-06T12:05:00Z'),'Tue · 12:05 pm');
  // One chunk: nearest mark, no scale. No clock or no tick: nothing.
  assert.equal(worldClockAt([chunk(100,'2026-10-03T06:00:00Z')],120),'2026-10-03T06:00:00.000Z');
  assert.equal(worldClockAt([{take:{startTick:1,ticks:1,finalState:{}}}],5),null);
  assert.equal(worldClockAt(chunks,null),null);
  assert.equal(worldTimeText(null),'');
});

test('a pop-up stays ~4.5 s, a little longer for long lines, never past ~6.5 s', () => {
  assert.equal(popupMs('Hello there.'),4500);
  assert.ok(popupMs('x'.repeat(80))>4500&&popupMs('x'.repeat(80))<6500);
  assert.equal(popupMs('x'.repeat(400)),6500);
});
