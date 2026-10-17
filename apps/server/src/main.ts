import {edenSteeringModeV1,installEdenSteeringModeV1} from './eden-steering-mode.ts';
import {TakeArchive,r2Store} from './take-archive.ts';
import { createServer } from 'node:http';
import { readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { getRequestListener } from '@hono/node-server';
import { recordedToyFactory } from './toy-takes.ts';
import { Auth } from './auth.ts';
import { Brain } from './brain.ts';
import { config, KNOWN_WORLD_KEYS } from './config.ts';
import { Db } from './db.ts';
import { buildApp } from './http.ts';
import { Hub } from './hub.ts';
import { handleMcp } from './mcp.ts';
import { Souls } from './souls.ts';
import { WorldHost } from './world.ts';
import { LivingWorld } from './living.ts';
import { CampCards } from './camp.ts';
import {FloaterCards} from './floaters.ts';
import { worldDefinition } from './world-config.ts';
import { GodMode } from './god/god.ts';
import { installEngineBridge } from './god/engine-bridge.ts';
import { installWorldEnv } from './god/world-env.ts';
import { installLightning } from './god/lightning.ts';
import { installGovernance } from './god/governance-edge.ts';
import { GroundHost, installGroundCapabilities, loadGroundRecipes } from './god/ground-host.ts';
import { stripWorldRequestPath } from './world-request-path.ts';
import {edenCoreRequested,edenHistoryFactory,installEdenCore,settleEmptyEden,drainEdenThought,installEdenLifeV1,installEdenExpansionV1} from './eden-bootstrap.ts';
import {IntentControlV2} from './intent-control.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {installPuntActivities} from './punt-install.ts';
import {readFileSync} from 'node:fs';
import {installBirthLooks} from './god/birth-look.ts';
import { setKitViewerContract } from '@sim/generators';
import { standby } from './standby.ts';

// Release pre-warm (SIM_STANDBY=1, launcher handover): all code is loaded here; the database and port open only after SIGUSR2.
await standby(async () => { if (config.engine === 'mars') await import('@sim/engine-mars'); await import('./edge/body/migrate-looks.ts'); });

// K1 / NT5: new kit fields are admitted only with the viewer that can draw them.
try { setKitViewerContract(JSON.parse(readFileSync(join(config.webDir, 'kit-contract.json'), 'utf8'))); }
catch { setKitViewerContract(null); }

/** Seeded only into a world with no live Souls, so it is never empty. */
const NATIVES: { name: string; description: string }[] = [
  { name: 'Oda', description: 'a patient gardener who knows every bench and likes quiet mornings' },
  { name: 'Pim', description: 'a restless young musician who sings to anyone who will listen' },
  { name: 'Rowan', description: 'a curious wanderer who maps the edges of the ground and rarely sits still' },
  { name: 'Tamsin', description: 'a warm storyteller who keeps the campfire company and draws others in' },
  { name: 'Juno', description: 'a shy newcomer who watches from a distance before joining anything' },
  { name: 'Basil', description: 'a talkative kiosk regular who loves gossip and hates being alone' },
];

const db = new Db(join(config.dataDir, 'sim.db'));
const definition = worldDefinition(config.worldKey);
if (db.migrated.length) console.log(`[db] applied migrations ${db.migrated.join(', ')}`);
// Each process owns one world and imports its engine from this release.
const mars = config.engine==='mars'?await import('@sim/engine-mars'):null;
const edenCore=edenCoreRequested(config,process.env);
const edenLife=edenCore&&process.env.ENABLE_EDEN_LIFE==='1';
const steeringMode=edenSteeringModeV1(edenLife,process.env);
const newcomerResources=process.env.ENABLE_EDEN_NEWCOMER_READER==='1';
if(newcomerResources&&!edenLife)throw Error('eden-bootstrap.newcomer-reader-requires-opted-in-Eden-life');
const expansionGround=process.env.ENABLE_EDEN_EXPANSION_GROUND_READER==='1';
if(expansionGround&&!edenLife)throw Error('eden-bootstrap.ground-extension-reader-requires-opted-in-Eden-life');
const lecture=process.env.ENABLE_EDEN_LECTURE_READER==='1';
if(lecture&&!edenLife)throw Error('eden-bootstrap.lecture-reader-requires-opted-in-Eden-life');
const sleepSnapshot=process.env.ENABLE_NATIVE_SLEEP_SNAPSHOT_READER==='1';
if(sleepSnapshot&&!edenLife)throw Error('eden-bootstrap.sleep-snapshot-reader-requires-opted-in-Eden-life');
const applyExpansion=process.env.APPLY_EDEN_EXPANSION_CHECKPOINT==='1';
if(applyExpansion&&(!edenLife||!newcomerResources||!sleepSnapshot||!lecture||!expansionGround||process.env.EDEN_CORE_RETAIN_READER==='1'))throw Error('eden-bootstrap.expansion-requires-complete-explicit-readers-and-install-mode');
// Launcher (entity) worlds opt into native Soul arrivals and removal (SOUL_LIFECYCLE=1), so account approvals create Souls as live does. Lane P2.
const accountLifecycle=config.worldEngine&&!edenCore&&process.env.SOUL_LIFECYCLE==='1';
const factory=edenCore?await edenHistoryFactory(db,config.worldId,{lifeV1:edenLife,newcomerResourcesV1:newcomerResources,sleepSnapshotV1:sleepSnapshot,lectureV1:lecture,groundV1:expansionGround}):mars?await mars.marsFactory(config.worldKey==='littlemartians'?mars.LITTLE_MARTIANS_WORLD:config.worldKey==='eden'||!KNOWN_WORLD_KEYS.includes(config.worldKey as never)?(accountLifecycle?{...mars.GREEN_FIELD_WORLD,safeCrewRemoval:true}:mars.GREEN_FIELD_WORLD):undefined):recordedToyFactory;
// ground/1 (lane L8): every terrain recipe this entity world logged resolves by hash before the engine replays
if (config.worldEngine) loadGroundRecipes(db, config.worldId);
const host = new WorldHost(db, factory, config.worldSeed, config.snapshotEveryTicks, config.worldId,edenCore?{durableClockV1:true}:undefined);
const boot = host.boot();
if(edenCore)await installEdenCore(host,{applyCrew:process.env.APPLY_EDEN_CREW_CHECKPOINT==='1',applyCommons:process.env.APPLY_EDEN_COMMONS_CHECKPOINT==='1',retainReader:process.env.EDEN_CORE_RETAIN_READER==='1'});
const edenCapabilities=edenCore&&host.engine.rulesVersion.includes('+crew-removal/1');
console.log(`[world] ${host.worldId} booted from ${boot.from}, tick ${host.engine.world.tick}, replayed ${boot.replayed} events, ${host.minds.size} souls, rules ${host.engine.rulesVersion}`);

const auth = new Auth(config, db);
await auth.init().catch((e) => {if(config.accountAuthRequired)throw e;console.error('[auth] init failed:', e.message);});
if(config.accountAuthRequired&&!auth.ready)throw Error('Account authentication verifier unavailable');

const living = config.worldKey !== 'toy' && config.livingWorld ? new LivingWorld(host) : null;
if(edenCore)await settleEmptyEden(host,living,definition.customs);
else if (living) { living.camp = config.worldKey === 'mars'; void living.install(definition.customs); }
const runtimePolicy = host.extra.runtimePolicy as { sleepBlockTicks: number; quietSeatCourtesy?: boolean } | undefined;
if (living && host.engine.configureRuntimePolicy && !runtimePolicy?.quietSeatCourtesy) {
  void host.enqueue('rules','world',{runtimePolicy:{sleepBlockTicks:1200,...host.extra.runtimePolicy as object,quietSeatCourtesy:true},why:'enable ordinary idle-bystander courtesy at quiet seat exits prospectively; retain historical replay before this event'});
}
const campCards = living?.camp ? new CampCards(host) : null;
if(config.worldKey==='littlemartians')new FloaterCards(host);
void campCards;
const oldCharacters = ['A patient gardener who enjoys preparing food and welcoming people.', 'A curious builder who learns by making useful things from the yard’s materials.', 'A thoughtful reader and teacher who likes sharing ideas and quiet company.', 'A lively musician and storyteller who brings people together around the fire.'];
if (living) for (const [i, n] of definition.cast.entries()) {
  const m = [...host.minds.values()].find(m => m.name === n.name);
  if (m && (m.description === oldCharacters[i] || (i === 1 && m.description === oldCharacters[i].replace('’', "'")))) void host.enqueue('rules','world',{soulId:m.soulId,character:n.description,why:'adopt the four characters from merge plan section 4.9'});
}

let hub!: Hub;
const brain = new Brain(host, db, config, {
  onCall: (c) => hub?.brainCall(c),
  onCamera: (line) => hub?.broadcast({ t: 'camera', line }),
  onTicker: (lines) => hub?.broadcast({ t: 'ticker', lines }),
  onNarrative: (view) => hub?.broadcast({ t: 'narrative', view }),
  onTalk: (lines) => hub?.broadcast({ t: 'talk', lines }),
  clients: () => hub?.clients.size ?? 0,
},edenCapabilities?{intentV2Choices:true}:undefined);
const souls = new Souls(host, db, brain, config);
if(edenCapabilities||accountLifecycle&&host.engine.rulesVersion.includes('+crew-removal/1'))souls.enableLifecycle();
if(applyExpansion)await installEdenExpansionV1(host);
const edenLifeHandles=edenLife?await installEdenLifeV1(host,brain,{retainReader:process.env.EDEN_CORE_RETAIN_READER==='1',foodDeliveryId:process.env.EDEN_FINITE_FOOD_DELIVERY_ID}):undefined;
await installEdenSteeringModeV1(host,steeringMode,process.env.EDEN_CORE_RETAIN_READER==='1');
const intentV2=edenCapabilities?new IntentControlV2(host,brain,souls,{historyV1:true,...steeringMode}):undefined;

const server = createServer();
const stripWorldPath = (url: string | undefined) => stripWorldRequestPath(url, config.worldPath);
server.on('upgrade', req => { req.url = stripWorldPath(req.url); });
hub = new Hub(server, host, auth, db,edenCore?souls:undefined);
hub.brain = brain; hub.build = config.build; hub.persistTakes = config.takesPersist;
const takes=new TakeArchive(db,host.worldId,config.archiveTakes?r2Store(config):null,`${config.r2.prefix}/takes`,config.worldEngine?Number(process.env.TAKES_LOCAL_KEEP_TICKS??72000):0); if(host.engine.takeChunks&&config.takesPersist)takes.start(host);
// Edge worlds mount EDGE-CONTRACT-v1; PLACE_DATA names a PLACE-DATA-v1 file (else places derive from native regions).
const edge = config.mindDriver === 'edge' ? new EdgeLedger(host, db, process.env.PLACE_DATA ? JSON.parse(readFileSync(process.env.PLACE_DATA, 'utf8')) : undefined) : undefined;
if (edge && host.engine.configureRuntimePolicy && host.enableQuietStallReleaseV1) void host.enableQuietStallReleaseV1().then(async () => { await host.enableYieldTimeoutV1?.(); await host.enableSpreadV2?.(); });
// God mode + entity world (spec eden4/28): the owner's edge agent builds the world; viewers get diffs over the hub.
const genesis = process.env.GENESIS_FILE ? JSON.parse(readFileSync(process.env.GENESIS_FILE, 'utf8')) : undefined;
const god = config.worldEngine ? new GodMode(db, { genesis, worldId: host.worldId, ownerId: process.env.WORLD_OWNER_ID || null /* explicit only: on a fresh world the first person to claim it becomes its god */, tick: () => host.engine.world.tick, emit: (m) => hub.broadcast(m as never), cobuilders: process.env.SIM_COBUILDERS === '1' /* off: one god per world (Gene 2026-10-16) */ }) : undefined;
// Stage B (lane L8): the ground fact is queued before the entity bridge so boot installs the terrain first.
const groundHost = god && (host.engine as unknown as {installGroundV1?:unknown}).installGroundV1 ? new GroundHost(db, host, god) : undefined;
if (groundHost && edge) installGroundCapabilities(edge as never, god!, host);
// Stage B (lane L9): Souls live among god-built things — entity physics into the engine, fixtures usable, bodies as entities.
if (god && config.engine === 'mars' && process.env.ENTITY_BRIDGE !== '0') installEngineBridge({ host, god, edge });
if (god && process.env.BIRTH_LOOKS !== '0') installBirthLooks(host, edge);  // lane LOOKS: new Souls in new worlds get a varied kit look
if (god) installWorldEnv(host, god, edge);  // R4-LIVE: Souls perceive the god's weather
if (god) installLightning(god, edge, () => host.engine.world.tick);  // GOD-ENV: Souls see the bolts and hear the thunder
if (god) installGovernance(god, { host, edge });  // GOVERN: versioned constitution, amendments, prayer states (god/governance.ts)
if (god) console.log(`[god] entity world ready: ${god.model.entities.size} entities, ${new Set(god.model.defs.values()).size} own defs + library ${god.model.library ? `${god.model.library.id}@${god.model.library.version} (${god.model.library.all().length})` : 'none'}, owner ${god.owner ?? '(unclaimed)'}`);
const app = buildApp({ cfg: config, db, host, auth, hub, brain, souls, takes, intentV2, edge, god });
if(edge)installPuntActivities(host,edge,m=>console.log(`[activities] ${m}`));
const listener = getRequestListener(app.fetch);
server.on('request', (req, res) => {
  if(edenCore&&closing){res.writeHead(503,{'Cache-Control':'no-store'}).end('Server restarting.');return;}
  req.url = stripWorldPath(req.url);
  if (req.url?.startsWith('/mcp')) { handleMcp(req, res, souls, intentV2, edge ? (method: 'GET'|'POST', path: string, token: string, body?: unknown)=>Promise.resolve(app.request(path,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body!==undefined?{body:JSON.stringify(body)}:{})})).then(r=>r.json()) : undefined).catch((e) => { console.error('[mcp]', e); if (!res.headersSent) res.writeHead(500).end(); }); return; }
  void listener(req, res);
});

