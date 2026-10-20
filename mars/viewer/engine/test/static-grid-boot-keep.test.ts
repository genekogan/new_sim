// G9 lane Z1b: a release's standby process builds its restored world's static grids inside keepStaticGridsForBoot; the
// boot after the go takes that exact set once (same geometry key as the read cache), builds any other scene as before,
// and drops what it kept after a few builds without a match. Grids handed over are bit-identical to a fresh build.
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildGrids,buildStaticGrids,keepStaticGridsForBoot,type GridSet} from '../spatial/grid.ts';
import type {SpatialScene} from '../spatial/types.ts';
const scene=(x=0):SpatialScene=>({bounds:[-3,-3,3,3],levels:[{id:0,y:0,label:'ground'}],surfaces:[{id:'ground',level:0,y:0,obb:{c:[0,0],half:[3,3],yaw:0}}],obstacles:[{id:'wall',y0:0,y1:2,obb:{c:[x,0],half:[.12,1],yaw:0}}],links:[]});
function same(a:GridSet,b:GridSet){assert.equal(a.cell,b.cell);for(const [id,g] of a.levels){const q=b.levels.get(id)!;assert.deepEqual(g.free,q.free);assert.deepEqual(g.clearance,q.clearance);assert.deepEqual([...g.blockers],[...q.blockers]);}}

test('the boot takes the grids its standby kept, once, and they equal a fresh build',()=>{
  let built:GridSet|undefined;
  assert.equal(keepStaticGridsForBoot(()=>{built=buildStaticGrids(scene(),.1,undefined,true);}),1);
  const boot=buildStaticGrids(structuredClone(scene()),.1,undefined,true);
  assert.equal(boot,built,'the kept set itself, not a rebuild');
  same(boot,buildGrids(scene(),.1,undefined,true));
  const again=buildStaticGrids(scene(),.1,undefined,true);
  assert.notEqual(again,boot,'handed out once: the next build is its own storage');
  same(again,boot);
});

test('another scene builds as before; after four builds without a match the kept grids are dropped',()=>{
  let built:GridSet|undefined;
  keepStaticGridsForBoot(()=>{built=buildStaticGrids(scene(),.1);});
  const moved=buildStaticGrids(scene(1),.1);
  same(moved,buildGrids(scene(1),.1));
  assert.equal(buildStaticGrids(scene(),.1),built,'still kept after one miss');
  keepStaticGridsForBoot(()=>{built=buildStaticGrids(scene(),.1);});
  for(let i=0;i<4;i++)buildStaticGrids(scene(1+i/10),.1);
  assert.notEqual(buildStaticGrids(scene(),.1),built,'dropped after four misses');
  same(buildStaticGrids(scene(),.2),buildGrids(scene(),.2));
});
