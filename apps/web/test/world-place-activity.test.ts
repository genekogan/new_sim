import test from 'node:test';
import assert from 'node:assert/strict';
import { activeSlots, effectOf, WorldPlaceActivity } from '../src/WorldPlaceActivity.ts';
const ids=(iso:string)=>activeSlots(iso).map(s=>s.slotId).sort();
test('schedules light up on the world clock and fade at the edges', () => {
  assert.deepEqual(ids('2026-10-07T07:15:00Z').filter(x=>x==='morning-swim'),['morning-swim']);
  assert.ok(ids('2026-10-07T21:00:00Z').includes('evening-fire'));
  assert.ok(ids('2026-10-07T22:20:00Z').includes('evening-fire'),'still on near the end (20:30 + 120 min)');
  assert.ok(!ids('2026-10-07T22:40:00Z').includes('evening-fire'),'off after 22:30 + fade');
  assert.ok(!ids('2026-10-07T03:00:00Z').includes('evening-fire'));
  const edge=activeSlots('2026-10-07T06:58:00Z').find(s=>s.slotId==='morning-swim');assert.ok(edge&&edge.strength>0&&edge.strength<1,'fading in');
});
test('effects by kind', () => {
  assert.equal(effectOf('cook-dinner'),'stove');assert.equal(effectOf('evening-fire'),'bonfire');assert.equal(effectOf('open-mic'),'stage');assert.equal(effectOf('afternoon-tea'),'lanterns');assert.equal(effectOf('sleep-mats'),'none');
});
test('layer shows only active places and hides them when they end', () => {
  const layer=new WorldPlaceActivity();
  layer.update('2026-10-07T21:00:00Z',1,1,true);assert.ok(layer.group.children.some(c=>c.visible&&c.name.includes('evening-fire')));
  layer.update('2026-10-07T04:00:00Z',2,1,true);assert.ok(activeSlots('2026-10-07T04:00:00Z').some(s=>s.slotId==='sleep-mats'),'the night sleep is on');assert.equal(layer.group.children.filter(c=>c.visible).length,0);
  layer.update('2026-10-07T21:00:00Z',3,1,false);assert.equal(layer.group.children.filter(c=>c.visible).length,0,'off outside Eden');
  layer.dispose();
});
