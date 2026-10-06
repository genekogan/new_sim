import {enableCurrentHumanBurstV1} from './human-burst-adapter.mjs';
// Explicit managed local expansion bootstrap. Runtime comes only from the reviewed V3 seal.
// Never used by main.ts, a live unit, or a default environment switch.
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readFileSync,mkdirSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {setImmediate} from 'node:timers/promises';

export async function openExpandedLocalEdenV1({input,dataDir,worldId,port=4959,webDir,marsWebDir,build='local-c194-core/1',checkOnly=false,
  inputManifestSHA256='ea567c1f8905c7065b28a0dac2d62032e87650065440051f6c20f3dddacabc9a',modelCredentialFile,localBudget=3,autonomous=false,localSoulLimit=5,humanRest=false,provisions=false,sequences=false,floorGoals=false,kitchen=false,shore=false,foodDeliveryId,quietLandingCourtesy=false,social=false,closedGoals=false,approachRetention=false,activateExpansion=false,humanDirectionBurstUsd=1,quiesceThought=false}) {
  if(!input||!dataDir||!worldId||!Number.isInteger(port)||!(port>=4950&&port<=4959||port===4970))throw Error('explicit local input/data/world/allowed port required');
  if(!build.startsWith('local-'))throw Error('local build identity required');
  input=resolve(input);dataDir=resolve(dataDir);
  const manifest=JSON.parse(readFileSync(join(input,'../CONTENT-MANIFEST.json'),'utf8'));
  if(!/^[a-f0-9]{64}$/.test(inputManifestSHA256)||createHash('sha256').update(readFileSync(join(input,'../CONTENT-MANIFEST.json'))).digest('hex')!==inputManifestSHA256)throw Error('not the explicitly selected runtime content manifest');
  const sources=['db','world','auth','brain','souls','http','hub','intent-control','mcp','living','config','world-request-path'];
  const pins=sources.map(name=>{
    const path=`apps/server/src/${name}.ts`,sha256=createHash('sha256').update(readFileSync(join(input,path))).digest('hex');
    if(sha256!==manifest[path]?.sha256)throw Error('sealed runtime differs: '+path);
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
    privyAppId:'',privyAppSecret:'',archiveTakes:false,inviteRequired:true,maxSoulsPerUser:5,build};
  if(!Number.isInteger(localSoulLimit)||localSoulLimit<5||localSoulLimit>9)throw Error('local resident allowance must be five through nine');
  cfg.maxSoulsPerUser=localSoulLimit;cfg.thinkingBudgetCeiling=3;cfg.authorizedThinkingWorldId=worldId;cfg.budgetUsdPerDay=localBudget;
  if(modelCredentialFile){
    if((statSync(modelCredentialFile).mode&0o077)!==0)throw Error('local model credential permissions required');
    let keys;try{keys=JSON.parse(readFileSync(modelCredentialFile,'utf8'));}catch{throw Error('local model credential file is unreadable or invalid');}
    if(typeof keys.ANTHROPIC_API_KEY!=='string'||!keys.ANTHROPIC_API_KEY.trim()||typeof keys.TYPESAFE_API_KEY!=='string'||!keys.TYPESAFE_API_KEY.trim())throw Error('existing local model access is incomplete');
    if(!Number.isFinite(localBudget)||localBudget<=0||localBudget>3)throw Error('authorized local rolling budget must be above zero and at most three');
    cfg.anthropicKey=keys.ANTHROPIC_API_KEY;cfg.typesafeKey=keys.TYPESAFE_API_KEY;cfg.brainMode='live';cfg.budgetUsdPerDay=localBudget;
  }
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
    if(quiesceThought)brain.quiesce();
    enableCurrentHumanBurstV1(brain,humanDirectionBurstUsd);
    if(modelCredentialFile){if(!brain.enableLocalBudgetV1||!brain.quiesce||!brain.settled)throw Error('selected live runtime needs local budget and controlled drain');brain.enableLocalBudgetV1();}
    if(autonomous){if(!brain.enableEdenAutonomyV1)throw Error('selected runtime needs explicit autonomy');await drive(brain.enableEdenAutonomyV1());}
    const souls=new Souls(host,db,brain,cfg);souls.enableLifecycle();
    if(provisions){const {followCommonsProvisionBirths}=await load('apps/server/src/commons-provisions.ts');if(!followCommonsProvisionBirths)throw Error('selected runtime needs prospective provision births');provisionBirths=await followCommonsProvisionBirths(host,brain);}
    if(foodDeliveryId){if(!provisions||!kitchen)throw Error('finite food delivery requires retained personal/kitchen resources');const {scheduleFiniteFoodDeliveryV1}=await load('apps/server/src/food-delivery.ts');foodDelivery=scheduleFiniteFoodDeliveryV1(host,brain,foodDeliveryId);}
    if(kitchen){const {scheduleCommonsKitchenInstallation}=await load('apps/server/src/commons-kitchen-install.ts');kitchenInstallation=scheduleCommonsKitchenInstallation(host,brain);}
    if(social){if(!kitchen)throw Error('social Eden requires retained kitchen resources');const {scheduleSocialEdenInstallationV1}=await load('apps/server/src/social-eden-install.ts');socialInstallation=scheduleSocialEdenInstallationV1(host,brain);}
    if(shore){const {scheduleRetainedCommonsShoreInstallation}=await load('apps/server/src/retained-shore-install.ts');shoreInstallation=scheduleRetainedCommonsShoreInstallation(host);}
    service=new IntentControlV2(host,brain,souls,{historyV1:true,closedGoalsV1:closedGoals,registeredActivitiesV1:closedGoals});server=createServer();
    const strip=url=>stripWorldRequestPath(url,cfg.worldPath);
    server.on('upgrade',req=>{req.url=strip(req.url);});hub=new Hub(server,host,auth,db,souls);hub.brain=brain;hub.build=cfg.build;
    const app=buildApp({cfg,db,host,auth,brain,souls,hub,intentV2:service}),listener=require('@hono/node-server').getRequestListener(app.fetch);
    server.on('request',(req,res)=>{
      if(closing){res.writeHead(503,{'Cache-Control':'no-store'}).end('Local server is draining.');return;}
      req.url=strip(req.url);
      if(req.url?.startsWith('/mcp')){void handleMcp(req,res,souls,service).catch(()=>{if(!res.headersSent)res.writeHead(503).end();});return;}
      void listener(req,res);
    });
    await new Promise((r,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',r);});host.start();
    async function close(){if(closing)return;closing=true;brain.quiesce?.();for(const c of hub.clients)c.ws.close(1001,'local server stopping');
      const closed=new Promise(r=>server.close(r)),pump=setInterval(()=>host.drainInputs(),10);
      const failures=[];
      try{await closed;for(const handle of [provisionBirths,socialInstallation,foodDelivery,shoreInstallation,kitchenInstallation])handle?.close();const outcomes=await Promise.allSettled([service.settled(),brain.settled?.(),...[provisionBirths,socialInstallation,foodDelivery,shoreInstallation,kitchenInstallation].map(h=>h?.settled())]);for(const r of outcomes)if(r.status==='rejected')failures.push(r.reason);host.drainInputs();}finally{clearInterval(pump);}
      let snapshotSaved=false;
      try{host.stop();snapshotSaved=host.engine.canSnapshot?.()===true;if(snapshotSaved)host.saveSnapshot(true);else if(!db.db.prepare('SELECT 1 FROM clock_frontiers_v1 WHERE world_id=?').get(worldId))failures.push(Error('active-work-without-durable-frontier'));}
      finally{await new Promise(r=>hub.wss.close(r));if(db.db.isOpen)db.close();}
      if(failures.length)throw Error('local-expanded-close.installation-failed-resources-closed');return {snapshotSaved,activeNativeSnapshotRefused:!snapshotSaved};}

    return {cfg,pins,boot,db,host,auth,brain,souls,service,hub,server,kitchenInstallation,shoreInstallation,foodDelivery,socialInstallation,close};
  } catch(error){host?.stop();server?.close();db.close();throw error;}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [argInput,argData,argWorld,argPort,argWeb,argMars,mode]=process.argv.slice(2);
  const input=argInput??process.env.PREVIEW_INPUT,dataDir=argData??process.env.DATA_DIR,worldId=argWorld??process.env.WORLD_ID;
  const port=argPort??process.env.PORT,webDir=argWeb??process.env.WEB_DIR,marsWebDir=argMars??process.env.MARS_WEB_DIR;
  try {
    const app=await openExpandedLocalEdenV1({input,dataDir,worldId,port:Number(port),webDir,marsWebDir,build:process.env.BUILD_ID??'local-c194-core/1',checkOnly:mode==='check',
      inputManifestSHA256:process.env.PREVIEW_INPUT_MANIFEST_SHA256,modelCredentialFile:process.env.PREVIEW_MODEL_CREDENTIAL_FILE,
      localBudget:Number(process.env.PREVIEW_BUDGET_USD_PER_DAY??3),autonomous:process.env.PREVIEW_EDEN_AUTONOMY==='1',localSoulLimit:Number(process.env.PREVIEW_SOUL_LIMIT??5),humanRest:process.env.PREVIEW_HUMAN_REST==='1',provisions:process.env.PREVIEW_COMMONS_PROVISIONS==='1',sequences:process.env.PREVIEW_INTENT_SEQUENCES==='1',floorGoals:process.env.PREVIEW_FIXTURE_GOAL_LEVELS==='1',kitchen:process.env.PREVIEW_COMMONS_KITCHEN==='1',shore:process.env.PREVIEW_RETAINED_SHORE==='1',foodDeliveryId:process.env.PREVIEW_FINITE_FOOD_DELIVERY_ID,quietLandingCourtesy:process.env.PREVIEW_QUIET_LANDING_COURTESY==='1',social:process.env.PREVIEW_SOCIAL_EDEN==='1',closedGoals:process.env.PREVIEW_CLOSED_HUMAN_GOALS==='1',approachRetention:process.env.PREVIEW_INTENT_APPROACH_RETENTION==='1',activateExpansion:process.env.PREVIEW_ACTIVATE_EXPANSION==='1',humanDirectionBurstUsd:1});
    if(app.checkOnly)console.log(JSON.stringify(app,null,2));
    else {console.log(JSON.stringify({url:app.cfg.publicUrl,worldId:app.host.worldId,boot:app.boot,physicalBase:app.host.engine.world.base,mode:app.brain.mode,budget:app.brain.budget,autonomous:process.env.PREVIEW_EDEN_AUTONOMY==='1'}));
      for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void app.close().then(()=>process.exit(0)).catch(()=>process.exit(1)));}
  }catch(error){console.error('Local Eden refused:',error.message);process.exitCode=1;}
}
