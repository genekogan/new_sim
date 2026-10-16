import test from 'node:test';import assert from 'node:assert/strict';import {eyesViewerProblem,eyesViewerUrl} from './edge/eyes/routes.ts';
import {Hono} from 'hono';import {fixture,invite,accept} from '../test/native-owner-fixture.ts';import {EdgeLedger} from './edge/ledger/ledger.ts';import {mountEdgeEyes} from './edge/eyes/routes.ts';import {edgeSoulResolver} from './edge/routes.ts';
test('world opt-in selects each child including launcher prefix, while unset and off never enable Eyes',()=>{
 for(const path of ['/w/eyes-fixture','/worlds/w/eyes-fixture'])for(const publicUrl of ['https://sim.example.test','https://sim.example.test'+path]){
  const cfg={worldPath:path,publicUrl};const viewer=eyesViewerUrl('world',cfg)!;assert.equal(viewer,'https://sim.example.test'+path+'/');assert.equal(eyesViewerProblem(viewer,cfg),null);
  assert.equal(eyesViewerUrl(undefined,cfg),undefined);assert.equal(eyesViewerUrl('off',cfg),undefined);
 }
});
test('published picture budgets cannot be relaxed by operator configuration',async t=>{
 const f=fixture(':memory:');f.brain.quiesce();const old={eyes:process.env.EDGE_EYES,soul:process.env.EDGE_EYES_SOUL_SECONDS,world:process.env.EDGE_EYES_GLOBAL_PER_MINUTE};
 delete process.env.EDGE_EYES;process.env.EDGE_EYES_SOUL_SECONDS='0';process.env.EDGE_EYES_GLOBAL_PER_MINUTE='900';
 const app=new Hono(),mounted=mountEdgeEyes(app,{host:f.host,db:f.db,souls:f.souls,ledger:new EdgeLedger(f.host,f.db),soul:()=>{throw new Error('public status needs no Soul');}});
 t.after(()=>{mounted.close();f.host.stop();f.db.close();for(const [key,value] of [['EDGE_EYES',old.eyes],['EDGE_EYES_SOUL_SECONDS',old.soul],['EDGE_EYES_GLOBAL_PER_MINUTE',old.world]]){if(value===undefined)delete process.env[key!];else process.env[key!]=value;}});
 const body=await (await app.request('/v1/edge/view/status')).json();assert.equal(body.eyes.state,'off');assert.equal(body.limits.soulSeconds,30);assert.equal(body.limits.globalPerMinute,12);
});
test('Eyes worker URL is bound to the selected world and canonical public origin',()=>{
 for(const key of ['eden','mars','littlemartians']){const cfg={worldPath:'/w/'+key,publicUrl:'http://127.0.0.1:4953/w/'+key};assert.equal(eyesViewerProblem(cfg.publicUrl+'?eyes=1',cfg),null);assert.equal(eyesViewerProblem(cfg.publicUrl+'/?eyes=1',cfg),null);const other=key==='eden'?'mars':'eden';assert.match(eyesViewerProblem('http://127.0.0.1:4953/w/'+other+'?eyes=1',cfg)!,/selected world/);assert.match(eyesViewerProblem('http://127.0.0.1:4954/w/'+key,cfg)!,/selected world/);}
 for(const url of ['javascript:bad','http://secret@127.0.0.1:4953/w/eden','http://127.0.0.1:4953/w/eden#private','bad'])assert.ok(eyesViewerProblem(url,{worldPath:'/w/eden',publicUrl:'http://127.0.0.1:4953/w/eden'}));
});
test('an inherited wrong-world viewer is never launched and authenticated view fails closed with the correct Soul caption',async t=>{
 const f=fixture(':memory:');f.brain.quiesce();const before=process.env.EDGE_EYES;process.env.EDGE_EYES='http://127.0.0.1:4953/w/mars?eyes=1';let mounted:ReturnType<typeof mountEdgeEyes>|undefined;t.after(()=>{mounted?.close();if(before===undefined)delete process.env.EDGE_EYES;else process.env.EDGE_EYES=before;f.host.stop();f.db.close();});f.souls.cfg.publicUrl='http://127.0.0.1:4953/w/eden';
 await invite(f,'viewer');const row=await accept(f.host,f.souls.create('dev:viewer',{name:'Selected Eden',description:'scripted world guard fixture'})),pair=f.souls.pairCode(row,f.souls.cfg.publicUrl),token=f.souls.pairExchange(pair.code,'scripted').token,app=new Hono(),L=new EdgeLedger(f.host,f.db);
 mounted=mountEdgeEyes(app,{host:f.host,db:f.db,souls:f.souls,ledger:L,soul:edgeSoulResolver(f.host,f.souls,c=>c.req.header('authorization')?.replace(/^Bearer /,''))});assert.equal(mounted.renderer.status().state,'off');assert.match(mounted.renderer.status().detail!,/selected world/);
 const response=await app.request('/v1/edge/view',{headers:{authorization:'Bearer '+token}});assert.equal(response.status,503);const body=await response.json();assert.equal(body.error.code,'eyes.unavailable');assert.match(body.alt,/Selected Eden sees/);assert.equal(body.url,null);assert.equal(mounted.renderer.status().renders,0);
});