host.start();
if (config.seedNatives && db.liveSouls(host.worldId).length === 0) {
  if (config.worldKey === 'toy') {
    for (const n of NATIVES) await souls.create('system', n, true);
  } else {
    if (!config.ownerId) throw new Error('WORLD_OWNER_ID is required before seeding a new world');
    db.upsertUser({ id: config.ownerId, email: config.adminEmails[0] ?? null, wallet: null, role: 'admin' });
    for (const n of definition.cast) {
      if(edenCapabilities){const op=souls.acceptLifecycleCreate(config.ownerId,n);
        for(let i=0;i<100&&!souls.controlReady(db.soul(op.scope.soulId)!);i++){host.drainInputs();await new Promise(r=>setTimeout(r,10));}
        if(!souls.controlReady(db.soul(op.scope.soulId)!))throw Error('eden-bootstrap.seed-admission-not-ready');
      }else await souls.create(config.ownerId, n);
    }
  }
  console.log(`[world] seeded ${host.minds.size} souls`);
}

// One-shot operator maintenance only; ordinary boots never rewrite existing looks.
// Set per boot by LEGACY_LOOKS_MODE, or per world by a one-shot <DATA_DIR>/legacy-looks.env (launcher children).
{const {legacyLookBootHook}=await import('./edge/body/migrate-looks.ts');await legacyLookBootHook(host,db,edge,config.dataDir,process.env);}
// One-shot operator maintenance: <DATA_DIR>/retire-residents.env retires Souls with no signed-in owner (retire-residents.ts).
{const {retireResidentsBootHook}=await import('./retire-residents.ts');await retireResidentsBootHook(souls,db,host.worldId,config.dataDir,process.env);}
server.listen(config.port, config.host, () => console.log(`[http] listening on http://${config.host}:${config.port} (public ${config.publicUrl}), build ${config.build}, brain ${brain.mode}, budget $${brain.budget}/day, invites ${config.inviteRequired ? 'required' : 'open'}`));

