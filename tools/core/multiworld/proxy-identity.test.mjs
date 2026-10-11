import {test} from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';
import {openWorldProxy} from './proxy.mjs';
test('selected-world proxy refuses Eden-backed foreign namespace before listen and retains exact backend identities',async()=>{
 const keys=['eden','mars','littlemartians'],ports=[4963,4964,4965],servers=[];let proxy,wrong=true;
 try{
  for(const [i,key]of keys.entries()){const server=createServer((req,res)=>{res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({worldKey:wrong&&key==='mars'?'eden':key,worldId:wrong&&key==='mars'?'eden-actual':key+'-actual',worldPath:wrong&&key==='mars'?'/w/eden':'/w/'+key,build:'local-identity-proof',path:req.url}));});servers.push(server);await new Promise((yes,no)=>{server.once('error',no);server.listen(ports[i],'127.0.0.1',yes);});}
  const options={port:4966,worlds:Object.fromEntries(keys.map((key,i)=>[key,ports[i]])),expectedWorldIds:Object.fromEntries(keys.map(key=>[key,key+'-actual'])),expectedBuild:'local-identity-proof'};
  await assert.rejects(()=>openWorldProxy(options),/identity differs: mars/);wrong=false;proxy=await openWorldProxy(options);
  for(const key of keys){const cfg=await(await fetch(proxy.url+'/w/'+key+'/v1/config')).json();assert.equal(cfg.worldId,key+'-actual');assert.equal(cfg.worldKey,key);}
  const manifest=await(await fetch(proxy.url+'/__sim/worlds.json')).json();assert.deepEqual(manifest.worlds.map(w=>w.worldId),keys.map(key=>key+'-actual'));
  await assert.rejects(()=>openWorldProxy({...options,port:4970,exposure:'shared-preview',worlds:{...options.worlds,eden:4963}}),/private distinct/);
 }finally{if(proxy)await proxy.close();for(const server of servers){server.closeAllConnections();await new Promise(r=>server.close(r));}}
});
