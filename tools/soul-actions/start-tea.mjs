// Entry 43: an owned disposable kitchen: a counter (its doors toward the arrival) with an empty kettle and two mugs with tea
// bags, the camp sink beside it, and a table to set a cup of tea on. Run again on the same data to restart the world.
import {startWorld} from '../god-skill/dev-world.mjs';import {writeFileSync,mkdirSync} from 'node:fs';import {resolve} from 'node:path';
const out=process.env.SOUL_TEA_SCENE??'<team>/soul-actions/day-43/scene',port=Number(process.env.SOUL_TEA_PORT??7882);mkdirSync(out,{recursive:true});
const genesis={schema:'genesis/1',name:'Soul Actions · Tea',constants:{extent:350,ground:'land'},batches:[{note:'Owned isolated tea acceptance',ops:[
 {op:'world',state:{time:{set:{hour:16.5,n:1},paused:true},weather:{kind:'clear',rain:0,clouds:.1,wind:.02,fog:0}}},
 {op:'place',def:'core/counter@1',tmp:'$counter',name:'counter',p:[0,3.2],r:Math.PI},
 {op:'place',def:'core/kettle@2',name:'kettle',in:{parent:'$counter',slot:'top'},p:[0.3,0.1],r:Math.PI/2},
 {op:'place',def:'core/cup@2',name:'cup',in:{parent:'$counter',slot:'top'},p:[-0.12,0.19]},
 {op:'place',def:'core/cup@2',name:'cup-two',in:{parent:'$counter',slot:'top'},p:[-0.42,0.19]},
 {op:'place',def:'core/camp-sink@1',name:'sink',p:[-2.3,3.0]},
 {op:'place',def:'core/table@1',name:'table',p:[2.6,1.6]},
 {op:'place',def:'core/bench@1',name:'bench',p:[2.6,0.4]}]}]};
writeFileSync(out+'/genesis.json',JSON.stringify(genesis));
Object.assign(process.env,{HOST:'127.0.0.1',AUTH_PROVIDER:'none',INVITE_REQUIRED:'0',MIND_DRIVER:'edge',WORLD_OWNER_ID:'dev:admin',EDGE_SKILL_FILE:resolve('tools/world-launcher/soul/skill.md'),EDGE_INSTRUCTIONS_FILE:resolve('tools/world-launcher/soul/instructions.md'),EDGE_CONTROLLER_CLI_FILE:resolve('tools/world-launcher/soul/eden.mjs'),EDGE_CLI_FILE:resolve('tools/edge-skill/eden-agent.mjs'),MARS_WEB_DIR:resolve('mars/viewer/public'),WEB_DIR:resolve('apps/web/dist'),ANTHROPIC_API_KEY:'',OPENAI_API_KEY:'',ARCHIVE_TAKES:'0',TAKES_PERSIST:'0'});
const w=await startWorld({slug:'soul-tea',port,data:out+'/data',genesis:out+'/genesis.json',log:out+'/server.log'});writeFileSync(out+'/world.json',JSON.stringify({base:w.base,pid:w.child.pid,dataDir:w.dataDir}));w.child.unref();console.log(JSON.stringify({base:w.base,pid:w.child.pid}));process.exit();
