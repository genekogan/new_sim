// Entry 42: an owned disposable world: a table with a bowl, a chest of drawers and lockers that keep things inside, and
// 100 distant chests (half open) each with a bowl kept in it. A restart (same data dir) keeps what was put away.
import {startWorld} from '../god-skill/dev-world.mjs';import {writeFileSync,mkdirSync,existsSync} from 'node:fs';import {resolve} from 'node:path';
const out=process.env.SOUL_CONTAINERS_SCENE??'<team>/soul-actions/day-42/scene',port=Number(process.env.SOUL_CONTAINERS_PORT??7881);mkdirSync(out,{recursive:true});
if(!existsSync(out+'/genesis.json')){
 const ops=[{op:'world',state:{time:{set:{hour:10.5,n:1},paused:true},weather:{kind:'clear',rain:0,clouds:.05,wind:.05,fog:0}}},
  {op:'place',def:'core/drawer-chest@2',name:'chest',p:[0,5],r:Math.PI},
  {op:'place',def:'core/table@1',name:'table',p:[1.9,3.3],r:Math.PI/2},
  {op:'place',def:'core/bowl@2',name:'bowl',in:{parent:'table',slot:'top'},p:[0,-.2]},
  {op:'place',def:'core/lockers@3',name:'locker',p:[-2.6,5.1],r:Math.PI},
  {op:'place',def:'core/bench@1',name:'bench',p:[0,-3]}];
 const distant=Array.from({length:100},(_,i)=>[{op:'place',def:'core/drawer-chest@2',name:`distant-chest-${i}`,p:[120+i%10*2,120+Math.floor(i/10)*2],state:{open:i%2===0}},{op:'place',def:'core/bowl@2',name:`distant-bowl-${i}`,in:{parent:`distant-chest-${i}`,slot:'in-1'},p:[0,0]}]).flat();
 writeFileSync(out+'/genesis.json',JSON.stringify({schema:'genesis/1',name:'Soul Actions · Containers',constants:{extent:350,ground:'land'},batches:[{note:'Owned isolated containers acceptance',ops},{note:'distant',ops:distant}]}));
}
Object.assign(process.env,{HOST:'127.0.0.1',AUTH_PROVIDER:'none',INVITE_REQUIRED:'0',MIND_DRIVER:'edge',WORLD_OWNER_ID:'dev:admin',EDGE_SKILL_FILE:resolve('tools/world-launcher/soul/skill.md'),EDGE_INSTRUCTIONS_FILE:resolve('tools/world-launcher/soul/instructions.md'),EDGE_CONTROLLER_CLI_FILE:resolve('tools/world-launcher/soul/eden.mjs'),EDGE_CLI_FILE:resolve('tools/edge-skill/eden-agent.mjs'),MARS_WEB_DIR:resolve('mars/viewer/public'),WEB_DIR:resolve('apps/web/dist'),ANTHROPIC_API_KEY:'',OPENAI_API_KEY:'',ARCHIVE_TAKES:'0',TAKES_PERSIST:'1'});
const w=await startWorld({slug:'soul-containers',port,data:out+'/data',genesis:out+'/genesis.json',log:out+'/server.log'});writeFileSync(out+'/world.json',JSON.stringify({base:w.base,pid:w.child.pid,dataDir:w.dataDir}));w.child.unref();console.log(JSON.stringify({base:w.base,pid:w.child.pid}));process.exit();
