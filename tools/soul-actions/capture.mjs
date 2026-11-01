import {createRequire} from 'node:module';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../../mars/viewer/package.json',import.meta.url));const {chromium}=require('@playwright/test');
const browser=await chromium.launch({channel:'chrome',headless:true});
try{const context=await browser.newContext({viewport:{width:1200,height:900},recordVideo:{dir:process.env.SOUL_ACTIONS_OUT,size:{width:1200,height:900}}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
await page.goto('http://127.0.0.1:7851/tools/soul-actions/light-fixture.html');await page.waitForFunction(()=>window.day1?.ready,{timeout:30000});const stats={};
for(const state of ['on','off','on']){await page.evaluate(s=>window.day1.show(s),state);await page.waitForTimeout(1200);stats[state]=await page.evaluate(()=>window.day1.stats);await page.screenshot({path:process.env.SOUL_ACTIONS_OUT+'/lights-'+state+'.png'});}
for(const s of stats.off.filter(s=>s.name!=='bowl'))assert.ok(s.emissive.length && s.emissive.every(i=>i===0));for(const s of stats.on.filter(s=>s.name!=='bowl'))assert.ok(s.emissive.some(i=>i>0));assert.deepEqual(errors,[]);const video=page.video();await context.close();await video.saveAs(process.env.SOUL_ACTIONS_OUT+'/switching.webm');writeFileSync(process.env.SOUL_ACTIONS_OUT+'/renderer.json',JSON.stringify({status:'pass',stats,errors,limitation:'Production mesh/glow renderer of native on/off snapshots; no live websocket or natural-language mind proof.'},null,2));console.log('Renderer on/off assertions passed; images and video saved.');}finally{await browser.close();}
