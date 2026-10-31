import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { build } from 'esbuild';
import * as T from 'three';
const file = new URL(`../.draft-2027-${process.pid}.mjs`, import.meta.url);
await build({stdin:{contents:"export * from './app/history/scenes'; export * from './app/history/year-2027';",resolveDir:new URL('..',import.meta.url).pathname,loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',outfile:file.pathname,logLevel:'error'});
T.TextureLoader.prototype.load = () => new T.Texture();
// oxlint-disable-next-line typescript/no-deprecated -- offline canvas annotation construction
globalThis.document = {createElement:()=>({width:1,height:1,getContext:()=>({fillRect(){},fillText(){}})})};
const { createHistoricalScene, DRAFT_2027, YEARS } = await import(file.href);
after(()=>fs.unlink(file));
const collect = root => {const objects=[];root.traverse(o=>{if(o.userData.component_id) objects.push(o);});return objects;};
test('2027 draft: unique stable editable IDs, blue uprights/orange beams and no opaque rooms',()=>{
  const a=collect(createHistoricalScene(2027)),b=collect(createHistoricalScene(2027));
  assert.ok(YEARS.includes(2027)); assert.ok(a.length>700 && a.length<4000);
  assert.deepEqual(a.map(o=>o.userData.component_id),b.map(o=>o.userData.component_id));
  assert.equal(new Set(a.map(o=>o.userData.component_id)).size,a.length);
  assert.equal(a.filter(o=>o.userData.kind==='plywood wall').length,0);
  assert.equal(a.filter(o=>o.userData.kind==='context_person').length,0);
  assert.equal(a.filter(o=>o.userData.kind==='conceptual chamber cutaway').length,40);
  for(const o of a){ assert.ok(o.userData.source.includes('Proposed 2027') || o.userData.assembly_id.startsWith('mit-trailer')); if(o instanceof T.Mesh){ const box=new T.Box3().setFromObject(o); assert.ok([...box.min.toArray(),...box.max.toArray()].every(Number.isFinite)); if(o.userData.layer==='Rack steel') assert.equal(o.material.color.getHexString(),o.userData.kind==='12 foot orange beam'?'c35b2d':'237ba5'); }}
});
test('2027 draft: diagram topology and explicit unresolved kitchen assignment',()=>{
  const root=createHistoricalScene(2027),groups=root.children;
  assert.equal(DRAFT_2027.kitchens.length,6);
  const find=id=>groups.find(o=>o.userData.assembly_id===id);
  assert.ok(find('mit-gallery').position.x<find('mit-cowork').position.x);
  assert.ok(find('mit-cowork').position.x<find('mit-kitchen').position.x);
  assert.ok(find('music-auditorium').position.x<0 && find('music-auditorium').position.z>0);
  for(const id of ['nw','se']){const g=find(`drainage-${id}`);assert.equal(g.rotation.y,Math.PI/4);const strip=g.children.find(o=>o.name==='proposed trench footprint');assert.equal(strip.geometry.parameters.depth,30.48);}
  assert.equal(groups.filter(g=>g.userData.assembly_id.startsWith('mit-trailer-')).length,11);
});
test('2027 routes: explicit draft accepted while both default entries stay2026',async()=>{
  const source=await fs.readFile(new URL('../app/main.tsx',import.meta.url),'utf8');
  const worker=await fs.readFile(new URL('./configure.mjs',import.meta.url),'utf8');
  assert.ok(source.includes('202[0-7]')); assert.ok(worker.includes('202[0-7]'));
  assert.ok(source.includes(': 2026;'));
  assert.ok(source.includes("year={route === '/studio' ? 2026 : Number(route.split('/')[2])}"));
});
