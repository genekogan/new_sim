import test from 'node:test';import assert from 'node:assert/strict';
import {approvalFromHash,accountApproval} from './account-approval.ts';
const id='ap_'+'a'.repeat(32),base={id,worldId:'world-one',agentLabel:'A label',name:'Avery',description:'',mode:'create',status:'pending',soulId:null,expiresAt:1000};
test('approval fragments and projections require exact world and actual readiness, without account-switch fallthrough',()=>{
 assert.equal(approvalFromHash('#approve/'+id),id);assert.equal(approvalFromHash('#approve/'+id+'/extra'),null);assert.equal(approvalFromHash('#pair/'+id),null);assert.ok(accountApproval({approval:base},id,'world-one'));
 for(const diff of [{worldId:'world-two'},{id:'ap_'+'b'.repeat(32)},{status:'ready'},{soulId:'other-token'},{status:'invented'}])assert.equal(accountApproval({approval:{...base,...diff}},id,'world-one'),null);
 assert.equal(accountApproval({approval:{...base,status:'ready',soulId:'s_ready'}},id,'world-one')?.soulId,'s_ready');
});
