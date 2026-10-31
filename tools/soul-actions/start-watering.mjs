// Entry 34: an owned disposable garden: a can hanging empty on its hook, the garden tap, a sown bed and a leafy bed.
import {startWorld} from '../god-skill/dev-world.mjs';import {writeFileSync,mkdirSync} from 'node:fs';import {resolve} from 'node:path';
import {HOOK_PEG,CAN_GRIP} from '../../packages/world-compiler/src/core-kit/watering-can.ts';
const out=process.env.SOUL_WATERING_SCENE??'<team>/soul-actions/day-34/scene',port=Number(process.env.SOUL_WATERING_PORT??7872);mkdirSync(out,{recursive:true});
const hang=[HOOK_PEG[0]-CAN_GRIP[0],HOOK_PEG[1]-CAN_GRIP[1],HOOK_PEG[2]-CAN_GRIP[2]];
const genesis={schema:'genesis/1',name:'Soul Actions · Watering can',constants:{extent:350,ground:'land'},batches:[{note:'Owned isolated watering-can acceptance',ops:[
 {op:'place',def:'core/can-hook@1',tmp:'$hook',name:'can-hook',p:[2.2,2.4]},
 {op:'place',def:'core/watering-can@2',name:'watering-can',in:{parent:'$hook'},p:hang,state:{level:0}},
 {op:'place',def:'core/garden-tap@1',name:'garden-tap',p:[-2.4,3.4]},
 {op:'place',def:'core/garden-planter@2',name:'rose-bed',p:[0.3,5.2]},
 {op:'place',def:'core/garden-planter@2',name:'herb-bed',p:[-1.9,6.4],state:{growth:2,moisture:0.4}},
 {op:'place',def:'core/floor-lamp@2',name:'garden-lamp',p:[1.7,6.5]}]}]};
writeFileSync(out+'/genesis.json',JSON.stringify(genesis));
Object.assign(process.env,{HOST:'127.0.0.1',AUTH_PROVIDER:'none',INVITE_REQUIRED:'0',MIND_DRIVER:'edge',WORLD_OWNER_ID:'dev:admin',EDGE_SKILL_FILE:resolve('tools/world-launcher/soul/skill.md'),EDGE_INSTRUCTIONS_FILE:resolve('tools/world-launcher/soul/instructions.md'),EDGE_CONTROLLER_CLI_FILE:resolve('tools/world-launcher/soul/eden.mjs'),EDGE_CLI_FILE:resolve('tools/edge-skill/eden-agent.mjs'),MARS_WEB_DIR:resolve('mars/viewer/public'),WEB_DIR:resolve('apps/web/dist'),ANTHROPIC_API_KEY:'',OPENAI_API_KEY:'',ARCHIVE_TAKES:'0',TAKES_PERSIST:'0'});
const w=await startWorld({slug:'soul-watering',port,data:out+'/data',genesis:out+'/genesis.json',log:out+'/server.log'});writeFileSync(out+'/world.json',JSON.stringify({base:w.base,pid:w.child.pid,dataDir:w.dataDir}));w.child.unref();console.log(JSON.stringify({base:w.base,pid:w.child.pid}));process.exit();
