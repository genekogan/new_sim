import test from 'node:test';import assert from 'node:assert/strict';import {ByteMeter,megabytes} from './asset-bytes.ts';
const settle=()=>new Promise(r=>setTimeout(r,130));
(globalThis as {location?:unknown}).location??={href:'http://127.0.0.1/w/eden'};
test('the total is the declared sizes up front; streamed bytes count as they arrive; files are never the unit',async()=>{
 const m=new ByteMeter();m.expect({'/browser/campus.glb':70_000_000,'/modular/a.glb':2_000_000});await settle();
 assert.deepEqual(m.snapshot(),{loaded:0,total:72_000_000,known:true});
 m.start('/modular/a.glb?v=1');m.headers('/modular/a.glb?v=1',2_000_000);m.progress('/modular/a.glb?v=1',2_000_000);m.done('/modular/a.glb?v=1',true);
 m.start('http://127.0.0.1/browser/campus.glb?v=2');m.progress('/browser/campus.glb',35_000_000);await settle();
 // one of two files done is not 50%: 37 of 72 MB
 assert.deepEqual(m.snapshot(),{loaded:37_000_000,total:72_000_000,known:true});
 assert.equal(megabytes(m.snapshot()),'35 of 69 MB');
});
test('an unexpected file adds its Content-Length; a compressed or unknown length adds nothing until it ends',async()=>{
 const m=new ByteMeter();await settle();assert.equal(m.snapshot().known,false);
 m.start('/x.glb');m.headers('/x.glb',1000);m.start('/y.glb');m.headers('/y.glb',null);m.progress('/y.glb',400);await settle();
 assert.deepEqual(m.snapshot(),{loaded:0,total:1000,known:false});
 m.done('/y.glb',true);await settle();assert.deepEqual(m.snapshot(),{loaded:400,total:1400,known:false});
 assert.equal(megabytes({loaded:1_572_864,total:5_242_880}),'1.5 of 5.0 MB');
});
