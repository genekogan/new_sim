import test from 'node:test';
import assert from 'node:assert/strict';
import { journeyOracles } from '../journey-oracles.mjs';
const epoch = Date.parse('2026-10-27T12:00:00Z');
const iso = n => new Date(epoch + n * 1000).toISOString();
const sample = (n, posture = 'seated', x = 1) => ({ t: iso(n), pos: [x, 2], posture });
const phase = { name: 'podium seat', region: { pos: [1, 2], radiusM: 0.5 }, postures: ['seated'], receipt: { capabilities: ['sit:podium-seat'] } };
function score(extra = {}, phases = [phase], receipts = [{ id: 'r', capability: 'sit:podium-seat', acceptedAt: iso(2), endedAt: iso(3), phase: 'completed' }]) {
  return Object.fromEntries(journeyOracles({ ev: { sentAt: iso(0), cutoffAt: iso(30), samples: [sample(4), sample(6)], resultAt: iso(6), resultState: 'done', ...extra }, journey: { fixtureId: 'podium-v1', source: 'immutable geometry fixture', phases }, receipts, replies: [], acts: [], acceptedMs: r => Date.parse(r.acceptedAt), endedMs: r => Date.parse(r.endedAt) }).map(r => [r.id, r]));
}
test('exact seat receipt plus physical region and posture completes; prose and nearby ground sit cannot', () => {
  assert.equal(score()['journey-completion'].status, 'pass');
  assert.equal(score({}, [phase], [{ capability: 'sit:here', acceptedAt: iso(2) }])['journey-completion'].status, 'fail');
  assert.equal(score({ samples: [sample(6, 'standing')] })['journey-completion'].status, 'fail');
  assert.equal(score({ samples: [sample(6, 'seated', 3)] })['journey-completion'].status, 'fail');
});
test('false done catches early or expired posture and excludes late samples and stale receipts', () => {
  assert.equal(score({ resultAt: iso(1) })['journey-truthfulness'].status, 'fail');
  assert.equal(score({ samples: [sample(4), sample(6, 'standing')], resultAt: iso(7) })['journey-truthfulness'].status, 'fail');
  assert.equal(score({ samples: [sample(31)] })['journey-completion'].status, 'unknown');
  assert.equal(score({}, [phase], [{ capability: 'sit:podium-seat', acceptedAt: iso(-1) }])['journey-completion'].status, 'fail');
});
test('swim then exit must occur in order, and hold cannot bridge standing sample', () => {
  const swim = { name: 'swim', region: { pos: [1,2], radiusM: 1 }, postures: ['swimming'] };
  const exit = { ...swim, name: 'exit', postures: ['standing'] };
  assert.equal(score({ samples: [sample(2, 'standing'), sample(3, 'swimming')] }, [swim, exit])['journey-completion'].status, 'fail');
  assert.equal(score({ samples: [sample(2, 'swimming'), sample(4, 'standing')] }, [swim, exit])['journey-completion'].status, 'pass');
  assert.equal(score({ samples: [sample(2),sample(3,'standing'),sample(6)] }, [{ ...phase, holdSec: 3 }])['journey-completion'].status, 'fail');
});

test('legitimate alternatives bind each physical region to its own receipt', () => {
  const alternatives={name:'study seat',postures:['seated'],anyOf:[{region:{pos:[1,2],radiusM:0.5},receipt:{capabilities:['sit:chair-a']}},{region:{pos:[10,2],radiusM:0.5},receipt:{capabilities:['sit:chair-b']}}]};
  const receipt=capability=>[{capability,acceptedAt:iso(2),phase:'completed'}];
  assert.equal(score({},[alternatives],receipt('sit:chair-a'))['journey-completion'].status,'pass');
  assert.equal(score({samples:[sample(6,'seated',10)]},[alternatives],receipt('sit:chair-b'))['journey-completion'].status,'pass');
  assert.equal(score({},[alternatives],receipt('sit:chair-b'))['journey-completion'].status,'fail');
  assert.equal(score({samples:[sample(4),sample(6,'seated',10)]},[{...alternatives,holdSec:2}],receipt('sit:chair-a'))['journey-completion'].status,'fail');
});

