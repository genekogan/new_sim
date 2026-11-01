// Full-client light interaction diagnostic. Uses an already paired CLI seat in an owned disposable world.
import {createRequire} from 'node:module';import {writeFileSync,mkdirSync} from 'node:fs';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
const require=createRequire(new URL('../../mars/viewer/package.json',import.meta.url)),{chromium}=require('@playwright/test');
const out=process.env.SOUL_ACTIONS_NIGHT_OUT;if(!out)throw Error('SOUL_ACTIONS_NIGHT_OUT required');mkdirSync(out,{recursive:true});
const seat=process.env.SOUL_ACTIONS_SEAT_DIR;if(!seat)throw Error('SOUL_ACTIONS_SEAT_DIR required');
const browser=await chromium.launch({channel:'chrome',headless:true}),ctx=await browser.newContext({viewport:{width:1400,height:960},recordVideo:{dir:out+'/raw-video',size:{width:1400,height:960}}}),page=await ctx.newPage();const errors=[],samples=[],commands=[];page.on('pageerror',e=>errors.push(String(e)));let timer,probing=false;
const sample=()=>page.evaluate(()=>{const e=window.__simEntity,l=e?.layer,m=l?.model;if(!m)return null;const lamps={};for(const x of m.entities.values()){if(!['reading-light','night-light'].includes(x.name))continue;const d=l.drawn?.get(x.id),em=[];d?.obj.traverse(o=>{for(const mat of Array.isArray(o.material)?o.material:[o.material])if(mat?.emissive?.getHex())em.push(mat.emissiveIntensity);});lamps[x.name]={on:x.state?.on,glow:Math.max(0,...em)};}return {at:Date.now(),lamps,residents:e.residents(),lights:window.__simLiving?.lights,atmosphere:window.__simLiving?.atmosphere(),seq:l.seq};});
try{
 await page.goto('http://127.0.0.1:7852/w/soul-actions-day1/?eye=6.5,2.7,7&at=2,0.9,1.2');await page.waitForFunction(()=>window.__simEntity?.residents().length);await page.waitForTimeout(5000);await page.screenshot({path:out+'/initial.png'});writeFileSync(out+'/initial.yml',await page.locator('body').ariaSnapshot());
 timer=setInterval(async()=>{if(probing)return;probing=true;try{const s=await sample();if(s)samples.push(s);}finally{probing=false;}},50);
 for(const [name,verb] of [['reading-light','switch-off'],['night-light','switch-on']]){
  const m=await page.evaluate(name=>{for(const e of window.__simEntity.layer.model.entities.values())if(e.name===name)return e.id;},name);const start=Date.now();
  const r=await promisify(execFile)(process.execPath,['eden.mjs','act',`object:${m}:${verb}`,'--wait','--json'],{cwd:seat,timeout:45000});commands.push({name,verb,start,end:Date.now(),result:JSON.parse(r.stdout)});
  await page.waitForTimeout(2500);await page.screenshot({path:out+'/'+verb+'.png'});
 }
 await page.waitForTimeout(1000);writeFileSync(out+'/final.yml',await page.locator('body').ariaSnapshot());writeFileSync(out+'/proof.json',JSON.stringify({scene:'Owned disposable world; actual world clock 21:00 paused, clear weather. Existing paired Soul controlled through ordinary CLI; no new model seat.',commands,samples,errors},null,2));
 const video=page.video();await ctx.close();await video.saveAs(out+'/continuous.webm');console.log(JSON.stringify({out,commands:commands.map(x=>({name:x.name,seconds:(x.end-x.start)/1000,result:x.result})),samples:samples.length,errors}));
}finally{clearInterval(timer);await browser.close();}
