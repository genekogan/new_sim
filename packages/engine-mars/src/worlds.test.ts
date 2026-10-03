import test from 'node:test';import assert from 'node:assert/strict';
import {marsFactory,LITTLE_MARTIANS_WORLD,GREEN_FIELD_WORLD} from './engine.ts';
test('Little Martians: real server movement enters both buildings, reaches every floor, resumes mid-glide, and preserves humanoid limits',async()=>{
 const f=await marsFactory(LITTLE_MARTIANS_WORLD);let e=f.create(f.genesis('lm-world'));
 e.spawnHuman({id:'v',label:'Verdelis',soul:'sv'});e.spawnHuman({id:'human',label:'Human',soul:'sh'});
 assert.equal((e.world.entities.v as any).body.family,'floater');assert.equal((e.world.entities.human as any).body,undefined);
 const rooms=Object.values(e.world.regions).filter(r=>r.kind==='place');assert.equal(rooms.length,7);
 for(const room of rooms){
  const program={actor:'v',label:`visit ${room.id}`,steps:[{verb:'walk_to',params:{to:room.id}}]};
  const start=e.perform(program);assert.equal(start.ok,true,JSON.stringify(start));let complete=false,restored=false;
  for(let i=0;i<9000;i++){
   const out=e.step();if(i===100&&!restored){const snap=e.snapshot(),copy=f.restore(snap);assert.equal(copy.stateHash(),e.stateHash());e=copy;restored=true;}
   if(out.programs.some(p=>p.id===start.id&&p.kind==='completed')){complete=true;break;}
   const fail=out.programs.find(p=>p.id===start.id&&p.kind==='failed');assert.equal(fail,undefined,JSON.stringify(fail));
  }
  assert.equal(complete,true,`reached ${room.id}`);assert.equal(e.world.entities.v.human!.level,room.level);assert.deepEqual(e.runtime.violations,[]);
 }
 const no=e.canPerform({actor:'human',label:'upper tower',steps:[{verb:'walk_to',params:{to:'tower-L3'}}]});assert.ok(no);assert.match(no.code,/link-unusable|unreachable/);
 const hands=e.submit('take_item',{actor:'v',item:'missing',hand:'left'});assert.equal(hands.status,'failed');assert.match(hands.diagnostic!.code,/floater/);
 assert.equal((e.renderScene!() as any).buildings.length,2);assert.equal((e.renderScene!() as any).kin.length,6);
});
test('Eden genesis is a literal empty green field; an owner-born humanoid has no floater body',async()=>{
 const f=await marsFactory(GREEN_FIELD_WORLD);const e=f.create(f.genesis('green'));assert.equal(Object.keys(e.world.entities).length,0);
 e.spawnHuman({id:'e',label:'Eden',soul:'se'});for(let i=0;i<100;i++)e.step();assert.equal(e.world.entities.e.human!.activity,'idle');assert.equal((e.world.entities.e as any).body,undefined);assert.equal((e.renderScene!() as any).ground,'grass');assert.deepEqual(e.runtime.violations,[]);
});
