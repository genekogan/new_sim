// Entry 35: holding hands (join side by side, walk together with no lag, turn together, let go) and rock-paper-scissors
// (one shared count, shapes shown only from the shoot beat), natively.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Runtime} from '../runtime/runtime.ts';
import {DEFAULT_INVARIANTS} from '../runtime/invariants.ts';
import {Spatial} from '../spatial/service.ts';
import {provingGround} from '../scenes/proving-ground.ts';
import {emptyWorld,human,addAll} from '../world/factory.ts';
import {poseV1} from '../social/pose.ts';
import type {ActionDef} from '../actions/types.ts';
import {walkTo} from '../locomotion/walk.ts';
import {handHold,stepHandHolds,HAND_GAP,RELEASE_SECONDS,HAND_STATE_TAIL} from '../social/hand-hold.ts';
import {RPS,RPS_STATE_TAIL} from '../social/rps.ts';
import {hashOf} from '../core/hash.ts';

function fixture(){const scene=provingGround();const world=addAll(emptyWorld('proving-ground',scene),human('a',-6,-6),human('b',-6,-5.25));world.entities.a.pose.yaw=0;world.entities.b.pose.yaw=0.2;const registry=new Map<string,ActionDef>([[poseV1.verb,poseV1],[walkTo.verb,walkTo],[handHold.verb,handHold as ActionDef]]);const spatial=new Spatial(scene);spatial.sync(world);return {scene,registry,rt:new Runtime(world,registry,{spatial},DEFAULT_INVARIANTS)};}
const tickOnce=(rt:Runtime)=>{stepHandHolds(rt);rt.step();};
const E=(rt:Runtime,id:string)=>rt.world.entities[id];
function join(rt:Runtime){
 const a=rt.submit('hand_hold_v1',{actor:'a',mode:'join',partner:'b',group:'g1',hand:'left',offer:true,waitSeconds:10});
 for(let i=0;i<30;i++)tickOnce(rt);
 assert.equal(E(rt,'a').human!.handHold?.offered!==undefined,true,'the offered hand is out while waiting');
 assert.deepEqual(E(rt,'b').pose.p,[-6,0,-5.25],'nobody moves before accepting');
 const b=rt.submit('hand_hold_v1',{actor:'b',mode:'join',partner:'a',group:'g1'});
 for(let i=0;i<200&&(rt.isActive(a.id)||rt.isActive(b.id));i++){const before=['a','b'].map(id=>[...E(rt,id).pose.p]);tickOnce(rt);['a','b'].forEach((id,k)=>assert.ok(Math.hypot(E(rt,id).pose.p[0]-before[k][0],E(rt,id).pose.p[2]-before[k][2])<=0.0276+1e-9,'step-in at most 0.55 m/s'));}
 assert.equal(a.status,'completed');assert.equal(b.status,'completed');
 return {a,b};
}
test('hand-hold: offer waits without moving the other; join side by side; walk together with no lag; turn together; let go',()=>{
 const {rt}=fixture();join(rt);
 const A=E(rt,'a'),B=E(rt,'b'),ha=A.human!.handHold!,hb=B.human!.handHold!;
 assert.equal(ha.since,hb.since,'both hands begin to meet on one tick');assert.equal(ha.with,'b');assert.equal(hb.with,'a');
 assert.ok(Math.abs(Math.hypot(A.pose.p[0]-B.pose.p[0],A.pose.p[2]-B.pose.p[2])-HAND_GAP)<0.01,'side by side at the gap');
 assert.ok(Math.abs(A.pose.yaw-B.pose.yaw)<0.03,'facing the same way');
 assert.notEqual(ha.hand,hb.hand,'the inner hands: one left, one right');
 // walk together: a walks; b keeps beside, this same tick
 const w=rt.submit('walk_to',{actor:'a',x:-2.5,z:-5.7,speed:1});
 let maxLag=0,maxLatErr=0,moving=0,maxSpeedGap=0;
 for(let i=0;i<200&&rt.isActive(w.id);i++){tickOnce(rt);const f=[Math.cos(A.pose.yaw),Math.sin(A.pose.yaw)],d=[B.pose.p[0]-A.pose.p[0],B.pose.p[2]-A.pose.p[2]],along=d[0]*f[0]+d[1]*f[1],lat=Math.abs(-d[0]*f[1]+d[1]*f[0]);maxLag=Math.max(maxLag,Math.abs(along));maxLatErr=Math.max(maxLatErr,Math.abs(lat-HAND_GAP));if((A.human!.speed??0)>0.3){moving++;maxSpeedGap=Math.max(maxSpeedGap,Math.abs((A.human!.speed??0)-(B.human!.speed??0)));assert.equal(B.human!.activity,'walk');}}
 assert.equal(w.status,'completed');assert.ok(moving>40,'they walked');
 assert.ok(maxLag<=0.1,'along-track lag '+maxLag);assert.ok(maxLatErr<=0.06,'lateral '+maxLatErr);assert.ok(maxSpeedGap<=0.12,'speeds '+maxSpeedGap);
 for(let i=0;i<3;i++)tickOnce(rt);assert.notEqual(B.human!.activity,'walk','the follower stops with the leader');
 // turn together about the middle
 const mid=[(A.pose.p[0]+B.pose.p[0])/2,(A.pose.p[2]+B.pose.p[2])/2],t=rt.submit('hand_hold_v1',{actor:'a',mode:'turn',toward:[mid[0],mid[1]+5]});
 for(let i=0;i<100&&rt.isActive(t.id);i++){tickOnce(rt);assert.ok(Math.abs(Math.hypot(A.pose.p[0]-B.pose.p[0],A.pose.p[2]-B.pose.p[2])-HAND_GAP)<0.005,'the pair keeps its gap while turning');}
 assert.equal(t.status,'completed');assert.ok(Math.abs(Math.atan2(Math.sin(A.pose.yaw-Math.PI/2),Math.cos(A.pose.yaw-Math.PI/2)))<0.02,'faces the point');
 assert.ok(Math.hypot((A.pose.p[0]+B.pose.p[0])/2-mid[0],(A.pose.p[2]+B.pose.p[2])/2-mid[1])<0.005,'about the middle');
 // let go (either may)
 const r=rt.submit('hand_hold_v1',{actor:'b',mode:'release'});for(let i=0;i<40&&rt.isActive(r.id);i++)tickOnce(rt);
 assert.equal(r.status,'completed');for(let i=0;i<Math.round(HAND_STATE_TAIL/.05)+3;i++)tickOnce(rt);
 assert.equal(A.human!.handHold,undefined);assert.equal(B.human!.handHold,undefined);assert.equal(rt.services.handHolders,undefined,'nothing left behind');
 assert.deepEqual(rt.violations,[]);
});
test('hand-hold: an offer nobody takes lapses and lowers the hand; a broken pair lets go; checkpoint resumes tick for tick',()=>{
 {const {rt}=fixture();const a=rt.submit('hand_hold_v1',{actor:'a',mode:'join',partner:'b',group:'g2',hand:'left',offer:true,waitSeconds:1});for(let i=0;i<30;i++)tickOnce(rt);assert.equal(a.status,'failed');assert.equal(a.diagnostic?.code,'hand-hold.no-answer');assert.ok(E(rt,'a').human!.handHold?.release!==undefined,'lowering');for(let i=0;i<Math.round((RELEASE_SECONDS+HAND_STATE_TAIL)/.05)+3;i++)tickOnce(rt);assert.equal(E(rt,'a').human!.handHold,undefined);}
 {const {rt}=fixture();join(rt);E(rt,'b').pose.p=[-6,0,-3];tickOnce(rt);assert.ok(E(rt,'a').human!.handHold?.release!==undefined&&E(rt,'b').human!.handHold?.release!==undefined,'too far apart: both let go');}
 {const {rt,scene,registry}=fixture();join(rt);const w=rt.submit('walk_to',{actor:'a',x:-3,z:-6,speed:1});for(let i=0;i<10;i++)tickOnce(rt);const restored=Runtime.restore(rt.snapshot(),registry,{spatial:new Spatial(scene)},DEFAULT_INVARIANTS);for(let i=0;i<80;i++){tickOnce(rt);tickOnce(restored);assert.equal(restored.stateHash(),rt.stateHash());}assert.equal(hashOf(rt.world.entities.b.pose),hashOf(restored.world.entities.b.pose));assert.ok(!rt.isActive(w.id)||true);}
});
test('hand-hold: a follower who lets go mid-stride brakes to a stop, never stopping dead; the leader walks on',()=>{
 const {rt}=fixture();join(rt);const A=E(rt,'a'),B=E(rt,'b');
 const w=rt.submit('walk_to',{actor:'a',x:2,z:-5.7,speed:1});for(let i=0;i<60;i++)tickOnce(rt);assert.ok((B.human!.speed??0)>.9,'walking together');
 const r=rt.submit('hand_hold_v1',{actor:'b',mode:'release'});const speeds:number[]=[];let last=[...B.pose.p];
 for(let i=0;i<40;i++){tickOnce(rt);speeds.push(Math.hypot(B.pose.p[0]-last[0],B.pose.p[2]-last[2])/.05);last=[...B.pose.p];}
 for(let i=1;i<speeds.length;i++)assert.ok(speeds[i-1]-speeds[i]<=2.4*.05+1e-6,'braking at most 2.4 m/s² ('+speeds.slice(0,12).map(x=>x.toFixed(2))+')');
 assert.ok(speeds[0]>.8&&speeds.at(-1)!<1e-6,'from a stride to a stop');assert.equal(r.status,'completed');
 assert.ok(rt.isActive(w.id)||w.status==='completed','the leader walks on');assert.deepEqual(rt.violations,[]);
});
test('rps: one shared count from one start tick; each shape hidden until the shoot beat; both end together',()=>{
 const {rt}=fixture();E(rt,'b').pose.p=[-5,0,-6];E(rt,'b').pose.yaw=Math.PI;
 const p={activity:'rps',seconds:RPS.SECONDS,gap:1,group:'r1',pairedPolicy:'ready-v1',waitSeconds:20,alone:'fail',clear:true};
 const ra=rt.submit('pose_v1',{actor:'a',...p,throw:'rock'}),rb=rt.submit('pose_v1',{actor:'b',...p,throw:'scissors'});
 const seen:{tick:number;a?:unknown;b?:unknown}[]=[];
 for(let i=0;i<400&&(rt.isActive(ra.id)||rt.isActive(rb.id));i++){tickOnce(rt);seen.push({tick:rt.tick,a:structuredClone(E(rt,'a').human!.rps),b:structuredClone(E(rt,'b').human!.rps)});}
 assert.equal(ra.status,'completed',JSON.stringify(ra.diagnostic));assert.equal(rb.status,'completed',JSON.stringify(rb.diagnostic));
 const on=seen.filter(s=>s.a&&s.b&&!(s.a as {end?:number}).end) as {tick:number;a:{start:number;shoot:number;shape?:string};b:{start:number;shoot:number;shape?:string}}[];
 assert.ok(on.length>100);assert.ok(on.every(s=>s.a.start===s.b.start&&s.a.shoot===s.b.shoot),'one shared count');
 assert.ok(on.every(s=>(s.tick<s.a.shoot)===(s.a.shape===undefined)&&(s.tick<s.b.shoot)===(s.b.shape===undefined)),'no shape before the shoot');
 assert.equal(on.at(-1)!.a.shape,'rock');assert.equal(on.at(-1)!.b.shape,'scissors');
 const d=Math.hypot(E(rt,'a').pose.p[0]-E(rt,'b').pose.p[0],E(rt,'a').pose.p[2]-E(rt,'b').pose.p[2]);assert.ok(Math.abs(d-1)<0.04,'arm\'s length '+d);
 assert.ok(E(rt,'a').human!.rps?.end!==undefined,'the count\'s state stays a moment after it ends');for(let i=0;i<Math.round(RPS_STATE_TAIL/.05)+2;i++)tickOnce(rt);
 assert.equal(E(rt,'a').human!.rps,undefined,'then it is cleared');assert.deepEqual(rt.violations,[]);
 assert.equal(rt.submit('pose_v1',{actor:'a',...p}).status,'failed','rps without a throw is refused');
});
