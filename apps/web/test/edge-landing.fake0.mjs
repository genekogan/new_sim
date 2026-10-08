// Edge onboarding landing (G1a): login hidden by default, "bring your agent" quickstart shown and copyable,
// `?auth=1` restores sign-in. Real build of <webDir> on a fresh fake0 world (4969). No model, $0.
// Usage: node apps/web/test/edge-landing.fake0.mjs <webDir>
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
const root=process.cwd(),web=process.argv[2],port=4969,origin=`http://127.0.0.1:${port}`,base=origin+'/w/eden';
const run=root+'/.e2e/runs/edge-landing-'+new Date().toISOString().replaceAll(':','-');mkdirSync(run,{recursive:true});
const require=createRequire(new URL('../../../mars/viewer/package.json',import.meta.url)),{chromium,devices}=require('@playwright/test');
let log='';const server=spawn(process.execPath,[root+'/tools/edge-skill/test/fake0-server.mjs',String(port),run+'/server',web],{stdio:['ignore','pipe','pipe']});server.stdout.on('data',b=>log+=b);server.stderr.on('data',b=>log+=b);
const checks=[],errors=[];const check=(n,v,d)=>{checks.push({name:n,pass:!!v,...(d?{detail:d}:{})});};let browser,status='fail';
try{
 let ready=false;for(let i=0;i<240&&!ready;i++){try{ready=(await fetch(base+'/healthz')).ok;}catch{}if(!ready)await new Promise(r=>setTimeout(r,250));}assert.ok(ready,log.slice(-400));
 process.env.PLAYWRIGHT_BROWSERS_PATH=root+'/.e2e/browsers';browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 for(const [name,opts] of [['mobile',(({defaultBrowserType,...o})=>o)(devices['iPhone 13'])],['desktop',{viewport:{width:1600,height:950}}]]){
  const ctx=await browser.newContext(opts);await ctx.grantPermissions(['clipboard-read','clipboard-write'],{origin});const page=await ctx.newPage();
  page.on('pageerror',e=>errors.push(name+': '+e.message));
  await page.goto(base);await page.waitForTimeout(5000);
  const signIn=await page.getByRole('button',{name:/^Sign in/}).count(),yourSoul=await page.getByRole('button',{name:'Your Soul',exact:true}).count();
  check(name+' no Sign in / Your Soul buttons',signIn===0&&yourSoul===0,{signIn,yourSoul});
  const qs=page.getByLabel('Agent quickstart prompt');
  check(name+' quickstart visible with this world skill URL',await qs.isVisible()&&(await qs.inputValue()).includes(base+'/skill.md'));
  await page.getByRole('button',{name:'Copy quickstart for your agent'}).click();await page.waitForTimeout(300);
  check(name+' quickstart copies exactly',await page.evaluate(()=>navigator.clipboard.readText())===await qs.inputValue());
  check(name+' no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:`${run}/${name}-landing.png`});
  await page.goto(base+'?auth=1');await page.waitForTimeout(4000);
  check(name+' ?auth=1 restores sign-in',await page.getByRole('button',{name:/^Sign in/}).count()>0);
  await ctx.close();
 }
 check('no page errors',errors.length===0,errors.slice(0,3));
 status=checks.every(c=>c.pass)?'pass':'fail';
}finally{await browser?.close();server.kill('SIGTERM');await new Promise(r=>setTimeout(r,1000));writeFileSync(run+'/summary.json',JSON.stringify({status,web,checks,errors},null,2));console.log(JSON.stringify({status,run,failed:checks.filter(c=>!c.pass)}));}
