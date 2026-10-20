import test from 'node:test';
import assert from 'node:assert/strict';
import {agentOnboarding,agentQuickstart,clerkNow,clerkSignedInHint,clerkOriginRoute,unsignedPreviewAuth} from './auth-ui.ts';
import {readFileSync} from 'node:fs';
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

// New worlds (world-engine branch, reconciled with e8): ported launcher tests.
await test('new worlds: only trusted authentication origin initializes Clerk on any launcher slug',async()=>{
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
await test('new worlds: canonical links keep a Soul, #join, an approval or a god pairing, nothing else',async()=>{
 const {clerkOriginRoute,clerkHomeRoute,configuredSignIn}=await import('./auth-ui.ts');
 const origin='https://sim.eden.art',id='ap_'+'a'.repeat(32);
 // old root worlds keep e8's rule: a god pairing link is not preserved there
 assert.equal(clerkOriginRoute(origin,'http://localhost:4970','/w/eden','#godpair/ABCD-EF23').signInUrl,origin+'/w/eden#watch');
 for(const path of ['/w/willow-hollow']){
  for(const hash of ['#approve/'+id,'#soul/s_Avery','#join','#godpair/ABCD-EF23'])assert.equal(clerkOriginRoute(origin,'http://localhost:4970',path,hash).signInUrl,origin+path+hash);
  for(const hash of ['#approve/'+id+'/extra','#godpair/abcd-efgh','#godpair/ABCD-EFGH/x','#pair/ABCD-EFGH','#https://evil.test'])assert.equal(clerkOriginRoute(origin,'http://localhost:4970',path,hash).signInUrl,origin+path+'#watch');
 }
 assert.deepEqual(clerkHomeRoute(origin,origin),{initialize:true,signInUrl:origin+'/'});
 assert.deepEqual(clerkHomeRoute(origin,'http://127.0.0.1:5209'),{initialize:false,signInUrl:origin+'/'});
 assert.deepEqual(clerkHomeRoute('javascript:alert(1)',origin),{initialize:false,signInUrl:null});
 assert.equal(configuredSignIn({authProvider:'clerk',clerkPublishableKey:'pk_live_x',clerkIssuer:'https://clerk.eden.art'}),true);
 assert.equal(configuredSignIn({authProvider:'clerk',clerkPublishableKey:'',clerkIssuer:'https://clerk.eden.art',devAuth:true}),false,'dev auth never stands in for Clerk');
 assert.equal(configuredSignIn({authProvider:'privy',privyAppId:'',devAuth:true},true),true,'new worlds: local dev sign-in');
 assert.equal(configuredSignIn({authProvider:'privy',privyAppId:'',devAuth:true}),false,'old worlds: e8 rule unchanged');
 assert.equal(configuredSignIn({authProvider:'none',devAuth:true}),false);
});

// Lane X (real-user fix): the launcher served under a path prefix (`--base /worlds`, build `--base /worlds/`) puts new
// worlds at /worlds/w/<slug>. Clerk must initialize there and Sign in must have a target; old root worlds unchanged.
await test('a prefixed launcher world (/worlds/w/<slug>) initializes Clerk and has a sign-in URL',async()=>{
 const {clerkOriginRoute,clerkHomeRoute,isWorldPath}=await import('./auth-ui.ts');
 const origin='https://sim.eden.art',base='/worlds';
 for(const path of ['/worlds/w/willow-hollow','/worlds/w/gene-s-garden-2/']){
  const here=clerkOriginRoute(origin,origin,path,'',base);
  assert.equal(here.initialize,true,path);assert.equal(here.signInUrl,origin+path.replace(/\/$/,'')+'#watch');
  assert.equal(clerkOriginRoute(origin,origin,path,'#godpair/ABCD-EF23',base).signInUrl,origin+path.replace(/\/$/,'')+'#godpair/ABCD-EF23');
  assert.equal(clerkOriginRoute(origin,origin,path,'#join',base).signInUrl,origin+path.replace(/\/$/,'')+'#join');
  const away=clerkOriginRoute(origin,'http://127.0.0.1:5100',path,'',base);assert.equal(away.initialize,false);assert.equal(away.signInUrl,origin+path.replace(/\/$/,'')+'#watch');
 }
 // the prefix is required and exact; a root world path under a prefixed build (or vice versa) is not a world page
 for(const [path,b] of [['/w/willow','/worlds'],['/worlds/w/willow',''],['/worldsx/w/willow','/worlds'],['/worlds/w/Willow','/worlds'],['/worlds/w/willow/extra','/worlds'],['/worlds/x/willow','/worlds'],['/worlds/w/willow','/../x'],['/worlds/w/willow','worlds']] as const)
  assert.deepEqual(clerkOriginRoute(origin,origin,path,'',b),{initialize:false,signInUrl:null},path+' base '+b);
 assert.deepEqual(clerkHomeRoute(origin,origin,base),{initialize:true,signInUrl:origin+'/worlds/'});
 assert.deepEqual(clerkHomeRoute(origin,'http://127.0.0.1:5100',base),{initialize:false,signInUrl:origin+'/worlds/'});
 assert.deepEqual(clerkHomeRoute(origin,origin,'/x?y'),{initialize:false,signInUrl:null});
 assert.equal(isWorldPath('/worlds/w/a',base),true);assert.equal(isWorldPath('/worlds/w/a/',base),false);assert.equal(isWorldPath('/worlds/w/a/',base,true),true);
});
await test('old worlds at the root (BASE \'\') resolve exactly as before the prefix change',async()=>{
 const {clerkOriginRoute,clerkHomeRoute,agentOnboarding}=await import('./auth-ui.ts');
 const {publicSoulLink}=await import('./soul-link.ts');
 const {connectionSetupPrompt}=await import('./connection-prompt.ts');
 const origin='https://sim.eden.art';
 for(const key of ['eden','mars','littlemartians']){
  const path='/w/'+key;
  // identical to the pre-change results (no base argument, and an explicit '')
  for(const r of [clerkOriginRoute(origin,origin,path,'#join'),clerkOriginRoute(origin,origin,path,'#join','')])assert.deepEqual(r,{initialize:true,signInUrl:origin+path+'#join'});
  assert.equal(publicSoulLink(origin,path,'s_Avery'),origin+path+'#soul/s_Avery');
  assert.equal(publicSoulLink(origin,path,'s_Avery',''),origin+path+'#soul/s_Avery');
  assert.ok(connectionSetupPrompt(origin+path,'s_Avery')?.includes(JSON.stringify(origin+path)));
  assert.ok(connectionSetupPrompt(origin+path+'/','s_Avery'));
 }
 assert.deepEqual(clerkHomeRoute(origin,origin),{initialize:true,signInUrl:origin+'/'});
 assert.equal(agentOnboarding(origin+'/w/littlemartians').world,'Little Martians');
 assert.equal(agentOnboarding(origin+'/w/eden').world,'Eden');
 assert.equal(agentOnboarding(origin+'/').world,'Eden');
});
await test('Share Soul, the connection prompt and the onboarding name work on a prefixed launcher world',async()=>{
 const {publicSoulLink}=await import('./soul-link.ts');
 const {connectionSetupPrompt}=await import('./connection-prompt.ts');
 const {agentOnboarding}=await import('./auth-ui.ts');
 const origin='https://sim.eden.art',base='/worlds',path='/worlds/w/willow-hollow';
 assert.equal(publicSoulLink(origin,path,'s_Avery',base),origin+path+'#soul/s_Avery');
 assert.throws(()=>publicSoulLink(origin,path,'s_Avery'));assert.throws(()=>publicSoulLink(origin,'/w/willow-hollow','s_Avery',base));
 assert.ok(connectionSetupPrompt(origin+path,'s_Avery',undefined,base)?.includes(JSON.stringify(origin+path)));
 assert.equal(connectionSetupPrompt(origin+path,'s_Avery'),null);
 assert.equal(agentOnboarding(origin+path).world,'Willow Hollow') // V1: slug words, never the raw slug;
});

await test('P1: a Clerk world page loads its sign-in after the arrival unless the page came for a sign-in step',()=>{
 const u='https://sim.example/worlds/w/eden-2026/';
 assert.equal(clerkNow(u,''),false);assert.equal(clerkNow(u+'#watch','#watch'),false);
 assert.equal(clerkNow(u+'#soul/soul_abc123','#soul/soul_abc123'),false);
 for(const h of ['#join','#approve/AB12','#godpair/ABCD-EFGH','#my%20soul'])assert.equal(clerkNow(u+h,h),true,h);
 assert.equal(clerkNow(u+'?__clerk_handshake=x',''),true);
 assert.equal(clerkNow(u,'','a=1; __client_uat=0'),false);assert.equal(clerkNow(u,'','__client_uat_Xy12=1760000000; b=2'),true);
 assert.equal(clerkSignedInHint('__client_uat=1760000000'),true);assert.equal(clerkSignedInHint('x__client_uat=17'),false);assert.equal(clerkSignedInHint(''),false);assert.equal(clerkNow(u+'?__clerk_db_jwt=x#watch','#watch'),true);
 // main.tsx: the Shell renders beside the lazy bridge (never inside ClerkProvider), and no static Clerk import
 const main=readFileSync(new URL('./main.tsx',import.meta.url),'utf8');
 assert.doesNotMatch(main,/from '@clerk\/clerk-react'/);assert.doesNotMatch(main,/import \{[^}]*LauncherHome[^}]*\} from/);
 assert.match(main,/<Shell cfg=\{cfg\} auth=\{auth\}[^>]*\/>\s*\{load&&<Suspense fallback=\{null\}><ClerkBridge /);
});
test('lane PUX: the New Soul prompt carries the signed-in window code, and only a well-formed one',()=>{
 assert.equal(agentOnboarding('https://sim.example/worlds/w/bench-hamlet','Bench Hamlet','ABCD-EFGH').instructionsUrl,'https://sim.example/worlds/w/bench-hamlet/instructions.md?for=ABCD-EFGH');
 assert.match(agentOnboarding('https://sim.example/worlds/w/bench-hamlet','Bench Hamlet','ABCD-EFGH').text,/instructions\.md\?for=ABCD-EFGH /);
 for(const bad of [null,undefined,'','abcd-efgh','ABCD-EFG0','ABCD-EFGH&x=1'])assert.equal(agentOnboarding('https://sim.example/worlds/w/bench-hamlet','Bench Hamlet',bad).instructionsUrl,'https://sim.example/worlds/w/bench-hamlet/instructions.md');
});
