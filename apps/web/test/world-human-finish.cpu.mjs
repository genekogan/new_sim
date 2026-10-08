// Human surface finish: every audited preset Soul still applies (all 8), geometry/rig invariance, shared program.
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import*as THREE from 'three';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';import {clone} from 'three/addons/utils/SkeletonUtils.js';
const M=new URL('../../../mars/viewer/',import.meta.url).pathname;
// mars/viewer TypeScript uses parameter properties (not strip-only): transform those files with the repo's esbuild.
{const {registerHooks,createRequire}=await import('node:module');const esbuild=createRequire(import.meta.url)(new URL('../../../node_modules/.pnpm/esbuild@0.28.1/node_modules/esbuild/lib/main.js',import.meta.url).pathname);
 registerHooks({load(url,ctx,next){if(url.startsWith('file://'+M)&&url.endsWith('.ts')){const src=readFileSync(new URL(url),'utf8');return {format:'module',source:esbuild.transformSync(src,{loader:'ts',format:'esm'}).code,shortCircuit:true};}return next(url,ctx);}});}
const {collectTemplateAppearance,transferActorAppearance,HumanActorAppearance}=await import(M+'app/engine-view/human-appearance.ts');
const {SOCIAL_PUBLIC_ASSIGNMENTS,SOCIAL_HUMAN_PRESETS}=await import(M+'app/engine-view/content/details/human-presets/presets.mjs');
const {applyHumanFinish,humanFinishRoleOf,humanFinishFor,humanFinishCompile,humanFinishKey,HUMAN_FINISH}=await import(M+'app/engine-view/content/details/human-presets/finish.ts');
const templates={};
for(const name of ['casual','punk','woman']){
 const bytes=readFileSync(M+`public/modular/environment/animated-${name}.glb`),sha=createHash('sha256').update(bytes).digest('hex');
 const ab=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
 const gltf=await new Promise((ok,no)=>new GLTFLoader().parse(ab,'',ok,no));
 const appearance=await collectTemplateAppearance(gltf,name,sha);assert.ok(appearance,name+' appearance provenance');
 templates[name]={gltf,appearance};
}
// Geometry/rig fingerprint of a scene: names, types, hierarchy, attribute bytes, bones and bind matrices.
const fingerprint=root=>{const h=createHash('sha256');let meshes=0,tris=0;root.traverse(o=>{h.update(o.type+'|'+o.name+'|'+o.children.length+'|'+o.position.toArray()+o.quaternion.toArray()+o.scale.toArray());
 if(o.isMesh){meshes++;const g=o.geometry;tris+=(g.index?g.index.count:g.attributes.position.count)/3;for(const [k,a] of Object.entries(g.attributes))h.update(k+Buffer.from(a.array.buffer,a.array.byteOffset,a.array.byteLength).toString('base64'));
  if(g.index)h.update(Buffer.from(g.index.array.buffer,g.index.array.byteOffset,g.index.array.byteLength));
  if(o.isSkinnedMesh){h.update(o.skeleton.bones.map(b=>b.name).join());for(const m of o.skeleton.boneInverses)h.update(m.elements.join());}}});return {sha:h.digest('hex'),meshes,tris};};
const before=Object.fromEntries(Object.entries(templates).map(([k,t])=>[k,fingerprint(t.gltf.scene)]));
// One rig per audited public Soul (as fit()/createRig: SkeletonUtils clone + explicit provenance transfer).
async function cohort(){const out=[];for(const row of SOCIAL_PUBLIC_ASSIGNMENTS){const t=templates[row.template];const model=clone(t.gltf.scene);
  const actor=transferActorAppearance(t.gltf.scene,model,t.appearance);assert.ok(actor,row.actorId+' transfer');
  const ap=new HumanActorAppearance(model,actor,row.stableSoulKey);await ap.ready;out.push({row,model,actor,ap});}return out;}
