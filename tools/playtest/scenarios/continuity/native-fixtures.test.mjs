// Holdout geometry/capability feasibility only. No model, service or transcript.
// All body movement is a logged native journey, never a pose mutation/teleport.
import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers/promises';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {bootEden} from '../../../../apps/server/test/eden-capabilities-timing.ts';
import {accept,invite} from '../../../../apps/server/test/native-owner-fixture.ts';
import {hereFrame} from '../../../../apps/server/src/edge/perception/here.ts';
import {insidePolygon} from '../../review/journey-oracles.mjs';
import {poolGardenAt} from './garden-pool.mjs';

const root=new URL('../../../../',import.meta.url),fixtureBytes=readFileSync(new URL('./fixtures.json',import.meta.url)),fixtures=JSON.parse(fixtureBytes),walk=fixtures.scenarios.find(s=>s.id==='eden-walk-three'),band=fixtures.scenarios.find(s=>s.id==='eden-bandstand-five');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const inRegion=(body,region)=>Math.hypot(body.pos[0]-region.pos[0],body.pos[2]-region.pos[1])<=region.radiusM&&(!region.excludePolygon||!insidePolygon([body.pos[0],body.pos[2]],region.excludePolygon));

test('sealed Eden holdout paths and bandstand crowd/performance have bounded native physical witnesses', {timeout:180000},async t=>{
 const proof={schema:'continuity-holdout-native-preflight/1',startedAt:new Date().toISOString(),status:'incomplete',scope:'in-memory full Eden template, five synthetic owned bodies, fake Brain quiesced; accelerated native ticks establish feasibility only, not real-time holds, independent agent behavior, release readiness, A/B or holdout acceptance',sourceHead:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),fixturesSha256:sha(fixtureBytes),templateSha256:sha(readFileSync(new URL('../../../../worlds/templates/eden-2026.json',import.meta.url))),testSha256:sha(readFileSync(new URL(import.meta.url))),checks:[],failures:[],boot:[]};
 let w;
 t.after(()=>{
  if(w){proof.finalTick=w.host.engine.world.tick;proof.nativeViolations=structuredClone(w.host.engine.runtime.violations);proof.paidCost=w.db.paidCost();w.close();}
  proof.endedAt=new Date().toISOString();
  const requested=process.env.CONTINUITY_NATIVE_FIXTURE_PROOF_DIR;
  if(requested){const out=resolve(requested),allowed=resolve('.local/playtest/continuity-fixtures');assert.ok(out===allowed||out.startsWith(allowed+'/'),'export only to explicitly authorized fixture proof directory');mkdirSync(out,{recursive:true});const file=join(out,`holdout-native-${Date.now()}-${process.pid}.json`);writeFileSync(file,JSON.stringify(proof,null,2)+'\n');t.diagnostic('native fixture proof: '+file);}
 });
 w=await bootEden(message=>proof.boot.push(message));w.brain.quiesce();
 const tick=async(n=20)=>{for(let i=0;i<n;i++){w.host.tickOnce();if(i%20===0){await setImmediate();w.host.drainInputs();}}};
 const body=soul=>{
  const entity=w.host.engine.world.entities[soul.entityId],me=hereFrame(w.edge,soul).me;
  return {tick:w.host.engine.world.tick,source:'current-native-engine',pos:[...entity.pose.p],posture:me.posture,activity:entity.human?.activity??null,instrument:entity.human?.instrument??null,seat:me.seat??null,reportedIntentActivity:me.activity};
 };
 const souls=[w.soul];
 for(let i=1;i<5;i++){
  const owner='continuity-fixture-'+i;await invite(w,owner);const row=await accept(w.host,w.souls.create('dev:'+owner,{name:'NativeFixture'+i,description:'Synthetic physical fixture only; no inference'}));souls.push({soulId:row.id,entityId:row.entity_id,name:row.name,owner:row.owner});await tick(2);
 }
 proof.bodyCount=souls.length;proof.initialBodies=souls.map(body);
 const check=async(name,fn)=>{
  const entry={name,status:'running',startTick:w.host.engine.world.tick};proof.checks.push(entry);
  try{await fn(entry);entry.status='pass';}catch(error){entry.status='fail';entry.error=error.message;proof.failures.push({name,error:error.message});}entry.endTick=w.host.engine.world.tick;
 };
 const journey=async(soul,capability,entry,params={})=>{
  const start=body(soul),response=await accept(w.host,Promise.resolve(w.edge.act(soul,{capability,params,clientRef:'continuity-physical-'+w.host.engine.world.tick+'-'+soul.entityId})));
  const trace={capability,params,start,response};(entry.journeys??=[]).push(trace);assert.equal(response.accepted,true,JSON.stringify(response));assert.ok(response.receipt?.id,'native receipt identity');
  let receipt=w.edge.receipt(soul.soulId,response.receipt.id),advanced=0;
  while(['waiting','started'].includes(receipt?.phase)&&advanced<2400){await tick(20);advanced+=20;receipt=w.edge.receipt(soul.soulId,response.receipt.id);}
  trace.receipt=receipt;trace.end=body(soul);trace.advancedTicks=advanced;assert.equal(receipt?.phase,'completed',JSON.stringify(trace));return trace.end;
 };
 const walkers=souls.slice(0,3);
 await check('three native walkers reach the declared garden under existing body occupancy',async entry=>{
  entry.binding=w.god.model.get(walk.venue.gardenRef)?.id??null;assert.ok(entry.binding,'fresh template garden binding');
  for(const soul of walkers)assert.ok(inRegion(await journey(soul,walk.venue.gardenWalkCapability,entry),walk.venue.gardenRegion),'actual garden arrival lies in the frozen region');
  entry.group=walkers.map(body);assert.ok(entry.group.every(b=>inRegion(b,walk.venue.gardenRegion)),'all three are currently in garden together');
 });
 await check('independent errand reaches declared Commons Pavilion and can return to garden',async entry=>{
  const errand=walk.disturbances.find(d=>d.id==='independent-errand'),soul=walkers[1],binding=w.god.model.get(errand.errandRef);assert.ok(binding,'fresh Commons Pavilion binding');entry.binding=binding.id;
  const at=await journey(soul,'walk:'+errand.errandRef,entry);assert.ok(inRegion(at,errand.errandRegion),'native errand destination lies in the frozen region');entry.peerDistances=walkers.filter(s=>s!==soul).map(s=>Math.hypot(body(s).pos[0]-at.pos[0],body(s).pos[2]-at.pos[2]));assert.ok(entry.peerDistances.every(d=>d>=12),'errand can separate the walker from both garden peers');
  assert.ok(inRegion(await journey(soul,walk.venue.gardenWalkCapability,entry),walk.venue.gardenRegion),'native return reaches companions');
 });
 // garden-pool-v2: every other sealed pool garden is natively walkable and its
 // arrivals fall in that garden under nearest-pool-centre membership.
 const poolGarden=b=>poolGardenAt([b.pos[0],b.pos[2]],walk.gardenCandidates)?.ref;
 for(const g of walk.gardenCandidates.filter(g=>g.ref!==walk.venue.gardenRef))await check('three walkers reach sealed pool garden '+g.ref,async entry=>{
  entry.binding=w.god.model.get(g.ref)?.id??null;assert.ok(entry.binding,'fresh pool garden binding');
  for(const soul of walkers)assert.equal(poolGarden(await journey(soul,g.walkCapability,entry)),g.ref,'native arrival lies in this pool garden');
  entry.group=walkers.map(body);assert.ok(entry.group.every(b=>poolGarden(b)===g.ref),'all three are currently in the same pool garden');
 });
 for(const endpoint of walk.endpointCandidates)await check('three walkers reach sealed second landmark '+endpoint.ref,async entry=>{
  entry.binding=w.god.model.get(endpoint.ref)?.id??null;assert.ok(entry.binding,'fresh endpoint binding');for(const soul of walkers)assert.ok(inRegion(await journey(soul,endpoint.walkCapability,entry),endpoint.region),'native endpoint arrival lies in the frozen region');entry.group=walkers.map(body);assert.ok(entry.group.every(b=>inRegion(b,endpoint.region)),'all three fit at the same endpoint under occupancy');
 });
 // Four fixed witnesses, chosen from the declared ground region before any
 // query. Native admission/route failure is retained; no grid search or swap.
 const [cx,cz]=band.venue.audienceRegion.pos,audienceTargets=[[cx-4,cz-4],[cx,cz-5],[cx+4,cz-4],[cx+5,cz]];
 await check('four distinct audience ground positions are reachable under five-body occupancy',async entry=>{
  entry.fixtureOnly=true;entry.targets=audienceTargets;
  for(const [i,soul] of souls.slice(1).entries()){
   const to=audienceTargets[i],program={actor:soul.entityId,label:'fixture-only audience ground witness',steps:[{verb:'walk_to',params:{to}}]};assert.ok(inRegion({pos:[to[0],0,to[1]]},band.venue.audienceRegion),'witness is inside sealed audience region and outside excluded performer polygon');
   const admission=w.host.engine.canPerform(program);assert.equal(admission,null,JSON.stringify(admission));const before=body(soul),accepted=await accept(w.host,w.host.enqueue('decision','fixture:continuity-audience',{soulId:soul.soulId,entityId:soul.entityId,option:'fixture-audience-'+i,label:program.label,steps:program.steps,reevalTicks:1e9,fallback:false,trigger:'fixture'}));
   let advanced=0;while(Math.hypot(body(soul).pos[0]-to[0],body(soul).pos[2]-to[1])>.35&&advanced<2400){await tick(20);advanced+=20;}
   const end=body(soul);(entry.routes??=[]).push({target:to,before,accepted,end,advancedTicks:advanced});assert.ok(Math.hypot(end.pos[0]-to[0],end.pos[2]-to[1])<=.35,'actual native walk reaches the exact fixture ground witness');assert.ok(inRegion(end,band.venue.audienceRegion));
  }
  entry.group=souls.slice(1).map(body);entry.distances=[];for(let i=0;i<entry.group.length;i++)for(let j=i+1;j<entry.group.length;j++)entry.distances.push(Math.hypot(entry.group[i].pos[0]-entry.group[j].pos[0],entry.group[i].pos[2]-entry.group[j].pos[2]));assert.ok(entry.distances.every(d=>d>.7),'four current audience bodies occupy distinct ground positions');
 });
 await check('native authored violin is supported and actual body performs with all four current audience witnesses',async entry=>{
  const instrument=w.god.model.get(band.activity.targetRef);assert.ok(instrument,'fresh authored violin entity');entry.binding={ref:band.activity.targetRef,entityId:instrument.id};
  const capability=band.activity.capabilityTemplate.replace('{entityId}',instrument.id),dry=w.edge.intents.dryRun(souls[0],{capability});entry.resolve=dry;assert.equal(dry.ok,true,JSON.stringify(dry));
  const response=await accept(w.host,Promise.resolve(w.edge.act(souls[0],{capability,params:{seconds:40},clientRef:'continuity-native-violin'})));entry.response=response;assert.equal(response.accepted,true,JSON.stringify(response));
  let advanced=0;while(body(souls[0]).activity!=='play-music'&&advanced<2400){await tick(20);advanced+=20;}entry.start=body(souls[0]);entry.postureProvenance={source:'native here.me.posture (stateOf), not a physical standing/seated boolean',observed:entry.start.posture,declared:band.activity.postures,declaredJourney:band.journeyTemplates.performer[0].postures,matchesDeclared:band.activity.postures.includes(entry.start.posture)};assert.equal(entry.start.activity,'play-music','actual native body activity, not the open receipt intent projection');assert.equal(entry.start.instrument,'violin');assert.ok(inRegion(entry.start,band.venue.activityRegion));
  entry.samples=[];for(let n=0;n<=30;n++){const performer=body(souls[0]),audience=souls.slice(1).map(body);entry.samples.push({performer,audience});assert.equal(performer.activity,'play-music');assert.equal(performer.instrument,'violin');assert.ok(inRegion(performer,band.venue.activityRegion));assert.ok(audience.every(b=>inRegion(b,band.venue.audienceRegion)));if(n<30)await tick(20);}
  entry.simulatedSeconds=30;entry.realTimeQualification=false;entry.receipt=w.edge.receipt(souls[0].soulId,response.receipt.id);
 });
 assert.deepEqual(w.host.engine.runtime.violations,[],'no native invariant violations');assert.equal(w.db.paidCost(),0,'no paid provider calls');proof.status=proof.failures.length?'fail':'pass';t.diagnostic(JSON.stringify({status:proof.status,checks:proof.checks.map(c=>({name:c.name,status:c.status,error:c.error})),nativeViolations:w.host.engine.runtime.violations,paidCost:w.db.paidCost()}));assert.deepEqual(proof.failures,[],'physical holdout preflight failures are retained, never repaired by changing sealed fixtures');
});
