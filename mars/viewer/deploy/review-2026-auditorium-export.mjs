// Offline export of the actual retained CAD plus current source review modules.
// Restores original embedded materials after Node geometry loading (no browser).
import fs from 'node:fs/promises';
import {build} from 'esbuild';
import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
const OUT=process.env.MARS_REVIEW_OUT;
if(!OUT)throw new Error('Set MARS_REVIEW_OUT to the saved review directory');
const raw=await fs.readFile(`${OUT}/browser-uncompressed.glb`),n=raw.readUInt32LE(12),original=JSON.parse(raw.subarray(20,20+n)),originalBin=raw.subarray(28+n);
const sourceMaterials=new Map(original.materials.map(m=>[m.name,m]));
const doc=structuredClone(original);doc.images=[];doc.textures=[];doc.materials=doc.materials.map(m=>({name:m.name,pbrMetallicRoughness:{baseColorFactor:m.pbrMetallicRoughness?.baseColorFactor||[1,1,1,1]}}));
function pack(j,bin){let text=Buffer.from(JSON.stringify(j));text=Buffer.concat([text,Buffer.alloc((4-text.length%4)%4,32)]);const h=Buffer.alloc(20),bh=Buffer.alloc(8);h.write('glTF');h.writeUInt32LE(2,4);h.writeUInt32LE(28+text.length+bin.length,8);h.writeUInt32LE(text.length,12);h.write('JSON',16);bh.writeUInt32LE(bin.length);bh.write('BIN\0',4);return Buffer.concat([h,text,bh,bin]);}
const input=pack(doc,originalBin);const {scene}=await new GLTFLoader().parseAsync(input.buffer.slice(input.byteOffset,input.byteOffset+input.byteLength),'');
T.TextureLoader.prototype.load=function(){return new T.Texture();};
// oxlint-disable-next-line typescript/no-deprecated -- offline canvas stub for geometry extraction; no browser DOM
globalThis.document={createElement:()=>({width:1,height:1,getContext:()=>new Proxy({}, {get:()=>()=>{}})})};
const file=`.review-2026-${process.pid}.mjs`;await build({entryPoints:['app/history/details-2026-auditorium.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:file,logLevel:'error'});
try{const {add2026AuditoriumDetails:add2026Details}=await import(`../${file}`);add2026Details(scene);}finally{await fs.unlink(file);}
scene.updateMatrixWorld(true);
scene.traverse(o=>{if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material]){if(m.map)m.map=null;}});
globalThis.FileReader=class{readAsArrayBuffer(blob){blob.arrayBuffer().then(a=>{this.result=a;this.onloadend?.();});}readAsDataURL(blob){blob.arrayBuffer().then(a=>{this.result='data:application/octet-stream;base64,'+Buffer.from(a).toString('base64');this.onloadend?.();});}};
const result=Buffer.from(await new GLTFExporter().parseAsync(scene,{binary:true,onlyVisible:true}));
const len=result.readUInt32LE(12),j=JSON.parse(result.subarray(20,20+len)),baseBin=result.subarray(28+len);let offset=baseBin.length;const chunks=[baseBin];
j.images=[];j.textures=structuredClone(original.textures||[]);j.samplers=structuredClone(original.samplers||[]);
for(const image of original.images||[]){const view=original.bufferViews[image.bufferView],payload=originalBin.subarray(view.byteOffset||0,(view.byteOffset||0)+view.byteLength);const index=j.bufferViews.length;j.bufferViews.push({buffer:0,byteOffset:offset,byteLength:payload.length});chunks.push(payload);offset+=payload.length;const pad=(4-offset%4)%4;chunks.push(Buffer.alloc(pad));offset+=pad;j.images.push({...image,bufferView:index});}
j.materials=j.materials.map(m=>sourceMaterials.has(m.name)?structuredClone(sourceMaterials.get(m.name)):m);j.buffers=[{byteLength:offset}];
await fs.writeFile(`${OUT}/auditorium-review.glb`,pack(j,Buffer.concat(chunks)));
const ids=[];scene.traverse(o=>{if(o.userData.component_id)ids.push(o.userData.component_id);});
await fs.writeFile(`${OUT}/auditorium-review-ids.json`,JSON.stringify(ids,null,2));
console.log('Offline review export',ids.length,'components; original embedded finishes retained, new photo planes need explicit render textures');