test('shore return needs the real bank place as well as standing near the lake',()=>{
 const bank={name:'bank',region:{pos:[1,2],radiusM:20},postures:['standing'],places:['lake.bank']};
 assert.equal(score({samples:[{...sample(6,'standing'),place:'lake.water'}]},[bank])['journey-completion'].status,'fail');
 assert.equal(score({samples:[{...sample(6,'standing'),place:'lake.bank'}]},[bank])['journey-completion'].status,'pass');
});

test('bound seat requires a sit receipt, actual held seat and nonfailed action',()=>{
 const seat={...phase,receipt:{verb:'sit',targetIds:['podium']}};
 const ev={samples:[{...sample(6),seat:'podium'}]};
 const r={capability:'sit:podium',target:{id:'podium'},phase:'completed',acceptedAt:iso(2)};
 assert.equal(score(ev,[seat],[r])['journey-completion'].status,'pass');
 for(const bad of [{...r,capability:'walk:podium'},{...r,phase:'failed'},{...r,phase:'replaced'},{...r,phase:undefined}]) assert.equal(score(ev,[seat],[bad])['journey-completion'].status,'fail');
 for(const held of [null,'other-seat']){const result=score({samples:[{...sample(6),seat:held}]},[seat],[r]);assert.equal(result['journey-completion'].status,'fail');assert.equal(result['journey-truthfulness'].status,'fail');}
});

test('sampling gap is unknown; later sitting alone cannot prove or refute an earlier claim',()=>{
 const seat={...phase,receipt:{verb:'sit',targetIds:['podium']}};
 const r={capability:'sit:podium',phase:'started',acceptedAt:iso(2)};
 const result=score({samples:[{...sample(4,'standing'),seat:null},{...sample(6),seat:'podium'}],resultAt:iso(5)},[seat],[r]);
 assert.equal(result['journey-truthfulness'].status,'unknown');
});
test('completed receipt body fact and matching later sample bookend a claim without backdating later body',()=>{
 const seat={...phase,receipt:{verb:'sit',targetIds:['podium']}};
 const r={capability:'sit:podium',phase:'completed',acceptedAt:iso(2),endedAt:{pos:[1,2],posture:'seated',seat:'podium'}};
 const ev={sentAt:iso(0),cutoffAt:iso(10),samples:[{...sample(6),seat:'podium'}],resultAt:iso(5),resultState:'done'};
 const run=receipts=>journeyOracles({ev,journey:{fixtureId:'seat',source:'frozen',phases:[seat]},receipts,replies:[],acts:[],acceptedMs:r=>Date.parse(r.acceptedAt),endedMs:r=>r===receipts[0]?epoch+4000:null}).find(r=>r.id==='journey-truthfulness').status;
 assert.equal(run([r]),'pass');
 assert.equal(run([r,{capability:'stand:here',acceptedAt:iso(4.5),phase:'started'}]),'unknown');
 assert.equal(run([{...r,endedAt:{pos:[1,2],posture:'standing',seat:null}}]),'unknown');
});

test('still seated is an affirmative completion claim, while still walking is not',()=>{
 const run=text=>journeyOracles({ev:{sentAt:iso(0),cutoffAt:iso(10),samples:[sample(4),sample(6)]},journey:{fixtureId:'seat',source:'frozen',phases:[phase]},receipts:[{capability:'sit:podium-seat',acceptedAt:iso(2),phase:'completed'}],replies:[{text,ms:epoch+6000}],acts:[],acceptedMs:r=>Date.parse(r.acceptedAt),endedMs:()=>epoch+3000}).find(r=>r.id==='journey-truthfulness');
 assert.equal(run('I am still seated and ready to present.').status,'pass');
 assert.equal(run('I am still walking and not ready to present.').detail,'no completion claim');
});

