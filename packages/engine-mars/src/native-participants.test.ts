import test from 'node:test';import assert from 'node:assert/strict';
import {marsFactory} from './engine.ts';
import {CAMP_ARRIVALS} from '../../../mars/viewer/engine/scenarios/eden-camp.ts';
test('native participant custody: exact construction crew/raw peers, unknown refusal and pure repeated reads',async()=>{
 const f=await marsFactory({scene:'eden-camp',arrival:CAMP_ARRIVALS[0].p,arrivalPlace:'yard',reference:CAMP_ARRIVALS[1].p,grounds:{id:'grounds',name:'Camp'}}),e=f.create(f.genesis('native-custody'));
 for(const [i,name]of ['A','B','C','D'].entries())e.spawnHuman({id:'h'+i,label:name,soul:'s'+i});
 const program={actor:'h0',label:'stage',steps:[{verb:'build_lookout',params:{phase:'stage'}}]},hash=e.stateHash();
 assert.deepEqual(e.nativeProgramParticipantsV1(program),['h0']);assert.deepEqual(e.nativeProgramParticipantsV1(program),['h0']);assert.equal(e.stateHash(),hash);
 assert.deepEqual(e.nativeProgramParticipantsV1({actor:'h0',label:'conversation',steps:[{verb:'converse',params:{with:'h1'}}]}),['h0','h1']);
 assert.deepEqual(e.nativeProgramParticipantsV1({actor:'h0',label:'warmup',steps:[{verb:'mars:group_warmup',params:{actors:['h0','h2']}}]}),['h0','h2']);
 assert.deepEqual(e.nativeProgramParticipantsV1({actor:'h0',label:'face only',steps:[{verb:'wave',params:{at:'h1'}}]}),['h0']);
 assert.equal(e.nativeProgramParticipantsV1({actor:'h0',label:'unknown',steps:[{verb:'unqualified-shared',params:{actors:['h1']}}]}),null);
 assert.equal(e.stateHash(),hash);
});
