// Deterministic wake-count model for a synthetic Mars-like gathering: a presenter
// and three guests who arrive, ask, are answered and leave. It replays the idle
// wake rule (urgent now; attended ambient at ambientDueAt; priority 0 never) with
// the real attentionPriority, comparing it with the r12 rule (presence never
// attended; every ambient waits a full cadence). No timers, no model, no world.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {attentionPriority,ambientDueAt,presenceCooldown,AMBIENT_WAKE_MS} from './supervisor.mjs';

const R14=39,R13_SHUFFLE=179,R14_SHUFFLE=12;
const TURN_MS=4000,STEP_MS=100,END_MS=420000;
const souls=['s_presenter','s_guest1','s_guest2','s_guest3'];
const at={s_presenter:[0,Infinity],s_guest1:[20000,370000],s_guest2:[30000,375000],s_guest3:[40000,380000]};
const spoken=[[60000,'s_guest1'],[66000,'s_presenter'],[120000,'s_guest2'],[126000,'s_presenter'],[127000,'s_presenter'],[200000,'s_guest3'],[206000,'s_presenter'],[300000,'s_guest1'],[301500,'s_guest2']];
const present=(soul,t)=>at[soul][0]<=t&&t<at[soul][1];
function trace(){
 const out=Object.fromEntries(souls.map(s=>[s,[]]));let n=0;
 const deliver=(t,subject,kind)=>{for(const s of souls)if(s!==subject&&present(s,t)){
  const e=kind==='speech'?{id:'c_'+ ++n,kind:'speech.ambient',raw:'speech',salience:1,about:{soulId:subject},data:{from:{soulId:subject},text:'A public remark.'}}
   :{id:'c_'+ ++n,kind,raw:kind==='arrive.here'?'arrival':'departure',salience:1,about:{soulId:subject},data:{placeId:'p_venue',soul:{soulId:subject},untrusted:true}};
  out[s].push({t,fact:{source:'world',event:e}});
 }};
 const timeline=[...souls.filter(s=>at[s][0]>0).map(s=>[at[s][0],s,'arrive.here']),...souls.filter(s=>at[s][1]<Infinity).map(s=>[at[s][1],s,'leave.here']),...spoken.map(([t,s])=>[t,s,'speech'])].sort((a,b)=>a[0]-b[0]);
 for(const [t,s,kind] of timeline)deliver(kind==='arrive.here'?t+1:t,s,kind);
 return out;
}
function simulate(events,{presence=true,promptFirst=true,cooldown=true,endMs=END_MS}={}){
 const c=presenceCooldown(),priority=fact=>!presence&&fact.event.raw!=='speech'?0:cooldown?c.priority(fact,'nearby'):attentionPriority(fact,'nearby');
 const due=(received,last)=>promptFirst?ambientDueAt(received,last,AMBIENT_WAKE_MS):Math.max(received+AMBIENT_WAKE_MS,(last??0)+AMBIENT_WAKE_MS);
 let pending=[],next=0,busyUntil=-1,last=null,wakes=0,latency=[];
 for(let now=0;now<=endMs;now+=STEP_MS){
  while(next<events.length&&events[next].t<=now){const x=events[next++];x.fact.receivedAt=x.t;pending.push(x);}
  if(now<busyUntil)continue;
  const urgent=pending.some(x=>priority(x.fact)>=2),ambient=pending.find(x=>priority(x.fact)===1);
  if(!urgent&&!(ambient&&now>=due(ambient.t,last)))continue;
  wakes++;for(const x of pending)latency.push(now-x.t);
  if(pending.some(x=>priority(x.fact)===1))last=now;if(cooldown)c.delivered(pending.map(x=>x.fact),'nearby',now);
  pending=[];busyUntil=now+TURN_MS;
 }
 return {wakes,undelivered:pending.length,maxLatencyMs:Math.max(0,...latency)};
}
test('synthetic Mars-like gathering: extra wakes from attended presence and the prompt first ambient',t=>{
 const events=trace(),rows={};
 for(const soul of souls)rows[soul]={r12:simulate(events[soul],{presence:false,promptFirst:false}),presenceOnly:simulate(events[soul],{promptFirst:false,cooldown:false}),r13:simulate(events[soul],{cooldown:false}),r14:simulate(events[soul]),facts:events[soul].length};
 const total=k=>souls.reduce((sum,s)=>sum+rows[s][k].wakes,0);
 t.diagnostic(JSON.stringify({rows,r12Wakes:total('r12'),presenceOnlyWakes:total('presenceOnly'),r13Wakes:total('r13'),r14Wakes:total('r14')}));
 assert.deepEqual(Object.fromEntries(souls.map(s=>[s,[rows[s].r12.wakes,rows[s].presenceOnly.wakes,rows[s].r13.wakes]])),{s_presenter:[4,9,11],s_guest1:[6,8,9],s_guest2:[6,8,9],s_guest3:[6,7,10]});
 assert.deepEqual([total('r12'),total('presenceOnly'),total('r13'),total('r14')],[22,32,39,R14]);
 // r12 leaves presence facts pending until some later wake (presenter: 45 s; three never by the end); r13 delivers each within one cadence plus a turn.
 for(const soul of souls){assert.ok(rows[soul].r14.undelivered===0,soul);assert.ok(rows[soul].r13.maxLatencyMs<=AMBIENT_WAKE_MS+TURN_MS,soul);assert.equal(rows[soul].r13.undelivered,0,soul);}
});
test('a Soul alone sees no change: no attended facts, no wakes either way',()=>{
 for(const mode of [{presence:false,promptFirst:false},{}])assert.deepEqual(simulate([],mode),{wakes:0,undelivered:0,maxLatencyMs:0});
});
test('one peer shuffling across a place boundary every 20 s for an hour: presence wakes per hour for an idle observer',t=>{
 const events=[];for(let i=1;i*20000<=3600000;i++)events.push({t:i*20000,fact:{source:'world',event:{id:'c_'+i,kind:i%2?'leave.here':'arrive.here',raw:i%2?'departure':'arrival',salience:1,about:{soulId:'s_peer'},data:{soul:{soulId:'s_peer'}}}}});
 const r13=simulate(structuredClone(events),{cooldown:false,endMs:3600000}),r14=simulate(structuredClone(events),{endMs:3600000});
 t.diagnostic(JSON.stringify({facts:events.length,r13PerHour:r13.wakes,r14PerHour:r14.wakes}));
 assert.deepEqual([r13.wakes,r14.wakes],[R13_SHUFFLE,R14_SHUFFLE]);assert.ok(r14.maxLatencyMs<=300000+20000);
});
