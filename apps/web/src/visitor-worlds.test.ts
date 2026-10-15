import test from 'node:test';import assert from 'node:assert/strict';import {visitorWorlds,discoverVisitorWorlds} from './visitor-worlds.ts';
const manifest=(worlds:unknown[])=>({contract:'local-worlds/1',worlds});
const row=(path:string,name='A world')=>({basePath:path,configPath:path+'/v1/config',name});
test('registry aggregation accepts exact same-site world routes only; never forwards credentials to a supplied URL',()=>{
 const parsed=visitorWorlds(manifest([row('/w/eden'),row('/worlds/w/garden'),row('https://evil.test/w/a'),row('//evil.test/w/a'),row('/w/a/../../v1/private'),row('/other/w/a'),{...row('/w/b'),configPath:'https://evil.test'}]));
 assert.deepEqual(parsed.map(w=>w.path),['/w/eden','/worlds/w/garden']);assert.deepEqual(visitorWorlds({contract:'wrong',worlds:[row('/w/eden')]}),[]);
});
test('discovers root and launcher worlds without losing selected preview or duplicating routes',async()=>{
 const calls:string[]=[];const get=(async(path:string)=>{calls.push(path);return Response.json(manifest(path==='/__sim/worlds.json'?[row('/w/eden'),row('/w/mars')]:[row('/worlds/w/garden')]));}) as typeof fetch;
 const d=await discoverVisitorWorlds({path:'/w/eden',name:'Selected Eden',worldId:'eden-1'},get);
 assert.deepEqual(d.worlds.map(w=>w.path),['/w/eden','/w/mars','/worlds/w/garden']);assert.equal(d.worlds[0]!.name,'Selected Eden');assert.equal(calls.length,2);
});
test('missing manifests preserve one selected world; large registries are bounded',async()=>{
 const d=await discoverVisitorWorlds({path:'/w/preview',name:'Preview'},(async()=>new Response('<html/>')) as typeof fetch);assert.equal(d.worlds.length,1);
 const worlds=visitorWorlds(manifest(Array.from({length:100},(_,i)=>row('/w/a'+i))));assert.equal(worlds.length,61);
});

test('return discovery never wakes stopped launcher worlds and labels the owner’s unavailable worlds',async()=>{
 const get=(async(path:string)=>Response.json(manifest(path==='/__sim/worlds.json'?[]:[{...row('/worlds/w/mine'),owner:'me',status:'stopped'},{...row('/worlds/w/other'),owner:'other',status:'asleep'},{...row('/worlds/w/awake'),owner:'other',status:'running'}]))) as typeof fetch;
 const d=await discoverVisitorWorlds({path:'/w/eden',name:'Eden'},get,'me');assert.deepEqual(d.worlds.map(w=>w.path),['/w/eden','/worlds/w/awake']);assert.deepEqual(d.paused,['A world']);
});
