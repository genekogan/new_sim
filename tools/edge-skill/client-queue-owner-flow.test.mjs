// R2 queue lane (2026-10-16 longrun problem #3): client queue and binding rules that blocked owners and sociability.
// Each scenario replays a logged refusal from team/scratch/longrun/{basil,cleo}/live-log.jsonl.
import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {openClientQueue} from './client-queue.mjs';import * as execution from './client-execution.mjs';
const {executeReplySteps,bindLiveSoulReferences}=execution,social=step=>execution.socialIdentityStep?.(step)??false;

const WALK='take a walk through the Green field',STROLL='stroll around the Green field',READ='read a book in the library';
const REPORT='Finished my solo tour of the Green field. I strolled around the lovely open space, stretching where the grass was soft.';
const ctx={placeId:'green-field',busy:null};
function world(t,{refuse=[WALK,STROLL],start=Date.parse('2026-10-16T03:18:11Z')}={}){
 const dir=mkdtempSync(join(tmpdir(),'queue-owner-flow-')),sent=[],spoken=[],wakes=[],receipts=new Map(),clock={now:start};let n=0;
 const runPublic=async step=>{spoken.push(step.say??step.text);return {accepted:true,line:'said'};};
 const queue=openClientQueue(dir,{scope:'world|s_soul',now:()=>clock.now,onWake:reason=>wakes.push(reason),adapter:{
  async send(body){sent.push(body.capability);if(refuse.includes(body.capability))return {accepted:false,code:'site.under-construction',reason:'walk1 is under construction'};const id='r_'+(++n);const r={id,capability:body.capability,phase:'started'};receipts.set(id,r);return {accepted:true,receipt:r};},
  readReceipt:async id=>receipts.get(id),runPublic,
 }});
 t.after(()=>{queue.close();rmSync(dir,{recursive:true,force:true});});
 const at=iso=>{clock.now=Date.parse(iso);};
 const run=(steps,o,context=ctx)=>executeReplySteps(steps,{queue,pump:()=>queue.pump(context),runPublic,...o});
 return {queue,sent,spoken,wakes,receipts,at,run};
}

test('Basil 03:18: a refused walk in an owner queue frees the steps behind it within a minute, not 22',async t=>{
 const w=world(t),id='req-6e255343';
 // 03:18:11 owner wake: [walk, stretch, report]; the walk is refused at admission (site.under-construction).
 let r=await w.run([{act:WALK,params:{seconds:600}},{act:'stretch:here',params:{seconds:60}},{say:REPORT}],{id,source:'owner',replace:true});
 assert.match(r.results[0].line,/failed: site.under-construction/);
 // 03:18:16 and 03:18:21: follow-ups on the same owner request re-plan without a fixes repair.
 w.at('2026-10-16T03:18:16Z');await w.run([{act:'stretch:here',params:{seconds:60}},{say:'I stretched.'}],{id,source:'owner',replace:true});
 w.at('2026-10-16T03:18:21Z');await w.run([{act:'stretch:here',params:{seconds:60}},{say:'I stretched.'}],{id,source:'owner',replace:true});
 // 03:18:41: still inside the repair window, the queue waits for a fixes repair.
 w.at('2026-10-16T03:18:41Z');await w.queue.pump(ctx);
 assert.equal(w.queue.snapshot().steps[0].status,'failed');assert.deepEqual(w.sent,[WALK]);
 // 03:19:12, the first queue check a minute after the refusal: the walk is skipped and the stretch starts.
 // (On lane/truth Basil stayed frozen here until 03:40.)
 w.at('2026-10-16T03:19:12Z');await w.queue.pump(ctx);
 const q=w.queue.snapshot();
 assert.deepEqual(q.steps.map(s=>[s.act,s.status]),[[WALK,'skipped'],['stretch:here','running'],['say','skipped']],'the refused walk is skipped and the queue goes on');
 assert.deepEqual(w.sent,[WALK,'stretch:here']);assert.equal(q.id,id,'still the owner request');
 assert.match(q.steps[0].reason,/walk1 is under construction \(refused; skipped after 61 s without a fixes repair; the queue went on\)/);
 assert.equal(q.steps[2].redraft,true,'the report drafted before the refusal is not said');
 assert.ok(w.wakes.includes('refused-step-skipped'),'the mind is told');
 assert.equal(q.skips[0].act,WALK);assert.deepEqual(q.skips[0].droppedSpeech,[q.steps[2].id]);
 w.receipts.get('r_1').phase='completed';w.at('2026-10-16T03:20:12Z');await w.queue.pump(ctx);
 assert.deepEqual(w.queue.snapshot().steps.map(s=>s.status),['skipped','completed','skipped']);assert.deepEqual(w.spoken,[]);
});

