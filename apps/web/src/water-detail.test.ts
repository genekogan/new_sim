import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createConnectedNativeShore} from '../../../mars/viewer/app/engine-view/content/environment/connected-native-shore.ts';
import {waterMaterial,waterMesh} from './gen-mesh/water.ts';
import {WorldWaterDetail,WATER_DETAIL,SWIMMERS,findWaterRegions,patchUnderwaterBody,patchWaterSurface,waterUnder} from './WorldWaterDetail.ts';

const row=[-3.5,-3.5,-3.5,-3.5,-3.5,-3.5,-3.5,-3.5,-3.5,-3.5,-3.5,-3.5,-3.2,-2.9,-2.6,-2.3,-2,-1.87,-1.74,-1.6099999999999999,-1.48,-1.35,-1.22,-1.0899999999999999,-0.96,-0.8300000000000001,-0.7,-0.5700000000000001,-0.43999999999999995,-0.31000000000000005,-0.17999999999999994,-0.050000000000000044,0,0,0];
const shore=()=>createConnectedNativeShore({id:'commons-shore-terrain/1',diagonal:'min-min/max-max',originXZ:[-62,-12],spacingMetres:1,columns:35,rows:25,heightMetres:Array.from({length:25},()=>[...row])},{id:'commons-shore-water/1',datumY:-2,wetBoundsXZ:[-62,-12,-46,12]});
type Shader={vertexShader:string;fragmentShader:string;uniforms:Record<string,THREE.IUniform>};
const compile=(m:THREE.Material,lib?:keyof typeof THREE.ShaderLib):Shader=>{
 const src=lib?THREE.ShaderLib[lib]:{vertexShader:(m as THREE.ShaderMaterial).vertexShader,fragmentShader:(m as THREE.ShaderMaterial).fragmentShader,uniforms:(m as THREE.ShaderMaterial).uniforms};
 const s:Shader={vertexShader:src.vertexShader,fragmentShader:src.fragmentShader,uniforms:{...src.uniforms}};m.onBeforeCompile(s as never,{} as THREE.WebGLRenderer);return s;};

void test('old Eden shore water: one flat region at the exact datum, ripples and glitter injected, datum and geometry unchanged',()=>{
 const o=shore();o.group.updateMatrixWorld(true);const regions=findWaterRegions(o.group);
 assert.equal(regions.length,1);const r=regions[0];assert.equal(r.level,-2);assert.deepEqual([r.minX,r.minZ,r.maxX,r.maxZ],[-62,-12,-46,12]);
 const mesh=r.mesh as THREE.Mesh<THREE.BufferGeometry,THREE.ShaderMaterial>,before=mesh.geometry.getAttribute('position').array.slice();
 assert.equal(patchWaterSurface(mesh.material),'captured');assert.equal(patchWaterSurface(mesh.material),null);
 const s=compile(mesh.material);
 assert.match(s.fragmentShader,/vec3 waterSwim\(vec3 w\)/);assert.match(s.fragmentShader,/slope\+=edenSw\.xy;vec3 normal=/);assert.match(s.fragmentShader,/waterGlitter\(vWorld,normal,eye,uSwimTime\)/);
 assert.match(s.fragmentShader,/colour\*=mix/);assert.equal(s.uniforms.uSwim,WATER_DETAIL.uSwim);
 assert.deepEqual([...mesh.geometry.getAttribute('position').array],[...before]);assert.equal(mesh.material.uniforms.uBaseAlpha.value>0,true);
 assert.match(mesh.material.customProgramCacheKey(),/w11-surface-v1/);o.dispose();
});

void test('new-engine water material: ripples perturb the lit normal after its own waves, glitter before tone mapping',()=>{
 const g=new THREE.PlaneGeometry(20,20);g.rotateX(-Math.PI/2);const mesh=waterMesh(g,waterMaterial({color:'#123456'}),'entity-water');
 const root=new THREE.Group();root.add(mesh);root.updateMatrixWorld(true);
 const [r]=findWaterRegions(root);assert.ok(r);assert.ok(Math.abs(r.level)<1e-9);
 assert.equal(patchWaterSurface(mesh.material as THREE.Material),'standard');const s=compile(mesh.material as THREE.Material,'physical');
 const own=s.fragmentShader.indexOf('vec3 wn = normalize'),mine=s.fragmentShader.indexOf('vec3 edenSw=waterSwim(vWaterSurfW)');
 assert.ok(own>0&&mine>own,'swimmer slope follows the material\'s own wave normal');
 assert.ok(s.fragmentShader.indexOf('waterGlitter(vWaterSurfW')<s.fragmentShader.indexOf('#include <tonemapping_fragment>'));
 assert.match(s.vertexShader,/vWaterSurfW=\(modelMatrix\*edenWp\)\.xyz/);
});

