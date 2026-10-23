import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {withSince,sinceLastLook,lookSummary,worldMinute} from './client-awareness.mjs';
const frame=(over={})=>({now:'Wed 21 Oct 2026 · 03:33 · night · world day 19',tick:100,clock:'03:33',light:'night',weather:{sky:'clear'},me:{soulId:'s_a',place:'field',placePath:['Green field','World']},
 near:[{id:'s_j',name:'Juno',dist:0.9,doing:'standing'},{id:'s_d',name:'Ada',dist:19.7,doing:'standing'}],conversations_in_earshot:[],...over});
test('world minute from the now line',()=>{assert.equal(worldMinute(frame()),18*1440+3*60+33);assert.equal(worldMinute({}),null);});
test('here: now first, since second; the second look says who left, who came, where you went and how long ago',t=>{
 const dir=mkdtempSync(join(realpathSync(tmpdir()),'eden-aware-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const first=withSince(frame(),dir);assert.deepEqual(Object.keys(first).slice(0,2),['now','since']);assert.equal(first.since.first,true);
 const second=withSince(frame({now:'Wed 21 Oct 2026 · 04:15 · night · world day 19',clock:'04:15',tick:900,light:'dawn',me:{soulId:'s_a',place:'eden-dome',placePath:['eden-dome','World']},
  near:[{id:'s_d',name:'Ada',dist:4,doing:'walking'},{id:'s_k',name:'Kai',dist:7,doing:'sitting'}]}),dir);
 assert.equal(second.since.lastLooked,'42 world min ago (03:33)');
 assert.deepEqual(second.since.changes,['you moved: Green field → eden-dome','Juno left (was 0.9 m away, standing)','Ada: standing → walking','Kai arrived: 7 m away, sitting','light: night → dawn']);
 assert.deepEqual(withSince(frame({now:'Wed 21 Oct 2026 · 04:15 · night · world day 19',clock:'04:15',me:{soulId:'s_a',place:'eden-dome',placePath:['eden-dome','World']},near:[{id:'s_d',name:'Ada',dist:4,doing:'walking'},{id:'s_k',name:'Kai',dist:7,doing:'sitting'}],light:'dawn'}),dir).since.changes,['nothing you can see has changed']);
});
test('a different Soul in the folder starts over',()=>{assert.equal(sinceLastLook(lookSummary(frame()),lookSummary(frame({me:{soulId:'s_b'}}))).first,true);});
