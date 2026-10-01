// Focused screenshots of the actual Studio runtime, including gallery.ts.
// Run from viewer; uses the existing local server and installed browser only.
import fs from 'node:fs/promises';
import path from 'node:path';
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.resolve('.pw-browsers');
const {chromium}=await import('@playwright/test');
const output=process.env.MARS_REVIEW_OUT;
if(!output)throw new Error('Set MARS_REVIEW_OUT to the saved review directory');
const views=JSON.parse(process.env.MARS_REVIEW_VIEWS||'["mimos","kitchen","auditorium"]');
const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const errors=[];
try{
 const page=await browser.newPage({viewport:{width:1280,height:800},reducedMotion:'reduce'});
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 const reviewYear=process.env.MARS_REVIEW_YEAR||'2026';
 if(!/^202[0-6]$/.test(reviewYear))throw new Error('MARS_REVIEW_YEAR must be2020–2026');
 await page.goto(`${process.env.MARS_REVIEW_URL||'http://127.0.0.1:4326'}/studio${reviewYear==='2026'?'':'/'+reviewYear}`);
 await page.waitForFunction(()=>window.__marsStudio?.ready===true,null,{timeout:120000});
 await page.waitForLoadState('networkidle',{timeout:60000});
 await fs.mkdir(output,{recursive:true});
 const captures=[];
 for(const view of views){
  const name=typeof view==='string'?view:view.name;
  if(typeof view!=='string'&&view.cutCycle){
   const cut=page.getByRole('combobox',{name:'View',exact:true});
   for(const mode of ['inside','frame','complete'])await cut.selectOption(mode);
  }
  if(typeof view==='string')await page.getByLabel('Visit a 2026 interior').selectOption(view);
  else await page.evaluate(v=>window.__marsStudio.look(v.position,v.target),view);
  const start=await page.evaluate(()=>window.__marsStudio.frames);
  await page.waitForFunction(n=>window.__marsStudio.frames>=n+5,start,{timeout:60000});
  const file=path.join(output,`${name}-live-runtime.png`);
  await page.screenshot({path:file});
  captures.push({name,file,renderer:await page.evaluate(()=>window.__marsStudio.info()),camera:await page.evaluate(()=>window.__marsStudio.walking().position)});
 }
 await fs.writeFile(path.join(output,'live-runtime-proof.json'),JSON.stringify({date:new Date().toISOString(),url:page.url(),captures,errors,note:'Actual runtime screenshots; placement still requires visual acceptance against sources.'},null,2));
 console.log(JSON.stringify({captures:captures.map(c=>c.file),errors}));
 if(errors.length)process.exitCode=1;
}finally{await browser.close();}
