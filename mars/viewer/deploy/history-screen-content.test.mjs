import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import * as T from 'three';
const file=new URL(`../.history-screen-${process.pid}.mjs`,import.meta.url);
await build({stdin:{contents:"export {Kit} from './app/history/kit';export {createHistoricalScreens} from './app/history/screens';",resolveDir:new URL('..',import.meta.url).pathname,loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',outfile:file.pathname,logLevel:'error'});
T.TextureLoader.prototype.load=function(url){const t=new T.Texture();t.userData.sourceUrl=url;return t;};
// oxlint-disable-next-line typescript/no-deprecated -- offline screen adapter canvas; no browser DOM
globalThis.document={createElement:()=>({width:1,height:1,getContext:()=>new Proxy({}, {get:()=>()=>{}})})};
const {Kit,createHistoricalScreens}=await import(file.href);after(()=>fs.unlink(file));

test('historical idle displays retain their own dated content through program and room resets',()=>{
 for(const year of [2020,2021,2022,2023,2024,2025]){
  const k=new Kit(year),g=k.assembly('display-test','source display');k.screen(g,0,1,0);const r=k.finalize();
  const display=r.getObjectByName('display content'),original=display.material.map,colour=display.material.color.clone();
  if(year===2020)assert.equal(original.userData.sourceUrl,'/2020/screens/portal-screen-02.webp');
  else{assert.equal(original,null,'later years must not borrow Portal2020 artwork');assert.equal(colour.getHexString(),'17232b');}
  const screens=createHistoricalScreens(r),id=display.userData.screen_id;
  const state=(program,enabled=true,brightness=1)=>({screens:{[id]:{program,enabled,brightness,title:'Mars'}}});
  screens.update(null,0,'complete');assert.equal(display.material.map,original);assert.ok(display.material.color.equals(colour));
  screens.update(state('test'),0,'complete');assert.notEqual(display.material.map,original);assert.equal(display.material.color.getHexString(),'ffffff');
  screens.update(state('art',true,.5),0,'complete');assert.equal(display.material.map,original);assert.ok(display.material.color.equals(colour.clone().multiplyScalar(.5)));
  screens.update(state('art',false),0,'complete');assert.equal(display.material.color.getHexString(),'000000');
  screens.update(null,0,'complete');assert.equal(display.material.map,original);assert.ok(display.material.color.equals(colour));screens.dispose();
 }
});
