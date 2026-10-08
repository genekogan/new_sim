// Scoped connection-card identity/startup qualification; no previous suite rerun.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=process.cwd(),run=root+'/.e2e/runs/connection-scope-'+new Date().toISOString().replaceAll(':','-'),web=run+'/web';
mkdirSync(web+'/assets',{recursive:true});
const require=createRequire(new URL('../../../mars/viewer/package.json',import.meta.url)),{build}=require('esbuild'),{chromium}=require('@playwright/test');
const baseline=process.argv.includes('--baseline');
const entry=`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {AgentConnection} from './AgentConnection.tsx';import {makeApi} from './useSim.ts';
const ids=await (await fetch('/fixture-ids')).json(),api=makeApi(async()=> 'dev:admin');
function Fixture(){const [id,setId]=useState(ids[0]),[base,setBase]=useState(location.origin+'/w/toy'),[connection,setConnection]=useState({attached:false,label:null,since:null,last_used:null});window.card={soul:()=>setId(ids[1]),world:()=>setBase(location.origin+'/w/toy-alternate'),checking:()=>setConnection(null),attached:()=>setConnection({attached:true,label:'Fixture assistant',since:1,last_used:null}),base:()=>base};
return <main><AgentConnection api={api} soulId={id} name={id===ids[0]?'First Soul':'Second Soul'} base={base} connection={connection} refresh={()=>{}}/></main>;}
const root=createRoot(document.querySelector('#app'));root.render(<Fixture/>);window.unmount=()=>root.unmount();`;

