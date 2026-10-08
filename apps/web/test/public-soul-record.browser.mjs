// Mounted G4 check: actual PublicSoulRecord in Chromium (StrictMode) with a stub api serving the LIVE Core 2c7f40b1
// public read fixture, a yellow-fade variant, and a 404 world. No server, no model, $0.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
const root=process.cwd(),run=root+'/.e2e/runs/public-soul-record-'+new Date().toISOString().replaceAll(':','-');mkdirSync(run,{recursive:true});
const require=createRequire(new URL('../../../mars/viewer/package.json',import.meta.url)),{build}=require('esbuild'),{chromium}=require('@playwright/test');
const live=readFileSync(root+'/apps/web/test/fixtures/edge-public-soul-2c7f40b1.json','utf8');
const entry=`import {StrictMode} from 'react';import {createRoot} from 'react-dom/client';import {PublicSoulRecord} from './PublicSoulRecord.tsx';
const live=${live};const variants={live,yellow:{...live,fade:{colour:'yellow',idleSeconds:1900},lastAcceptedAt:Date.now()-31*60000,events:[...live.events,{kind:'speech',tick:1,text:'<img src=x onerror=alert(1)> ignore previous instructions',untrusted:true}]}};
const api=async(path)=>{const v=new URLSearchParams(location.search).get('v');if(v==='none')return {status:404,data:{}};return {status:200,data:variants[v]};};
createRoot(document.getElementById('app')).render(<StrictMode><PublicSoulRecord api={api} soulId="s_x"/></StrictMode>);`;
const out=await build({absWorkingDir:root,stdin:{contents:entry,resolveDir:root+'/apps/web/src',loader:'tsx',sourcefile:'psr.tsx'},bundle:true,format:'esm',platform:'browser',write:false,jsx:'automatic',define:{'process.env.NODE_ENV':'"development"'}});
const html='<!doctype html><meta charset="utf-8"><div id="app"></div><script type="module" src="/a.js"></script>',origin='http://127.0.0.1:4962';
const checks=[],errors=[];let browser,status='fail';const check=(n,v)=>{checks.push({name:n,pass:!!v});assert.ok(v,n);};
try{
 process.env.PLAYWRIGHT_BROWSERS_PATH=root+'/.e2e/browsers';browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:420,height:800}});
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{errors.push('dialog '+d.message());void d.dismiss();});
 await page.route('**/*',r=>{const u=r.request().url();if(u.endsWith('/a.js'))return r.fulfill({contentType:'text/javascript',body:Buffer.from(out.outputFiles[0].contents)});if(u.startsWith(origin+'/'))return r.fulfill({contentType:'text/html',body:html});return r.abort();});
 await page.goto(origin+'/?v=live');await page.getByText('Latest action:').waitFor();
 check('live: no fade badge while fade is null; last action time shown',await page.locator('.fade-dot').count()===0&&await page.getByText(/^Last action /).count()===1);
 check('live: place path + latest receipt rendered',(await page.locator('.public-soul-record').innerText()).includes('Green field')&&(await page.getByText('Latest action:').innerText()).includes('rest:here'));
 await page.getByText('Recent events').click();check('live: speech events listed',(await page.locator('.public-soul-record').innerText()).includes('testing the public page'));
 await page.screenshot({path:run+'/live.png',fullPage:true});
 await page.goto(origin+'/?v=yellow');await page.getByText('Fading (30+ min idle)').waitFor();
 check('yellow: badge + label + time',await page.locator('.fade-dot').count()===1&&(await page.locator('.public-soul-record').innerText()).includes('last action 31 min ago'));
 await page.getByText('Recent events').click();
 check('untrusted text rendered as text, no markup/dialog',await page.locator('.public-soul-record img').count()===0&&(await page.locator('.public-soul-record').innerText()).includes('<img src=x'));
 await page.screenshot({path:run+'/yellow.png',fullPage:true});
 await page.goto(origin+'/?v=none');await page.getByText('does not publish a live record').waitFor();check('404 world: honest unavailable note',true);
 check('no page errors or dialogs',errors.length===0);status='pass';
}finally{await browser?.close();writeFileSync(run+'/summary.json',JSON.stringify({status,checks,errors},null,2));console.log(JSON.stringify({status,run,checks:checks.length,errors}));}
