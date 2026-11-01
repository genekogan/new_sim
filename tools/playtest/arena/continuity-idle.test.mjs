import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeContinuityIdle} from './continuity-idle.mjs';
const end=7200000,actor={actorId:'reader',soulId:'s_reader'},evidence=['private/source.jsonl:1'];
const row=x=>({worldId:'w_trial',...actor,evidence,...x});
const total=(inputTokens=0,outputTokens=0,cachedInputTokens=0)=>({inputTokens,outputTokens,cachedInputTokens,totalTokens:inputTokens+outputTokens});
const decision=(at,revision=1,call='wait',wakeAt=null)=>row({kind:'decision',at,committedAt:at,checkpointRevision:revision,decisionId:'decision-'+revision,call,wakeAt,listenTo:[]});
const host=(at,state,turnId='turn-1')=>row({kind:'host',at,state,hostId:'host-1',threadId:'thread-1',turnId,model:'actual-model'});
const interrupt=(at,eligible=true,reason='addressed')=>row({kind:'interrupt',at,eventId:'event-'+at,eligible,reason,eligibilityEvidence:['native/events.jsonl:2']});
const coverage=()=>['decisions','interrupts','host','tokens'].map(stream=>row({stream,from:0,to:end,complete:true}));
const run=(records,options={})=>analyzeContinuityIdle({worldId:'w_trial',startAt:0,cutoffAt:end,actors:[actor],records,coverage:coverage(),...options});
const result=(records,options)=>run(records,options).actors.reader;

test('two-hour committed waiting is independent of overlapping host inference; exact calls remain unknown',()=>{
 const r=result([decision(0),host(1000,'started'),host(60000,'completed')]);
 assert.equal(r.waitingMs,end);assert.equal(r.activeMs,0);assert.equal(r.idleFractionCheck.status,'pass');
 assert.equal(r.hostTurns.counts.waiting,1);assert.equal(r.hostTurns.busyMsByDeclaredState.waiting,59000);
 assert.equal(r.hostTurns.waitingStartsPerHour,.5);assert.equal(r.hostTurns.proxyCheck.status,'pass');
 assert.equal(r.hostTurns.busyMsIsUpperBound,false);
 assert.equal(r.internalInferenceCalls.status,'unknown');assert.equal(r.internalInferenceCalls.count,null);assert.equal(r.status,'unknown');
 assert.equal(r.billing.hardCapVerified,false);assert.equal(r.hostTurns.starts[0].model,'actual-model');
 assert.equal(r.tokens.complete,false,'a completed host turn without usage cannot certify zero tokens');
});

test('saved timer ends waiting exactly; old timer cannot cut short a new committed wait',()=>{
 const r=result([decision(0,1,'wait',100000),decision(50000,2,'wait',200000),decision(300000,3,'wait')]);
 assert.deepEqual(r.intervals.map(i=>[i.from,i.to,i.state]),[[0,50000,'waiting'],[50000,200000,'waiting'],[200000,300000,'active'],[300000,end,'waiting']]);
 assert.equal(r.waitingMs,end-100000);
});

test('native eligible interrupt ends wait; ignored ambient input does not; listen is nonblocking',()=>{
 const r=result([decision(0),interrupt(100,false,'ambient'),interrupt(200),decision(300,2,'listen'),decision(400,3)]);
 assert.equal(r.waitingMs,end-200);assert.equal(r.activeMs,200);
 assert.equal(r.intervals.find(i=>i.from===100),undefined);
 assert.equal(r.intervals.find(i=>i.from===300).reason,'committed-listen');
});

test('75 percent and 12 host starts per waiting hour boundaries remain the frozen numbers',()=>{
 const records=[decision(0,1,'wait',end*.75)];
 for(let i=0;i<18;i++)records.push(host(i*1000+10,'started','turn-'+i),host(i*1000+20,'completed','turn-'+i));
 const r=result(records);assert.equal(r.idleFraction,.75);assert.equal(r.idleFractionCheck.status,'pass');assert.equal(r.hostTurns.waitingStartsPerHour,12);assert.equal(r.hostTurns.proxyCheck.status,'pass');
 const over=result([...records,host(19000,'started','extra'),host(19010,'completed','extra')]);assert.equal(over.hostTurns.proxyCheck.status,'fail');assert.equal(over.internalInferenceCalls.status,'unknown');
 const low=result([decision(0,1,'wait',end*.75-1)]);assert.equal(low.idleFractionCheck.status,'fail');
});

