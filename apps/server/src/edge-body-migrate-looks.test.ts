import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fixture,invite,accept,factory} from '../test/native-owner-fixture.ts';
import {WorldHost} from './world.ts';
import {Db,type SoulRow} from './db.ts';
import {EdgeLedger} from './edge/ledger/ledger.ts';
import {migrateLegacyLooks,planLegacyLooks,rollbackLegacyLooks,runLegacyLookMaintenance} from './edge/body/migrate-looks.ts';
import {lookBody,legacyPreset,resolveLook} from '../../web/src/humanoid/look.ts';
import {legacyLook} from '../../web/src/humanoid/legacy.ts';
import {bodyProfile} from '../../../mars/viewer/engine/bodies/navigation.ts';
import {HUMAN_PROFILE} from '../../../mars/viewer/engine/spatial/types.ts';
import {SOCIAL_PUBLIC_ASSIGNMENTS} from '../../../mars/viewer/app/engine-view/content/details/human-presets/presets.mjs';

async function setup(t:any,n=3) {
  const dir=mkdtempSync(join(tmpdir(),'legacy-looks-')),path=join(dir,'sim.db');
  const f=fixture(path,factory,{durableClockV1:true});f.brain.quiesce();
  const ledger=new EdgeLedger(f.host,f.db,undefined,{ambient:false});
  t.after(()=>{f.host.stop();if(f.db.db.isOpen)f.db.close();rmSync(dir,{recursive:true,force:true});});
  const rows:SoulRow[]=[];for(let i=0;i<n;i++){await invite(f,'legacy'+i);rows.push(await accept(f.host,f.souls.create('dev:legacy'+i,{name:'Legacy '+i,description:'migration fixture'})));}
  const entity=(i:number)=>f.host.engine.world.entities[rows[i].entity_id];
  const assign=(i:number,body:any)=>accept(f.host,f.host.enqueueChecked('body-assignment-v1','world:body',{contract:'body-assignment/1',worldId:f.host.worldId,soulId:rows[i].id,entityId:rows[i].entity_id,body},()=>true,()=>true));
  return {f,path,ledger,rows,entity,assign};
}
test('legacy looks: dry-run is read-only; exact defaults, skipped explicit bodies, atomic receipts, idempotence and snapshot/genesis replay',async t=>{
  const w=await setup(t,5),{f,ledger}=w;
  await w.assign(3,lookBody({preset:'woman',height:1.8,build:1.08}));
  const floater={family:'floater',type:'ceramic',model:'verdelis',modelUrl:'/world-assets/littlemartians/characters/verdelis.glb',radius:.35,hoverHeight:1.45};
  await w.assign(4,floater);
  const before=f.host.seq,plan=planLegacyLooks(f.host,f.db);
  assert.equal(plan.planned.length,3);assert.equal(plan.skipped.length,2);
  assert.deepEqual((await migrateLegacyLooks(f.host,f.db,ledger)).migrated,[]);
  assert.equal(f.host.seq,before);assert.equal(f.db.db.prepare("SELECT 1 FROM sqlite_master WHERE name='legacy_looks_v1'").get(),undefined);
  assert.equal(w.entity(0).body,undefined);
  const run=await accept(f.host,migrateLegacyLooks(f.host,f.db,ledger,{dryRun:false}));
  assert.equal(run.migrated.length,3);assert.deepEqual(run.deferred,[]);assert.equal(f.host.seq,before+3);
  for(let i=0;i<3;i++){
    assert.deepEqual(w.entity(i).body,lookBody({preset:legacyPreset(w.rows[i].entity_id)}));
    assert.equal(bodyProfile(w.entity(i) as never),HUMAN_PROFILE);
  }
  assert.equal(w.entity(3).body?.params?.height,1.8);assert.deepEqual(w.entity(4).body,floater);
  const receipts=f.db.db.prepare('SELECT seq FROM legacy_looks_v1').all() as {seq:number}[];
  assert.equal(receipts.length,3);for(const r of receipts)assert.equal(f.db.events(f.host.worldId,r.seq-1,1)[0].kind,'body-assignment-v1');
  assert.equal((await migrateLegacyLooks(f.host,f.db,ledger,{dryRun:false})).planned.length,0);
  const kept=structuredClone(w.entity(0).body);f.host.saveSnapshot(true);f.host.stop();f.db.close();
  for(const mode of ['snapshot','genesis']){
    const db=new Db(w.path);if(mode==='genesis')db.db.exec('DELETE FROM snapshots');
    const host=new WorldHost(db,factory,f.host.seed,1e9,f.host.worldId,{durableClockV1:true});host.boot();
    assert.deepEqual(host.engine.world.entities[w.rows[0].entity_id].body,kept,mode);
    const edge=new EdgeLedger(host,db,undefined,{ambient:false});
    if(mode==='genesis'){
      const undo=await accept(host,rollbackLegacyLooks(host,db,edge,{dryRun:false}));assert.equal(undo.restored.length,3);
      assert.equal(host.engine.world.entities[w.rows[0].entity_id].body,undefined);
      assert.equal((await rollbackLegacyLooks(host,db,edge,{dryRun:false})).planned.length,0);
      host.saveSnapshot(true);
    }
    host.stop();db.close();
  }
  const db=new Db(w.path);db.db.exec('DELETE FROM snapshots');
  const host=new WorldHost(db,factory,f.host.seed,1e9,f.host.worldId,{durableClockV1:true});host.boot();
  assert.equal(host.engine.world.entities[w.rows[0].entity_id].body,undefined,'compensation replays from genesis');host.stop();db.close();
});
test('legacy looks: current social palettes are explicit, template drift and Simple mode preserve classic defaults',()=>{
  for(const preset of ['casual','punk','woman']){
    const id=Array.from({length:30},(_,i)=>'legacy'+i).find(id=>legacyPreset(id)===preset)!;
    assert.deepEqual(resolveLook(lookBody(legacyLook(id)).params),resolveLook({preset}));
  }
  for(const row of SOCIAL_PUBLIC_ASSIGNMENTS as readonly {actorId:string;stableSoulKey:string;template:string}[]){
    const look=legacyLook(row.actorId,row.stableSoulKey,true);
    if(legacyPreset(row.actorId)===row.template)assert.equal(look.preset,'none');
    assert.deepEqual(legacyLook(row.actorId,row.stableSoulKey,false),resolveLook({preset:legacyPreset(row.actorId)}));
    const drift=Array.from({length:30},(_,i)=>'drift'+i).find(id=>legacyPreset(id)!==row.template)!;
    assert.deepEqual(legacyLook(drift,row.stableSoulKey,true),resolveLook({preset:legacyPreset(drift)}));
    assert.equal(look.height,1.75);assert.equal(look.build,1);
  }
});
test('legacy looks: faded, committed, physically busy and quiet residents defer without interrupting them',async t=>{
  const w=await setup(t,3),{f,ledger}=w;
  ledger.faded.add(w.rows[0].id);
  f.db.db.prepare("INSERT INTO edge_receipts_v1(world_id,receipt_id,soul_id,capability,phase,accepted_tick,created_at) VALUES(?,?,?,'stand:here','started',0,0)").run(f.host.worldId,'held',w.rows[1].id);
  const human=(w.entity(2) as any).human;human.activity='sit';
  const seq=f.host.seq,run=await migrateLegacyLooks(f.host,f.db,ledger,{dryRun:false});
  assert.equal(run.deferred.length,3);assert.equal(f.host.seq,seq);assert.equal(human.activity,'sit');
  human.activity='idle';ledger.faded.clear();f.db.db.exec('DELETE FROM edge_receipts_v1');
  const barrier=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(f.host),'quietBarrier');
  Object.defineProperty(f.host,'quietBarrier',{configurable:true,value:true});
  assert.equal((await migrateLegacyLooks(f.host,f.db,ledger,{dryRun:false})).deferred.length,3);
  delete (f.host as any).quietBarrier;assert.ok(barrier?.get);
});
test('legacy looks: unsupported engine, stale owner/kernel binding and queued retirement never admit an event',async t=>{
  const w=await setup(t,1),{f,ledger}=w,seq=f.host.seq;
  const check=f.host.engine.bodyAssignmentProblemV1;f.host.engine.bodyAssignmentProblemV1=undefined;
  assert.equal((await migrateLegacyLooks(f.host,f.db,ledger,{dryRun:false})).deferred[0].reason,'body.unavailable');
  f.host.engine.bodyAssignmentProblemV1=check;
  const mind=f.host.minds.get(w.rows[0].id)!;mind.owner='different';
  assert.equal((await migrateLegacyLooks(f.host,f.db,ledger,{dryRun:false})).deferred[0].reason,'body.authority-changed');mind.owner=w.rows[0].owner;
  const run=migrateLegacyLooks(f.host,f.db,ledger,{dryRun:false});
  f.db.db.prepare('UPDATE souls SET retired_at=1 WHERE id=?').run(w.rows[0].id);
  assert.equal((await accept(f.host,run)).deferred[0].reason,'body.authority-changed');assert.equal(f.host.seq,seq);
});
test('legacy looks: receipt write failure rolls back the event, and rollback preserves later owner assignments including identical bytes',async t=>{
  const w=await setup(t,2),{f,ledger}=w;
  ledger.faded.add(w.rows[1].id);
  await accept(f.host,migrateLegacyLooks(f.host,f.db,ledger,{dryRun:false}));ledger.faded.clear();
  const kept=structuredClone(w.entity(0).body);await w.assign(0,kept);
  const seq=f.host.seq;
  f.db.db.exec("CREATE TRIGGER reject_look_receipt BEFORE INSERT ON legacy_looks_v1 BEGIN SELECT RAISE(ABORT,'receipt unavailable'); END");
  assert.equal((await accept(f.host,migrateLegacyLooks(f.host,f.db,ledger,{dryRun:false}))).deferred.length,1);
  assert.equal(f.host.seq,seq);assert.equal(w.entity(1).body,undefined);
  f.db.db.exec('DROP TRIGGER reject_look_receipt');
  assert.equal((await accept(f.host,migrateLegacyLooks(f.host,f.db,ledger,{dryRun:false}))).migrated.length,1);
  const plan=await rollbackLegacyLooks(f.host,f.db,ledger);assert.equal(plan.deferred[0].reason,'body.changed');assert.equal(w.entity(1).body?.family,'humanoid');
  const undo=await accept(f.host,rollbackLegacyLooks(f.host,f.db,ledger,{dryRun:false}));
  assert.equal(undo.restored.length,1);assert.equal(undo.deferred[0].reason,'body.changed');assert.deepEqual(w.entity(0).body,kept);
});
test('legacy looks: boot maintenance is opt-in and requires an explicit existing-viewer palette',async t=>{
  const w=await setup(t,1),{f,ledger}=w;
  assert.equal(await runLegacyLookMaintenance(f.host,f.db,ledger,{}),undefined);
  await assert.rejects(runLegacyLookMaintenance(f.host,f.db,ledger,{LEGACY_LOOKS_MODE:'apply'}),/explicit-viewer-palette/);
  await assert.rejects(runLegacyLookMaintenance(f.host,f.db,undefined,{LEGACY_LOOKS_MODE:'apply'}),/edge-required/);
  const plan=await runLegacyLookMaintenance(f.host,f.db,ledger,{LEGACY_LOOKS_MODE:'plan',LEGACY_LOOKS_SOCIAL_PRESETS:'0'});
  assert.equal((plan as any).planned.length,1);assert.equal(w.entity(0).body,undefined);
});
