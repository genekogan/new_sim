// Local multi-world routing, HTTP streaming/SSE and WebSocket passthrough. No
// credentials, tunnels, production services or DNS are managed by this module.
import {createServer,request} from 'node:http';
import {connect} from 'node:net';
import {readFileSync,realpathSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,relative,sep,extname} from 'node:path';
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
// Explicit release-artifact snapshot. Verified bytes are retained so later file
// replacement cannot change this proxy's artifact authority. No API interception.
export function prepareArtifactOverlay(options){
 if(options===undefined)return null;
 const {webDir,webManifest,webManifestSha256,cliFile,cliSha256,frontendSource,cliSource}=options;
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
 if(![webDir,webManifest,cliFile].every(v=>typeof v==='string'&&v.startsWith('/'))||!sha(webManifestSha256)||!sha(cliSha256)||![frontendSource,cliSource].every(v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v)))throw Error('artifact overlay requires exact paths, hashes and source pins');
 const root=realpathSync(webDir);
 const boundedRead=(path,max)=>{const st=lstatSync(path);if(!st.isFile()||st.size>max)throw Error('artifact must be bounded regular file');return readFileSync(path);};
 const raw=boundedRead(webManifest,2*1024*1024);if(hash(raw)!==webManifestSha256)throw Error('artifact manifest hash differs');
 const manifest=JSON.parse(raw);const files=manifest.files;
 if(!files||typeof files!=='object'||Array.isArray(files)||!Object.hasOwn(files,'index.html')||Object.keys(files).length>4096)throw Error('artifact manifest files invalid');
 let total=0;const entries=Object.entries(files);
 for(const [name,pin]of entries){if(!/^(?:index\.html|assets\/[A-Za-z0-9_./-]+)$/.test(name)||name.split('/').some(p=>p==='.'||p==='..'||!p)||!pin||!sha(pin.sha256)||!Number.isSafeInteger(pin.bytes)||pin.bytes<0||pin.bytes>32*1024*1024)throw Error('artifact manifest entry invalid');total+=pin.bytes;}
 if(total>128*1024*1024)throw Error('artifact snapshot budget exceeded');
 const bytes=new Map();
 for(const [name,pin]of entries){const path=resolve(root,name),actual=realpathSync(path),rel=relative(root,actual);if(rel==='..'||rel.startsWith('..'+sep)||resolve(root,rel)!==actual)throw Error('artifact path escapes root');const data=boundedRead(path,32*1024*1024);if(data.length!==pin.bytes||hash(data)!==pin.sha256)throw Error('artifact bytes differ: '+name);bytes.set(name,data);}
 const index=bytes.get('index.html').toString('utf8');
 for(const match of index.matchAll(/(?:src|href)=["']([^"']+)["']/g)){const url=match[1];if(!url.startsWith('/assets/')||!bytes.has(url.slice(1)))throw Error('artifact index dependency is not manifest-listed');}
 const cli=boundedRead(cliFile,32*1024*1024);if(hash(cli)!==cliSha256)throw Error('artifact CLI hash differs');
 const indexPaths=new Set(['/',...KEYS.flatMap(k=>[`/w/${k}`,`/w/${k}/`])]);
 const cliPaths=new Set(['/eden-agent.mjs',...KEYS.map(k=>`/w/${k}/eden-agent.mjs`)]);
 const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.woff':'font/woff','.woff2':'font/woff2','.wasm':'application/wasm','.ico':'image/x-icon'};
 const attribution=Object.freeze({frontendSource,cliSource,webManifestSha256,cliSha256});
 return Object.freeze({attribution,handle(req,res){
  if(req.method!=='GET'&&req.method!=='HEAD')return false;
  // Inspect raw spelling before URL normalization; traversal never gets an index.
  const rawPath=req.url.split('?')[0];
  if(!indexPaths.has(rawPath)&&!cliPaths.has(rawPath)&&!/^\/(?:w\/(?:eden|mars|littlemartians)\/)?assets(?:\/|$)/.test(rawPath))return false;
  let decoded;try{decoded=decodeURIComponent(rawPath);}catch{res.writeHead(400).end();return true;}
  if(decoded.includes('\\')||decoded.includes('\0')||decoded.split('/').some(p=>p==='.'||p==='..')){res.writeHead(400).end();return true;}
  const path=rawPath;let name,data,cache;
  if(indexPaths.has(path)){name='index.html';data=bytes.get(name);cache='no-cache';}
  else if(cliPaths.has(path)){name='eden-agent.mjs';data=cli;cache='public, max-age=60';}
  else{const asset=path.replace(/^\/w\/(?:eden|mars|littlemartians)(?=\/assets\/)/,'').slice(1);if(asset.startsWith('assets/')&&bytes.has(asset)){name=asset;data=bytes.get(asset);cache='public, max-age=31536000, immutable';}}
  if(!data)return false;
  res.writeHead(200,{'Content-Type':mime[extname(name)]||'application/octet-stream','Content-Length':data.length,'Cache-Control':cache,'X-Sim-Frontend-Source':frontendSource,'X-Sim-CLI-Source':cliSource,'X-Sim-Artifact-Manifest':webManifestSha256});res.end(req.method==='HEAD'?undefined:data);return true;
 }});
}
export function isWorldsPath(path='/'){const raw=path.split('?')[0];return raw==='/worlds'||raw.startsWith('/worlds/');}
// Shared protocol callbacks allow disposable port0 tests without weakening launch admission.
export function worldProxyHandlers({worlds,worldsUpstreamPort=null,identities=new Map(),overlay=null,isClosing=()=>false}){
 const destination=path=>{if(worldsUpstreamPort!==null&&isWorldsPath(path))return worldsUpstreamPort;const key=worldForPath(path);return key?worlds[key]:null;};
 return {http:(req,res)=>{
  if(isClosing()){res.writeHead(503).end('Local worlds are draining.');return;}
  if(!(worldsUpstreamPort!==null&&isWorldsPath(req.url))&&new URL(req.url,'http://local').pathname==='/__sim/worlds.json'){
   res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify({contract:'local-worlds/1',worlds:KEYS.map(key=>({key,worldKey:key,...identities.get(key),name:key==='littlemartians'?'Little Martians':key==='mars'?'Mars':'Eden',basePath:`/w/${key}`,configPath:`/w/${key}/v1/config`}))}));return;
  }
  if(!(worldsUpstreamPort!==null&&isWorldsPath(req.url))&&overlay?.handle(req,res))return;
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
// Preserve the reviewed HTTP-only fixture/consumer API.
export const worldProxyRequestHandler=options=>worldProxyHandlers(options).http;
export async function openWorldProxy({port=4966,worlds,exposure='local',expectedWorldIds,expectedBuild,artifactOverlay,worldsUpstreamPort=null}){
 if(worldsUpstreamPort!==null&&worldsUpstreamPort!==5340)throw Error('worlds upstream must be explicit local5340 or null');
 const publicPreview=exposure==='shared-preview';if(!['local','shared-preview'].includes(exposure))throw Error('explicit proxy exposure required');
 if(!Number.isInteger(port)||!(port>=4963&&port<=4969||publicPreview&&port===4970)||!worlds||KEYS.some(k=>!Number.isInteger(worlds[k])||!(worlds[k]>=4950&&worlds[k]<=4969||k==='eden'&&worlds[k]===4970)))throw Error('explicit local world ports and private proxy4963..4969 required');
 if(publicPreview&&(port!==4970||worlds.eden<4950||worlds.eden>4959||new Set(Object.values(worlds)).size!==3||typeof expectedBuild!=='string'||!expectedBuild||!expectedWorldIds||KEYS.some(k=>typeof expectedWorldIds[k]!=='string'||!expectedWorldIds[k])||new Set(Object.values(expectedWorldIds)).size!==3))throw Error('shared preview requires private distinct backends and exact world/build identities');
 const overlay=prepareArtifactOverlay(artifactOverlay);
 const identities=new Map();
 if(expectedWorldIds){for(const key of KEYS){const response=await fetch(`http://127.0.0.1:${worlds[key]}/w/${key}/v1/config`,{signal:AbortSignal.timeout(3000)});if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))throw Error('world bootstrap unavailable: '+key);const cfg=await response.json();if(cfg.worldKey!==key||cfg.worldPath!==`/w/${key}`||cfg.worldId!==expectedWorldIds[key]||expectedBuild&&cfg.build!==expectedBuild)throw Error('world bootstrap identity differs: '+key);identities.set(key,{worldId:cfg.worldId,build:cfg.build});}}
 const sockets=new Set();let closing=false;
 const handlers=worldProxyHandlers({worlds,worldsUpstreamPort,identities,overlay,isClosing:()=>closing});
 const server=createServer(handlers.http);
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 server.on('upgrade',handlers.upgrade);
 await new Promise((yes,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',yes);});
 return{server,artifactAttribution:overlay?.attribution??null,url:`http://127.0.0.1:${port}`,close:async()=>{closing=true;const done=new Promise(r=>server.close(r));for(const socket of sockets)socket.destroy();await done;}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const path=process.argv[2];if(!path)throw Error('usage: node tools/core/multiworld/proxy.mjs <descriptor.json>');const proxy=await openWorldProxy(JSON.parse(readFileSync(resolve(path),'utf8')));console.log(proxy.url);for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void proxy.close().then(()=>process.exit(0)));}
 catch(error){console.error('World proxy refused:',error.message);process.exitCode=1;}
}