test('window shorter than two real hours cannot pass; cutoff is exclusive for starts',()=>{
 const short=result([decision(0)],{cutoffAt:end-1});assert.equal(short.idleFractionCheck.status,'unknown');assert.equal(short.hostTurns.proxyCheck.status,'unknown');
 const r=result([decision(0),host(end,'started')]);assert.equal(r.hostTurns.counts.waiting,0);assert.equal(run([decision(0)]).windowStatus,'eligible-duration-only');
});

test('missing streams and early ordinary exit never become idle; new state required after a coverage hole',()=>{
 const c=coverage().filter(c=>c.stream!=='decisions');c.push(row({stream:'decisions',from:0,to:100000,complete:true}),row({stream:'decisions',from:200000,to:end,complete:true}));
 const r=result([decision(0),decision(300000,2)],{coverage:c});
 assert.equal(r.waitingMs,end-200000);assert.equal(r.unknownMs,200000);assert.equal(r.idleFractionCheck.status,'unknown');
 const baseline=result([], {coverage:coverage().filter(c=>c.stream!=='decisions')});assert.equal(baseline.waitingMs,0);assert.equal(baseline.unknownMs,end);assert.equal(baseline.hostTurns.proxyCheck.status,'unknown');
 const early=result([decision(0)],{coverage:coverage().map(c=>({...c,to:1000}))});assert.equal(early.waitingMs,1000);assert.equal(early.unknownMs,end-1000);
});

test('restart confirmation needs quiescent current checkpoint proof; old committedAt is not backdated',()=>{
 const c=coverage().filter(c=>c.stream!=='decisions');c.push(row({stream:'decisions',from:0,to:1000,complete:true}),row({stream:'decisions',from:2000,to:end,complete:true}));
 const checkpoint=row({...decision(0),kind:'checkpoint',at:3000,pendingDecision:false,quiescent:true});
 const r=result([decision(0),checkpoint],{coverage:c});assert.equal(r.waitingMs,end-2000);assert.equal(r.unknownMs,2000);
 const uncertain=result([decision(0),{...checkpoint,quiescent:undefined}],{coverage:c});assert.equal(uncertain.unknownMs,end-1000);assert.equal(uncertain.idleFractionCheck.status,'unknown');
});

test('revision contradictions and malformed state invalidate subsequent known state',()=>{
 const r=result([decision(0),decision(1000,1,'read'),decision(3000,2)]);
 assert.equal(r.unknownMs,2000);assert.equal(r.idleFractionCheck.status,'unknown');assert.ok(r.issues.some(i=>i.code==='IDLE_CHECKPOINT_CHRONOLOGY_INVALID'));
 const invalid=result([decision(0),{...interrupt(1000),eligibilityEvidence:[]}]);assert.equal(invalid.unknownMs,end-1000);
});

test('host proof gaps and incomplete turns prevent proxy pass without deleting busy overlap',()=>{
 const r=result([decision(0),host(1000,'started')]);assert.equal(r.hostTurns.proxyCheck.status,'unknown');assert.equal(r.hostTurns.busyMsByDeclaredState.waiting,end-1000);assert.equal(r.hostTurns.intervals[0].complete,false);assert.equal(r.hostTurns.busyMsIsUpperBound,true);assert.match(r.hostTurns.busyMeasure,/upper bounds/);
 const gap=result([decision(0)],{coverage:coverage().filter(c=>c.stream!=='host')});assert.equal(gap.idleFractionCheck.status,'pass');assert.equal(gap.hostTurns.proxyCheck.status,'unknown');
});

test('tokens are cumulative deltas; state-boundary deltas are unknown and never prorated',()=>{
 const records=[decision(0),row({kind:'usage-baseline',at:0,threadId:'thread-1',total:total()}),host(100,'started'),interrupt(200),host(300,'completed'),row({kind:'usage',at:300,threadId:'thread-1',turnId:'turn-1',total:total(100,20,30)})];
 const r=result(records);assert.equal(r.tokens.observed.totalTokens,120);assert.equal(r.tokens.byDeclaredState.unknown.totalTokens,120);assert.equal(r.tokens.byDeclaredState.waiting.totalTokens,0);assert.equal(r.tokens.byDeclaredState.active.totalTokens,0);assert.equal(r.tokens.deltas[0].category,'unknown');
 assert.equal(r.tokens.attributionComplete,false);
 const allWait=result(records.filter(r=>r.kind!=='interrupt'));assert.equal(allWait.tokens.byDeclaredState.waiting.totalTokens,120);assert.equal(allWait.tokens.observed.cachedInputTokens,30);
});

