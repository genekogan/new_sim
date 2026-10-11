import test from 'node:test';import assert from 'node:assert/strict';
import {delegatedOwnerPath,approvalPublic,acceptDelegation} from './client-account.mjs';
test('delegate remaps only explicit selected Soul routes and never a different Soul or account operation',()=>{
 assert.equal(delegatedOwnerPath('/v1/me','s_one'),'/v1/agent/account-me');assert.equal(delegatedOwnerPath('/v1/souls/s_one/profile','s_one'),'/v1/agent/profile');assert.equal(delegatedOwnerPath('/v1/souls/s_one/intent-v2/requests/r_one','s_one'),'/v1/agent/intent-v2/requests/r_one');
 for(const p of ['/v1/souls/s_two/profile','/v1/souls','/v1/souls/s_one/pair'])assert.throws(()=>delegatedOwnerPath(p,'s_one'));
});
test('approval projections exclude credentials and ready acceptance fences exact world/approval/Soul',()=>{
 const id='ap_'+'a'.repeat(32),pending={approvalId:id,worldId:'world-one'},data={id,worldId:'world-one',status:'ready',soulId:'s_one',token:'sim_s_one_private'};
 assert.equal(approvalPublic({...data,name:'One'},'https://example.com/w/eden').approvalURL,'https://example.com/w/eden/#approve/'+id);assert.equal(JSON.stringify(approvalPublic(data,'http://example')).includes('private'),false);
 assert.equal(acceptDelegation(data,pending,'http://example').soul,'s_one');assert.equal(acceptDelegation({...data,status:'creating'},pending,'http://example'),null);
 for(const corrupt of [{worldId:'world-two'},{id:'ap_'+'b'.repeat(32)},{soulId:'s_two'}])assert.throws(()=>acceptDelegation({...data,...corrupt},pending,'http://example'));
});