await build({absWorkingDir:root,stdin:{contents:entry,resolveDir:root+'/apps/web/src',sourcefile:'connection-scope-fixture.tsx',loader:'tsx'},bundle:true,format:'esm',platform:'browser',outfile:web+'/assets/fixture.js',jsx:'automatic',plugins:baseline?[{name:'pinned-baseline',setup(b){b.onLoad({filter:/AgentConnection\.tsx$/},({path})=>({contents:execFileSync('git',['show','613100e:'+path.slice(root.length+1)],{encoding:'utf8'}),loader:'tsx'}));}}]:[],define:{__BUILD__:'"dev"','process.env.NODE_ENV':'"development"'}});
writeFileSync(web+'/assets/styles.css',readFileSync(root+'/apps/web/src/styles.css'));
writeFileSync(web+'/index.html','<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connection scope fixture</title><link rel="stylesheet" href="/w/toy/assets/styles.css"><style>main{max-width:700px;margin:24px auto;padding:16px}body{font:15px system-ui}</style><div id="app"></div><script type="module" src="/w/toy/assets/fixture.js"></script>');
const base='http://127.0.0.1:4963/w/toy';
const server=spawn(process.execPath,['apps/server/src/main.ts'],{env:{PATH:process.env.PATH,PORT:'4963',HOST:'127.0.0.1',WORLD_KEY:'toy',WORLD_PATH:'/w/toy',WORLD_ID:'toy-1',PUBLIC_URL:base,DEV_AUTH:'1',ENGINE:'toy',BRAIN_MODE:'fake',BRAIN_BUDGET_USD_PER_DAY:'0',SEED_NATIVES:'0',DATA_DIR:run+'/data',WEB_DIR:web},stdio:['ignore','pipe','pipe']});
let log='',browser,page,status='fail';server.stdout.on('data',b=>log+=b);server.stderr.on('data',b=>log+=b);
const checks=[],errors=[],external=[],writes=[];const check=(name,value)=>{assert.ok(value,name);checks.push({name,pass:true});};
try{
 let ready=false;for(let i=0;i<100&&!ready;i++){try{ready=(await fetch(base+'/healthz')).ok;}catch{}if(!ready)await new Promise(r=>setTimeout(r,100));}assert.ok(ready,'fresh isolated server');
 const ids=[];for(const name of ['First Soul','Second Soul']){const r=await fetch(base+'/v1/souls',{method:'POST',headers:{authorization:'Bearer dev:admin','content-type':'application/json'},body:JSON.stringify({name,description:'Local scoped connection fixture.'})});assert.equal(r.status,200);ids.push((await r.json()).soul.id);}
 process.env.PLAYWRIGHT_BROWSERS_PATH=root+'/.e2e/browsers';browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
 page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'||r.method()==='DELETE')writes.push(r.url());});
 await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:4963/')?r.continue():(external.push(r.request().url()),r.abort()));
 await page.route('**/fixture-ids',route=>route.fulfill({json:ids}));
 let release,entered;const waiting=new Promise(r=>entered=r),hold=new Promise(r=>release=r);
 await page.route('**/v1/souls/'+ids[0]+'/pair',async route=>{const response=await route.fetch();entered();await hold;await route.fulfill({response});});
 await page.goto(base);const card=page.getByRole('region',{name:'Assistant connection'});await card.getByRole('heading',{name:'Your assistant and First Soul',exact:true}).waitFor();
 await card.getByText('Advanced: one-use owner code',{exact:true}).click();await card.getByRole('button',{name:'Request one-use code',exact:true}).click();await waiting;
 await page.evaluate(()=>window.card.soul());await card.getByRole('heading',{name:'Your assistant and Second Soul',exact:true}).waitFor();release();await page.waitForTimeout(100);
 check('Delayed first-Soul code never appears under second-Soul context',await card.locator('code').count()===0&&await card.getByText('Code requested. Your assistant is not connected by this code alone.',{exact:true}).count()===0);
 await card.getByText('Advanced: one-use owner code',{exact:true}).click();await card.getByRole('button',{name:'Request one-use code',exact:true}).click();await card.locator('code').waitFor();
 check('Current Soul can request its own actual one-use code',await card.locator('code').count()===1);
 await page.evaluate(()=>window.card.world());await card.getByRole('heading',{name:'Your assistant and Second Soul',exact:true}).waitFor();
 check('World-context change clears a previously displayed code and message',await card.locator('code').count()===0&&await card.getByText('Code requested. Your assistant is not connected by this code alone.',{exact:true}).count()===0);
 await card.getByText('World and Soul details for your assistant',{exact:true}).click();
 check('Setup metadata now names the exact new world and current Soul without credentials',await card.locator('pre').innerText().then(t=>t.includes('/w/toy-alternate')&&t.includes(ids[1])&&!t.includes('sim_')));
 await page.evaluate(()=>window.card.checking());await card.getByText('Checking connection…',{exact:true}).waitFor();await card.getByText('Advanced: one-use owner code',{exact:true}).click();
 const before=writes.length;check('Unconfirmed connection disables credential request',await card.getByRole('button',{name:'Request one-use code',exact:true}).isDisabled());
 await page.screenshot({path:run+'/checking.png'});writeFileSync(run+'/checking.yml',await page.locator('body').ariaSnapshot());
 await page.evaluate(()=>window.card.attached());await card.getByText('Fixture assistant',{exact:true}).waitFor();
 check('Granted access does not claim the assistant is currently running',await card.getByText('This records granted access. Check your assistant to confirm it is running and receiving this world.',{exact:true}).isVisible()&&writes.length===before);
 await page.screenshot({path:run+'/access-granted.png'});writeFileSync(run+'/access-granted.yml',await page.locator('body').ariaSnapshot());
 await page.evaluate(()=>window.unmount());await page.waitForFunction(()=>document.querySelectorAll('canvas').length===0);
 check('Only the two explicit code requests, no errors/external requests; teardown',writes.length===2&&errors.length===0&&external.length===0);status='pass';
}catch(e){if(page){await page.screenshot({path:run+'/failure.png'});writeFileSync(run+'/failure.yml',await page.locator('body').ariaSnapshot());}writeFileSync(run+'/failure.txt',String(e.stack??e));throw e;}
finally{await browser?.close();server.kill('SIGINT');await once(server,'close');writeFileSync(run+'/server.log',log);
 const files=['apps/web/src/AgentConnection.tsx','apps/web/src/styles.css','apps/web/test/connection-scope.browser.mjs'];writeFileSync(run+'/sources.json',JSON.stringify(Object.fromEntries(files.map(p=>[p,createHash('sha256').update(baseline&&p.endsWith('/AgentConnection.tsx')?execFileSync('git',['show','613100e:'+p]):readFileSync(root+'/'+p)).digest('hex')])),null,2));for(const p of files)writeFileSync(run+'/'+p.split('/').at(-1),baseline&&p.endsWith('/AgentConnection.tsx')?execFileSync('git',['show','613100e:'+p]):readFileSync(root+'/'+p));
 writeFileSync(run+'/summary.json',JSON.stringify({status,checks,errors,external,writes,baseline,scope:'actual AgentConnection/current-G Toy API; synthetic component Soul/world/connection props and held delivery, no real sign-in/native admission/device or private-policy qualification',paid:0},null,2));writeFileSync(run+'/run.md','# Scoped assistant connection\n\nNew scoped component identity/startup paths. Actual AgentConnection/current-G Toy and fake minds; explicit local auth wrapper. No real login/native admission/device-performance proof. Browser/own4963 closed; old passing suites untouched.\n');writeFileSync(run+'/index.html','<h1>Scoped connection '+status+'</h1><a href="summary.json">Checks and limits</a><img style="max-width:100%" src="checking.png"><img style="max-width:100%" src="access-granted.png">');console.log(JSON.stringify({status,checks:checks.length,run}));}
