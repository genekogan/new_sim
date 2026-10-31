import test from'node:test';import assert from'node:assert/strict';import{itemPresentation,itemPostureK,ITEM_RECOVERY_SECONDS,ITEM_REACH_SECONDS}from'../../mars/viewer/engine/items/presentation.ts';
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
