import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {pinContinuityPreparation,provisionContinuityPreparation,bindContinuityStaticRefs,composeContinuityInstructions,prepareContinuityActors,occupyContinuitySeat} from './continuity-prepare.mjs';
import {physicalGenesisSha256,physicalSnapshotSha256} from '../lib/physical-fixture.mjs';
const fixtures=JSON.parse(readFileSync(new URL('../scenarios/continuity/fixtures.json',import.meta.url)));
const matrix=JSON.parse(readFileSync(new URL('../scenarios/continuity/matrix.json',import.meta.url)));
const sha=x=>createHash('sha256').update(x).digest('hex');
const fixture=id=>structuredClone(fixtures.scenarios.find(s=>s.id===id));
const snapshot=()=>({constants:{},state:{},seed:'fresh',seq:1,defs:[{ref:'core-chair@1',hash:'a'.repeat(64),slots:[{id:'seat',kind:'seat',capacity:1}]}],defRefs:{'core/chair@1':'a'.repeat(64)},entities:[{id:'e_library',name:'eden-library-1',def:'core/chair@1',p:[74,0,-7],in:{parent:'world'}},{id:'e_sage',name:'library-armchair-sage',def:'core/chair@1',p:[1,0,1],in:{parent:'e_library'}}],ground:{extent:[-128,-128,128,128]}});
function source(t){
 const parent=realpathSync(mkdtempSync(join(tmpdir(),'continuity-prepare-')));t.after(()=>rmSync(parent,{recursive:true,force:true}));const root=join(parent,'root');mkdirSync(join(root,'worlds','templates'),{recursive:true});mkdirSync(join(root,'tools','playtest'),{recursive:true});
 const genesis={schema:'world-ops/1',constants:{},state:{},batches:[]};writeFileSync(join(root,'worlds/templates/frozen.json'),JSON.stringify(genesis));writeFileSync(join(root,'tools/playtest/source.mjs'),'// pinned\n');
 mkdirSync(join(root,'mars','viewer','engine','locomotion'),{recursive:true});writeFileSync(join(root,'mars/viewer/engine/locomotion/walk.ts'),'// pinned native engine\n');
 const files=['worlds/templates/frozen.json','tools/playtest/source.mjs','mars/viewer/engine/locomotion/walk.ts'].map(path=>({path,sha256:sha(readFileSync(join(root,path)))}));const revision='1'.repeat(40);
 const readGit=(_,args)=>args[0]==='rev-parse'?revision:args[0]==='status'?'':files.map(f=>f.path).join('\n');
 const pin=pinContinuityPreparation({serverRoot:root,revision,files,genesisPath:files[0].path,genesisPhysicalSha256:physicalGenesisSha256(genesis)},{readGit});
 return {parent,root,files,readGit,pin};
}
async function prepared(t){const s=source(t),directory=join(s.parent,'trial'),calls=[];const value=await provisionContinuityPreparation({directory,pin:s.pin,world:{slug:'pt-fresh',port:4999,genesis:s.pin.genesisPath}}, {readGit:s.readGit,now:()=>1000,provisionWorld:async input=>{calls.push(input);return {base:'http://127.0.0.1:4999/w/pt-fresh',pid:1234};},readSnapshot:async()=>snapshot()});return {...s,...value,calls};}

test('source pins require exact clean tracked bytes and physical genesis',t=>{
 const s=source(t);assert.equal(s.pin.revision,'1'.repeat(40));
 assert.throws(()=>pinContinuityPreparation(s.pin,{readGit:()=> 'wrong'}),{code:'SOURCE_PIN_NOT_CLEAN'});
 writeFileSync(join(s.root,'tools/playtest/source.mjs'),'changed');assert.throws(()=>pinContinuityPreparation(s.pin,{readGit:s.readGit}),{code:'SOURCE_PIN_HASH_MISMATCH'});
 assert.throws(()=>pinContinuityPreparation({...s.pin,files:[{path:'../private',sha256:'a'.repeat(64)}],genesisPath:'../private'},{readGit:s.readGit}),{code:'INVALID_SOURCE_PIN_PATH'});
});

