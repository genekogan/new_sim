// Bounded DOM/Three input-adapter proof; no WebGL, world server, or provider calls.
import { build } from '../../../tools/floaters/node_modules/esbuild/lib/main.js';
import { chromium } from '../../../tools/floaters/node_modules/playwright-core/index.mjs';
import { createServer } from 'node:http';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const run=`${root}.e2e/runs/world-navigation-${new Date().toISOString().replaceAll(':','-')}`;
await mkdir(run,{recursive:true});
await writeFile(`${run}/source.txt`,execFileSync('git',['rev-parse','HEAD'],{cwd:root})+'\n'+execFileSync('git',['status','--short'],{cwd:root}));
const fixture=`
import {PerspectiveCamera,Vector3} from 'three';
import {WorldNavigation,createWorldOrbitControls} from './src/WorldNavigation.ts';
const canvas=document.querySelector('canvas'),camera=new PerspectiveCamera(45,4/3,.1,600);
camera.position.set(0,3,10);const context={mode:'manual',navigation:'free',lifecycle:'eden:epoch1:body:present:live'};
let controls=createWorldOrbitControls(camera,canvas,new Vector3(0,1,0),context),disposed=false;
const nav=new WorldNavigation(canvas,camera,()=>controls.target,()=>context,()=>{
 if(disposed)return;const target=controls.target.clone();controls.dispose();controls=createWorldOrbitControls(camera,canvas,target,context);
});nav.sync();
window.fixture={
 state:()=>({position:camera.position.toArray(),rotation:camera.quaternion.toArray(),target:controls.target.toArray(),owned:nav.inputOwned,context:{...context}}),
 step:dt=>{nav.update(dt);if(controls.enabled)controls.update();},
 change:values=>{Object.assign(context,values);nav.sync();},
 release:()=>nav.release(),move:delta=>nav.move(delta),
 dispose:()=>{disposed=true;nav.dispose();controls.dispose();}
};`;
await build({absWorkingDir:root,stdin:{contents:fixture,resolveDir:`${root}apps/web`,sourcefile:'world-navigation-dom-fixture.ts',loader:'ts'},bundle:true,platform:'browser',format:'esm',outfile:`${run}/fixture.js`});
const html='<!doctype html><meta charset="utf-8"><title>World navigation adapter fixture</title><h1>World navigation DOM fixture</h1><p>No renderer or simulated world. Camera movement is measured by assertions.</p><textarea aria-label="Intention">walk and talk</textarea><canvas tabindex="0" aria-label="World camera" width="800" height="600" style="display:block;border:2px solid #777;background:#dcebdc"></canvas><script type="module" src="/fixture.js"></script>';
await writeFile(`${run}/fixture.html`,html);
const server=createServer(async(req,res)=>{res.setHeader('Content-Type',req.url==='/fixture.js'?'text/javascript':'text/html');res.end(req.url==='/fixture.js'?await readFile(`${run}/fixture.js`):html);});
let browser,page;const checks=[],errors=[];let status='fail';
const check=(name,fn)=>{fn();checks.push({name,pass:true});};
const samePosition=(actual,expected)=>assert.ok(actual.every((v,i)=>Math.abs(v-expected[i])<1e-8),'camera displacement exceeds 1e-8 metres');
try{
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(4944,'127.0.0.1',resolve);});
 browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 page=await browser.newPage({viewport:{width:1000,height:850}});page.on('pageerror',e=>errors.push(String(e)));
 await page.goto('http://127.0.0.1:4944');await page.waitForFunction(()=>!!window.fixture);
 const state=()=>page.evaluate(()=>window.fixture.state());
 const step=()=>page.evaluate(()=>window.fixture.step(.1));
 const initial=await state();await page.getByRole('textbox',{name:'Intention'}).focus();await page.keyboard.press('w');await step();
 let actual=await state();check('editing leaves camera stationary',()=>{assert.deepEqual(actual.position,initial.position);assert.equal(actual.owned,false);});
 await page.getByRole('textbox',{name:'Intention'}).fill('walk and talk');await page.keyboard.press('Escape');await step();
 const text=await page.getByRole('textbox',{name:'Intention'}).inputValue();
 check('editing Escape preserves text',()=>assert.equal(text,'walk and talk'));
 const scene=page.locator('canvas[aria-label="World camera"]');await scene.focus();await page.keyboard.down('w');await step();actual=await state();
 check('focused W moves exactly 0.6 metres',()=>{assert.ok(Math.abs(actual.position[2]-9.4)<1e-8);assert.equal(actual.owned,true);});
 await page.keyboard.press('Escape');await step();let released=await state();await page.keyboard.up('w');
 check('Escape stops and releases without drift',()=>{samePosition(released.position,actual.position);assert.equal(released.owned,false);});
 await scene.focus();await step();released=await state();check('focus never resumes a released held key',()=>samePosition(released.position,actual.position));
 await page.keyboard.down('w');await page.getByRole('textbox',{name:'Intention'}).focus();await step();await page.keyboard.up('w');released=await state();
 check('prompt focus clears held scene keys',()=>{samePosition(released.position,actual.position);assert.equal(released.owned,false);});
 await scene.focus();await page.keyboard.down('w');await page.evaluate(()=>window.fixture.change({lifecycle:'mars:epoch2:body:present:live'}));await step();await page.keyboard.up('w');released=await state();
 check('world/epoch change releases ownership and held keys',()=>{samePosition(released.position,actual.position);assert.equal(released.owned,false);});
 await page.evaluate(()=>window.fixture.change({mode:'follow',navigation:'orbit'}));await scene.focus();await page.keyboard.press('w');await step();released=await state();
 check('Follow rejects free movement keys',()=>samePosition(released.position,actual.position));
 // Use native pointer dispatch for a held OrbitControls drag, then release mid-drag.
 const box=await scene.boundingBox();await page.mouse.move(box.x+200,box.y+200);await page.mouse.down();await page.mouse.move(box.x+250,box.y+200);await step();const dragged=await state();
 assert.notDeepEqual(dragged.position,released.position);
 await page.evaluate(()=>window.fixture.release());await page.mouse.move(box.x+350,box.y+200);await page.mouse.up();for(let i=0;i<10;i++)await step();released=await state();
 check('real DOM held Orbit drag and damping stop on release',()=>{assert.ok(released.position.every((v,i)=>Math.abs(v-dragged.position[i])<1e-8));assert.equal(released.owned,false);});
 await page.evaluate(()=>window.fixture.change({mode:'manual',navigation:'free'}));await scene.focus();await page.mouse.move(box.x+200,box.y+200);await page.mouse.down({button:'right'});await page.mouse.move(box.x+240,box.y+180);await page.mouse.up({button:'right'});const looked=await state();
 check('free right drag turns in place',()=>{samePosition(looked.position,released.position);assert.notDeepEqual(looked.rotation,released.rotation);});
 await page.evaluate(()=>window.fixture.dispose());await scene.focus();await page.keyboard.press('w');await step();released=await state();
 check('disposed navigation cannot move or reacquire',()=>{samePosition(released.position,looked.position);assert.equal(released.owned,false);});
 check('no page errors',()=>assert.deepEqual(errors,[]));
 await page.screenshot({path:`${run}/fixture.png`});status='pass';
}catch(error){await writeFile(`${run}/failure.txt`,String(error.stack??error));if(page){await page.screenshot({path:`${run}/failure.png`}).catch(()=>{});await writeFile(`${run}/failure.html`,await page.content());}throw error;}
finally{
 await browser?.close();await new Promise(resolve=>server.close(resolve));
 await writeFile(`${run}/summary.json`,JSON.stringify({status,checks,errors,scope:'actual DOM/Three adapter; no WebGL or LiveWorld; $0',teardown:'browser closed and own 4944 server closed'},null,2));
 await writeFile(`${run}/run.md`,
 `# Navigation DOM adapter — ${status.toUpperCase()}\n\n${checks.length} checks passed. Exact source and dirty state in source.txt. Actual browser keyboard/focus/pointer events drive exported WorldNavigation and real OrbitControls, without WebGL, Core or provider calls. This does not qualify mounted LiveWorld, reset view, moving Follow, touch-device behavior, performance or release. Browser and own port 4944 server closed.\n`);
 await writeFile(`${run}/index.html`,`<h1>Navigation DOM adapter: ${status}</h1><p>No WebGL, Core, or provider calls; actual mounted viewer remains separate qualification.</p><ul>${checks.map(c=>`<li>${c.name}: pass</li>`).join('')}</ul><a href="run.md">Evidence scope</a><p><img src="fixture.png" width="750"></p>`);
 console.log(JSON.stringify({status,checks:checks.length,run}));
}