// Control: pristine GLB materials apply all 8 (unchanged audited behaviour).
{const c=await cohort();for(const {row,ap} of c){const s=ap.snapshot();assert.equal(s.state,'attached',row.actorId+' pristine');assert.equal(s.presetId,row.presetId);ap.retire();}}
// Finish the shared template materials in place.
const counts=Object.fromEntries(Object.entries(templates).map(([k,t])=>[k,applyHumanFinish(k,t.gltf.scene)]));
assert.deepEqual(counts,{casual:9,punk:9,woman:7},'every audited slot finished');
for(const [k,t] of Object.entries(templates))assert.equal(applyHumanFinish(k,t.gltf.scene),0,k+' idempotent');
for(const [k,t] of Object.entries(templates))t.gltf.scene.traverse(o=>{if(!o.isSkinnedMesh)return;const f=humanFinishFor(k,o.material.name);assert.ok(f,k+' '+o.material.name+' has a finish');
 assert.equal(humanFinishRoleOf(o.material),f.role);assert.equal(o.material.roughness,f.roughness);assert.equal(o.material.metalness,0);assert.equal(Object.keys(o.material.userData).length,0);});
// All 8 preset Souls still apply on finished originals; their owned clones carry the same finish and the preset colour.
const c=await cohort();
for(const {row,model,actor,ap} of c){const s=ap.snapshot();assert.equal(s.state,'attached',row.actorId+' finished');assert.equal(s.presetId,row.presetId);assert.ok(s.ownedMaterials>0);
 const preset=SOCIAL_HUMAN_PRESETS.find(p=>p.id===row.presetId);
 for(const b of actor.bindings){const slot=preset.materialSlots[b.slot],m=b.mesh.material,f=humanFinishFor(row.template,slot.name);
  assert.equal(humanFinishRoleOf(m),f.role,row.actorId+' '+slot.name+' role');assert.equal(m.roughness,f.roughness);
  if(slot.operation==='retain-original')assert.equal(m,b.originalMaterial);else{assert.notEqual(m,b.originalMaterial);m.color.toArray().forEach((v,i)=>assert.ok(Math.abs(v-slot.baseColorLinear[i])<1e-6));}}}
// Programs: one hook identity and one cache key for every role; injected at all five points.
{const keys=new Set(),mats=new Set();for(const {model} of c)model.traverse(o=>{if(o.isSkinnedMesh){keys.add(o.material.customProgramCacheKey());mats.add(o.material);assert.equal(o.material.onBeforeCompile,humanFinishCompile);}});
 assert.deepEqual([...keys],[humanFinishKey()]);
 for(const m of mats){const sh={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};m.onBeforeCompile(sh,{});
  assert.match(sh.vertexShader,/vHumanP=position;/);for(const re of [/humanRough=1\./,/roughnessFactor\*humanRough/,/humanBumpAmt>0\./,/reflectedLight\.indirectDiffuse\*=ao/])assert.match(sh.fragmentShader,re);
  assert.equal(typeof sh.uniforms.edenHumanRole.value,'number');assert.equal((sh.fragmentShader.match(/texture2D|texture\(/g)??[]).length,(THREE.ShaderLib.standard.fragmentShader.match(/texture2D|texture\(/g)??[]).length,'no extra texture lookups');}}
// Retire restores the shared finished originals exactly.
for(const {actor,ap} of c){assert.ok(ap.retire());for(const b of actor.bindings)assert.equal(b.mesh.material,b.originalMaterial);}
// Contract stays strict: an unaudited roughness drift drops to Simple (not silently restyled).
{const t=templates.casual,model=clone(t.gltf.scene),actor=transferActorAppearance(t.gltf.scene,model,t.appearance);const skin=actor.bindings.find(b=>b.originalMaterial.name==='Skin').originalMaterial;
 const keep=skin.roughness;skin.roughness=.7;const ap=new HumanActorAppearance(model,actor,'s_006a68883b');await ap.ready;assert.equal(ap.snapshot().state,'simple','drifted roughness rejected');skin.roughness=keep;}
// Geometry, hierarchy, names, bones and bind matrices identical before vs after.
for(const [k,t] of Object.entries(templates))assert.deepEqual(fingerprint(t.gltf.scene),before[k],k+' geometry/rig invariance');
assert.equal(Object.values(HUMAN_FINISH).reduce((n,s)=>n+Object.keys(s).length,0),25);
console.log('PASS human finish: 25 audited slots finished in place, all 8 social preset Souls attach on pristine and finished originals, owned clones carry finish+preset colour, one hook/key for all roles, no texture taps, strict drift rejection, geometry/rig fingerprint identical',JSON.stringify(before));
