// Entry 33: an owned disposable world with a standing torch, a wall torch on a garden wall, a neon sign, and 100 distant
// copies of each (all lit).
import {startWorld} from '../god-skill/dev-world.mjs';import {writeFileSync,mkdirSync} from 'node:fs';import {resolve} from 'node:path';
const out=process.env.SOUL_TORCH_SCENE??'<team>/soul-actions/day-33/scene';mkdirSync(out,{recursive:true});
const distant=['standing-torch@1','wall-torch@1','neon-sign@1'].flatMap((d,k)=>Array.from({length:100},(_,i)=>({op:'place',def:'core/'+d,name:`distant-${d.split('@')[0]}-${i}`,p:[120+k*60+i%10*5,120+Math.floor(i/10)*5],state:{on:true}})));
const genesis={schema:'genesis/1',name:'Soul Actions · Torches and neon',constants:{extent:600,ground:'land'},batches:[{note:'Owned isolated torch and neon acceptance',ops:[
 {op:'place',def:'core/standing-torch@1',name:'torch',p:[-2.2,4.0]},
 {op:'place',def:'core/garden-wall@1',name:'garden-wall',shape:{path:[[-4.6,7.3],[0.4,7.3]]},params:{height:2.2,thickness:0.35,color:'#8c8377'}},
 {op:'place',def:'core/wall-torch@1',name:'wall-torch',p:[-2.1,6.99],r:Math.PI},
 {op:'place',def:'core/neon-sign@1',name:'neon-sign',p:[2.7,6.2],r:Math.PI,state:{text:'Night Garden'}}]},
 ...[0,100,200].map(i=>({note:'distant',ops:distant.slice(i,i+100)}))]};
writeFileSync(out+'/genesis.json',JSON.stringify(genesis));
Object.assign(process.env,{HOST:'127.0.0.1',AUTH_PROVIDER:'none',INVITE_REQUIRED:'0',MIND_DRIVER:'edge',WORLD_OWNER_ID:'dev:admin',EDGE_SKILL_FILE:resolve('tools/world-launcher/soul/skill.md'),EDGE_INSTRUCTIONS_FILE:resolve('tools/world-launcher/soul/instructions.md'),EDGE_CONTROLLER_CLI_FILE:resolve('tools/world-launcher/soul/eden.mjs'),EDGE_CLI_FILE:resolve('tools/edge-skill/eden-agent.mjs'),MARS_WEB_DIR:resolve('mars/viewer/public'),WEB_DIR:resolve('apps/web/dist'),ANTHROPIC_API_KEY:'',OPENAI_API_KEY:'',ARCHIVE_TAKES:'0',TAKES_PERSIST:'0'});
const w=await startWorld({slug:'soul-torch-neon',port:7873,data:out+'/data',genesis:out+'/genesis.json',log:out+'/server.log'});writeFileSync(out+'/world.json',JSON.stringify({base:w.base,pid:w.child.pid,dataDir:w.dataDir}));w.child.unref();console.log(JSON.stringify({base:w.base,pid:w.child.pid}));process.exit();
