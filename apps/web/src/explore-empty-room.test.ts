import test from 'node:test';import assert from 'node:assert/strict';
import {exploreSoulRoster,exploreRoom} from './explore-data.ts';
// W8 (Oct 9 STATUS follow-up "empty rooms hide Explore's global Soul roster/search"): an empty room keeps the world's
// roster and search; the room only adds its own count.
const souls=new Map([['a',{id:'a',name:'Ada',description:'reads'}],['b',{id:'b',name:'Bo',description:'paints'}]]) as never;
test('an empty room keeps the whole roster and its search; a room count is added, never a filter',()=>{
 const room={soulIds:[] as string[]};
 const r=exploreSoulRoster(souls,new Map(),'',room);assert.deepEqual(r.souls.map(s=>s.id),['a','b']);assert.equal(r.inRoom.size,0);
 assert.deepEqual(exploreSoulRoster(souls,new Map(),'pai',room).souls.map(s=>s.id),['b']);
 assert.deepEqual([...exploreSoulRoster(souls,new Map(),'',{soulIds:['b','ghost']}).inRoom],['b']);
});
test('room detection: camera inside an upper-floor room finds it; Souls on another floor are not counted there',()=>{
 const places=[{id:'office-2',name:'Upper office',kind:'room',level:1,polygon:[[0,0],[10,0],[10,10],[0,10]]}];
 const sm=new Map([['a',{entityId:'ea'}],['b',{entityId:'eb'}]]),ents={ea:{p:[5,3.1,5]},eb:{p:[5,0,5]}};
 const r=exploreRoom([5,4.6,5],places,sm,ents);assert.equal(r?.id,'office-2');assert.deepEqual(r?.soulIds,['a']);
 assert.equal(exploreRoom([5,1.6,5],places,sm,ents),null);
});