void test('bodies: underwater fade is a per-material patch, below the level only, inside the water bounds only',()=>{
 const m=new THREE.MeshStandardMaterial();assert.equal(patchUnderwaterBody(m),true);assert.equal(patchUnderwaterBody(m),false);
 const s=compile(m,'physical');assert.match(s.fragmentShader,/float waterDepthAt\(vec3 w\)/);
 assert.ok(s.fragmentShader.indexOf('waterDepthAt(vWaterBodyW)')<s.fragmentShader.indexOf('#include <tonemapping_fragment>'));
 assert.match(s.vertexShader,/USE_INSTANCING[\s\S]*vWaterBodyW=/);assert.equal(patchUnderwaterBody(new THREE.ShaderMaterial()),false);
 const regions=[{minX:0,minZ:0,maxX:10,maxZ:10,level:-2}];
 assert.ok(waterUnder(regions,5,-2.6,5));assert.equal(waterUnder(regions,5,-1.5,5),null);assert.equal(waterUnder(regions,12,-2.6,5),null);
});

void test('swimmers: only recorded contact makes ripples; fixed slots; same displayed time gives the same water',()=>{
 const o=shore();const scene=new THREE.Scene();scene.add(o.group);scene.updateMatrixWorld(true);
 const camera=new THREE.PerspectiveCamera();camera.position.set(-40,4,0);
 const body=()=>{const g=new THREE.Group();g.add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial()));return g;};
 const souls=[
  {id:'tread',root:body(),p:[-55,-2.4,0] as const,activity:'tread'},
  {id:'walker',root:body(),p:[-30,0,0] as const,activity:'walk'},
  {id:'beach',root:body(),p:[-47,-1.9,3] as const,activity:'idle'},     // on the bank above the datum: no ripples
  {id:'wader',root:body(),p:[-50,-2.8,-4] as const,activity:'stand'},   // standing in the water: recorded contact
 ];
 const w=new WorldWaterDetail();w.update(scene,camera,souls,100,1,0);
 assert.equal(w.stats.regions,1);assert.equal(w.stats.surfaces,1);assert.equal(w.stats.swimmers,2);assert.equal(w.stats.bodies,2);
 const meta=WATER_DETAIL.uSwimMeta.value;assert.equal(meta.length,SWIMMERS);assert.deepEqual(meta.slice(0,2).map(v=>v.x),[-2,-2]);
 assert.ok(meta.slice(2).every(v=>v.z===0));
 const snap=()=>[WATER_DETAIL.uSwimTime.value,...WATER_DETAIL.uSwim.value.flatMap(v=>v.toArray())];
 const a=snap();w.update(scene,camera,souls,100,1,1);assert.deepEqual(snap(),a);
 // travelling: velocity follows displayed movement, bounded
 const moving=[{...souls[0],p:[-54,-2.4,0] as const}];w.update(scene,camera,moving,101,1,2);
 assert.ok(WATER_DETAIL.uSwim.value[0].z>0&&WATER_DETAIL.uSwim.value[0].z<=1);
 // many swimmers never exceed the fixed slots
 const crowd=Array.from({length:20},(_,i)=>({id:'s'+i,root:null,p:[-60+i*.5,-2.5,0] as const,activity:'swim'}));w.update(scene,camera,crowd,102,.2,3);
 assert.equal(w.stats.swimmers,SWIMMERS);assert.ok(WATER_DETAIL.uWaterTint.value.b<new THREE.Color('#1d5674').b);
 // nobody in the water: every slot empty
 w.update(scene,camera,[souls[1]],103,1,4);assert.equal(w.stats.swimmers,0);assert.ok(meta.every(v=>v.z===0));
 o.dispose();
});
