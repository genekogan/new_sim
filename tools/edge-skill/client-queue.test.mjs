import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openClientQueue,replySteps} from './client-queue.mjs';

const folder=t=>{const root=mkdtempSync(join(realpathSync(tmpdir()),'eden-client-queue-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;};
test('Tea house walk then three-minute sit advances on actual terminal receipts with no model call',async t=>{
 const root=folder(t),receipts=new Map(),sent=[],wakes=[];let place='field',time=0;
 const adapter={context:async()=>({placeId:place,nearCount:0}),async send(body){sent.push(body);const receipt={id:'receipt:'+sent.length,capability:body.capability,phase:'started'};receipts.set(receipt.id,receipt);return {accepted:true,receipt};},readReceipt:async id=>receipts.get(id)};
 const q=openClientQueue(root,{adapter,now:()=>time,onWake:reason=>wakes.push(reason)});t.after(()=>q.close());
 q.enqueue([{act:'walk:eden-tea-house'},{act:'sit:here',for:'3m',if:{place:'eden-tea-house'}}],{id:'owner:tea',source:'owner'});
 await q.pump({placeId:place});await q.pump({placeId:place});assert.equal(sent.length,1,'no sit while walk is live');
 place='eden-tea-house';receipts.set('receipt:1',{...receipts.get('receipt:1'),phase:'completed',endedAt:{place}});await q.pump({placeId:'field',busy:{id:'receipt:1'}});
 assert.equal(sent.length,2);assert.equal(sent[1].capability,'sit:here');assert.equal(sent[1].params.seconds,180);assert.deepEqual(wakes,[],'successful next step never requests a model');
 time=179000;await q.pump({placeId:place});assert.equal(q.snapshot().steps[1].status,'running');
 time=180000;receipts.set('receipt:2',{...receipts.get('receipt:2'),phase:'completed',endedAt:{place}});await q.pump({placeId:place});assert.ok(q.snapshot().steps.every(s=>s.status==='completed'));
});

test('response-loss restart retries exact durable clientRef and cannot duplicate a body act',async t=>{
 const root=folder(t),accepted=new Map(),bodies=[];let lost=true;
 const adapter={async send(body){if(!accepted.has(body.clientRef)){bodies.push(body);accepted.set(body.clientRef,{id:'receipt:one',capability:body.capability,phase:'started'});}if(lost){lost=false;throw Error('lost response');}return {accepted:true,receipt:accepted.get(body.clientRef)};},readReceipt:async()=>accepted.values().next().value};
 let q=openClientQueue(root,{adapter});q.enqueue([{act:'walk:eden-tea-house'}],{id:'restart:1'});await q.pump();const ref=q.snapshot().steps[0].clientRef;q.close();
 q=openClientQueue(root,{adapter});t.after(()=>q.close());await q.pump();assert.equal(q.snapshot().steps[0].clientRef,ref);assert.equal(bodies.length,1);assert.equal(q.snapshot().steps[0].receiptId,'receipt:one');
});

test('lease, protected external action and attended pause prevent concurrent/new body requests',async t=>{
 const root=folder(t);let sends=0;const q=openClientQueue(root,{adapter:{send:async body=>{sends++;return {accepted:true,receipt:{id:'r',phase:'started',capability:body.capability}};},readReceipt:async()=>null}});t.after(()=>q.close());
 assert.throws(()=>openClientQueue(root,{adapter:{}}),/lease/);q.enqueue([{act:'sit:here'}]);await q.pump({busy:{id:'protected:other'}});assert.equal(sends,0);
 await q.pump({},true);assert.equal(sends,0);q.resume();await q.pump();assert.equal(sends,1);
});

test('refusal/interruption wake once without discarding pending steps or sending the next act',async t=>{
 const root=folder(t),wakes=[];let sent=0,phase='started';const q=openClientQueue(root,{adapter:{send:async body=>{sent++;return {accepted:true,receipt:{id:'receipt:first',phase,capability:body.capability}};},readReceipt:async()=>({id:'receipt:first',phase,capability:'walk:field'})},onWake:r=>wakes.push(r)});t.after(()=>q.close());
 q.enqueue([{act:'walk:field'},{act:'sit:here'}]);await q.pump();phase='replaced';await q.pump();await q.pump();assert.equal(sent,1);assert.deepEqual(wakes,['interrupted']);assert.equal(q.snapshot().steps[1].status,'pending');
});

test('legacy malformed plan reply becomes a local queue, not capability plan',()=>{
 assert.deepEqual(replySteps({act:'plan',params:{steps:[{do:'walk:field'},{do:'sit:here',for:'3m'}]}}).map(s=>s.act),['walk:field','sit:here']);
 assert.deepEqual(replySteps({do:[{plan:[{do:'walk:field'}]}]}).map(s=>s.act),['walk:field']);
 assert.throws(()=>replySteps({do:[{act:'plan'}]}),/plan|steps/);
});

test('until uses qualified native renewals and observed owned release, never an idle waiting claim',async t=>{
 const root=folder(t),receipts=new Map(),sent=[];let physical='idle';
 const adapter={holdProfile:async()=>({seconds:60}),async send(body){sent.push(body);const receipt={id:'r'+sent.length,capability:body.capability,phase:'started'};receipts.set(receipt.id,receipt);if(body.capability==='stand:here'){for(const r of receipts.values())if(r!==receipt&&r.phase==='started')r.phase='replaced';receipt.phase='completed';physical='standing';}else physical='reading';return {accepted:true,receipt};},readReceipt:async id=>receipts.get(id),context:async()=>({})};
 const q=openClientQueue(root,{adapter});t.after(()=>q.close());q.enqueue([{act:'read:library',until:{event:'presentation.started'}}]);await q.pump();assert.equal(physical,'reading');assert.equal(sent[0].params.seconds,60);
 receipts.get('r1').phase='completed';physical='idle';await q.pump();assert.equal(physical,'reading','a new qualified native substep actually renewed');assert.equal(sent.length,2);assert.notEqual(sent[0].clientRef,sent[1].clientRef);
 q.event({kind:'presentation.started'});await q.pump();assert.equal(sent[2].capability,'stand:here');assert.equal(physical,'standing');await q.pump();assert.equal(q.snapshot().steps[0].status,'completed');
});

test('owner-protected read refuses non-force owner replacement; nonprotected replan waits for native safe-stop',async t=>{
 const root=folder(t),receipts=new Map(),sent=[];let physical='reading',unsafe=true;
 const adapter={send:async body=>{sent.push(body);const r={id:'r'+sent.length,capability:body.capability,phase:sent.length===1?'started':'waiting'};receipts.set(r.id,r);return {accepted:true,receipt:r};},readReceipt:async id=>receipts.get(id)};
 const q=openClientQueue(root,{adapter});t.after(()=>q.close());q.enqueue([{act:'read:library',protected:true}],{id:'original',source:'owner'});await q.pump();
 assert.throws(()=>q.enqueue([{act:'walk:tea'}],{id:'new',replace:true,source:'owner'}),/protected/);assert.equal(sent.length,1);assert.equal(physical,'reading');
 q.enqueue([{act:'walk:tea'}],{id:'new',replace:true,force:true,source:'owner'});await q.pump({busy:{id:'r1'}});assert.equal(sent.length,2);assert.equal(q.snapshot().steps[0].status,'waiting');assert.equal(physical,'reading','native unsafe phase has not yet stopped');
 unsafe=false;if(!unsafe){receipts.get('r1').phase='replaced';receipts.get('r2').phase='started';physical='walking';}await q.pump();assert.equal(q.snapshot().steps[0].status,'running');assert.equal(physical,'walking');
});

test('mixed walk, greeting, sit preserves sequence and never greets before arrival',async t=>{
 const root=folder(t),log=[],receipts=new Map();const adapter={context:async()=>({placeId:'tea'}),runPublic:async s=>{log.push(s.say);return {line:'said'};},send:async body=>{log.push(body.capability);const r={id:'r'+log.length,phase:'started',capability:body.capability};receipts.set(r.id,r);return {accepted:true,receipt:r};},readReceipt:async id=>receipts.get(id)};
 const q=openClientQueue(root,{adapter});t.after(()=>q.close());q.enqueue([{act:'walk:tea'},{say:'Hello Tea house'},{act:'sit:here'}]);await q.pump();await q.pump();assert.deepEqual(log,['walk:tea']);receipts.get('r1').phase='completed';await q.pump();assert.deepEqual(log,['walk:tea','Hello Tea house','sit:here']);
});

test('past event cannot release later hold; future event is scoped after that step starts',async t=>{
 const root=folder(t),receipts=new Map(),sent=[];const q=openClientQueue(root,{adapter:{holdProfile:async()=>({seconds:60}),send:async body=>{sent.push(body);const r={id:'r'+sent.length,phase:'started',capability:body.capability};receipts.set(r.id,r);return {accepted:true,receipt:r};},readReceipt:async id=>receipts.get(id)}});t.after(()=>q.close());q.enqueue([{act:'read:library',until:'presentation.started'}]);q.event({kind:'presentation.started'});await q.pump();await q.pump();assert.equal(sent.length,1);q.event({kind:'presentation.started'});await q.pump();assert.equal(sent[1].capability,'stand:here');
});

test('uncertain legacy speech is retained for reconciliation and is never replayed after restart',async t=>{
 const root=folder(t);let calls=0;const adapter={runPublic:async()=>{calls++;throw Error('lost reply');}};let q=openClientQueue(root,{adapter});q.enqueue([{say:'hello'}]);await q.pump();q.close();q=openClientQueue(root,{adapter});t.after(()=>q.close());q.resume();await q.pump();assert.equal(calls,1);assert.equal(q.snapshot().notice.reason,'public-step-outcome-uncertain');
});

test('compiled absolute world deadline does not turn a late arrival into a next-day hold',async t=>{
 const root=folder(t);let sent=0;const q=openClientQueue(root,{adapter:{send:async()=>{sent++;},holdProfile:async()=>({seconds:60})}});t.after(()=>q.close());q.enqueue([{act:'sit:here',until:{worldMinutes:1320}}]);await q.pump({worldMinutes:1321});assert.equal(sent,0);assert.equal(q.snapshot().steps[0].status,'skipped');assert.match(q.snapshot().steps[0].reason,/deadline elapsed/);
});

test('attended pause reconciles completed canonical work but never dispatches its retained next step',async t=>{
 const root=folder(t);let phase='started',sent=0,folded=0;const q=openClientQueue(root,{adapter:{send:async body=>{sent++;return {accepted:true,receipt:{id:'r'+sent,phase,capability:body.capability}};},readReceipt:async id=>({id,phase,capability:'walk:tea'})},onReceipt:()=>folded++});t.after(()=>q.close());q.enqueue([{act:'walk:tea'},{act:'sit:here'}]);await q.pump();phase='completed';await q.pump({},true);assert.equal(folded,1);assert.equal(sent,1);assert.equal(q.snapshot().steps[0].status,'completed');assert.equal(q.snapshot().steps[1].status,'pending');
});

test('actual params.protected reading shape becomes durable local protection and never a world parameter',async t=>{
 const root=folder(t),sent=[];let walkDone=false;const adapter={send:async body=>{sent.push(body);return {accepted:true,receipt:{id:sent.length===1?'r-walk-alias':'r-protected-alias',capability:sent.length===1?'walk:eden-library-1':'read:eden-library-1',phase:'started'}};},readReceipt:async id=>({id,capability:id==='r-walk-alias'?'walk:eden-library-1':'read:eden-library-1',phase:id==='r-walk-alias'&&walkDone?'completed':'started'})};
 let q=openClientQueue(root,{adapter});q.enqueue([{act:'walk to the library'},{act:'read a book in the library',params:{seconds:360,protected:true}}],{id:'reading-alias',source:'owner'});await q.pump();assert.equal(sent.length,1);walkDone=true;await q.pump();assert.equal(q.snapshot().steps[1].protected,true);assert.deepEqual(sent[1].params,{seconds:360});assert.deepEqual(sent.map(s=>s.capability),['walk to the library','read a book in the library']);q.close();q=openClientQueue(root,{adapter});t.after(()=>q.close());assert.equal(q.snapshot().steps[1].protected,true);assert.throws(()=>q.enqueue([{act:'walk:field'}],{id:'replacement',source:'owner',replace:true}),/protected/);assert.equal(sent.length,2);
});
test('local protection aliases preserve explicit booleans and reject conflict or invalid types atomically',()=>{
 for(const value of [true,false]){const step=replySteps({do:[{act:'read:here',protected:value,params:{protected:value,seconds:180}}]})[0];assert.equal(step.protected,value);assert.deepEqual(step.params,{seconds:180});assert.equal(replySteps({do:[{act:'read:here',protected:value}]})[0].protected,value);}
 assert.throws(()=>replySteps({do:[{act:'read:here',protected:true,params:{protected:false}}]}),/conflicting/);
 for(const invalid of ['true',1,null])assert.throws(()=>replySteps({do:[{act:'read:here',params:{protected:invalid}}]}),/protection/);
});
