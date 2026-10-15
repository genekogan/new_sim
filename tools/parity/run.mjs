#!/usr/bin/env node
// Boot only disposable fixtures; evaluation gets the heavy slot, servers do not.
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openWorldServer } from '../core/multiworld/world-server.mjs';
import { startWorld } from '../god-skill/dev-world.mjs';
import { envClockConfig } from '../../apps/server/src/god/world-clock.ts';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const args=process.argv.slice(2),flag=(key,def)=>args.includes(key)?args[args.indexOf(key)+1]:def;
const world=flag('--world','mars');if(!['mars','littlemartians'].includes(world))throw Error('--world mars|littlemartians');
const out=resolve(flag('--out',`<team>/scratch/parity/${world}`));
if(!out.startsWith('<team>/scratch/parity/'))throw Error('output must live in lane parity scratch');
if(existsSync(resolve(out,'old-data/sim.db'))||existsSync(resolve(out,'candidate-data/sim.db')))throw Error('Fixture data already exists; select a new output path for a fresh run');
const df=execFileSync('df',['-k','/System/Volumes/Data'],{encoding:'utf8'}).trim().split('\n').at(-1).split(/\s+/);
if(Number(df[3])*1024<15*1024**3)throw Error('under 15 GB free; parity stopped');
mkdirSync(out,{recursive:true});
if(readFileSync(resolve(root,'AGENTS.md'),'utf8').length===0)throw Error('missing project instructions');
const candidate=world==='mars'?'my-mars-college-2026-3':'little-martians-arium';
const template=resolve(root,`worlds/templates/${world==='mars'?'mars-two':'littlemartians-two'}.json`);
const oldPort=world==='mars'?5900:5902,newPort=oldPort+1,controlPort=5904;
let old,newWorld,control;
const cleanup=async()=>{
  newWorld?.child.kill('SIGTERM');
  if(newWorld)await Promise.race([new Promise(r=>newWorld.child.once('exit',r)),new Promise(r=>setTimeout(r,10000))]);
  await old?.close();if(control){control.closeAllConnections?.();await new Promise(r=>control.close(r));}
};
let shutting=false;for(const sig of ['SIGINT','SIGTERM'])process.once(sig,()=>{if(!shutting){shutting=true;void cleanup().finally(()=>process.exit(130));}});
try{
  // basePath permits an explicit isolated port; never invoke the legacy hard-coded port defaults.
  old=await openWorldServer({input:root,dataDir:resolve(out,'old-data'),worldKey:world,worldId:`parity-old-${world}`,
    port:oldPort,build:'local-parity/1',basePath:'/parity',webDir:resolve(root,'apps/web/dist'),marsWebDir:resolve(root,'.lane/mars-web'),
    seedCast:false,nativeCast:false,installLiving:true,authMode:'local-dev',cards:false});
  control=createServer(async(req,res)=>{
    if(req.method!=='POST'||req.url!=='/hour'){res.writeHead(404).end();return;}
    try{
      let text='';for await(const chunk of req){text+=chunk;if(text.length>100)throw Error('too long');}
      const {hour}=JSON.parse(text);if(!Number.isFinite(hour)||hour<0||hour>=24)throw Error('invalid hour');
      const tick=old.host.engine.world.tick;
      await old.host.enqueue('rules','parity-script',envClockConfig(tick,{dayTicks:72000,paused:true,set:{hour,n:Date.now()}},old.host.living));
      await new Promise(r=>setTimeout(r,650));
      res.setHeader('content-type','application/json');res.end(JSON.stringify({datetime:old.host.engine.world.env.datetime,hour}));
    }catch(e){res.writeHead(500).end(JSON.stringify({error:String(e)}));}
  });
  await new Promise((yes,no)=>{control.once('error',no);control.listen(controlPort,'127.0.0.1',yes);});
  newWorld=await startWorld({slug:candidate,port:newPort,data:resolve(out,'candidate-data'),genesis:template,log:resolve(out,'candidate-server.log')});
  const config={root,world,candidate,template,out,oldUrl:`http://127.0.0.1:${oldPort}/parity/w/${world}`,candidateUrl:newWorld.base,
    controlUrl:`http://127.0.0.1:${controlPort}/hour`,freshWorld:true,
    sourceCommit:execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    provenance:{liveSourceAndHistory:false,source:'old repo fixture + candidate repo genesis; no production database, roster or accepted history copied'}};
  const cfg=resolve(out,'config.json');writeFileSync(cfg,JSON.stringify(config,null,2));
  const child=spawn('python3',['<team>/ops/with-heavy-slot.py','--owner','parity','--purpose',`${world}-parity-gate`,'--timeout','1800','--',process.execPath,resolve(root,'tools/parity/evaluate.mjs'),cfg],{cwd:root,stdio:'inherit'});
  process.exitCode=await new Promise(r=>child.once('exit',r));
}finally{await cleanup();}
