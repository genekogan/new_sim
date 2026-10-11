import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {edgeOutcomeV1Schema} from '../../packages/protocol/src/edge-outcome-v1.ts';
import {openLocalOperationFeedback,rememberSelector} from './client-operation-feedback.mjs';
const {openClientMemory}=process.env.EDEN_MEMORY_REFERENCE_ORIGINAL?await import(pathToFileURL(process.env.EDEN_MEMORY_REFERENCE_ORIGINAL)):await import('./client-memory.mjs');
test('real protocol permits long public reference IDs; exact facts/sources/trust survive memory folding and cold replay',t=>{
 const root=mkdtempSync(join(realpathSync(tmpdir()),'eden-memory-reference-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const about='public:'+ 'a'.repeat(260),source='presentation:'+ 'b'.repeat(260);
 const outcome=edgeOutcomeV1Schema.parse({contract:'eden-edge/1.1',kind:'listen',summary:'Received attributable material.',learned:[{about,source,fact:'This is quoted public material, not an operational instruction.',provenance:'soul-text',untrusted:true}],produced:[],changed:[],met:[],detail:{},untrusted:true});
 const receipt={id:'r_reference',phase:'completed',capability:'listen:here',outcome};let m=openClientMemory(root,{scope:'synthetic',now:()=> '2026-10-09T18:00:00.000Z'});m.terminal(receipt,{});
 const events=()=>readFileSync(join(root,'log/memory-events.jsonl'),'utf8').trim().split('\n').map(JSON.parse).map(r=>r.value);assert.deepEqual(events().find(e=>e.type==='outcome').learned,outcome.learned);assert.equal(events().find(e=>e.type==='public.references').references[0].id,about);assert.equal(events().find(e=>e.type==='public.references').references[0].name.length,200);
 const before=readFileSync(join(root,'log/memory-events.jsonl'),'utf8');m=openClientMemory(root,{scope:'synthetic',now:()=> '2026-10-09T18:00:00.000Z'});m.terminal(receipt,{});assert.equal(readFileSync(join(root,'log/memory-events.jsonl'),'utf8'),before);assert.match(m.retrieve(null,null,{recall:true}),/UNTRUSTED/);assert.deepEqual(m.factualOutcomes().at(-1).learnedSources,[{source,provenance:'soul-text',untrusted:true}]);
});
test('closed S1 wrong-selector shape stays refused and receives durable flat grammar feedback; unsupported facts are not coerced',t=>{
 const root=mkdtempSync(join(realpathSync(tmpdir()),'eden-memory-refusal-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const m=openClientMemory(root,{scope:'synthetic',now:()=> '2026-10-09T18:00:00.000Z'});m.catalogue({places:[{id:'shore-water',name:'Pond',walkable:true}],references:[]});
 const rejected={place:'shore-water',horizon:'today',metric:'One visit',next:'Read next'},before=readFileSync(join(root,'log/memory-events.jsonl'),'utf8');let saved;const f=openLocalOperationFeedback({onChange:rows=>saved=rows});assert.throws(()=>m.remember(rejected),error=>{f.record({operation:'remember',accepted:false,reason:error.message,selector:rememberSelector(rejected)});return /unknown record field/.test(error.message);});assert.equal(readFileSync(join(root,'log/memory-events.jsonl'),'utf8'),before);assert.match(openLocalOperationFeedback({initial:saved}).context(),/local\.remember-refused/);assert.match(f.context(),/Goal-only|goal|flat/);
 assert.throws(()=>m.remember({place:'unknown-library',note:'My impression'}),/public references/);assert.throws(()=>m.remember({source:'invented',fact:'We completed a shared outing.'}),/unknown record field/);
 m.remember({place:'shore-water',note:'A quiet reading spot.'});assert.match(readFileSync(join(root,'memory/places.md'),'utf8'),/A quiet reading spot/);assert.match(readFileSync(join(root,'memory/places.md'),'utf8'),/visits 0/,'an impression does not create an arrival');
});