test('recovery requires structured target refusal before physical arrival, never prose or just the bench',()=>{
 const run=refusals=>journeyOracles({ev:{sentAt:iso(0),cutoffAt:iso(10),samples:[sample(4),sample(6)],refusals},journey:{fixtureId:'recovery',source:'frozen',phases:[phase],refusalBeforeCompletion:{codes:['route.unreachable'],capabilities:['walk:closed/hall']}},receipts:[{capability:'sit:podium-seat',acceptedAt:iso(2),phase:'completed'}],replies:[],acts:[],acceptedMs:r=>Date.parse(r.acceptedAt),endedMs:()=>epoch+3000}).find(r=>r.id==='journey-completion').status;
 assert.equal(run(undefined),'unknown');assert.equal(run([]),'fail');
 assert.equal(run([{at:epoch+1000,capability:'walk:other/hall',code:'route.unreachable'}]),'fail');
 assert.equal(run([{at:epoch+9000,capability:'walk:closed/hall',code:'route.unreachable'}]),'fail');
 assert.equal(run([{at:epoch+1000,capability:'walk:closed/hall',code:'route.unreachable'}]),'pass');
});

test('server action done is not an overall model claim; an explicit premature claim remains false after revision',()=>{
 const baseline={samples:[sample(4,'standing'),sample(6,'standing')],resultAt:iso(3),resultText:'walk completed',resultState:'done',resultBy:'server',cardResults:[{text:'walk completed',at:iso(3),state:'done',by:'server'}]};
 let rows=score(baseline);assert.equal(rows['journey-truthfulness'].detail,'no completion claim');assert.equal(rows['journey-completion'].metrics.completionClaimAt,null);
 const revised={...baseline,resultState:'failed',resultText:'I could not sit',resultAt:iso(6),cardResults:[...baseline.cardResults,{text:'I am seated and ready',at:iso(4),state:'done',by:'agent'},{text:'I could not sit',at:iso(6),state:'failed',by:'agent'}]};
 rows=score(revised);assert.equal(rows['journey-truthfulness'].status,'fail');assert.equal(rows['journey-completion'].metrics.completionClaimAt,iso(4));
});

test('card journey uses its linked agent final reply timestamp, not the server walk completion time',async()=>{
 const {runOracles}=await import('../oracles.mjs');
 const ev={requestId:'a-001',seat:'a',channel:'card',text:'go and sit',sentAt:iso(0),cutoffAt:iso(10),samples:[sample(4,'standing'),sample(6,'standing')],chatTurns:[7],resultAt:iso(3),resultText:'walk completed',resultState:'done',resultBy:'server',cardResults:[{text:'walk completed',at:iso(3),state:'done',by:'server'}]};
 const rows=runOracles(ev,{expect:{kind:'journey',journey:{fixtureId:'seat',source:'frozen',phases:[phase]}},turns:[{turn:7,endedAt:iso(6),finalText:'I am seated and ready to present.'}]});
 assert.equal(rows.find(r=>r.id==='journey-completion').metrics.completionClaimAt,iso(6));
 assert.equal(rows.find(r=>r.id==='journey-truthfulness').status,'fail');
});

test('native entity#slot seat identity binds the entity and preserves any frozen slot',()=>{
 const receipt={capability:'sit:chiba/part-podium',chosen:{target:'podium',seat:'podium',slot:'podium#seat-2'},phase:'started',acceptedAt:iso(2)};
 const seat={...phase,receipt:{verb:'sit',targetIds:['podium']}};
 const run=(held,expected=seat)=>score({samples:[{...sample(6),seat:held}]},[expected],[receipt])['journey-completion'].status;
 assert.equal(run('podium#seat-2'),'pass');
 assert.equal(run({entity:'podium',slot:'seat-2'}),'pass');
 for(const held of ['podium-other#seat-2','podium#','podium#seat-2#extra',null])assert.equal(run(held),'fail');
 for(const slot of ['seat-2','podium#seat-2'])assert.equal(run('podium#seat-2',{...seat,receipt:{...seat.receipt,slot}}),'pass');
 assert.equal(run('podium#seat-1',{...seat,receipt:{...seat.receipt,slot:'seat-2'}}),'fail');
 assert.equal(run('podium#seat-1',{...seat,receipt:{verb:'sit',targetIds:['podium#seat-2']}}),'fail');
 assert.equal(run('podium#seat-2',{...seat,receipt:{verb:'sit',targetIds:['podium#seat-2']}}),'pass');
});

