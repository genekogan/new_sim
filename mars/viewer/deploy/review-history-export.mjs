// Offline export of the same procedural scene used by Studio; one year only.
import fs from 'node:fs/promises';
import {build} from 'esbuild';
import * as T from 'three';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
const year=Number(process.argv[2]);if(![2020,2021,2022,2023,2024,2025].includes(year))throw Error('Pass one historical year');
const out=process.argv[3];if(!out)throw Error('Pass output directory');await fs.mkdir(out,{recursive:true});
const file=`.history-review-${process.pid}.mjs`;
await build({entryPoints:['app/history/scenes.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:file,logLevel:'error'});
const textures=new Map();T.TextureLoader.prototype.load=function(url){const texture=new T.Texture();textures.set(texture,url);return texture;};
// oxlint-disable-next-line typescript/no-deprecated -- offline canvas stub for geometry extraction; no browser DOM
globalThis.document={createElement:()=>({width:1,height:1,getContext:()=>new Proxy({}, {get:()=>()=>{}})})};
try{
 const {createHistoricalScene}=await import(`../${file}`);const root=createHistoricalScene(year);root.updateMatrixWorld(true);
 const ids=[],maps=[];
 root.traverse(o=>{if(o.userData.component_id)ids.push({id:o.userData.component_id,kind:o.userData.kind,assembly:o.userData.assembly_id});if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material]){if(m.map){const url=textures.get(m.map);if(url){m.name=`photo:${url}`;maps.push(url);}m.map=null;}}});
 globalThis.FileReader=class{readAsArrayBuffer(blob){blob.arrayBuffer().then(a=>{this.result=a;this.onloadend?.();});}readAsDataURL(blob){blob.arrayBuffer().then(a=>{this.result='data:application/octet-stream;base64,'+Buffer.from(a).toString('base64');this.onloadend?.();});}};
 await fs.writeFile(`${out}/integrated-review.glb`,Buffer.from(await new GLTFExporter().parseAsync(root,{binary:true,onlyVisible:false})));
 await fs.writeFile(`${out}/ids.json`,JSON.stringify(ids,null,2));await fs.writeFile(`${out}/photo-maps.json`,JSON.stringify([...new Set(maps)],null,2));console.log(year,ids.length,'components; photo material paths retained for offline render');
}finally{await fs.unlink(file);}
