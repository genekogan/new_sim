// Entry 22: an owned disposable world with a candle stand, string lights, a campfire, and 100 distant
// copies of each new fixture (half of them lit).
import {startWorld} from '../god-skill/dev-world.mjs';import {writeFileSync,mkdirSync} from 'node:fs';import {resolve} from 'node:path';
const out=process.env.SOUL_FIRE_SCENE??'<team>/soul-actions/day-22/scene';mkdirSync(out,{recursive:true});
const distant=['candle-stand@1','string-lights@2','campfire@2'].flatMap((d,k)=>Array.from({length:100},(_,i)=>({op:'place',def:'core/'+d,name:`distant-${d.split('@')[0]}-${i}`,p:[120+k*60+i%10*5,120+Math.floor(i/10)*5],state:{on:i%2===0}})));
const genesis={schema:'genesis/1',name:'Soul Actions · Fire and lights',constants:{extent:600,ground:'land'},batches:[{note:'Owned isolated fire acceptance',ops:[
 {op:'place',def:'core/candle-stand@1',name:'candle',p:[-1.8,4.2]},
 {op:'place',def:'core/string-lights@2',name:'string-lights',p:[0,7]},
 {op:'place',def:'core/campfire@2',name:'campfire',p:[2.4,4.4],r:Math.PI}]},
 ...[0,100,200].map(i=>({note:'distant',ops:distant.slice(i,i+100)}))]};
writeFileSync(out+'/genesis.json',JSON.stringify(genesis));
Object.assign(process.env,{HOST:'127.0.0.1',AUTH_PROVIDER:'none',INVITE_REQUIRED:'0',MIND_DRIVER:'edge',WORLD_OWNER_ID:'dev:admin',EDGE_SKILL_FILE:resolve('tools/world-launcher/soul/skill.md'),EDGE_INSTRUCTIONS_FILE:resolve('tools/world-launcher/soul/instructions.md'),EDGE_CONTROLLER_CLI_FILE:resolve('tools/world-launcher/soul/eden.mjs'),EDGE_CLI_FILE:resolve('tools/edge-skill/eden-agent.mjs'),MARS_WEB_DIR:resolve('mars/viewer/public'),WEB_DIR:resolve('apps/web/dist'),ANTHROPIC_API_KEY:'',OPENAI_API_KEY:'',ARCHIVE_TAKES:'0',TAKES_PERSIST:'0'});
const w=await startWorld({slug:'soul-fire',port:7864,data:out+'/data',genesis:out+'/genesis.json',log:out+'/server.log'});writeFileSync(out+'/world.json',JSON.stringify({base:w.base,pid:w.child.pid,dataDir:w.dataDir}));w.child.unref();console.log(JSON.stringify({base:w.base,pid:w.child.pid}));process.exit();
