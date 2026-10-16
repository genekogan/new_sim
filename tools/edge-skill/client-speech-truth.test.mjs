// R2 truth lane (2026-10-16 longrun): pre-written speech must not outlive the body step it describes,
// owner reports go to the owner channel, and owner answers arrive whole.
import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {openClientQueue} from './client-queue.mjs';import {executeReplySteps} from './client-execution.mjs';import {publishCompletedOwnerQueue} from './client-owner-result.mjs';
import {ownerReplyWithLocalResults,ownerAnswerText,routeOwnerReport} from './client-owner-reply.mjs';

const WALK='take a walk through the Green field';
const FALSE_REPORT='Finished my solo tour of the Green field. I strolled around the lovely open space, stretching where the grass was soft. The field is peaceful today—I saw Ada resting and Cleo reading nearby. Stayed well away from any construction as you asked.';
const ctx={placeId:'green-field',busy:null};
function world(t){
 const dir=mkdtempSync(join(tmpdir(),'speech-truth-')),sent=[],spoken=[],receipts=new Map();let n=0;
 const runPublic=async step=>{if(step.say||step.text)spoken.push(step.say??step.text);return {accepted:true,line:'said (heard by 2)'};};
 const queue=openClientQueue(dir,{scope:'world|s_basil',adapter:{
  async send(body){sent.push(body.capability);if(body.capability===WALK)return {accepted:false,code:'site.under-construction',reason:'walk1 is under construction'};const id='r_'+(++n);const r={id,capability:body.capability,phase:'started'};receipts.set(id,r);return {accepted:true,receipt:r};},
  readReceipt:async id=>receipts.get(id),context:async()=>ctx,runPublic,
 }});
 t.after(()=>{queue.close();rmSync(dir,{recursive:true,force:true});});
 const finish=()=>{for(const r of receipts.values())r.phase='completed';};
 const run=(steps,o)=>executeReplySteps(steps,{queue,pump:()=>queue.pump(ctx),runPublic,...o});
 return {queue,sent,spoken,finish,run};
}

test("Basil 03:18-03:43 replay: refused walk, refused repairs, sit repair; the pre-written tour report is never said",async t=>{
 const w=world(t),id='req-6e255343';
 // 03:18:11 owner wake: [walk, stretch, say report]; the walk is refused at admission.
 let r=await w.run([{act:WALK,params:{seconds:600}},{act:'stretch:here',params:{seconds:60}},{say:FALSE_REPORT}],{id,source:'owner',replace:true});
 assert.match(r.results[0].line,/failed: site.under-construction\. Dependent public steps have not run/);
 // 03:18:16 / 03:18:21 follow-ups on the same owner request re-plan [stretch, say]: retained queue, still failed.
 r=await w.run([{act:'stretch:here',params:{seconds:60}},{say:'I wanted to take a full stroll... I have stretched here.'}],{id,source:'owner',replace:true});
 assert.equal(r.results[0].accepted,false);
 // 03:40:25 an autonomous sit without fixes may not drop the owner queue.
 r=await w.run([{act:'sit:here',params:{}},{converse:'say',id:'cv_E439LNlvN0JZ',text:'You are right, Cleo.'}],{id:'wake-a',source:'mind',replace:true});
 assert.match(r.results[0].line,/explicit current fixes continuation/);
 const failed=w.queue.snapshot().steps[0];assert.equal(failed.status,'failed');
 // 03:40:41 repair with a body step plus a new say: refused (one replacement body step only).
 r=await w.run([{act:'stretch:here',params:{},fixes:failed.id},{say:'I set out to tour the Green field...'}],{id:'wake-b',source:'mind',replace:true});
 assert.match(r.results[0].line,/repair needs one replacement body step/);
 // 03:40:56 the accepted repair: sit replaces the refused walk.
 r=await w.run([{act:'sit:here',params:{},fixes:failed.id}],{id:'wake-c',source:'mind',replace:true});
 assert.ok(r.results.some(x=>x.code==='local.speech-redraft'&&/Dropped 1 pre-written speech step queued after the refused take a walk/.test(x.line)),'the mind is told to redraft');
 assert.ok(r.results.every(x=>x.accepted!==false),'the repair itself is accepted');
 let q=w.queue.snapshot();assert.equal(q.id,id,'repair continues the owner request');
 assert.deepEqual(q.steps.map(s=>[s.act,s.status]),[['sit:here','running'],['stretch:here','pending'],['say','skipped']]);
 assert.equal(q.steps[2].redraft,true);assert.match(q.steps[2].reason,/drafted before take a walk through the Green field was refused; not spoken/);
 assert.equal(q.repairs[0].droppedSpeech[0],q.steps[2].id);
 // 03:42:56 sit completes, stretch runs; 03:43:56 stretch completes. Before this fix the false report went out here.
 w.finish();await w.queue.pump(ctx);w.finish();await w.queue.pump(ctx);await w.queue.pump(ctx);
 q=w.queue.snapshot();assert.deepEqual(q.steps.map(s=>s.status),['completed','completed','skipped']);
 assert.deepEqual(w.spoken,[],'no pre-written claim of success goes out aloud');
 assert.deepEqual(w.sent,[WALK,'sit:here','stretch:here']);
 // The owner's canonical completion record shows the dropped report, not a spoken success.
 const replies=[{id,answer:'Queue retained, but the walk failed'}],published=[];
 const final=await publishCompletedOwnerQueue(q,{readReplies:()=>replies,publish:x=>published.push(x)});
 assert.match(final.answer,/say: skipped \(drafted before take a walk through the Green field was refused; not spoken\)/);
 assert.match(final.answer,/Fulfillment of your original request has not been confirmed/);
});

