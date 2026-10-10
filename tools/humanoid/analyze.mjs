// Read-only analysis of the three shipped character GLBs: clip equality, track kinds, bind-pose equality.
import {readFileSync} from 'node:fs';
import {THREE,ENV_DIR as DIR,parseGlb} from './three.mjs';
const load=n=>parseGlb(readFileSync(DIR+`animated-${n}.glb`));
const g={};for(const n of ['casual','punk','woman'])g[n]=await load(n);
const eq=(a,b,eps=0)=>a.length===b.length&&a.every((v,i)=>Math.abs(v-b[i])<=eps);
for(const n of ['punk','woman']){
 let same=0,diff=[];
 for(const c of g.casual.animations){const o=THREE.AnimationClip.findByName(g[n].animations,c.name);if(!o){diff.push(c.name+':missing');continue;}
  const ok=c.tracks.length===o.tracks.length&&c.tracks.every((t,i)=>t.name===o.tracks[i].name&&eq(t.times,o.tracks[i].times,1e-6)&&eq(t.values,o.tracks[i].values,1e-5));
  if(ok)same++;else diff.push(c.name);}
 console.log(n,'clips equal to casual:',same,'differ:',diff.join(','));
}
const c0=g.casual.animations;
console.log('clips',c0.map(c=>`${c.name}:${c.tracks.length}:${c.duration.toFixed(2)}:${c.tracks.filter(t=>t.name.endsWith('.position')).map(t=>t.name.split('.')[0]).filter((v,i,a)=>a.indexOf(v)===i).length}pos:${c.tracks[0].getInterpolation()}`).join(' '));
// which bones have position tracks in UAL clips
const posBones=new Set();for(const c of c0.slice(8))for(const t of c.tracks)if(t.name.endsWith('.position'))posBones.add(t.name.split('.')[0]);console.log('UAL position-tracked bones',[...posBones].join(','));
// bind pose
for(const n of ['casual','punk','woman']){const ms=[];g[n].scene.traverse(o=>{if(o.isSkinnedMesh)ms.push(o);});
 console.log(n,'skinned meshes',ms.map(m=>`${m.name}[${m.material.name}] v${m.geometry.attributes.position.count} attrs=${Object.keys(m.geometry.attributes).join('/')} bones=${m.skeleton.bones.length}`).join(' | '));}
const ib=n=>{let s;g[n].scene.traverse(o=>{if(o.isSkinnedMesh&&!s)s=o.skeleton;});return s;};
const sc=ib('casual'),sp=ib('punk'),sw=ib('woman');
console.log('bone order equal c/p',sc.bones.map(b=>b.name).join()===sp.bones.map(b=>b.name).join(),'c/w',sc.bones.map(b=>b.name).join()===sw.bones.map(b=>b.name).join());
let maxd=0;sc.boneInverses.forEach((m,i)=>{maxd=Math.max(maxd,...m.elements.map((v,j)=>Math.abs(v-sp.boneInverses[i].elements[j])));});console.log('max |IB casual - IB punk|',maxd);
let maxw=0,worst='';sc.boneInverses.forEach((m,i)=>{const d=Math.max(...m.elements.map((v,j)=>Math.abs(v-sw.boneInverses[i].elements[j])));if(d>maxw){maxw=d;worst=sc.bones[i].name;}});console.log('max |IB casual - IB woman|',maxw,worst);
// all skinned meshes in a GLB share one skeleton?
for(const n of ['casual','punk','woman']){const sk=new Set();g[n].scene.traverse(o=>{if(o.isSkinnedMesh)sk.add(o.skeleton);});console.log(n,'distinct skeleton objects',sk.size);}
// scene structure
const tree=(o,d=0,out=[])=>{if(d<3)out.push(' '.repeat(d)+o.type+':'+o.name+(o.isBone?'':''));for(const c of o.children)if(!c.isBone||d<2)tree(c,d+1,out);return out;};console.log(tree(g.casual.scene).join('\n'));
const mats=n=>{const s=new Map();g[n].scene.traverse(o=>{if(o.isMesh)s.set(o.material.name,[o.material.type,o.material.color.getHexString(),o.material.roughness,o.material.metalness,o.material.side,o.material.vertexColors]);});return Object.fromEntries(s);};
for(const n of ['casual','punk','woman'])console.log(n,JSON.stringify(mats(n)));
