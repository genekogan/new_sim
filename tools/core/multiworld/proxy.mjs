// Local multi-world routing, HTTP streaming/SSE and WebSocket passthrough. No
// credentials, tunnels, production services or DNS are managed by this module.
import {createServer,request} from 'node:http';
import {connect} from 'node:net';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const KEYS=['eden','mars','littlemartians'];
export function worldForPath(path='/'){
 const url=new URL(path,'http://local');
 if(/^\/w\/mars\/202[0-7](?:\/|$)/.test(url.pathname))return 'eden';
 const assetWorld=url.pathname.match(/^\/world-assets\/([^/]+)(?:\/|$)/)?.[1];
 if(assetWorld)return KEYS.includes(assetWorld)?assetWorld:null;
 const world=url.pathname.match(/^\/w\/([^/]+)(?:\/|$)/)?.[1];
 if(world)return KEYS.includes(world)?world:null;
 if(/^\/(?:browser|modular|engine)(?:\/|$)/.test(url.pathname))return 'mars';
 return 'eden';
}
export async function openWorldProxy({port=4966,worlds}){
 if(!Number.isInteger(port)||port<4963||port>4969||!worlds||KEYS.some(k=>!Number.isInteger(worlds[k])||!(worlds[k]>=4950&&worlds[k]<=4969||k==='eden'&&worlds[k]===4970)))throw Error('explicit local world ports and private proxy4963..4969 required');
 const sockets=new Set();let closing=false;
 const server=createServer((req,res)=>{
  if(closing){res.writeHead(503).end('Local worlds are draining.');return;}
  if(new URL(req.url,'http://local').pathname==='/__sim/worlds.json'){
   res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({contract:'local-worlds/1',worlds:KEYS.map(key=>({key,worldKey:key,name:key==='littlemartians'?'Little Martians':key==='mars'?'Mars':'Eden',basePath:`/w/${key}`,configPath:`/w/${key}/v1/config`}))}));return;
  }
  const key=worldForPath(req.url);if(!key){res.writeHead(404,{'Content-Type':'application/json'}).end(JSON.stringify({ok:false,code:'world.not-served'}));return;}
  const up=request({hostname:'127.0.0.1',port:worlds[key],path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});
  up.on('error',()=>{if(!res.headersSent)res.writeHead(502,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({ok:false,code:'world.unavailable',worldKey:key}));else res.destroy();});
  req.on('aborted',()=>up.destroy());res.on('close',()=>up.destroy());req.pipe(up);
 });
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 server.on('upgrade',(req,socket,head)=>{
  const key=worldForPath(req.url);if(closing||!key){socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');return;}
  const up=connect(worlds[key],'127.0.0.1',()=>{
   up.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${Object.entries(req.headers).flatMap(([k,v])=>Array.isArray(v)?v.map(value=>`${k}: ${value}`):[`${k}: ${v}`]).join('\r\n')}\r\n\r\n`);
   if(head.length)up.write(head);socket.pipe(up).pipe(socket);
  });
  up.on('error',()=>socket.destroy());socket.on('error',()=>up.destroy());socket.on('close',()=>up.destroy());up.on('close',()=>socket.destroy());
 });
 await new Promise((yes,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',yes);});
 return{server,url:`http://127.0.0.1:${port}`,close:async()=>{closing=true;const done=new Promise(r=>server.close(r));for(const socket of sockets)socket.destroy();await done;}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const path=process.argv[2];if(!path)throw Error('usage: node tools/core/multiworld/proxy.mjs <descriptor.json>');const proxy=await openWorldProxy(JSON.parse(readFileSync(resolve(path),'utf8')));console.log(proxy.url);for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void proxy.close().then(()=>process.exit(0)));}
 catch(error){console.error('World proxy refused:',error.message);process.exitCode=1;}
}
