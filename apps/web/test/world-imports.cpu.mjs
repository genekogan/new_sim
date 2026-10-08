// eden-imports (CC0 animals, crops, boats/bikes, props, ground cover): every model a module asks for is in its pack GLB,
// animals stay in their zones and off buildings/water all day, crop beds cycle through their stages.
// node apps/web/test/world-imports.cpu.mjs   (GLB_DIR=… to check another export)
import assert from 'node:assert/strict';import {readFileSync,existsSync} from 'node:fs';
import*as THREE from 'three';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const M=new URL('../../../mars/viewer/',import.meta.url).pathname;
{const {registerHooks,createRequire}=await import('node:module');const esbuild=createRequire(import.meta.url)(new URL('../../../node_modules/.pnpm/esbuild@0.28.1/node_modules/esbuild/lib/main.js',import.meta.url).pathname);
 registerHooks({resolve(spec,ctx,next){try{return next(spec,ctx);}catch(e){if(ctx.parentURL?.startsWith('file://'+M)&&spec.startsWith('.'))return next(spec+'.ts',ctx);throw e;}},load(url,ctx,next){if(url.startsWith('file://'+M)&&url.endsWith('.ts')){const src=readFileSync(new URL(url),'utf8');return {format:'module',source:esbuild.transformSync(src,{loader:'ts',format:'esm'}).code,shortCircuit:true};}return next(url,ctx);}});}
const DIR=process.env.GLB_DIR??M+'public/modular/environment/';
const A=M+'app/engine-view/content/assets/eden-imports/';
const load=async f=>{const b=readFileSync(DIR+f);return new Promise((ok,no)=>new GLTFLoader().parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'',ok,no));};
const names=g=>new Set(g.scene.children.map(o=>o.name));
const {HERDS,FLOCKS,AVOID}=await import(A+'animal-plan.ts');
const {agentAt}=await import(A+'animals.ts');
const report={};
// animals: models + clips present; positions over a day inside the zone and outside AVOID
if(existsSync(DIR+'eden-animals.glb')){const g=await load('eden-animals.glb'),n=names(g);
 for(const h of [...HERDS,...FLOCKS]){assert.ok(n.has(h.model),'animal model '+h.model);}
 for(const h of HERDS)for(const c of Object.values(h.clips))assert.ok(g.animations.some(a=>a.name===`${h.model}|${c}`),`${h.model}|${c}`);
 report.animalModels=n.size;}
const inR=(r,x,z)=>x>=r[0]&&x<=r[2]&&z>=r[1]&&z<=r[3];
let samples=0,moving=0;
for(const h of HERDS)for(let i=0;i<h.count;i++){const id=`${h.id}-${i}`;for(let t=1.79e9;t<1.79e9+86400;t+=37){const [x,z,yaw,mv]=agentAt(h,id,t);samples++;if(mv)moving++;
 assert.ok([x,z,yaw].every(Number.isFinite),id+' finite');assert.ok(h.zone.some(r=>inR(r,x,z)),`${id} in zone at ${t}: ${x.toFixed(1)},${z.toFixed(1)}`);assert.ok(!AVOID.some(r=>inR(r,x,z)),`${id} off avoid at ${t}: ${x.toFixed(1)},${z.toFixed(1)}`);}}
report.animalSamples=samples;report.movingShare=+(moving/samples).toFixed(2);
// crops: stages cycle, models present
if(existsSync(A+'crops.ts')){const {BEDS,bedStage}=await import(A+'crops.ts');
 const seen=new Set();for(const b of BEDS)for(let ms=1.79e12;ms<1.79e12+8*3600e3;ms+=600e3){const s=bedStage(b,ms);seen.add(s.stage);}
 assert.deepEqual([...seen].sort(),[0,1,2,3,4,5],'every crop stage occurs');
 if(existsSync(DIR+'eden-crops.glb')){const n=names(await load('eden-crops.glb'));for(const b of BEDS)for(let ms=1.79e12;ms<1.79e12+40*3600e3;ms+=1800e3){const {crop,stage}=bedStage(b,ms);if(stage>=1&&stage<=4)assert.ok(n.has(`crop-${crop}-${stage}`),`crop-${crop}-${stage}`);}report.cropModels=n.size;}}
// static packs: every model a module places exists
for(const [mod,file,list] of [['boats-bikes.ts','eden-boats-bikes.glb',m=>[...m.BOATS,...m.BIKES].map(p=>p.model)],['props.ts','eden-food.glb',m=>m.SETTINGS.flatMap(s=>s.items.map(i=>i[0]))],['groundcover-plan.ts','eden-nature.glb',m=>m.PATCHES.flatMap(p=>[...p.models,...(p.autumn??[])])],['interior-plan.ts','eden-interior.glb',m=>m.FIXTURES.map(f=>f.model)]]){
 if(!existsSync(A+mod)||!existsSync(DIR+file))continue;const m=await import(A+mod),n=names(await load(file));for(const x of new Set(list(m)))assert.ok(n.has(x),`${file} has ${x}`);report[file]=n.size;}
console.log(JSON.stringify(report));console.log('eden imports cpu PASS');
