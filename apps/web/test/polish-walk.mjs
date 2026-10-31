// Focused signed-in walk. Both origins must be disposable local worlds, never a live-world port.
// Baseline/candidate Vite previews share one fresh fake-mind backend. Artifacts stay outside the repo.
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync,readFileSync,readdirSync,copyFileSync} from 'node:fs';
import {chromeLease} from '../../../tools/god-skill/lib/chrome-lease.mjs';
import assert from 'node:assert/strict';
import { scratchDir } from '../../../tools/lib/paths.mjs';
const root=new URL('../../../',import.meta.url).pathname;
const {chromium}=createRequire(root+'mars/viewer/package.json')('@playwright/test');
const out=process.env.POLISH_OUT??scratchDir('polish/browser');
mkdirSync(out,{recursive:true});
const baseline=process.env.POLISH_BASELINE??'http://127.0.0.1:5972';
const candidate=process.env.POLISH_CANDIDATE??'http://127.0.0.1:5971';
for(const origin of [baseline,candidate]){const u=new URL(origin);assert.equal(u.hostname,'127.0.0.1');assert.ok(Number(u.port)>=5970&&Number(u.port)<=5979);}
const report={started:new Date().toISOString(),checks:[],views:[],requests:{}};
const release=await chromeLease('polish');let browser;
const check=(name,fn)=>async(...args)=>{const result=await fn(...args);report.checks.push({name,result});console.log('PASS '+name);return result;};
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--ignore-gpu-blocklist']});
 for(const [phase,origin] of [['before',baseline],['after',candidate]]){
  const context=await browser.newContext({viewport:{width:1280,height:844},deviceScaleFactor:1});
  await context.addInitScript(()=>localStorage.setItem('sim.dev','polish'));
  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin});
  const page=await context.newPage();page.setDefaultTimeout(30000);
  const requests=[],sizes=[];page.on('request',r=>{if(/animated-.*\.glb|\/v1\/god\/status/.test(r.url()))requests.push({url:r.url(),at:Date.now()});});
  page.on('response',async r=>{if(/animated-.*\.glb|\/v1\/god\/status/.test(r.url())){try{sizes.push({url:r.url(),bytes:/\/god\/status/.test(r.url())?(await r.body()).length:Number(await r.headerValue('content-length'))});}catch{/* cancelled baseline scene */}}});
  await page.goto(origin+'/w/polish/?dev=1',{waitUntil:'domcontentloaded'});
  await page.locator('.explore-open').waitFor({timeout:120000});console.log(phase+' viewer ready');
  console.log(phase+' initial camera: '+await page.locator('.viewer-broadcast').innerText());
  if(!(await page.locator('.viewer-broadcast').innerText()).includes('Back to broadcast'))await page.locator('.viewer-broadcast').click();
  await page.getByRole('button',{name:'Back to broadcast',exact:true}).waitFor();
  const reuse=phase==='before'?process.env.POLISH_REUSE_BEFORE:null;
  if(reuse){report.views.push(...JSON.parse(readFileSync(reuse+'/report.json','utf8')).views);for(const f of readdirSync(reuse).filter(f=>/^before-\d/.test(f)&&f.endsWith('.png')))copyFileSync(reuse+'/'+f,out+'/'+f);}
  else for(const [width,dpr] of [[1280,1],[890,1],[390,1],[1280,2],[890,2],[390,2],[390,3]]){
   // Screenshots at physical DPR use independent contexts; resize still exercises real layout and input.
   let p=page,c=context;
   if(dpr!==1){c=await browser.newContext({viewport:{width,height:844},deviceScaleFactor:dpr,isMobile:width===390,hasTouch:width===390});await c.addInitScript(()=>localStorage.setItem('sim.dev','polish'));p=await c.newPage();await p.goto(origin+'/w/polish/?dev=1',{waitUntil:'domcontentloaded'});await p.locator('.explore-open').waitFor({timeout:120000});if(!(await p.locator('.viewer-broadcast').innerText()).includes('Back to broadcast'))await p.locator('.viewer-broadcast').click();}
   else await p.setViewportSize({width,height:844});
   const boxes=await p.locator('.hud-status,.hud-camera-row,.hud-explore-group,.hud-actions').evaluateAll(els=>els.map(e=>{const b=e.getBoundingClientRect();return {name:e.className,x:b.x,y:b.y,right:b.right,bottom:b.bottom,width:b.width};}));
   const overlaps=boxes.flatMap((a,i)=>boxes.slice(i+1).filter(b=>Math.min(a.right,b.right)-Math.max(a.x,b.x)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)>1).map(b=>[a.name,b.name]));
   if(phase==='after'){assert.deepEqual(overlaps,[],JSON.stringify({width,dpr,boxes}));assert.ok(boxes.every(b=>b.x>=0&&b.right<=width),JSON.stringify(boxes));}
   await p.screenshot({path:`${out}/${phase}-${width}-dpr${dpr}.png`});
   report.views.push({phase,width,dpr,overlaps,boxes});
   console.log(`${phase} ${width} DPR ${dpr}: ${overlaps.length} overlaps`);
   if(c!==context)await c.close();
  }
  // Baseline's demonstrated 890 px collision prevents Explore clicks; the fixed build must work there.
  await page.setViewportSize({width:phase==='before'?1280:890,height:844});
  if(phase==='after'){
   await check('account closes on Escape and outside click',async()=>{
    await page.getByLabel('Account menu',{exact:true}).click();assert.equal(await page.locator('.account-menu').getAttribute('open'),'');await page.keyboard.press('Escape');assert.equal(await page.locator('.account-menu').getAttribute('open'),null);
    await page.getByLabel('Account menu',{exact:true}).click();await page.mouse.click(30,700);assert.equal(await page.locator('.account-menu').getAttribute('open'),null);return true;
   })();
   await check('New Soul closes account menu and copies prompt',async()=>{
    await page.getByLabel('Account menu',{exact:true}).click();await page.getByRole('button',{name:'New Soul',exact:true}).click();await page.locator('.bring-agent-scrim').waitFor();assert.equal(await page.locator('.account-menu').getAttribute('open'),null);
    await page.getByRole('button',{name:'Copy prompt',exact:true}).click();await page.getByRole('status').filter({hasText:'Copied.'}).waitFor();
    await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('denied fixture');}}}));
    await page.getByRole('button',{name:'Copy prompt',exact:true}).click();await page.getByRole('status').filter({hasText:'Press ⌘C'}).waitFor();assert.match(await page.evaluate(()=>getSelection()?.toString()??''),/instructions\.md/);
    await page.screenshot({path:out+'/after-prompt-denied.png'});await page.keyboard.press('Escape');return true;
   })();
   await check('invite link denial selects URL, shows hint and closes menu',async()=>{
    await page.getByLabel('Account menu',{exact:true}).click();await page.getByRole('button',{name:'Copy invite link',exact:true}).click();await page.getByRole('dialog',{name:'Invite a friend'}).waitFor();assert.equal(await page.locator('.account-menu').getAttribute('open'),null);
    await page.getByRole('status').filter({hasText:'Press ⌘C'}).waitFor();const selection=await page.getByLabel('Invite link',{exact:true}).evaluate(e=>e.value.slice(e.selectionStart,e.selectionEnd));assert.equal(selection,origin+'/w/polish/#join');
    await page.screenshot({path:out+'/after-invite-denied.png'});await page.keyboard.press('Escape');return true;
   })();
   await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text)=>{globalThis.__copiedFixture=text;}}}));
   await check('invite link success is visible after the menu closes',async()=>{await page.getByLabel('Account menu',{exact:true}).click();await page.getByRole('button',{name:'Copy invite link',exact:true}).click();await page.getByRole('status').filter({hasText:'Link copied.'}).waitFor();assert.equal(await page.evaluate(()=>globalThis.__copiedFixture),origin+'/w/polish/#join');await page.keyboard.press('Escape');return true;})();
  }
  await page.locator('.explore-open').click();
  await page.getByLabel('Search locations and Souls').fill('AcceptanceEden');
  await page.locator('.explore-soul').first().waitFor();
  if(phase==='after')assert.equal(await page.locator('.explore-soul b').first().getAttribute('title'),'AcceptanceEden20261010ReallyLong');
  await page.screenshot({path:`${out}/${phase}-long-name-explore.png`});
  await page.locator('.explore-soul').first().click();
  if(await page.locator('.explore-modal').isVisible()){await page.getByRole('button',{name:'Close Explore',exact:true}).click();await page.getByRole('button',{name:'Open AcceptanceEden20261010ReallyLong',exact:true}).click();}
  await page.locator('#soul-card-name').waitFor();
  if(phase==='after'){assert.equal(await page.locator('#soul-card-name').getAttribute('title'),'AcceptanceEden20261010ReallyLong');assert.equal(await page.locator('#soul-card-name').evaluate(e=>getComputedStyle(e).textOverflow),'ellipsis');}
  await page.screenshot({path:`${out}/${phase}-long-name-card.png`});
  report.requests[phase]={avatars:requests.filter(r=>/\.glb/.test(r.url)),status:requests.filter(r=>/\/god\/status/.test(r.url)),sizes};
  if(phase==='after'){
   const start=Date.now();await page.waitForTimeout(8500);const polls=requests.filter(r=>r.at>=start&&/\/god\/status/.test(r.url));assert.ok(polls.length>=2&&polls.length<=3);for(let i=1;i<polls.length;i++)assert.ok(polls[i].at-polls[i-1].at>=3500);report.requests.after.steadyPolls=polls;
   const avatars=report.requests.after.avatars;assert.equal(avatars.length,3,JSON.stringify(avatars));
   report.checks.push({name:'three avatar requests and one status poll per four seconds',result:true});
  }
  await page.goto(origin+'/test/polish-fixture.html');
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('denied fixture');}}}));
  await page.locator('.gp-copy').click();
  if(phase==='after'){
   await page.getByRole('status').filter({hasText:'Press ⌘C'}).waitFor();assert.match(await page.getByLabel('Text to copy').evaluate(e=>e.value.slice(e.selectionStart,e.selectionEnd)),/God mode section/);
   // LINK 2026-10-24: the Agent access panel (AgentConnection) is gone; its start prompt lives on the Soul card's Reconnect box
   report.checks.push({name:'pairing copy denial selects text and shows manual hint',result:true});
  }
  await page.screenshot({path:`${out}/${phase}-pairing-denied.png`});
  const names=['mars-college-2026','mars-college-2026-2','mars-college-2026-3'];
  await page.route('**/__sim/worlds.json',route=>route.fulfill({json:{contract:'local-worlds/1',launcher:'polish-fixture',auth:{provider:'dev'},templates:[],worlds:names.map(slug=>({slug,name:'Mars College 2026',basePath:'/w/'+slug,url:'/w/'+slug+'/',template:'empty',templateName:'Empty plain',createdAt:0,god:true,godName:'Polish',souls:0,entities:0,seq:0,status:'running',restarts:0}))}}));
  await page.goto(origin+'/');await page.locator('.lh-card').first().waitFor();
  if(phase==='after')for(const slug of names)assert.equal(await page.locator(`[data-world="${slug}"] .lh-world-slug`).innerText(),slug);
  await page.screenshot({path:`${out}/${phase}-worlds-890.png`});
  if(phase==='after'){
   // The old world's #join route uses the existing New Soul dialog; local fake auth is sufficient.
   await page.goto(origin+'/w/eden/?dev=1#join');await page.locator('.bring-agent-scrim').waitFor();assert.match(await page.locator('.bring-agent-prompt').innerText(),/\/w\/eden\/instructions.md/);await page.keyboard.press('Escape');
   report.checks.push({name:'old-world #join opens New Soul with the old-world instructions URL',result:true});
  }
  await context.close();
 }
 report.status='pass';
}catch(error){report.status='fail';report.error=String(error);let i=0;for(const c of browser?.contexts()??[])for(const p of c.pages()){await p.screenshot({path:out+`/failure-${i}.png`}).catch(()=>{});writeFileSync(out+`/failure-${i++}.txt`,await p.locator('body').innerText().catch(()=>''));}throw error;}
finally{await browser?.close();release();writeFileSync(out+'/report.json',JSON.stringify(report,null,2));}
console.log('Evidence: '+out);
