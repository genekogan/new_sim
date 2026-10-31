// Entry 39 (M04): an owned disposable world for the shared motion transitions — the garden tap (entry 15/28, valve 1.14 m)
// and a low wooden deck (0.3 m, no rails: walked onto as a step, level 0) a few metres past it.
import {startWorld} from '../god-skill/dev-world.mjs';import {writeFileSync,mkdirSync} from 'node:fs';import {resolve} from 'node:path';
const out=process.env.SOUL_M04_SCENE??'<team>/soul-actions/day-39/scene',port=Number(process.env.SOUL_M04_PORT??7873);mkdirSync(out,{recursive:true});
const genesis={schema:'genesis/1',name:'Soul Actions · M04 transitions',constants:{extent:350,ground:'land'},batches:[{note:'Owned isolated transition scene',ops:[
 {op:'place',def:'core/garden-tap@1',name:'garden-tap',p:[0,4],r:Math.PI},
 {op:'place',def:'core/deck@1',name:'garden-deck',shape:{area:[[2.4,5],[5.4,5],[5.4,8.6],[2.4,8.6]]},params:{height:0.3,rails:false}}]}]};
writeFileSync(out+'/genesis.json',JSON.stringify(genesis));
Object.assign(process.env,{HOST:'127.0.0.1',AUTH_PROVIDER:'none',INVITE_REQUIRED:'0',MIND_DRIVER:'edge',WORLD_OWNER_ID:'dev:admin',EDGE_SKILL_FILE:resolve('tools/world-launcher/soul/skill.md'),EDGE_INSTRUCTIONS_FILE:resolve('tools/world-launcher/soul/instructions.md'),EDGE_CONTROLLER_CLI_FILE:resolve('tools/world-launcher/soul/eden.mjs'),EDGE_CLI_FILE:resolve('tools/edge-skill/eden-agent.mjs'),MARS_WEB_DIR:resolve('mars/viewer/public'),WEB_DIR:resolve('apps/web/dist'),ANTHROPIC_API_KEY:'',OPENAI_API_KEY:'',ARCHIVE_TAKES:'0',TAKES_PERSIST:'0'});
const w=await startWorld({slug:'soul-m04',port,data:out+'/data',genesis:out+'/genesis.json',log:out+'/server.log'});writeFileSync(out+'/world.json',JSON.stringify({base:w.base,pid:w.child.pid,dataDir:w.dataDir}));w.child.unref();console.log(JSON.stringify({base:w.base,pid:w.child.pid}));process.exit();
