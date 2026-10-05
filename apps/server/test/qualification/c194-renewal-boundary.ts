// Two-owner cause diagnostic, not a rerun of either capped cohort workload.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {setImmediate} from 'node:timers/promises';
const input=resolve(new URL('../../../../.e2e/exports/core-native-c190-live-me-45b9c986/sim',import.meta.url).pathname),load=(p:string)=>import(pathToFileURL(join(input,p)).href);
const manifest=JSON.parse(readFileSync(join(input,'../CONTENT-MANIFEST.json'),'utf8'));
const paths=['db','world','auth','brain','souls','http','living'].map(p=>'apps/server/src/'+p+'.ts');
const pins=paths.map(path=>{const sha256=createHash('sha256').update(readFileSync(join(input,path))).digest('hex');assert.equal(sha256,manifest[path].sha256);return {path,sha256};});
const {Db}=await load('apps/server/src/db.ts'),{WorldHost}=await load('apps/server/src/world.ts'),{Brain}=await load('apps/server/src/brain.ts'),{Auth}=await load('apps/server/src/auth.ts'),{Souls}=await load('apps/server/src/souls.ts'),{LivingWorld}=await load('apps/server/src/living.ts'),{buildApp}=await load('apps/server/src/http.ts'),{config}=await load('apps/server/src/config.ts');
const {marsFactory,EDEN_SAFE_COMMONS_WORLD}=await load('packages/engine-mars/src/index.ts');
const factory=await marsFactory({...EDEN_SAFE_COMMONS_WORLD,safeCrewRemoval:true});
test('actual initial renewal holds a later owned NOW direction until its original program drains through supported retirement',async t=>{
  const db=new Db(':memory:'),host=new WorldHost(db,factory,'c194-renewal-cause',1e9,'c194-renewal-local',{durableClockV1:true});host.boot();host.drainInputs();t.after(()=>{host.stop();db.close();});
  const cfg={...config,worldId:host.worldId,worldKey:'eden',worldPath:'/w/eden',publicUrl:'http://127.0.0.1:4959/w/eden',brainMode:'fake',budgetUsdPerDay:0,typesafeKey:undefined,anthropicKey:undefined,privyAppId:'',privyAppSecret:'',inviteRequired:true};
  const auth=new Auth(cfg,db);auth.devAuth=true;
  // Same listener order as the original cohort fixture: Brain before LivingWorld.
  const brain=new Brain(host,db,cfg,{clients:()=>0,onCall(){},onCamera(){},onTalk(){},onNarrative(){},onTicker(){}}),souls=new Souls(host,db,brain,cfg);souls.enableLifecycle();
  const living=new LivingWorld(host),app=buildApp({cfg,db,host,auth,brain,souls,hub:{clients:new Map(),refreshMe(){}}});
  const request=(path:string,owner:string,body?:unknown,method=body?'POST':'GET')=>app.request(path,{method,headers:{authorization:'Bearer dev:'+owner,'X-Sim-Lifecycle':'1',...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  async function drive<T>(p:Promise<T>):Promise<T>{let done=false;p.then(()=>done=true,()=>done=true);for(let i=0;i<100&&!done;i++){host.drainInputs();await setImmediate();}assert.ok(done);return p;}
  async function ticks(n:number){for(let i=0;i<n;i++){host.tickOnce();if(i%10===0)await setImmediate();}host.drainInputs();await setImmediate();}
  async function create(owner:string){let r=await request('/v1/admin','admin',{action:'invite',uses:1});assert.equal(r.status,200);const {code}=await r.json();assert.equal((await request('/v1/invite',owner,{code})).status,200);r=await request('/v1/souls',owner,{name:owner,description:'Synthetic ordinary invited owner renewal diagnostic'});assert.equal(r.status,202);const {lifecycle}=await r.json();for(let i=0;i<4;i++){host.drainInputs();await setImmediate();}const row=db.soul(lifecycle.soulId);assert.ok(row&&souls.controlReady(row));return row;}
  const events:any[]=[],step=host.engine.step.bind(host.engine);t.mock.method(host.engine,'step',()=>{const out=step();events.push(...out.programs);return out;});
  let failure:unknown,trace:any;
  try{
    await drive(living.install(['People may rest or explore.']));const first=await create('alice');
    assert.equal((await drive<Response>(request('/v1/souls/'+first.id+'/intent','alice',{intent:{goal:'rest',note:'Rest briefly in this diagnostic.'}}))).status,200);
    await ticks(20);assert.equal(host.quietBarrier,true);assert.ok(host.engine.programOf(first.entity_id));
    const second=await create('bob'),start=[...host.engine.world.entities[second.entity_id].pose.p];
    assert.equal((await drive<Response>(request('/v1/souls/'+second.id+'/intent','bob',{intent:{agenda:[{card:'go to',target:'commons-bench-east'}],note:'Go near the east bench.'}}))).status,200);
    await ticks(120);assert.equal(host.quietBarrier,true);assert.equal(host.engine.programOf(second.entity_id),null);assert.deepEqual(host.engine.world.entities[second.entity_id].pose.p,start);
    const blocked={tick:host.engine.world.tick,living:structuredClone(host.living),firstProgram:host.engine.programOf(first.entity_id),secondProgram:host.engine.programOf(second.entity_id),secondMind:structuredClone(host.minds.get(second.id)),root:[...start]};
    // The actual owner retires the initial test Soul through its qualified API.
    // No raw engine cancellation, pose forcing or clock/rate adjustment.
    const retired=await request('/v1/souls/'+first.id,'alice',undefined,'DELETE');assert.ok([200,202].includes(retired.status));
    await ticks(240);assert.equal(host.quietBarrier,false);assert.ok(events.some(e=>e.actor===second.entity_id&&e.kind==='step'));
    const root=host.engine.world.entities[second.entity_id].pose.p,distance=Math.hypot(root[0]-start[0],root[2]-start[2]);assert.ok(distance>.05);assert.deepEqual(host.engine.runtime.violations,[]);assert.equal(souls.lifecycle.faults.size,0);assert.equal(db.paidCost(),0);
    trace={first:{soulId:first.id,entityId:first.entity_id},second:{soulId:second.id,entityId:second.entity_id},blocked,after:{tick:host.engine.world.tick,living:host.living,root:[...root],distance,ready:souls.controlReady(db.soul(second.id))},events,rules:db.events(host.worldId).filter((e:any)=>e.kind==='rules').map((e:any)=>({seq:e.seq,tick:e.tick,payload:e.payload}))};
  }catch(e){failure=e;}
  finally {const out=new URL('../../../../.e2e/renewal-boundary/',import.meta.url);mkdirSync(out,{recursive:true});const file=new URL(new Date().toISOString().replaceAll(':','-')+'.json',out);writeFileSync(file,JSON.stringify({status:failure?'FAIL':'PASS',failure:failure?String(failure):null,input,pins,trace,paidUSD:db.paidCost(),limits:['Two-owned-Soul controlled initial-renewal cause,380ticks/19simsec; no original10/30cohort or capped browser rerun','Supported owner REST retirement in disposable native fixture; no raw pose/program or production mutation','Later native movement after actual renewal release; no sustainablecapacity/autonomous AI/realAuth claim']},null,2)+'\n',{flag:'wx'});t.diagnostic('Renewal cause proof '+file.pathname);}
  if(failure)throw failure;
});
