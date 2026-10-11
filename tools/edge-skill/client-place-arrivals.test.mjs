import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {placeHierarchy,currentPlaceAncestors,recordedVisitParent} from './client-place-arrivals.mjs';
const modules=process.env.EDEN_COVERAGE_ORIGINAL?await import(pathToFileURL(process.env.EDEN_COVERAGE_ORIGINAL)):{...await import('./client-perception.mjs'),...await import('./client-memory.mjs')};
const full=[{id:'eden',name:'Eden',parent:null,walkable:false,kind:'world'},{id:'eden-east',name:'Eden east',parent:'eden',walkable:true,kind:'outdoor'},{id:'eden-library-1',name:'Library',parent:'eden-east',walkable:true,kind:'building'},{id:'int-library-reading-tables',name:'Library reading tables',parent:'eden-library-1',walkable:false,kind:'interior'},{id:'eden-market-kiosks',name:'Market kiosks',parent:'eden-east',walkable:true,kind:'building'}];
const child='int-library-reading-tables';
const makeRoot=t=>{const dir=mkdtempSync(join(realpathSync(tmpdir()),'eden-parent-coverage-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;};
test('current canonical child observation covers admitted Library parent, not requested nearby kiosks; restart retains coverage',async t=>{
 const dir=makeRoot(t);let place=child;const call=async path=>path==='/v1/edge/boot'?{status:200,data:{apiContract:'eden-edge/1.1',staticEtag:'fixture-full',static:{places:full.filter(p=>p.walkable)},fullMap:{url:'/v1/edge/boot/places',etag:'fixture-full'}}}:path==='/v1/edge/boot/places'?{status:200,data:{places:full}}:{status:200,data:{tick:6999800,me:{place,placePath:['Library reading tables','Library','Eden east','Eden'],pos:[73.4,-7.6]},doHere:[],exits:[]}};
 let p=modules.openClientPerception(dir,{call,scope:'synthetic'});await p.boot();await p.wake();assert.equal(p.coverage().visited,2);assert.ok(!p.coverage().unvisited.includes('eden-library-1'));assert.ok(p.coverage().unvisited.includes('eden-market-kiosks'));
 p=modules.openClientPerception(dir,{call,scope:'synthetic'});assert.equal(p.coverage().visited,2);place='eden-east';await p.wake();assert.ok(p.coverage().unvisited.includes('eden-market-kiosks'),'generic actual end place never proves a requested child visit');
});
test('recorded firstVisit and current catalogue hierarchy persist factual parent coverage without changing terminal or repeating score progress',t=>{
 const dir=makeRoot(t),scope='synthetic',cache={places:full.filter(p=>p.walkable),references:full.map(p=>({id:p.id,kind:'place',name:p.name,source:'synthetic-public-catalogue'})),hierarchy:placeHierarchy(full)};
 const rec={id:'r_library',capability:'walk:eden-library-1',phase:'completed',endedTick:6999800,endedAt:{place:child,placePath:['Library reading tables','Library','Eden east','Eden'],pos:[73.4,-7.6]},outcome:{summary:'Walk completed at Library reading tables.',learned:[],produced:[],met:[],untrusted:false,detail:{firstVisit:{placeId:'eden-library-1',tick:6999800,pos:[73.4,-7.6],source:'place-lore:eden-library-1@1'}}}};
 let m=modules.openClientMemory(dir,{scope,now:()=> '2026-10-09T18:36:02.650Z'});m.catalogue(cache);m.terminal(rec,{});const terminal=m.factualOutcomes();assert.match(readFileSync(join(dir,'memory/places.md'),'utf8'),/Library.*visits 1/);const before=readFileSync(join(dir,'log/memory-events.jsonl'),'utf8');m=modules.openClientMemory(dir,{scope,now:()=> '2026-10-09T18:36:02.650Z'});m.terminal(rec,{});assert.equal(readFileSync(join(dir,'log/memory-events.jsonl'),'utf8'),before);assert.deepEqual(m.factualOutcomes(),terminal);
 assert.equal(terminal.at(-1)?.placeId??terminal.recentReceipts?.at(-1)?.placeId,child);
});
test('legacy labels, knowledge about a place, failed receipts and inconsistent recorded positions cannot manufacture a parent visit',()=>{
 const graph=placeHierarchy([{id:'leaf',name:'Library',parent:undefined}]);assert.deepEqual(currentPlaceAncestors('leaf',graph),['leaf']);assert.throws(()=>placeHierarchy([{id:'a',parent:'b'},{id:'b',parent:'a'}]),/hierarchy/);
 const rec={phase:'completed',endedTick:8,endedAt:{place:'eden-east',pos:[54.4,-21]},outcome:{learned:[{about:'eden-library-1',source:'book:library-window@1#p1'}],detail:{firstVisit:{placeId:'eden-library-1',tick:8,pos:[73.4,-7.6],source:'place-lore:eden-library-1@1'}}}};
 assert.equal(recordedVisitParent(rec),null);assert.equal(recordedVisitParent({...rec,phase:'failed'}),null);assert.equal(recordedVisitParent({...rec,outcome:{learned:rec.outcome.learned}}),null);
});
