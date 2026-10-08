// First-user mobile/fullscreen flow on the ACTUAL installed 4970 frontend build (pm-preview apps/web/dist)
// and the same PM launcher + Core runtime input, but on 127.0.0.1:4965 with a fresh empty DATA_DIR,
// BRAIN_MODE=fake, no model credential, $0, no lecture/cast flags. Never touches 4970 or its DB.
// Usage: node apps/web/test/first-user.fake0.mjs [--explore]
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=process.cwd(),explore=process.argv.includes('--explore'),webArg=process.argv.indexOf('--web'),candidate=webArg>0?process.argv[webArg+1]:null;
const PM='<worktrees>/pm-preview',DESC='<team>/pm-integration/p0-interaction-broadcast-20261006/candidate-descriptor-p0a3.json';
const run=root+'/.e2e/runs/first-user-fake0-'+new Date().toISOString().replaceAll(':','-');mkdirSync(run+'/data',{recursive:true});
const require=createRequire(new URL('../../../mars/viewer/package.json',import.meta.url)),{chromium,devices}=require('@playwright/test');
const port=4965,base=`http://127.0.0.1:${port}/w/eden`,d=JSON.parse(readFileSync(DESC,'utf8'));
// Retained-world installs (expansion/shore/social/commons) require the real retained DB, which is never copied here.
const keep=['PREVIEW_INPUT','PREVIEW_INPUT_MANIFEST_SHA256','PREVIEW_SOUL_LIMIT','PREVIEW_HUMAN_REST','PREVIEW_INTENT_SEQUENCES','PREVIEW_INTENT_APPROACH_RETENTION','PREVIEW_CLOSED_HUMAN_GOALS'];
const flags=Object.fromEntries(keep.filter(k=>k in d.previewFlags).map(k=>[k,d.previewFlags[k]]));
const env={PATH:process.env.PATH,HOST:'127.0.0.1',PORT:String(port),WORLD_KEY:'eden',WORLD_ID:d.worldId,WORLD_PATH:'/w/eden',WORLD_OWNER_ID:'dev:admin',PUBLIC_URL:base,ENGINE:'mars',ENABLE_LIVING_WORLD:'1',
 BRAIN_MODE:'fake',PREVIEW_BUDGET_USD_PER_DAY:'0',DEV_AUTH:'1',ARCHIVE_TAKES:'0',BUILD_ID:'local-app-first-user-fake0',SEED_NATIVES:'0',WEB_DIR:candidate??PM+'/apps/web/dist',MARS_WEB_DIR:'<team>/previews/20261004/mars-static',DATA_DIR:run+'/data',...flags};
for(const k of Object.keys(env))assert.ok(!/CREDENTIAL|KEY$/.test(k)||k==='WORLD_KEY','no credentials');
const dist=readFileSync((candidate??PM+'/apps/web/dist')+'/index.html','utf8'),bundle=dist.match(/assets\/((?:preview|index)-[A-Za-z0-9_-]+\.js)/)?.[1];
// Copy PM's launcher unchanged except its port guard, which only admits 4950-4959/4970; App's range is 4960-4969.
const launch=run+'/launcher';mkdirSync(launch,{recursive:true});const launcherDiff={};
for(const f of ['local-expanded-preview.mjs','current-expanded-bootstrap.mjs','current-human-burst-adapter.mjs','current-local-governor.ts']){
 const src=readFileSync(PM+'/tools/pm/'+f,'utf8'),guard='!(port>=4950&&port<=4959||port===4970)',out=f==='current-expanded-bootstrap.mjs'?src.replace(guard,'!(port>=4960&&port<=4969)'):src;
 if(f==='current-expanded-bootstrap.mjs')assert.ok(src.includes(guard)&&out!==src,'port guard located');
 writeFileSync(launch+'/'+f,out);launcherDiff[f]={pm:createHash('sha256').update(src).digest('hex'),used:createHash('sha256').update(out).digest('hex')};}
