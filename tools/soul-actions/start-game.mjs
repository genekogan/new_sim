// Entry 27: an owned disposable world with a noughts-and-crosses board and 100 distant games in play.
import {startWorld} from '../god-skill/dev-world.mjs';import {writeFileSync,mkdirSync} from 'node:fs';import {resolve} from 'node:path';
const out=process.env.SOUL_GAME_SCENE??'<team>/soul-actions/day-27/scene';mkdirSync(out,{recursive:true});
const genesis={schema:'genesis/1',name:'Soul Actions · Noughts and crosses',constants:{extent:350,ground:'land'},batches:[{note:'Owned isolated game acceptance',ops:[
 {op:'place',def:'core/tictactoe-board@1',name:'game',p:[0,4],r:Math.PI},
 ...Array.from({length:100},(_,i)=>({op:'place',def:'core/tictactoe-board@1',name:`distant-game-${i}`,p:[120+i%10*2,120+Math.floor(i/10)*2],state:{text:'XO.X.O...',textBy:'s_zed,s_yan',players:'Zed,Yan'}}))]}]};
writeFileSync(out+'/genesis.json',JSON.stringify(genesis));
Object.assign(process.env,{HOST:'127.0.0.1',AUTH_PROVIDER:'none',INVITE_REQUIRED:'0',MIND_DRIVER:'edge',WORLD_OWNER_ID:'dev:admin',EDGE_SKILL_FILE:resolve('tools/world-launcher/soul/skill.md'),EDGE_INSTRUCTIONS_FILE:resolve('tools/world-launcher/soul/instructions.md'),EDGE_CONTROLLER_CLI_FILE:resolve('tools/world-launcher/soul/eden.mjs'),EDGE_CLI_FILE:resolve('tools/edge-skill/eden-agent.mjs'),MARS_WEB_DIR:resolve('mars/viewer/public'),WEB_DIR:resolve('apps/web/dist'),ANTHROPIC_API_KEY:'',OPENAI_API_KEY:'',ARCHIVE_TAKES:'0',TAKES_PERSIST:'0'});
const w=await startWorld({slug:'soul-game',port:7869,data:out+'/data',genesis:out+'/genesis.json',log:out+'/server.log'});writeFileSync(out+'/world.json',JSON.stringify({base:w.base,pid:w.child.pid,dataDir:w.dataDir}));w.child.unref();console.log(JSON.stringify({base:w.base,pid:w.child.pid}));process.exit();
