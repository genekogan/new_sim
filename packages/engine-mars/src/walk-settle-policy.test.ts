import test from 'node:test';
import assert from 'node:assert/strict';
import {marsFactory,MARS_2026_MAP} from './index.ts';
const factory=await marsFactory({scene:'eden-camp',arrival:[-3,18],arrivalPlace:'arrival',reference:[-1,17],grounds:{id:'grounds',name:'Grounds'},map:MARS_2026_MAP,disassemblyV1:true});
test('rejected native walk-settle policy leaves canonical snapshot/hash and service flag unchanged',()=>{
 const engine=factory.create(factory.genesis('reject-walk-settle'));
 const beforeHash=engine.stateHash(),beforeSnapshot=JSON.stringify(engine.snapshot());
 for(const policy of [
  {walkSettleWaitV1:true,sleepBlockTicks:0},
  {walkSettleWaitV1:true,sleepBlockTicks:1200,quietSeatCourtesy:'invalid' as unknown as boolean},
 ]){
  assert.throws(()=>engine.configureRuntimePolicy!(policy),/runtime-policy\.(sleep-limit|quiet-seat-courtesy)/);
  assert.equal(engine.stateHash(),beforeHash,'refused new flag cannot change canonical identity');
  assert.equal(JSON.stringify(engine.snapshot()),beforeSnapshot,'refused policy cannot become persisted state');
  assert.equal((engine as any).rt.services.walkSettleWaitV1,undefined);
 }
 engine.configureRuntimePolicy!({walkSettleWaitV1:true,sleepBlockTicks:1200});
 assert.notEqual(engine.stateHash(),beforeHash);assert.equal((engine as any).rt.services.walkSettleWaitV1,true);
 assert.deepEqual(engine.runtime.violations,[]);
});
