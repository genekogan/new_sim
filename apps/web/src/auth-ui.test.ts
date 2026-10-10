import test from 'node:test';
import assert from 'node:assert/strict';
import {agentOnboarding,agentQuickstart} from './auth-ui.ts';
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

// Ported from the live release d357; world-engine branch: any launcher world slug, and #godpair/<code> survives.
await test('only trusted authentication origin initializes Clerk; unsigned preview has no token or dev identity',async()=>{
 const {clerkOriginRoute,unsignedPreviewAuth}=await import('./auth-ui.ts');
 const origin='https://sim.eden.art';
 for(const path of ['/w/eden','/w/willow-hollow','/w/meetup-hollow-2/']){
  assert.equal(clerkOriginRoute(origin,origin,path).initialize,true);
  for(const current of ['https://example.trycloudflare.com','http://localhost:4970','http://127.0.0.1:4970','https://<eden2-sslip-host>']){
   const route=clerkOriginRoute(origin,current,path);assert.equal(route.initialize,false);assert.equal(route.signInUrl,origin+path.replace(/\/$/,'')+'#watch');
   let navigations=0;const auth=unsignedPreviewAuth(route.signInUrl,()=>navigations++);assert.equal(auth.ready,true);assert.equal(auth.authed,false);assert.equal(await auth.getToken(),null);assert.equal(navigations,0);auth.login();assert.equal(navigations,1);
  }
 }
 for(const untrusted of [undefined,'','https://evil.test/path','javascript:alert(1)','https://user:pw@sim.eden.art','http://evil.test'])assert.deepEqual(clerkOriginRoute(untrusted,origin,'/w/eden'),{initialize:false,signInUrl:null});
 for(const bad of ['/w/Eden','/w/eden/extra','/x/eden','/w/9lives','/w/eden?redirect=https://evil.test'])assert.equal(clerkOriginRoute(origin,origin,bad).signInUrl,null);
});
await test('canonical links keep a Soul, #join, an approval or a god pairing, nothing else',async()=>{
 const {clerkOriginRoute,clerkHomeRoute,configuredSignIn}=await import('./auth-ui.ts');
 const origin='https://sim.eden.art',id='ap_'+'a'.repeat(32);
 for(const path of ['/w/eden','/w/willow-hollow']){
  for(const hash of ['#approve/'+id,'#soul/s_Avery','#join','#godpair/ABCD-EF23'])assert.equal(clerkOriginRoute(origin,'http://localhost:4970',path,hash).signInUrl,origin+path+hash);
  for(const hash of ['#approve/'+id+'/extra','#godpair/abcd-efgh','#godpair/ABCD-EFGH/x','#pair/ABCD-EFGH','#https://evil.test'])assert.equal(clerkOriginRoute(origin,'http://localhost:4970',path,hash).signInUrl,origin+path+'#watch');
 }
 assert.deepEqual(clerkHomeRoute(origin,origin),{initialize:true,signInUrl:origin+'/'});
 assert.deepEqual(clerkHomeRoute(origin,'http://127.0.0.1:5209'),{initialize:false,signInUrl:origin+'/'});
 assert.deepEqual(clerkHomeRoute('javascript:alert(1)',origin),{initialize:false,signInUrl:null});
 assert.equal(configuredSignIn({authProvider:'clerk',clerkPublishableKey:'pk_live_x',clerkIssuer:'https://clerk.eden.art'}),true);
 assert.equal(configuredSignIn({authProvider:'clerk',clerkPublishableKey:'',clerkIssuer:'https://clerk.eden.art',devAuth:true}),false,'dev auth never stands in for Clerk');
 assert.equal(configuredSignIn({authProvider:'privy',privyAppId:'',devAuth:true}),true);
 assert.equal(configuredSignIn({authProvider:'none',devAuth:true}),false);
});
