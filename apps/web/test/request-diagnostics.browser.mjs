// Mounted P0A check: actual IntentDirection/IntentLookup/RequestDiagnostics under React StrictMode in
// headless Chromium. Fake api only: no server, no model, $0. Exact saved Alice receipts. Does NOT
// qualify the installed 4970 user environment, real auth, or Core's G414 producer.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root=process.cwd(),stamp=new Date().toISOString().replaceAll(':','-'),run=root+'/.e2e/runs/request-diagnostics-'+stamp;mkdirSync(run,{recursive:true});
const require=createRequire(new URL('../../../mars/viewer/package.json',import.meta.url)),{build}=require('esbuild'),{chromium}=require('@playwright/test');
if(!process.env.SIM_SAVED_REQUESTS){console.log('skip: set SIM_SAVED_REQUESTS to the saved p0 receipts (EXACT-SAVED-REQUESTS.json, not in the repo)');process.exit(0);}
const origin='http://127.0.0.1:4966',saved=JSON.parse(readFileSync(process.env.SIM_SAVED_REQUESTS,'utf8'));
const classroom=saved.find(r=>r.request.words==='go to the classroom').receipt,swim=saved.find(r=>r.request.words==='go for a swim in the pond').receipt;
const entry=`import {StrictMode} from 'react';import {createRoot} from 'react-dom/client';import {IntentDirection} from './IntentDirection.tsx';
const calls=[];window.calls=calls;
async function api(path,body,method){const verb=method??(body!==undefined?'POST':'GET');calls.push({verb,path});const s=window.scenario;
 if(verb==='POST'&&path.endsWith('/intent-v2'))return {status:200,data:{...s.receipt,requestId:body.requestId,...(s.receipt.revision?{revision:{...s.receipt.revision,requestId:body.requestId}}:{})}};
 if(path.endsWith('/diagnostics')){const id=decodeURIComponent(path.split('/requests/')[1].split('/')[0]);const d=s.diagSeq?s.diagSeq[Math.min(s.step??0,s.diagSeq.length-1)]:s.diag;return {status:s.diagStatus,data:d?{...d,requestId:d.requestId??id}:s.diagBody};}
 if(verb==='GET'&&path.includes('/requests/')){const id=decodeURIComponent(path.split('/requests/')[1]);return {status:200,data:{...s.receipt,requestId:id,...(s.receipt.revision?{revision:{...s.receipt.revision,requestId:id}}:{})}};}
 return {status:404,data:{message:'not found'}};}
createRoot(document.querySelector('#app')).render(<StrictMode><IntentDirection api={api} worldId="pm-preview-eden-20261005" soulId="s_4158faee14" soulName="Alice" ownerId="dev:admin" authorityKey="fixture" active entityId="h_4158faee14" diagnosticContext={{backendBuild:'local-classroom-readiness-mvp-20261006',body:{activity:'sleeping',tick:1953448}}}/></StrictMode>);`;
const sources=['apps/web/src/RequestProgress.tsx','apps/web/src/use-own-request-diagnostics.ts','apps/web/src/IntentDirection.tsx','apps/web/src/IntentLookup.tsx','apps/web/src/RequestDiagnostics.tsx','apps/web/src/request-diagnostics.ts','apps/web/src/SoulFocus.tsx','apps/web/test/request-diagnostics.browser.mjs'];
const effective=Object.fromEntries(sources.map(f=>[f,createHash('sha256').update(readFileSync(root+'/'+f)).digest('hex')]));
const out=await build({absWorkingDir:root,stdin:{contents:entry,resolveDir:root+'/apps/web/src',loader:'tsx',sourcefile:'request-diagnostics-fixture.tsx'},bundle:true,format:'esm',platform:'browser',write:false,jsx:'automatic',define:{__BUILD__:'"dev"','process.env.NODE_ENV':'"development"'}});
const bundle=out.outputFiles[0].contents,css=readFileSync(root+'/apps/web/src/styles.css');
const html='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Request diagnostics fixture</title><link rel="stylesheet" href="/assets/styles.css"><div id="app"></div><script type="module" src="/assets/fixture-diagnostics.js"></script>';
const source={channel:'web',kind:'owner',ownerId:'dev:admin',principalId:'dev:admin'};
const dto=(over={})=>({contract:'own-request-diagnostics/1',worldId:'pm-preview-eden-20261005',soulId:'s_4158faee14',entityId:'h_4158faee14',source,server:{createdAt:1791314114856,updatedAt:1791314118954,build:'local-classroom-readiness-mvp-20261006'},stage:'refused',code:'compilation-failure.schema',
 validation:{code:'schema',detail:'goals[0].bindingId: expected registered binding'},body:{tick:1953300,activity:'sleeping',controller:'native-sleep',programme:'sleep-night',sleep:'asleep',busy:true,busyReason:'Night sleep programme active.'},unavailable:[{field:'queue',reason:'Queue is not tracked for refused requests.'}],...over});