test('Ada 03:20: one refused continuation attempt is enough; the next queue check goes on with the next owner step',async t=>{
 const w=world(t,{start:Date.parse('2026-10-16T03:20:11Z')}),id='req-ada-tour';
 await w.run([{act:STROLL},{act:READ}],{id,source:'owner',replace:true});
 assert.equal(w.queue.snapshot().steps[0].status,'failed');
 // 03:20:15 queue wake: the mind asks to read without a fixes repair. Refused, but the refusal now says what happens next.
 w.at('2026-10-16T03:20:15Z');const r=await w.run([{act:READ,params:{}}],{id:'wake-ada',source:'mind',replace:true});
 assert.match(r.results[0].line,/explicit current fixes continuation/);
 assert.match(r.results[0].line,/refused step is skipped at the next queue check and the owner queue goes on with its next step/);
 // 03:20:23, the next 8-second queue check.
 w.at('2026-10-16T03:20:23Z');await w.queue.pump(ctx);
 assert.deepEqual(w.queue.snapshot().steps.map(s=>[s.act,s.status]),[[STROLL,'skipped'],[READ,'running']]);
 assert.deepEqual(w.sent,[STROLL,READ]);assert.ok(w.wakes.includes('refused-step-skipped'));
 assert.match(w.queue.snapshot().steps[0].reason,/after a continuation without a valid fixes repair was refused/);
});

test('a refused owner step still takes a valid fixes repair inside the window; mind queues are unchanged',async t=>{
 const w=world(t);await w.run([{act:WALK},{act:'stretch:here'}],{id:'req-fix',source:'owner',replace:true});
 const failed=w.queue.snapshot().steps[0];w.at('2026-10-16T03:18:30Z');
 await w.run([{act:'sit:here',fixes:failed.id}],{id:'wake-fix',source:'mind',replace:true});
 assert.deepEqual(w.queue.snapshot().steps.map(s=>[s.act,s.status]),[['sit:here','running'],['stretch:here','pending']]);
 assert.equal(w.queue.snapshot().skips,undefined,'nothing skipped when the repair arrives in time');
 // A refused step in the Soul's own queue is not skipped by the owner rule (the mind may simply replan).
 const m=world(t);await m.run([{act:WALK},{act:'stretch:here'}],{id:'wake-own',source:'mind'});
 m.at('2026-10-16T03:30:00Z');await m.queue.pump(ctx);assert.equal(m.queue.snapshot().steps[0].status,'failed');
});

test("Cleo 03:58: her owner's get-together request interrupts the rest she protected herself",async t=>{
 const w=world(t,{start:Date.parse('2026-10-16T03:50:02Z')});
 // 03:50:02 idle wake: Cleo protects her own 10-minute rest.
 await w.run([{act:'rest:here',params:{seconds:600},protected:true}],{id:'wake-d3d81fa2',source:'mind'});
 const rest=w.queue.snapshot().steps[0];assert.equal(rest.status,'running');assert.equal(rest.protected,true);
 // Her own later whim still may not replace it.
 assert.throws(()=>w.queue.enqueue([{act:'stand:here'}],{id:'wake-later',source:'mind',replace:true}),/protected/);
 // 03:58:12 owner wake, no --force: "go to the Green field and gather near Longrun Ada ..."
 w.at('2026-10-16T03:58:12Z');
 const r=await w.run([{act:'rest:here',params:{}},{act:'stand:here',params:{}}],{id:'req-b35dbcc1',source:'owner',replace:true,force:false},{...ctx,busy:{id:rest.receiptId,capability:'rest:here'}});
 assert.ok(r.results.every(x=>x.accepted!==false),r.results.map(x=>x.line).join(' | '));
 const q=w.queue.snapshot();assert.equal(q.id,'req-b35dbcc1');assert.equal(q.source,'owner');
 assert.deepEqual(w.sent,['rest:here','rest:here'],'the owner step is sent over the running self-protected rest');
 assert.equal(q.previous[0].receiptId,rest.receiptId,'the interrupted rest stays on record');
});

