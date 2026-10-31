import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import * as T from 'three';
const file=new URL(`../.history-2021-occupied-test-${process.pid}.mjs`,import.meta.url);
await build({stdin:{contents:`export * from './app/history/scenes';`,resolveDir:new URL('..',import.meta.url).pathname,loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',outfile:file.pathname,logLevel:'error'});
T.TextureLoader.prototype.load=function(){return new T.Texture();};
// oxlint-disable-next-line typescript/no-deprecated -- offline canvas stub for source geometry; no browser DOM
globalThis.document={createElement:()=>({width:1,height:1,getContext:()=>new Proxy({}, {get:(_t,key)=>key==='createRadialGradient'?()=>({addColorStop(){}}):()=>{}})})};
const {createHistoricalScene}=await import(file.href);
const original=JSON.parse(await fs.readFile(new URL('./fixtures/history-2021-original-ids.json',import.meta.url),'utf8'));
after(()=>fs.unlink(file));
const group=(r,id)=>r.children.find(o=>o.userData.assembly_id===id);
const mesh=(r,name)=>{let found;r.traverse(o=>{if(o instanceof T.Mesh&&o.name===name)found=o;});assert.ok(found,`Missing ${name}`);return found;};
const bounds=o=>new T.Box3().setFromObject(o);

test('2021 preserves every original owner ID across occupied fit corrections',()=>{
 const current=createHistoricalScene(2021),ids=new Set();
 current.traverse(o=>{if(o.userData.component_id)ids.add(`${o.userData.assembly_id}/${o.userData.component_id}`);});
 assert.equal(original.ids.length,1273);
 const missing=original.ids.filter(id=>!ids.has(id));
 assert.deepEqual(missing,[],'photographic corrections must preserve every original semantic owner ID');
 const lib=group(current,'library'),books=lib.children.filter(o=>o.name==='book');
 assert.equal(books.length,44);assert.equal(books.filter(o=>!o.visible&&o.userData.walkNoCollision&&o.userData.sourceQuarantine).length,10);
 current.updateMatrixWorld(true);
 const shelves=lib.children.filter(o=>o.name==='book shelf');
 books.forEach((book,index)=>{assert.ok(Math.abs(bounds(book).min.y-bounds(shelves[Math.floor(index/11)]).max.y)<.001);assert.ok(bounds(book).max.y<2.1075,'wall-mounted books clear upper deck');});
 const oldTable=lib.children.filter(o=>o.name==='table top'||o.name==='table leg');
 assert.equal(oldTable.length,5);assert.ok(oldTable.every(o=>!o.visible&&o.userData.walkNoCollision&&o.userData.sourceQuarantine));
 const floor=bounds(mesh(lib,'library low plywood platform'));
 for(const foot of lib.children.filter(o=>o.name.startsWith('library low floor support '))) {
  const b=bounds(foot);assert.ok(Math.abs(b.min.y+.16)<.001);assert.ok(Math.abs(b.max.y-floor.min.y)<.001);
 }
});

test('2021 occupied additions preserve a real bare-ground corridor and fitted year geometry',()=>{
 const root=createHistoricalScene(2021);root.updateMatrixWorld(true);
 const hall=group(root,'chiba'),lib=group(root,'library'),work=group(root,'2021-cowork-nook');assert.ok(work);
 for(const g of [hall,lib,work])g.traverse(o=>{
  if(!(o instanceof T.Mesh)||!o.userData.named_id?.startsWith('2021-'))return;
  const b=bounds(o);assert.ok(b.max.x<=-2.28||b.min.x>=2.28||b.min.y>4.29,`${o.name} intrudes into ground corridor`);
 });
 const banks=hall.children.filter(o=>o.children.some(c=>c.name==='solar panel'));assert.equal(banks.length,3);
 assert.equal(banks.flatMap(b=>b.children.filter(o=>o.name==='solar panel')).length,24);
 for(const b of banks)assert.equal(b.children.filter(o=>o.name.startsWith('solar triangle slope ')).length,2);
 assert.equal(root.children.filter(o=>/^rv-\d+$/.test(o.userData.assembly_id)).length,7);
});

test('2021 IBC, rack-mounted bathtub and furniture have direct geometry support',()=>{
 const root=createHistoricalScene(2021);root.updateMatrixWorld(true);
 const u=group(root,'outdoor-kitchen');
 const tub=bounds(mesh(u,'white bathtub')),deck=bounds(mesh(u,'bathtub support deck'));
 assert.ok(Math.abs(tub.min.y-deck.max.y)<.006,'tub must sit on the observed utility rack');
 const centre=mesh(u,'white bathtub').localToWorld(new T.Vector3(0,1,0));
 assert.equal(new T.Raycaster(centre,new T.Vector3(0,-1,0),0,1.0).intersectObject(mesh(u,'white bathtub')).length,0,'tub centre is genuinely open, not a white cube');
 assert.ok(mesh(u,'bathtub inner floor'));
 const tank=bounds(mesh(u,'IBC white reservoir')),pallet=bounds(mesh(u,'IBC pallet'));
 assert.ok(Math.abs(tank.min.y-pallet.max.y)<.012);
 const work=group(root,'2021-cowork-nook');
 for(const side of [-1,1]) {
  const base=bounds(mesh(work,`cowork couch base ${side}`));
  const feet=[];work.traverse(o=>{if(o.name.startsWith(`cowork couch foot ${side} `))feet.push(bounds(o));});
  assert.equal(feet.length,4);
  for(const foot of feet){assert.ok(Math.abs(foot.min.y+.16)<.001);assert.ok(Math.abs(foot.max.y-base.min.y)<.001);}
 }
});

test('2021 native painted faces and new IDs fit a bounded mesh/texture budget',async()=>{
 const root=createHistoricalScene(2021);root.updateMatrixWorld(true);
 const ids=[],added=[];root.traverse(o=>{if(o.userData.component_id)ids.push(o.userData.component_id);if(o instanceof T.Mesh&&o.userData.named_id?.startsWith('2021-'))added.push(o);});
 assert.equal(ids.length,new Set(ids).size,'actual combined meshes have unique IDs');
 assert.ok(added.length>100&&added.length<=260,`${added.length} additions exceed bounded detail budget`);
 let triangles=0;for(const o of added)triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;
 assert.ok(triangles<4000,`${triangles} new triangles exceed budget`);
 const container=group(root,'container');
 for(const name of ['Mars flower front mural','native honeycomb paint'])assert.ok(mesh(container,name).material.map);
 const shell=bounds(mesh(container,'shipping container')),paint=bounds(mesh(container,'native honeycomb paint'));
 assert.ok(paint.max.x>shell.max.x+.005,'paint must clear its physical side face');
 let bytes=0;for(const name of ['2021-container-flower.webp','2021-container-honeycomb.webp'])bytes+=(await fs.stat(new URL(`../public/history/2021/${name}`,import.meta.url))).size;
 assert.ok(bytes<=26000,`${bytes} native paint bytes exceed budget`);
});