test('provision saves an independently hashed body-free snapshot before pairing, refusing existing output',async t=>{
 const p=await prepared(t);assert.ok(existsSync(join(p.directory,'initial-body-free.json')));assert.equal(p.manifest.pairingStartedAt,null);assert.equal(p.manifest.initialSnapshot.physicalSha256,physicalSnapshotSha256(snapshot()));assert.equal(p.calls[0].world.natives,false);assert.equal(p.manifest.worldId,'pt-fresh-1');
 let started=false;await assert.rejects(provisionContinuityPreparation({directory:p.directory,pin:p.pin,world:{slug:'pt-fresh',port:4999,genesis:p.pin.genesisPath}},{readGit:p.readGit,readSnapshot:async()=>snapshot(),provisionWorld:async()=>{started=true;}}),{code:'PREPARATION_DIRECTORY_EXISTS'});assert.equal(started,false);
});

test('body-bearing initial state fails before any pairing and cleans only its exact owned world',async t=>{
 const s=source(t),stopped=[],bad=snapshot();bad.entities.push({id:'h_old',def:'core-humanoid'});
 await assert.rejects(provisionContinuityPreparation({directory:join(s.parent,'bad'),pin:s.pin,world:{slug:'pt-fresh',port:4999,genesis:s.pin.genesisPath}}, {readGit:s.readGit,provisionWorld:async()=>({base:'http://127.0.0.1:4999/w/pt-fresh',pid:777}),readSnapshot:async()=>bad,stopOwnedWorld:async({pid})=>{stopped.push(pid);return {stopped:true};}}),/no Soul bodies/);
 assert.deepEqual(stopped,[777]);assert.equal(JSON.parse(readFileSync(join(s.parent,'bad','preparation-failure.json'))).ownedWorldStopped,true);
});

test('static binding preserves shared sofa entity with three distinct slots and unknown discovery',()=>{
 const f=fixture('mars-presentation-four'),s=snapshot();s.entities=[{id:'e_sofa',name:'navy-sofa',def:'core/chair@1',p:[-10,0,-24],in:{parent:'world'}}];s.defs[0].slots=[1,2,3].map(i=>({id:'seat-'+i,kind:'seat',capacity:1}));
 const result=bindContinuityStaticRefs({fixture:f,snapshot:s,worldId:'fresh_world',boundAt:1000,evidence:['body-free.json']});
 assert.equal(result.status,'unknown');for(let i=1;i<=3;i++){const b=result.bindings['navy-sofa#seat-'+i];assert.equal(b.entityId,'e_sofa');assert.equal(b.slot,'seat-'+i);assert.equal(b.exactSlotVerified,true);assert.equal(b.nativeAvailability,'unknown');}
 assert.ok(result.missing.some(x=>x.includes('presenter-timber-box')));
});

test('missing, duplicate or cyclic static paths never pick an arbitrary fixture',()=>{
 const f=fixture('eden-reading-duo'),s=snapshot();s.entities.push({...s.entities[1],id:'another'});assert.throws(()=>bindContinuityStaticRefs({fixture:f,snapshot:s,worldId:'world',boundAt:1,evidence:['snapshot']}),{code:'AMBIGUOUS_STATIC_REF'});
 const cycle=snapshot();cycle.entities[0].in.parent='e_sage';assert.throws(()=>bindContinuityStaticRefs({fixture:f,snapshot:cycle,worldId:'world',boundAt:1,evidence:['snapshot']}),{code:'STATIC_PARENT_CYCLE'});
});

test('an explicit retired definition ref cannot supply an old seat slot',()=>{
 const s=snapshot();delete s.defRefs['core/chair@1'];const r=bindContinuityStaticRefs({fixture:fixture('eden-reading-duo'),snapshot:s,worldId:'world',boundAt:1,evidence:['snapshot']});assert.equal(r.bindings['eden-library-1/library-armchair-sage'].exactSlotVerified,false);assert.equal(r.status,'unknown');
});

