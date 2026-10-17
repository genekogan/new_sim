// upper-floors/1 (lane L4b): old Eden's office upper floors as one logged rules fact — install, no-op, refused while someone
// is upstairs, remove (the operator rollback), snapshot restore and genesis replay agree on every hash.
import test from 'node:test';import assert from 'node:assert/strict';
import {kernelHash} from '@sim/kernel';
import {fixture,accept,factory,invite} from '../test/native-owner-fixture.ts';import {WorldHost} from './world.ts';
// @ts-expect-error plain .mjs operator spec (pure)
import {officeFact} from '../../../tools/upper-floors/old-eden-office.mjs';

const ROOMS=['eden-office-1-floor-1','eden-office-1-floor-2','int-office-studio','int-office-upper-lounge'];
const levelsOf=(e:unknown)=>((e as {rt:{services:{spatial:{base:{levels:{id:number}[]}}}}}).rt.services.spatial.base.levels.map(l=>l.id));

void test('upper-floors/1: install, no-op, occupied refusal, remove; snapshot and genesis replay agree',async t=>{
  const f=fixture(':memory:',factory,{durableClockV1:true});f.brain.quiesce();t.after(()=>{f.host.stop();f.db.close();});
  await invite(f,'ada');const ada=await accept(f.host,f.souls.create('dev:ada',{name:'Ada',description:'walker'}));
  for(let i=0;i<10;i++)f.host.tickOnce();
  const e=f.host.engine as any,before=e.snapshot(),initialHash=e.stateHash(),fact=officeFact();
  assert.equal(e.world.upperFloorsV1,undefined);assert.ok(!levelsOf(e).includes(11));
  // malformed and remove-before-install are refused before admission, nothing logged
  const seq0=f.host.seq;
  assert.throws(()=>f.host.installUpperFloorsV1({version:'upper-floors/1'} as any),/upper-floors\.bad-fact/);
  assert.throws(()=>f.host.installUpperFloorsV1({version:'upper-floors/1',remove:'eden-office-1'}),/upper-floors\.not-installed/);
  const clash=structuredClone(fact);clash.building.levels[0].id=0;
  assert.throws(()=>f.host.installUpperFloorsV1(clash),/upper-floors\.bad-level/);
  assert.equal(f.host.seq,seq0);

  // install
  assert.deepEqual(await accept(f.host,f.host.installUpperFloorsV1(fact)),{installed:true});
  assert.equal(f.host.seq,seq0+1);
  assert.deepEqual(Object.keys(e.world.upperFloorsV1.buildings),['eden-office-1']);
  for(const id of ROOMS){assert.equal(e.world.regions[id]?.kind,'place',id);assert.ok(f.host.kernel.things[id],`kernel place ${id}`);}
  assert.ok(levelsOf(e).includes(11)&&levelsOf(e).includes(12),'office levels join the planner');
  assert.equal(e.placeLevelV1(11),1);assert.equal(e.placeLevelV1(12),2);assert.equal(e.placeLevelV1(1),1);

  // the same building again is a no-op (nothing logged, nothing changes); a different one under the same id is refused
  const seq1=f.host.seq,hash1=e.stateHash(),phys1=e.physicalHash(),kern1=kernelHash(f.host.kernel);
  assert.deepEqual(await f.host.installUpperFloorsV1(structuredClone(fact)),{installed:false});
  assert.equal(f.host.seq,seq1);assert.equal(e.stateHash(),hash1);assert.equal(e.physicalHash(),phys1);assert.equal(kernelHash(f.host.kernel),kern1);
  const other=structuredClone(fact);other.building.label='Another office';
  assert.throws(()=>f.host.installUpperFloorsV1(other),/upper-floors\.exists/);

  // remove is refused while a body is on one of the building's floors
  const body=e.ents[ada.entity_id],was=body.human.level;body.human.level=11;
  try{assert.throws(()=>f.host.installUpperFloorsV1({version:'upper-floors/1',remove:'eden-office-1'}),/upper-floors\.occupied: .*h_/);}
  finally{if(was===undefined)delete body.human.level;else body.human.level=was;}
  assert.equal(e.stateHash(),hash1);assert.equal(f.host.seq,seq1);

  for(let i=0;i<5;i++)f.host.tickOnce();
  f.host.saveSnapshot(true);
  const reboot=(label:string)=>{const seq=f.host.seq,hash=e.stateHash(),phys=e.physicalHash(),kern=kernelHash(f.host.kernel),levels=levelsOf(e).sort();
    for(const mode of ['snapshot','genesis']){
      if(mode==='genesis')f.db.db.prepare('DELETE FROM snapshots WHERE world_id=?').run(f.host.worldId);
      const h=new WorldHost(f.db,f.host.factory,f.host.seed,1e9,f.host.worldId,{durableClockV1:true});
      try{assert.equal(h.boot().from,mode,`${label} ${mode}`);assert.equal(h.seq,seq);assert.equal(h.engine.stateHash(),hash,`${label} ${mode} state`);
        assert.equal(h.engine.physicalHash(),phys,`${label} ${mode} physical`);assert.equal(kernelHash(h.kernel),kern,`${label} ${mode} kernel`);
        assert.deepEqual(levelsOf(h.engine).sort(),levels,`${label} ${mode} planner levels`);}
      finally{h.stop();}
    }
    f.host.saveSnapshot(true);};
  reboot('installed');

  // remove (operator rollback): rooms leave the map and the kernel, the levels leave the planner
  assert.deepEqual(await accept(f.host,f.host.installUpperFloorsV1({version:'upper-floors/1',remove:'eden-office-1'})),{installed:true});
  assert.equal(e.world.upperFloorsV1,undefined);
  for(const id of ROOMS){assert.equal(e.world.regions[id],undefined,id);assert.equal(f.host.kernel.things[id],undefined,id);}
  assert.ok(!levelsOf(e).includes(11)&&!levelsOf(e).includes(12));
  assert.throws(()=>f.host.installUpperFloorsV1({version:'upper-floors/1',remove:'eden-office-1'}),/upper-floors\.not-installed/);
  for(let i=0;i<5;i++)f.host.tickOnce();
  f.host.saveSnapshot(true);
  reboot('removed');

  // a pre-fact snapshot keeps its original hash (absent field)
  assert.equal(factory.restore(before).stateHash(),initialHash);
  assert.equal(f.db.paidCost(),0);
});