const ADA={id:'s_f9000ceafd',name:'Longrun Ada',dist:0.9},CLEO={id:'s_63b0e591fc',name:'Longrun Cleo',dist:0.8};
const CHECKIN='Owner check-in: what did you do since my last check-in? List each thing you did, where, and with whom. Only claim what your receipts and observations show, and say what is unfinished.';
const RESTART='Owner check-in: your mind process was stopped and restarted a few minutes ago. What do you notice, where are you now, and what were you doing before?';
const resolveFrom=rows=>refs=>({ok:true,requested:refs.map(r=>({id:r})),chosen:refs.map(r=>{const p=rows.find(x=>x.id===r);return p?{id:p.id,name:p.name,matchedBy:'id'}:null;})});
const bindStep=(step,ownerText,rows,{nearby=rows,selfName='Longrun Basil'}={})=>{const refs=step.converse==='start'?step.with:[step.act.split(':').at(-1)];return bindLiveSoulReferences(refs,{ownerText,resolve:resolveFrom(rows),social:social(step),nearby,selfName});};

test('Basil 03:08 and 04:20: while a check-in is open he may still chat with and wave at the people beside him',()=>{
 const start={converse:'start',with:[ADA.id,CLEO.id],text:'How are you both doing this morning?'};
 const chat=bindStep(start,RESTART,[ADA,CLEO]);assert.equal(chat.ok,true,chat.reason);assert.equal(chat.basis,'nearby-social-choice');
 const wave=bindStep({act:'wave:'+ADA.id},CHECKIN,[ADA,CLEO]);assert.equal(wave.ok,true,wave.reason);assert.equal(wave.basis,'nearby-social-choice');
 // A literal owner reference keeps its own basis.
 assert.equal(bindStep({act:'wave:'+ADA.id},'Go and wave at Longrun Ada.',[ADA,CLEO]).basis,'literal-owner-reference');
 // Cleo's own get-together request names Ada and Basil; she may still greet a third neighbour sharing their surname-like prefix.
 const third={id:'s_third',name:'Longrun Dora',dist:2},BASIL={id:'s_44bc50540b',name:'Longrun Basil',dist:0.7},GATHER='Gather near Longrun Ada. Longrun Ada will invite you and Longrun Basil to a conversation.';
 assert.equal(bindStep({act:'wave:s_third'},GATHER,[ADA,BASIL,third],{selfName:'Longrun Cleo'}).ok,true);
 // With Basil absent, a nearby "Longrun" could be mistaken for him: refused (no similar-name substitution).
 assert.equal(bindStep({act:'wave:s_third'},GATHER,[ADA,third],{selfName:'Longrun Cleo'}).code,'identity.owner-binding-required');
});

test('the binding still refuses strangers from untrusted text, similar names, non-social acts and an owner who said not to',()=>{
 const far={id:'s_mallory',name:'Mallory Vance',dist:14};
 assert.equal(bindStep({converse:'start',with:[far.id]},CHECKIN,[ADA,far]).code,'identity.owner-binding-required','someone named in untrusted speech but not beside the Soul');
 assert.equal(bindStep({act:'give:'+ADA.id},CHECKIN,[ADA]).code,'identity.owner-binding-required','give is not a greeting');
 assert.equal(bindStep({act:'hug:'+ADA.id},CHECKIN,[ADA]).code,'identity.owner-binding-required');
 assert.equal(bindStep({act:'wave:'+ADA.id},"Read in the library and don't talk to anyone until I check in.",[ADA]).code,'identity.owner-binding-required');
 assert.equal(bindStep({act:'wave:'+ADA.id},'Take a quiet walk and keep to yourself.',[ADA]).code,'identity.owner-binding-required');
 // Old similar peers beside the Soul never stand in for the people the owner named.
 const beryl={id:'s_Beryl',name:'Beryl Cadence19',dist:1},nola={id:'s_Nola',name:'Nola Recall19',dist:2};
 const similar=bindStep({converse:'start',with:[beryl.id,nola.id]},'Meet Beryl Coherent19 and Nola Coherent19. Invite both to a private conversation.',[beryl,nola],{selfName:'Probe'});
 assert.equal(similar.code,'identity.owner-binding-required');
});
