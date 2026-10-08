import assert from 'node:assert/strict';
import {test} from 'node:test';
import {WorldTour,makeMove,type TourView} from '../src/WorldTour.ts';
import {WorldBroadcast} from '../src/WorldBroadcast.ts';

const views:TourView[]=[
  {id:'commons',label:'Commons',p:[35,20,35],target:[8,1,0]},{id:'overview',label:'All of Eden',p:[112,76,115],target:[7,0,5]},
  {id:'market',label:'Market',p:[83,12,42],target:[70,1,29]},{id:'harbour',label:'Harbour and lighthouse',p:[20,9,122],target:[45,1,152]},
  {id:'park',label:'Park with pond and gazebo',p:[-24,10,90],target:[-4,0,112]},{id:'street',label:'Market street',p:[112,4,92],target:[135,2,100]},
  {id:'night',label:'Canal town by night (best after dusk)',p:[95,45,-60],target:[170,0,30]}];

test('VF5 tour: varied, eased, never repeats a view back to back, opens on the preferred view', () => {
  const tour=new WorldTour(views,7),seen:string[]=[],types=new Set<string>();let last:number[]|null=null,maxStep=0,cuts=0;
  for(let t=0;t<600;t+=1/30){const p=tour.pose(t,{daylight:.9,prefer:views[0]});
    if(!seen.length||seen.at(-1)!==p.id){seen.push(p.id);types.add(p.id.split(':')[0]);if(p.cut)cuts++;}
    if(last&&!p.cut)maxStep=Math.max(maxStep,Math.hypot(p.position[0]-last[0],p.position[1]-last[1],p.position[2]-last[2]));last=p.position;}
  assert.ok(seen[0].endsWith(':commons'),seen[0]);
  assert.ok(seen.length>=25&&seen.length<=70,`${seen.length} moves in 10 min`);
  assert.ok(types.size>=5,[...types].join());
  for(let i=1;i<seen.length;i++)assert.notEqual(seen[i].split(':')[1],seen[i-1].split(':')[1],'no view twice in a row');
  assert.ok(maxStep<1.5,`continuous moves are smooth (max ${maxStep.toFixed(2)} m per 1/30 s)`);
});

test('VF5 tour: night prefers lit streets and town views; unsafe moves are replaced', () => {
  const night=new WorldTour(views,3),ids:string[]=[];
  for(let t=0;t<900;t+=1){const p=night.pose(t,{daylight:.05});if(ids.at(-1)!==p.id)ids.push(p.id);}
  const lit=ids.filter(id=>/street|market|commons|night/.test(id)).length;
  assert.ok(lit/ids.length>.5,`night: ${lit}/${ids.length} on lit town views`);
  const fussy=new WorldTour(views,5);const p=fussy.pose(0,{daylight:1,clear:q=>q[1]<30,sight:()=>true});
  assert.ok(p.position[1]<30,'a move whose path would leave the clear space is not used');
  const roofed=new WorldTour(views,9);for(let t=0;t<300;t+=1){const q=roofed.pose(t,{daylight:1,open:r=>Math.hypot(r[0]-70,r[2]-29)>12});assert.ok(Math.hypot(q.position[0]-70,q.position[2]-29)>11.9||q.id.startsWith('push'),'never under the market roof: '+q.id);}
  const m=makeMove(views[2],'orbit',20,1);assert.ok(Math.abs(Math.hypot(m.at(0).position[0]-70,m.at(0).position[2]-29)-Math.hypot(13,13))<.01,'orbit keeps its radius');
});

test('VF5: with nobody in Eden, Broadcast tours the town instead of holding a pose', () => {
  const b=new WorldBroadcast();b.hints=()=>({soulEntity:()=>null,eden:true,daylight:1});
  const scene={bounds:[-22,-22,22,22] as [number,number,number,number],levels:[],surfaces:[],obstacles:[],links:[]};
  const a=b.sample({},{},scene,100,.05,16/9,0,1/60),z=b.sample({},{},scene,200,.05,16/9,5,1/60);
  assert.ok(a?.pose&&z?.pose&&a.shot?.startsWith('tour:'),String(a?.shot));
  assert.notDeepEqual(a!.pose.position,z!.pose.position,'it moves');
  b.hints=()=>({soulEntity:()=>null,eden:false});assert.equal(new WorldBroadcast().sample({},{},scene,0,.05,1,0,1/60),null);
});