test('all four frozen tasks include identical roster/shared/errand/role supplements and retain clock placeholders',()=>{
 for(const m of matrix.scenarios){const f=fixture(m.id),roster=f.actors.map(a=>({actorId:a.id,soulId:'s_'+a.id,publicName:a.soulName,evidence:['status#'+a.id]}));const args={matrixScenario:m,fixture:f,roster,fixtureRoster:[{publicName:'FixtureSeat',role:'fixture-only occupant',evidence:['status#fixture']}]};const a=composeContinuityInstructions(args),b=composeContinuityInstructions(args);assert.equal(a.paritySha256,b.paritySha256);
  for(const row of a.actors){const original=f.actors.find(x=>x.id===row.id);assert.ok(row.instruction.includes(f.initialConstraintSupplement));assert.ok(row.instruction.includes(original.originalErrand.initialOwnerSupplement));assert.ok(row.instruction.includes('{meetingUTC}'));for(const actor of f.actors)assert.ok(row.instruction.includes(actor.soulName));assert.ok(!row.instruction.includes(roster[0].soulId));if(original.initialOwnerSupplement)assert.ok(row.instruction.includes(original.initialOwnerSupplement));}
  if(m.id==='mars-presentation-four')assert.ok(a.actors[0].instruction.includes('three invited guests'));
 }
});

test('task composition refuses silently renamed actors or missing errand facts',()=>{
 const f=fixture('eden-reading-duo'),m=matrix.scenarios.find(s=>s.id===f.id),roster=f.actors.map(a=>({actorId:a.id,soulId:'s_'+a.id,publicName:a.soulName,evidence:['status']}));roster[0].publicName='Different';assert.throws(()=>composeContinuityInstructions({matrixScenario:m,fixture:f,roster}),{code:'INVALID_CONTINUITY_ROSTER'});roster[0].publicName=f.actors[0].soulName;delete f.actors[0].originalErrand;assert.throws(()=>composeContinuityInstructions({matrixScenario:m,fixture:f,roster}),{code:'INVALID_CONTINUITY_ROSTER'});
});

test('mechanical actor preparation reuses real native setup helper without models or status-secret persistence',async t=>{
 const p=await prepared(t),calls=[];
 const {result,seats}=await prepareContinuityActors({directory:p.directory,fixture:fixture('eden-reading-duo')},{readGit:p.readGit,now:()=>2000,seatFactory:({seat,worldBase})=>({folder:join(p.directory,'fake-'+seat.id),chain:Promise.resolve(),assistPair:async name=>{assert.equal(existsSync(join(p.directory,'initial-body-free.json')),true);calls.push(['pair',name]);},status:async()=>({ok:true,data:{world:worldBase,paired:true,soul:{id:'s_'+seat.id,name:seat.soulName},token:'DO_NOT_PERSIST'}}),fixtureCliJson:async args=>{calls.push(args);return args[0]==='here'?{ok:true,data:{me:{pos:seat.id==='reader-a'?[0,0]:[.8,.4],heading:0,posture:'standing'}}}:{ok:true,data:{accepted:true,receipt:{id:'r_'+calls.length,phase:'completed'}}};}})});
 assert.equal(result.status,'unknown');assert.equal(result.qualificationReady,false);assert.equal(seats.size,2);assert.ok(result.actors.every(r=>r.status==='setup-verified'));assert.equal(calls.filter(x=>x[0]==='act').length,6);assert.ok(!readFileSync(join(p.directory,'actor-preparation.json'),'utf8').includes('DO_NOT_PERSIST'));
 await assert.rejects(prepareContinuityActors({directory:p.directory,fixture:fixture('eden-reading-duo')},{readGit:p.readGit}),{code:'INVALID_ACTOR_PREPARATION'});
});

test('altered prepair snapshot cannot be paired or become ready',async t=>{
 const p=await prepared(t);writeFileSync(join(p.directory,'initial-body-free.json'),'{}');let paired=false;await assert.rejects(prepareContinuityActors({directory:p.directory,fixture:fixture('eden-reading-duo')},{readGit:p.readGit,seatFactory:()=>{paired=true;}}),{code:'PREPAIR_SNAPSHOT_CHANGED'});assert.equal(paired,false);
});

