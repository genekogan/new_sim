// Entry 13: an owned disposable world with two writable boards, a frozen v1 menu board and 100 distant written boards.
import {startWorld} from '../god-skill/dev-world.mjs';import {writeFileSync,mkdirSync} from 'node:fs';import {resolve} from 'node:path';
const out=process.env.SOUL_BOARDS_SCENE??'<team>/soul-actions/day-13/scene';mkdirSync(out,{recursive:true});
const genesis={schema:'genesis/1',name:'Soul Actions · Boards',constants:{extent:350,ground:'land'},batches:[{note:'Owned isolated board acceptance',ops:[
 {op:'place',def:'core/whiteboard@1',name:'whiteboard',p:[0,4],r:Math.PI},
 {op:'place',def:'core/notice-board@2',name:'notice-board',p:[3.6,4],r:Math.PI},
 {op:'place',def:'core/chalkboard@1',name:'menu-chalkboard',p:[-3.2,4],r:Math.PI},
 ...Array.from({length:100},(_,i)=>({op:'place',def:'core/whiteboard@1',name:`distant-board-${i}`,p:[120+i%10*3,120+Math.floor(i/10)*3],state:{text:`distant note ${i}`}}))]}]};
writeFileSync(out+'/genesis.json',JSON.stringify(genesis));
Object.assign(process.env,{HOST:'127.0.0.1',AUTH_PROVIDER:'none',INVITE_REQUIRED:'0',MIND_DRIVER:'edge',WORLD_OWNER_ID:'dev:admin',EDGE_SKILL_FILE:resolve('tools/world-launcher/soul/skill.md'),EDGE_INSTRUCTIONS_FILE:resolve('tools/world-launcher/soul/instructions.md'),EDGE_CONTROLLER_CLI_FILE:resolve('tools/world-launcher/soul/eden.mjs'),EDGE_CLI_FILE:resolve('tools/edge-skill/eden-agent.mjs'),MARS_WEB_DIR:resolve('mars/viewer/public'),WEB_DIR:resolve('apps/web/dist'),ANTHROPIC_API_KEY:'',OPENAI_API_KEY:'',ARCHIVE_TAKES:'0',TAKES_PERSIST:'0'});
const w=await startWorld({slug:'soul-boards',port:7856,data:out+'/data',genesis:out+'/genesis.json',log:out+'/server.log'});writeFileSync(out+'/world.json',JSON.stringify({base:w.base,pid:w.child.pid,dataDir:w.dataDir}));w.child.unref();console.log(JSON.stringify({base:w.base,pid:w.child.pid}));process.exit();
