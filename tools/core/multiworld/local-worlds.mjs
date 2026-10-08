// Start only the explicitly selected local worlds and proxy. An existing Eden
// server may be reused read-only; a provided Eden descriptor must use a private
// port and its own DB. New Mars/LM DBs are separate durable histories.
import {spawn} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,createWriteStream,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {copySqliteReadOnly} from './copy-sqlite.mjs';
const args=process.argv.slice(2);if(args.length!==1)throw Error('usage: node tools/core/multiworld/local-worlds.mjs <local-config.json>');
const config=JSON.parse(readFileSync(resolve(args[0]),'utf8')),input=resolve(config.input),dataDir=resolve(config.dataDir);
if(!config.input||!config.dataDir)throw Error('explicit input and dataDir required');mkdirSync(dataDir,{recursive:true});
const ports={eden:config.edenPort??4970,mars:config.mars?.port??4963,littlemartians:config.littlemartians?.port??4964},proxyPort=config.proxyPort??4966;
if(new Set([...Object.values(ports),proxyPort]).size!==4)throw Error('each world and proxy requires a distinct port');
if(!Number.isInteger(ports.eden)||!(ports.eden>=4950&&ports.eden<=4959||ports.eden===4970)||Object.entries({...ports,proxy:proxyPort}).some(([k,p])=>k!=='eden'&&(!Number.isInteger(p)||p<4963||p>4969)))throw Error('private local world ports required');
const children=[];let closing=false;
async function stop(code=0){if(closing)return;closing=true;for(const c of children)if(c.exitCode===null)c.kill('SIGTERM');await Promise.race([Promise.all(children.map(c=>c.exitCode!==null?Promise.resolve():new Promise(r=>c.once('exit',r)))),new Promise(r=>setTimeout(r,10000))]);for(const c of children)if(c.exitCode===null)c.kill('SIGKILL');process.exitCode=code;}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void stop());
process.on('uncaughtException',error=>{console.error(error.message);void stop(1);});
process.on('unhandledRejection',error=>{console.error(error instanceof Error?error.message:'Local launcher failed.');void stop(1);});
function launch(name,script,descriptor){
 const path=join(dataDir,name+'-descriptor.json');writeFileSync(path,JSON.stringify(descriptor,null,2)+'\n');
 const log=createWriteStream(join(dataDir,name+'.log'),{flags:'a'});
 const child=spawn(process.execPath,[join(input,script),path],{cwd:input,env:{...process.env,ANTHROPIC_API_KEY:'',TYPESAFE_API_KEY:'',BRAIN_MODE:'fake',EDGE_FADING:'0'},stdio:['ignore','pipe','pipe']});
 child.stdout.pipe(log);child.stderr.pipe(log);children.push(child);child.on('error',()=>void stop(1));child.on('exit',code=>{log.end();if(!closing){console.error(`Local ${name} stopped (${code}); shutting down the owned group.`);void stop(code||1);}});
}
if(config.edenDescriptor){if(ports.eden===4970)throw Error('owned Eden child must use a private4950..4959 port');const d=JSON.parse(readFileSync(resolve(config.edenDescriptor),'utf8'));if(d.port!==ports.eden)throw Error('Eden descriptor and selected port differ');launch('eden','tools/core/edge-server.mjs',d);}
for(const key of ['mars','littlemartians']){
 const selected=config[key]??{},dir=join(dataDir,key);mkdirSync(dir,{recursive:true});
 if(selected.sourceDb){
  // Explicit restoration source is opened read-only by sqlite3; never copy a
  // live WAL by filesystem bytes or overwrite an existing destination.
  const target=join(dir,'sim.db');if(existsSync(target))throw Error('restoration destination already exists');
  copySqliteReadOnly(resolve(selected.sourceDb),target);
 }
 launch(key,'tools/core/multiworld/world-server.mjs',{...selected,sourceDb:undefined,input,dataDir:dir,worldKey:key,worldId:selected.worldId??(key==='mars'?'mars-2026-1':'littlemartians-1'),port:ports[key],publicOrigin:`http://127.0.0.1:${proxyPort}`,webDir:config.webDir,marsWebDir:config.marsWebDir,skillFile:config.skillFile,cliFile:config.cliFile,ownerId:config.ownerId??'dev:admin',build:config.build??'local-multiworld/1'});
}
async function ready(){const deadline=performance.now()+90000;for(;;){if(closing)throw Error('local children stopped');let ok=true;for(const [key,port] of Object.entries(ports)){try{const r=await fetch(`http://127.0.0.1:${port}/w/${key}/v1/config`,{signal:AbortSignal.timeout(1500)}),body=await r.json();if(!r.ok||body.worldKey!==key)ok=false;}catch{ok=false;}}if(ok)return;if(performance.now()>deadline)throw Error('local world readiness timeout');await new Promise(r=>setTimeout(r,250));}}
try{await ready();launch('proxy','tools/core/multiworld/proxy.mjs',{port:proxyPort,worlds:ports});console.log(JSON.stringify({url:`http://127.0.0.1:${proxyPort}`,worlds:ports,dataDir,nativeMinds:'fake-only'}));}
catch(error){console.error(error.message);await stop(1);}