function occupancy(t,extra={}){const dir=realpathSync(mkdtempSync(join(tmpdir(),'continuity-occupancy-')));t.after(()=>rmSync(dir,{recursive:true,force:true}));const config={runDir:dir,occupant:{actorId:'seat-occupant',soulId:'s_fixture',worldId:'world',worldBase:'http://127.0.0.1:4999/w/fixture',evidence:['actor-preparation.json#seat-occupant']},fixture:fixture('eden-reading-duo'),binding:{ref:'eden-library-1/library-armchair-sage',worldId:'world',entityId:'e_sage',slot:'seat',seatCount:1,evidence:['bound#sage']},discovery:{worldId:'world',entityId:'e_sage',slot:'seat',capability:'sit:exact-native-local',params:['seconds'],observedAt:0,evidence:['native-doHere#exact']},...extra};if(config.seat)config.seat.status??=async()=>({ok:true,data:{paired:true,world:config.occupant.worldBase,soul:{id:config.occupant.soulId},privateCanary:'DO_NOT_PERSIST'}});return config;}

test('occupancy uses one supplied native capability with one second, completed receipt and exact current held slot',async t=>{
 const calls=[],args=occupancy(t,{seat:{fixtureCliJson:async a=>{calls.push(a);return a[0]==='act'?{ok:true,data:{accepted:true,receipt:{id:'r_seat',phase:'completed',chosen:{target:'e_sage'}}}}:{ok:true,data:{me:{soulId:'s_fixture',pos:[75,-4],posture:'seated',seat:'e_sage#seat'}}};}}});const r=await occupyContinuitySeat(args,{now:()=>1000});assert.equal(r.status,'setup-verified');assert.equal(r.receiptId,'r_seat');assert.equal(r.occupant.soulId,'s_fixture');assert.equal(r.identityProof.soulId,'s_fixture');assert.equal(r.me.soulId,'s_fixture');assert.ok(!readFileSync(join(args.runDir,'occupied-seat-preparation.json'),'utf8').includes('DO_NOT_PERSIST'));assert.equal(calls[0][1],'sit:exact-native-local');assert.deepEqual(JSON.parse(calls[0][2]),{seconds:1});assert.equal(calls.filter(x=>x[0]==='act').length,1);
 await assert.rejects(occupyContinuitySeat(args,{now:()=>1000}),{code:'EEXIST'});assert.equal(calls.filter(x=>x[0]==='act').length,1);
});

test('unresolved or conflicting occupancy capability never invents an entity-ID capability',async t=>{
 let called=false;const args=occupancy(t,{discovery:undefined,seat:{fixtureCliJson:async()=>{called=true;}}});const r=await occupyContinuitySeat(args,{now:()=>1000});assert.equal(r.status,'unknown');assert.equal(called,false);
 const other=occupancy(t,{seat:{fixtureCliJson:async()=>{called=true;}}});other.discovery.entityId='wrong';await assert.rejects(occupyContinuitySeat(other,{now:()=>1000}),{code:'NATIVE_OCCUPANCY_CAPABILITY_MISMATCH'});assert.equal(called,false);
 const noDuration=occupancy(t,{seat:{fixtureCliJson:async()=>{called=true;}}});noDuration.discovery.params=[];assert.equal((await occupyContinuitySeat(noDuration,{now:()=>1000})).status,'unknown');assert.equal(called,false);
});

test('occupancy timeout with wrong native seat remains unknown and never substitutes or resends',async t=>{
 let now=1000,acts=0;const args=occupancy(t,{seat:{fixtureCliJson:async a=>a[0]==='act'?(acts++,{ok:true,data:{accepted:true,receipt:{id:'r_hold',phase:'completed'}}}):{ok:true,data:{me:{soulId:'s_fixture',posture:'seated',seat:'e_other#seat'}}}}});const r=await occupyContinuitySeat(args,{now:()=>now,sleep:async ms=>{now+=ms;}});assert.equal(r.status,'unknown');assert.equal(acts,1);assert.ok(r.observedAt>=240000&&r.observedAt<=241000);
});

