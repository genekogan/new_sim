import assert from 'node:assert/strict';import*as THREE from 'three';
import {surfaceKit,stepSurfaceKit} from '../src/WorldEdenSurfaceKit.ts';
import {buildingPaletteOf,disposeBuildingIdentity,applySceneryRealism,applyWorldRealism,classifyRealism,realismClassOf,releaseWorldRealism} from '../src/WorldEdenRealism.ts';
const std=(o={})=>new THREE.MeshStandardMaterial(o);
const cases=[
 [std({vertexColors:true}),['Connected Eden > NEW expansion cosmetic ground; original native rectangles omitted'],'ground'],
 [std({color:'#76a454'}),['commons > commons-ground'],'ground'],
 [std({color:'#baae91'}),['Optional exact native social reservations appearance > path-east'],'path'],
 [std({vertexColors:true}),['Connected Eden > Forest and path fern edge / curved stems'],'bark'],
 [std({color:'#82915c'}),['decorative vegetation preview > vegetation:blade:grass'],'foliage'],
 [std({vertexColors:true}),['Connected Eden > Perennial flower garden transition / two-sided leaf blades'],'foliage'],
 [std({vertexColors:true}),['Connected Eden > Perennial flower garden transition / restrained five-petal flowers'],'flower'],
 [std({vertexColors:true}),['Connected Eden > Country and river bank stone clusters / low warmgrey and ochre faceted stones'],'stone'],
 [std({color:'#70533b'}),['commons:bench > bench:bark'],'wood'],
 [std({color:'#70533b'}),['decorative vegetation preview > vegetation:stem:bark'],'bark'],
 [std({color:'#d8cbb1'}),['eden-house-1 > plaster'],'plaster'],
 [std({color:'#a7784f'}),['eden-barn-1 > gable-upper-wall:-6'],'wood'],
 [std({color:'#52734a'}),['eden-house-3-upper-couch > cushion:#52734a'],'cloth'],
 [std({color:'#286a8d',transparent:true,opacity:.88}),['lake > water'],'water'],
 [std({color:'#ffffff',vertexColors:true}),['Connected Eden > proposed calmlake bed'],null],
 [std({color:'#dae7d0'}),['venue > eden-classroom-local-projection'],null],
 [std({color:'#ffffff'}),['Original static fair cloud family > lobes'],null],
 [new THREE.MeshBasicMaterial(),['anything'],null],
];
for(const [m,names,want] of cases)assert.equal(classifyRealism(m,names),want,names[0]);
// Idempotent in-place hook: same object, same geometry; second pass adds nothing; release restores pristine hooks and opts out.
const g=new THREE.BoxGeometry(1,1,1),ground=std({vertexColors:true}),grass=std({color:'#82915c'});
const root=new THREE.Group(),a=new THREE.Mesh(g,ground),b=new THREE.InstancedMesh(g,grass,4);a.name='NEW expansion cosmetic ground';b.name='vegetation:blade:grass';root.add(a,b);
const pos=g.attributes.position.array.slice();
assert.equal(applyWorldRealism(root),2);assert.equal(applyWorldRealism(root),0);
assert.equal(a.material,ground);assert.equal(b.material,grass);assert.deepEqual(g.attributes.position.array,pos);
assert.equal(realismClassOf(ground),'ground');assert.equal(realismClassOf(grass),'foliage');
const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};
grass.onBeforeCompile(shader,{});assert.match(shader.vertexShader,/vEdenW=\(modelMatrix\*edenP\)\.xyz/);assert.match(shader.fragmentShader,/diffuseColor\.rgb\*=mix/);assert.match(shader.fragmentShader,/roughnessFactor=clamp\(roughnessFactor\*edenRough/);
assert.ok(shader.uniforms.edenRealism.value.isVector4);assert.match(grass.customProgramCacheKey(),/eden-realism-v3/);
assert.equal(ground.customProgramCacheKey(),grass.customProgramCacheKey(),'one shared program variant for all classes');
releaseWorldRealism([ground]);assert.equal(ground.onBeforeCompile,THREE.Material.prototype.onBeforeCompile);assert.equal(ground.customProgramCacheKey,THREE.Material.prototype.customProgramCacheKey);assert.equal(realismClassOf(ground),null);
assert.equal(applyWorldRealism(root),0,'released materials stay opted out');
// Scene siblings: actors (skinned), floaters and kin subtrees keep their own appearance owners.
{const scene=new THREE.Scene(),bench=std({color:'#a7784f'}),held=std({color:'#a7784f'}),kinMat=std({color:'#d9c7b0'});
 const dressing=new THREE.Group();dressing.add(Object.assign(new THREE.Mesh(g,bench),{name:'bench:timber'}));
 const people=new THREE.Group(),skinned=new THREE.SkinnedMesh(g,std({color:'#b97750'}));people.add(skinned,Object.assign(new THREE.Mesh(g,held),{name:'held timber'}));
 const kin=new THREE.Group();kin.name='kin';kin.add(new THREE.Mesh(g,kinMat));
 scene.add(dressing,people,kin);assert.equal(applySceneryRealism(scene),1);assert.equal(realismClassOf(bench),'wood');
 assert.equal(realismClassOf(held),null);assert.equal(realismClassOf(skinned.material),null);assert.equal(realismClassOf(kinMat),null);}
// Building identity: per-building clones (same geometry/draws), neighbours differ, furniture untouched, textures within budget.
{const root=new THREE.Group(),container=new THREE.Group();container.name='Eden furnished neighborhood — container';root.add(container);
 const shared=std({color:'#d8cbb1'}),roof=std({color:'#70533b'}),houses=[];
 for(const [i,x] of [[1,0],[2,12],[3,24]]){const h=new THREE.Group();h.name='eden-house-'+i;h.position.x=x;const wall=new THREE.Mesh(g,shared);wall.name='plaster';const r=new THREE.Mesh(g,roof);r.name='roof';h.add(wall,r);container.add(h);houses.push(h);}
 const bench=new THREE.Group();bench.name='commons:bench';const seat=new THREE.Mesh(g,shared);seat.name='bench:timber';bench.add(seat);container.add(bench);
 const before=houses.map(h=>h.children.map(c=>c.geometry));applyWorldRealism(root,{buildings:true});
 const palettes=houses.map(h=>buildingPaletteOf(h.name));assert.ok(palettes.every(Boolean));assert.equal(new Set(palettes).size,3,'neighbours within 32 m differ');
 for(const h of houses){assert.notEqual(h.children[0].material,shared);assert.equal(realismClassOf(h.children[0].material),'plaster');}
 assert.notEqual(houses[0].children[0].material,houses[1].children[0].material);assert.deepEqual(houses.map(h=>h.children.map(c=>c.geometry)),before);
 assert.equal(seat.material,shared,'furniture keeps the shared material');
 const sh={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader,uniforms:{}};houses[0].children[0].material.onBeforeCompile(sh,{});
 assert.equal(sh.uniforms.edenStyle.value.x,1);assert.ok(sh.uniforms.edenPatA.value.isTexture);assert.equal(houses[0].children[0].material.customProgramCacheKey(),shared.customProgramCacheKey(),'clones share the one program');
 const kit=surfaceKit();assert.ok(kit.bytes<=16*1024*1024);assert.equal(kit.patternsA.image.width,512);assert.equal(kit.mural.image.width,1024);
 disposeBuildingIdentity();}
// Water: ripple finish keeps transparency/opacity exactly (front alpha is owned by readability recipes).
{const water=std({color:'#286a8d',transparent:true,opacity:.88,depthWrite:false}),mesh=new THREE.Mesh(g,water);mesh.name='Connected NEW lake/river water union';mesh.userData.cameraTransparent=true;const r=new THREE.Group();r.add(mesh);
 applyWorldRealism(r);assert.equal(realismClassOf(water),'water');assert.equal(water.opacity,.88);assert.equal(water.transparent,true);assert.equal(water.depthWrite,false);}
// Progressive texture generation: placeholders immediately, bounded slices, completes, deterministic content.
{const k=surfaceKit();let steps=0;while(!stepSurfaceKit(2)&&steps<100000)steps++;assert.ok(stepSurfaceKit(2));assert.ok(steps>1,'generation is sliced across calls');
 const a=k.patternsA.image.data;assert.ok(a.some(v=>v<40)&&a.some(v=>v>220),'brick joints and faces generated');}
console.log('PASS realism classification, in-place idempotent hook, shared program key, release/opt-out, actor/kin/floater exclusion, building identity, texture budget, progressive generation; NOT GPU/fps evidence');
