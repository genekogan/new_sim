// Actual shipped seated rigs: lower-leg skin clearance against the native 0.4 m deep bench slab.
// node apps/web/test/drawing-contact.cpu.mjs (GLB_DIR=… for an explicitly selected export)
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import*as THREE from 'three';
const M=new URL('../../../mars/viewer/',import.meta.url).pathname;
{const {registerHooks,createRequire}=await import('node:module');const esbuild=createRequire(import.meta.url)(new URL('../../../node_modules/.pnpm/esbuild@0.28.1/node_modules/esbuild/lib/main.js',import.meta.url).pathname);
 registerHooks({resolve(spec,ctx,next){try{return next(spec,ctx);}catch(e){if(ctx.parentURL?.startsWith('file://'+M)&&spec.startsWith('.'))return next(spec+'.ts',ctx);throw e;}},load(url,ctx,next){if(url.startsWith('file://'+M)&&url.endsWith('.ts')){const src=readFileSync(new URL(url),'utf8');return {format:'module',source:esbuild.transformSync(src,{loader:'ts',format:'esm'}).code,shortCircuit:true};}return next(url,ctx);}});}
// loadTemplates fetches /modular/environment/…: serve those from the GLB directory
const DIR=process.env.GLB_DIR??M+'public/modular/environment/';
globalThis.location??={href:'http://local/'};
globalThis.fetch=async url=>{const name=String(url).split('/').pop().split('?')[0];const b=readFileSync(DIR+name);return new Response(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));};
const {loadTemplates}=await import(M+'app/engine-view/people.ts');
const {HumanViews}=await import(M+'app/engine-view/humans.ts');
const {ThreeResources}=await import(M+'lib/three-resources.ts');
const ts=await loadTemplates(new AbortController().signal,new ThreeResources());

const views=new HumanViews(false);views.setTemplates(ts);
const idFor=(name,k)=>{for(let n=0;n<500;n++){const id=`${name}-bench-${k}-${n}`;let h=0;for(const ch of id)h=(h*31+ch.charCodeAt(0))>>>0;if(ts[h%ts.length].name===name)return id;}};
const frames=[];let n=0;for(const t of ts)for(const yaw of [0,Math.PI/2,Math.PI])for(const activity of ['sit','read'])frames.push({id:idFor(t.name,n++),p:[n*4,0,0],yaw,walk:0,walkDist:0,activityAge:2,activity,baseActivity:'sit',seatHeight:.45});
views.setFrame(frames,7.3);views.render(1);views.group.updateMatrixWorld(true);
const failures=[],report=[];
for(const f of frames){const holder=views.group.getObjectByName(f.id),origin=new THREE.Vector3(...f.p),forward=new THREE.Vector3(Math.cos(f.yaw),0,Math.sin(f.yaw)),across=new THREE.Vector3(-Math.sin(f.yaw),0,Math.cos(f.yaw));
 const hip=['UpperLegL','UpperLegR'].map(n=>holder.getObjectByName(n).getWorldPosition(new THREE.Vector3())).reduce((a,b)=>a.add(b)).multiplyScalar(.5);let intersections=0;
 holder.traverse(o=>{if(!o.isSkinnedMesh)return;const g=o.geometry,si=g.attributes.skinIndex,sw=g.attributes.skinWeight,p=new THREE.Vector3();for(let i=0;i<g.attributes.position.count;i++){let legWeight=0;for(let k=0;k<4;k++){const bone=o.skeleton.bones[si.getComponent(i,k)]?.name;if(/LowerLeg|Foot/.test(bone??''))legWeight+=sw.getComponent(i,k);}if(legWeight<.7)continue;o.getVertexPosition(i,p);o.localToWorld(p);const q=p.clone().sub(origin);if(Math.abs(q.dot(forward))<.2&&Math.abs(q.dot(across))<.85&&p.y>.4+1e-4&&p.y<.45-1e-4)intersections++;}});
 assert.ok(Math.abs(hip.clone().sub(origin).dot(forward))<.04,'pelvis centered on immutable seat anchor');
 report.push({id:f.id,yaw:f.yaw,activity:f.activity,hipForward:hip.clone().sub(origin).dot(forward),intersections});if(intersections)failures.push(f.id+': lower leg intersects bench slab '+intersections);
}
console.log(JSON.stringify(report));assert.deepEqual(failures,[]);console.log('PASS actual source rigs: lower legs clear 0.4 m bench slab at three headings, sit/read overlays');
