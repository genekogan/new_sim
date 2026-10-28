import test from 'node:test';
import assert from 'node:assert/strict';
import manifest from './stair-mesh-profiles.json' with {type:'json'};
import {extractStairSupports,meshStairFlight,type MeshStairProfile,type Triangle} from './stair-mesh-profile.ts';
import {gaitAt,axisPoint,flightOf} from './stair-gait.ts';
import {stairSoleFit} from './stair-sole.ts';
import {matchedStairFlights,StairObservation} from './stair-frame.ts';
import type {TakeFrame} from '../../engine/take/replay.ts';
import type {Take} from '../../engine/take/types.ts';
const profile=manifest.profiles[1] as MeshStairProfile;
const rectangle=(x0:number,x1:number,y:number):Triangle[]=>[[[x0,y,-.5],[x0,y,.5],[x1,y,.5]],[[x0,y,-.5],[x1,y,.5],[x1,y,-.5]]];
function fixture(){return [...rectangle(.35,.61,.177),...rectangle(.61,.87,.354),...rectangle(.87,1.13,.53),...rectangle(1.13,2,.53)];}
test('only measured connected tops qualify; top tread remains distinct from landing',()=>{
 const p=extractStairSupports(fixture(),[0,0,0],[1.4,.53,0],1,true);
 assert.deepEqual(p.treads.map(t=>t.y),[.177,.354,.53]);assert.deepEqual(p.treads.map(t=>t.s),[.48,.74,1]);
 assert.throws(()=>extractStairSupports(fixture().slice(2),[0,0,0],[1.4,.53,0],1,true),/fewer than three/);
 assert.throws(()=>extractStairSupports([...rectangle(.35,.61,.177),...rectangle(.7,.9,.354),...rectangle(.9,1.13,.53),...rectangle(1.13,2,.53)],[0,0,0],[1.4,.53,0],1,true),/disconnected/);
 const hole=fixture();hole.splice(0,1);assert.throws(()=>extractStairSupports(hole,[0,0,0],[1.4,.53,0],1,true),/complete contact rectangle/);
 const ramp:Triangle[]=[[[.35,.177,-.5],[.35,.177,.5],[1.13,.53,.5]],[[.35,.177,-.5],[1.13,.53,.5],[1.13,.53,-.5]]];
 assert.throws(()=>extractStairSupports(ramp,[0,0,0],[1.4,.53,0],1,true),/fewer than three/);
});
test('mesh flight respects actual placement, scale and nonuniform measured pitch',()=>{
 const varied=structuredClone(profile);varied.treads[1].s+=.05;
 const f=meshStairFlight(varied,'known',{x:2,y:-.24,z:-4,yaw:.7,s:1.2})!;
 for(let k=0;k<3;k++){const p=axisPoint(f,f.treads[k].s,0),g=gaitAt(f,...p,f.treads[k].y)!;assert.ok(g);assert.ok(Math.abs(g.u-k-1)<1e-8);}
 assert.equal(gaitAt(f,100,100,0),null);const p=axisPoint(f,f.treads[1].s,0);assert.equal(gaitAt(f,...p,f.yTop+2),null);
 assert.equal(meshStairFlight(profile,'bad',{x:0,y:0,z:0,yaw:0,s:-1}),null);
 // Old sparse path remains unqualified; this fix never invents contacts from endpoints.
 assert.equal(flightOf({id:'ramp-samples',kind:'stairs',usable:true,path:[[0,0,0],[1,.53,0]]} as never),null);
});
test('all sole points clear higher solids while lower-side boot overhang stays legal',()=>{
 const f=meshStairFlight(profile,'known',{x:0,y:-profile.bottom,z:0,yaw:0,s:1})!,support=f.supports![0],at=(s:number,y:number)=>{const[x,z]=axisPoint(f,s,0);return{x,y,z};};
 const foot={s:support.s,y:support.y,planted:true,k:1,top:support.y};
 const boot=[at(support.lo-.08,support.y+.003),at(support.hi-.02,support.y+.003)];
 assert.deepEqual(stairSoleFit(f,foot,boot),{along:0,lift:0},'lower overhang is not discarded or clamped');
 assert.deepEqual(stairSoleFit(f,foot,[...boot,at(support.hi+.1,f.supports![1].y+.08)]),{along:0,lift:0},'boot upper already above the next tread does not force an artificial foot shift');
 const intrusion=[...boot,at(support.hi+.03,support.y+.003)];const fit=stairSoleFit(f,foot,intrusion);
 assert.ok(fit.along<-.03&&fit.along>-.04);assert.ok(fit.lift<1e-8,'move clear of higher riser without floating off planted tread');
 const dipped=boot.map(p=>({...p,y:p.y-.025}));assert.ok(Math.abs(stairSoleFit(f,foot,dipped).lift-.025)<1e-8);
 const swing={...foot,planted:false},raised=stairSoleFit(f,swing,intrusion);assert.equal(raised.along,0);assert.ok(raised.lift>.17,'swing clears actual next top');
});
test('selected native fixture provenance is mandatory; deleted, moved, replaced and tilted fixtures reject',()=>{
 const f=meshStairFlight(profile,'known',{x:0,y:0,z:0,yaw:0,s:1})!;
 const contact={entity:'building',nativeDef:'ew:exact',pose:{p:[1,2,3],yaw:.7},flight:f,geometry:profile.geometry};
 const frame={entities:{building:{p:[1,2,3],yaw:.7}}} as unknown as TakeFrame;
 const exact={building:{def:'ew:exact'}};
 assert.equal(matchedStairFlights([contact],frame,exact,exact).length,1);
 assert.deepEqual(matchedStairFlights([contact],frame,{building:{def:'ew:changed'}},exact),[]);
 assert.deepEqual(matchedStairFlights([contact],frame,exact,{building:{def:'ew:before-replacement'}}),[]);
 assert.deepEqual(matchedStairFlights([contact],frame,exact,{}),[],'missing original identity cannot borrow a final fixture');
 assert.deepEqual(matchedStairFlights([contact],{entities:{}} as TakeFrame,exact,exact),[]);
 for(const entity of [{p:[1.02,2,3],yaw:.7},{p:[1,2,3],yaw:.73},{p:[1,2,3],yaw:.7,pitch:.01}])assert.deepEqual(matchedStairFlights([contact],{entities:{building:entity}} as unknown as TakeFrame,exact,exact),[]);
});
test('untracked entity-world statics require a live selection and observation before the entire take',()=>{
 const f=meshStairFlight(profile,'known',{x:0,y:0,z:0,yaw:0,s:1})!;
 const contact={entity:'building',nativeDef:'ew:exact',pose:{p:[1,2,3],yaw:.7},flight:f,geometry:profile.geometry};
 const staticRecord={kind:'fixture',tags:['entity-world'],def:'ew:exact',pose:{p:[1,2,3],yaw:.7}};
 const take={id:'native-1',startTick:400,dt:.05,tracks:{},entities0:{},finalState:{entities:{building:staticRecord}}} as unknown as Take;
 const frame={entities:{}} as TakeFrame,observer=new StairObservation(),select={liveTakeId:take.id,take};
 // Native tick 405 is 20.25 simulation seconds, not a seconds watermark.
 const midway=observer.observe([contact],405);
 assert.deepEqual(matchedStairFlights(midway,frame,{}, {},select),[],'first seen halfway through a take proves no earlier presence');
 const next={...take,id:'native-2',startTick:410};const observed=observer.observe([contact],415);
 assert.equal(matchedStairFlights(observed,frame,{}, {},{liveTakeId:next.id,take:next}).length,1);
 assert.deepEqual(matchedStairFlights(observed,frame,{}, {}),[],'history/no explicit live capability');
 assert.deepEqual(matchedStairFlights(observed,frame,{}, {},{liveTakeId:take.id,take:next}),[],'stale capability after take switch');
 for(const record of [{...staticRecord,def:'ew:changed'},{...staticRecord,tags:[]},{...staticRecord,pose:{p:[1.02,2,3],yaw:.7}},{...staticRecord,pose:{p:[1,2,3],yaw:.7,pitch:.01}}]){
  const changed={...next,finalState:{entities:{building:record}}} as unknown as Take;
  assert.deepEqual(matchedStairFlights(observed,frame,{}, {},{liveTakeId:changed.id,take:changed}),[]);
 }
 observer.clear();const resynced=observer.observe([contact],420);
 assert.deepEqual(matchedStairFlights(resynced,frame,{}, {},{liveTakeId:next.id,take:next}),[],'resync has no assumed earlier lifetime');
 const changed=observer.observe([{...contact,geometry:'new-loaded-geometry'}],425);assert.equal(changed[0].observedSinceTick,425);
 observer.observe([],426);assert.equal(observer.observe([contact],427)[0].observedSinceTick,427,'removal resets the epoch');
 observer.clear(); // no selected native frame/lightweight fallback; edits occur in the gap
 const reinserted=observer.observe([contact],500);
 assert.deepEqual(matchedStairFlights(reinserted,frame,{}, {},{liveTakeId:next.id,take:next}),[],'equal fixture reinserted during a frame gap cannot reuse its old lifetime');
 assert.equal(observer.observe([contact],100)[0].observedSinceTick,100,'backward native clock resets epoch');
 assert.equal(observer.observe([contact],null)[0].observedSinceTick,undefined,'missing native clock cannot certify lifetime');
});
