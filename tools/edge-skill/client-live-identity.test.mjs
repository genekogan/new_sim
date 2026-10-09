import test from 'node:test';
import assert from 'node:assert/strict';
import {openLiveSoulEvidence} from './client-live-identity.mjs';
import {openClientConversations} from './client-conversations.mjs';
import {bindLiveSoulReferences} from './client-execution.mjs';
const worldId='identity-world',scope='https://fixture.invalid/w/eden|s_self';
const view={id:'cv_group',state:'open',role:'member',members:[{soulId:'s_self',name:'Self'},{soulId:'s_peer',name:'Exact Peer'}],invited:[{soulId:'s_invited',name:'Invited Peer'}],asks:[],turns:0};
function fixture({near=[],response={status:200,data:{near:[]}}}={}){
 let clock=1000;const calls=[];const group=openClientConversations({scope,soulId:'s_self',name:'Self'});
 const evidence=openLiveSoulEvidence({worldId,scope,here:()=>({near}),conversations:()=>group.snapshot(),now:()=>clock,call:async path=>{calls.push(path);return response;}});
 return {group,evidence,calls,advance:ms=>clock+=ms};
}
test('actual owned conversation producer supplies remote member and invited full identities without capability fetch or presence inference',()=>{
 const f=fixture();f.group.reconcile({conversations:[view]});
 const result=bindLiveSoulReferences([{name:'Exact Peer'},{name:'Invited Peer'}],{ownerText:'Meet Exact Peer and Invited Peer.',resolve:refs=>f.evidence.resolve(refs)});
 assert.equal(result.ok,true);assert.deepEqual(result.chosen.map(p=>p.id),['s_peer','s_invited']);assert.deepEqual(f.calls,[]);
 assert.equal(result.chosen[0].provenance[0].kind,'conversation-participants');assert.match(result.chosen[0].availability,/admission remains server-owned/);
 f.group.reconcile({conversations:[]});assert.equal(f.evidence.resolve(['Exact Peer']).code,'soul.reference-unavailable');
});
test('missing exact identity uses only lean existing here projection, cache expires, and similar old names do not substitute',async()=>{
 const f=fixture({near:[{id:'s_old',name:'Old Peer'}],response:{status:200,data:{here:{near:[{id:'s_fresh',name:'Fresh Peer'}],objects:[]}}}});
 assert.equal(f.evidence.resolve(['Fresh Peer']).ok,false);await f.evidence.refresh();
 assert.deepEqual(f.calls,['/v1/edge/here']);assert.equal(f.evidence.resolve(['Fresh Peer']).chosen[0].id,'s_fresh');
 const wrong=bindLiveSoulReferences(['s_old'],{ownerText:'Meet Fresh Peer.',resolve:refs=>f.evidence.resolve(refs)});assert.equal(wrong.code,'identity.owner-binding-required');
 assert.equal(f.evidence.refreshDue(),false);f.advance(5001);assert.equal(f.evidence.resolve(['Fresh Peer']).ok,false);assert.equal(f.evidence.refreshDue(),true);
});
test('failed refresh, unknown world/scope, malformed or conflicting participant identities fail closed without broad fallback',async()=>{
 const f=fixture({response:{status:404,data:{}}});await assert.rejects(f.evidence.refresh(),/unavailable/);assert.deepEqual(f.calls,['/v1/edge/here']);
 assert.equal(f.evidence.resolve(['Missing']).ok,false);
 const conflict=fixture({near:[{id:'s_peer',name:'Another Name'}]});conflict.group.reconcile({conversations:[view]});assert.equal(conflict.evidence.resolve(['Exact Peer']).code,'soul.roster-conflict');
 const wrongScope=openLiveSoulEvidence({worldId,scope:'different',call:async()=>{},here:()=>({near:[]}),conversations:()=>f.group.snapshot()});assert.throws(()=>wrongScope.resolve(['Missing']),/scope mismatch/);
 const noWorld=openLiveSoulEvidence({scope,call:async()=>{},here:()=>({near:[]}),conversations:()=>f.group.snapshot()});assert.equal(noWorld.resolve(['Missing']).code,'soul.scope-required');
});

test('current and refreshed here preserve reassigned-name flag and owner name-only intent cannot be repaired with model-invented ID',async()=>{for(const refresh of [false,true]){const row={id:'s_current',name:'Earlier Name',nameAmbiguous:true};const f=fixture({near:refresh?[]:[row],response:{status:200,data:{here:{near:[row]}}}});if(refresh)await f.evidence.refresh();assert.equal(f.evidence.resolve(['Earlier Name']).code,'soul.name-ambiguous');const resolve=refs=>f.evidence.resolve(refs);assert.equal(bindLiveSoulReferences([{id:'s_current',name:'Earlier Name'}],{ownerText:'Meet Earlier Name.',resolve}).code,'identity.reassigned-name');assert.equal(bindLiveSoulReferences(['s_current'],{ownerText:'Meet s_current.',resolve}).ok,true);assert.equal(bindLiveSoulReferences(['s_current'],{ownerText:'Meet anyone nearby.',identityBasis:'anyone nearby',resolve}).ok,true);assert.equal(bindLiveSoulReferences(['s_current'],{resolve}).ok,true);}});
