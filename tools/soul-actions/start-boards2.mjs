// Entry 25: an owned disposable world with a chalkboard menu, a sign-up sheet and a poll, and 300 distant filled boards.
import {startWorld} from '../god-skill/dev-world.mjs';import {writeFileSync,mkdirSync} from 'node:fs';import {resolve} from 'node:path';
const out=process.env.SOUL_BOARDS_SCENE??'<team>/soul-actions/day-25/scene';mkdirSync(out,{recursive:true});
const genesis={schema:'genesis/1',name:'Soul Actions · Public boards',constants:{extent:350,ground:'land'},batches:[{note:'Owned isolated public-boards acceptance',ops:[
 {op:'place',def:'core/chalkboard@2',name:'menu',p:[-2.6,4],r:Math.PI},
 {op:'place',def:'core/signup-sheet@1',name:'sheet',p:[0,4],r:Math.PI,state:{title:'Volleyball at five'}},
 {op:'place',def:'core/poll-board@1',name:'poll',p:[2.6,4],r:Math.PI,state:{title:'Lunch tomorrow?',options:'Soup|Salad|Sandwich'}},
 ...Array.from({length:100},(_,i)=>({op:'place',def:['core/chalkboard@2','core/signup-sheet@1','core/poll-board@1'][i%3],name:`distant-board-${i}`,p:[120+i%10*3,120+Math.floor(i/10)*3],state:i%3===0?{text:'distant menu',textBy:'s_z'}:i%3===1?{title:'distant club',text:'Zed',textBy:'s_z'}:{title:'distant?',options:'Red|Blue',text:'Red — 1 vote\nBlue — 0 votes',textBy:'s_z:0'}}))]}]};
writeFileSync(out+'/genesis.json',JSON.stringify(genesis));
Object.assign(process.env,{HOST:'127.0.0.1',AUTH_PROVIDER:'none',INVITE_REQUIRED:'0',MIND_DRIVER:'edge',WORLD_OWNER_ID:'dev:admin',EDGE_SKILL_FILE:resolve('tools/world-launcher/soul/skill.md'),EDGE_INSTRUCTIONS_FILE:resolve('tools/world-launcher/soul/instructions.md'),EDGE_CONTROLLER_CLI_FILE:resolve('tools/world-launcher/soul/eden.mjs'),EDGE_CLI_FILE:resolve('tools/edge-skill/eden-agent.mjs'),MARS_WEB_DIR:resolve('mars/viewer/public'),WEB_DIR:resolve('apps/web/dist'),ANTHROPIC_API_KEY:'',OPENAI_API_KEY:'',ARCHIVE_TAKES:'0',TAKES_PERSIST:'0'});
const w=await startWorld({slug:'soul-boards',port:7867,data:out+'/data',genesis:out+'/genesis.json',log:out+'/server.log'});writeFileSync(out+'/world.json',JSON.stringify({base:w.base,pid:w.child.pid,dataDir:w.dataDir}));w.child.unref();console.log(JSON.stringify({base:w.base,pid:w.child.pid}));process.exit();
