import test from'node:test';import assert from'node:assert/strict';import{itemPresentation,itemPostureK,ITEM_RECOVERY_SECONDS,ITEM_REACH_SECONDS,HANDOVER_SETTLE_SECONDS}from'../../mars/viewer/engine/items/presentation.ts';
test('native item reach/recovery blends are random-access and end exactly before the field clears',()=>{const p={item:'lamp',hand:'right',action:'a1',startTick:0,reachTick:10};const R=Math.round(ITEM_REACH_SECONDS/.05);assert.equal(itemPresentation(p,undefined,10,.05).weight,0);assert.equal(itemPresentation(p,undefined,10+R,.05).weight,1);assert.equal(itemPresentation(p,{right:'lamp'},12,.05).weight,1,'custody keeps full grip');const r={...p,releaseTick:40};assert.deepEqual(itemPresentation(r,undefined,40,.05),{weight:1,idleBlend:0,transfer:true},'released arm starts at the kept rest point');const end=itemPresentation(r,undefined,40+ITEM_RECOVERY_SECONDS/.05,.05);assert.equal(end.idleBlend,1);assert.equal(end.weight,0,'and has eased fully back to the clip when recovery ends');assert.deepEqual(itemPresentation(r,{right:'lamp'},40,.05),{weight:1,idleBlend:0,transfer:true});assert.equal(itemPresentation(undefined,undefined,100,.05),undefined,'old takes unchanged');assert.deepEqual(itemPresentation(undefined,{right:'lamp'},100,.05),{weight:1,idleBlend:0},'plain holding is not a transfer');});
test('item posture hump: zero at reach start and withdraw end, full at the grasp, continuous on the hand clock',()=>{
 const dt=.05,R=Math.round(ITEM_REACH_SECONDS/dt),p={item:'lamp',hand:'right',action:'a1',startTick:0,reachTick:10,target:[1,.75,2]};
 assert.equal(itemPostureK({...p,reachTick:undefined},12,dt),0,'no reach yet');
 assert.equal(itemPostureK(p,10,dt),0);assert.equal(itemPostureK(p,10+R,dt),1);assert.equal(itemPostureK(p,10+2*R,dt),0);assert.equal(itemPostureK(p,10+3*R,dt),0);
 let max=0;for(let t=0;t<60;t+=.25)max=Math.max(max,Math.abs(itemPostureK(p,t+.25,dt)-itemPostureK(p,t,dt))/.25);
 assert.ok(max<=1.5/R+1e-9,'never faster than the smoothstep hand lerp '+max);
 assert.deepEqual(itemPresentation(p,undefined,10+R,dt).posture,{target:[1,.75,2],hand:'right',k:1});
 assert.equal(itemPresentation(p,undefined,10,dt).posture,undefined,'no bend before the reach moves');
 assert.equal(itemPresentation({...p,target:undefined},undefined,10+R,dt).posture,undefined,'older records keep no item posture');
});
test('pick-up presentation (entry 29 on M04): one reach clock for the drawn hand, a gesture fade through the grasp, an interrupted reach returns smoothly',async()=>{
 const{ITEM_GESTURE_FADE_SECONDS,ITEM_ARM_LEAD_SECONDS}=await import('../../mars/viewer/engine/items/presentation.ts');
 const dt=.05,R=Math.round(ITEM_REACH_SECONDS/dt),sm=n=>{const k=Math.max(0,Math.min(1,n));return k*k*(3-2*k)},take={item:'bowl',hand:'right',action:'a1',mode:'take',startTick:0,reachTick:10,target:[1,.75,2]};
 const at=(t,rec=take)=>itemPresentation(rec,t>=10+R&&!rec.cancelTick?{right:'bowl'}:undefined,t,dt);
 // the drawn palm's share of the way (goal k × arm weight) is exactly the reach clock: a single smoothstep
 for(let t=11;t<10+R;t++){const p=at(t);assert.ok(p.goal,'empty-handed reach draws a goal');assert.ok(Math.abs(p.goal.k*p.weight-sm((t-10)*dt/ITEM_REACH_SECONDS))<1e-9,'palm share at '+t);assert.ok(p.goal.k<=1)}
 assert.equal(at(10+R).goal,undefined,'holding: the engine hand again');assert.equal(at(10+R).weight,1);
 assert.ok(Math.abs(at(10+R-1).weight-1)<1e-9||ITEM_ARM_LEAD_SECONDS>ITEM_REACH_SECONDS,'full arm weight before the grasp');
 // the idle gesture fades out from the reach start on through the grasp and the withdraw, never cut
 let prev=1;for(let t=10;t<10+2*R;t++){const g=at(t).idleBlend;assert.ok(g<=prev+1e-12&&prev-g<=1.5*dt/ITEM_GESTURE_FADE_SECONDS+1e-9,'gesture fade at '+t+': '+prev+' → '+g);prev=g}
 // the presented pick-up's recovery ends holding: the gesture keeps fading and never comes back (take 5: it did, then cut)
 const rec={...take,releaseTick:10+2*R};for(let t=10+2*R;t<10+2*R+30;t++){const g=itemPresentation(rec,{right:'bowl'},t,dt).idleBlend;assert.ok(g<=prev+1e-12,'recovery gesture at '+t);prev=g}
 assert.equal(itemPresentation(rec,{right:'bowl'},10+2*R+30,dt).idleBlend,0,'gone before the record clears');
 // a put starts holding: no gesture at any point until the release
 const put={...take,mode:'put',action:'a2'};for(let t=0;t<10+R;t++)assert.equal(itemPresentation(put,{right:'bowl'},t,dt).idleBlend,0);
 // interrupted halfway: the goal stops, the arm weight eases back to 0 over the engine's withdraw and stays 0 in recovery
 const c={...take,cancelTick:10+R/2};let w=at(10+R/2,c).weight;for(let t=10+R/2+1;t<=10+R/2+R;t++){const q=at(t,c);assert.ok(Math.abs(q.weight-w)<=1.5/R+1e-9,'cancel withdraw at '+t);assert.equal(q.goal.k,at(10+R/2,c).goal.k);w=q.weight}
 assert.ok(w<1e-9,'drawn arm back on the clip');assert.equal(itemPresentation({...c,releaseTick:10+R/2+R},undefined,10+R/2+R+3,dt).weight,0,'recovery keeps the clip');
});
test('entry 41: a hand-over hold keeps the bend while the hand is held out and eases it from holdTick, continuously',()=>{
 const dt=.05,R=Math.round(ITEM_REACH_SECONDS/dt),p={item:'lamp',hand:'right',action:'a1',mode:'put',startTick:0,reachTick:10,target:[0,1,0],hold:true};
 assert.equal(itemPostureK(p,10,dt),0);assert.equal(itemPostureK(p,10+R,dt),1);assert.equal(itemPostureK(p,10+R+400,dt),1,'held out: the bend stays');
 const q={...p,holdTick:10+R+400};let prev=itemPostureK(q,10,dt),max=0;for(let t=11;t<=10+3*R+400;t++){const k=itemPostureK(q,t,dt);max=Math.max(max,Math.abs(k-prev));prev=k;}
 assert.equal(itemPostureK(q,10+2*R+400,dt),0,'back to standing one reach after the hold ends');assert.ok(max<=.08,'no step '+max);
 const early={...p,holdTick:15};assert.ok(itemPostureK(early,15,dt)>0&&itemPostureK(early,15+R,dt)===0,'a hold ended mid-raise eases down from where it was');
 const old={item:'lamp',hand:'right',action:'a1',startTick:0,reachTick:10};assert.equal(itemPostureK(old,10+R+R/2,dt),1-(k=>k*k*(3-2*k))(.5),'records without hold: the old hump');
});
test('entry 41: a receiver lets an idle gesture go from fadeTick, before the reach, and gets it back after a cancel without a jump',()=>{
 const dt=.05,S=Math.round(HANDOVER_SETTLE_SECONDS/dt),p={item:'lamp',hand:'left',action:'a2',mode:'take',startTick:0,hold:true,fadeTick:10};
 assert.equal(itemPresentation(p,undefined,10,dt).idleBlend,1);assert.equal(itemPresentation(p,undefined,10+S,dt).idleBlend,0,'gone before the hand moves');assert.equal(itemPresentation(p,undefined,10+S,dt).weight,0);
 const r={...p,reachTick:10+S+5,target:[0,1,0]};assert.equal(itemPresentation(r,undefined,10+S+20,dt).idleBlend,0,'and stays gone through the reach');
 const c={...p,cancelTick:20,releaseTick:20};let prev=itemPresentation(p,undefined,19,dt).idleBlend,max=0;for(let t=20;t<=20+30;t++){const v=itemPresentation(c,undefined,t,dt).idleBlend;max=Math.max(max,Math.abs(v-prev));prev=v;}
 assert.ok(max<.08,'cancelled during the settle: the gesture fades back, no jump '+max);assert.equal(itemPresentation(c,undefined,20+Math.round(1.2/dt),dt).idleBlend,1);
});
