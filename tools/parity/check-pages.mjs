#!/usr/bin/env node
// Focused check of the delivered file-based comparison viewer with real input.
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {chromeLease} from '<team>/ops/chrome-lease.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const review=resolve(process.argv[2]??'<team>/reviews/sim-compare-20261015');
const out=resolve(process.argv[3]??'<team>/scratch/parity/page-check');mkdirSync(out,{recursive:true});
const {chromium}=createRequire(resolve(root,'mars/viewer/package.json'))('@playwright/test');
const release=await chromeLease('parity');let browser;
const report={at:new Date().toISOString(),pages:[]};
try{
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--ignore-gpu-blocklist']});
  for(const world of ['mars','littlemartians']){
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
    page.on('pageerror',e=>errors.push(String(e)));
    await page.goto(pathToFileURL(resolve(review,`${world}.html`)).href);
    const views=await page.locator('#view option').allTextContents();
    if(views.length<8)throw Error(`${world}: missing views`);
    const loaded=()=>page.waitForFunction(()=>{const a=[...document.querySelectorAll('.frames img')];return a.length===2&&a.every(i=>i.complete&&i.naturalWidth>0);});
    await loaded();
    await page.getByLabel('Pixels',{exact:true}).selectOption('2');
    await page.getByLabel('View',{exact:true}).selectOption('2');await loaded();
    const widths=await page.locator('.frames img').evaluateAll(a=>a.map(i=>i.naturalWidth));
    if(widths.some(w=>w!==1920))throw Error(`${world}: DPR2 does not load its 1920px originals`);
    await page.getByRole('button',{name:'Next view',exact:true}).click();
    if(await page.locator('#view').inputValue()!=='3')throw Error('Next control failed');
    await page.getByRole('button',{name:'Previous view',exact:true}).click();
    if(await page.locator('#view').inputValue()!=='2')throw Error('Previous control failed');
    await page.getByLabel('View',{exact:true}).selectOption(String(views.length-1));await loaded();
    await page.getByLabel('Pixels',{exact:true}).selectOption('1');
    await page.locator('#film button').first().click();await loaded();
    const table=await page.locator('tbody tr').count();if(table<5)throw Error('Resident table incomplete');
    if(errors.length)throw Error(errors.join('\n'));
    await page.screenshot({path:resolve(out,`${world}-page.png`),fullPage:true});
    report.pages.push({world,views:views.length,dpr2Widths:widths,tableRows:table,errors,realInput:['DPR selector','view selector','next','previous','thumbnail']});
    await page.close();
  }
  console.log(JSON.stringify(report));
}finally{await browser?.close();release();writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2)+'\n');}
