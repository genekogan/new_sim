// Entry 37: an owned disposable world with a radio on its console shelf and 100 distant radios, all playing, stations mixed.
import {startWorld} from '../god-skill/dev-world.mjs';import {writeFileSync,mkdirSync} from 'node:fs';import {resolve} from 'node:path';
const out=process.env.SOUL_RADIO_SCENE??'<team>/soul-actions/day-37/scene',port=Number(process.env.SOUL_RADIO_PORT??7875);mkdirSync(out,{recursive:true});
const STATIONS=['quiet piano','dance band','evening talk'];
const genesis={schema:'genesis/1',name:'Soul Actions · Radio',constants:{extent:350,ground:'land'},batches:[{note:'Owned isolated radio acceptance',ops:[
 {op:'place',def:'core/radio@2',name:'radio',p:[0,4],r:Math.PI},
 ...Array.from({length:100},(_,i)=>({op:'place',def:'core/radio@2',name:`distant-radio-${i}`,p:[120+i%10*3,120+Math.floor(i/10)*3],state:{on:true,station:STATIONS[i%3]}}))]}]};
writeFileSync(out+'/genesis.json',JSON.stringify(genesis));
Object.assign(process.env,{HOST:'127.0.0.1',AUTH_PROVIDER:'none',INVITE_REQUIRED:'0',MIND_DRIVER:'edge',WORLD_OWNER_ID:'dev:admin',EDGE_SKILL_FILE:resolve('tools/world-launcher/soul/skill.md'),EDGE_INSTRUCTIONS_FILE:resolve('tools/world-launcher/soul/instructions.md'),EDGE_CONTROLLER_CLI_FILE:resolve('tools/world-launcher/soul/eden.mjs'),EDGE_CLI_FILE:resolve('tools/edge-skill/eden-agent.mjs'),MARS_WEB_DIR:resolve('mars/viewer/public'),WEB_DIR:resolve('apps/web/dist'),ANTHROPIC_API_KEY:'',OPENAI_API_KEY:'',ARCHIVE_TAKES:'0',TAKES_PERSIST:'0'});
const w=await startWorld({slug:'soul-radio',port,data:out+'/data',genesis:out+'/genesis.json',log:out+'/server.log'});writeFileSync(out+'/world.json',JSON.stringify({base:w.base,pid:w.child.pid,dataDir:w.dataDir}));w.child.unref();console.log(JSON.stringify({base:w.base,pid:w.child.pid}));process.exit();
