/// <reference types="node" />
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EngineHook } from '../app/lab/hook.ts';
declare global { interface Window { __marsEngine: EngineHook } }
const artifacts=path.resolve('e2e/artifacts',process.env.E2E_RUN??'living-day');
for(const [scenario,worker,workstation] of [['living-day-4','original','preferred'],['living-day-studio','assistant','alternative']] as const) {
 test(`${scenario}: actual Play independent direction and retained preparation/sleep with ${worker} casting`,async({page})=>{
  test.setTimeout(240_000);mkdirSync(artifacts,{recursive:true});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`/lab?scenario=${scenario}`);await page.waitForFunction(()=>window.__marsEngine?.ready);
  // Loading a continuous scenario may already be playing; explicitly pause before Start.
  await page.evaluate(name=>window.__marsEngine.runScenario(name,{paused:true,speed:8}),scenario);
  const button=(name:string)=>page.getByRole('button',{name,exact:true});
  const day=()=>page.evaluate(()=>window.__marsEngine.livingDay()!);
  const routine=()=>page.evaluate(()=>window.__marsEngine.purposefulRoutine()!);
  await page.getByRole('combobox',{name:'Day participant',exact:true}).selectOption(worker);
  await page.getByRole('combobox',{name:'Day workstation',exact:true}).selectOption(workstation);
  await button('Start connected day').click();await button('Play').click();
  await page.waitForFunction(()=>{const r=window.__marsEngine.reading();return !('code'in r)&&r.elapsed>1&&r.elapsed<5;});
  await button('Pause').click();
  const initial=await day(),beforeReader=await page.evaluate(()=>window.__marsEngine.reading());
  await button('Direct reader away').click();await button('Play').click();
  await page.waitForFunction(()=>{
   const h=window.__marsEngine,reader=h.livingDay()?.intentions.find(i=>i?.actor==='reader');
   const direction=h.records().filter(r=>r.verb==='walk_to'&&!r.parent&&(r.params as {actor?:string}).actor==='reader').at(-1);
   return reader?.mode==='paused'&&direction?.status==='completed';
  });
  await button('Pause').click();const readerPaused=await day(),bookmark=await page.evaluate(()=>window.__marsEngine.reading());
  expect('code'in bookmark).toBe(false);if('code'in bookmark)throw Error(bookmark.message);
  expect(bookmark.status).toBe('unfinished');expect(bookmark.elapsed).toBeGreaterThan(0);
  await button('Play').click();
  await page.waitForFunction(()=>{const p=window.__marsEngine.garden().plants[0];return !('code'in p)&&p.cycles>=1;});
  await button('Pause').click();const independent=await day();
  expect(independent.intentions.find(i=>i?.actor==='reader')?.mode).toBe('paused');
  expect(independent.intentions.find(i=>i?.actor==='carer')?.mode).not.toBe('paused');
  expect(await page.evaluate(()=>window.__marsEngine.reading())).toEqual(bookmark);
  await page.evaluate(()=>window.__marsEngine.camera([-14,15,25],[-3,.7,11]));
  await page.screenshot({path:path.join(artifacts,`${scenario}-reader-paused-carer-continues.png`)});
  await button('resume reader').click();await button('Play').click();
  await page.waitForFunction(()=>{const p=window.__marsEngine.purposefulRoutine()?.preparation;return !!p&&p.ingredients[0].deposited>0&&p.ingredients[0].deposited<1;});
  await button('Pause').click();const partial=await routine();
  await page.evaluate(()=>{const h=window.__marsEngine,r=h.purposefulRoutine()!,p=h.state().humans.find(a=>a.id===r.bindings.actor)!.p;h.camera([p[0]+5,6,p[2]+7],[p[0],1,p[2]]);});
  await page.screenshot({path:path.join(artifacts,`${scenario}-partial-preparation.png`)});
  await button('pause connected routine').click();await button('Play').click();
  await page.waitForFunction(()=>window.__marsEngine.purposefulRoutine()?.mode==='paused');
  await button('Pause').click();const retained=await routine();
  expect(retained.action).toBe(partial.action);expect(retained.preparation).toEqual(partial.preparation);
  expect(retained.progress).toEqual(partial.progress);
  await page.screenshot({path:path.join(artifacts,`${scenario}-retained-preparation.png`)});
  await button('resume connected routine').click();await button('Play').click();
  await page.waitForFunction(()=>{const r=window.__marsEngine.purposefulRoutine();return r?.sleep?.mode==='sleeping'&&r.sleep.elapsed>.5;});
  await button('Pause').click();const sleeping=await routine();
  await page.evaluate(()=>{const h=window.__marsEngine,r=h.purposefulRoutine()!,p=h.state().humans.find(a=>a.id===r.bindings.actor)!.p;h.camera([p[0]+5,5,p[2]+6],[p[0],.3,p[2]]);});
  await page.screenshot({path:path.join(artifacts,`${scenario}-sleeping.png`)});
  await button('pause connected routine').click();await button('Play').click();
  await page.waitForFunction(()=>window.__marsEngine.purposefulRoutine()?.mode==='paused');
  await button('Pause').click();const sleepPaused=await routine();
  expect(sleepPaused.sleep!.action).toBe(sleeping.sleep!.action);expect(sleepPaused.sleep!.elapsed).toBe(sleeping.sleep!.elapsed);
  expect(await page.evaluate(id=>window.__marsEngine.bones(id)[id].prone,sleeping.bindings.actor)).toBeUndefined();
  await page.screenshot({path:path.join(artifacts,`${scenario}-sleep-paused-safe-upright.png`)});
  await button('resume connected routine').click();await button('Play').click();
  await page.waitForFunction(()=>window.__marsEngine.livingDay()?.phase==='completed');
  await page.waitForFunction(()=>window.__marsEngine.heldItems().length===0&&Object.values(window.__marsEngine.garden().claims).flat().length===0);
  await button('Pause').click();const complete=await routine(),finalDay=await day(),book=await page.evaluate(()=>window.__marsEngine.reading());
  expect(complete.action).toBe(partial.action);expect(complete.status).toBe('completed');
  expect(complete.sleep!.action).toBe(sleeping.sleep!.action);expect(complete.sleep!.elapsed).toBe(complete.bindings.sleep!.duration);
  expect(complete.preparation?.complete).toBe(true);expect(complete.progress.meal.every(p=>p.consumed&&p.returned)).toBe(true);
  expect(complete.progress.workElapsed).toBe(complete.bindings.work.duration);
  expect(complete.bindings.actor).toBe(worker==='assistant'?'day-editor':'worker');
  if(worker==='assistant')expect(complete.bindings.work.station).toBe('aux-computer');
  expect('code'in book).toBe(false);if('code'in book)throw Error(book.message);expect(book.elapsed).toBe(24);expect(book.user).toBe(bookmark.user);
  expect(finalDay.intentions.map(i=>i?.completed.length)).toEqual([4,3]);
  expect(await page.evaluate(()=>window.__marsEngine.violations())).toEqual([]);expect(errors).toEqual([]);
  await page.screenshot({path:path.join(artifacts,`${scenario}-completed-original-purpose.png`)});
  writeFileSync(path.join(artifacts,`${scenario}-proof.json`),JSON.stringify({initial,beforeReader,readerPaused,bookmark,independent,partial,retained,sleeping,sleepPaused,complete,finalDay,book,errors},null,2));
 });
}
