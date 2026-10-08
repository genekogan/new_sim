// PM-R037 repro/fix: actual SoulFocus (StrictMode, headless Chromium) with a fake api. A transient
// dashboard poll failure (5xx / thrown) during a Soul state change must not remount IntentDirection
// and erase the open lookup, its result and diagnostics. Auth/foreign answers must still retire them.
// Baseline = installed 562870fa SoulFocus (expected to lose state); current = fix. No server/model/$0.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=process.cwd(),run=root+'/.e2e/runs/soulfocus-transient-'+new Date().toISOString().replaceAll(':','-');mkdirSync(run,{recursive:true});
const require=createRequire(new URL('../../../mars/viewer/package.json',import.meta.url)),{build}=require('esbuild'),{chromium}=require('@playwright/test');
const origin='http://127.0.0.1:4967',baselinePin='562870fa',id='7d411406-a83c-4a69-a0f9-0baf94082190';
const saved=JSON.parse(readFileSync('<team>/pm-integration/p0-interaction-broadcast-20261006/EXACT-SAVED-REQUESTS.json','utf8')),classroom=saved.find(r=>r.requestId===id).receipt;
const entry=`import {StrictMode} from 'react';import {createRoot} from 'react-dom/client';import {SoulFocus} from './SoulFocus.tsx';
const W='pm-preview-eden-20261005',S='s_4158faee14';window.mode='ok';
const status={id:S,name:'Alice',description:'Fixture',in_world:true,tick:1,time:'day',position:{x:0,y:0,z:0},activity:'seated',doing:'sit on fire bench',mood:'calm',energy:'ok',wants_company:0.5,needs:{},journal:'',reflected_day:0,customs:[],mandate:[],intent:null,intent_text:'',agenda:[],recent:[],nearby:[],happening:'',storyteller_suggests:null,next_think_in_s:10,available_now:[]};
const control=o=>({worldId:W,soulId:S,ownerId:o,intentContract:'soul-intent/2'});
async function api(path,body,method){
 if(path==='/v1/souls/'+S){const m=window.mode;if(m==='throw')throw new Error('network');if(m==='500')return {status:500,data:{message:'busy'}};if(m==='403')return {status:403,data:{message:'forbidden'}};
  return {status:200,data:{status,control:control(m==='foreign'?'dev:bob':'dev:admin')}};}
 if(path.startsWith('/v1/souls/'+S+'/timeline'))return {status:200,data:{events:[]}};
 if(path.endsWith('/diagnostics'))return {status:404,data:{message:'not found'}};
 if(path.includes('/intent-v2/requests/'))return {status:200,data:${JSON.stringify(classroom)}};
 return {status:404,data:{message:'not found'}};}
const me={userId:'dev:admin',role:'admin',invited:true,souls:[S]};
const auth={ready:true,authed:true,label:'dev:admin',debug:{privyUserId:null,wallet:null,linked:[]},login(){},logout(){},getToken:async()=>'dev:admin'};
const sim={me,conn:{welcome:{worldId:W,epoch:'e1',build:'fixture'},replica:{tick:1,souls:new Map([[S,{id:S,name:'Alice',description:'Fixture',entityId:'h_4158faee14'}]]),entities:{}}},plays:[]};
createRoot(document.querySelector('#app')).render(<StrictMode><SoulFocus sim={sim} api={api} auth={auth} selected={S} select={()=>{}} manage={()=>{}} active/></StrictMode>);`;
const css=readFileSync(root+'/apps/web/src/styles.css'),html='<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/assets/styles.css"><div id="app"></div><script type="module" src="/assets/fixture.js"></script>';
async function bundle(baseline){const out=await build({absWorkingDir:root,stdin:{contents:entry,resolveDir:root+'/apps/web/src',loader:'tsx',sourcefile:'soulfocus-transient.tsx'},bundle:true,format:'esm',platform:'browser',write:false,jsx:'automatic',define:{__BUILD__:'"dev"','process.env.NODE_ENV':'"development"'},
 plugins:baseline?[{name:'baseline',setup(b){b.onLoad({filter:/src\/SoulFocus\.tsx$/},()=>({contents:execFileSync('git',['show',baselinePin+':apps/web/src/SoulFocus.tsx'],{encoding:'utf8'}),loader:'tsx'}));}}]:[]});return out.outputFiles[0].contents;}
const effective={'apps/web/src/SoulFocus.tsx':createHash('sha256').update(readFileSync(root+'/apps/web/src/SoulFocus.tsx')).digest('hex'),baseline:baselinePin};
const results={};let browser;
async function scenario(name,baseline){
 const js=await bundle(baseline),page=await browser.newPage({viewport:{width:1000,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',r=>{const u=r.request().url();if(u===origin+'/')return r.fulfill({contentType:'text/html',body:html});if(u.endsWith('/assets/fixture.js'))return r.fulfill({contentType:'text/javascript',body:Buffer.from(js)});if(u.endsWith('/assets/styles.css'))return r.fulfill({contentType:'text/css',body:css});return r.abort();});
 await page.goto(origin+'/');await page.locator('#intent-direction').waitFor();
 await page.getByText('Check a previous direction',{exact:true}).click();await page.locator('#intent-reference').fill(id);await page.getByRole('button',{name:'Check reference'}).click();
 const diag=page.locator('section.request-diagnostics');await diag.getByRole('alert').waitFor();
 const kept=async()=>await diag.count()===1&&await page.locator('#intent-reference').count()===1&&await page.locator('#intent-reference').inputValue()===id&&await page.locator('details.intent-lookup').evaluate(d=>d.open);
 const r={};
 for(const m of ['500','throw','ok']){await page.evaluate(v=>{window.mode=v;},m);await page.waitForTimeout(3600);r['kept after '+m]=await kept();}
 await page.screenshot({path:`${run}/${name}-after-transient.png`,fullPage:true});
 await page.evaluate(()=>{window.mode='403';});await page.waitForTimeout(3600);r['retired on 403']=await page.locator('#intent-direction').count()===0&&await diag.count()===0;
 await page.evaluate(()=>{window.mode='ok';});await page.waitForTimeout(3600);
 await page.evaluate(()=>{window.mode='foreign';});await page.waitForTimeout(3600);r['retired on foreign owner']=await page.locator('#intent-direction').count()===0;
 r.errors=errors;await page.close();return r;}
let status='fail';
try{
 process.env.PLAYWRIGHT_BROWSERS_PATH=root+'/.e2e/browsers';browser=await chromium.launch({headless:true});
 results.baseline=await scenario('baseline',true);results.fixed=await scenario('fixed',false);
 assert.equal(results.baseline['kept after 500'],false,'baseline reproduces PM-R037 loss on transient 5xx');
 for(const k of ['kept after 500','kept after throw','kept after ok','retired on 403','retired on foreign owner'])assert.equal(results.fixed[k],true,'fixed: '+k);
 assert.equal(results.fixed.errors.length,0);status='pass';
}finally{await browser?.close();writeFileSync(run+'/summary.json',JSON.stringify({status,results,effective,fake:'no server, no model, $0'},null,2));console.log(JSON.stringify({status,run,results}));}
