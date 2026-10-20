// Focused follow-up to the signed-in walk: header, panel placement, and Follow with three owned portraits.
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chromeLease} from '../../../tools/god-skill/lib/chrome-lease.mjs';
import assert from 'node:assert/strict';
const root=new URL('../../../',import.meta.url).pathname;
const {chromium}=createRequire(root+'mars/viewer/package.json')('@playwright/test');
const origin=process.env.POLISH_CANDIDATE??'http://127.0.0.1:5971';
const url=new URL(origin);assert.equal(url.hostname,'127.0.0.1');assert.ok(+url.port>=5970&&+url.port<=5979);
const out=process.env.POLISH_OUT??'<team>/scratch/polish/layout-final';mkdirSync(out,{recursive:true});
const report={status:'running',views:[]},release=await chromeLease('polish');let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--ignore-gpu-blocklist']});
 for(const [width,dpr,follow] of [[1280,1],[890,1],[390,1],[1280,2],[890,2],[390,2],[390,3],[768,1,true]]){
  const context=await browser.newContext({viewport:{width,height:844},deviceScaleFactor:dpr,isMobile:width===390,hasTouch:width===390});
  await context.addInitScript(()=>localStorage.setItem('sim.dev','polish'));
  const page=await context.newPage();page.setDefaultTimeout(30000);
  await page.goto(origin+'/w/polish/?dev=1',{waitUntil:'domcontentloaded'});await page.locator('.explore-open').waitFor({timeout:120000});
  if(follow){await page.getByRole('button',{name:'Open AcceptanceEden20261010ReallyLong',exact:true}).click();await page.getByRole('button',{name:'Follow',exact:true}).click();await page.locator('.viewer-following').waitFor();assert.equal(await page.locator('.viewer-following-label').getAttribute('title'),'AcceptanceEden20261010ReallyLong');}
  else if(!(await page.locator('.viewer-broadcast').innerText()).includes('Back to broadcast'))await page.locator('.viewer-broadcast').click();
  await page.waitForFunction(()=>{const hud=document.querySelector('.world-hud'),panel=document.querySelector('[data-god-panel]');return hud&&panel&&panel.getBoundingClientRect().top>=hud.getBoundingClientRect().bottom;});
  const panel=await page.locator('[data-god-panel]').boundingBox();assert.ok(panel&&panel.x>=0&&panel.x+panel.width<=width);
  const boxes=await page.locator('.viewer-status,.viewer-broadcast,.viewer-following,.hud-camera,.explore-open,.god-open,.my-souls>button,.account-avatar').evaluateAll(els=>els.map(e=>{const b=e.getBoundingClientRect();return{name:e.className,x:b.x,y:b.y,right:b.right,bottom:b.bottom};}));
  assert.ok(boxes.every(b=>b.x>=0&&b.right<=width),JSON.stringify(boxes));
  for(let i=0;i<boxes.length;i++)for(const b of boxes.slice(i+1)){const a=boxes[i];assert.ok(Math.min(a.right,b.right)-Math.max(a.x,b.x)<=1||Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)<=1,JSON.stringify({a,b}));}
  await page.screenshot({path:`${out}/after-${width}-dpr${dpr}${follow?'-follow':''}.png`});
  report.views.push({width,dpr,follow:!!follow,boxes});console.log(`PASS ${width} DPR ${dpr}${follow?' Follow':''}`);await context.close();
 }
 report.status='pass';
}catch(error){report.status='fail';report.error=String(error);throw error;}
finally{await browser?.close();release();writeFileSync(out+'/report.json',JSON.stringify(report,null,2));}
