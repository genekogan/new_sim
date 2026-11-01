// Prospective accounting only: committed wait state defines waiting independently
// of inference. Complete source coverage is an audited input, never inferred from
// an empty event list. No world/host effects and no internal-call/billing claims.
import {readFileSync} from 'node:fs';
const numeric=JSON.parse(readFileSync(new URL('../scenarios/continuity/oracles.json',import.meta.url),'utf8')).numeric;
const minimumMs=7200*1000,streams=['decisions','interrupts','host','tokens'];
const tokenFields=['inputTokens','cachedInputTokens','outputTokens','totalTokens'];
const fault=code=>Object.assign(Error(code),{code});
const id=x=>typeof x==='string'&&/^[-A-Za-z0-9_:./]{1,160}$/.test(x);
const time=x=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0;
const cited=x=>Array.isArray(x)&&x.length>0&&x.length<=64&&x.every(s=>typeof s==='string'&&s.length>0&&s.length<=1000);
const stamp=x=>time(x)?x:typeof x==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(x)&&time(Date.parse(x))?Date.parse(x):NaN;
const clone=x=>structuredClone(x);
const scope=(r,a,w)=>r?.actorId===a.actorId&&r.worldId===w&&r.soulId===a.soulId&&cited(r.evidence);
const sum=xs=>xs.reduce((a,b)=>a+b,0);
const totals=x=>x&&tokenFields.every(k=>Number.isSafeInteger(x[k])&&x[k]>=0)&&x.cachedInputTokens<=x.inputTokens&&x.totalTokens===x.inputTokens+x.outputTokens;
const emptyTokens=()=>Object.fromEntries(tokenFields.map(k=>[k,0]));
const scopeValid=x=>x==='nearby'||Array.isArray(x)&&x.length<=64&&new Set(x).size===x.length&&x.every(id);
const addTokens=(a,b)=>{for(const k of tokenFields)a[k]+=b[k];};
function merged(xs){
 const out=[];for(const x of xs.sort((a,b)=>a.from-b.from||a.to-b.to)){const last=out.at(-1);if(last&&x.from<=last.to)last.to=Math.max(last.to,x.to);else out.push({from:x.from,to:x.to});}return out;
}
function missing(xs,from,to){let cursor=from;const out=[];for(const x of merged(xs)){if(x.to<=cursor||x.from>=to)continue;if(x.from>cursor)out.push({from:cursor,to:Math.min(x.from,to)});cursor=Math.max(cursor,Math.min(x.to,to));}if(cursor<to)out.push({from:cursor,to});return out;}
const indexAt=(xs,t)=>{let lo=0,hi=xs.length;while(lo<hi){const mid=(lo+hi)>>>1;if(xs[mid].to<=t)lo=mid+1;else hi=mid;}return lo<xs.length&&xs[lo].from<=t?lo:-1;};

/** Offline bounded input contract is specified in soak-accounting-contract.md.
 * records are already source-cited native/controller facts, not model narration.
 * coverage is a caller's explicit audited completeness proof, not a heartbeat.
 */
