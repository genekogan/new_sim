// PM-T057 ONE affected bounded current-commons workload with empty renewal settled. Exact immutable C194 runtime;
// no old Greenfield capacity replay, pose/graph injection or production switch.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {setImmediate} from 'node:timers/promises';
const input=resolve(new URL('../../../../.e2e/exports/core-native-c190-live-me-45b9c986/sim',import.meta.url).pathname);
const manifest=JSON.parse(readFileSync(join(input,'../CONTENT-MANIFEST.json'),'utf8'));
const paths=['apps/server/src/db.ts','apps/server/src/world.ts','apps/server/src/auth.ts','apps/server/src/brain.ts','apps/server/src/souls.ts','apps/server/src/http.ts','apps/server/src/living.ts','apps/server/src/lifecycle-runner.ts','apps/server/src/lifecycle-journal.ts','packages/engine-mars/src/engine.ts','packages/engine-mars/src/birth.ts'];
const pins=paths.map(path=>{const sha256=createHash('sha256').update(readFileSync(join(input,path))).digest('hex');assert.equal(sha256,manifest[path].sha256);return {path,sha256};});
const load=(p:string)=>import(pathToFileURL(join(input,p)).href);
const {Db}=await load('apps/server/src/db.ts'),{WorldHost}=await load('apps/server/src/world.ts'),{Auth}=await load('apps/server/src/auth.ts');
const {Brain}=await load('apps/server/src/brain.ts'),{Souls}=await load('apps/server/src/souls.ts'),{buildApp}=await load('apps/server/src/http.ts'),{config}=await load('apps/server/src/config.ts'),{LivingWorld}=await load('apps/server/src/living.ts');
const {marsFactory,EDEN_SAFE_COMMONS_WORLD}=await load('packages/engine-mars/src/index.ts'),{kernelHash}=await load('packages/kernel/src/index.ts');
const {humanStaticClearance,humanHumanSeparation}=await load('mars/viewer/engine/runtime/invariants.ts');
const factory=await marsFactory({...EDEN_SAFE_COMMONS_WORLD,safeCrewRemoval:true}),seed='c194-cohort-capacity/1',worldId='c194-cohort-local';
const counts=[20,30];
const percentile=(values:number[],q:number)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*q))];
test('current immutable C194 native commons '+counts.join(' then')+' ordinary invited owned Souls bounded real movement workload',async t=>{
  const timers:ReturnType<typeof setInterval>[]=[],original=setInterval;t.mock.method(globalThis,'setInterval',(...args:Parameters<typeof setInterval>)=>{const timer=original(...args);timers.push(timer);return timer;});t.after(()=>timers.forEach(clearInterval));
  const dir=mkdtempSync(join(tmpdir(),'core-c194-cohort-')),path=join(dir,'world.sqlite'),db=new Db(path),host=new WorldHost(db,factory,seed,1e9,worldId,{durableClockV1:true});host.boot();host.drainInputs();
  const cfg={...config,worldId,worldKey:'eden',worldPath:'/w/eden',publicUrl:'http://127.0.0.1:4959/w/eden',brainMode:'fake',budgetUsdPerDay:0,typesafeKey:undefined,anthropicKey:undefined,privyAppId:'',privyAppSecret:'',inviteRequired:true};
  const living=new LivingWorld(host);
  const initial=living.install(['People may explore the commons and meet each other.']);host.drainInputs();await initial;
  for(let i=0;i<4;i++){host.tickOnce();host.drainInputs();await setImmediate();}
  assert.equal(host.quietBarrier,false);assert.equal(host.living.lastDay,0);assert.equal(host.minds.size,0);
  const initialized={tick:host.engine.world.tick,living:structuredClone(host.living),source:'C207/PM empty Living-before-Brain startup'};
  const auth=new Auth(cfg,db);auth.devAuth=true;const brain=new Brain(host,db,cfg,{clients:()=>0,onCall(){},onCamera(){},onTicker(){},onNarrative(){},onTalk(){}}),souls=new Souls(host,db,brain,cfg);souls.enableLifecycle();
  const app=buildApp({cfg,db,host,auth,brain,souls,hub:{clients:new Map(),refreshMe(){}}});
  const request=(p:string,owner:string,body?:unknown,extra:Record<string,string>={})=>app.request(p,{method:body?'POST':'GET',headers:{authorization:'Bearer dev:'+owner,...(body?{'content-type':'application/json'}:{}),...extra},...(body?{body:JSON.stringify(body)}:{})});
  async function drive<T>(p:Promise<T>):Promise<T>{let done=false;p.then(()=>done=true,()=>done=true);for(let i=0;i<100&&!done;i++){await setImmediate();host.drainInputs();}assert.ok(done,'actual sequencer settled');return p;}
  const admitted:any[]=[],phases:any[]=[],programEvents:any[]=[],pairs:any[]=[],step=host.engine.step.bind(host.engine);
  const motion=new Map<string,{ownedMetres:number;otherMetres:number;witnesses:any[]}>();
  t.mock.method(host.engine,'step',()=>{
    const live=new Set(host.engine.runtime.liveIds());
    const prior=admitted.map(a=>{const pid=host.engine.programOf(a.entityId),program=pid?host.engine.programAction(pid):null,record=program?host.engine.runtime.records.get(program.action.id):null;
      return {a,root:[...host.engine.world.entities[a.entityId].pose.p],program,record};});
    const out=step();programEvents.push(...out.programs);
    for(const before of prior){const root=host.engine.world.entities[before.a.entityId].pose.p,metres=Math.hypot(root[0]-before.root[0],root[2]-before.root[2]);if(metres<1e-9)continue;
      const params=before.record?.params as {actor?:string}|undefined,own=before.program?.actor===before.a.entityId&&before.program.action.verb==='walk_to'&&params?.actor===before.a.entityId&&live.has(before.program.action.id);
      const current=motion.get(before.a.entityId)!;if(own){current.ownedMetres+=metres;if(current.witnesses.length<4)current.witnesses.push({tick:host.engine.world.tick,program:before.program,actionId:before.record!.id,from:before.root,to:[...root],metres});}else current.otherMetres+=metres;
    }return out;
  });
  let failure:unknown;
  try{
    for(const count of counts){
      const admissionMs:number[]=[];
      while(admitted.length<count){
        const i=admitted.length+1,owner='friend'+i,started=performance.now();
        const invite=await request('/v1/admin','admin',{action:'invite',uses:1});assert.equal(invite.status,200);const {code}=await invite.json();assert.equal((await request('/v1/invite',owner,{code})).status,200);
        const created=await request('/v1/souls',owner,{name:'Friend '+i,description:'Synthetic invited ordinary one-Soul cohort fixture'},{'X-Sim-Lifecycle':'1'});assert.equal(created.status,202);const received=(await created.json()).lifecycle;
        for(let j=0;j<4;j++){host.drainInputs();await setImmediate();}const receipt=await request('/v1/lifecycle/'+received.requestId,owner);assert.equal(receipt.status,200);const actual=(await receipt.json()).lifecycle;
        assert.equal(actual.state,'admitted','current native admission '+i);assert.equal(actual.ready,true);const row=db.soul(received.soulId);assert.ok(row);assert.equal(row.owner,'dev:'+owner);assert.equal(souls.controlReady(row),true);assert.equal(db.user(row.owner).role,'user');assert.equal(db.soulsOf(row.owner).length,1);
        const m=host.minds.get(row.id);assert.equal(m.entityId,row.entity_id);assert.equal(host.engine.world.entities[row.entity_id].human.soul,row.id);
        const rt=(host.engine as any).rt;assert.deepEqual(humanStaticClearance(rt),[]);assert.deepEqual(humanHumanSeparation(rt),[]);
        admissionMs.push(performance.now()-started);admitted.push({owner,soulId:row.id,entityId:row.entity_id,requestId:received.requestId,placement:[...host.engine.world.entities[row.entity_id].pose.p]});
      }
      assert.equal(host.minds.size,count);const phaseStart=host.engine.world.tick;for(const a of admitted)motion.set(a.entityId,{ownedMetres:0,otherMetres:0,witnesses:[]});const starts=new Map(admitted.map(a=>[a.entityId,[...host.engine.world.entities[a.entityId].pose.p]]));
      for(const a of admitted){const directed=await drive<Response>(request('/v1/souls/'+a.soulId+'/intent',a.owner,{intent:{goal:'wander',text:'Explore this commons.'}}));assert.equal(directed.status,200);}
      const samples:number[]=[],began=performance.now(),heap=process.memoryUsage().heapUsed;
      for(let i=0;i<1200;i++){const started=performance.now();host.tickOnce();samples.push(performance.now()-started);if(i%20===0)await setImmediate();}
      host.drainInputs();await setImmediate();const movements=admitted.map(a=>{const p=host.engine.world.entities[a.entityId].pose.p,q=starts.get(a.entityId)!,measured=motion.get(a.entityId)!,ownStarts=programEvents.filter(e=>e.actor===a.entityId&&e.kind==='step'&&e.step===0);
        return {soulId:a.soulId,entityId:a.entityId,metres:Math.hypot(p[0]-q[0],p[2]-q[2]),root:[...p],ready:souls.controlReady(db.soul(a.soulId)),...measured,ownStarts,
          phaseStarts:ownStarts.filter(e=>e.tick>phaseStart),startScope:ownStarts.some(e=>e.tick>phaseStart)?'started this phase':'continued a previously started own program; not a new-request fulfilment claim'};});
      const observation=host.engine.gatheringObservation();
      phases.push({phaseStart,renewal:structuredClone(host.living),subsets:[5,10].map(size=>({size,population:count,scope:'first admitted subjects within this SAME cohort',ownedStarts:movements.slice(0,size).filter(m=>m.ownStarts.length).length,ownMotion:movements.slice(0,size).filter(m=>m.ownedMetres>.05).length})),owners:count,bodies:host.minds.size,ticks:1200,simSeconds:60,wallMs:performance.now()-began,tickP50Ms:percentile(samples,.5),tickP95Ms:percentile(samples,.95),tickMaxMs:Math.max(...samples),admissionP95Ms:percentile(admissionMs,.95),heapDeltaBytes:process.memoryUsage().heapUsed-heap,heapUsedBytes:process.memoryUsage().heapUsed,movements,observation,nativeViolations:structuredClone(host.engine.runtime.violations),lifecycleFaults:souls.lifecycle.faults.size});
      assert.equal(movements.filter(m=>m.ownStarts.length&&m.ownedMetres>.05).length,count,'every ordinary owned body has its own native program start and owned locomotion in this phase');assert.ok(movements.every(m=>m.ready));assert.deepEqual(host.engine.runtime.violations,[]);assert.equal(souls.lifecycle.faults.size,0);
      for(const c of host.engine.takeChunks(-1)){const take=c.take;if(!pairs.some(p=>p.take.id===take.id))pairs.push({take:structuredClone(take),capture:host.engine.takeScene(take.renderSceneRef.hash)});}
    }
    host.saveSnapshot(true);const head={engine:host.engine.stateHash(),kernel:kernelHash(host.kernel),tick:host.engine.world.tick},lives=[...host.minds.values()].map(m=>m.life);
    const reopened=new Db(path);try{const boot=new WorldHost(reopened,factory,seed,1e9,worldId,{durableClockV1:true});assert.equal(boot.boot().from,'snapshot');assert.deepEqual({engine:boot.engine.stateHash(),kernel:kernelHash(boot.kernel),tick:boot.engine.world.tick},head);assert.deepEqual([...boot.minds.values()].map(m=>m.life),lives);boot.stop();reopened.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(worldId);const genesis=new WorldHost(reopened,factory,seed,1e9,worldId,{durableClockV1:true});assert.equal(genesis.boot().from,'genesis');assert.deepEqual({engine:genesis.engine.stateHash(),kernel:kernelHash(genesis.kernel),tick:genesis.engine.world.tick},head);genesis.stop();}finally{reopened.close();}
    assert.equal(db.paidCost(),0);
  }catch(error){failure=error;}
  finally{
    const report={contract:'current-c194-cohort-capacity/2',initialized,counts,input,pins,config:{scene:EDEN_SAFE_COMMONS_WORLD,safeCrewRemoval:true,brainMode:'fake',actualPaidUSD:db.paidCost(),perAccountMax:cfg.maxSoulsPerUser},worldId,seed,rulesVersion:host.engine.rulesVersion,physicalBase:host.engine.world.base,admitted,phases,programEvents,pairs,status:failure?'FAIL':'PASS',failure:failure?String(failure):null,headTick:host.engine.world.tick,
      limits:[counts.join(' then')+' progressive invitations, 60simsec each; not a simultaneous burst/day-long capacity ceiling','Actual in-process Hono/native/lifecycle/SQLite/fake minds; no realAuth/browser/TCP/provider/archive/device or coordinated release qualification','Unforced heap observation, no leak plateau/sustainable AI cost promise','Own accumulated locomotion is attributed to actual programAction+native walk_to actor; other root motion reported separately, not count-qualified','Continued own programs are explicitly separate from a second instruction’s start/fulfilment','No personal food/sleep/water resource or quadratic card-deck expansion implied','Original immutableC194/history/genesis untouched; no pose/graph injection']};
    const out=new URL('../../../../.e2e/c194-cohort-initialized/',import.meta.url);mkdirSync(out,{recursive:true});const file=new URL(new Date().toISOString().replaceAll(':','-')+'.json',out);writeFileSync(file,JSON.stringify(report,null,2)+'\n',{flag:'wx'});t.diagnostic('Actual synthetic private capacity report '+file.pathname);host.stop();db.close();rmSync(dir,{recursive:true,force:true});
  }
  if(failure)throw failure;
});
