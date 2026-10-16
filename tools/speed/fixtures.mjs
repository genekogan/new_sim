#!/usr/bin/env node
// Fresh, fake, disposable speed worlds. No production data or LLM calls.
import { startWorld } from '../god-skill/dev-world.mjs';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
if (!existsSync(resolve(root,'apps/web/dist/index.html'))) throw new Error('Build the web SPA before starting fixtures');
const scratch=resolve(process.env.SPEED_SCRATCH??'<team>/scratch/speed');
const [P0,P1]=(process.env.SPEED_PORTS??'5890,5891').split(',').map(Number);
if([P0,P1].some((p)=>p>=4930&&p<=4990))throw new Error('never the live ports');
mkdirSync(scratch,{recursive:true});
for(const port of [P0,P1]) await new Promise((resolve,reject)=>{
 const check=createServer(); check.once('error',()=>reject(new Error(`port ${port} occupied; stop your owned fixture first`)));
 check.listen(port,'127.0.0.1',()=>check.close(resolve));
});
const worlds=[];
try {
 for(const [kind,port,genesis]of[['mars',P0,'mars-two'],['lm',P1,'littlemartians-two']]) {
  const w=await startWorld({slug:`speed-${kind}`,port,data:resolve(scratch,`data-${kind}`),genesis:resolve(root,`worlds/templates/${genesis}.json`),fresh:true,log:resolve(scratch,`${kind}.log`)});
  worlds.push({base:w.base,pid:w.child.pid,dataDir:w.dataDir});w.child.unref();
  const post=async(path,data)=>{const r=await fetch(w.base+path,{method:'POST',headers:{authorization:'Bearer dev:admin','content-type':'application/json'},body:JSON.stringify(data)});if(!r.ok)throw new Error(`${path}: ${r.status}`);return r.json();};
  await post('/v1/admin',{action:'clock_rate',rate:0.1});
  await post('/v1/souls',{name:'Phone probe',description:'Disposable fake resident for speed-lane phone readability.'});
 }
 writeFileSync(resolve(scratch,'fixtures.json'),JSON.stringify(worlds,null,2));
 console.log(JSON.stringify(worlds,null,2));
} catch(e){for(const w of worlds)try{process.kill(w.pid,'SIGTERM');}catch{};throw e;}
