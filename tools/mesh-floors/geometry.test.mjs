import test from 'node:test';
import assert from 'node:assert/strict';
import {extractFloorPatches} from './geometry.mjs';
const rect=(x0,x1,z0,z1,y,node='floor')=>[{node,points:[[x0,y,z0],[x0,y,z1],[x1,y,z1]]},{node,points:[[x0,y,z0],[x1,y,z1],[x1,y,z0]]}];
const covers=(p,x,z)=>p.polygons.some(q=>x>q[0][0]&&x<q[2][0]&&z>q[0][1]&&z<q[2][1]);
test('connected triangles produce the exact flat rectangle with provenance',()=>{
 const r=extractFloorPatches(rect(0,4,0,3,.2),{cell:.1});assert.equal(r.patches.length,1);assert.equal(r.patches[0].area,12);assert.equal(r.patches[0].y,.2);assert.deepEqual(r.patches[0].nodes,['floor']);assert.equal(r.patches[0].polygons.length,1);
});
test('an L floor retains its courtyard hole and disconnected islands stay separate',()=>{
 const r=extractFloorPatches([...rect(0,2,0,4,.2),...rect(2,4,0,2,.2),...rect(6,8,0,2,.2)],{cell:.1});assert.equal(r.patches.length,2);assert.equal(r.patches.reduce((s,p)=>s+p.area,0),16);assert.ok(!r.patches.some(p=>covers(p,3,3)));assert.ok(!r.patches.some(p=>covers(p,5,1)));
});
test('shelves deny headroom, vertical/downward triangles are never floor support',()=>{
 const down=rect(0,4,0,4,2).map(t=>({...t,points:[...t.points].reverse()}));
 const r=extractFloorPatches([...rect(0,4,0,4,.2),...rect(1,3,1,3,1.1,'shelf'),...down],{cell:.1});assert.ok(!r.patches.filter(p=>p.y===.2).some(p=>covers(p,2,2)));assert.ok(!r.patches.some(p=>p.y===2));
});
test('bounded extraction fails explicitly instead of emitting partial geometry',()=>{
 assert.throws(()=>extractFloorPatches(rect(0,100,0,100,0),{maxCells:100}),/exceeds 100 cells/);
});
