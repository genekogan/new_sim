// Entry 41: an owned disposable world for the consensual hand-over: a table with the lantern and the bowl on it (entry
// 29's opted-in items), a meadow to stand on a few metres off, and a bench for the bystander; port SOUL_HANDOVER_PORT (7880).
import {startWorld} from '../god-skill/dev-world.mjs';import {writeFileSync,mkdirSync} from 'node:fs';import {resolve} from 'node:path';
const out=process.env.SOUL_HANDOVER_SCENE??'<team>/soul-actions/day-41/scene',port=Number(process.env.SOUL_HANDOVER_PORT??7880);mkdirSync(out,{recursive:true});
const zone=(name,x,z,w,what)=>({op:'place',def:'core/zone@1',name,shape:{area:[[x-w,z-w],[x+w,z-w],[x+w,z+w],[x-w,z+w]]},about:{what}});
const genesis={schema:'genesis/1',name:'Soul Actions · Hand-over',constants:{extent:350,ground:'land'},batches:[{note:'Owned isolated hand-over acceptance',ops:[
 {op:'world',state:{time:{set:{hour:17.5,n:1},paused:true},weather:{kind:'clear',rain:0,clouds:.05,wind:.05,fog:0}}},
 {op:'place',def:'core/table@1',name:'table',p:[-3,3]},
 {op:'place',def:'core/lantern@3',name:'lantern',in:{parent:'table',slot:'top'},p:[-.2,0]},
 {op:'place',def:'core/bowl@2',name:'bowl',in:{parent:'table',slot:'top'},p:[.25,0]},
 zone('meadow',1.5,6,1.2,'A patch of meadow a few steps from the table.'),
 {op:'place',def:'core/bench@1',name:'bench',p:[6,0],r:Math.PI/2},{op:'place',def:'core/flower-bed@1',name:'flower-bed',p:[4,8]},
 {op:'place',def:'core/tree@1',name:'oak',p:[-7,9]}]}]};
writeFileSync(out+'/genesis.json',JSON.stringify(genesis));
Object.assign(process.env,{HOST:'127.0.0.1',AUTH_PROVIDER:'none',INVITE_REQUIRED:'0',MIND_DRIVER:'edge',WORLD_OWNER_ID:'dev:admin',EDGE_SKILL_FILE:resolve('tools/world-launcher/soul/skill.md'),EDGE_INSTRUCTIONS_FILE:resolve('tools/world-launcher/soul/instructions.md'),EDGE_CONTROLLER_CLI_FILE:resolve('tools/world-launcher/soul/eden.mjs'),EDGE_CLI_FILE:resolve('tools/edge-skill/eden-agent.mjs'),MARS_WEB_DIR:resolve('mars/viewer/public'),WEB_DIR:resolve('apps/web/dist'),ANTHROPIC_API_KEY:'',OPENAI_API_KEY:'',ARCHIVE_TAKES:'0',TAKES_PERSIST:'0'});
const w=await startWorld({slug:'soul-handover',port,data:out+'/data',genesis:out+'/genesis.json',log:out+'/server.log'});writeFileSync(out+'/world.json',JSON.stringify({base:w.base,pid:w.child.pid,dataDir:w.dataDir}));w.child.unref();console.log(JSON.stringify({base:w.base,pid:w.child.pid}));process.exit();
