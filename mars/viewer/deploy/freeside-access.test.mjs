import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import * as T from 'three';
const file=new URL(`../.freeside-access-test-${process.pid}.mjs`,import.meta.url);
await build({stdin:{contents:`export * from './app/history/scenes';export {SEAT_HELD_YEARS,BAY} from './app/history/kit';export {YEAR_NORTH_AZIMUTH_OFFSET} from './engine/env/sun';export {DECK1_TOP_2022,ROOF_TOP_2022} from './app/history/photographic-corrections';`,resolveDir:new URL('..',import.meta.url).pathname,loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',outfile:file.pathname,logLevel:'error'});
T.TextureLoader.prototype.load=function(url){const texture=new T.Texture();texture.userData.sourceUrl=url;return texture;};
// oxlint-disable-next-line typescript/no-deprecated -- offline scene construction; no renderer
 globalThis.document={createElement:()=>({width:1,height:1,getContext:()=>new Proxy({}, {get:(_t,key)=>key==='createRadialGradient'?()=>({addColorStop(){}}):()=>{}})})};
const {createHistoricalScene,BAY}=await import(file.href);
after(()=>fs.unlink(file));
function meshes(root,kind){root.updateMatrixWorld(true);const result=[];root.traverse(o=>{if(o instanceof T.Mesh&&(!kind||o.userData.kind===kind))result.push(o);});return result;}
test('2025 Freeside doors have physical ankle-to-head passage, including hollow pods',()=>{
 const root=createHistoricalScene(2025),free=root.children.find(o=>o.userData.assembly_id==='kitchen'),pods=root.children.find(o=>o.userData.assembly_id==='utility-booths');
 assert.ok(free&&pods);root.updateMatrixWorld(true);
 const passage=(g,a,b,label)=>{
  const start=g.localToWorld(new T.Vector3(...a)),end=g.localToWorld(new T.Vector3(...b)),delta=end.clone().sub(start);
  const ray=new T.Raycaster(start,delta.clone().normalize(),0,delta.length());
  const hits=ray.intersectObject(g,true).filter(h=>h.object instanceof T.Mesh&&h.object.visible);
  assert.deepEqual(hits.map(h=>h.object.name),[],label);
 };
 for(const y of [.30,1.0,1.85]){
  for(const offset of [-.29,0,.29]){
   passage(free,[-BAY/2-.3,y,-2.4+offset],[-BAY/2+.3,y,-2.4+offset],`living room opening y${y} offset${offset}`);
   passage(free,[BAY/2-.3,y,-2.4+offset],[BAY/2+.3,y,-2.4+offset],`kitchen partition y${y} offset${offset}`);
   passage(free,[BAY-1.19+offset,y,BAY+.65],[BAY-1.19+offset,y,BAY-.20],`painted exterior door y${y} offset${offset}`);
   for(let i=0;i<3;i++)passage(pods,[i*3.3+offset,y,2.3],[i*3.3+offset,y,.2],`pod${i} y${y} offset${offset}`);
  }
 }
 // The source artwork moves with the opened leaf, not left across the hole.
 const art=meshes(free,'Freeside photographed black white door art')[0];
 assert.ok(art);assert.ok(Math.abs(art.parent.rotation.y+Math.PI/2)<.001);
});
