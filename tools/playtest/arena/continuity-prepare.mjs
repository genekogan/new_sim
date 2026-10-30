// Preparation components only. Never starts a model, changes a fixture, or
// certifies qualification. World/CLI actions occur only when the caller invokes
// the explicit mechanical boundaries below; tests inject those boundaries.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,lstatSync,realpathSync,renameSync,existsSync} from 'node:fs';
import {resolve,join,isAbsolute} from 'node:path';
import {provision,stopWorld} from './provision.mjs';
import {createSeat} from './seat.mjs';
import {runFixtureSetup,checkStart} from './fixture-setup.mjs';
import {bindJourneyFixtures} from './fixture-bindings.mjs';
import {compilerSnapshot,physicalGenesisSha256,physicalSnapshotSha256} from '../lib/physical-fixture.mjs';
import {seatIdentity} from '../review/journey-oracles.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const id=x=>typeof x==='string'&&/^[-A-Za-z0-9_]{1,100}$/.test(x);
const label=x=>typeof x==='string'&&x.trim().length>0&&x.length<=160&&!/[\u0000-\u001f\u007f]/.test(x);
const cited=x=>Array.isArray(x)&&x.length>0&&x.length<=16&&x.every(s=>typeof s==='string'&&s.length>0&&s.length<=1000);
const fault=code=>Object.assign(Error(code),{code});
const json=(path,value)=>writeFileSync(path,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
const copy=x=>structuredClone(x);
const privateUpdate=(path,value)=>{writeFileSync(path+'.tmp',JSON.stringify(value,null,2)+'\n',{mode:0o600});renameSync(path+'.tmp',path);};
const safeFile=(path,max=32*1024*1024)=>{const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||s.size>max||realpathSync(path)!==path)throw fault('UNSAFE_PREPARATION_FILE');return readFileSync(path);};
const sourcePath=(root,path)=>{if(typeof path!=='string'||isAbsolute(path)||path.split('/').some(p=>!p||p==='.'||p==='..'||p.startsWith('.'))||! /^(tools\/(playtest|soul-runtime|world-launcher\/soul)\/|worlds\/(templates|patches)\/|apps\/server\/|packages\/|mars\/viewer\/engine\/)/.test(path))throw fault('INVALID_SOURCE_PIN_PATH');const full=resolve(root,path);if(realpathSync(full)!==full)throw fault('UNSAFE_SOURCE_PIN_PATH');return full;};
const git=(root,args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',timeout:10000,maxBuffer:65536}).trim();
function bodyFree(snapshot){
 if(Buffer.byteLength(JSON.stringify(snapshot))>32*1024*1024)throw fault('PREPARATION_SNAPSHOT_BOUND');
 const s=compilerSnapshot(snapshot),defs=new Map(s.defs.map(d=>[d.hash,d]));
 for(const e of s.entities){const d=defs.get(e.def?.startsWith('sha:')?e.def.slice(4):s.defRefs?.[e.def])??(s.defRefs===undefined?s.defs.find(d=>d.ref===e.def):null);if(d?.components?.body||d?.tags?.includes('body'))throw fault('INITIAL_SNAPSHOT_HAS_BODY');}
 return s;
}

/** Explicit file allowlist, exact clean source head and physical genesis. No
 * repository crawl, inferred baseline, or current-served artifact substitution. */
export function pinContinuityPreparation({serverRoot,revision,files,genesisPath,genesisPhysicalSha256},{readGit=git}={}){
 const root=resolve(serverRoot);
 if(!/^[a-f0-9]{40}$/.test(revision??'')||!Array.isArray(files)||!files.length||files.length>64||new Set(files.map(f=>f.path)).size!==files.length||!hash(genesisPhysicalSha256)||!files.some(f=>f.path===genesisPath))throw fault('INVALID_PREPARATION_PIN');
 const paths=files.map(f=>{if(!hash(f.sha256))throw fault('INVALID_PREPARATION_PIN');return {path:f.path,full:sourcePath(root,f.path),sha256:f.sha256};});
 if(readGit(root,['rev-parse','HEAD'])!==revision||readGit(root,['status','--porcelain','--untracked-files=all','--',...paths.map(f=>f.path)]))throw fault('SOURCE_PIN_NOT_CLEAN');
 const tracked=new Set(readGit(root,['ls-files','--error-unmatch','--',...paths.map(f=>f.path)]).split('\n'));
 const verified=paths.map(f=>{if(!tracked.has(f.path))throw fault('SOURCE_PIN_NOT_TRACKED');const bytes=safeFile(f.full);if(sha(bytes)!==f.sha256)throw fault('SOURCE_PIN_HASH_MISMATCH');return {path:f.path,sha256:f.sha256,bytes:bytes.length};});
 if(physicalGenesisSha256(JSON.parse(safeFile(sourcePath(root,genesisPath))))!==genesisPhysicalSha256)throw fault('GENESIS_PHYSICAL_PIN_MISMATCH');
 return {schema:'continuity-preparation-pin/1',serverRoot:root,revision,files:verified,genesisPath,genesisPhysicalSha256,scope:'Explicit file allowlist; caller must seal all relevant sources/policies. Not a whole-repository cleanliness or release certificate.'};
}

/** A new owned directory makes provision's destructive fresh reset safe. Save
 * compiler geometry before ANY createSeat/pair call; never seed old Souls. */
export async function provisionContinuityPreparation({directory,pin,world},{provisionWorld=provision,stopOwnedWorld=stopWorld,readSnapshot,readGit=git,now=Date.now}={}){
 if(typeof directory!=='string'||!isAbsolute(directory)||!pin||world?.genesis!==pin.genesisPath||world?.snapshot||world?.kind&&world.kind!=='dev'||world?.natives===true||! /^[a-z][a-z0-9-]{0,31}$/.test(world?.slug??'')||!Number.isInteger(world?.port)||world.port<1024||world.port>65535||typeof readSnapshot!=='function')throw fault('INVALID_PREPARATION_WORLD');
 const verified=pinContinuityPreparation(pin,{readGit}),out=resolve(directory);if(realpathSync(resolve(out,'..'))!==resolve(out,'..')||existsSync(out))throw fault('PREPARATION_DIRECTORY_EXISTS');
 mkdirSync(out,{mode:0o700});json(join(out,'source-pin.json'),verified);let started=null;
 try{
  started=await provisionWorld({runDir:out,serverRoot:verified.serverRoot,world:{...copy(world),kind:'dev',natives:false}});
  const base=new URL(started.base);if(base.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(base.hostname)||base.username||base.password||base.search||base.hash)throw fault('PREPARATION_WORLD_NOT_LOOPBACK');
  const snapshot=bodyFree(await readSnapshot(started));
  const physicalSha256=physicalSnapshotSha256(snapshot),snapshotPath=join(out,'initial-body-free.json');json(snapshotPath,snapshot);
  const savedAt=now(),manifest={schema:'continuity-preparation/1',status:'body-free-saved; not qualification-ready',worldId:world.slug+'-1',base:started.base,pid:started.pid,sourcePin:verified,initialSnapshot:{path:snapshotPath,sha256:sha(readFileSync(snapshotPath)),physicalSha256,savedAt},pairingStartedAt:null,missing:['native capability and exact-slot discovery','per-actor physical setup and occupancy','field-return place binding','both-arm model/effort evidence','policy activation and visual review','capture readiness and numeric/source seal']};
  json(join(out,'preparation.json'),manifest);return {directory:out,world:started,manifest,snapshot};
 }catch(error){let stopped=false;if(started?.pid)try{stopped=(await stopOwnedWorld({pid:started.pid})).stopped===true;}catch{}
  json(join(out,'preparation-failure.json'),{code:typeof error?.code==='string'?error.code:'PREPARATION_FAILED',ownedWorldPid:started?.pid??null,ownedWorldStopped:stopped});throw error;
 }
}

const requiredSeats=fixture=>[...(fixture.seatPool??[]).map(s=>({...s,slot:'seat'})),...(fixture.presenterSeat?[fixture.presenterSeat]:[]),...(fixture.audienceSeats??[]),...(fixture.occupiedSeat?[fixture.occupiedSeat]:[])];
/** Reuse the exact parent-path binder, refusing duplicate paths instead of
 * choosing an arbitrary match. Static identity is not native availability. */
export function bindContinuityStaticRefs({fixture,snapshot,worldId,boundAt,evidence}){
 if(!fixture||!id(fixture.id)||!id(worldId)||!Number.isFinite(boundAt)||!cited(evidence))throw fault('INVALID_CONTINUITY_BINDING');
 const frozen=bodyFree(snapshot),byId=new Map(frozen.entities.map(e=>[e.id,e])),paths=new Map();
 if(byId.size!==frozen.entities.length)throw fault('DUPLICATE_STATIC_ENTITY_ID');
 for(const e of frozen.entities){let cur=e,parts=[],seen=new Set();while(cur){if(seen.has(cur.id))throw fault('STATIC_PARENT_CYCLE');seen.add(cur.id);parts.unshift(cur.name??cur.id);if(cur.in?.parent&&cur.in.parent!=='world'&&!byId.has(cur.in.parent))throw fault('STATIC_PARENT_MISSING');cur=byId.get(cur.in?.parent);}const path=parts.join('/');if(paths.has(path))throw fault('AMBIGUOUS_STATIC_REF');paths.set(path,e);}
 const seats=new Map(requiredSeats(fixture).map(s=>[s.ref,s])),refs=new Set([...seats.values()].map(s=>s.entityRef??s.ref.split('#')[0]));
 for(const ref of [fixture.venue?.ref,fixture.venue?.meetingRef,fixture.venue?.gardenRef,fixture.activity?.targetRef,...(fixture.endpointCandidates??[]).map(e=>e.ref),...fixture.disturbances.map(d=>d.errandRef)])if(ref)refs.add(ref);
 const found=[...refs].filter(r=>paths.has(r)),missing=[...refs].filter(r=>!paths.has(r)).map(ref=>'static ref '+ref),adapter={director:{script:[{id:'continuity-static',expect:{journey:{phases:[{receipt:{targetRefs:found}}]}}}]}};
 const result=bindJourneyFixtures(adapter,{...frozen,worldId}),entities=new Map(result.bindings.map(b=>[b.ref,b])),bindings={};
 const definition=entity=>{const wanted=entity.def.startsWith('sha:')?entity.def.slice(4):frozen.defRefs?.[entity.def];return wanted?frozen.defs.find(d=>d.hash===wanted):frozen.defRefs===undefined?[...frozen.defs].reverse().find(d=>d.ref===entity.def):undefined;};
 for(const ref of found)bindings[ref]={ref,worldId,entityId:entities.get(ref).id,definition:entities.get(ref).def,evidence:copy(evidence),nativeAvailability:'unknown'};
 for(const s of seats.values()){
  const entity=paths.get(s.entityRef??s.ref.split('#')[0]);if(!entity)continue;
  const slot=s.slot??s.ref.split('#')[1]??'seat',def=definition(entity),declared=def?.slots?.filter(x=>x.kind==='seat')??[],authored=declared.find(x=>x.id===slot);
  bindings[s.ref]={...bindings[s.entityRef??s.ref.split('#')[0]],ref:s.ref,slot,authoredSlot:authored?{id:authored.id,kind:authored.kind,capacity:authored.capacity??null}:null,exactSlotVerified:!!authored,seatCount:declared.length};
  if(!authored)missing.push('resolved native/authored slot '+s.ref+'#'+slot);
 }
 return {schema:'continuity-static-bindings/1',scenarioId:fixture.id,worldId,boundAt,physicalSha256:physicalSnapshotSha256(frozen),bindings,missing,status:'unknown',evidence:copy(evidence),limits:'Static ref/declared-slot identity only. Generated/inherited slots, exact native capabilities, reachability and field-place equivalence need separate native proof.'};
}

/** Common task information only. Clock placeholders remain for the trial's T0
 * renderer; arm host protocols and baseline local-artifact onboarding are outer
 * wrappers, never different social facts or a new speaking schedule. */
export function composeContinuityInstructions({matrixScenario,fixture,roster,fixtureRoster=[]}){
 if(matrixScenario?.id!==fixture?.id||!Array.isArray(matrixScenario.instructions)||!Array.isArray(roster)||roster.length!==fixture.actors.length||!Array.isArray(fixtureRoster)||fixtureRoster.length>5||typeof fixture.initialConstraintSupplement!=='string'||!fixture.initialConstraintSupplement.trim()||fixture.actors.some(a=>typeof a.originalErrand?.initialOwnerSupplement!=='string'||!a.originalErrand.initialOwnerSupplement.trim()))throw fault('INVALID_CONTINUITY_ROSTER');
 const rows=new Map();for(const r of roster){const a=fixture.actors.find(a=>a.id===r.actorId);if(!a||rows.has(r.actorId)||r.publicName!==a.soulName||!id(r.soulId)||!cited(r.evidence))throw fault('INVALID_CONTINUITY_ROSTER');rows.set(r.actorId,r);}
 if(new Set(roster.map(r=>r.soulId)).size!==roster.length||new Set([...roster,...fixtureRoster].map(r=>r.publicName)).size!==roster.length+fixtureRoster.length||fixtureRoster.some(r=>!label(r.publicName)||!label(r.role)||!cited(r.evidence)))throw fault('INVALID_CONTINUITY_ROSTER');
 const roleIndexes={'eden-reading-duo':[0,1],'mars-presentation-four':[0,1,1,1],'eden-walk-three':[0,0,0],'eden-bandstand-five':[0,1,1,1,1]},indexes=roleIndexes[fixture.id];if(!indexes||indexes.length!==fixture.actors.length)throw fault('UNSUPPORTED_CONTINUITY_COMPOSITION');
 const publicRoster='Invited participants: '+fixture.actors.map(a=>`${a.soulName} (${a.role})`).join('; ')+'.'+(fixtureRoster.length?' Fixture-only bodies, not invited guests: '+fixtureRoster.map(r=>`${r.publicName} (${r.role})`).join('; ')+'.':'');
 const actors=fixture.actors.map((a,i)=>{const pieces=[`You are ${a.soulName}. Your pairing and mechanical setup are complete.`,matrixScenario.instructions[indexes[i]],fixture.initialConstraintSupplement,a.originalErrand?.initialOwnerSupplement,a.initialOwnerSupplement,publicRoster].filter(x=>x!==undefined);if(pieces.some(x=>typeof x!=='string'||!x.trim()))throw fault('MISSING_CONTINUITY_INSTRUCTION');const instruction=pieces.join('\n\n');if(Buffer.byteLength(instruction)>16000)throw fault('CONTINUITY_INSTRUCTION_BOUND');return {id:a.id,soulId:rows.get(a.id).soulId,publicName:a.soulName,releaseOffsetSec:a.releaseOffsetSec??0,instruction,instructionTemplateSha256:sha(instruction)};});
 return {schema:'continuity-composed-instructions/1',scenarioId:fixture.id,actors,rosterEvidence:roster.flatMap(r=>r.evidence),fixtureRoster:copy(fixtureRoster),paritySha256:sha(JSON.stringify(actors.map(({id,instruction,releaseOffsetSec})=>({id,instruction,releaseOffsetSec})))),limits:'Same templates for both arms; no T0 rendered, model/effort verification or physical-readiness claim.'};
}

/** Pairing files stay opaque in Seat/CLI. Save only allowlisted public identity
 * and setup projections; never persist the complete status/account response. */
export async function prepareContinuityActors({directory,fixture,fixtureActors=[]},{seatFactory=createSeat,setup=runFixtureSetup,now=Date.now,readGit=git}={}){
 const out=resolve(directory),path=join(out,'preparation.json'),manifest=JSON.parse(safeFile(path,256*1024));
 if(manifest.schema!=='continuity-preparation/1'||manifest.pairingStartedAt!==null||!fixture?.actors?.length||fixture.actors.length>5||!Array.isArray(fixtureActors)||fixtureActors.length>5)throw fault('INVALID_ACTOR_PREPARATION');
 if(manifest.initialSnapshot.path!==join(out,'initial-body-free.json'))throw fault('PREPAIR_SNAPSHOT_CHANGED');
 pinContinuityPreparation(manifest.sourcePin,{readGit});
 const bytes=safeFile(manifest.initialSnapshot.path);if(sha(bytes)!==manifest.initialSnapshot.sha256||physicalSnapshotSha256(JSON.parse(bytes))!==manifest.initialSnapshot.physicalSha256)throw fault('PREPAIR_SNAPSHOT_CHANGED');
 const declared=[...fixture.actors,...fixtureActors];if(declared.some(a=>!id(a.id)||!label(a.soulName))||new Set(declared.map(a=>a.id)).size!==declared.length||new Set(declared.map(a=>a.soulName)).size!==declared.length)throw fault('INVALID_ACTOR_PREPARATION');
 manifest.pairingStartedAt=now();if(manifest.pairingStartedAt<manifest.initialSnapshot.savedAt)throw fault('PREPARATION_CLOCK_REVERSED');privateUpdate(path,manifest);
 const actors=[],seats=new Map();let failed=false;
 for(const actor of declared){
  const row={actorId:actor.id,role:actor.role??'fixture-only',status:'unknown',publicName:actor.soulName,soulId:null,evidence:[]};actors.push(row);
  try{
   const seat=seatFactory({runDir:out,seat:{id:actor.id,adapter:'codex-headless',wake:false,soulName:actor.soulName},worldBase:manifest.base});seats.set(actor.id,seat);
   await seat.assistPair(actor.soulName);const status=await seat.status(),s=status?.data?.soul;
   if(!status.ok||status.data?.paired!==true||status.data.world!==manifest.base||!id(s?.id)||s.name!==actor.soulName||actors.some(r=>r!==row&&r.soulId===s.id))throw fault('PAIRED_IDENTITY_MISMATCH');
   row.soulId=s.id;row.folder=seat.folder;row.evidence=[`actor-preparation.json#${actor.id}`];
   if(fixture.actors.includes(actor)){
    const result=await setup({seat,setup:copy(actor.setup),runDir:out,requestKey:actor.id,now});
    row.setup={ok:result.ok,startedAt:result.startedAt,elapsedMs:result.elapsedMs,me:result.me,receiptIds:(result.actions??[]).map(a=>a.receipt?.id).filter(Boolean),evidence:['fixture-setup.jsonl#requestKey='+actor.id]};
    if(!result.ok||checkStart(result.me,actor.setup.expect).length)throw fault('NATIVE_START_SETUP_FAILED');
    row.status='setup-verified';
   }else row.status='paired; fixture placement unknown';
  }catch(error){row.status='fail';row.failureCode=typeof error?.code==='string'?error.code:'ACTOR_PREPARATION_FAILED';failed=true;break;}
 }
 const result={schema:'continuity-actor-preparation/1',worldId:manifest.worldId,status:failed?'fail':'unknown',qualificationReady:false,actors,missing:failed?['actor preparation failed; no model may start']:['native capability/field bindings and visual/policy/model seal','occupied-seat setup and continued occupancy where required','fixture speaker placement and hearing-range proof','R400 artifact installation/hash check before baseline']};json(join(out,'actor-preparation.json'),result);return {result,seats};
}

/** A finite one-second native sit must complete and leave the exact seat held.
 * One discovered capability, no retries/substitutions. Continued occupancy and
 * any pre-T0 restart recheck remain the caller/trial's explicit audit. */
export async function occupyContinuitySeat({seat,fixture,binding,discovery,occupant,runDir,maxWallSec=240},{now=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 const wanted=fixture?.occupiedSeat;
 if(!wanted||!binding||binding.ref!==wanted.ref||binding.slot!==wanted.slot||!id(binding.entityId)||!id(binding.worldId)||!cited(binding.evidence)||maxWallSec!==240||typeof seat?.fixtureCliJson!=='function'||typeof seat?.status!=='function'||!occupant||!id(occupant.actorId)||fixture.actors?.some(a=>a.id===occupant.actorId)||!id(occupant.soulId)||occupant.worldId!==binding.worldId||!cited(occupant.evidence))throw fault('INVALID_OCCUPIED_SEAT_SETUP');
 let base;try{base=new URL(occupant.worldBase);}catch{throw fault('INVALID_OCCUPANT_WORLD');}if(base.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(base.hostname)||base.username||base.password||base.search||base.hash)throw fault('INVALID_OCCUPANT_WORLD');
 const startedAt=now(),result={schema:'continuity-occupied-seat-setup/1',worldId:binding.worldId,seatRef:wanted.ref,entityId:binding.entityId,slot:binding.slot,startedAt,status:'unknown',receiptId:null,occupant:{actorId:occupant.actorId,soulId:occupant.soulId,worldId:occupant.worldId,worldBase:occupant.worldBase,evidence:copy(occupant.evidence)},evidence:copy(binding.evidence)};
 if(!discovery){result.reason='source-backed exact native sit capability unresolved';json(join(resolve(runDir),'occupied-seat-preparation.json'),result);return result;}
 if(discovery.worldId!==binding.worldId||discovery.entityId!==binding.entityId||discovery.slot!==binding.slot||typeof discovery.capability!=='string'||!discovery.capability.startsWith('sit:')||discovery.capability.length>300||!cited(discovery.evidence)||!Number.isFinite(discovery.observedAt)||discovery.observedAt>startedAt)throw fault('NATIVE_OCCUPANCY_CAPABILITY_MISMATCH');
 if(!Array.isArray(discovery.params)||!discovery.params.includes('seconds')){result.reason='native seconds parameter support unresolved';json(join(resolve(runDir),'occupied-seat-preparation.json'),result);return result;}
 const capability=discovery.capability,cli=seat.fixtureCliJson.bind(seat),end=startedAt+maxWallSec*1000,monoStart=performance.now(),left=()=>Math.max(0,Math.min(end-now(),maxWallSec*1000-(performance.now()-monoStart)));
 result.capability=capability;result.params={seconds:1};result.evidence.push(...discovery.evidence);
 const output=join(resolve(runDir),'occupied-seat-preparation.json');json(output,result); // Claim before any native write; never resend a partial setup.
 try{
  const status=await seat.status(),actual=status?.data;
  if(!status.ok||actual?.paired!==true||actual.world!==occupant.worldBase||actual.soul?.id!==occupant.soulId)throw fault('OCCUPANT_CONTEXT_MISMATCH');
  result.identityProof={verifiedAt:now(),worldBase:actual.world,soulId:actual.soul.id,evidence:copy(occupant.evidence)};privateUpdate(output,result);
  const response=await cli(['act',capability,'{"seconds":1}','--for','none','--json','--wait',String(Math.max(1,Math.floor(left()/1000)))],Math.max(1,left()));let receipt=response.data?.receipt;
  if(!response.ok||response.data?.accepted!==true||!id(receipt?.id))throw fault('OCCUPANCY_NOT_ACCEPTED');result.receiptId=receipt.id;
  result.observedAcceptedAt=now();result.receiptEvents=(response.data.events??[]).filter(e=>e.receipt?.id===receipt.id&&Number.isFinite(e.at)).slice(0,64).map(e=>({eventId:e.id,at:e.at,phase:e.receipt.phase}));
  privateUpdate(output,result);
  do{
   if(receipt.phase!=='completed'){
    if(['failed','replaced','cancelled','canceled'].includes(receipt.phase))throw fault('OCCUPANCY_RECEIPT_FAILED');
    const readback=await cli(['receipt',result.receiptId],Math.max(1,left())),candidate=readback.data?.receipt??readback.data;
    if(readback.ok&&candidate?.id===result.receiptId)receipt=candidate;
   }
   result.receipt={id:receipt.id,capability:receipt.capability??capability,phase:receipt.phase,chosen:receipt.chosen??null,endedAt:receipt.endedAt??null};
   const target=seatIdentity(receipt.chosen?.slot??receipt.chosen?.target);
   if(target&&(target.entity!==binding.entityId||target.slot&&target.slot!==binding.slot))throw fault('OCCUPANCY_RECEIPT_TARGET_MISMATCH');
   const reading=await cli(['here'],Math.max(1,left())),me=reading.data?.me,held=seatIdentity(me?.seat);result.observedAt=now();
   if(reading.ok&&me?.soulId!==occupant.soulId)throw fault('OCCUPANCY_CURRENT_SOUL_MISMATCH');
   if(receipt.phase==='completed'&&reading.ok&&['seated','sitting'].includes(me?.posture)&&held?.entity===binding.entityId&&(held.slot??(binding.slot==='seat'&&binding.seatCount===1?'seat':null))===binding.slot){result.status='setup-verified';result.me={soulId:me.soulId,pos:me.pos,posture:me.posture,seat:me.seat};break;}
   if(left()<=0)break;await sleep(Math.min(1000,left()));
  }while(left()>0);
  if(result.status!=='setup-verified')result.reason='exact-current-seat-not-observed-within-setup-bound';
 }catch(error){result.status='fail';result.failureCode=typeof error?.code==='string'?error.code:'OCCUPIED_SEAT_SETUP_FAILED';}
 privateUpdate(output,result);return result;
}
