import {test} from 'node:test';import assert from 'node:assert/strict';
import {worldAuthMode,validateWorldOrigin} from './world-auth-mode.mjs';
test('public world modes preserve explicit owner semantics and never seed a native crowd',()=>{
 assert.equal(worldAuthMode().local,true);
 for(const mode of ['public-preview','configured'])assert.throws(()=>worldAuthMode(mode,{edgePublic:'1'}),/no-native-cast/);
 assert.throws(()=>worldAuthMode('public-preview',{seedCast:false,nativeCast:false}),/owner-restriction/);
 assert.deepEqual(worldAuthMode('public-preview',{edgePublic:'1',seedCast:false,nativeCast:false}),{mode:'public-preview',local:false,preview:true,configured:false,devAuth:true});
 assert.equal(worldAuthMode('configured',{seedCast:false,nativeCast:false}).devAuth,false);assert.throws(()=>worldAuthMode('configured',{seedCast:false,nativeCast:false,devAuth:'1'}),/no-dev-auth/);
});
test('origin validation accepts explicit hosted identity without credentials or arbitrary local exposure',()=>{
 assert.equal(validateWorldOrigin('https://example.test','configured'),'https://example.test');assert.equal(validateWorldOrigin('http://127.0.0.1:4966','public-preview'),'http://127.0.0.1:4966');
 for(const origin of ['https://x.test','http://x.test'])assert.throws(()=>validateWorldOrigin(origin,'local-dev'),/origin/);
 for(const origin of ['https://user:pass@x.test','https://x.test/path','http://x.test','https://x.test?token=x'])assert.throws(()=>validateWorldOrigin(origin,'configured'),/origin/);
});
