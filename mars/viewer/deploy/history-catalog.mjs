// Generate navigation from the same geometry used by the browser, without WebGL.
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import * as THREE from 'three';
await build({entryPoints:['app/history/scenes.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:'.history-catalog.mjs'});
THREE.TextureLoader.prototype.load=function(){return new THREE.Texture();};
// oxlint-disable-next-line typescript/no-deprecated -- minimal offline canvas stub, not a browser DOM
globalThis.document={createElement:()=>({width:1,height:1,getContext:()=>new Proxy({}, {get:(_t,key)=>key==='createRadialGradient'?()=>({addColorStop(){}}):()=>{}})})};
const {createHistoricalScene}=await import('../.history-catalog.mjs');
const catalogs={};
for(let year=2020;year<2026;year++){
 const root=createHistoricalScene(year);root.updateMatrixWorld(true);const obstacles=[],people=[],bounds=new THREE.Box3();
 root.traverse(o=>{if(o.userData.kind==='context_person'){people.push({id:o.userData.component_id,position:o.getWorldPosition(new THREE.Vector3()).toArray(),roaming:people.length%4!==0});return;}if(!(o instanceof THREE.Mesh)||o.userData.kind==='site_context')return;const b=new THREE.Box3().setFromObject(o);bounds.union(b);if(b.max.y>.14&&b.min.y<1.69)obstacles.push([b.min.toArray(),b.max.toArray()]);});
 catalogs[year]={people,obstacles,bounds:[bounds.min.toArray(),bounds.max.toArray()]};
 console.log(year,people.length,'people',obstacles.length,'obstacles');
}
await fs.writeFile('simulation/history-catalogs.json',JSON.stringify(catalogs));await fs.unlink('.history-catalog.mjs');
