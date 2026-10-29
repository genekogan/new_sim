// Target-selection guard: an accessible upper floor cannot substitute for a blocked entrance room.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GodNav, type NavHost } from './god/nav.ts';

test('a mesh entrance with no reachable low room refuses instead of choosing a reachable upper floor',()=>{
  const entity={id:'house',name:'house',def:'house@1',in:{parent:'world'}};
  const def={name:'house',form:'point',components:{},tags:['building'],make:{kind:'mesh'}};
  const room=(id:string,y:number,floor?:number)=>({id,y,...(floor===undefined?{}:{floor}),polygon:[[-4,-3],[4,-3],[4,3],[-4,3]]});
  const baked={rooms:[room('entry',0,0),room('diner',0.53,1),room('upstairs',3)],
    slots:[{id:'front',kind:'stand',p:[0,0,4],yaw:0},
      {id:'entry',kind:'room',p:[0,0,0],yaw:0},
      {id:'diner',kind:'room',p:[0,0.53,0],yaw:0},
      {id:'upstairs',kind:'room',p:[0,3,0],yaw:0}]};
  let upperChecks=0,mezzanineChecks=0,basementChecks=0;
  const model={entities:new Map([['house',entity]]),editSeq:1,ground:()=>({waters:[]}),
    resolvedDef:()=>def,bake:()=>baked,worldPose:()=>({x:0,y:0,z:0,yaw:0,s:1}),pathOf:()=> 'house',get:()=>undefined};
  const nav=new GodNav({model,
    engine:{world:{tick:0,entities:{}},standableNearV1:(at:[number,number])=>at,
      reachV1:(_from:unknown,to:{level:number})=>{if(to.level===3)basementChecks++;if(to.level===2)upperChecks++;if(to.level===1)mezzanineChecks++;return {ok:to.level>0};}},
    levelAt:(_x:number,_z:number,y:number)=>y<0?3:y>1.5?2:y>0.3?1:0,engineOwned:()=>false,
  } as unknown as NavHost);
  const building=nav.thing('house')!;
  const upstairs=nav.thing('house/upstairs')!;
  assert.equal(upstairs.floor,0,'an omitted authored floor defaults to zero');
  assert.equal(upstairs.rise,3,'actual room height still identifies the upper storey');
  assert.equal(nav.goal(building,[0,8]),null,'a blocked entrance has no interior goal');
  assert.equal(mezzanineChecks,0,'a reachable low mezzanine does not replace the lower ground storey');
  assert.equal(upperChecks,0,'the reachable upstairs is never considered as an entrance');
  assert.match(nav.blocked.get('house')??'',/interior.*not reachable/);
  // A retained multi-room footprint may omit authored floor ids entirely; high room height stays authoritative.
  baked.rooms=[room('upstairs',3),room('loft',6)];
  baked.slots=[{id:'front',kind:'stand',p:[0,0,4],yaw:0},{id:'upstairs',kind:'room',p:[0,3,0],yaw:0},{id:'loft',kind:'room',p:[0,6,0],yaw:0}];
  model.editSeq++;
  assert.equal(nav.goal(nav.thing('house')!,[0,8]),null,'an upper-only footprint with omitted floor ids has no entrance goal');
  assert.equal(upperChecks,0,'upper-only rooms are never tried despite default floor zero');
  // Imported footprint validation allows negative y0; a reachable basement must not become the default entrance.
  baked.rooms=[room('cellar',-3,-1),room('entry',0,0)];
  baked.slots=[{id:'front',kind:'stand',p:[0,0,4],yaw:0},{id:'cellar',kind:'room',p:[0,-3,0],yaw:0},{id:'entry',kind:'room',p:[0,0,0],yaw:0}];
  model.editSeq++;
  assert.equal(nav.goal(nav.thing('house')!,[0,8]),null,'a reachable basement does not replace the blocked ground entrance');
  assert.equal(basementChecks,0,'negative-rise rooms are never tried as the default entrance');
});
