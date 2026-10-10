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
export function isWorldsPath(path='/'){const raw=path.split('?')[0];return raw==='/worlds'||raw.startsWith('/worlds/');}
// Shared protocol callbacks allow disposable port0 tests without weakening launch admission.
export function worldProxyHandlers({worlds,worldsUpstreamPort=null,identities=new Map(),isClosing=()=>false}){
 const destination=path=>{if(worldsUpstreamPort!==null&&isWorldsPath(path))return worldsUpstreamPort;const key=worldForPath(path);return key?worlds[key]:null;};
 return {http:(req,res)=>{
  if(isClosing()){res.writeHead(503).end('Local worlds are draining.');return;}
  if(!(worldsUpstreamPort!==null&&isWorldsPath(req.url))&&new URL(req.url,'http://local').pathname==='/__sim/worlds.json'){
   res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({contract:'local-worlds/1',worlds:KEYS.map(key=>({key,worldKey:key,...identities.get(key),name:key==='littlemartians'?'Little Martians':key==='mars'?'Mars':'Eden',basePath:`/w/${key}`,configPath:`/w/${key}/v1/config`}))}));return;
  }
  const port=destination(req.url);if(port===null){res.writeHead(404,{'Content-Type':'application/json'}).end(JSON.stringify({ok:false,code:'world.not-served'}));return;}
  const up=request({hostname:'127.0.0.1',port,path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});
  up.on('error',()=>{if(!res.headersSent)res.writeHead(502,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({ok:false,code:'world.unavailable',...(isWorldsPath(req.url)&&worldsUpstreamPort!==null?{service:'world-launcher'}:{worldKey:worldForPath(req.url)})}));else res.destroy();});
  req.on('aborted',()=>up.destroy());res.on('close',()=>up.destroy());req.pipe(up);
 },upgrade:(req,socket,head)=>{
  const port=destination(req.url);if(isClosing()||port===null){socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');return;}
  const up=connect(port,'127.0.0.1',()=>{
   up.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${Object.entries(req.headers).flatMap(([k,v])=>Array.isArray(v)?v.map(value=>`${k}: ${value}`):[`${k}: ${v}`]).join('\r\n')}\r\n\r\n`);
   if(head.length)up.write(head);socket.pipe(up).pipe(socket);
  });
  up.on('error',()=>socket.destroy());socket.on('error',()=>up.destroy());socket.on('close',()=>up.destroy());up.on('close',()=>socket.destroy());
 }};
}
export async function openWorldProxy({port=4966,worlds,exposure='local',expectedWorldIds,expectedBuild,worldsUpstreamPort=null}){
 if(worldsUpstreamPort!==null&&worldsUpstreamPort!==5340)throw Error('worlds upstream must be explicit local5340 or null');
 const publicPreview=exposure==='shared-preview';if(!['local','shared-preview'].includes(exposure))throw Error('explicit proxy exposure required');
 if(!Number.isInteger(port)||!(port>=4963&&port<=4969||publicPreview&&port===4970)||!worlds||KEYS.some(k=>!Number.isInteger(worlds[k])||!(worlds[k]>=4950&&worlds[k]<=4969||k==='eden'&&worlds[k]===4970)))throw Error('explicit local world ports and private proxy4963..4969 required');
 if(publicPreview&&(port!==4970||worlds.eden<4950||worlds.eden>4959||new Set(Object.values(worlds)).size!==3||typeof expectedBuild!=='string'||!expectedBuild||!expectedWorldIds||KEYS.some(k=>typeof expectedWorldIds[k]!=='string'||!expectedWorldIds[k])||new Set(Object.values(expectedWorldIds)).size!==3))throw Error('shared preview requires private distinct backends and exact world/build identities');
 const identities=new Map();
 if(expectedWorldIds){for(const key of KEYS){const response=await fetch(`http://127.0.0.1:${worlds[key]}/w/${key}/v1/config`,{signal:AbortSignal.timeout(3000)});if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))throw Error('world bootstrap unavailable: '+key);const cfg=await response.json();if(cfg.worldKey!==key||cfg.worldPath!==`/w/${key}`||cfg.worldId!==expectedWorldIds[key]||expectedBuild&&cfg.build!==expectedBuild)throw Error('world bootstrap identity differs: '+key);identities.set(key,{worldId:cfg.worldId,build:cfg.build});}}
 const sockets=new Set();let closing=false;
 const handlers=worldProxyHandlers({worlds,worldsUpstreamPort,identities,isClosing:()=>closing});
 const server=createServer(handlers.http);
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 server.on('upgrade',handlers.upgrade);
 await new Promise((yes,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',yes);});
 return{server,url:`http://127.0.0.1:${port}`,close:async()=>{closing=true;const done=new Promise(r=>server.close(r));for(const socket of sockets)socket.destroy();await done;}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const path=process.argv[2];if(!path)throw Error('usage: node tools/core/multiworld/proxy.mjs <descriptor.json>');const proxy=await openWorldProxy(JSON.parse(readFileSync(resolve(path),'utf8')));console.log(proxy.url);for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void proxy.close().then(()=>process.exit(0)));}
 catch(error){console.error('World proxy refused:',error.message);process.exitCode=1;}
}