let closing = false;
const shutdown = async (sig: string) => {
  if (closing) return; closing = true;
  // Edge worlds have no thought to drain: freeze the clock before the port is released so no successor
  // process can boot while this one still advances the durable clock frontier.
  if (config.mindDriver === 'edge') { host.stop(); edge?.comms?.close(); }
  if(edenCore){
    brain.quiesce();takes.stop();clearTimeout(firstBackup);clearInterval(backupTimer);
    for(const c of hub.clients)c.ws.close(1001,'server restarting');
    const closed=new Promise<void>(resolve=>server.close(()=>resolve()));
    await drainEdenThought(host,brain,intentV2,closed,[()=>edenLifeHandles?.settled()??Promise.resolve(),()=>takes.settled(),()=>Promise.all(backupWork)]);
    edenLifeHandles?.close();
  }
  console.log(`[world] ${sig}: saving snapshot at tick ${host.engine.world.tick}`);
  host.stop(); takes.stop();
  try { host.saveSnapshot(true); } catch (e) { console.error('[world] snapshot failed', e); }
  server.close(); for (const c of hub.clients) c.ws.close(1001, 'server restarting');
  auth.close();db.close(); process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM').catch(()=>console.error('[world] shutdown is incomplete; retain database and inspect')));
process.on('SIGINT', () => void shutdown('SIGINT').catch(()=>console.error('[world] shutdown is incomplete; retain database and inspect')));

// Hourly on-box backup with retention: the last 6 hourly files plus one per day (the 00:00 UTC file) for 7 days.
function pruneBackups() {
  const files = readdirSync(config.dataDir).filter((f) => /^backup-\d{10}\.db$/.test(f)).sort().reverse();
  const keep = new Set(files.slice(0, 6));
  const now = Date.now();
  for (const f of files) {
    const day = Date.UTC(Number(f.slice(7, 11)), Number(f.slice(11, 13)) - 1, Number(f.slice(13, 15)));
    if (f.slice(15, 17) === '00' && now - day <= 8 * 86400_000) keep.add(f); // real date difference, correct across month boundaries
  }
  for (const f of files) if (!keep.has(f)) { try { unlinkSync(join(config.dataDir, f)); } catch { /* already gone */ } }
}
async function backupNow() {
  db.pruneBrainCalls(); db.pruneTalk();
  if (db.vacuumIfBloated()) console.log('[db] vacuumed');
  await db.backupTo(join(config.dataDir, `backup-${new Date().toISOString().slice(0, 13).replace(/[-T:]/g, '')}.db`));
  pruneBackups();
}
const backupWork=new Set<Promise<void>>();
function trackedBackup(){const work=backupNow();backupWork.add(work);void work.finally(()=>backupWork.delete(work)).catch(()=>{});return work;}
pruneBackups();
const firstBackup=setTimeout(() => void trackedBackup().catch((e) => console.error('[backup]', e)), 60_000);firstBackup.unref();
const backupTimer=setInterval(() => void trackedBackup().catch((e) => console.error('[backup]', e)), 3600_000);backupTimer.unref();