test('token source gaps, missing baselines, resets and boundary-straddling usage remain explicit',()=>{
 const base=row({kind:'usage-baseline',at:0,threadId:'thread-1',total:total(100)}),usage=row({kind:'usage',at:300,threadId:'thread-1',turnId:'turn-1',total:total(150,10)});
 const noBase=result([decision(0),host(100,'started'),host(300,'completed'),usage]);assert.equal(noBase.tokens.complete,false);assert.equal(noBase.tokens.observed.totalTokens,0);
 const reset=result([decision(0),base,{...usage,total:total(90)}]);assert.equal(reset.tokens.complete,false);assert.ok(reset.issues.some(i=>i.code==='IDLE_TOKEN_COUNTER_REGRESSION'));
 const gap=result([decision(0),base,host(100,'started'),host(300,'completed'),usage],{coverage:coverage().filter(c=>c.stream!=='tokens')});assert.equal(gap.tokens.complete,false);assert.equal(gap.tokens.byDeclaredState.unknown.totalTokens,60);
 const straddle=analyzeContinuityIdle({worldId:'w_trial',startAt:100,cutoffAt:end,actors:[actor],coverage:coverage(),records:[decision(0),base,usage]}).actors.reader;assert.equal(straddle.tokens.observed.totalTokens,0);assert.ok(straddle.issues.some(i=>i.code==='IDLE_TOKEN_DELTA_STRADDLES_START'));
});

test('all actor/window scopes and bounds fail closed; output retains exact source metadata',()=>{
 assert.throws(()=>run([row({...decision(0),soulId:'wrong'})]),{code:'IDLE_SOURCE_SCOPE_INVALID'});
 assert.throws(()=>run([decision(0)],{cutoffAt:0}),{code:'IDLE_CONFIG_INVALID'});
 assert.throws(()=>run([decision(0)],{coverage:[row({stream:'host',from:0,to:end,complete:false})]}),{code:'IDLE_COVERAGE_INVALID'});
 const r=result([decision(0)]);assert.deepEqual(r.raw.decisions[0].evidence,evidence);assert.deepEqual(r.intervals[0].evidence,evidence);assert.equal(r.raw.decisions[0].checkpointRevision,1);
});

test('each actor is reported independently; a missing actor state cannot inherit a peer wait',()=>{
 const other={actorId:'speaker',soulId:'s_speaker'};
 const r=run([decision(0)],{actors:[actor,other],coverage:[...coverage(),...coverage().map(c=>({...c,...other}))]});
 assert.equal(r.actors.reader.idleFractionCheck.status,'pass');assert.equal(r.actors.speaker.unknownMs,end);assert.equal(r.actors.speaker.idleFractionCheck.status,'unknown');
});

test('token delta spanning active-wait-active remains unknown; orphan turn usage cannot certify complete totals',()=>{
 const base=row({kind:'usage-baseline',at:0,threadId:'thread-1',total:total()}),usage=row({kind:'usage',at:400,threadId:'thread-1',turnId:'turn-1',total:total(10)});
 const r=result([decision(0,1,'read'),decision(100,2),interrupt(200),base,host(50,'started'),host(400,'completed'),usage]);
 assert.equal(r.tokens.byDeclaredState.unknown.totalTokens,10);
 const orphan=result([decision(0),base,usage]);assert.equal(orphan.tokens.complete,false);assert.ok(orphan.issueCodes.includes('IDLE_TOKEN_HOST_LINK_MISSING'));
});

test('pre-T0 wait cannot cross unaudited time; continuous anchor coverage or current checkpoint restores proof',()=>{
 const startAt=1000,cutoffAt=end+1000,c=coverage().map(p=>({...p,from:startAt,to:cutoffAt}));
 const absent=result([decision(0)],{startAt,cutoffAt,coverage:c});
 assert.equal(absent.waitingMs,0);assert.equal(absent.unknownMs,end);assert.equal(absent.idleFractionCheck.status,'unknown');
 assert.deepEqual(absent.carriedStateCoverage.gaps,[{from:0,to:1000}]);
 const continuous=result([decision(0)],{startAt,cutoffAt,coverage:c.map(p=>({...p,from:0}))});
 assert.equal(continuous.waitingMs,end);assert.equal(continuous.idleFractionCheck.status,'pass');
 const current=row({...decision(0),kind:'checkpoint',at:startAt,pendingDecision:false,quiescent:true});
 const confirmed=result([decision(0),current],{startAt,cutoffAt,coverage:c});
 assert.equal(confirmed.waitingMs,end);assert.equal(confirmed.idleFractionCheck.status,'pass');
 const later=result([decision(0),{...current,at:startAt+500}],{startAt,cutoffAt,coverage:c});
 assert.equal(later.unknownMs,500);assert.equal(later.waitingMs,end-500);assert.equal(later.idleFractionCheck.status,'unknown');
});
