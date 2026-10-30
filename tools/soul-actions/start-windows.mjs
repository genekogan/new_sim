import {startWorld} from '../god-skill/dev-world.mjs';import {mkdirSync,writeFileSync} from 'node:fs';import {resolve} from 'node:path';
const out=process.env.SOUL_WINDOW_SCENE??'<team>/soul-actions/day-05/scene';mkdirSync(out,{recursive:true});const ops=[{op:'world',state:{time:{set:{hour:14,n:1},paused:true}}}];
for(const [name,x,variant]of [['square-window',-3,'square'],['arched-window',3,'arched']]){
 ops.push({op:'place',def:'core/window@2',name,p:[x,.55,3],r:Math.PI,params:{variant}});
 const wall=(suffix,path,height,p)=>({op:'place',def:'core/garden-wall@1',name:name+'-'+suffix,shape:{path},params:{height,thickness:.16,material:'plaster',color:'#d9cab4',cap:false},...(p?{p}:{})});
 ops.push(wall('left',[[x-1.8,3],[x-.62,3]],2.2),wall('right',[[x+.62,3],[x+1.8,3]],2.2),wall('below',[[x-.62,3],[x+.62,3]],.55));
}
ops.push({op:'place',def:'core/bench@1',name:'bench',p:[0,-3]});writeFileSync(out+'/genesis.json',JSON.stringify({schema:'genesis/1',name:'Casement windows',constants:{extent:350,ground:'land'},batches:[{note:'Owned mounted-window visual acceptance',ops}]}));
Object.assign(process.env,{HOST:'127.0.0.1',AUTH_PROVIDER:'none',INVITE_REQUIRED:'0',MIND_DRIVER:'edge',WORLD_OWNER_ID:'dev:admin',EDGE_SKILL_FILE:resolve('tools/world-launcher/soul/skill.md'),EDGE_INSTRUCTIONS_FILE:resolve('tools/world-launcher/soul/instructions.md'),EDGE_CONTROLLER_CLI_FILE:resolve('tools/world-launcher/soul/eden.mjs'),EDGE_CLI_FILE:resolve('tools/edge-skill/eden-agent.mjs'),MARS_WEB_DIR:resolve('mars/viewer/public'),WEB_DIR:resolve('apps/web/dist'),ANTHROPIC_API_KEY:'',OPENAI_API_KEY:'',ARCHIVE_TAKES:'0',TAKES_PERSIST:'1'});
const w=await startWorld({slug:'soul-windows',port:7859,data:out+'/data',genesis:out+'/genesis.json',log:out+'/server.log'});writeFileSync(out+'/world.json',JSON.stringify({base:w.base,pid:w.child.pid,dataDir:w.dataDir}));w.child.unref();console.log(JSON.stringify({base:w.base,pid:w.child.pid}));process.exit();
