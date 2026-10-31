import fs from 'node:fs/promises';import{build}from'esbuild';import * as T from'three';
T.TextureLoader.prototype.load=function(url){const t=new T.Texture();t.userData.path=url;return t;};
await build({entryPoints:['app/history/details-2026-chiba.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:'.interior-module.mjs'});
const {add2026ChibaInteriors}=await import('../.interior-module.mjs');const g=new T.Group();
const wall=new T.Mesh(new T.BoxGeometry(),new T.MeshStandardMaterial({color:'#b59a79'}));wall.name='wood_component-0018';g.add(wall);add2026ChibaInteriors(g);g.updateMatrixWorld(true);
const rows=[];g.traverse(o=>{if(o.isMesh){const m=o.material;rows.push({name:o.name,p:Array.from(o.geometry.attributes.position.array),idx:o.geometry.index?Array.from(o.geometry.index.array):null,uv:o.geometry.attributes.uv?Array.from(o.geometry.attributes.uv.array):null,matrix:o.matrixWorld.toArray(),color:m.color.toArray(),texture:m.map?.userData.path});}});
if(!process.env.MARS_REVIEW_OUT)throw new Error('Set MARS_REVIEW_OUT to the saved review directory');
await fs.writeFile(`${process.env.MARS_REVIEW_OUT}/interior-additions.json`,JSON.stringify(rows));console.log(rows.length);await fs.unlink('.interior-module.mjs');
