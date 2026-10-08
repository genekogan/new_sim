// New account freshness paths; actual Shell/current-G Toy with explicit response barriers.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=process.cwd(),run=root+'/.e2e/runs/account-freshness-'+new Date().toISOString().replaceAll(':','-'),web=run+'/web';
mkdirSync(web+'/assets',{recursive:true});
const require=createRequire(new URL('../../../mars/viewer/package.json',import.meta.url)),{build}=require('esbuild'),{chromium}=require('@playwright/test');
const baseline=process.argv.includes('--baseline');
const entry=`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {Shell} from './Shell.tsx';
const cfg=await (await fetch('/w/toy/v1/config')).json();
function Fixture(){const [session,setSession]=useState('admin');window.setSession=setSession;
const auth={ready:true,authed:!!session,label:session?'dev:'+session:null,login:()=>{},logout:()=>setSession(null),getToken:async()=>session?'dev:'+session:null,debug:{privyUserId:null,wallet:null,linked:[]}};
return <Shell cfg={cfg} auth={auth}/>;}
const root=createRoot(document.querySelector('#app'));root.render(<Fixture/>);window.unmount=()=>root.unmount();`;
await build({absWorkingDir:root,stdin:{contents:entry,resolveDir:root+'/apps/web/src',sourcefile:'account-freshness-fixture.tsx',loader:'tsx'},bundle:true,format:'esm',platform:'browser',outfile:web+'/assets/fixture.js',jsx:'automatic',plugins:baseline?[{name:'pinned-baseline',setup(b){b.onLoad({filter:/(Shell|SoulHome)\.tsx$/},({path})=>({contents:execFileSync('git',['show','d290c60:'+path.slice(root.length+1)],{encoding:'utf8'}),loader:'tsx'}));}}]:[],define:{__BUILD__:'"dev"','process.env.NODE_ENV':'"development"','import.meta.env.VITE_EDEN_EXPERIENCE_WORLD_IDS':'""'}});
writeFileSync(web+'/assets/styles.css',readFileSync(root+'/apps/web/src/styles.css'));
writeFileSync(web+'/index.html','<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Account freshness fixture</title><link rel="stylesheet" href="/w/toy/assets/styles.css"><div id="app"></div><script type="module" src="/w/toy/assets/fixture.js"></script>');
const base='http://127.0.0.1:4962/w/toy';
// The server may come from another checkout with a matching protocol package (SIM_SERVER_ROOT); the web code is this tree's.
const serverRoot=process.env.SIM_SERVER_ROOT??root;
const server=spawn(process.execPath,[serverRoot+'/apps/server/src/main.ts'],{cwd:serverRoot,env:{PATH:process.env.PATH,PORT:'4962',HOST:'127.0.0.1',WORLD_KEY:'toy',WORLD_PATH:'/w/toy',WORLD_ID:'toy-1',PUBLIC_URL:base,DEV_AUTH:'1',ENGINE:'toy',BRAIN_MODE:'fake',BRAIN_BUDGET_USD_PER_DAY:'0',SEED_NATIVES:'0',DATA_DIR:run+'/data',WEB_DIR:web},stdio:['ignore','pipe','pipe']});
let log='',browser,page,status='fail';server.stdout.on('data',b=>log+=b);server.stderr.on('data',b=>log+=b);
const checks=[],errors=[],external=[],writes=[];const check=(name,value)=>{assert.ok(value,name);checks.push({name,pass:true});};
try{
 let ready=false;for(let i=0;i<100&&!ready;i++){try{ready=(await fetch(base+'/healthz')).ok;}catch{}if(!ready)await new Promise(r=>setTimeout(r,100));}assert.ok(ready,'fresh isolated server');
 const created=await fetch(base+'/v1/souls',{method:'POST',headers:{authorization:'Bearer dev:admin','content-type':'application/json'},body:JSON.stringify({name:'Local first visitor',description:'A curious inhabitant for an isolated help check.'})});assert.equal(created.status,200);const body=await created.json();assert.equal(body.ok,true);
 process.env.PLAYWRIGHT_BROWSERS_PATH=root+'/.e2e/browsers';browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
 page=await browser.newPage({viewport:{width:1280,height:900}});await page.addInitScript(()=>localStorage.setItem('sim.authUi','1'));page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'||r.method()==='DELETE')writes.push(r.url());});
 await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:4962/')?r.continue():(external.push(r.request().url()),r.abort()));
 let meReads=0,holdMe=false,denyPrivate=false;const held=[];
 await page.route('**/v1/me',async route=>{meReads++;const response=await route.fetch();if(holdMe){await new Promise(resolve=>held.push({route,response,resolve}));}await route.fulfill({response});});
 await page.route('**/v1/souls/'+body.soul.id+'{,/**}',async route=>{if(denyPrivate){await route.fulfill({status:403,json:{ok:false,message:'local fixture access withdrawn'}});return;}const response=await route.fetch();let data;try{data=await response.json();}catch{await route.fulfill({response});return;}if(data.status)data.status.journal='LOCAL_OLD_PRIVATE_DETAIL';await route.fulfill({response,json:data});});
 await page.goto(base);await page.getByRole('button',{name:'Your Soul',exact:true}).click();await page.locator('#soul-direction').waitFor();await page.getByRole('button',{name:'More Soul tools',exact:true}).click();
 // UI2: the account panel replaces the Soul panel; "← Back to the world" hides it, "More Soul tools" (or Your Soul) reopens it.
 const panel=page.locator('#account-panel');
 const toggle={click:async()=>{if(await panel.isVisible()){await page.getByRole('button',{name:'← Back to the world',exact:true}).click();await panel.waitFor({state:'hidden'});return;}
  const more=page.getByRole('button',{name:'More Soul tools',exact:true});if(await more.isVisible())await more.click();else await page.getByRole('button',{name:'Your Soul',exact:true}).click();await panel.waitFor({state:'visible'});}};await panel.getByText('LOCAL_OLD_PRIVATE_DETAIL',{exact:true}).waitFor();
 const draft=panel.getByPlaceholder(/tell Local first visitor what to do/);await draft.fill('Harmless private direction draft');
 if(process.argv.includes('--ownership-only')){
 const reads=meReads;await toggle.click();
 const retired=await fetch(base+'/v1/souls/'+body.soul.id,{method:'DELETE',headers:{authorization:'Bearer dev:admin'}});assert.equal(retired.status,200);
 await toggle.click();await panel.getByText(/You do not have a Soul in this world yet/).waitFor();
 check('Actual API retirement while hidden yields current empty ownership on reopen',meReads>reads&&await panel.getByRole('heading',{name:'Your Souls',exact:true}).count()===0&&await panel.getByText('LOCAL_OLD_PRIVATE_DETAIL',{exact:true}).count()===0&&await draft.count()===0);
 await page.screenshot({path:run+'/ownership-changed.png'});writeFileSync(run+'/ownership-changed.yml',await page.locator('body').ariaSnapshot());
 }else{
 const reads=meReads;await toggle.click();await toggle.click();
 await page.waitForFunction(()=>document.querySelector('#account-panel')&&!document.querySelector('#account-panel').hidden);await new Promise(r=>setTimeout(r,100));
 check('Reopening mounted account makes a new Me request',meReads>reads);
 await panel.getByText('LOCAL_OLD_PRIVATE_DETAIL',{exact:true}).waitFor();check('Successful same-account refresh preserves harmless draft',await draft.inputValue()==='Harmless private direction draft');
 denyPrivate=true;await panel.getByText('Private Soul details are unavailable. We’ll check again shortly.',{exact:true}).waitFor();
 check('Denied dashboard/timeline clears old private display and connection controls',await panel.getByText('LOCAL_OLD_PRIVATE_DETAIL',{exact:true}).count()===0&&await panel.getByRole('region',{name:'Assistant connection'}).count()===0&&await draft.count()===0);
 await page.screenshot({path:run+'/private-denied.png'});writeFileSync(run+'/denied.yml',await page.locator('body').ariaSnapshot());
 denyPrivate=false;await panel.getByText('LOCAL_OLD_PRIVATE_DETAIL',{exact:true}).waitFor();check('Fresh positive private reads recover without an automatic write',writes.length===0);
 await toggle.click();holdMe=true;await toggle.click();await page.waitForTimeout(30);for(let i=0;i<100&&!held.length;i++)await new Promise(r=>setTimeout(r,10));assert.ok(held.length);
 check('Reopening held Me hides previous private account while checking',await panel.getByText('Checking current account…',{exact:true}).isVisible()&&await panel.getByText('LOCAL_OLD_PRIVATE_DETAIL',{exact:true}).isHidden());
 holdMe=false;await page.evaluate(()=>window.setSession('visitor'));await panel.getByRole('heading',{name:'Your invitation',exact:true}).waitFor();
 for(const h of held)h.resolve();await page.waitForTimeout(100);
 check('Old held Me after signed-in identity switch cannot restore account/private state',await panel.getByRole('heading',{name:'Your invitation',exact:true}).isVisible()&&await panel.getByText('LOCAL_OLD_PRIVATE_DETAIL',{exact:true}).count()===0&&await panel.getByRole('heading',{name:'Your Souls',exact:true}).count()===0);
 await page.evaluate(()=>window.setSession('admin'));await panel.getByText('LOCAL_OLD_PRIVATE_DETAIL',{exact:true}).waitFor();
 await toggle.click();holdMe=true;const prior=held.length;await toggle.click();for(let i=0;i<100&&held.length===prior;i++)await new Promise(r=>setTimeout(r,10));assert.ok(held.length>prior);await page.evaluate(()=>window.setSession(null));
 for(const h of held)h.resolve();holdMe=false;await panel.getByText(/Sign in to manage your/).waitFor();
 check('Sign-out clears held private account and owned Soul child state',await panel.getByText('LOCAL_OLD_PRIVATE_DETAIL',{exact:true}).count()===0&&await panel.getByRole('heading',{name:'Your Souls',exact:true}).count()===0);
 await page.screenshot({path:run+'/signed-out.png'});writeFileSync(run+'/signed-out.yml',await page.locator('body').ariaSnapshot());
 }
 await page.evaluate(()=>window.unmount());await page.waitForFunction(()=>document.querySelectorAll('canvas').length===0);
 check('No UI writes, runtime errors/external requests; actual canvas teardown',writes.length===0&&errors.length===0&&external.length===0);status='pass';
}catch(e){if(page){await page.screenshot({path:run+'/failure.png'});writeFileSync(run+'/failure.yml',await page.locator('body').ariaSnapshot());}writeFileSync(run+'/failure.txt',String(e.stack??e));throw e;}
finally{await browser?.close();server.kill('SIGINT');await once(server,'close');writeFileSync(run+'/server.log',log);
 const files=['apps/web/src/SoulHome.tsx','apps/web/src/Shell.tsx','apps/web/src/styles.css','apps/web/test/account-freshness.browser.mjs'];writeFileSync(run+'/sources.json',JSON.stringify(Object.fromEntries(files.map(p=>[p,createHash('sha256').update(readFileSync(root+'/'+p)).digest('hex')])),null,2));for(const p of files){const bytes=baseline&&/(Shell|SoulHome)\.tsx$/.test(p)?execFileSync('git',['show','d290c60:'+p]):readFileSync(root+'/'+p);writeFileSync(run+'/'+p.split('/').at(-1),bytes);}if(baseline)writeFileSync(run+'/effective-baseline-pin.txt','d290c60c422632d085fde9d6afed5a4eb14a0d2a');
 writeFileSync(run+'/summary.json',JSON.stringify({status,checks,errors,external,writes,baseline,ownershipOnly:process.argv.includes('--ownership-only'),scope:'actual Shell/current-G Toy plus explicit Me barriers/private denial; explicit local dev-auth wrapper, no real sign-in/native admission/device or private-policy qualification',paid:0},null,2));writeFileSync(run+'/run.md','# Account freshness\n\nNew scoped reopen/denial/session response paths. Actual Shell/current-G Toy and fake minds; explicit local auth wrapper. No real login/native admission/device-performance proof. Browser/own4962 closed; old passing suites untouched.\n');writeFileSync(run+'/index.html','<h1>Account freshness '+status+'</h1><a href="summary.json">Checks and limits</a>'+ (process.argv.includes('--ownership-only')?'<img style="max-width:100%" src="ownership-changed.png">':'<img style="max-width:100%" src="private-denied.png"><img style="max-width:100%" src="signed-out.png">'));console.log(JSON.stringify({status,checks:checks.length,run}));}
