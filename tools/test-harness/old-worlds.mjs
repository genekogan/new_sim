// Lane REC: three local root-path old-world dev servers (eden/mars/littlemartians) from one source tree, fake minds,
// fresh data dirs, ports in 5400-5449 only. node old-worlds.mjs <tree> <firstPort> <label>
import {spawn} from 'node:child_process';import {mkdirSync,openSync,rmSync} from 'node:fs';import {resolve} from 'node:path';
const [tree,first,label]=process.argv.slice(2);const p0=Number(first);
if(!(p0>=5400&&p0+2<=5449))throw Error('ports 5400-5449 only');
const scratch=resolve(process.env.OLD_WORLDS_OUT??'/tmp/sim-old-worlds');
const kids=[];
['eden','mars','littlemartians'].forEach((key,i)=>{const port=p0+i,dataDir=resolve(scratch,label,key);rmSync(dataDir,{recursive:true,force:true});mkdirSync(dataDir,{recursive:true});
 const log=openSync(resolve(scratch,`${label}-${key}.log`),'w');
 const env={...process.env,WORLD_KEY:key,WORLD_ID:`${key}-rec-1`,ENGINE:'mars',PORT:String(port),HOST:'127.0.0.1',DEV_AUTH:'1',BRAIN_MODE:'fake',SEED_NATIVES:'1',MAX_SOULS_PER_USER:'50',DATA_DIR:dataDir,PUBLIC_URL:`http://127.0.0.1:${port}`,MARS_WEB_DIR:process.env.MARS_WEB_DIR??resolve(new URL('../../.lane/mars-web', import.meta.url).pathname),WEB_DIR:resolve(tree,'apps/web/dist')};
 const k=spawn(process.execPath,['apps/server/src/main.ts'],{cwd:tree,env,stdio:['ignore',log,log]});kids.push(k);console.log(label,key,port,'pid',k.pid);});
const stop=()=>{for(const k of kids)try{k.kill('SIGTERM');}catch{};setTimeout(()=>process.exit(0),1500);};
process.on('SIGTERM',stop);process.on('SIGINT',stop);setInterval(()=>{},1e6);
