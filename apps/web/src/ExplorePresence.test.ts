import test from 'node:test';import assert from 'node:assert/strict';
import {Fading} from '../../server/src/edge/comms/fading.ts';
import {explorePresence,orderedExploreSouls} from './explore-data.ts';
function producer(){const now=4*3600_000,rows:any={active:{last_at:now,colour:'green'},fading:{last_at:now-35*60_000,colour:'yellow'},departed:{last_at:now-70*60_000,colour:'gone'}};const core={worldId:'synthetic',now:()=>now,liveSoulIds:()=>Object.keys(rows),db:{exec(){},prepare:()=>({all:()=>[{name:'contact_at'}],get:(_world:string,id:string)=>rows[id]})}};return new Fading(core as never,{} as never,true);}
test('actual public fade producer omits green; Explore normalizes authoritative snapshot into active-first/fading/away',()=>{const ids=['active','fading','departed'];const roster=producer().roster();assert.deepEqual(roster.map(s=>s.soulId),['fading','departed']);const map=explorePresence([{kind:'fade.roster',souls:roster}],ids);assert.equal(explorePresence([{kind:'fade.roster',souls:roster},{kind:'fade.roster',souls:roster}],new Set(ids).keys()).get('active'),'active');assert.deepEqual([...map],[['active','active'],['fading','fading'],['departed','departed']]);const souls=new Map(ids.map(id=>[id,{id,name:id,description:''}]));assert.deepEqual(orderedExploreSouls(souls as never,map).map(s=>s.id),ids);});
test('absent or malformed snapshot stays unknown; valid empty snapshot and subsequent removal/reclaim preserve server semantics',()=>{assert.equal(explorePresence([],['a']).has('a'),false);assert.equal(explorePresence([{kind:'fade.roster',souls:[{soulId:'a',colour:'made-up'}]}],['a']).has('a'),false);assert.equal(explorePresence([{kind:'fade.roster',souls:[]}],['a']).get('a'),'active');assert.equal(explorePresence([{kind:'fade.roster',souls:[]},{kind:'fade',soulId:'a',change:'removed',colour:'gone'}],['a']).get('a'),'departed');assert.equal(explorePresence([{kind:'fade.roster',souls:[{soulId:'a',colour:'gone'}]},{kind:'fade',soulId:'a',change:'reclaimed',colour:'green'}],['a']).get('a'),'active');assert.equal(explorePresence([{kind:'fade.roster',souls:[{soulId:'departed',colour:'gone'}]}],['new-active','departed']).get('new-active'),'active');});
// 3.2 walk: "Longrun Ada · Away" stayed in Eden 2026's Explore after she travelled home. A Soul gone to another world is
// marked `away` by the producer (roster and the depart message) and drops off Explore; a resident who merely faded stays.
test('a Soul that travelled to another world drops off Explore; a faded resident stays listed as away',()=>{
 const now=4*3600_000,rows:any={home:{last_at:now-70*60_000,colour:'gone'},ada:{last_at:now-70*60_000,colour:'gone'},bo:{last_at:now,colour:'green'}},seen:any[]=[];
 const core={worldId:'synthetic',now:()=>now,tick:()=>1,liveSoulIds:()=>Object.keys(rows),spectate:(m:any)=>seen.push(m),streams:{deliver(){}},db:{exec(){},prepare:()=>({all:()=>[{name:'contact_at'}],run(){},get:(_world:string,id:string)=>rows[id]})}};
 const f=new Fading(core as never,{narrate(){}} as never,true);f.addAway(id=>id==='ada'||id==='cy');
 const roster=f.roster();assert.deepEqual(roster.map(r=>[r.soulId,r.away??null]),[['home',null],['ada',true]]);
 const ids=['home','ada','bo'],souls=new Map(ids.map(id=>[id,{id,entityId:'e-'+id,name:id,description:''}as any]));
 const map=explorePresence([{kind:'fade.roster',souls:roster}],ids);assert.equal(map.get('ada'),'travelled');assert.equal(map.get('home'),'departed');
 assert.deepEqual(orderedExploreSouls(souls,map).map(s=>s.id),['bo','home']);
 // the live depart message (travel's beam-up) carries `away` too; coming back (reclaimed) lists the Soul again
 rows.cy={last_at:now,colour:'green'};f.depart('cy','You leave Eden 2026 for Mars.');const msg=seen.find(m=>m.kind==='fade'&&m.soulId==='cy');assert.equal(msg?.away,true);
 souls.set('cy',{id:'cy',entityId:'e-cy',name:'cy',description:''}as any);const live=explorePresence([{kind:'fade.roster',souls:roster},msg],[...ids,'cy']);
 assert.ok(!orderedExploreSouls(souls,live).some(s=>s.id==='cy'));
 assert.ok(orderedExploreSouls(souls,explorePresence([{kind:'fade.roster',souls:roster},msg,{kind:'fade',soulId:'cy',colour:'green',change:'reclaimed'}],[...ids,'cy'])).some(s=>s.id==='cy'));
});
