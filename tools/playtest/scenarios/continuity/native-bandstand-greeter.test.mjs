// Prospective six-body fixture mechanics only. No model/service, pose mutation,
// follow, participant coaching or change to the frozen task/oracle contracts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate,setTimeout as sleep} from 'node:timers/promises';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
import {bootEden} from '../../../../apps/server/test/eden-capabilities-timing.ts';
import {accept,invite} from '../../../../apps/server/test/native-owner-fixture.ts';
import {mountEdgeRoutes} from '../../../../apps/server/src/edge/routes.ts';
import {EdgeError} from '../../../../apps/server/src/edge/contract.ts';
import {hereBodyFrame} from '../../../../apps/server/src/edge/perception/here.ts';
import {insidePolygon} from '../../review/journey-oracles.mjs';
const root=new URL('../../../../',import.meta.url),specBytes=readFileSync(new URL('./bandstand-greeter-static-v2.json',import.meta.url)),spec=JSON.parse(specBytes),fixtureBytes=readFileSync(new URL('./fixtures.json',import.meta.url));
// Only mechanical venue/activity/name fields are used, never model instructions.
const band=JSON.parse(fixtureBytes).scenarios.find(s=>s.id===spec.baseScenario),greeting=band.disturbances.find(d=>d.id===spec.greeting.disturbanceId);
const {Hono}=createRequire(new URL('../../../../apps/server/package.json',import.meta.url))('hono');
const sha=b=>createHash('sha256').update(b).digest('hex'),distance=(a,b)=>Math.hypot(a.pos[0]-b.pos[0],a.pos[2]-b.pos[2]);
const inRegion=(b,r)=>Math.hypot(b.pos[0]-r.pos[0],b.pos[2]-r.pos[1])<=r.radiusM&&(!r.excludePolygon||!insidePolygon([b.pos[0],b.pos[2]],r.excludePolygon));
const push=(xs,x,max)=>{assert(xs.length<max,'bounded physical evidence');xs.push(x);};
assert.equal(greeting.text,spec.greeting.text);assert.equal(greeting.trigger.offsetSec,150);assert.equal(greeting.trigger.maximumDelaySec,2);assert.equal(greeting.trigger.deliveryKind,'world');
assert.equal(spec.mechanicalWitnessesOnly.minimumPerformanceSec,30);assert.equal(spec.mechanicalWitnessesOnly.minimumAudienceOverlapSec,15);

