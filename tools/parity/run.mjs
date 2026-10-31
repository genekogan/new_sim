#!/usr/bin/env node
// Boot only disposable fixtures; evaluation gets the heavy slot, servers do not.
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openWorldServer } from '../core/multiworld/world-server.mjs';
import { startWorld } from '../god-skill/dev-world.mjs';
import { envClockConfig } from '../../apps/server/src/god/world-clock.ts';
import { scratchDir } from '../lib/paths.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const args=process.argv.slice(2),flag=(key,def)=>args.includes(key)?args[args.indexOf(key)+1]:def;
const world=flag('--world','mars');if(!['mars','littlemartians'].includes(world))throw Error('--world mars|littlemartians');
const out=resolve(flag('--out',scratchDir(`parity/${world}`)));
if(!out.startsWith(scratchDir('parity')+sep))throw Error('output must live in the parity scratch dir (SIM_SCRATCH or .local)');
if(existsSync(resolve(out,'old-data/sim.db'))||existsSync(resolve(out,'candidate-data/sim.db')))throw Error('Fixture data already exists; select a new output path for a fresh run');
const df=execFileSync('df',['-k','/System/Volumes/Data'],{encoding:'utf8'}).trim().split('\n').at(-1).split(/\s+/);
if(Number(df[3])*1024<15*1024**3)throw Error('under 15 GB free; parity stopped');
mkdirSync(out,{recursive:true});
if(readFileSync(resolve(root,'AGENTS.md'),'utf8').length===0)throw Error('missing project instructions');
const candidate=world==='mars'?'my-mars-college-2026-3':'little-martians-arium';
const template=resolve(root,`worlds/templates/${world==='mars'?'mars-two':'littlemartians-two'}.json`);
const oldPort=world==='mars'?5900:5902,newPort=oldPort+1,controlPort=world==='mars'?5904:5905;
// The legacy launcher validates its historical virtual port. The sanctioned preload
// remaps listen/connect before any socket opens; the browser only sees 5900–5909.
const virtualPort=world==='mars'?4963:4964;
process.env.PORT_REMAP_BASE=String(oldPort-(virtualPort-4930));
await import('../test-harness/port-remap.mjs');
let old,newWorld,control,evaluator;
const cleanup=async()=>{
  if(evaluator?.exitCode===null)evaluator.kill('SIGTERM');
  newWorld?.child.kill('SIGTERM');
  if(newWorld)await Promise.race([new Promise(r=>newWorld.child.once('exit',r)),new Promise(r=>setTimeout(r,10000))]);
  await old?.close();if(control){control.closeAllConnections?.();await new Promise(r=>control.close(r));}
};
let shutting=false;for(const sig of ['SIGINT','SIGTERM'])process.once(sig,()=>{if(!shutting){shutting=true;void cleanup().finally(()=>process.exit(130));}});
try{
  // Root-built viewer keeps /w/<key>; no unsupported path prefix is invented.
  old=await openWorldServer({input:root,dataDir:resolve(out,'old-data'),worldKey:world,worldId:`parity-old-${world}`,
    port:virtualPort,publicOrigin:`http://127.0.0.1:${oldPort}`,build:'local-parity/1',webDir:resolve(root,'apps/web/dist'),marsWebDir:resolve(root,'.lane/mars-web'),
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
  const config={root,world,candidate,template,out,oldUrl:`http://127.0.0.1:${oldPort}/w/${world}`,candidateUrl:newWorld.base,
    views:flag('--views','').split(',').filter(Boolean),captureOnly:args.includes('--capture-only'),
    controlUrl:`http://127.0.0.1:${controlPort}/hour`,freshWorld:true,
    sourceCommit:execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    provenance:{liveSourceAndHistory:false,source:'old repo fixture + candidate repo genesis; no production database, roster or accepted history copied'}};
  const cfg=resolve(out,'config.json');writeFileSync(cfg,JSON.stringify(config,null,2));
  // SIM_HEAVY_SLOT: an optional machine-wide heavy-work lock wrapper (python3 <it> --owner … -- <cmd>); unset runs directly.
  const compareCmd=[process.execPath,resolve(root,'tools/parity/compare.mjs'),cfg],heavy=process.env.SIM_HEAVY_SLOT;
  evaluator=heavy?spawn('python3',[heavy,'--owner','parity','--purpose',`${world}-comparison`,'--timeout','1800','--',...compareCmd],{cwd:root,stdio:'inherit'}):spawn(compareCmd[0],compareCmd.slice(1),{cwd:root,stdio:'inherit'});
  process.exitCode=await new Promise(r=>evaluator.once('exit',r));
}finally{await cleanup();}
