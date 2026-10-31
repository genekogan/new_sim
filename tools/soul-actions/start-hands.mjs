// Entry 35: an owned disposable world for rock-paper-scissors and holding hands: an open lawn with a zone to walk to
// (the lawn's far end), an orchard of fruit trees behind, a bench and a flower bed; port SOUL_HANDS_PORT (7876).
import {startWorld} from '../god-skill/dev-world.mjs';import {writeFileSync,mkdirSync} from 'node:fs';import {resolve} from 'node:path';
const out=process.env.SOUL_HANDS_SCENE??'<team>/soul-actions/day-35/scene',port=Number(process.env.SOUL_HANDS_PORT??7876);mkdirSync(out,{recursive:true});
const zone=(name,x,z,w,what)=>({op:'place',def:'core/zone@1',name,shape:{area:[[x-w,z-w],[x+w,z-w],[x+w,z+w],[x-w,z+w]]},about:{what}});
const genesis={schema:'genesis/1',name:'Soul Actions · Hands and games',constants:{extent:350,ground:'land'},batches:[{note:'Owned isolated hands acceptance',ops:[
 zone('lawn',0,9,1.6,'The far end of the open lawn, past the flower bed.'),zone('orchard',-8,-2,2,'A small orchard of fruit trees west of the lawn.'),
 {op:'place',def:'core/bench@1',name:'bench',p:[6,1],r:Math.PI/2},{op:'place',def:'core/flower-bed@1',name:'flower-bed',p:[3.4,6.5]},
 ...[[-10,-4],[-6,-4.5],[-10.5,0.5],[-5.6,0.2]].map(([x,z],i)=>({op:'place',def:'core/fruit-tree@1',name:`apple-tree-${i}`,p:[x,z]})),
 {op:'place',def:'core/tree@1',name:'oak',p:[8,11]}]}]};
writeFileSync(out+'/genesis.json',JSON.stringify(genesis));
Object.assign(process.env,{HOST:'127.0.0.1',AUTH_PROVIDER:'none',INVITE_REQUIRED:'0',MIND_DRIVER:'edge',WORLD_OWNER_ID:'dev:admin',EDGE_SKILL_FILE:resolve('tools/world-launcher/soul/skill.md'),EDGE_INSTRUCTIONS_FILE:resolve('tools/world-launcher/soul/instructions.md'),EDGE_CONTROLLER_CLI_FILE:resolve('tools/world-launcher/soul/eden.mjs'),EDGE_CLI_FILE:resolve('tools/edge-skill/eden-agent.mjs'),MARS_WEB_DIR:resolve('mars/viewer/public'),WEB_DIR:resolve('apps/web/dist'),ANTHROPIC_API_KEY:'',OPENAI_API_KEY:'',ARCHIVE_TAKES:'0',TAKES_PERSIST:'0'});
const w=await startWorld({slug:'soul-hands',port,data:out+'/data',genesis:out+'/genesis.json',log:out+'/server.log'});writeFileSync(out+'/world.json',JSON.stringify({base:w.base,pid:w.child.pid,dataDir:w.dataDir}));w.child.unref();console.log(JSON.stringify({base:w.base,pid:w.child.pid}));process.exit();
