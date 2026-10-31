// Entry 23: an owned disposable world: a curtained window and a blind window side by side (their inside toward the
// origin), a lit floor lamp in the room, and 100 distant windows (some closed).
import {startWorld} from '../god-skill/dev-world.mjs';import {writeFileSync,mkdirSync} from 'node:fs';import {resolve} from 'node:path';
const out=process.env.SOUL_CURTAINS_SCENE??'<team>/soul-actions/day-23/scene';mkdirSync(out,{recursive:true});
const genesis={schema:'genesis/1',name:'Soul Actions · Curtains',constants:{extent:350,ground:'land'},batches:[{note:'Owned isolated curtains acceptance',ops:[
 {op:'place',def:'core/curtained-window@1',name:'curtains',p:[1.4,4],r:Math.PI},
 {op:'place',def:'core/blind-window@1',name:'blind',p:[-1.4,4],r:Math.PI},
 {op:'place',def:'core/floor-lamp@2',name:'room-lamp',p:[2.0,2.7],state:{on:true}}]},
 {note:'distant',ops:Array.from({length:100},(_,i)=>({op:'place',def:i%2?'core/blind-window@1':'core/curtained-window@1',name:`distant-window-${i}`,p:[120+i%10*4,120+Math.floor(i/10)*4],state:{open:i%4<2}}))}]};
writeFileSync(out+'/genesis.json',JSON.stringify(genesis));
Object.assign(process.env,{HOST:'127.0.0.1',AUTH_PROVIDER:'none',INVITE_REQUIRED:'0',MIND_DRIVER:'edge',WORLD_OWNER_ID:'dev:admin',EDGE_SKILL_FILE:resolve('tools/world-launcher/soul/skill.md'),EDGE_INSTRUCTIONS_FILE:resolve('tools/world-launcher/soul/instructions.md'),EDGE_CONTROLLER_CLI_FILE:resolve('tools/world-launcher/soul/eden.mjs'),EDGE_CLI_FILE:resolve('tools/edge-skill/eden-agent.mjs'),MARS_WEB_DIR:resolve('mars/viewer/public'),WEB_DIR:resolve('apps/web/dist'),ANTHROPIC_API_KEY:'',OPENAI_API_KEY:'',ARCHIVE_TAKES:'0',TAKES_PERSIST:'0'});
const w=await startWorld({slug:'soul-curtains',port:7865,data:out+'/data',genesis:out+'/genesis.json',log:out+'/server.log'});writeFileSync(out+'/world.json',JSON.stringify({base:w.base,pid:w.child.pid,dataDir:w.dataDir}));w.child.unref();console.log(JSON.stringify({base:w.base,pid:w.child.pid}));process.exit();
