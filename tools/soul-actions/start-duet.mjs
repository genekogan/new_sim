// Entry 26: an owned disposable world with a piano and a drum kit side by side, and 100 distant drum kits.
import {startWorld} from '../god-skill/dev-world.mjs';import {writeFileSync,mkdirSync} from 'node:fs';import {resolve} from 'node:path';
const out=process.env.SOUL_DUET_SCENE??'<team>/soul-actions/day-26/scene';mkdirSync(out,{recursive:true});
const genesis={schema:'genesis/1',name:'Soul Actions · Duet',constants:{extent:350,ground:'land'},batches:[{note:'Owned isolated duet acceptance',ops:[
 {op:'place',def:'core/piano@1',name:'piano',p:[-1.3,5],r:0.35},
 {op:'place',def:'core/drum-kit@1',name:'drums',p:[1.3,5],r:-0.35},
 ...Array.from({length:100},(_,i)=>({op:'place',def:'core/drum-kit@1',name:`distant-drums-${i}`,p:[120+i%10*2,120+Math.floor(i/10)*2]}))]}]};
writeFileSync(out+'/genesis.json',JSON.stringify(genesis));
Object.assign(process.env,{HOST:'127.0.0.1',AUTH_PROVIDER:'none',INVITE_REQUIRED:'0',MIND_DRIVER:'edge',WORLD_OWNER_ID:'dev:admin',EDGE_SKILL_FILE:resolve('tools/world-launcher/soul/skill.md'),EDGE_INSTRUCTIONS_FILE:resolve('tools/world-launcher/soul/instructions.md'),EDGE_CONTROLLER_CLI_FILE:resolve('tools/world-launcher/soul/eden.mjs'),EDGE_CLI_FILE:resolve('tools/edge-skill/eden-agent.mjs'),MARS_WEB_DIR:resolve('mars/viewer/public'),WEB_DIR:resolve('apps/web/dist'),ANTHROPIC_API_KEY:'',OPENAI_API_KEY:'',ARCHIVE_TAKES:'0',TAKES_PERSIST:'0'});
const w=await startWorld({slug:'soul-duet',port:7868,data:out+'/data',genesis:out+'/genesis.json',log:out+'/server.log'});writeFileSync(out+'/world.json',JSON.stringify({base:w.base,pid:w.child.pid,dataDir:w.dataDir}));w.child.unref();console.log(JSON.stringify({base:w.base,pid:w.child.pid}));process.exit();
