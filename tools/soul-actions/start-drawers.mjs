// Entry 24: an owned disposable world: a chest of drawers facing the origin, and 100 distant chests (half open).
import {startWorld} from '../god-skill/dev-world.mjs';import {writeFileSync,mkdirSync} from 'node:fs';import {resolve} from 'node:path';
const out=process.env.SOUL_DRAWERS_SCENE??'<team>/soul-actions/day-24/scene';mkdirSync(out,{recursive:true});
const genesis={schema:'genesis/1',name:'Soul Actions · Drawers',constants:{extent:350,ground:'land'},batches:[{note:'Owned isolated drawers acceptance',ops:[
 {op:'place',def:'core/drawer-chest@1',name:'chest',p:[0,5],r:Math.PI}]},
 {note:'distant',ops:Array.from({length:100},(_,i)=>({op:'place',def:'core/drawer-chest@1',name:`distant-chest-${i}`,p:[120+i%10*2,120+Math.floor(i/10)*2],state:{open:i%2===0}}))}]};
writeFileSync(out+'/genesis.json',JSON.stringify(genesis));
Object.assign(process.env,{HOST:'127.0.0.1',AUTH_PROVIDER:'none',INVITE_REQUIRED:'0',MIND_DRIVER:'edge',WORLD_OWNER_ID:'dev:admin',EDGE_SKILL_FILE:resolve('tools/world-launcher/soul/skill.md'),EDGE_INSTRUCTIONS_FILE:resolve('tools/world-launcher/soul/instructions.md'),EDGE_CONTROLLER_CLI_FILE:resolve('tools/world-launcher/soul/eden.mjs'),EDGE_CLI_FILE:resolve('tools/edge-skill/eden-agent.mjs'),MARS_WEB_DIR:resolve('mars/viewer/public'),WEB_DIR:resolve('apps/web/dist'),ANTHROPIC_API_KEY:'',OPENAI_API_KEY:'',ARCHIVE_TAKES:'0',TAKES_PERSIST:'0'});
const w=await startWorld({slug:'soul-drawers',port:7866,data:out+'/data',genesis:out+'/genesis.json',log:out+'/server.log'});writeFileSync(out+'/world.json',JSON.stringify({base:w.base,pid:w.child.pid,dataDir:w.dataDir}));w.child.unref();console.log(JSON.stringify({base:w.base,pid:w.child.pid}));process.exit();
