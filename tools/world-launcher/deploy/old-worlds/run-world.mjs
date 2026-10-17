// eden2 / relaunch runner for the old worlds (eden, mars, littlemartians). Lane CLOUD2 2026-10-11, refreshed by lane
// KIT 2026-10-15 for source 1080cfa9.
// Same server entry points and option mapping as the live laptop runner
// (team/reviews/convergence-world-run.mjs, PIDs 14604/14605/14606). Its laptop-only gates (prior writer PIDs, GO
// receipts with a 5-minute expiry, write-once READY files, laptop paths) are replaced by: exact descriptor, Clerk +
// account-registry env, no dev auth, accepted history never shrinks and its raw-payload prefix hash is unchanged by
// boot, Soul rows unchanged by boot, sole 127.0.0.1 listener on the (port-mapped) descriptor port.
// usage: node [--import=port-map.mjs] --experimental-transform-types --env-file=<clerk env> run-world.mjs <descriptor.json>
//        ... run-world.mjs <descriptor.json> --check <dataDir>   (lane L2: boot the world's code on a COPY in <dataDir> without
//        listening or locking, the servers' own checkOnly mode; prints {"phase":"check","compatible":true} or exits 1. rollback.sh
//        uses it before it replaces a laptop DB with eden2's history.)
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
const check=(v,m)=>{if(!v)throw Error(m);};
const hash=s=>createHash('sha256').update(s).digest('hex');
const path=process.argv[2];check(path,'usage: run-world.mjs <descriptor.json>');
const d=JSON.parse(readFileSync(path,'utf8'));const key=d.worldKey??'eden';
const ci=process.argv.indexOf('--check'),checkDir=ci>0?process.argv[ci+1]:null;if(ci>0){check(checkDir&&checkDir!==d.dataDir,'--check needs a copy directory other than the live dataDir');d.dataDir=checkDir;}
check(process.env.AUTH_PROVIDER==='clerk'&&process.env.ACCOUNT_REGISTRY_PATH===d.accountRegistryPath,'Provider/account registry differs');
check(process.env.DEV_AUTH!=='1','production dev authentication forbidden');
const portMap=new Map((process.env.SIM_PORT_MAP??'').split(',').filter(Boolean).map(p=>p.split(':').map(Number)));
const expectedPort=portMap.get(d.port)??d.port;
const {accountRegistryPath,...desc}=d;if(checkDir)desc.checkOnly=true;
// Same fact shapes as convergence-world-run.mjs databaseFacts(): raw-payload/1 event prefix + Soul rows.
const facts=(db,count)=>{const ev=db.prepare('SELECT seq,tick,kind,author,payload,at FROM events WHERE world_id=? ORDER BY seq').all(d.worldId);
 const rows=db.prepare('SELECT id,entity_id,retired_at FROM souls WHERE world_id=? ORDER BY id').all(d.worldId);
 return{count:ev.length,maxSeq:ev.at(-1)?.seq??null,prefixSHA256:hash(JSON.stringify(ev.slice(0,count??ev.length))),soulsSHA256:hash(JSON.stringify(rows)),activeSouls:rows.filter(r=>r.retired_at==null).length};};
const cold=new DatabaseSync(join(d.dataDir,'sim.db'),{readOnly:true});const before=facts(cold);cold.close();
console.log(JSON.stringify({phase:'pre-boot',world:key,worldId:d.worldId,events:before.count,maxSeq:before.maxSeq,prefixSHA256:before.prefixSHA256,soulsSHA256:before.soulsSHA256,activeSouls:before.activeSouls}));
let app;
const close=()=>app.close();
// A relaunched laptop writer must survive its launching Terminal closing (Node resets inherited SIG_IGN at startup).
process.on('SIGHUP',()=>console.log(JSON.stringify({phase:'sighup-ignored',world:key,atUTC:new Date().toISOString()})));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{if(!app)process.exit(1);void close().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});});
if(key==='eden'){
 check(desc.flags?.accountAuth===true,'Eden account authorization disabled');
 const {openEdgeServerV1}=await import(pathToFileURL(join(desc.input,'tools/core/edge-server.mjs')));const f=desc.flags??{};
 app=await openEdgeServerV1({...desc,accountAuth:true,seedObjects:desc.objects,localBudget:0,autonomous:false,quiesceThought:true,officeStairGuards:f.officeStairGuards??false,ambient:desc.ambient!==false,humanRest:f.humanRest??true,provisions:f.provisions??true,sequences:f.sequences??true,floorGoals:f.floorGoals??true,kitchen:f.kitchen??true,shore:f.shore??true,foodDeliveryId:f.foodDeliveryId,quietLandingCourtesy:f.quietLandingCourtesy??true,social:f.social??true,approachRetention:f.approachRetention??true,closedGoals:f.closedGoals??true,activateExpansion:f.activateExpansion??true});
}else{
 check(desc.worldKey===key&&desc.accountAuth===true&&desc.authMode==='configured'&&desc.seedCast===false&&desc.nativeCast===false&&desc.runtimePolicies===false&&desc.nativeLifecycleV1===true,'Native create/cast/policy settings differ');
 const {openWorldServer}=await import(pathToFileURL(join(desc.input,'tools/core/multiworld/world-server.mjs')));app=await openWorldServer(desc);
 if(!checkDir)check(app.lifecycleFact?.alreadyAccepted===true&&app.souls.lifecycle,'Existing native lifecycle not preserved');
}
if(checkDir){check(app?.checkOnly===true&&app.compatible!==false,'check: the world code did not report compatible');console.log(JSON.stringify({phase:'check',world:key,worldId:d.worldId,compatible:true,dataDir:checkDir}));process.exit(0);}
try{
 check(app.cfg.authProvider==='clerk'&&app.auth.ready&&!app.auth.devAuth&&app.cfg.accountAuthRequired&&app.host.worldId===d.worldId,'Configured authority/readiness differs');
 const bound=app.server.address();check(bound&&bound.port===expectedPort&&bound.address==='127.0.0.1','Listener identity differs');
 const now=facts(app.db.db,before.count);
 check(now.count>=before.count&&now.prefixSHA256===before.prefixSHA256,'Accepted history shrank or changed during boot');
 check(now.soulsSHA256===before.soulsSHA256&&now.activeSouls===before.activeSouls,'Current or retired Souls changed during boot');
 console.log(JSON.stringify({phase:'ready',world:key,worldId:d.worldId,port:bound.port,descriptorPort:d.port,build:d.build,pid:process.pid,events:now.count,maxSeq:now.maxSeq,activeSouls:now.activeSouls,prefixSHA256:before.prefixSHA256,readyAtUTC:new Date().toISOString()}));
}catch(error){await close();throw error;}
