// Edge server entry (EDGE-CONTRACT-v1). Owners' agents drive Souls; the world runs no Soul mind.
// Usage: node tools/core/edge-server.mjs <descriptor.json> [check]
// Descriptor: {input, dataDir, worldId, port, build, webDir?, marsWebDir?, placeData?, inputManifestSHA256?, localSoulLimit?, flags?{...}}
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readFileSync,mkdirSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {setImmediate} from 'node:timers/promises';

export async function openEdgeServerV1({input,dataDir,worldId,port=4959,webDir,marsWebDir,build='local-edge/1',checkOnly=false,placeData,seedObjects,inviteRequired=false,skillFile,
  inputManifestSHA256,modelCredentialFile=undefined,localBudget=0,autonomous=false,localSoulLimit=5,humanRest=false,provisions=false,sequences=false,floorGoals=false,kitchen=false,shore=false,foodDeliveryId,quietLandingCourtesy=false,social=false,closedGoals=false,approachRetention=false,activateExpansion=false,humanDirectionBurstUsd=1,quiesceThought=false}) {
  if(!input||!dataDir||!worldId||!Number.isInteger(port)||!(port>=4950&&port<=4959||port===4970))throw Error('explicit local input/data/world/allowed port required');
  if(!build.startsWith('local-'))throw Error('local build identity required');
  input=resolve(input);dataDir=resolve(dataDir);
  const manifest=inputManifestSHA256?JSON.parse(readFileSync(join(input,'../CONTENT-MANIFEST.json'),'utf8')):null;
  if(inputManifestSHA256&&(!/^[a-f0-9]{64}$/.test(inputManifestSHA256)||createHash('sha256').update(readFileSync(join(input,'../CONTENT-MANIFEST.json'))).digest('hex')!==inputManifestSHA256))throw Error('not the explicitly selected runtime content manifest');
  const sources=['db','world','auth','brain','souls','http','hub','intent-control','mcp','living','config','world-request-path'];
  const pins=sources.map(name=>{
    const path=`apps/server/src/${name}.ts`,sha256=createHash('sha256').update(readFileSync(join(input,path))).digest('hex');
    if(manifest&&sha256!==manifest[path]?.sha256)throw Error('sealed runtime differs: '+path);
    return {path,sha256};
  });
  const load=p=>import(pathToFileURL(join(input,p)).href),require=createRequire(join(input,'apps/server/package.json'));
  // config.ts creates DATA_DIR when imported. Scope that side effect to this
  // explicit local folder; no .env reader or provider/auth credentials.
  mkdirSync(dataDir,{recursive:true});const prior=process.env.DATA_DIR;process.env.DATA_DIR=dataDir;
  let defaults;try{defaults=(await load('apps/server/src/config.ts')).config;}finally{if(prior===undefined)delete process.env.DATA_DIR;else process.env.DATA_DIR=prior;}
  const cfg={...defaults,worldKey:'eden',worldId,worldPath:'/w/eden',worldSeed:'sim-genesis-1',
    host:'127.0.0.1',port,dataDir,webDir:resolve(webDir??join(input,'apps/web/dist')),marsWebDir:resolve(marsWebDir??join(input,'mars/viewer/dist/client')),
    publicUrl:`http://127.0.0.1:${port}/w/eden`,engine:'mars',livingWorld:true,seedNatives:false,
    ownerId:'dev:admin',brainMode:'fake',budgetUsdPerDay:0,typesafeKey:undefined,anthropicKey:undefined,
    privyAppId:'',privyAppSecret:'',archiveTakes:false,inviteRequired,maxSoulsPerUser:5,build,mindDriver:'edge',skillFile:skillFile?resolve(skillFile):defaults.skillFile};  // Gene 2026-10-07: pairing open
  if(!Number.isInteger(localSoulLimit)||localSoulLimit<1||localSoulLimit>50)throw Error('local Soul allowance must be 1..50');
  cfg.maxSoulsPerUser=localSoulLimit;cfg.thinkingBudgetCeiling=3;cfg.authorizedThinkingWorldId=worldId;cfg.budgetUsdPerDay=localBudget;
  if(modelCredentialFile)throw Error('edge server runs no Soul mind and takes no model credentials');
  const {Db}=await load('apps/server/src/db.ts'),{WorldHost}=await load('apps/server/src/world.ts');
  const native=await load('packages/engine-mars/src/index.ts'),db=new Db(join(dataDir,'sim.db'));
  let host,server,hub,service,provisionBirths,kitchenInstallation,shoreInstallation,foodDelivery,socialInstallation,closing=false;
  async function drive(p){let done=false;p.then(()=>done=true,()=>done=true);for(let i=0;i<100&&!done;i++){host.drainInputs();await setImmediate();}if(!done)throw Error('bootstrap sequencer did not settle');return p;}
  try {
    const header=db.world(worldId),beforeRows=db.liveSouls(worldId),beforeEvents=db.events(worldId);
    // A physical transition reader is not a crew-policy migration. Old preview
    // history lacks crew-removal/1 and cannot enable the lifecycle service.
    // Refuse before boot/checkpoint writes; never relabel its old rules header.
    if(header&&!header.rules_version.includes('+crew-removal/1'))throw Error('local-bootstrap.lifecycle-policy-upgrade-unavailable: old history lacks crew-removal/1; preserve this DB and use a distinct fresh local world until a versioned policy migration exists');
    const migrated=beforeEvents.some(e=>e.kind==='rules'&&e.payload.commonsTransition);
    if(shore&&!kitchen)throw Error('local shore requires retained kitchen resources');
    if(kitchen&&!provisions)throw Error('local kitchen requires retained personal provisions');
    const finiteFoodReader=!!foodDeliveryId||header?.rules_version.includes('+fd/1');
    const socialReader=social||!!header?.rules_version.includes('+social-eden/1');
    const {edenHistoryFactory}=await load('apps/server/src/eden-bootstrap.ts');
    const factory=await edenHistoryFactory(db,worldId,{lifeV1:true,newcomerResourcesV1:true,sleepSnapshotV1:true,groundV1:true,lectureV1:true});
    host=new WorldHost(db,factory,header?.seed??cfg.worldSeed,cfg.snapshotEveryTicks,worldId,{durableClockV1:true});
    const boot=host.boot();
    if(approachRetention){if(!host.enableIntentApproachRetentionV1)throw Error('selected runtime needs native approach retention');await drive(host.enableIntentApproachRetentionV1());}
    if(quietLandingCourtesy){if(!host.enableQuietLandingCourtesyV1)throw Error('selected runtime needs prospective quiet landing courtesy');await drive(host.enableQuietLandingCourtesyV1());}
    if(floorGoals){if(!host.enableGroundFixtureGoalsV1)throw Error('selected runtime needs ground fixture goal levels');await drive(host.enableGroundFixtureGoalsV1());}
    if(sequences){if(!host.enableIntentSequencesV1)throw Error('selected runtime needs purpose-bound sequences');await drive(host.enableIntentSequencesV1());}
    if(humanRest){if(!host.enableHumanRestNeedsV1)throw Error('selected runtime needs versioned human rest recovery');await drive(host.enableHumanRestNeedsV1());}
    if(provisions&&!host.engine.rulesVersion.includes('+commons-provisions/1')&&!host.engine.rulesVersion.includes('+cp/2')){if(!host.installCommonsProvisionsV1)throw Error('selected runtime needs retained commons provisions');await drive(host.installCommonsProvisionsV1());}
    if(header&&host.engine.world.base.campus!=='eden-commons'&&!(shore&&['eden-commons-shore/1','eden-commons-shore-expanded/1'].includes(host.engine.world.base.campus))) {
      // Read-only preflight first. Refusal never substitutes a new world or pose.
      const preview=host.engine.previewCommonsTransition?.();
      if(!preview?.ok)throw Error(preview?`${preview.diagnostic.code}: ${preview.diagnostic.message}`:'commons-transition.reader-unavailable');
      if(checkOnly){host.stop();db.close();return {checkOnly:true,compatible:true,boot,preview:preview.transition,owners:beforeRows.map(r=>({soulId:r.id,owner:r.owner,entityId:r.entity_id})),eventCount:beforeEvents.length,pins};}
      await drive(host.adoptCommons('operator:local-bootstrap'));
      for(const row of beforeRows){const current=db.soul(row.id);if(current.owner!==row.owner||current.entity_id!==row.entity_id)throw Error('old Soul mapping differs');}
      const prefix=db.events(worldId).slice(0,beforeEvents.length);
      if(JSON.stringify(prefix)!==JSON.stringify(beforeEvents))throw Error('old event prefix differs');
    } else if(checkOnly){host.stop();db.close();return {checkOnly:true,compatible:true,boot,owners:beforeRows.length,pins};}
    if(activateExpansion){if(!host.engine.rulesVersion.includes('+cp/2')){const p=JSON.parse(readFileSync(join(input,'packages/engine-mars/src/fixtures/newcomer-layout.world-alternative.v2.json'),'utf8'));await drive(host.installCommonsNewcomerResourcesV1(p.placements));}if(!host.engine.rulesVersion.endsWith('+ss/1'))await drive(host.installNativeSleepSnapshotV1());const {installEdenSteeringModeV1}=await load('apps/server/src/eden-steering-mode.ts');await drive(installEdenSteeringModeV1(host,{closedGoalsV1:true,registeredActivitiesV1:true}));if(!host.engine.rulesVersion.includes('+eg/1'))await drive(host.installEdenGroundV1());if(!host.engine.rulesVersion.includes('+l/1'))await drive(host.installEdenLectureV1({worldEast:'world-v2',id:'eden-classroom-1',origin:[42,-6],yaw:0,audienceSeats:20,lesson:'Eden: observe, ask, give a direction, watch what changes.'}));}
    const {LivingWorld}=await load('apps/server/src/living.ts');await drive(new LivingWorld(host).install(['People may explore the commons, rest, and meet one another.']));
    const {Auth}=await load('apps/server/src/auth.ts'),{Brain}=await load('apps/server/src/brain.ts'),{Souls}=await load('apps/server/src/souls.ts');
    const {Hub}=await load('apps/server/src/hub.ts'),{IntentControlV2}=await load('apps/server/src/intent-control.ts'),{buildApp}=await load('apps/server/src/http.ts');
    const {stripWorldRequestPath}=await load('apps/server/src/world-request-path.ts'),{handleMcp}=await load('apps/server/src/mcp.ts');
    const auth=new Auth(cfg,db);auth.devAuth=true;
    const brain=new Brain(host,db,cfg,{clients:()=>hub?.clients.size??0,onCall:c=>hub?.brainCall(c),onCamera:line=>hub?.broadcast({t:'camera',line}),onTicker:lines=>hub?.broadcast({t:'ticker',lines}),onNarrative:view=>hub?.broadcast({t:'narrative',view}),onTalk:lines=>hub?.broadcast({t:'talk',lines})},{intentV2Choices:true,intentV2Retries:false});
    brain.quiesce();
    const souls=new Souls(host,db,brain,cfg);souls.enableLifecycle();
    if(provisions){const {followCommonsProvisionBirths}=await load('apps/server/src/commons-provisions.ts');if(!followCommonsProvisionBirths)throw Error('selected runtime needs prospective provision births');provisionBirths=await followCommonsProvisionBirths(host,brain);}
    if(foodDeliveryId){if(!provisions||!kitchen)throw Error('finite food delivery requires retained personal/kitchen resources');const {scheduleFiniteFoodDeliveryV1}=await load('apps/server/src/food-delivery.ts');foodDelivery=scheduleFiniteFoodDeliveryV1(host,brain,foodDeliveryId);}
    if(kitchen){const {scheduleCommonsKitchenInstallation}=await load('apps/server/src/commons-kitchen-install.ts');kitchenInstallation=scheduleCommonsKitchenInstallation(host,brain);}
    if(social){if(!kitchen)throw Error('social Eden requires retained kitchen resources');const {scheduleSocialEdenInstallationV1}=await load('apps/server/src/social-eden-install.ts');socialInstallation=scheduleSocialEdenInstallationV1(host,brain);}
    if(shore){const {scheduleRetainedCommonsShoreInstallation}=await load('apps/server/src/retained-shore-install.ts');shoreInstallation=scheduleRetainedCommonsShoreInstallation(host);}
    service=new IntentControlV2(host,brain,souls,{historyV1:true,closedGoalsV1:closedGoals,registeredActivitiesV1:closedGoals});server=createServer();
    const strip=url=>stripWorldRequestPath(url,cfg.worldPath);
    server.on('upgrade',req=>{req.url=strip(req.url);});hub=new Hub(server,host,auth,db,souls);hub.brain=brain;hub.build=cfg.build;
    if(host.enableQuietStallReleaseV1)await drive(host.enableQuietStallReleaseV1());
    if(host.enableYieldTimeoutV1)await drive(host.enableYieldTimeoutV1());
    const {EdgeLedger}=await load('apps/server/src/edge/ledger/ledger.ts');
    const edge=new EdgeLedger(host,db,placeData?JSON.parse(readFileSync(resolve(placeData),'utf8')):undefined);
    const app=buildApp({cfg,db,host,auth,brain,souls,hub,intentV2:service,edge}),listener=require('@hono/node-server').getRequestListener(app.fetch);
    // Seed declared objects (idempotent by id). presentation params may give startsInMinutes.
    for(const o of seedObjects??[]){const params={...(o.params??{})};if(typeof params.startsInMinutes==='number'){params.startsAtTick=host.engine.world.tick+Math.round(params.startsInMinutes*60*20);delete params.startsInMinutes;}edge.comms?.objects.create({...o,params});}
    server.on('request',(req,res)=>{
      if(closing){res.writeHead(503,{'Cache-Control':'no-store'}).end('Local server is draining.');return;}
      req.url=strip(req.url);
      if(req.url?.startsWith('/mcp')){void handleMcp(req,res,souls,service,(method,path,token,body)=>Promise.resolve(app.request(path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})})).then(r=>r.json())).catch(()=>{if(!res.headersSent)res.writeHead(503).end();});return;}
      void listener(req,res);
    });
    await new Promise((r,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',r);});host.start();
    async function close(){if(closing)return;closing=true;brain.quiesce?.();edge.comms?.close();for(const c of hub.clients)c.ws.close(1001,'local server stopping');
      const closed=new Promise(r=>server.close(r)),pump=setInterval(()=>host.drainInputs(),10);
      const failures=[];
      try{await closed;for(const handle of [provisionBirths,socialInstallation,foodDelivery,shoreInstallation,kitchenInstallation])handle?.close();const outcomes=await Promise.allSettled([service.settled(),brain.settled?.(),...[provisionBirths,socialInstallation,foodDelivery,shoreInstallation,kitchenInstallation].map(h=>h?.settled())]);for(const r of outcomes)if(r.status==='rejected')failures.push(r.reason);host.drainInputs();}finally{clearInterval(pump);}
      let snapshotSaved=false;
      try{host.stop();snapshotSaved=host.engine.canSnapshot?.()===true;if(snapshotSaved)host.saveSnapshot(true);else if(!db.db.prepare('SELECT 1 FROM clock_frontiers_v1 WHERE world_id=?').get(worldId))failures.push(Error('active-work-without-durable-frontier'));}
      finally{await new Promise(r=>hub.wss.close(r));if(db.db.isOpen)db.close();}
      if(failures.length)throw Error('local-expanded-close.installation-failed-resources-closed');return {snapshotSaved,activeNativeSnapshotRefused:!snapshotSaved};}

    return {cfg,pins,boot,db,host,auth,brain,souls,service,hub,server,edge,kitchenInstallation,shoreInstallation,foodDelivery,socialInstallation,close};
  } catch(error){host?.stop();server?.close();db.close();throw error;}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [descriptorPath,mode]=process.argv.slice(2);
  try {
    if(!descriptorPath)throw Error('usage: node tools/core/edge-server.mjs <descriptor.json> [check]');
    const d=JSON.parse(readFileSync(resolve(descriptorPath),'utf8')),flags=d.flags??{};
    const app=await openEdgeServerV1({input:d.input,dataDir:d.dataDir,worldId:d.worldId,port:Number(d.port),webDir:d.webDir,marsWebDir:d.marsWebDir,build:d.build??'local-edge/1',checkOnly:mode==='check',placeData:d.placeData,seedObjects:d.objects,inviteRequired:d.inviteRequired===true,skillFile:d.skillFile,inputManifestSHA256:d.inputManifestSHA256,
      localSoulLimit:Number(d.localSoulLimit??9),humanRest:flags.humanRest??true,provisions:flags.provisions??true,sequences:flags.sequences??true,floorGoals:flags.floorGoals??true,kitchen:flags.kitchen??true,shore:flags.shore??true,foodDeliveryId:flags.foodDeliveryId,quietLandingCourtesy:flags.quietLandingCourtesy??true,social:flags.social??true,approachRetention:flags.approachRetention??true,closedGoals:flags.closedGoals??true,activateExpansion:flags.activateExpansion??true});
    if(app.checkOnly)console.log(JSON.stringify(app,null,2));
    else {console.log(JSON.stringify({url:app.cfg.publicUrl,worldId:app.host.worldId,boot:app.boot,mindDriver:app.cfg.mindDriver,edge:'/v1/edge',places:app.edge.places.byId.size,build:app.cfg.build}));
      for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void app.close().then(()=>process.exit(0)).catch(()=>process.exit(1)));}
  }catch(error){console.error('Edge server refused:',error.message);process.exitCode=1;}
}
