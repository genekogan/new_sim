#!/usr/bin/env node
// Read-only stranger captures of the real old worlds on eden2 (sim.eden.art/worlds/w/<key>).
// Only page loads and camera pinning/clock override inside MY browser: no sign-in, no clicks, nothing sent to the world.
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
const { chromeLease } = await import(process.env.CHROME_LEASE_MODULE ?? '../god-skill/lib/chrome-lease.mjs');
const root=resolve(new URL('../..',import.meta.url).pathname);
const [world,visualJson,outDir,probe]=process.argv.slice(2);
let visual;
if(visualJson.endsWith('views.json')){const v=JSON.parse(readFileSync(visualJson,'utf8'));visual={pairs:[]};
  for(const dpr of [1,2])for(const [t,hour] of Object.entries(v.timePresets))for(const w of v.views)visual.pairs.push({name:`${w.id}-${t}`,dpr,hour,old:{pose:{eye:w.eye,at:w.at}}});}
else visual=JSON.parse(readFileSync(visualJson,'utf8'));
mkdirSync(outDir,{recursive:true});
const {chromium}=createRequire(resolve(root,'mars/viewer/package.json'))('@playwright/test');
const url=`https://sim.eden.art/worlds/w/${world}/?shot=1&dpr=fixed`;
function observe(){
  globalThis.__parityFrames=0;
  globalThis.__THREE_DEVTOOLS__={dispatchEvent(e){const r=e.detail;if(!r?.isWebGLRenderer||r.__w)return;r.__w=true;const render=r.render;
    r.render=function(scene,camera,...a){if(camera?.isPerspectiveCamera&&scene?.isScene){const p=globalThis.__parityPose;
      if(p){camera.position.fromArray(p.eye);camera.lookAt(...p.at);camera.fov=45;camera.aspect=innerWidth/innerHeight;camera.clearViewOffset();camera.updateProjectionMatrix();camera.updateMatrixWorld();}
      globalThis.__parityView={scene,camera,renderer:r};globalThis.__parityFrames++;}
      return render.call(this,scene,camera,...a);};}};
}
// Client-side only: the page's own daylight input is replaced in my browser's copy of the script so named hours can be shown.
function patch(src){
  const at=src.indexOf('this.daylightFactor=null');if(at<0)return null;
  const start=src.lastIndexOf('update(',at),m=/^update\(([A-Za-z_$][\w$]*)\)\{/.exec(src.slice(start,start+80));
  if(!m||!src.slice(start,at).includes('this.key'))return null;
  const v=m[1],o=start+m[0].length;
  return src.slice(0,o)+`if(typeof ${v}==='string'){globalThis.__liveDatetime=${v};if(globalThis.__parityHour!=null){const h=globalThis.__parityHour,hh=String(Math.floor(h)).padStart(2,'0'),mm=String(Math.round((h%1)*60)).padStart(2,'0');${v}=${v}.slice(0,11)+hh+':'+mm+${v}.slice(16);}globalThis.__parityRenderedDatetime=${v};}`+src.slice(o);
}
const info=()=>{const w=globalThis.__parityView;if(!w)return null;const gl=w.renderer.getContext(),x=gl.getExtension('WEBGL_debug_renderer_info');
  return {eye:w.camera.position.toArray(),fov:w.camera.fov,buffer:[gl.drawingBufferWidth,gl.drawingBufferHeight],datetime:globalThis.__parityRenderedDatetime,liveDatetime:globalThis.__liveDatetime,gpu:x?gl.getParameter(x.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),frames:globalThis.__parityFrames};};
const release=await chromeLease('parity');let browser;const report={world,url,at:new Date().toISOString(),shots:[],errors:[]};
try{
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--ignore-gpu-blocklist']});
  for(const dpr of probe?[1]:[1,2]){
    const ctx=await browser.newContext({viewport:{width:960,height:640},deviceScaleFactor:dpr,reducedMotion:'reduce'});
    await ctx.addInitScript(observe);
    await ctx.route('**/*.js',async route=>{const r=await route.fetch();const s=await r.text();const p=patch(s);if(p){report.clockPatched=true;await route.fulfill({response:r,body:p});}else await route.fulfill({response:r});});
    const page=await ctx.newPage();page.setDefaultTimeout(120000);
    page.on('pageerror',e=>report.errors.push(String(e).slice(0,300)));
    await page.goto(url,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>globalThis.__parityView,null,{timeout:120000});
    await page.waitForTimeout(12000);
    if(probe){await page.screenshot({path:resolve(outDir,'probe.png')});report.probe=await page.evaluate(info);report.text=(await page.evaluate(()=>document.body.innerText)).slice(0,400);break;}
    const seen=new Set();
    for(const p of visual.pairs.filter(x=>x.dpr===dpr)){
      const pose=p.old.pose;
      await page.evaluate(([pose,h])=>{globalThis.__parityPose=pose;globalThis.__parityHour=h;},[pose,p.hour]);
      const b=await page.evaluate(()=>globalThis.__parityFrames);await page.waitForFunction(n=>globalThis.__parityFrames>n+2,b);
      await page.waitForFunction(h=>{const d=globalThis.__parityRenderedDatetime;if(typeof d!=='string')return false;return Math.abs(Number(d.slice(11,13))+Number(d.slice(14,16))/60-h)<.05;},p.hour,{timeout:20000}).catch(()=>{});
      await page.waitForTimeout(visualJson.endsWith('views.json')?4000:6000); // let streamed meshes/textures settle at the new pose
      const state=await page.evaluate(info);const file=resolve(outDir,`${p.name}-dpr${dpr}-old.png`);
      await page.locator('canvas').first().screenshot({path:file});
      report.shots.push({name:p.name,dpr,hour:p.hour,file,pose,state});console.log('shot',world,p.name,dpr,state.datetime);
    }
    await ctx.close();
  }
}catch(e){report.errors.push(String(e));}
finally{await browser?.close();release();writeFileSync(resolve(outDir,probe?'probe.json':'live.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify(report.probe??{errors:report.errors}));