let log='';const server=spawn('/opt/homebrew/Cellar/node/26.8.2/bin/node',[launch+'/local-expanded-preview.mjs'],{cwd:PM,env,stdio:['ignore','pipe','pipe']});server.stdout.on('data',b=>log+=b);server.stderr.on('data',b=>log+=b);
const checks=[],errors=[],external=[];let status='fail',browser;const check=(name,ok,detail)=>{checks.push({name,pass:!!ok,...(detail?{detail}:{})});if(!explore)assert.ok(ok,name);};
async function snap(page,name){await page.screenshot({path:`${run}/${name}.png`});writeFileSync(`${run}/${name}.yml`,await page.locator('body').ariaSnapshot().catch(e=>String(e)));}
try{
 let ready=false;for(let i=0;i<600&&!ready;i++){try{ready=(await fetch(base+'/healthz')).ok;}catch{}if(!ready)await new Promise(r=>setTimeout(r,250));}
 assert.ok(ready,'fake0 server ready: '+log.slice(-800));
 const health=await (await fetch(base+'/healthz')).json();check('fake0 server build',health.build==='local-app-first-user-fake0',health);
 process.env.PLAYWRIGHT_BROWSERS_PATH=root+'/.e2e/browsers';browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 for(const [name,opts] of [['mobile',{...devices['iPhone 13'],defaultBrowserType:undefined}],['fullscreen',{viewport:{width:1920,height:1080}}]]){
  const {defaultBrowserType,...o}=opts;const ctx=await browser.newContext(o),page=await ctx.newPage();
  page.on('pageerror',e=>errors.push(name+': '+e.message));page.on('console',m=>{if(m.type()==='error')errors.push(name+' console: '+m.text());});
  page.on('request',r=>{const u=r.url();if(!u.startsWith(`http://127.0.0.1:${port}/`)&&!u.startsWith('data:')&&!u.startsWith('blob:'))external.push(u);});
  await page.goto(base+'?dev=1');await page.waitForTimeout(6000);await snap(page,name+'-01-landing');
  check(name+' loaded the installed bundle',await page.evaluate(b=>[...document.scripts].some(s=>s.src.includes(b)),bundle),bundle);
  if(candidate&&name==='mobile')check(name+' connected empty world says so (not "waiting to connect")',await page.getByText('No Souls live here yet. Sign in to bring the first one.').count()===1);
  check(name+' no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  // First user: sign in with a new local demo name, then open account / Soul creation.
  page.on('dialog',dl=>void dl.accept('newcomer-'+name));
  try{
   await page.getByRole('button',{name:'Sign in to meet your Soul'}).click();await page.waitForTimeout(2500);await snap(page,name+'-02-signed-in');
   const manage=page.locator('button').filter({hasText:/Soul and account|Create|Bring|your Soul/i}).first();
   writeFileSync(`${run}/${name}-02-buttons.json`,JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('button,a,input,textarea,select')].filter(e=>e.offsetParent).map(e=>({tag:e.tagName,t:(e.textContent||e.getAttribute('aria-label')||e.getAttribute('placeholder')||e.id||'').trim().slice(0,70)}))),null,1));
   if(candidate)check(name+' first-Soul call to action after sign-in',await page.getByRole('button',{name:'Bring your first Soul'}).count()===1);
   await page.getByRole('button',{name:/Bring your first Soul|Soul and account tools/}).click();await page.waitForTimeout(2000);await snap(page,name+'-03-account');
   writeFileSync(`${run}/${name}-03-controls.json`,JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('button,a,input,textarea,select,label')].filter(e=>e.offsetParent).map(e=>({tag:e.tagName,id:e.id,t:(e.textContent||e.getAttribute('aria-label')||e.getAttribute('placeholder')||'').trim().slice(0,90)}))),null,1));
   const controls=async step=>writeFileSync(`${run}/${name}-${step}-controls.json`,JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('button,a,input,textarea,select,label,[role=status],[role=alert]')].filter(e=>e.offsetParent).map(e=>({tag:e.tagName,id:e.id,t:(e.textContent||e.getAttribute('aria-label')||e.getAttribute('placeholder')||'').trim().slice(0,120)}))),null,1));
   const inv=await (await fetch(base+'/v1/admin',{method:'POST',headers:{authorization:'Bearer dev:admin','content-type':'application/json'},body:JSON.stringify({action:'invite',uses:1,note:'app fake0 '+name})})).json();
   checks.push({name:name+' admin minted invite',pass:!!inv.code,detail:inv.ok});
   await page.locator('#invite-code').fill(inv.code);await page.getByRole('button',{name:'Continue'}).click();await page.waitForTimeout(2500);await snap(page,name+'-04-invited');await controls('04');
   const t0=Date.now();await page.getByLabel('Name').fill(name==='mobile'?'Mira':'Tomas');await page.getByLabel('Who are they?').fill('A curious gardener who likes the lake.');
   await page.getByRole('button',{name:'Request arrival'}).click();await page.waitForTimeout(1500);await snap(page,name+'-05-requested');await controls('05');
   for(let i=0;i<60;i++){if(await page.getByText(/arrived|is here|has arrived|Give .* direction/i).count())break;await page.waitForTimeout(1000);}
   checks.push({name:name+' arrival seconds',pass:true,detail:(Date.now()-t0)/1000});
   if(candidate)check(name+' arrival is plain and points back to the world',await page.getByText(/has arrived/).count()+await page.locator('#intent-direction').count()>0&&await page.getByText('Use the current Soul tools').count()===0);await snap(page,name+'-06-arrived');await controls('06');
   if(await page.getByRole('button',{name:'← Back to the world'}).count())await page.getByRole('button',{name:'← Back to the world'}).click();
   await page.waitForTimeout(2000);await snap(page,name+'-07-world');await controls('07');
   const box=page.locator('#intent-direction');
   if(!(await box.count())){const mine=page.getByRole('button',{name:/Mira|Tomas/}).first();if(await mine.count())await mine.click();await page.waitForTimeout(1500);}
   checks.push({name:name+' own direction box reachable after arrival',pass:await box.count()>0});
   await box.fill('go for a swim in the pond');await page.getByRole('button',{name:'Send direction'}).click();
   const diag=page.locator('section.request-diagnostics');await diag.getByRole('alert').waitFor({timeout:20000});await page.waitForFunction(()=>document.querySelector('section.request-diagnostics textarea')?.value.includes('Validated own-request-diagnostics/1'),null,{timeout:15000});
   await snap(page,name+'-08-direction');await controls('08');
   await page.waitForTimeout(800);check(name+' failure cause scrolled into view automatically',await diag.getByRole('alert').evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.top<innerHeight-40;}));
   check(name+' fake0 first direction: readable cause + live G414 diagnostics',(await diag.getByRole('alert').innerText()).includes('Direction service unavailable')&&(await diag.getByLabel('Complete request diagnostics').inputValue()).includes('"words": "go for a swim in the pond"'));
  }catch(e){checks.push({name:name+' first-user flow',pass:false,detail:String(e).slice(0,300)});if(!explore)throw e;}
  if(explore){writeFileSync(`${run}/${name}-buttons.json`,JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('button,a,[role=button]')].map(e=>({t:(e.textContent||e.getAttribute('aria-label')||'').trim().slice(0,60),vis:!!e.offsetParent}))),null,1));}
  await ctx.close();
 }
 status=checks.every(c=>c.pass)?'pass':'fail';
}finally{await browser?.close();server.kill('SIGTERM');await new Promise(r=>setTimeout(r,1500));
 writeFileSync(run+'/server.log',log);writeFileSync(run+'/summary.json',JSON.stringify({status,explore,run,bundle,port,checks,errors,external,fake:'BRAIN_MODE=fake, budget 0, fresh DATA_DIR, no credential',
  launcherDiff,effective:{harness:createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex'),distIndex:createHash('sha256').update(dist).digest('hex')}},null,2));
 console.log(JSON.stringify({status,run,checks:checks.length,failed:checks.filter(c=>!c.pass).map(c=>c.name),errors:errors.slice(0,5),external:external.slice(0,5)}));}
