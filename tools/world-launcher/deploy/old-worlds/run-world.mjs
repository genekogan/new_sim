// eden2 boot-only runner for the old worlds (eden, mars, littlemartians).
// Same server entry points and option mapping as Codex's laptop runner
// (runtime-modern-context-prep-001/successor-world-run.mjs); the laptop-only gates
// (laptop PIDs, paths, git checkout, closure receipts) are replaced by: exact descriptor,
// Clerk + account-registry env, accepted history never shrinks, Soul rows unchanged by boot.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
const check=(v,m)=>{if(!v)throw Error(m);};
const hash=s=>createHash('sha256').update(s).digest('hex');
const path=process.argv[2];check(path,'usage: run-world.mjs <descriptor.json>');
const d=JSON.parse(readFileSync(path,'utf8'));const key=d.worldKey??'eden';
check(process.env.AUTH_PROVIDER==='clerk'&&process.env.ACCOUNT_REGISTRY_PATH===d.accountRegistryPath,'Provider/account registry differs');
const {accountRegistryPath,...desc}=d;
const souls=db=>db.prepare('SELECT id,entity_id,retired_at FROM souls WHERE world_id=? ORDER BY id').all(d.worldId);
const cold=new DatabaseSync(join(d.dataDir,'sim.db'),{readOnly:true});
const before={events:cold.prepare('SELECT count(*) n, max(seq) m FROM events WHERE world_id=?').get(d.worldId),soulsSHA256:hash(JSON.stringify(souls(cold)))};cold.close();
console.log(JSON.stringify({phase:'pre-boot',world:key,worldId:d.worldId,...before}));
let app,ready=false;
const close=()=>app.close();
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{if(!app)process.exit(1);void close().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});});
if(key==='eden'){
 const {openEdgeServerV1}=await import(pathToFileURL(join(desc.input,'tools/core/edge-server.mjs')));const f=desc.flags??{};
 app=await openEdgeServerV1({...desc,accountAuth:true,seedObjects:desc.objects,localBudget:0,autonomous:false,quiesceThought:true,officeStairGuards:f.officeStairGuards??false,ambient:desc.ambient!==false,humanRest:f.humanRest??true,provisions:f.provisions??true,sequences:f.sequences??true,floorGoals:f.floorGoals??true,kitchen:f.kitchen??true,shore:f.shore??true,foodDeliveryId:f.foodDeliveryId,quietLandingCourtesy:f.quietLandingCourtesy??true,social:f.social??true,approachRetention:f.approachRetention??true,closedGoals:f.closedGoals??true,activateExpansion:f.activateExpansion??true});
}else{
 check(desc.worldKey===key&&desc.accountAuth===true&&desc.authMode==='configured'&&desc.seedCast===false&&desc.nativeCast===false&&desc.runtimePolicies===false&&desc.nativeLifecycleV1===true,'Native create/cast/policy settings differ');
 const {openWorldServer}=await import(pathToFileURL(join(desc.input,'tools/core/multiworld/world-server.mjs')));app=await openWorldServer(desc);
 check(app.lifecycleFact?.alreadyAccepted===true&&app.souls.lifecycle,'Existing native lifecycle not preserved');
}
try{
 check(app.cfg.authProvider==='clerk'&&app.auth.ready&&!app.auth.devAuth&&app.host.worldId===d.worldId,'Configured authority/readiness differs');
 const events=app.db.events(d.worldId);check(events.length>=before.events.n,'Accepted history shrank during boot');
 check(hash(JSON.stringify(souls(app.db.db)))===before.soulsSHA256,'Current or retired Souls changed during boot');
 ready=true;console.log(JSON.stringify({phase:'ready',world:key,worldId:d.worldId,port:d.port,build:d.build,pid:process.pid,events:events.length,maxSeq:events.at(-1)?.seq,activeSouls:app.db.liveSouls(d.worldId).length,readyAtUTC:new Date().toISOString()}));
}catch(error){await close();throw error;}
