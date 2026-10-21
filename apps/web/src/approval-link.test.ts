import test from 'node:test';import assert from 'node:assert/strict';
import {approvalFromHash,validApproval} from './approval-link.ts';
const id='ap_'+'a'.repeat(32),base={id,worldId:'world-one',agentLabel:'A label',name:'Avery',description:'',mode:'create',status:'pending',soulId:null,expiresAt:1000};
// The test name is the release gate's id from the older worlds' AccountApproval view (lane LAP replaced it with the card;
// the contract holds on the card's projection, join-api.ts approval()).
test('approval fragments and projections require exact world and actual readiness, without account-switch fallthrough',()=>{
 assert.equal(approvalFromHash('#approve/'+id),id);assert.equal(approvalFromHash('#approve/'+id+'/extra'),null);assert.equal(approvalFromHash('#pair/'+id),null);assert.equal(approvalFromHash('#approve/ap_short'),null);
 assert.ok(validApproval(base,id,'world-one'));assert.ok(validApproval(base,id),'the waiting list is already this world\'s');
 for(const diff of [{worldId:'world-two'},{id:'ap_'+'b'.repeat(32)},{status:'ready'},{soulId:'other-token'},{status:'invented'},{mode:'other'}])assert.equal(validApproval({...base,...diff},id,'world-one'),false,JSON.stringify(diff));
 assert.equal(validApproval(base,id,''),false,'a response that does not say its world is not this world');assert.equal(validApproval(null,id,'world-one'),false);
 assert.ok(validApproval({...base,status:'ready',soulId:'s_ready'},id,'world-one'));
});