test('a started occupancy receipt cannot pass even when the body is already seated',async t=>{
 let now=1000,reads=0;const args=occupancy(t,{seat:{fixtureCliJson:async a=>a[0]==='act'?{ok:true,data:{accepted:true,receipt:{id:'r_hold',phase:'started'}}}:a[0]==='receipt'?(reads++,{ok:true,data:{id:'r_hold',phase:'started'}}):{ok:true,data:{me:{soulId:'s_fixture',posture:'seated',seat:'e_sage#seat'}}}}});const r=await occupyContinuitySeat(args,{now:()=>now,sleep:async ms=>{now+=ms;}});assert.equal(r.status,'unknown');assert.equal(r.receipt.phase,'started');assert.ok(reads>0);
});

test('failed exact native start stops preparation without pairing the next actor',async t=>{
 const p=await prepared(t),paired=[];const {result}=await prepareContinuityActors({directory:p.directory,fixture:fixture('eden-reading-duo')},{readGit:p.readGit,now:()=>2000,seatFactory:({seat,worldBase})=>({folder:join(p.directory,'fake-'+seat.id),assistPair:async()=>paired.push(seat.id),status:async()=>({ok:true,data:{world:worldBase,paired:true,soul:{id:'s_'+seat.id,name:seat.soulName}}})}),setup:async()=>({ok:false,me:{pos:[29,29],heading:0,posture:'standing'},actions:[]})});assert.equal(result.status,'fail');assert.equal(result.qualificationReady,false);assert.deepEqual(paired,['reader-a']);assert.equal(result.actors[0].failureCode,'NATIVE_START_SETUP_FAILED');
});


test('native engine source is explicitly pinnable without allowing unrelated Mars files',t=>{
 const s=source(t);assert.ok(s.pin.files.some(f=>f.path==='mars/viewer/engine/locomotion/walk.ts'));
 assert.throws(()=>pinContinuityPreparation({...s.pin,files:[...s.pin.files,{path:'mars/private-config',sha256:'a'.repeat(64)}]},{readGit:s.readGit}),{code:'INVALID_SOURCE_PIN_PATH'});
});
for(const wrong of ['participant','world'])test('wrong occupied-seat context cannot issue a native act: '+wrong,async t=>{
 let acts=0;const args=occupancy(t,{seat:{status:async()=>({ok:true,data:{paired:true,world:wrong==='world'?'http://127.0.0.1:4999/w/another':'http://127.0.0.1:4999/w/fixture',soul:{id:wrong==='participant'?'s_reader_a':'s_fixture'}}}),fixtureCliJson:async()=>{acts++;assert.fail('mismatched context must not act');}}});
 const r=await occupyContinuitySeat(args,{now:()=>1000});assert.equal(r.status,'fail');assert.equal(r.failureCode,'OCCUPANT_CONTEXT_MISMATCH');assert.equal(acts,0);
});
test('occupied-seat proof requires fixture-only binding and matching authenticated current Soul',async t=>{
 const args=occupancy(t,{seat:{fixtureCliJson:async a=>a[0]==='act'?{ok:true,data:{accepted:true,receipt:{id:'r_seat',phase:'completed'}}}:{ok:true,data:{me:{soulId:'s_wrong',posture:'seated',seat:'e_sage#seat'}}}}});
 const r=await occupyContinuitySeat(args,{now:()=>1000});assert.equal(r.status,'fail');assert.equal(r.failureCode,'OCCUPANCY_CURRENT_SOUL_MISMATCH');
 const participant=occupancy(t,{occupant:{actorId:'reader-a',soulId:'s_reader_a',worldId:'world',worldBase:'http://127.0.0.1:4999/w/fixture',evidence:['status']},seat:{fixtureCliJson:async()=>assert.fail('participant cannot be the fixture occupant')}});await assert.rejects(occupyContinuitySeat(participant,{now:()=>1000}),{code:'INVALID_OCCUPIED_SEAT_SETUP'});
});
