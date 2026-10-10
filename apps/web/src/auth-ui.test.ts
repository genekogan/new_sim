import test from 'node:test';
import assert from 'node:assert/strict';
import {agentOnboarding,agentQuickstart,clerkOriginRoute,unsignedPreviewAuth} from './auth-ui.ts';
await test('New Soul prompt keeps a raw clickable-world URL and exact plain clipboard sentence',()=>{
 const onboarding=agentOnboarding('https://sim.example/w/eden/');
 assert.equal(onboarding.instructionsUrl,'https://sim.example/w/eden/instructions.md');
 assert.equal(onboarding.text,'Read the instructions at https://sim.example/w/eden/instructions.md to create a new soul in the world Eden.');
 assert.equal(agentQuickstart('https://sim.example/w/eden/'),onboarding.text);
 assert.doesNotMatch(onboarding.text,/\]\(|always.on|spending|STOP|live --|register/);
});
await test('bootstrap preserves actual world prefix and display name across worlds',()=>{
 assert.equal(agentOnboarding('http://127.0.0.1:4970/w/littlemartians').world,'Little Martians');
 const custom=agentOnboarding('https://sim.example/w/mars','Mars College');assert.equal(custom.instructionsUrl,'https://sim.example/w/mars/instructions.md');assert.ok(custom.text.endsWith('world Mars College.'));
});

await test('only trusted authentication origin initializes Clerk; unsigned preview has no token or dev identity',async()=>{
 const origin='https://sim.eden.art',path='/w/eden';
 assert.equal(clerkOriginRoute(origin,origin,path).initialize,true);
 for(const current of ['https://example.trycloudflare.com','http://localhost:4970','http://127.0.0.1:4970','https://<eden2-sslip-host>']){
  const route=clerkOriginRoute(origin,current,path);assert.equal(route.initialize,false);assert.equal(route.signInUrl,origin+path+'#watch');
  let navigations=0;const auth=unsignedPreviewAuth(route.signInUrl,()=>navigations++);assert.equal(auth.ready,true);assert.equal(auth.authed,false);assert.equal(await auth.getToken(),null);assert.equal(navigations,0);auth.login();assert.equal(navigations,1);
 }
 for(const untrusted of [undefined,'','https://evil.test/path','javascript:alert(1)','https://user:pw@sim.eden.art','http://evil.test'])assert.deepEqual(clerkOriginRoute(untrusted,origin,path),{initialize:false,signInUrl:null});
});
await test('canonical links preserve intended world/approval/Soul/New Soul without forwarding arbitrary queries or fragments',()=>{
 const origin='https://sim.eden.art',id='ap_'+'a'.repeat(32);
 for(const path of ['/w/eden','/w/mars','/w/littlemartians']){
  for(const hash of ['#approve/'+id,'#soul/s_Avery','#join'])assert.equal(clerkOriginRoute(origin,'http://localhost:4970',path,hash).signInUrl,origin+path+hash);
  for(const hash of ['#approve/'+id+'/extra','#pair/ABCD-EFGH','#https://evil.test','?redirect=https://evil.test'])assert.equal(clerkOriginRoute(origin,'http://localhost:4970',path,hash).signInUrl,origin+path+'#watch');
 }
 assert.equal(clerkOriginRoute(origin,origin,'/w/eden?redirect=https://evil.test').signInUrl,null);
});
