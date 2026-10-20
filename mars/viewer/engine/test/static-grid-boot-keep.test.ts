// G9 lane Z1b: a release's standby process builds its restored world's static grids inside keepStaticGridsForBoot; the
// boot after the go takes that exact set once (same geometry key as the read cache), builds any other scene as before,
// and drops what it kept after a few builds without a match. Grids handed over are bit-identical to a fresh build.
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildGrids,buildStaticGrids,gridsWithObstacles,keepStaticGridsForBoot,updateGrids,type BootGridStore,type GridSet} from '../spatial/grid.ts';
import type {Obstacle,SpatialScene} from '../spatial/types.ts';
const scene=(x=0):SpatialScene=>({bounds:[-3,-3,3,3],levels:[{id:0,y:0,label:'ground'}],surfaces:[{id:'ground',level:0,y:0,obb:{c:[0,0],half:[3,3],yaw:0}}],obstacles:[{id:'wall',y0:0,y1:2,obb:{c:[x,0],half:[.12,1],yaw:0}}],links:[]});
function same(a:GridSet,b:GridSet){assert.equal(a.cell,b.cell);for(const [id,g] of a.levels){const q=b.levels.get(id)!;assert.deepEqual(g.free,q.free);assert.deepEqual(g.clearance,q.clearance);assert.deepEqual([...g.blockers],[...q.blockers]);}}

test('the boot takes the grids its standby kept, once, and they equal a fresh build',()=>{
  let built:GridSet|undefined;
  assert.equal(keepStaticGridsForBoot(()=>{built=buildStaticGrids(scene(),.1,undefined,true);}),1);
  const boot=buildStaticGrids(structuredClone(scene()),.1,undefined,true);
  same(boot,built!);
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
  const kept=buildStaticGrids(scene(),.1);same(kept,built!);assert.notEqual(kept,built,'unpacked: its own storage');
  keepStaticGridsForBoot(()=>{built=buildStaticGrids(scene(),.1);});
  for(let i=0;i<4;i++)buildStaticGrids(scene(1+i/10),.1);
  assert.notEqual(buildStaticGrids(scene(),.1),built,'dropped after four misses');
  same(buildStaticGrids(scene(),.2),buildGrids(scene(),.2));
});

// lane t4-mem: a kept set waits packed (16-bit squared EDT distances, 16-bit blocker indices, no column pass), in a store
// (the standby's file) when one is given; what the boot takes is bit-identical to a fresh build and patches identically.
const memStore=()=>{const files=new Map<string,Uint8Array>(),log:string[]=[];const store:BootGridStore={put(n,parts){log.push('put '+n);const len=parts.reduce((a,p)=>a+p.byteLength,0),b=new Uint8Array(len);let at=0;for(const p of parts){b.set(p,at);at+=p.byteLength;}files.set(n,b);},take(n){log.push('take '+n);const b=files.get(n)??null;files.delete(n);return b;},drop(n){log.push('drop '+n);files.delete(n);}};return {store,files,log};};
const room=(x=0):SpatialScene=>({bounds:[-4,-3,4,3],levels:[{id:0,y:0,label:'ground'},{id:1,y:3,label:'upper',crop:[-2,-2,2,2]}],surfaces:[{id:'ground',level:0,y:0,obb:{c:[0,0],half:[4,3],yaw:0}},{id:'deck',level:1,y:3,obb:{c:[0,0],half:[1.5,1.5],yaw:.3}}],obstacles:[{id:'wall',y0:0,y1:2,obb:{c:[x,0],half:[.12,1.4],yaw:.4}},{id:'post',y0:3,y1:5,obb:{c:[.5,.5],half:[.2,.2],yaw:0}},{id:'box',y0:0,y1:1,obb:{c:[-2,1],half:[.5,.3],yaw:1.1}}],links:[]});

test('packed in a store: the boot reads the file once, removes it, and gets a fresh build bit for bit',()=>{
  const {store,files,log}=memStore();
  keepStaticGridsForBoot(()=>{buildStaticGrids(room(),.1,undefined,true);},store);
  assert.equal(files.size,1,'written to the store');
  const fileBytes=[...files.values()][0].byteLength,cells=[...buildGrids(room(),.1).levels.values()].reduce((a,g)=>a+g.nx*g.nz,0);
  assert.ok(fileBytes<=16+cells*4+64,`2 bytes of distance + 2 of blocker per cell (${fileBytes} for ${cells} cells)`);
  const boot=buildStaticGrids(structuredClone(room()),.1,undefined,true),fresh=buildGrids(room(),.1,undefined,true);
  same(boot,fresh);same(fresh,boot);
  assert.equal(log.length,2);assert.match(log[0],/^put \d+$/);assert.equal(log[1],log[0].replace('put','take'));assert.equal(files.size,0);
  for(const [id,g] of fresh.levels)assert.equal(boot.levels.get(id)!.blockers.size,g.blockers.size);
  // the column pass comes back when first needed: patches and people-as-obstacles read the same as on a fresh build
  const moved=room(1);
  same(updateGrids(boot,room(),moved,.1)!,updateGrids(fresh,room(),moved,.1)!);
  const person:Obstacle[]=[{id:'p',y0:0,y1:1.8,obb:{c:[2,-1],half:[.3,.3],yaw:0}}];
  same(gridsWithObstacles(boot,person),gridsWithObstacles(fresh,person));
});

test('a field too open for 16 bits waits unpacked and still equals a fresh build',()=>{
  const open:SpatialScene={bounds:[-30,-30,30,30],levels:[{id:0,y:0,label:'ground'}],surfaces:[{id:'g',level:0,y:0,obb:{c:[0,0],half:[30,30],yaw:0}}],obstacles:[],links:[]};
  const {store,files}=memStore();
  keepStaticGridsForBoot(()=>{buildStaticGrids(open,.1);},store);
  assert.ok([...files.values()][0].byteLength>=600*600*7,'clearance as float32, free and blockers as they are');
  same(buildStaticGrids(open,.1),buildGrids(open,.1));
});

test('a store file that is gone, cut short or not this process\'s builds afresh; a failed write keeps the set in memory',()=>{
  for(const spoil of [(f:Map<string,Uint8Array>)=>f.clear(),(f:Map<string,Uint8Array>)=>f.set('0',[...f.values()][0].subarray(8)),(f:Map<string,Uint8Array>)=>{const b=[...f.values()][0];b[0]^=1;}]){
    const {store,files}=memStore();
    keepStaticGridsForBoot(()=>{buildStaticGrids(room(),.1);},store);
    spoil(files);
    same(buildStaticGrids(room(),.1),buildGrids(room(),.1));
  }
  const {store,log}=memStore();
  keepStaticGridsForBoot(()=>{buildStaticGrids(room(),.1);},{...store,put(){throw new Error('ENOSPC');}});
  same(buildStaticGrids(room(),.1),buildGrids(room(),.1));
  assert.equal(log.length,1);assert.match(log[0],/^drop \d+$/);
});

test('kept files are removed when the boot never asks for them (four misses, or the next keep)',()=>{
  const {store,files}=memStore();
  keepStaticGridsForBoot(()=>{buildStaticGrids(room(),.1);},store);
  for(let i=0;i<4;i++)buildStaticGrids(room(1+i/10),.1);
  assert.equal(files.size,0,'dropped after four misses');
  keepStaticGridsForBoot(()=>{buildStaticGrids(room(),.1);},store);
  keepStaticGridsForBoot(()=>{buildStaticGrids(room(2),.1);},store);
  assert.equal(files.size,1,'a new keep drops the last one');
  buildStaticGrids(room(2),.1);
});
