import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import * as T from 'three';
const file=new URL(`../.history-2024-occupied-${process.pid}.mjs`,import.meta.url);
await build({stdin:{contents:`export {createHistoricalScene} from './app/history/scenes';export {BAY} from './app/history/kit';`,resolveDir:new URL('..',import.meta.url).pathname,loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',outfile:file.pathname,logLevel:'error'});
T.TextureLoader.prototype.load=()=>new T.Texture();
Reflect.set(globalThis,'document',{createElement:()=>({width:1,height:1,getContext:()=>new Proxy({},{get:()=>()=>{}})})});
const {createHistoricalScene,BAY}=await import(file.href);after(()=>fs.unlink(file));
const root=createHistoricalScene(2024);root.updateMatrixWorld(true);
const original=JSON.parse(await fs.readFile(new URL('./fixtures/history-2024-original-owners-20261001.json',import.meta.url),'utf8'));
const meshes=[];root.traverse(o=>{if(o instanceof T.Mesh)meshes.push(o);});
const assembly=id=>{let found;root.traverse(o=>{if(o.userData.assembly_id===id&&o instanceof T.Group)found=o;});return found;};
const kinds=name=>meshes.filter(m=>m.userData.kind===name);

test('2024 completed Freeside has real clear doors and apertures through both window skins',()=>{
 for(const [id,xs] of [['freeside-west-wing',[-1.62,1.0]],['freeside-wing',[.63]]]){
  const wing=assembly(id),wall=wing.children.find(o=>o.userData.kind==='plywood wall'&&Math.abs(o.position.z-BAY)<.02);
  const booth=wing.children.find(o=>o.userData.kind==='front utility booth');assert.equal(booth.visible,false);assert.equal(booth.userData.walkNoCollision,true);assert.equal(booth.userData.historicalQuarantine,true);assert.ok(booth.userData.component_id);
  for(const x of xs)for(const y of [.50,1.20,1.85]){
   const from=wing.localToWorld(new T.Vector3(x,y,BAY+.35)),dir=new T.Vector3(0,0,-1);
   assert.equal(new T.Raycaster(from,dir,0,.80).intersectObject(wall,false).length,0,'door cuts original wall');
   const hits=new T.Raycaster(from,dir,0,.80).intersectObjects(meshes,false).filter(h=>h.object.visible&&!h.object.userData.walkNoCollision);assert.equal(hits.length,0,'door route not blocked by added finish/furniture or aggregate booth');
  }
 }
 const east=assembly('freeside-wing'),wall=east.children.find(o=>o.userData.kind==='plywood wall'&&Math.abs(o.position.z-BAY)<.02),skin=kinds('2024 Freeside occupied white east wall')[0];
 for(const x of [1.79,2.79]){
  const from=east.localToWorld(new T.Vector3(x,1.72,BAY+.30));
  const ray=new T.Raycaster(from,new T.Vector3(0,0,-1),0,.60);assert.equal(ray.intersectObjects([wall,skin],false).length,0,'high window cuts both original wall and white infill');
 }
 const west=assembly('freeside-west-wing'),westWall=west.children.find(o=>o.userData.kind==='plywood wall'&&Math.abs(o.position.z-BAY)<.02),red=kinds('2024 Freeside native occupied west mural').find(o=>o.position.x>2);const from=west.localToWorld(new T.Vector3(1.805,1.45,BAY+.30));assert.equal(new T.Raycaster(from,new T.Vector3(0,0,-1),0,.6).intersectObjects([westWall,red],false).length,0,'native narrow west window cuts original wall and photographed mural');
 assert.equal(kinds('2024 Freeside native occupied west mural').length,2);
 for(const m of kinds('2024 Freeside occupied east window'))assert.ok(m.material.transparent&&!m.userData.walkNoCollision,'glazed aperture is transparent but physical');
});

test('2024 retains source-supported solar/west open-roof topology and distinct tents',()=>{
 const core=assembly('kitchen'),solar=core.children.filter(o=>o.userData.kind==='solar panel');assert.equal(solar.length,24);
 let lowest=Infinity;for(const m of solar){const b=new T.Box3().setFromObject(m);lowest=Math.min(lowest,b.min.y);}assert.ok(lowest>-.13&&lowest<.12,'bottom PV course bears near ground');
 const west=assembly('west-terrace');for(const [z,y] of [[-BAY,3.6],[0,4.3],[BAY,5.3]]){const from=west.localToWorld(new T.Vector3(0,y,z));assert.equal(new T.Raycaster(from,new T.Vector3(0,1,0),0,1.5).intersectObjects(meshes,false).filter(h=>h.object.visible).length,0,'west stepped access remains open above decks');}
 const westTent=assembly('freeside-west-wing').children.filter(o=>o.userData.kind==='peaked canvas shelter roof');assert.equal(westTent.length,3);assert.ok(westTent.every(o=>o.geometry.type==='SphereGeometry'));
 const eastTent=assembly('freeside-wing').children.filter(o=>o.userData.kind==='peaked canvas shelter roof');assert.equal(eastTent.length,3);assert.ok(eastTent.every(o=>o.geometry.parameters.radiusTop===.72));
 assert.equal(kinds('2024 courtyard IBC container').length,7);assert.equal(kinds('2024 courtyard pink lounge upright').length,4);
 for(const m of kinds('rack upright')){const c=m.material.color;assert.ok(c.b>c.g&&c.g>c.r,'native blue-grey steel replaces generic Kit green');}
 for(const m of kinds('display content'))assert.ok(!m.visible&&m.userData.historicalQuarantine&&m.userData.walkNoCollision,'unsupported default2020 still stays quarantined with ID');
 assert.ok(!meshes.some(o=>/rainbow.*paint/i.test(o.userData.kind)),'March gallery projected rainbow is not copied as paint');
});

test('2024 occupied interiors retain real door clearance and expose source grate/textile',()=>{
 const door=meshes.find(m=>m.userData.door?.opening),opening=door.userData.door.opening,z=(opening.z[0]+opening.z[1])/2;
 for(const y of [.50,1.20,1.90]){
  const ray=new T.Raycaster(new T.Vector3(opening.x-.70,y,z),new T.Vector3(1,0,0),0,1.4);
  assert.equal(ray.intersectObjects(meshes,false).filter(h=>h.object.visible&&!h.object.userData.walkNoCollision).length,0,'added solarium furnishings leave original physical east doorway clear');
 }
 const kitchen=assembly('chiba-kitchen'),p=kitchen.localToWorld(new T.Vector3(1.30,1.4,.4)),hits=new T.Raycaster(p,new T.Vector3(0,-1,0),0,1.4).intersectObjects(meshes,false).filter(h=>h.object.visible);
 assert.match(hits[0].object.userData.kind,/(?:metal grate|steel grate)/,'source grating is visible above the whole-hall plywood deck');
 assert.equal(kinds('2024 dojo native photographed pink textile').length,1);assert.equal(kinds('2024 Chiba native March east mural').length,1);
});

test('2024 retains all original component IDs, assembly owners and kinds',()=>{
 const now=new Map();root.traverse(o=>{if(o.userData.component_id){assert.ok(!now.has(o.userData.component_id));now.set(o.userData.component_id,[o.userData.assembly_id,o.userData.kind]);}});
 for(const [id,...owner] of original){assert.ok(now.has(id),`old ID lost:${id}`);assert.deepEqual(now.get(id),owner,`old owner changed:${id}`);}
 console.log(`original2024 IDs retained:${original.length}/${original.length}; current:${now.size}`);
});
