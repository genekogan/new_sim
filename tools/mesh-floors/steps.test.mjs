import test from 'node:test';
import assert from 'node:assert/strict';
import {extractFloorPatches} from './geometry.mjs';
import {stairAccess} from './steps.mjs';
const rect=(x0,x1,z0,z1,y,node='tread')=>[{node,points:[[x0,y,z0],[x0,y,z1],[x1,y,z1]]},{node,points:[[x0,y,z0],[x1,y,z1],[x1,y,z0]]}];
const analyse=triangles=>{const {patches}=extractFloorPatches(triangles,{cell:.1});return {patches,...stairAccess(patches,triangles)};};
const flight=()=>Array.from({length:5},(_,i)=>rect(i*1.2,(i+1)*1.2,0,2,.2+i*.35)).flat();
test('three-rise flight admits only connected upper support and keeps provenance',()=>{
 const r=analyse([...flight(),...rect(10,12,0,2,2,'unconnected roof')]);
 assert.ok(r.links.length>=4);assert.equal(r.reached.length,5);assert.ok(!r.reached.some(i=>r.patches[i].nodes.includes('unconnected roof')));
 assert.ok(r.links.every(l=>l.y1-l.y0<=.45));assert.equal(r.provenance.length,r.links.length);
});
test('isolated table, broken rise and missing tread cannot become a stair flight',()=>{
 assert.equal(analyse([...rect(0,2,0,2,.2),...rect(2,4,0,2,.55)]).links.length,0);
 assert.equal(analyse(flight().filter((_,i)=>i<4||i>=6)).links.length,0);
 const broken=flight().map(t=>({...t,points:t.points.map(p=>[p[0],p[1]>1?p[1]+1:p[1],p[2]])}));
 assert.equal(analyse(broken).links.length,0);
});
test('coplanar landing joins only across a short physical seam, not a missing slab',()=>{
 const r=analyse([...flight(),...rect(6.08,8,0,2,1.6,'landing'),...rect(8.3,10,0,2,1.6,'isolated')]);
 assert.ok(r.reached.some(i=>r.patches[i].nodes.includes('landing')));
 assert.ok(!r.reached.some(i=>r.patches[i].nodes.includes('isolated')));
});