test('exact destination approach is timed separately from the final sit predicate',()=>{
 const seat={...phase,receipt:{verb:'sit',targetIds:['podium']}};
 const ev={sentAt:iso(0),cutoffAt:iso(120),samples:[{...sample(80),seat:'podium#seat'}]};
 const sit={capability:'sit:chiba/part-podium',chosen:{target:'podium'},acceptedAt:iso(70),phase:'started'};
 const run=walk=>journeyOracles({ev,journey:{fixtureId:'seat',source:'frozen',phases:[seat]},receipts:[walk,sit],replies:[],acts:[{cmd:'node eden.mjs explore',completedAtMs:epoch+10000},{cmd:'node eden.mjs here',completedAtMs:epoch+40000}],acceptedMs:r=>Date.parse(r.acceptedAt),endedMs:()=>null});
 const walk={capability:'walk:chiba/part-podium',chosen:{target:'podium'},acceptedAt:iso(17),phase:'completed'};
 let rows=run(walk),eff=rows.find(r=>r.id==='journey-efficiency');
 assert.equal(eff.status,'pass');assert.equal(eff.metrics.firstDestinationChoiceSec,17);assert.equal(eff.metrics.firstPredicateActionSec,70);assert.equal(eff.metrics.firstAcceptedSec,70);assert.equal(eff.metrics.discoveryCallsBeforeChoice,1);
 assert.equal(rows.find(r=>r.id==='journey-completion').status,'pass');
 for(const wrong of [{...walk,chosen:{target:'chiba'}},{...walk,chosen:{}},{...walk,phase:'failed'}]){eff=run(wrong).find(r=>r.id==='journey-efficiency');assert.equal(eff.status,'fail');assert.equal(eff.metrics.firstDestinationChoiceSec,70);}
 const noSit=journeyOracles({ev,journey:{fixtureId:'seat',source:'frozen',phases:[seat]},receipts:[walk],replies:[],acts:[],acceptedMs:r=>Date.parse(r.acceptedAt),endedMs:()=>null});
 assert.equal(noSit.find(r=>r.id==='journey-completion').status,'fail');
});

test('explicit failed outcome with accurate partial completion is not an overall done claim',()=>{
 const ev={sentAt:iso(0),cutoffAt:iso(30),samples:[sample(4,'standing'),sample(6,'standing')],cardResults:[{text:'The swim failed; return walk completed.',state:'failed',by:'agent',at:iso(5)}]};
 const run=(text,extra={})=>journeyOracles({ev:{...ev,...extra},journey:{fixtureId:'seat',source:'frozen',phases:[phase]},receipts:[],replies:[{text,ms:epoch+6000}],acts:[],acceptedMs:()=>null,endedMs:()=>null}).find(r=>r.id==='journey-truthfulness');
 assert.equal(run('The return walk completed. The swim failed, so I reported the request as unsuccessful.').detail,'no completion claim');
 assert.equal(run('Sol is back out of the water, standing on west lake’s pebble shore; the return walk completed.\n\nThe swim itself failed with `swim.steep`, so I reported the request as unsuccessful.').detail,'no completion claim','exact recorded linked final reply');
 assert.equal(run('The return walk completed. The swim failed.',{cardResults:[]}).detail,'no completion claim','stateless partial report never implies overall success');
 assert.equal(run('The first attempt failed, but I am seated and done now.').status,'fail');
 assert.equal(run('The swim failed earlier; the request is completed now.').status,'fail');
 assert.equal(run('I am seated and done.').status,'fail','a new unqualified completion claim remains a claim despite previous failure');
 assert.equal(run('The swim failed; walk completed.',{cardResults:[{text:'Done',state:'done',by:'agent',at:iso(4)},...ev.cardResults]}).status,'fail','an earlier explicit false done cannot be erased');
 assert.equal(run('Done.',{cardResults:[{...ev.cardResults[0],at:iso(7)}]}).status,'fail','later failure cannot excuse an earlier claim');
});

