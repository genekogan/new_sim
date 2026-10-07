// observe.happening: daily place schedules surfaced as "on now / next" (World places.v1 schedule slots).
import test from 'node:test';
import assert from 'node:assert/strict';
import {happenings, type Place} from './edge/ledger/places.ts';
const sq=(x:number,z:number):[number,number][]=>[[x-1,z-1],[x+1,z-1],[x+1,z+1],[x-1,z+1]];
const place=(id:string,x:number,schedule:Place['schedule']):Place=>({id,name:id,kind:'outdoor',parent:'eden',polygon:sq(x,0),level:0,enclosed:false,capacity:null,starting:false,schedule});
const ps=[place('kitchen',10,[{id:'lunch',cron:'0 12 * * *',durationMinutes:45,label:'Lunch prep'}]),place('shore',50,[{id:'swim',cron:'0 7 * * *',durationMinutes:45}]),
 place('fire',5,[{id:'fire',cron:'30 23 * * *',durationMinutes:120,label:'Late fire'}]),place('hall',3,[{id:'weds',cron:'0 13 * * 3'}])];
test('happening: on now (nearest first), then soonest within the horizon; wraps midnight; skips non-daily cron',()=>{
 const at1210=happenings(ps,12*60+10,[0,0]);assert.deepEqual(at1210.map(h=>[h.id,h.now,h.startsInMinutes,h.endsInMinutes]),[['lunch',true,0,35]]);
 const at0630=happenings(ps,6*60+30,[0,0]);assert.deepEqual(at0630.map(h=>[h.id,h.now,h.startsInMinutes]),[['swim',false,30]]);assert.equal(at0630[0].distance,50);
 const at0030=happenings(ps,30,[0,0]);assert.deepEqual(at0030.map(h=>[h.id,h.now,h.endsInMinutes]),[['fire',true,60]],'wraps past midnight');
 assert.equal(happenings(ps,13*60,[0,0]).some(h=>h.id==='weds'),false);
});
