import {test} from 'node:test';import assert from 'node:assert/strict';
import {discoverWorlds,readWorldBootstrap,WorldBootstrapError} from '../src/world-discovery.ts';
const config=(key:string)=>Response.json({worldKey:key,worldPath:'/w/'+key,worldId:key+'-actual'});
test('healthy Eden plus identical SPA fallback for missing Mars/LM does not advertise phantom worlds',async()=>{
 const worlds=await discoverWorlds(async path=>path==='/w/eden/v1/config'?config('eden'):new Response('<!doctype html>App',{headers:{'content-type':'text/html'}}));assert.deepEqual([...worlds],['eden']);
 await assert.rejects(()=>readWorldBootstrap(new Response('<!doctype html>App',{headers:{'content-type':'text/html'}}),'mars'),WorldBootstrapError);
 await assert.rejects(()=>readWorldBootstrap(config('eden'),'mars'),/does not match/);
});
test('actual shared dispatcher lists all three namespaces; old config probes remain exact',async()=>{
 const rows=['eden','mars','littlemartians'].map(key=>({key,worldKey:key,basePath:'/w/'+key,configPath:'/w/'+key+'/v1/config'}));let calls=0;
 assert.deepEqual([...(await discoverWorlds(async()=>{calls++;return Response.json({contract:'local-worlds/1',worlds:rows});}))],rows.map(r=>r.key));assert.equal(calls,1);
 assert.deepEqual([...(await discoverWorlds(async path=>path==='/__sim/worlds.json'?new Response('',{status:404}):config(path.split('/')[2])))],rows.map(r=>r.key));
});
