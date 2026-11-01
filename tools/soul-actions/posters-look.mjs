// Entry 38: a look check of the poster wall and wanted/offered board faces (no Souls; not a real-client take).
import {createRequire} from 'node:module';import {mkdirSync} from 'node:fs';
const out=process.env.OUT,base=process.env.BASE;mkdirSync(out,{recursive:true});
const require=createRequire(new URL('../../mars/viewer/package.json',import.meta.url)),{chromium}=require('@playwright/test');
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await (await browser.newContext({viewport:{width:1440,height:1080}})).newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
const token=(await(await fetch(base+'/v1/god/mint',{method:'POST',headers:{authorization:'Bearer dev:admin','content-type':'application/json'},body:JSON.stringify({label:'look'})})).json()).token;
await fetch(base+'/v1/god/env',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({timeOfDay:'14:00',timeScale:0,weather:{kind:'clear'}})});
console.log('goto');await page.goto(base+'/?eye=0,1.6,0&at=0,1.4,4',{waitUntil:'domcontentloaded',timeout:60000});console.log('loaded');await page.waitForFunction(()=>window.__simEntity?.camera&&window.__simEntity?.controls,null,{timeout:120000});console.log('entity');await page.waitForFunction(()=>!document.querySelector('.viewer-arrival-title'),null,{timeout:120000}).catch(()=>console.log('arrival title stayed'));console.log('arrived');await page.waitForTimeout(6000);
const cam=async(n,eye,at)=>{await page.evaluate(({eye,at})=>{const a=window.__simEntity;a.controls.target.set(...at);a.camera.position.set(...eye);a.camera.lookAt(a.controls.target);a.controls.update();},{eye,at});await page.waitForTimeout(2500);await page.screenshot({path:`${out}/${n}.png`,timeout:60000});console.log('shot',n);};
await cam('both',[0.2,1.6,-0.6],[0.2,1.35,4]);await cam('wall',[-1.7,1.5,1.4],[-1.7,1.42,4]);await cam('wall-close',[-2.2,1.5,2.6],[-2.3,1.45,4]);await cam('wall-side',[0.3,1.5,2.6],[-1.7,1.45,4]);await cam('board',[2.0,1.5,2.0],[2.0,1.45,4]);
console.log(JSON.stringify({errors}));await browser.close();
