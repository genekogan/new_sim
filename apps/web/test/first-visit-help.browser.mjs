// Help and account-panel paths: actual Shell/current-G Toy with the local auth UI (UI2: panel opens from a name plate), local fake/$0.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=process.cwd(),run=root+'/.e2e/runs/first-visit-help-'+new Date().toISOString().replaceAll(':','-'),web=run+'/web';
mkdirSync(web+'/assets',{recursive:true});
const require=createRequire(new URL('../../../mars/viewer/package.json',import.meta.url)),{build}=require('esbuild'),{chromium}=require('@playwright/test');
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {Shell} from './Shell.tsx';
const owner=new URLSearchParams(location.search).has('owner');const cfg=await (await fetch('/w/toy/v1/config')).json();
const auth={ready:true,authed:owner,label:owner?'dev:admin':null,login:()=>{},logout:()=>{},getToken:async()=>owner?'dev:admin':null,debug:{privyUserId:null,wallet:null,linked:[]}};
const root=createRoot(document.querySelector('#app'));root.render(<Shell cfg={cfg} auth={auth}/>);window.unmount=()=>root.unmount();`;
await build({absWorkingDir:root,stdin:{contents:entry,resolveDir:root+'/apps/web/src',sourcefile:'first-visit-help-fixture.tsx',loader:'tsx'},bundle:true,format:'esm',platform:'browser',outfile:web+'/assets/fixture.js',jsx:'automatic',define:{__BUILD__:'"dev"','process.env.NODE_ENV':'"development"','import.meta.env.VITE_EDEN_EXPERIENCE_WORLD_IDS':'""'}});
writeFileSync(web+'/assets/styles.css',readFileSync(root+'/apps/web/src/styles.css'));
writeFileSync(web+'/index.html','<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>First visit help fixture</title><link rel="stylesheet" href="/w/toy/assets/styles.css"><div id="app"></div><script type="module" src="/w/toy/assets/fixture.js"></script>');
const base='http://127.0.0.1:4961/w/toy';
// The server may come from another checkout with a matching protocol package (SIM_SERVER_ROOT); the web code is this tree's.
const serverRoot=process.env.SIM_SERVER_ROOT??root;
const server=spawn(process.execPath,[serverRoot+'/apps/server/src/main.ts'],{cwd:serverRoot,env:{PATH:process.env.PATH,PORT:'4961',HOST:'127.0.0.1',WORLD_KEY:'toy',WORLD_PATH:'/w/toy',WORLD_ID:'toy-1',PUBLIC_URL:base,DEV_AUTH:'1',ENGINE:'toy',BRAIN_MODE:'fake',BRAIN_BUDGET_USD_PER_DAY:'0',SEED_NATIVES:'0',DATA_DIR:run+'/data',WEB_DIR:web},stdio:['ignore','pipe','pipe']});
let log='',browser,page,status='fail';server.stdout.on('data',b=>log+=b);server.stderr.on('data',b=>log+=b);
const checks=[],errors=[],external=[],writes=[];const check=(name,value)=>{assert.ok(value,name);checks.push({name,pass:true});};
try{
 let ready=false;for(let i=0;i<100&&!ready;i++){try{ready=(await fetch(base+'/healthz')).ok;}catch{}if(!ready)await new Promise(r=>setTimeout(r,100));}assert.ok(ready,'fresh isolated server');
 const created=await fetch(base+'/v1/souls',{method:'POST',headers:{authorization:'Bearer dev:admin','content-type':'application/json'},body:JSON.stringify({name:'Local first visitor',description:'A curious inhabitant for an isolated help check.'})});assert.equal(created.status,200);const body=await created.json();assert.equal(body.ok,true);
 process.env.PLAYWRIGHT_BROWSERS_PATH=root+'/.e2e/browsers';browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
 page=await browser.newPage({viewport:{width:1280,height:900}});await page.addInitScript(()=>localStorage.setItem('sim.authUi','1'));page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'||r.method()==='DELETE')writes.push(r.url());});
 await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:4961/')?r.continue():(external.push(r.request().url()),r.abort()));
 await page.goto(base);const help=page.locator('.human-panel:not([hidden]) .playing-help').filter({has:page.locator(':scope > summary',{hasText:'How to play'})});
 check('Soul panel is hidden on arrival',await page.locator('#soul-panel').isHidden());
 const plate=page.locator('.world-canvas-host [data-soul-id]').filter({hasText:'Local first visitor'}).first();await plate.waitFor({state:'attached'});await plate.click({force:true});
 await page.locator('.human-panel h1').getByText('Local first visitor',{exact:true}).waitFor();await help.waitFor();
 check('Help starts collapsed without another screen',await help.evaluate(el=>!el.open));await help.locator(':scope > summary').click();
 check('Spectator help explains ownership and assignment',await help.getByText(/Signing in alone does not assign a Soul/).isVisible());
 check('Public selection help does not reveal owner form',await page.locator('#soul-direction').count()===0&&await help.getByText(/only its owner gives it direction/).isVisible());
 await page.screenshot({path:run+'/spectator-help.png'});writeFileSync(run+'/spectator.yml',await page.locator('body').ariaSnapshot());
 await page.goto(base+'?owner=1');await page.getByRole('button',{name:'Your Soul',exact:true}).click();const draft=page.locator('#soul-direction');await draft.waitFor();await draft.fill('A direction draft to keep');
 await help.locator(':scope > summary').click();check('Owner help distinguishes saved direction from action and uncertain resend',await help.getByText(/it is not a completed action/).isVisible()&&await help.getByText(/check recent history before sending again/).isVisible());
 await help.locator(':scope > summary').click();check('Opening and closing help preserves draft without sending',await draft.inputValue()==='A direction draft to keep'&&writes.length===0);
 await page.getByRole('button',{name:'More Soul tools',exact:true}).click();await page.getByRole('complementary',{name:'Soul and account tools'}).waitFor();
 check('Soul tools open the actual unique account panel in place of the Soul panel',await page.locator('#account-panel').count()===1&&await page.locator('#soul-panel').isHidden());
 await page.getByRole('button',{name:'← Back to the world',exact:true}).click();
 check('Back to the world hides the account panel (still present) and returns to the selected Soul',await page.locator('#account-panel').count()===1&&await page.locator('#account-panel').isHidden()&&await page.locator('#soul-panel').isVisible()&&await draft.inputValue()==='A direction draft to keep');
 await page.getByRole('button',{name:'More Soul tools',exact:true}).click();check('Reopening account restores accessible panel',await page.getByRole('complementary',{name:'Soul and account tools'}).isVisible());
 await page.getByRole('button',{name:'← Back to the world',exact:true}).click();await page.locator('#soul-panel').waitFor({state:'visible'});
 await page.setViewportSize({width:390,height:844});await help.locator(':scope > summary').click();await help.getByText(/it is not a completed action/).waitFor();
 check('Phone help is readable inside scrollable panel without page overflow',await page.evaluate(()=>{const p=document.querySelector('.human-panel:not([hidden])'),r=p.getBoundingClientRect();return document.documentElement.scrollWidth<=innerWidth&&r.left>=0&&r.right<=innerWidth&&getComputedStyle(p).overflowY==='auto';}));
 await page.screenshot({path:run+'/owner-phone-help.png'});writeFileSync(run+'/owner-phone.yml',await page.locator('body').ariaSnapshot());
 await page.evaluate(()=>window.unmount());await page.waitForFunction(()=>document.querySelectorAll('canvas').length===0);
 check('No help/account writes, runtime errors, external requests; canvas teardown',writes.length===0&&errors.length===0&&external.length===0);status='pass';
}catch(e){if(page){await page.screenshot({path:run+'/failure.png'});writeFileSync(run+'/failure.yml',await page.locator('body').ariaSnapshot());}writeFileSync(run+'/failure.txt',String(e.stack??e));throw e;}
finally{await browser?.close();server.kill('SIGINT');await once(server,'close');writeFileSync(run+'/server.log',log);
 const files=['apps/web/src/SoulFocus.tsx','apps/web/src/Shell.tsx','apps/web/src/styles.css','apps/web/test/first-visit-help.browser.mjs'];writeFileSync(run+'/sources.json',JSON.stringify(Object.fromEntries(files.map(p=>[p,createHash('sha256').update(readFileSync(root+'/'+p)).digest('hex')])),null,2));for(const p of files)writeFileSync(run+'/'+p.split('/').at(-1),readFileSync(root+'/'+p));
 writeFileSync(run+'/summary.json',JSON.stringify({status,checks,errors,external,writes,scope:'actual Shell/current-G Toy; explicit local dev-auth wrapper, no real sign-in/native admission/device or private-policy qualification',paid:0},null,2));writeFileSync(run+'/run.md','# First-visit help and account toggle\n\nNew scoped desktop/phone-width help and accessibility paths. Actual Shell/current-G Toy and fake minds; explicit local auth wrapper. No real login/native admission/device-performance proof. Browser/own4961 closed; old passing suites untouched.\n');writeFileSync(run+'/index.html','<h1>First-visit help '+status+'</h1><a href="summary.json">Checks and limits</a><img style="max-width:100%" src="spectator-help.png"><img style="max-width:100%" src="owner-phone-help.png">');console.log(JSON.stringify({status,checks:checks.length,run}));}
