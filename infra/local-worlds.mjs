// Owned isolated fake worlds behind a local routing proxy; all state lives in the requested proof folder.
import {spawn} from 'node:child_process';import {createServer,request} from 'node:http';import {connect} from 'node:net';import {mkdirSync,createWriteStream} from 'node:fs';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),dir=process.env.PROOF_DIR;if(!dir)throw Error('PROOF_DIR required');mkdirSync(dir,{recursive:true});
const keys=['toy','mars','littlemartians','eden'],ports=[4930,4932,4933,4934],children=[];
for(const [i,key] of keys.entries()){
 const log=createWriteStream(`${dir}/${key}.log`);const child=spawn(process.execPath,['apps/server/src/main.ts'],{cwd:root,env:{...process.env,PORT:String(ports[i]),DATA_DIR:`${dir}/${key}`,WORLD_KEY:key,WORLD_ID:key+'-1',ENGINE:key==='toy'?'toy':'mars',DEV_AUTH:'1',WORLD_OWNER_ID:'dev:admin',MAX_SOULS_PER_USER:'8',ENABLE_LIVING_WORLD:'1',ARCHIVE_TAKES:'0',PRIVY_APP_ID:'',PRIVY_APP_SECRET:'',TYPESAFE_API_KEY:'',ANTHROPIC_API_KEY:'',BRAIN_MODE:'fake',PUBLIC_URL:`http://127.0.0.1:4939/w/${key}`},stdio:['ignore','pipe','pipe']});child.stdout.pipe(log);child.stderr.pipe(log);children.push(child);
}
const portFor=url=>{const key=url?.match(/^\/w\/(toy|mars|littlemartians|eden)(?:[/?]|$)/)?.[1];return key&&!/^\/w\/mars\/202[0-7]/.test(url)?ports[keys.indexOf(key)]:4930;};
const proxy=createServer((req,res)=>{const up=request({hostname:'127.0.0.1',port:portFor(req.url),path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});up.on('error',()=>{res.writeHead(502).end('world starting');});req.pipe(up);});
proxy.on('upgrade',(req,socket,head)=>{const up=connect(portFor(req.url),'127.0.0.1',()=>{up.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${Object.entries(req.headers).map(([k,v])=>`${k}: ${v}`).join('\r\n')}\r\n\r\n`);if(head.length)up.write(head);socket.pipe(up).pipe(socket);});up.on('error',()=>socket.destroy());socket.on('error',()=>up.destroy());});
proxy.listen(4939,'127.0.0.1',()=>console.log('isolated fake worlds http://127.0.0.1:4939'));
let closing=false;const stop=()=>{if(closing)return;closing=true;proxy.close();for(const c of children)c.kill('SIGTERM');setTimeout(()=>process.exit(0),1500);};process.on('SIGTERM',stop);process.on('SIGINT',stop);