async function runCase(t,clock){
 const p={schema:'continuity-bandstand-static-native-proof/1',clock,status:'incomplete',startedAt:Date.now(),sourceHead:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),node:{executable:process.execPath,version:process.version},testSha256:sha(readFileSync(new URL(import.meta.url))),specSha256:sha(specBytes),fixturesSha256:sha(fixtureBytes),templateSha256:sha(readFileSync(new URL('../../../../worlds/templates/eden-2026.json',import.meta.url))),checks:{},boot:[],requests:[],routes:[],samples:[],publicEffects:[],recipientEvents:[],limits:[...spec.limits,'Native setup stages all four synthetic audience bodies before T0, including the normally late actor; this is not frozen model-release or task behavior.','The default boot Soul plays the synthetic performer role; this is not a model roster/name qualification.','Accelerated native ticks never establish a real UTC hold or T+150 delivery.','Endpoint/path/hearing proof applies only to these fixed physical witnesses; no universal valid-position or arbitrary trajectory claim.']};
 let w,comms,sampler,sampleError=null,closed=false;
 const close=()=>{if(closed)return;closed=true;clearInterval(sampler);if(w){w.host.stop();p.finalTick=w.host.engine.world.tick;p.nativeViolations=structuredClone(w.host.engine.runtime.violations);p.paidCost=w.db.paidCost();comms?.close();p.cleanup={pid:process.pid,clockStopped:!w.host.running,externalServicesOrModelProcessesStarted:0,metadataGitProcessesCompleted:1};w.close();}};
 t.after(close);
 try{
  w=await bootEden(m=>push(p.boot,m,100));w.brain.quiesce();
  const tick=async(n=4)=>{assert(!w.host.running,'never manual-step an active real clock');for(let i=0;i<n;i++){t.signal.throwIfAborted();w.host.tickOnce();if(i%4===0){await setImmediate();w.host.drainInputs();}}};
  const roles=new Map([['performer',w.soul]]);
  for(const role of ['guest-1','guest-2','guest-3','guest-4','greeter']){
   const owner='native-static-'+role;await invite(w,owner);const name=role==='greeter'?spec.greeter.publicName:band.actors.find(a=>a.id===role).soulName;
   const row=await accept(w.host,w.souls.create('dev:'+owner,{name,description:'Synthetic native physical fixture only; no inference'}));roles.set(role,{soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner});await tick(2);
  }
  p.actors=[...roles].map(([role,s])=>({role,soulId:s.soulId,entityId:s.entityId,name:s.name}));assert.equal(roles.size,6);
  const performer=roles.get('performer'),greeter=roles.get('greeter'),target=roles.get(spec.greeting.recipient),bench=w.god.model.get(spec.greeter.authoredRef);assert(bench,'fresh authored bench binding');p.bench={ref:spec.greeter.authoredRef,entityId:bench.id};
  const current=s=>{const e=w.host.engine.world.entities[s.entityId],me=hereBodyFrame(w.edge,s).me;assert(e?.human&&me);return {soulId:s.soulId,tick:w.host.engine.world.tick,pos:[...e.pose.p],place:me.place,posture:me.posture,activity:e.human.activity??null,instrument:e.human.instrument??null,seat:me.seat??null,programActive:w.host.engine.programOf(s.entityId)!==null,supportProblem:me.posture==='standing'?w.host.engine.standingSupportProblemV1?.(s.entityId)??null:null};};
  const sample=()=>{const row={at:Date.now(),tick:w.host.engine.world.tick,clock:{baseRate:w.host.baseRate,clockRate:w.host.clockRate,pace:w.host.pace},bodies:[...roles].map(([role,s])=>({role,...current(s)}))};push(p.samples,row,1000);return row;};
  const app=new Hono(),byId=new Map([...roles.values()].map(s=>[s.soulId,s]));
  comms=mountEdgeRoutes(app,{host:w.host,db:w.db,souls:w.souls,ledger:w.edge,soul:c=>{const s=byId.get(c.req.header('authorization')?.replace(/^Bearer /,''));if(!s)throw new EdgeError(401,'unauthorized','synthetic owned scope only');return s;}});
  comms.onSpectator(e=>{if(e.kind==='speech')push(p.publicEffects,{observedAt:Date.now(),event:structuredClone(e)},8);});
  comms.streams.onEvent((soulId,e)=>{if(soulId===target.soulId)push(p.recipientEvents,{observedAt:Date.now(),event:structuredClone(e)},256);});
  const post=async(s,path,input)=>{const requestedAt=Date.now(),response=await accept(w.host,Promise.resolve(app.request(path,{method:'POST',headers:{authorization:'Bearer '+s.soulId,'content-type':'application/json'},body:JSON.stringify(input)}))),body=await response.json();push(p.requests,{soulId:s.soulId,path,input,requestedAt,receivedAt:Date.now(),status:response.status,body},16);assert.equal(response.status,200,JSON.stringify(body));return body;};
  const act=async(s,capability,params,key)=>{const response=await post(s,'/v1/edge/act',{capability,params,clientRef:'band-static-'+clock+'-'+key});assert.equal(response.accepted,true,JSON.stringify(response));assert(response.receipt?.id);return response.receipt;};
  const receipt=(s,id)=>w.edge.receipt(s.soulId,id);
  const held=()=>{const b=current(greeter);assert.equal(b.posture,'seated');assert(b.seat?.startsWith(bench.id+'#'),'native held slot belongs to the actual bench');if(p.greeterSeated)assert(distance(b,p.greeterSeated)<.01,'greeter stays stationary');return b;};
  const routeTrace=(role,s)=>{const row={role,source:'current-native-engine',start:current(s),points:[],minimumGreeterDistanceM:null};p.routes.push(row);return row;};
  const tracePoint=(trace,s)=>{const body=current(s),g=current(greeter);push(trace.points,{body,greeter:g},700);trace.minimumGreeterDistanceM=Math.min(trace.minimumGreeterDistanceM??Infinity,distance(body,g));if(p.greeterSeated)held();};
  p.initial=sample();p.bench.resolve=w.edge.intents.dryRun(greeter,{capability:spec.greeter.walkCapability});assert.equal(p.bench.resolve.ok,true,'ordinary authored bench walk resolves');
  const walkReceipt=await act(greeter,spec.greeter.walkCapability,{},'bench-approach'),benchRoute=routeTrace('greeter',greeter);benchRoute.acceptedReceipt=walkReceipt;
  let advanced=0;while(['waiting','started'].includes(receipt(greeter,walkReceipt.id)?.phase)&&advanced<2400){await tick(4);advanced+=4;tracePoint(benchRoute,greeter);}benchRoute.finalReceipt=receipt(greeter,walkReceipt.id);benchRoute.end=current(greeter);assert.equal(benchRoute.finalReceipt?.phase,'completed','native bench approach completes without alternate target');
  const offers=w.edge.capabilities(greeter).filter(c=>c.verb==='sit'&&c.available&&c.target?.id===bench.id&&c.id!=='sit:here');p.bench.offers=offers;assert.equal(offers.length,1,'use the actual local offered sit targeting this fresh bench');
  const sit=await act(greeter,offers[0].id,{seconds:spec.greeter.seatSeconds},'bench-sit-once');advanced=0;while(['waiting','started'].includes(receipt(greeter,sit.id)?.phase)&&advanced<400){await tick(4);advanced+=4;}p.bench.sit={accepted:sit,final:receipt(greeter,sit.id)};assert.equal(p.bench.sit.final?.phase,'completed');p.greeterSeated=held();p.checks.nativeGreeterSetup={status:'pass',benchId:bench.id,slot:p.greeterSeated.seat,receiptId:sit.id};
  // Exact predeclared native ground witnesses, as in the accepted five-body
  // physical proof. These are not model inputs or a substitute canonical walk.
  for(const [role,to]of Object.entries(spec.mechanicalWitnessesOnly.audienceTargets)){
   const s=roles.get(role),program={actor:s.entityId,label:'fixture-only fixed audience ground witness',steps:[{verb:'walk_to',params:{to}}]};assert(inRegion({pos:[to[0],0,to[1]]},band.venue.audienceRegion));assert.equal(w.host.engine.canPerform(program),null);
   const trace=routeTrace(role,s);trace.target=to;trace.accepted=await accept(w.host,w.host.enqueue('decision','fixture:bandstand-static',{soulId:s.soulId,entityId:s.entityId,option:'fixed-'+role,label:program.label,steps:program.steps,reevalTicks:1e9,fallback:false,trigger:'fixture'}));
   advanced=0;while((Math.hypot(current(s).pos[0]-to[0],current(s).pos[2]-to[1])>.35||current(s).programActive)&&advanced<2400){await tick(4);advanced+=4;tracePoint(trace,s);}trace.end=current(s);assert(Math.hypot(trace.end.pos[0]-to[0],trace.end.pos[2]-to[1])<=.35);assert.equal(trace.end.programActive,false);assert(inRegion(trace.end,band.venue.audienceRegion));assert.equal(trace.end.supportProblem,null);held();
  }
  const instrument=w.god.model.get(band.activity.targetRef);assert(instrument);const capability=band.activity.capabilityTemplate.replace('{entityId}',instrument.id),performReceipt=await act(performer,capability,{seconds:200},'violin-once'),performRoute=routeTrace('performer',performer);performRoute.acceptedReceipt=performReceipt;
  advanced=0;while(current(performer).activity!=='play-music'&&advanced<2400){await tick(4);advanced+=4;tracePoint(performRoute,performer);}performRoute.end=current(performer);assert.equal(performRoute.end.activity,'play-music');assert.equal(performRoute.end.instrument,'violin');assert(inRegion(performRoute.end,band.venue.activityRegion));held();p.performance={receipt:performReceipt,initial:performRoute.end};
  const witnesses=()=>{const bs=[...roles].map(([role,s])=>({role,...current(s)})),a=bs.filter(b=>b.role.startsWith('guest-')),f=bs.find(b=>b.role==='performer');assert(a.every(b=>inRegion(b,band.venue.audienceRegion)&&!b.programActive));for(let i=0;i<a.length;i++)for(let j=i+1;j<a.length;j++)assert(distance(a[i],a[j])>.7);assert.equal(f.activity,'play-music');assert.equal(f.instrument,'violin');assert(inRegion(f,band.venue.activityRegion));held();return bs;};
  witnesses();p.checks.sixBodyApproaches={status:'pass',limits:'Only completed actual native fixed routes while bench occupied; no universal route guarantee.',minimumAudienceApproachDistances:p.routes.filter(r=>r.role.startsWith('guest-')).map(r=>({role:r.role,minimumGreeterDistanceM:r.minimumGreeterDistanceM})),minimumPerformerApproachDistanceM:performRoute.minimumGreeterDistanceM};
  p.preT0=sample();p.t0=Date.now();p.t0Tick=w.host.engine.world.tick;p.scheduledAt=p.t0+150000;const streamStart=comms.streams.head(target.soulId);
  const sayOnce=async(scheduledAt,semantics)=>{assert(!p.greeting,'one speech attempt, no retry');p.greeting={scheduledAt,semantics,attemptedAt:Date.now(),before:sample()};const response=await post(greeter,'/v1/edge/say',{text:greeting.text});p.greeting.response=response;p.greeting.returnedAt=Date.now();const id=response.said?.id;assert(id,'actual native effect identity');const stream=comms.streams.read(target.soulId,streamStart,1000);assert(!stream.gap);p.greeting.recipientStream={cursor:stream.cursor,gap:stream.gap??false};p.greeting.events=stream.events.filter(e=>e.kind==='speech'&&e.saidId===id&&e.from?.soulId===greeter.soulId);p.greeting.public=p.publicEffects.filter(r=>r.event.id===id);assert.equal(p.greeting.events.length,1,'exact native recipient event');assert.equal(p.greeting.public.length,1);assert(p.greeting.public[0].event.heardBy.includes(target.soulId));assert.equal(p.greeting.events[0].text,greeting.text);assert(p.greeting.events[0].at>=scheduledAt&&p.greeting.events[0].at<=scheduledAt+2000);p.checks.nativeSpeechRecipient={status:'pass',effectId:id,eventId:p.greeting.events[0].id,semantics};};
  if(clock==='accelerated-native-ticks'){
   for(let sec=0;sec<=150;sec++){witnesses();sample();if(sec<150)await tick(20);}
   p.checks.performanceAndAudienceHold={status:'pass',nativeSeconds:150,requiredPerformanceSeconds:30,requiredAudienceOverlapSeconds:15,realUtcCertified:false};
   await sayOnce(Date.now(),'Immediate mechanical native speech at150 simulated seconds; NOT realUTC T0+150 proof');
  }else{
   assert(w.host.baseRate<=1&&w.host.clockRate<=1&&w.host.pace<=1);console.log(JSON.stringify({state:'bandstand-static-realUTC-start',pid:process.pid,t0:p.t0,scheduledAt:p.scheduledAt,source:p.sourceHead}));w.host.start();
   sampler=setInterval(()=>{try{sample();witnesses();}catch(e){sampleError??=e;}},1000);
   while(Date.now()<p.scheduledAt)await sleep(Math.min(250,p.scheduledAt-Date.now()),undefined,{signal:t.signal});
   await sayOnce(p.scheduledAt,'Original one-shot T0+150 realUTC, unconditional on recipient position');clearInterval(sampler);assert.equal(sampleError,null);sample();witnesses();
   const ss=p.samples.filter(r=>r.at>=p.preT0.at);p.sampling={first:ss[0]?.at,last:ss.at(-1)?.at,maximumGapMs:Math.max(...ss.slice(1).map((r,i)=>r.at-ss[i].at))};assert(p.sampling.maximumGapMs<=2000,'original sampling bound, never normalized');
   assert(ss.every(r=>r.clock.baseRate<=1&&r.clock.clockRate<=1&&r.clock.pace<=1));assert(ss.at(-1).at-p.t0>=30000);p.checks.performanceAndAudienceHold={status:'pass',actualSampledDurationMs:ss.at(-1).at-p.t0,requiredPerformanceSeconds:30,requiredAudienceOverlapSeconds:15,realUtcCertified:true,scope:'Synthetic stationary physical witness only; no model holdout/qualification'};
  }
  assert.deepEqual(w.host.engine.runtime.violations,[]);assert.equal(w.db.paidCost(),0);p.checks.invariantsAndNoPaidModel={status:'pass'};p.status='pass';
 }catch(error){p.status='fail';p.failure={name:error.name,code:error.code??null,message:error.message};throw error;}
 finally{close();p.finishedAt=Date.now();const requested=process.env.CONTINUITY_NATIVE_FIXTURE_PROOF_DIR;if(requested){const out=resolve(requested),allowed='<team>/scratch/continuity-20261029/fixtures';assert(out.startsWith(allowed+'/'));mkdirSync(out,{recursive:true});const file=join(out,`bandstand-static-${clock}-${p.startedAt}-${process.pid}.json`);writeFileSync(file,JSON.stringify(p,null,2)+'\n',{flag:'wx',mode:0o600});t.diagnostic('native static-greeter proof: '+file);}}
}

test('prospective static bench greeter: six native bodies, occupied approach paths and exact recipient',{timeout:180000},t=>runCase(t,'accelerated-native-ticks'));
test('prospective static bench greeter: original one-shot realUTC T+150 and actual physical hold',{skip:process.env.CONTINUITY_NATIVE_STATIC_REALTIME!=='1',timeout:210000},t=>runCase(t,'ordinary-host-clock'));