test('ordinary chat is not silenced: speech before a refusal, and speech in a plan whose body succeeds, are said',async t=>{
 const w=world(t);
 await w.run([{say:'Hello, Ada!'},{act:WALK},{say:'Back from my walk.'}],{id:'wake-1',source:'mind'});
 assert.deepEqual(w.spoken,['Hello, Ada!'],'speech queued before the refused body step already ran');
 const failed=w.queue.snapshot().steps[1];await w.run([{act:'sit:here',fixes:failed.id}],{id:'wake-2',source:'mind',replace:true});
 assert.equal(w.queue.snapshot().steps[2].status,'skipped');
 w.finish();await w.queue.pump(ctx);
 await w.run([{act:'stretch:here'},{say:'That stretch felt good.'},{converse:'leave',id:'cv_1'}],{id:'wake-3',source:'mind',replace:true});
 w.finish();await w.queue.pump(ctx);
 assert.deepEqual(w.spoken,['Hello, Ada!','That stretch felt good.']);
 // A converse step without text (leave) is not speech and is never dropped by a repair.
 assert.equal(w.queue.snapshot().steps.at(-1).status,'completed');
});

test("Ada 03:31: in the wake after her owner request's queue finished, a bare say report goes to the owner, not aloud",()=>{
 const report='I completed my solo tour of the Green field. I sat here and read about this world. I stayed clear of the walk-lighthouse construction area as you asked.';
 const r=routeOwnerReport([{say:report}],undefined);
 assert.deepEqual(r.steps,[],'nothing is spoken');assert.equal(r.owner,report);assert.equal(r.routed,1);assert.match(r.line,/sent to your owner privately, not said aloud/);
 // The mind that also answers in "owner" may still speak aloud.
 const both=routeOwnerReport([{say:'Good evening, Basil.'},{act:'lie:here'}],'Tour done; the stroll was refused, so I read instead.');
 assert.deepEqual(both.steps,[{say:'Good evening, Basil.'},{act:'lie:here'}]);assert.equal(both.routed,0);
 // Conversation turns and body steps are never rerouted.
 const conv=routeOwnerReport([{converse:'say',id:'cv_1',text:'Hi'},{act:'sit:here'}],undefined);
 assert.equal(conv.routed,0);assert.equal(conv.steps.length,2);
});

test('a 1,200-character owner answer arrives whole; an over-long one is cut only at a sentence end',()=>{
 const sentence='At the top of the hour I sat on the grass by the field, read two passages about the gardens, and talked with Ada and Cleo about the evening light. ';
 const answer=sentence.repeat(9).trim();assert.ok(answer.length>=1200&&answer.length<1400,String(answer.length));
 assert.equal(ownerAnswerText(answer),answer);
 assert.equal(ownerReplyWithLocalResults({answer,source:'model-unverified',localResults:[{operation:'remember',accepted:true,line:'Memory judgment saved (goal).'}]}).answer,answer);
 const results=Array.from({length:8},(_,i)=>`Retained ordered step ${i} in queue req-1; actual receipt r_${i} is started.`);
 assert.equal(ownerReplyWithLocalResults({source:'execution-verdict',results}).answer,results.join('; '));
 const long=sentence.repeat(60).trim(),cut=ownerAnswerText(long);
 assert.ok(cut.length<long.length&&cut.length<=4000);assert.match(cut,/evening light\. …$/,'cut at a sentence end, marked');
 assert.equal(ownerAnswerText(null),null);
});