const checks=[],errors=[],external=[];const check=(name,value)=>{assert.ok(value,name);checks.push({name,pass:true});};
let browser,status='fail';
try{
 process.env.PLAYWRIGHT_BROWSERS_PATH=root+'/.e2e/browsers';browser=await chromium.launch({headless:true});
 const ctx=await browser.newContext({viewport:{width:1000,height:900}});await ctx.grantPermissions(['clipboard-read','clipboard-write'],{origin});
 const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.route('**/*',r=>{const u=r.request().url();if(u===origin+'/')return r.fulfill({contentType:'text/html',body:html});if(u===origin+'/assets/fixture-diagnostics.js')return r.fulfill({contentType:'text/javascript',body:Buffer.from(bundle)});if(u===origin+'/assets/styles.css')return r.fulfill({contentType:'text/css',body:css});external.push(u);return r.abort();});
 const scenario=s=>page.evaluate(v=>{window.scenario=v;},s);
 const own=page.locator('section.intent-direction > section.request-diagnostics');
 await page.goto(origin+'/');await scenario({receipt:classroom,diagStatus:404,diagBody:{message:'not found'}});
 // A. Exact classroom refusal, G414 absent on this backend.
 await page.locator('#intent-direction').fill('go to the classroom');await page.getByRole('button',{name:'Send direction'}).click();
 await own.getByRole('alert').waitFor();
 check('A readable precise cause appears automatically',(await own.getByRole('alert').innerText()).includes('Alice cannot go to eden classroom 1 right now')&&(await own.getByRole('alert').innerText()).includes('cannot be stopped safely'));
 check('A generic message replaced, misleading binding text absent from visible cause',await page.getByText('Cannot do that right now',{exact:true}).count()===0);
 const area=own.getByLabel('Complete request diagnostics');await page.waitForFunction(()=>!document.querySelector('section.intent-direction > section.request-diagnostics p.small')?.textContent?.includes('Reading server diagnostics'));
 check('A diagnostics visible and not inside any collapsed details',await area.isVisible()&&await area.evaluate(e=>e.closest('details')===null));
 check('A cause precedes diagnostics text',await own.evaluate(s=>!!(s.querySelector('[role=alert]').compareDocumentPosition(s.querySelector('textarea'))&Node.DOCUMENT_POSITION_FOLLOWING)));
 const a=JSON.parse(await area.inputValue()),posts=await page.evaluate(()=>calls.filter(c=>c.verb==='POST'));
 check('A copied text names the Soul',a.cause.headline==='Alice cannot go to eden classroom 1 right now');
 check('A own words/reference/code/binding/frontend present',a.request.words==='go to the classroom'&&posts.length===1&&a.request.reference&&posts[0].path.endsWith('/intent-v2')&&a.response.code==='state-blocked.program.safe-stop-required'&&a.interpretation.binding==='walk:eden-classroom-1'&&a.versions.loadedFrontend==='fixture-diagnostics.js');
 check('A missing server fields explicit unavailable with reason',['controller','programme','sleepState','queue','admitted','started','completed'].every(k=>/^Unavailable — server diagnostics: Not provided by this server \(HTTP 404\)/.test(a.physical[k])));
 await own.getByRole('button',{name:'Copy diagnostics'}).click();await own.getByRole('status').waitFor();
 check('A copy works under StrictMode and copies exactly the shown text',(await own.getByRole('status').innerText())==='Diagnostics copied.'&&await page.evaluate(()=>navigator.clipboard.readText())===await area.inputValue());
 await area.click();check('A text is selectable (focus selects all)',await area.evaluate(e=>e.selectionStart===0&&e.selectionEnd===e.value.length));
 await page.waitForTimeout(2500);check('A no resend: one POST, only GET reads otherwise',(await page.evaluate(()=>calls.filter(c=>c.verb==='POST').length))===1&&(await page.evaluate(()=>calls.every(c=>c.verb==='POST'||c.verb==='GET'))));
 await page.screenshot({path:run+'/A-classroom-desktop.png',fullPage:true});writeFileSync(run+'/A-classroom.yml',await page.locator('body').ariaSnapshot());
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:run+'/A-classroom-mobile.png',fullPage:true});
 check('A mobile width has no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));await page.setViewportSize({width:1000,height:900});
 // B. Exact swim compilation failure with a valid G414 DTO.
 await page.getByRole('button',{name:'Give another direction'}).click();check('B reset removes previous diagnostics',await own.count()===0);
 await scenario({receipt:swim,diagStatus:200,diag:dto()});
 await page.locator('#intent-direction').fill('go for a swim in the pond');await page.getByRole('button',{name:'Send direction'}).click();await own.getByRole('alert').waitFor();
 await page.waitForFunction(()=>document.querySelector('section.intent-direction > section.request-diagnostics textarea')?.value.includes('native-sleep'));
 const b=JSON.parse(await own.getByLabel('Complete request diagnostics').inputValue());
 check('B schema cause is specific and producer free text is not echoed',(await own.getByRole('alert').innerText()).includes('format the world does not accept')&&await page.getByText('invalid goal plan').count()===0&&!JSON.stringify(b).includes('invalid goal plan'));
 check('B G414 fields shown: controller/programme/sleep/busy/server time/validation; queue reason explicit',b.physical.controller==='native-sleep'&&b.physical.programme==='sleep-night'&&b.physical.sleepState==='asleep'&&b.physical.busyCondition==='Night sleep programme active.'&&b.timestamps.serverCreated===new Date(1791314114856).toISOString()&&b.redactedException.code==='schema'&&b.physical.queue==='Queue is not tracked for refused requests.');
 await page.screenshot({path:run+'/B-swim-g414.png',fullPage:true});
 // C. Foreign / malformed DTO never reaches the DOM.
 await page.getByRole('button',{name:'Give another direction'}).click();
 await scenario({receipt:classroom,diagStatus:200,diag:dto({soulId:'s_other',validation:{code:'x',detail:'CANARY_FOREIGN_DTO'}})});
 await page.locator('#intent-direction').fill('go to the classroom');await page.getByRole('button',{name:'Send direction'}).click();await own.getByRole('alert').waitFor();
 await page.waitForFunction(()=>document.querySelector('section.intent-direction > section.request-diagnostics textarea')?.value.includes('did not match'));
 check('C foreign DTO refused; canary and foreign Soul absent from page',!(await page.content()).includes('CANARY_FOREIGN_DTO')&&!(await page.content()).includes('s_other'));
 await scenario({receipt:classroom,diagStatus:200,diag:dto({hidden_reasoning:'CANARY_REASONING'})});
 // D. Reference lookup shows cause + diagnostics outside its collapsed input.
 await page.getByText('Check a previous direction').click();await page.locator('#intent-reference').fill(classroom.requestId);await page.getByRole('button',{name:'Check reference'}).click();
 const lookup=page.locator('section.intent-direction > section.request-diagnostics').last();
 await page.waitForFunction(id=>[...document.querySelectorAll('section.request-diagnostics textarea')].some(t=>t.value.includes(id)&&t.value.includes('failed validation')),classroom.requestId);
 await page.evaluate(()=>{document.querySelector('details.intent-lookup').open=false;});
 check('D lookup diagnostics remain visible after collapsing its input',await lookup.getByLabel('Complete request diagnostics').isVisible()&&await lookup.evaluate(e=>e.closest('details')===null));
 check('D extra-key DTO refused without echo',!(await page.content()).includes('CANARY_REASONING'));
 await page.screenshot({path:run+'/D-lookup.png',fullPage:true});
 // E. PM-R041: understood direction shows actual controller phase (quiet-hours waiting -> started -> completed), words in lookup.
 const understood=JSON.parse(readFileSync(root+'/apps/web/test/fixtures/intent-understood-84f87524.json','utf8')),liveDto=JSON.parse(readFileSync(root+'/apps/web/test/fixtures/g414-live-4970-phases.json','utf8')).completed;
 const strip=({requestId,...d})=>d,waitDto={...strip(liveDto),attempts:[],unavailable:[],resolution:{...liveDto.resolution,failedCondition:'quiet-renewal'}},startDto={...waitDto,resolution:liveDto.resolution,attempts:liveDto.attempts.slice(0,2)},doneDto={...waitDto,resolution:liveDto.resolution,attempts:liveDto.attempts};
 await page.goto(origin+'/');await scenario({receipt:understood,diagStatus:200,diagSeq:[waitDto,startDto,doneDto]});
 await page.locator('#intent-direction').fill('go to the classroom');await page.getByRole('button',{name:'Send direction'}).click();
 const prog=page.locator('section.intent-direction > div[aria-live] .request-progress');await prog.getByText('Waiting to start').waitFor();
 check('E quiet hours: waiting with reason, no unconfirmed-completion text',(await prog.innerText()).includes('quiet hours')&&await page.getByText('has not been confirmed').count()===0);
 await page.screenshot({path:run+'/E-waiting.png',fullPage:true});
 await page.evaluate(()=>{window.scenario.step=1;});await prog.getByText('In progress').waitFor({timeout:8000});check('E started phase shown',true);
 await page.evaluate(()=>{window.scenario.step=2;});await prog.getByText('Completed').waitFor({timeout:8000});check('E completed phase shown with destination',(await prog.innerText()).includes('Done: Eden east classroom.'));
 const n1=await page.evaluate(()=>calls.filter(c=>c.path.endsWith('/diagnostics')).length);await page.waitForTimeout(5000);const n2=await page.evaluate(()=>calls.filter(c=>c.path.endsWith('/diagnostics')).length);
 check('E polling stops after terminal phase',n2===n1);check('E no failure diagnostics for understood',await own.count()===0);
 await page.screenshot({path:run+'/E-completed.png',fullPage:true});
 await page.getByText('Check a previous direction',{exact:true}).click();await page.locator('#intent-reference').fill(understood.requestId);await page.getByRole('button',{name:'Check reference'}).click();
 await page.getByText('Your words: “go to the classroom”',{exact:true}).last().waitFor();await page.locator('section.intent-direction .request-progress').last().getByText('Completed').waitFor({timeout:8000});
 check('E lookup shows own words visibly and actual phase',await page.locator('details.intent-lookup').evaluate(d=>{d.open=false;return true;})&&await page.getByText('Your words: “go to the classroom”',{exact:true}).last().isVisible());
 await page.screenshot({path:run+'/E-lookup.png',fullPage:true});
 check('no page errors',errors.length===0);check('no external requests',external.length===0);
 status='pass';
}catch(e){checks.push({name:'failure',pass:false,error:String(e?.stack??e)});throw e;}
finally{await browser?.close();writeFileSync(run+'/summary.json',JSON.stringify({status,run,checks,errors,external,effective,fake:'no server, no model, $0'},null,2));console.log(JSON.stringify({status,run,checks:checks.length,errors}));}
