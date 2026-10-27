#!/usr/bin/env node
// Offline only: read shipped content-addressed GLBs, never raw archives. No mesh or pinned def is mutated.
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {extractFloorPatches} from './geometry.mjs';
import {stairAccess} from './steps.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),req=createRequire(resolve(root,'apps/server/package.json'));
const {NodeIO}=req('@gltf-transform/core');
const req2=createRequire(req.resolve('@gltf-transform/functions'));
const {ALL_EXTENSIONS}=req2('@gltf-transform/extensions');
const pnpm=resolve(root,'node_modules/.pnpm'),meshopt=readdirSync(pnpm).filter(x=>x.startsWith('meshoptimizer@1.3.')).sort().pop();
if(!meshopt)throw Error('pnpm store lacks meshoptimizer@1.3; install workspace dependencies first');
const {MeshoptDecoder}=await import(resolve(pnpm,meshopt,'node_modules/meshoptimizer/index.js'));await MeshoptDecoder.ready;
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
const mul=(m,v)=>[m[0]*v[0]+m[4]*v[1]+m[8]*v[2]+m[12],m[1]*v[0]+m[5]*v[1]+m[9]*v[2]+m[13],m[2]*v[0]+m[6]*v[1]+m[10]*v[2]+m[14]];
const sha=b=>createHash('sha256').update(b).digest('hex'),names=['chiba','tool-camp','freeside','west-racks'];
const defs=JSON.parse(readFileSync(resolve(root,'packages/world-compiler/src/core-kit/mars.json'))),assets={...JSON.parse(readFileSync(resolve(root,'worlds/core-assets/index.json'))).assets,...JSON.parse(readFileSync(resolve(root,'worlds/core-assets/mars-fidelity.index.json'))).assets};
const output={policy:'mesh-floors/1',assets:{}};
for(const name of names)for(const [hash,asset] of Object.entries(assets).filter(([,a])=>a.kind==='mesh'&&a.name===`mars-${name}`)){
 const def=defs.find(d=>d.name===`core-mars-${name}`);
 const path=resolve(root,asset.path),bytes=readFileSync(path);if(sha(bytes)!==hash)throw Error(`asset hash mismatch: ${name}`);
 const doc=await io.read(path),triangles=[];let min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 for(const node of doc.getRoot().listNodes())for(const primitive of node.getMesh()?.listPrimitives()??[]){
  if(primitive.getMode()!==4)continue;const pos=primitive.getAttribute('POSITION'),idx=primitive.getIndices();if(!pos)continue;const matrix=node.getWorldMatrix(),n=idx?idx.getCount():pos.getCount();
  for(let k=0;k+2<n;k+=3){const points=[0,1,2].map(j=>mul(matrix,pos.getElement(idx?idx.getScalar(k+j):k+j,[])));for(const p of points)for(let j=0;j<3;j++){min[j]=Math.min(min[j],p[j]);max[j]=Math.max(max[j],p[j]);}triangles.push({node:node.getName(),points});}
 }
 // Same canonical fit as gltf-assets.instantiate: base-centred, uniform scale
 // on the mesh's largest axis (asset index boxes can contain obsolete bounds).
 const ext=min.map((v,i)=>max[i]-v),fitAxis=ext.indexOf(Math.max(...ext));
 const scale=def.size.box[fitAxis]/ext[fitAxis],origin=[(min[0]+max[0])/2,min[1],(min[2]+max[2])/2];
 for(const t of triangles)t.points=t.points.map(p=>p.map((v,i)=>(v-origin[i])*scale));
 const result=extractFloorPatches(triangles),access=name==='chiba'?stairAccess(result.patches,triangles):null,accepted=result.patches.filter((p,i)=>access?access.reached.includes(i):p.y>=-.05&&p.y<=.45);
 const levels=[];for(const p of accepted)if(p.y>.45&&!levels.some(y=>Math.abs(y-p.y)<=.02))levels.push(p.y);
 const levelOf=y=>y<=.45?0:levels.findIndex(h=>Math.abs(h-y)<=.02)+1;
 const surfaces=accepted.flatMap((p,i)=>p.polygons.map((polygon,j)=>({level:levelOf(p.y),y:p.y,polygon,tag:`mesh-floor:${name}:${i}:${j}`})));
 output.assets[hash]={name:def.name,box:def.size.box,fitAxis,source:asset.path,geometryHash:sha(JSON.stringify(triangles)),cell:result.cell,headroom:result.headroom,entry:access?'terrain-step and verified three-rise flight':'terrain-step<=0.45m',surfaces,...(access?{links:access.links.map(l=>({...l,from:levelOf(l.y0),to:levelOf(l.y1)})),access:access.provenance}:{}),patches:accepted.map(p=>({y:p.y,area:p.area,nodes:p.nodes})),rejected:result.patches.filter(p=>!accepted.includes(p)).map(p=>({y:p.y,area:p.area,reason:'no proven entrance or stair link'}))};
 console.log(JSON.stringify({name,triangles:triangles.length,patches:result.patches.length,accepted:accepted.map(p=>({y:p.y,area:p.area,rectangles:p.polygons.length})),rejected:result.patches.length-accepted.length}));
}
const path=resolve(root,'packages/world-compiler/src/mesh-floor-overlays.json'),data=JSON.stringify(output,null,1)+'\n';
if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==data)throw Error('mesh floor overlays are stale');}
else writeFileSync(path,data);
