// Entry 31: an owned disposable world for door passage: the walled courtyard behind courtyard-door (the Gene-approved door
// revision's place and orientation), a bench and a seat inside, two lamps outside, a locked store yard, 100 distant doors.
import {startWorld} from '../god-skill/dev-world.mjs';import {writeFileSync,mkdirSync} from 'node:fs';import {resolve} from 'node:path';
const out=process.env.SOUL_DOOR_SCENE??'<team>/soul-actions/day-31/scene',z=3;mkdirSync(out,{recursive:true});
const yard=(name,x,w)=>({op:'place',def:'core/garden-wall@1',name,shape:{path:[[x-w,z],[x-4,z],[x-4,z+6],[x+4,z+6],[x+4,z],[x+w,z]]}});
const genesis={schema:'genesis/1',name:'Soul Actions · Door passage',constants:{extent:350,ground:'land'},batches:[{note:'Owned isolated door passage acceptance',ops:[
 yard('courtyard-walls',-6,.6),{op:'place',def:'core/zone@1',name:'courtyard',shape:{area:[[-9.6,3.2],[-2.4,3.2],[-2.4,8.6],[-9.6,8.6]]},about:{what:'The walled courtyard north of courtyard-door. The courtyard-bench and the courtyard-seat are inside.'}},
 {op:'place',def:'core/door@2',name:'courtyard-door',p:[-6,z],r:Math.PI},{op:'place',def:'core/bench@1',name:'courtyard-bench',p:[-4.6,7]},{op:'place',def:'core/bench@1',name:'courtyard-seat',p:[-7.8,7.4]},
 {op:'place',def:'core/floor-lamp@2',name:'east-lantern',p:[-3.4,-1.2]},{op:'place',def:'core/bench@1',name:'west-bench',p:[-8.9,-1.1]},
 yard('store-walls',6,.6),{op:'place',def:'core/door@2',name:'store-door',p:[6,z],r:Math.PI,state:{locked:true}},{op:'place',def:'core/bench@1',name:'store-bench',p:[6,7]},
 ...Array.from({length:100},(_,i)=>({op:'place',def:'core/door@2',name:`distant-door-${i}`,p:[100+i%10*2,100+Math.floor(i/10)*2]}))]}]};
writeFileSync(out+'/genesis.json',JSON.stringify(genesis));
Object.assign(process.env,{HOST:'127.0.0.1',AUTH_PROVIDER:'none',INVITE_REQUIRED:'0',MIND_DRIVER:'edge',WORLD_OWNER_ID:'dev:admin',EDGE_SKILL_FILE:resolve('tools/world-launcher/soul/skill.md'),EDGE_INSTRUCTIONS_FILE:resolve('tools/world-launcher/soul/instructions.md'),EDGE_CONTROLLER_CLI_FILE:resolve('tools/world-launcher/soul/eden.mjs'),EDGE_CLI_FILE:resolve('tools/edge-skill/eden-agent.mjs'),MARS_WEB_DIR:resolve('mars/viewer/public'),WEB_DIR:resolve('apps/web/dist'),ANTHROPIC_API_KEY:'',OPENAI_API_KEY:'',ARCHIVE_TAKES:'0',TAKES_PERSIST:'0'});
const w=await startWorld({slug:'soul-door-passage',port:7872,data:out+'/data',genesis:out+'/genesis.json',log:out+'/server.log'});writeFileSync(out+'/world.json',JSON.stringify({base:w.base,pid:w.child.pid,dataDir:w.dataDir}));w.child.unref();console.log(JSON.stringify({base:w.base,pid:w.child.pid}));process.exit();
