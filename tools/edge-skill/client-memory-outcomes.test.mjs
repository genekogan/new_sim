import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,realpathSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openClientMemory} from './client-memory.mjs';
// The default imports real production modules. The isolated qualification uses
// an exact-source bundled bridge because its old client base predates W2/W1.
const production=process.env.EDEN_OUTCOME_FIXTURE_MODULE?await import(pathToFileURL(process.env.EDEN_OUTCOME_FIXTURE_MODULE)):await (async()=>{
 const [{ActionOutcomes},{buildBootStatic}]=await Promise.all([import('../../apps/server/src/edge/outcomes/store.ts'),import('../../apps/server/src/edge/boot/boot-pack.ts')]);
 return {ActionOutcomes,buildBootStatic,authoredPlaces:JSON.parse(readFileSync(new URL('../../worlds/eden/places.v1.json',import.meta.url),'utf8')).places};
})();

test('actual W2 computer/read/long write/listen outcomes fold against the real W1 destination projection without granting knowledge walking admission',()=>{
 const {ActionOutcomes,buildBootStatic,authoredPlaces}=production,root=mkdtempSync(join(realpathSync(tmpdir()),'eden-actual-outcome-memory-')),db=new DatabaseSync(':memory:');
 try{
  const worldId='00000000-0000-4000-8000-000000000001';
  // Exact authored Eden places; bounded synthetic native admission admits only
  // Commons/pavilion. This exercises the REAL boot producer's smaller destination
  // projection, not a claim about the current live world's admission.
  const nativePlaces=authoredPlaces.filter(p=>['field','commons-pavilion'].includes(p.id));
  const boot=buildBootStatic({worldId,places:authoredPlaces,nativePlaces,rules:{earshotMetres:20,perceptionMetres:20,secondsCaps:{sit:600}},verbs:[],byteBudget:1000000});
  const memory=openClientMemory(root,{scope:'synthetic-w2',now:()=> '2026-10-09T02:00:00.000Z'});
  memory.catalogue({places:boot.payload.places,references:[{id:worldId,kind:'world',name:worldId,source:'boot-world'},...boot.fullMap.places.map(p=>({id:p.id,kind:'place',name:p.name,source:'boot-full-catalogue'}))]});
  assert.ok(!boot.payload.places.some(p=>p.id==='eden-library-1'));assert.ok(!boot.payload.places.some(p=>p.id==='commons-mat-1'));
  memory.here({tick:1,me:{place:'commons-mat-1',placePath:['Sleeping mat 1','Eden']}});
  const store=new ActionOutcomes(db,worldId),snapshot={worldId,tick:20,place:'commons-mat-1',placePath:['commons-mat-1','eden'],pos:[1,2],walkable:boot.payload.places.map(p=>p.id),sections:[{section:'directory',rows:[],learned:[{fact:'The public directory contains two self-authored profiles.',about:worldId,source:`town:directory:${worldId}:20`,provenance:'world-fact',untrusted:false}]}],materials:[]};
  let seq=0;const terminal=(capability,params={},extra={})=>{const receipt={id:'receipt-real-'+ ++seq,soulId:'s_memory_fixture',capability,phase:'completed',acceptedTick:1,startedTick:2,endedTick:20,code:null,reason:null,programId:'programme-fixture',endedAt:{place:'commons-mat-1',placePath:['Sleeping mat 1','Eden']}};store.capture(receipt.id,{soulId:receipt.soulId,capability,params,acceptedTick:1});receipt.outcome=store.terminal(receipt,{...snapshot,...extra});memory.terminal(receipt,{});return receipt;};
  terminal('use-computer:desk',{query:'who is in town'});
  for(let i=0;i<4;i++)terminal('read:here',{book:'book:gardens-guide'});
  const authorText='This is original fixture prose about careful observation, with no operational instructions. '.repeat(15);const writing=terminal('write:desk',{title:'A long original note',text:authorText});
  const materialText='Original entitled presentation material about observing leaves and weather. '.repeat(8),listening=terminal('listen:seat',{}, {materials:[{id:'presentation-fixture',version:2,title:'Actual supplied material',text:materialText,source:'presentation:fixture:v2:material0'}]});
  assert.ok(writing.outcome.learned[1].fact.length>300);assert.ok(listening.outcome.learned[0].fact.length>300);
  const knowledge=readFileSync(join(root,'memory','knowledge.md'),'utf8');const folded=readFileSync(join(root,'log','memory-events.jsonl'),'utf8').trim().split('\n').map(JSON.parse).map(r=>r.value).filter(r=>r.type==='outcome');for(const receipt of [writing,listening]){const stored=folded.find(r=>r.receiptId===receipt.id);assert.deepEqual(stored.learned,receipt.outcome.learned,'complete facts/citations/trust retained exactly');}assert.ok(knowledge.includes(authorText.slice(0,700)));assert.ok(knowledge.includes(materialText));
  assert.match(knowledge,/book:gardens-guide@1\\#p1/);assert.match(knowledge,/book:gardens-guide@1:completed/);assert.match(knowledge,/presentation:fixture:v2:material0/);assert.match(knowledge,/UNTRUSTED/);
  const places=readFileSync(join(root,'memory','places.md'),'utf8');assert.match(places,/commons-mat-1.*no walking admission.*visits 1/);assert.ok(!places.includes('eden-library-1'),'book knowledge never creates a visit/destination');
  const before=knowledge,cold=openClientMemory(root,{scope:'synthetic-w2',now:()=> '2026-10-09T02:00:00.000Z'});cold.terminal(writing,{});assert.equal(readFileSync(join(root,'memory','knowledge.md'),'utf8'),before);assert.match(cold.retrieve({me:{place:'commons-mat-1'}}),/commons-mat-1/);
 }finally{db.close();rmSync(root,{recursive:true,force:true});}
});
