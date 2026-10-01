import fs from'node:fs/promises';import{build}from'esbuild';import * as T from'three';
// oxlint-disable-next-line typescript/no-deprecated -- offline canvas stub for geometry extraction; no browser DOM
T.TextureLoader.prototype.load=function(){return new T.Texture();};globalThis.document={createElement:()=>({width:1,height:1,getContext:()=>new Proxy({},{get:()=>()=>{}})})};
await build({entryPoints:['app/history/details-2026.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:'.migration-2026-module.mjs'});
const{add2026Details}=await import('../.migration-2026-module.mjs');const root=new T.Group(),chiba=new T.Group();chiba.name='Chiba';root.add(chiba);add2026Details(root);root.updateMatrixWorld(true);
const rows=[];root.traverse(o=>{if(o.userData.component_id)rows.push({id:o.userData.component_id,assembly:o.userData.assembly_id,kind:o.userData.kind,position:o.position.toArray(),local:o.matrix.toArray(),world:o.matrixWorld.toArray()});});
await fs.writeFile('<mars-media>/reconstruction/2026-campus/review-20260929/id-live-2026.json',JSON.stringify(rows,null,2));console.log(rows.length);await fs.unlink('.migration-2026-module.mjs');