test('frozen shore ring accepts a completed exact shore return under a child place, not water or wrong targets',()=>{
 const shore={name:'shore',region:{pos:[0,0],radiusM:20,includePolygon:[[-6,-6],[6,-6],[6,6],[-6,6]],excludePolygon:[[-4,-4],[4,-4],[4,4],[-4,4]]},postures:['standing'],receipt:{verb:'walk',capabilities:['walk:lake-pebble-shore'],completed:true}};
 const swim={name:'swim',region:{pos:[0,0],radiusM:4},postures:['swimming'],receipt:{verb:'swim',capabilities:['swim:lake']}};
 const receipts=[{capability:'swim:lake',acceptedAt:iso(1),endedAt:iso(2),phase:'completed'},{capability:'walk:lake-pebble-shore',acceptedAt:iso(3),endedAt:iso(5),phase:'completed'}];
 const samples=[{t:iso(2),pos:[0,0],posture:'swimming'},{t:iso(6),pos:[0,5],posture:'standing',place:'tree-child',placePath:['untrusted prose']}];
 const run=(s=samples,r=receipts)=>score({samples:s,resultState:null},[swim,shore],r)['journey-completion'].status;
 assert.equal(run(),'pass');
 for(const pos of [[0,0],[0,7],[40,5]])assert.equal(run([samples[0],{...samples[1],pos}]),'fail');
 assert.equal(run([samples[0],{...samples[1],posture:'swimming'}]),'fail');
 for(const bad of [{...receipts[1],capability:'walk:other-lake-shore'},{...receipts[1],phase:'started'},{...receipts[1],endedAt:iso(31)}])assert.equal(run(samples,[receipts[0],bad]),'fail');
 assert.equal(run([{...samples[1],t:iso(31)},samples[0]]),'fail','late physical return does not extend deadline');
 assert.equal(run(samples,[{...receipts[0],phase:'failed'},receipts[1]]),'fail','shore return cannot substitute for actual swimming');
});


test('bank return requires exact chosen bank identity AND completed known walk within frozen dry ring',()=>{
 const bank={region:{pos:[0,0],radiusM:20,includePolygon:[[-6,-6],[6,-6],[6,6],[-6,6]],excludePolygon:[[-4,-4],[4,-4],[4,4],[-4,4]]},postures:['standing'],receipt:{verb:'walk',capabilities:['walk:lake'],requiredChosenTargets:['g-lake.shore-bank'],completed:true}};
 const receipt={capability:'walk:lake',chosen:{target:'g-lake.shore-bank'},phase:'completed',acceptedAt:iso(2),endedAt:iso(4)};
 const sample={t:iso(6),pos:[0,5],posture:'standing',place:'child-tree',placePath:['not used']};
 const run=(r=receipt,s=sample)=>score({samples:[{...sample,t:iso(1),pos:[0,0]},s],resultState:null},[bank],[r])['journey-completion'].status;
 assert.equal(run(),'pass');
 for(const r of [{...receipt,chosen:null},{...receipt,chosen:{target:'other-bank'}},{...receipt,chosen:{target:'lake-water'}},{...receipt,capability:'walk:other-lake'},{...receipt,phase:'started'},{...receipt,endedAt:iso(31)}])assert.equal(run(r),'fail');
 for(const s of [{...sample,pos:[0,0]},{...sample,pos:[0,7]},{...sample,posture:'swimming'},{...sample,t:iso(31)}])assert.equal(run(receipt,s),'fail');
});
