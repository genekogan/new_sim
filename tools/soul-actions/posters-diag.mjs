// Entry 38 diagnosis helper: load the client and, once the main thread stops answering, pause it and print the JS stack.
import {createRequire} from 'node:module';
const base=process.env.BASE,require=createRequire(new URL('../../mars/viewer/package.json',import.meta.url)),{chromium}=require('@playwright/test');
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await (await browser.newContext({viewport:{width:1280,height:800}})).newPage();
page.on('pageerror',e=>console.log('pageerror',String(e).slice(0,500)));
const cdp=await page.context().newCDPSession(page);await cdp.send('Debugger.enable');
cdp.on('Debugger.paused',async ev=>{console.log('PAUSED');for(const f of ev.callFrames.slice(0,25))console.log(f.functionName||'(anon)',f.url.split('/').slice(-2).join('/'),f.location.lineNumber+1,f.location.columnNumber);await cdp.send('Debugger.resume').catch(()=>{});});
await page.goto(base+'/?eye=0,1.6,0&at=0,1.4,4',{waitUntil:'domcontentloaded'});
for(let k=0;k<3;k++){await new Promise(r=>setTimeout(r,15000));await cdp.send('Debugger.pause');await new Promise(r=>setTimeout(r,3000));}
await browser.close();
