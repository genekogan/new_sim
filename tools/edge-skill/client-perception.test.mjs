import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openClientPerception} from './client-perception.mjs';
test('complete paged gazetteer, lean unchanged-place wake and restart coverage are honest',async t=>{
 const root=mkdtempSync(join(realpathSync(tmpdir()),'eden-perception-'));t.after(()=>rmSync(root,{recursive:true,force:true}));let place='field';const paths=[];
 const catalogue=[{id:'field',name:'Commons',walkable:true,kind:'outdoor',centre:[0,0]},{id:'eden-tea-house',name:'Tea house',walkable:true,kind:'outdoor',centre:[10,0]}];
 const call=async path=>{paths.push(path);if(path==='/v1/edge/boot')return {status:200,data:{staticEtag:'etag1',static:{completeStaticEtag:'etag1',places:[],destinationPages:[{url:'/v1/edge/boot/static/page0',etag:'page1'}]},clock:{realMsPerWorldMinute:2500}}};if(path.includes('page0'))return {status:200,data:{catalogueEtag:'etag1',places:catalogue}};if(path.endsWith('capabilities'))return {status:200,data:{capabilities:[{id:'sit:here'}]}};return {status:200,data:{here:{tick:4,me:{place,placePath:[place],pos:[0,0]},near:[],exits:[]}}};};
 let p=openClientPerception(root,{call,scope:'synthetic'});await p.boot();await p.wake();await p.wake();assert.equal(paths.filter(x=>x.endsWith('capabilities')).length,1);assert.ok(!paths.some(x=>x.includes('observe')));assert.match(p.truthful('All zones mapped'),/1\/2/);
 place='eden-tea-house';await p.wake();assert.equal(paths.filter(x=>x.endsWith('capabilities')).length,2);p=openClientPerception(root,{call,scope:'synthetic'});assert.equal(p.coverage().complete,true);assert.equal(p.truthful('All zones mapped'),'All zones mapped');
});

test('full public catalogue identities never become destinations when boot admits none',async t=>{
 const root=mkdtempSync(join(realpathSync(tmpdir()),'eden-perception-reference-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const paths=[],p=openClientPerception(root,{scope:'synthetic',call:async path=>{paths.push(path);return path.endsWith('/boot')?{status:200,data:{apiContract:'eden-edge/1.1',worldId:'world-identity',staticEtag:'manifest',static:{places:[]},fullMap:{url:'/v1/edge/boot/places',etag:'public-catalogue'}}}:{status:200,data:{places:[{id:'unadmitted-upper',name:'Upper scenery',access:'unsupported-floor',walkable:true}]}};}});await p.boot();assert.equal(p.coverage().total,0);assert.equal(p.snapshot().places.length,0);assert.ok(p.snapshot().references.some(r=>r.id==='unadmitted-upper'));assert.equal(paths.filter(x=>x==='/v1/edge/boot/places').length,1);
});