export function analyzeContinuityIdle({worldId,startAt,cutoffAt,actors,records=[],coverage=[]}={}){
 if(!id(worldId)||!time(startAt)||!time(cutoffAt)||cutoffAt<=startAt||!Array.isArray(actors)||!actors.length||actors.length>5||actors.some(a=>!id(a?.actorId)||!id(a.soulId))||new Set(actors.map(a=>a.actorId)).size!==actors.length||new Set(actors.map(a=>a.soulId)).size!==actors.length||!Array.isArray(records)||records.length>100000||!Array.isArray(coverage)||coverage.length>10000)throw fault('IDLE_CONFIG_INVALID');
 if(records.some(r=>!actors.some(a=>scope(r,a,worldId)))||coverage.some(r=>!actors.some(a=>scope(r,a,worldId))))throw fault('IDLE_SOURCE_SCOPE_INVALID');
 const durationMs=cutoffAt-startAt,reports={};
 for(const actor of actors){
  const issues=[],issueCodes=new Set(),raw=records.filter(r=>r.actorId===actor.actorId),proofs=coverage.filter(r=>r.actorId===actor.actorId),gaps={};let issuesOmitted=0;
  const issue=(code,evidence=[])=>{issueCodes.add(code);if(issues.length<256)issues.push({code,evidence:clone(evidence)});else issuesOmitted++;};
  const hasIssue=pattern=>[...issueCodes].some(code=>pattern.test(code));
  for(const p of proofs)if(!streams.includes(p.stream)||!time(p.from)||!time(p.to)||p.to<=p.from||p.complete!==true)throw fault('IDLE_COVERAGE_INVALID');
  for(const stream of streams){gaps[stream]=missing(proofs.filter(p=>p.stream===stream),startAt,cutoffAt);if(gaps[stream].length)issue('IDLE_'+stream.toUpperCase()+'_COVERAGE_GAP');}
  const decisions=[],interrupts=[],host=[],usage=[],uncertainState=[];
  for(const r of raw){
   if(!time(r.at)){issue('IDLE_RECORD_TIME_INVALID',r.evidence);if(['decision','checkpoint','interrupt'].includes(r.kind))uncertainState.push({...r,at:startAt});continue;}
   if(['decision','checkpoint'].includes(r.kind)){
    const committedAt=stamp(r.committedAt),wakeAt=r.wakeAt===null?null:stamp(r.wakeAt);
    if(!Number.isSafeInteger(r.checkpointRevision)||r.checkpointRevision<1||!id(r.decisionId)||!['wait','read','write','listen'].includes(r.call)||!time(committedAt)||committedAt>r.at||r.kind==='decision'&&committedAt!==r.at||wakeAt!==null&&!time(wakeAt)||!scopeValid(r.listenTo)||r.kind==='checkpoint'&&(r.pendingDecision!==false||r.quiescent!==true)){issue('IDLE_COMMITTED_STATE_INVALID',r.evidence);uncertainState.push(r);continue;}
    decisions.push({...r,committedAt,wakeAt});
   }else if(r.kind==='interrupt'){
    if(!id(r.eventId)||!['owner','addressed','conversation','ambient','timer'].includes(r.reason)||typeof r.eligible!=='boolean'||!cited(r.eligibilityEvidence)){issue('IDLE_INTERRUPT_INVALID',r.evidence);uncertainState.push(r);continue;}
    interrupts.push(r);
   }else if(r.kind==='host'){
    if(!id(r.hostId)||!id(r.threadId)||!id(r.turnId)||!['started','completed'].includes(r.state)){issue('IDLE_HOST_RECORD_INVALID',r.evidence);continue;}host.push(r);
   }else if(['usage','usage-baseline'].includes(r.kind)){
    if(!id(r.threadId)||!totals(r.total)||r.kind==='usage'&&!id(r.turnId)){issue('IDLE_TOKEN_COUNTER_INVALID',r.evidence);continue;}usage.push(r);
   }else {issue('IDLE_RECORD_KIND_UNKNOWN',r.evidence);uncertainState.push(r);}
  }
  decisions.sort((a,b)=>a.at-b.at||a.checkpointRevision-b.checkpointRevision);
  const revisions=new Map(),decisionIdentities=new Map(),validDecisions=[];let lastRevision=0;
  for(const d of decisions){
   const signature=JSON.stringify([d.decisionId,d.committedAt,d.call,d.wakeAt,d.listenTo]),old=revisions.get(d.checkpointRevision);
   if(old&&old!==signature||d.checkpointRevision<lastRevision||decisionIdentities.has(d.decisionId)&&decisionIdentities.get(d.decisionId)!==signature){issue('IDLE_CHECKPOINT_CHRONOLOGY_INVALID',d.evidence);uncertainState.push(d);continue;}
   revisions.set(d.checkpointRevision,signature);decisionIdentities.set(d.decisionId,signature);lastRevision=d.checkpointRevision;validDecisions.push(d);
  }
  // Carrying a pre-window state requires source continuity from its anchor,
  // not merely coverage after T0: a missing intervening interrupt can end it.
  let stateCoverageFrom=startAt;for(const r of [...validDecisions,...interrupts])stateCoverageFrom=Math.min(stateCoverageFrom,r.at);
  const stateGaps=merged(['decisions','interrupts'].flatMap(stream=>missing(proofs.filter(p=>p.stream===stream),stateCoverageFrom,cutoffAt)));
  const changes=validDecisions.map(d=>({at:d.at,priority:2,state:d.call==='wait'?'waiting':'active',reason:d.kind==='checkpoint'?'checkpoint-confirmed':`committed-${d.call}`,evidence:d.evidence,decisionId:d.decisionId}));
  for(const d of validDecisions)if(d.call==='wait'&&d.wakeAt!==null)changes.push({at:Math.max(d.at,d.wakeAt),priority:3,state:'active',reason:'saved-timer-due',decisionId:d.decisionId,evidence:d.evidence,timer:true});
  for(const r of interrupts)if(r.eligible)changes.push({at:r.at,priority:3,state:'active',reason:`interrupt-${r.reason}`,evidence:[...r.evidence,...r.eligibilityEvidence].slice(0,64)});
  for(const g of stateGaps)changes.push({at:g.from,priority:4,state:'unknown',reason:'source-coverage-gap',evidence:[]});
  for(const r of uncertainState)changes.push({at:r.at,priority:4,state:'unknown',reason:'uncertain-state-metadata',evidence:r.evidence});
  changes.sort((a,b)=>a.at-b.at||a.priority-b.priority);
  let state='unknown',reason='no-committed-initial-state',evidence=[],decisionId=null,cursor=startAt;
  const intervals=[];
  const append=to=>{if(to>cursor)intervals.push({from:cursor,to,state,reason,evidence:clone(evidence),decisionId});cursor=to;};
  for(const c of changes){
   if(c.at>=cutoffAt)break;
   if(c.timer&&c.decisionId!==decisionId)continue; // Superseded timer proof.
   if(c.at>=startAt)append(c.at);
   const inGap=indexAt(stateGaps,c.at)>=0;
   state=inGap?'unknown':c.state;reason=inGap?'source-coverage-gap':c.reason;evidence=c.evidence;decisionId=c.decisionId??null;
  }
  append(cutoffAt);
  const stateAt=t=>intervals[indexAt(intervals,t)]?.state??'outside-window';
  const stateRuns=[];for(const i of intervals){const last=stateRuns.at(-1);if(last?.state===i.state)last.to=i.to;else stateRuns.push({from:i.from,to:i.to,state:i.state});}
  const waitingMs=sum(intervals.filter(i=>i.state==='waiting').map(i=>i.to-i.from)),activeMs=sum(intervals.filter(i=>i.state==='active').map(i=>i.to-i.from)),unknownMs=durationMs-waitingMs-activeMs;
  const turns=[],open=new Map(),openByHost=new Map(),seen=new Set();
  for(const r of host.sort((a,b)=>a.at-b.at||(a.state==='started'?-1:1))){
   const key=JSON.stringify([r.hostId,r.threadId,r.turnId]),event=key+':'+r.state;
   if(seen.has(event)){issue('IDLE_DUPLICATE_HOST_EVENT',r.evidence);continue;}seen.add(event);
   if(r.state==='started'){
    if(openByHost.has(r.hostId))issue('IDLE_OVERLAPPING_HOST_TURNS',r.evidence);
    open.set(key,r);openByHost.set(r.hostId,key);
   }else{
    const start=open.get(key);if(!start){issue('IDLE_HOST_START_MISSING',r.evidence);continue;}
    turns.push({hostId:r.hostId,threadId:r.threadId,turnId:r.turnId,from:start.at,to:r.at,evidence:[...start.evidence,...r.evidence].slice(0,64),complete:true});open.delete(key);if(openByHost.get(r.hostId)===key)openByHost.delete(r.hostId);
   }
  }
  for(const r of open.values()){if(r.at<cutoffAt){issue('IDLE_HOST_COMPLETION_MISSING',r.evidence);turns.push({hostId:r.hostId,threadId:r.threadId,turnId:r.turnId,from:r.at,to:cutoffAt,evidence:r.evidence,complete:false});}}
  const busy=merged(turns.map(t=>({from:Math.max(t.from,startAt),to:Math.min(t.to,cutoffAt)})).filter(t=>t.to>t.from));
  const busyByState={waiting:0,active:0,unknown:0};let busyIndex=0,stateIndex=0;
  while(busyIndex<busy.length&&stateIndex<intervals.length){const b=busy[busyIndex],i=intervals[stateIndex];busyByState[i.state]+=Math.max(0,Math.min(b.to,i.to)-Math.max(b.from,i.from));if(b.to<=i.to)busyIndex++;else stateIndex++;}
  const starts=host.filter(r=>r.state==='started'&&r.at>=startAt&&r.at<cutoffAt).map(r=>({...clone(r),declaredState:stateAt(r.at)}));
  const startCounts=Object.fromEntries(['waiting','active','unknown'].map(s=>[s,starts.filter(r=>r.declaredState===s).length]));
  const turnMap=new Map();for(const t of turns){const key=JSON.stringify([t.threadId,t.turnId]);if(turnMap.has(key)){issue('IDLE_HOST_TURN_IDENTITY_AMBIGUOUS',t.evidence);turnMap.set(key,null);}else turnMap.set(key,t);}
  const tokenDeltas=[],deltaTurns=new Set(),prior=new Map(),tokensByState=Object.fromEntries(['waiting','active','unknown'].map(s=>[s,emptyTokens()])),observedTokens=emptyTokens();
  for(const r of usage.sort((a,b)=>a.at-b.at)){
   const previous=prior.get(r.threadId);
   if(previous&&tokenFields.some(k=>r.total[k]<previous.total[k])){issue('IDLE_TOKEN_COUNTER_REGRESSION',r.evidence);prior.delete(r.threadId);continue;}
   if(r.kind==='usage-baseline'){
    if(r.at>startAt||previous){issue('IDLE_TOKEN_BASELINE_INVALID',r.evidence);continue;}prior.set(r.threadId,r);continue;
   }
   prior.set(r.threadId,r);
   if(r.at<startAt)continue;
   if(!previous){issue('IDLE_TOKEN_BASELINE_MISSING',r.evidence);continue;}
   if(r.at>cutoffAt){issue('IDLE_TOKEN_DELTA_STRADDLES_CUTOFF',r.evidence);continue;}
   const delta=Object.fromEntries(tokenFields.map(k=>[k,r.total[k]-previous.total[k]]));
   if(previous.at<startAt){issue('IDLE_TOKEN_DELTA_STRADDLES_START',r.evidence);continue;}
   const turn=turnMap.get(JSON.stringify([r.threadId,r.turnId]));
   if(!turn||r.at<turn.from||r.at>turn.to)issue('IDLE_TOKEN_HOST_LINK_MISSING',r.evidence);
   // Attribution requires the entire cumulative delta interval AND its actual
   // producing turn to lie in one independently classified state. No prorating.
   const from=Math.max(startAt,Math.min(previous.at,turn?.from??previous.at)),to=Math.max(r.at,turn?.to??r.at);
   const first=indexAt(stateRuns,from),last=to>from?indexAt(stateRuns,to-1):first;
   const category=turn?.complete&&r.at>=turn.from&&r.at<=turn.to&&first>=0&&first===last&&stateRuns[first].state!=='unknown'&&!gaps.tokens.some(g=>g.from<to&&g.to>from)?stateRuns[first].state:'unknown';
   tokenDeltas.push({threadId:r.threadId,turnId:r.turnId,from:previous.at,to:r.at,producingTurn:turn?{from:turn.from,to:turn.to}:null,category,delta,evidence:[...previous.evidence,...r.evidence].slice(0,64)});deltaTurns.add(JSON.stringify([r.threadId,r.turnId]));addTokens(tokensByState[category],delta);addTokens(observedTokens,delta);
  }
  for(const t of turns)if(t.from<cutoffAt&&(t.to>startAt||t.from>=startAt)&&!deltaTurns.has(JSON.stringify([t.threadId,t.turnId])))issue('IDLE_TOKEN_TURN_USAGE_MISSING',t.evidence);
  const waitingStartsPerHour=waitingMs?startCounts.waiting/(waitingMs/3600000):null;
  const waitComplete=unknownMs===0&&!gaps.decisions.length&&!gaps.interrupts.length&&!hasIssue(/COMMITTED|CHECKPOINT|INTERRUPT|RECORD_/);
  const hostComplete=!gaps.host.length&&!hasIssue(/HOST|RECORD_/);
  const tokenComplete=hostComplete&&!gaps.tokens.length&&!hasIssue(/TOKEN|RECORD_/);
  const longEnough=durationMs>=minimumMs;
  const idleFraction=waitingMs/durationMs;
  const idleStatus=!longEnough||!waitComplete?'unknown':idleFraction>=numeric.soakIdleMinimumFraction?'pass':'fail';
  const proxyStatus=!longEnough||!waitComplete||!hostComplete||!waitingMs?'unknown':waitingStartsPerHour<=numeric.soakIdleInferenceCallsPerHourMax?'pass':'fail';
  reports[actor.actorId]={actorId:actor.actorId,soulId:actor.soulId,status:'unknown',reason:'Internal inference request count is unavailable; host turns are a disclosed proxy, never the inference-call oracle.',
   durationMs,waitingMs,activeMs,unknownMs,idleFraction,intervals,coverage:clone(proofs),coverageGaps:gaps,carriedStateCoverage:{from:stateCoverageFrom,gaps:stateGaps},issues,issuesOmitted,issueCodes:[...issueCodes],
   idleFractionCheck:{status:idleStatus,minimum:numeric.soakIdleMinimumFraction},
   hostTurns:{complete:hostComplete,starts,counts:startCounts,completed:turns.filter(t=>t.complete&&t.to>=startAt&&t.from<cutoffAt).length,intervals:turns,busyMs:sum(busy.map(b=>b.to-b.from)),busyMsByDeclaredState:busyByState,
    busyMsIsUpperBound:turns.some(t=>!t.complete&&t.from<cutoffAt&&t.to>startAt),busyMeasure:'Host-turn wall-time occupancy, not measured continuous inference; aggregates containing open turns are upper bounds through cutoff.',
    waitingStartsPerHour,proxyCheck:{status:proxyStatus,maximumPerWaitingHour:numeric.soakIdleInferenceCallsPerHourMax,metric:'host turn starts, not internal inference requests'}},
   tokens:{complete:tokenComplete,attributionComplete:tokenComplete&&!tokenDeltas.some(d=>d.category==='unknown'),observed:observedTokens,byDeclaredState:tokensByState,deltas:tokenDeltas,attribution:'Unknown when a cumulative delta or its producing turn spans a declared-state boundary; no wall-time allocation.'},
   internalInferenceCalls:{status:'unknown',count:null,waitingCallsPerHour:null},billing:{authoritativeDollars:null,hardCapVerified:false},
   raw:{decisions:clone(decisions),interrupts:clone(interrupts),host:clone(host),usage:clone(usage)}};
 }
 return {schema:'continuity-idle/1',worldId,startAt,cutoffAt,durationMs,minimumWindowMs:minimumMs,windowStatus:durationMs>=minimumMs?'eligible-duration-only':'too-short',status:'unknown',actors:reports,
  limits:'Prospective accounting, not a qualification verdict. Coverage requires an independent source audit. Host-turn starts do not expose internal inference requests. No invoice or hard token-budget claim.'};
}
