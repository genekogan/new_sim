// Local edge-era Mars/LM launcher. One process and durable DB per world; fake
// world cast only, while paired Souls remain exclusively agent controlled.
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readFileSync,mkdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {setImmediate} from 'node:timers/promises';

export async function openWorldServer({input,dataDir,worldKey,worldId,port,build='local-multiworld/1',webDir,marsWebDir,publicOrigin,ownerId='dev:admin',seedCast=true,nativeCast=true,runtimePolicies=true,installLiving=true,cards=true,skillFile,cliFile,checkOnly=false,worldVariant='legacy',sceneSha256,nativeCastIds}){
 if(!['mars','littlemartians'].includes(worldKey)||!input||!dataDir||!worldId||!Number.isInteger(port)||port<4963||port>4969)throw Error('explicit local Mars/LM input/data/world and port4963..4969 required');
 if(!build.startsWith('local-')||!ownerId)throw Error('local build and explicit cast owner required');
 input=resolve(input);dataDir=resolve(dataDir);
 if(worldKey==='littlemartians'){
  const actual=createHash('sha256').update(readFileSync(join(input,'worlds/littlemartians/scene.json'))).digest('hex');
  const legacy='fc2f8c0e44edea2b60af066572da59e3407ceecf1bf33afc8469791a79f4cd44';
  if(worldVariant==='legacy'){if(actual!==legacy)throw Error('LM legacy scene differs; an authored map requires its own explicit world identity and scene hash');}
  else if(worldVariant==='authored'){if(worldId==='littlemartians-1'||sceneSha256!==actual)throw Error('LM authored map requires a separate worldId and exact sceneSha256');}
  else throw Error('unknown Little Martians worldVariant');
 }
 mkdirSync(dataDir,{recursive:true});
 const lockPath=join(dataDir,'edge-server.lock');
 const releaseLock=()=>{try{if(JSON.parse(readFileSync(lockPath,'utf8')).pid===process.pid)unlinkSync(lockPath);}catch{/* already released */}};
 try{writeFileSync(lockPath,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}),{flag:'wx'});}catch(error){
  if(error.code!=='EEXIST')throw error;
  const held=JSON.parse(readFileSync(lockPath,'utf8'));let alive=false;try{process.kill(held.pid,0);alive=true;}catch(e){if(e.code!=='ESRCH')throw e;}
  if(alive)throw Error('another process owns this world data directory');
  unlinkSync(lockPath);writeFileSync(lockPath,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}),{flag:'wx'});
 }
 const load=p=>import(pathToFileURL(join(input,p)).href),require=createRequire(join(input,'apps/server/package.json'));
 let db,host,server,hub,brain,edge,closing=false;
 async function drive(p){let done=false;p.then(()=>done=true,()=>done=true);for(let i=0;i<100&&!done;i++){host.drainInputs();await setImmediate();}if(!done)throw Error('world bootstrap sequencer did not settle');return p;}
 try{
  const prior=process.env.DATA_DIR;process.env.DATA_DIR=dataDir;
  let defaults;try{defaults=(await load('apps/server/src/config.ts')).config;}finally{if(prior===undefined)delete process.env.DATA_DIR;else process.env.DATA_DIR=prior;}
  const origin=publicOrigin??`http://127.0.0.1:${port}`,url=new URL(origin);
  if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('local publicOrigin must be loopback HTTP');
  const cfg={...defaults,worldKey,worldId,worldPath:`/w/${worldKey}`,worldSeed:'sim-genesis-1',host:'127.0.0.1',port,dataDir,
   webDir:resolve(webDir??join(input,'apps/web/dist')),marsWebDir:resolve(marsWebDir??join(input,'mars/viewer/dist/client')),
   publicUrl:`${origin.replace(/\/$/,'')}/w/${worldKey}`,engine:'mars',livingWorld:true,seedNatives:false,ownerId,
   brainMode:'fake',budgetUsdPerDay:0,thinkingBudgetCeiling:1,authorizedThinkingWorldId:undefined,typesafeKey:undefined,anthropicKey:undefined,
   privyAppId:'',privyAppSecret:'',r2:{prefix:'sim'},archiveTakes:false,inviteRequired:false,maxSoulsPerUser:50,build,mindDriver:'edge',
   skillFile:undefined,cliFile:cliFile?resolve(cliFile):undefined};
  const {Db}=await load('apps/server/src/db.ts'),{WorldHost}=await load('apps/server/src/world.ts'),native=await load('packages/engine-mars/src/index.ts');
  const {worldDefinition}=await load('apps/server/src/world-config.ts'),definition=worldDefinition(worldKey);
  db=new Db(join(dataDir,'sim.db'));
  const selected=worldKey==='littlemartians'?native.LITTLE_MARTIANS_WORLD:{scene:'eden-camp',arrival:[-3,18],arrivalPlace:'arrival',reference:[-1,17],grounds:{id:'grounds',name:'Mars camp'},map:native.MARS_2026_MAP,disassemblyV1:true};
  const factory=await native.marsFactory(selected);
  host=new WorldHost(db,factory,db.world(worldId)?.seed??cfg.worldSeed,cfg.snapshotEveryTicks,worldId,{durableClockV1:true});const boot=host.boot();
  if(worldKey==='littlemartians'&&host.engine.world.base.staticHash!==factory.genesis(host.seed).base.staticHash)throw Error('LM persisted physical base differs from selected map; preserve the old reader and database');
  if(checkOnly){const result={checkOnly:true,boot,worldKey,worldId,tick:host.engine.world.tick,head:host.seq,stateHash:host.engine.stateHash(),rulesVersion:host.engine.rulesVersion};host.stop();db.close();releaseLock();return result;}
  if(skillFile){
   // The shared CLI stays identical. Only selected-world prose is adapted.
   const text=readFileSync(resolve(skillFile),'utf8').replace(/\bEden\b/g,definition.name);
   cfg.skillFile=join(dataDir,'world-skill.md');writeFileSync(cfg.skillFile,text+`\n\n## This world\n\n${definition.name}: ${worldKey==='mars'?'The camp sits on the 2026 campus. Pallet-rack lookout construction and take-down, meals, garden work and bunks use native physical programs. Food is finite until quiet first light.':'Ceramic sculptures glide and hover. They have no hands or limbs; read current body capabilities before acting. Human arrivals keep their own body abilities.'}\n`);
  }
  const {Auth}=await load('apps/server/src/auth.ts'),{Brain}=await load('apps/server/src/brain.ts'),{Souls,ApiError}=await load('apps/server/src/souls.ts');
  const {LivingWorld}=await load('apps/server/src/living.ts'),{Hub}=await load('apps/server/src/hub.ts'),{buildApp}=await load('apps/server/src/http.ts');
  const {stripWorldRequestPath}=await load('apps/server/src/world-request-path.ts'),{handleMcp}=await load('apps/server/src/mcp.ts'),{EdgeLedger}=await load('apps/server/src/edge/ledger/ledger.ts');
  const auth=new Auth(cfg,db);auth.devAuth=true;
  // The application exposes edge control; a separate fake-only config enables
  // the existing needs-driven native cast. A token or non-cast identity excludes
  // the Soul from every native thought/speech/reflection route immediately.
  const castNames=new Set(definition.cast.map(n=>n.name));
  // Authority comes from durable original birth identities, never today's
  // names. Retiring/recreating a name must not grant native control on restart.
  const rosterFacts=db.rulesEvents(worldId).filter(e=>e.payload?.nativeCastRosterV1);
  if(rosterFacts.some(e=>e.author!=='operator:local-native-cast-roster'))throw Error('native cast roster lacks its explicit operator origin');
  if(rosterFacts.length>1)throw Error('native cast has conflicting roster facts');
  const recorded=rosterFacts[0]?.payload.nativeCastRosterV1;
  if(recorded&&(recorded.contract!=='native-cast-roster/1'||recorded.ownerId!==ownerId||recorded.worldKey!==worldKey||!Array.isArray(recorded.cast)))throw Error('native cast roster differs from selected owner/world');
  const births=db.events(worldId).filter(e=>e.kind==='birth');
  const originalPrefix=births.slice(0,definition.cast.length);
  const validPrefix=originalPrefix.length===definition.cast.length&&new Set(originalPrefix.map(e=>e.payload.name)).size===definition.cast.length&&originalPrefix.every(e=>e.payload.owner===ownerId&&castNames.has(e.payload.name));
  let roster=recorded?.cast??(nativeCastIds?nativeCastIds.map(id=>{const birth=births.find(e=>e.payload.soulId===id);if(!birth||birth.payload.owner!==ownerId)throw Error('explicit native cast identity lacks its accepted owned birth');return{soulId:id,entityId:birth.payload.entityId,name:birth.payload.name};}):validPrefix?originalPrefix.map(e=>({soulId:e.payload.soulId,entityId:e.payload.entityId,name:e.payload.name})):[]);
  if(new Set(roster.map(e=>e.soulId)).size!==roster.length||roster.some(e=>typeof e.soulId!=='string'||typeof e.entityId!=='string'||!castNames.has(e.name)))throw Error('invalid native cast roster');
  if(nativeCast&&births.length&&!roster.length)throw Error('legacy history requires explicit original nativeCastIds; current names cannot grant authority');
  const castIds=new Set(roster.map(e=>e.soulId)),castEntities=new Map(roster.map(e=>[e.soulId,e.entityId]));
  const skipMind=m=>{const row=db.soul(m.soulId);return !nativeCast||!castIds.has(m.soulId)||castEntities.get(m.soulId)!==m.entityId||m.owner!==ownerId||!row||row.owner!==ownerId||row.entity_id!==m.entityId||row.world_id!==worldId||row.retired_at!==null||!!row.token_hash;};
  if(nativeCast&&!host.engine.nativeProgramParticipantsV1)throw Error('native cast requires the qualified native participant reader');
  const nativeProgramAllowed=(m,steps)=>{
   if(skipMind(m))return false;
   const participants=host.engine.nativeProgramParticipantsV1({actor:m.entityId,label:'native cast admission',steps});
   if(participants===null)return false;
   // LM cast cards use generic glide/rest. Unqualified raw camp limb/work or
   // classroom programs may not recruit a rigid secondary after a body swap.
   if(participants.some(id=>host.engine.world.entities[id]?.body?.family==='floater')&&steps.some(s=>s.verb.startsWith('mars:')||['build_lookout','unbuild_lookout','control_classroom_v1'].includes(s.verb)))return false;
   return participants.every(id=>{const peer=host.mindByEntity.get(id);return !!peer&&!skipMind(peer);});
  };
  brain=new Brain(host,db,{...cfg,mindDriver:'central'},{clients:()=>hub?.clients.size??0,onCall:c=>hub?.brainCall(c),onCamera:line=>hub?.broadcast({t:'camera',line}),onTicker:lines=>hub?.broadcast({t:'ticker',lines}),onNarrative:view=>hub?.broadcast({t:'narrative',view}),onTalk:lines=>hub?.broadcast({t:'talk',lines})},{skipMind,nativeProgramAllowed:nativeCast?nativeProgramAllowed:undefined});
  if(!nativeCast)brain.quiesce();
  const souls=new Souls(host,db,brain,cfg,{controlReady:row=>{
   if(castIds.has(row.id)&&!row.token_hash&&(host.engine.programOf(row.entity_id)||host.engine.actorBorrowed?.(row.entity_id)))throw new ApiError(409,'native-cast.busy','The current native activity must reach a safe boundary before pairing. Retry after it finishes.');
   return true;
  }});
  if(installLiving){const living=new LivingWorld(host);living.camp=worldKey==='mars';await drive(living.install(definition.customs));}
  if(runtimePolicies){
   if(host.engine.configureRuntimePolicy&&!host.extra.runtimePolicy?.quietSeatCourtesy)await drive(host.enqueue('rules','world',{runtimePolicy:{sleepBlockTicks:1200,...host.extra.runtimePolicy,quietSeatCourtesy:true},why:'enable native quiet-seat courtesy prospectively'}));
   for(const name of ['enableQuietStallReleaseV1','enableYieldTimeoutV1','enableSpreadV2','enableStairMakeWayV1','enableReflexTimeoutV1','enableEdgeMotionV1'])if(host[name])await drive(host[name]());
   // continuousDay deliberately omitted: Mars food replenishes at quiet first light.
  }
  if(seedCast&&births.length===0&&db.liveSouls(worldId).length===0){db.upsertUser({id:ownerId,email:null,wallet:null,role:'admin'});for(const entry of definition.cast){const row=await drive(souls.create(ownerId,entry,true));castIds.add(row.id);castEntities.set(row.id,row.entity_id);roster.push({soulId:row.id,entityId:row.entity_id,name:row.name});}}
  if(nativeCast&&!recorded)await drive(host.enqueue('rules','operator:local-native-cast-roster',{nativeCastRosterV1:{contract:'native-cast-roster/1',worldKey,ownerId,cast:roster},why:'authorize only original cast birth identities; later name reuse never grants control'}));
  if(nativeCast&&!recorded)for(const entry of roster){const mind=host.minds.get(entry.soulId);if(mind&&!skipMind(mind))await drive(brain.attune(mind));}
  if(cards){if(worldKey==='mars'){const {CampCards}=await load('apps/server/src/camp.ts');new CampCards(host);}else{const {FloaterCards}=await load('apps/server/src/floaters.ts');new FloaterCards(host);}host.drainInputs();await setImmediate();}
  // Fake native needs already animate the cast. A second ambient decision
  // driver could commandeer a crew member borrowed by a construction program.
  edge=new EdgeLedger(host,db,undefined,{ambient:false});
  const {marsEdgeProfile}=await load('apps/server/src/worlds/mars-edge.ts'),{floaterEdgeProfile}=await load('apps/server/src/worlds/floater-edge.ts');
  const profile=worldKey==='mars'?marsEdgeProfile(host):null,rigid=floaterEdgeProfile(host);
  edge.worldProfile=(soul,caps,plans)=>{profile?.(soul,caps,plans);rigid(soul,caps,plans);};
  server=createServer();const strip=url=>stripWorldRequestPath(url,cfg.worldPath);server.on('upgrade',req=>{req.url=strip(req.url);});
  hub=new Hub(server,host,auth,db);hub.brain=brain;hub.build=build;
  const previousFading=process.env.EDGE_FADING;delete process.env.EDGE_FADING;
  let app;try{app=buildApp({cfg,db,host,auth,brain,souls,hub,edge});}finally{if(previousFading!==undefined)process.env.EDGE_FADING=previousFading;}
  const listener=require('@hono/node-server').getRequestListener(app.fetch);
  server.on('request',(req,res)=>{
   if(closing){res.writeHead(503,{'Cache-Control':'no-store'}).end('World is draining.');return;}
   req.url=strip(req.url);
   if(req.url?.startsWith('/mcp')){void handleMcp(req,res,souls,undefined,(method,path,token,body)=>Promise.resolve(app.request(path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})})).then(r=>r.json())).catch(()=>{if(!res.headersSent)res.writeHead(503).end();});return;}
   void listener(req,res);
  });
  await new Promise((yes,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',yes);});host.start();
  async function close(){
   if(closing)return;closing=true;brain.quiesce();host.stop();edge.comms?.close();for(const c of hub.clients)c.ws.close(1001,'local world stopping');
   const closed=new Promise(r=>server.close(r));server.closeAllConnections?.();const pump=setInterval(()=>host.drainInputs(),10);
   try{await closed;await brain.settled();host.drainInputs();if(host.engine.canSnapshot?.())host.saveSnapshot(true);else host.persistClockFrontier();}
   finally{clearInterval(pump);await new Promise(r=>hub.wss.close(r));db.close();releaseLock();}
  }
  return{cfg,boot,db,host,auth,brain,souls,hub,server,edge,close};
 }catch(error){brain?.quiesce();host?.stop();server?.close();if(db?.db.isOpen)db.close();releaseLock();throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const [path,mode]=process.argv.slice(2);if(!path)throw Error('usage: node tools/core/multiworld/world-server.mjs <descriptor.json> [check]');
  const server=await openWorldServer({...JSON.parse(readFileSync(resolve(path),'utf8')),checkOnly:mode==='check'});
  if(server.checkOnly)console.log(JSON.stringify(server));else{console.log(JSON.stringify({url:server.cfg.publicUrl,worldId:server.host.worldId,boot:server.boot,mindDriver:'edge',nativeCast:'fake',budgetUsd:0}));for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void server.close().then(()=>process.exit(0)).catch(()=>process.exit(1)));}
 }catch(error){console.error('World server refused:',error.message);process.exitCode=1;}
}
