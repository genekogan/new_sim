#!/usr/bin/env node
// Bounded, offline extraction from already shipped Mimos geometry and authored corridor.
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {extractStairSupports,stairGeometryDigest} from '../../mars/viewer/app/engine-view/stair-mesh-profile.ts';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),req=createRequire(resolve(root,'apps/server/package.json'));
const {NodeIO}=req('@gltf-transform/core'),req2=createRequire(req.resolve('@gltf-transform/functions')),{ALL_EXTENSIONS}=req2('@gltf-transform/extensions');
const {MeshoptDecoder}=await import(resolve(root,'apps/web/node_modules/meshoptimizer/index.js'));await MeshoptDecoder.ready;
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
const sha=b=>createHash('sha256').update(b).digest('hex');
const assets={...JSON.parse(readFileSync(resolve(root,'worlds/core-assets/index.json'))).assets,...JSON.parse(readFileSync(resolve(root,'worlds/core-assets/mars-fidelity.index.json'))).assets};
const renditions=JSON.parse(readFileSync(resolve(root,'worlds/core-assets/renditions.json'))).renditions;
const wanted=['515ac21643c3e13e2cb68ac884723834b9ab0bf59a044392ae49b1d8fc11af7e'];
const profiles=[];
for(const asset of wanted){
 const meta=assets[asset],fp=assets[meta.footprint];
 const footprintPath=fp?.path??'worlds/core-assets/mars/mimos.footprint.json',fpBytes=readFileSync(resolve(root,footprintPath));if(sha(fpBytes)!==meta.footprint)throw Error('footprint hash mismatch');
 const link=JSON.parse(fpBytes).links.find(l=>l.id==='main-step');if(!link)throw Error('missing authored corridor');
 for(const representation of [{sha:asset,path:meta.path},...(renditions[asset]?[renditions[asset]]:[])]){
  const bytes=readFileSync(resolve(root,representation.path));if(sha(bytes)!==representation.sha)throw Error('mesh hash mismatch');
  const doc=await io.read(resolve(root,representation.path)),triangles=[];let min=[Infinity,Infinity,Infinity],max=min.map(v=>-v);
  for(const node of doc.getRoot().listNodes())for(const primitive of node.getMesh()?.listPrimitives()??[]){
   if(primitive.getMode()!==4)continue;const pos=primitive.getAttribute('POSITION'),idx=primitive.getIndices(),m=node.getWorldMatrix();if(!pos)continue;
   for(let k=0;k+2<(idx?.getCount()??pos.getCount());k+=3){const t=[0,1,2].map(j=>{const v=pos.getElement(idx?idx.getScalar(k+j):k+j,[]);return [m[0]*v[0]+m[4]*v[1]+m[8]*v[2]+m[12],m[1]*v[0]+m[5]*v[1]+m[9]*v[2]+m[13],m[2]*v[0]+m[6]*v[1]+m[10]*v[2]+m[14]];});for(const p of t)for(let i=0;i<3;i++){min[i]=Math.min(min[i],p[i]);max[i]=Math.max(max[i],p[i]);}triangles.push(t);}
  }
  const extent=max.map((v,i)=>v-min[i]),origin=[(min[0]+max[0])/2,min[1],(min[2]+max[2])/2];
  const canonical=triangles.map(t=>t.map(p=>p.map((v,i)=>v-origin[i])));
  const contact=extractStairSupports(canonical,link.path[0],link.path.at(-1),link.width,true);
  profiles.push({asset,representation:representation.sha,geometry:stairGeometryDigest(canonical),extent,fitAxis:extent.indexOf(Math.max(...extent)),...contact,source:{mesh:representation.path,footprint:footprintPath,footprintHash:meta.footprint,link:link.id,bottomSupport:'native-lower-terrain'}});
 }
}
const path=resolve(root,'mars/viewer/app/engine-view/stair-mesh-profiles.json'),text=JSON.stringify({contract:'mesh-stair-contacts/1',quantum:.001,profiles},null,2)+'\n';
if(process.argv.includes('--check')){if(readFileSync(path,'utf8')!==text)throw Error('stair profiles stale');}else writeFileSync(path,text);
console.log(JSON.stringify({profiles:profiles.map(p=>({asset:p.asset,representation:p.representation,treads:p.treads.length,heights:p.treads.map(t=>t.y),geometry:p.geometry}))}));
