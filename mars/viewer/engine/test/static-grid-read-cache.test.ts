import test from 'node:test';
import assert from 'node:assert/strict';
import {buildGrids,buildStaticGrids,withStaticGridReadCache,updateGrids,gridsWithObstacles,type GridSet} from '../spatial/grid.ts';
import {findRoute} from '../spatial/path.ts';
import {HUMAN_PROFILE,type SpatialScene} from '../spatial/types.ts';
const scene=():SpatialScene=>({bounds:[-3,-3,3,3],levels:[{id:0,y:0,label:'ground'}],surfaces:[{id:'ground',level:0,y:0,obb:{c:[0,0],half:[3,3],yaw:0}}],obstacles:[{id:'wall',y0:0,y1:2,obb:{c:[0,0],half:[.12,1],yaw:0}}],links:[]});
function same(a:GridSet,b:GridSet){assert.equal(a.cell,b.cell);assert.deepEqual([...a.levels.keys()],[...b.levels.keys()]);for(const [id,g] of a.levels){const q=b.levels.get(id)!;for(const k of ['level','y','cell','nx','nz','ox','oz','x0','z0'] as const)assert.equal(g[k],q[k]);assert.deepEqual(g.free,q.free);assert.deepEqual(new Uint32Array(g.clearance.buffer),new Uint32Array(q.clearance.buffer));assert.deepEqual([...g.blockers],[...q.blockers]);}}
test('cached static raster/EDT snapshots are bit-identical, independent writable copies and remain exact through incremental edits',()=>{
 const s=scene(),reference=buildGrids(s,.1,undefined,true),first=withStaticGridReadCache(()=>buildStaticGrids(s,.1,undefined,true)),second=withStaticGridReadCache(()=>buildStaticGrids(structuredClone(s),.1,undefined,true));same(first,reference);same(second,reference);assert.notEqual(first.levels.get(0),second.levels.get(0));assert.notEqual(first.levels.get(0)!.blockers,second.levels.get(0)!.blockers);
 const g=first.levels.get(0)!;g.free.fill(0);g.clearance.fill(0);g.blockers.set(0,'poisoned runtime dictionary');same(withStaticGridReadCache(()=>buildStaticGrids(s,.1,undefined,true)),reference);
 const edited=structuredClone(s);edited.obstacles.push({id:'new-wall',y0:0,y1:2,obb:{c:[1.5,0],half:[.1,1],yaw:0}});const patch=updateGrids(second,s,edited,.1);assert.ok(patch);same(patch,buildGrids(edited,.1,undefined,true));same(withStaticGridReadCache(()=>buildStaticGrids(s,.1,undefined,true)),reference);
});
test('exact assembled geometry invalidates obstacle/nav/surface/order/height/cell changes, with route profiles checked afresh',()=>{
 const original=scene();withStaticGridReadCache(()=>buildStaticGrids(original,.1,undefined,true));
 const edits:((s:SpatialScene)=>void)[]=[s=>{s.obstacles[0].obb.c[0]=1;},s=>{s.obstacles[0].y0=3;s.obstacles[0].y1=4;},s=>{s.bounds[2]=4;s.surfaces[0].obb.half[0]=4;},s=>{s.surfaces[0].obb.half[1]=1.5;},s=>{s.levels[0].y=3;s.surfaces[0].y=3;},s=>{s.obstacles.unshift({...structuredClone(s.obstacles[0]),id:'first-cover'});}];
 for(const edit of edits){const s=structuredClone(original);edit(s);for(const cell of [.1,.2])same(withStaticGridReadCache(()=>buildStaticGrids(s,cell,undefined,true)),buildGrids(s,cell,undefined,true));}
 const grids=withStaticGridReadCache(()=>buildStaticGrids(original,.1,undefined,true));for(const radius of [.28,1.2]){const profile={...HUMAN_PROFILE,radius},start={level:0,p:[-2,0] as [number,number]},goal={level:0,p:[2,0] as [number,number]};assert.deepEqual(findRoute(grids,original,profile,start,goal),findRoute(buildGrids(original),original,profile,start,goal));}
});
test('fresh dynamic blocker grids never mutate the cached static product and scope closes before async continuation or exception',async()=>{
 const s=scene(),staticGrids=withStaticGridReadCache(()=>buildStaticGrids(s,.1,undefined,true)),person={id:'moving-person',y0:0,y1:1.8,obb:{c:[-1,0] as [number,number],half:[.3,.3] as [number,number],yaw:0}};
 same(gridsWithObstacles(staticGrids,[person]),buildGrids({...s,obstacles:[...s.obstacles,person]}));person.obb.c[0]=1;same(gridsWithObstacles(staticGrids,[person]),buildGrids({...s,obstacles:[...s.obstacles,person]}));same(withStaticGridReadCache(()=>buildStaticGrids(s,.1,undefined,true)),buildGrids(s,.1,undefined,true));
 assert.throws(()=>withStaticGridReadCache(()=>{buildStaticGrids(s);throw Error('read failed');}),/read failed/);const later=withStaticGridReadCache(()=>Promise.resolve().then(()=>buildStaticGrids(s)));same(await later,buildGrids(s));
});
