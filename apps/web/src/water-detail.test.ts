import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createConnectedNativeShore} from '../../../mars/viewer/app/engine-view/content/environment/connected-native-shore.ts';
import {waterMaterial,waterMesh} from './gen-mesh/water.ts';
import {fallingWaterMaterial} from './fx/water.ts';
import {installAtmosphereChunks,MIST} from './atmosphere/chunks.ts';
import {WorldWaterDetail,WATER_DETAIL,SWIMMERS,PHONE_SOURCES,underwaterAmount,findWaterRegions,patchUnderwaterBody,patchWaterSurface,waterUnder,markHeight} from './WorldWaterDetail.ts';

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
 assert.match(mesh.material.customProgramCacheKey(),/w11-surface-v2/);o.dispose();
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

void test('W5 fog: the still-water glint cap comes before the fog, so a far lake fades into rain and fog like the land',()=>{
 for(const flow of [0,0.7]){const s=compile(waterMaterial({flow}),'physical'),f=s.fragmentShader;
  const cap=f.indexOf('gl_FragColor.rgb = min(gl_FragColor.rgb'),fog=f.indexOf('#include <fog_fragment>');
  assert.ok(cap>0&&fog>cap,`cap before fog (flow ${flow})`);assert.ok(f.indexOf('#include <colorspace_fragment>')<cap);
  assert.equal(f.slice(f.indexOf('#include <dithering_fragment>')).includes('min(gl_FragColor'),false,'nothing clamps the fogged colour');}
});

void test('W5 fog: old Eden calm water and fountain sheets take the scene fog chunks and share the host fog uniforms',()=>{
 installAtmosphereChunks();
 const o=shore();o.group.updateMatrixWorld(true);const [r]=findWaterRegions(o.group);const m=r.mesh!.material as THREE.ShaderMaterial;
 for(const mat of [m,fallingWaterMaterial('sheet'),fallingWaterMaterial('spray')]){
  assert.equal(mat.fog,true);assert.ok(mat.uniforms.fogColor&&mat.uniforms.fogDensity,'fog uniforms');
  assert.match(mat.vertexShader,/vec4 mvPosition\s*=\s*viewMatrix\s*\*\s*w(orld)?;[\s\S]*#include <fog_vertex>/);assert.match(mat.vertexShader,/#include <fog_pars_vertex>/);
  assert.match(mat.fragmentShader,/#include <fog_pars_fragment>[\s\S]*gl_FragColor\s*=\s*vec4\([\s\S]*#include <fog_fragment>/);
  const s=compile(mat);assert.equal(s.uniforms.uEdenMist,MIST,'rain mist uniform is the shared one');}
 // the old scenes' captured shape the swimmer patch keys on is unchanged
 assert.match(m.fragmentShader,/gl_FragColor=vec4\(colour,/);assert.match(m.vertexShader,/vWorld/);o.dispose();
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
 const o=shore();const scene=new THREE.Scene();scene.add(o.group);
 // a wider, higher lake whose box covers the pond (as an Eden expansion lake's does): must not tint pond bodies
 const lake=new THREE.RingGeometry(25,60,32);lake.rotateX(-Math.PI/2);lake.translate(-54,0,0);const lakeMesh=new THREE.Mesh(lake,new THREE.MeshStandardMaterial({transparent:true}));lakeMesh.name='lake surface';scene.add(lakeMesh);
 scene.updateMatrixWorld(true);
 const camera=new THREE.PerspectiveCamera();camera.position.set(-40,4,0);camera.lookAt(-52,-2,0); // update() culls offscreen sources
 const body=()=>{const g=new THREE.Group();g.add(new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial()));return g;};
 const souls=[
  {id:'tread',root:body(),p:[-55,-2.4,0] as const,activity:'tread'},
  {id:'walker',root:body(),p:[-30,0,0] as const,activity:'walk'},
  {id:'beach',root:body(),p:[-47,-1.9,3] as const,activity:'idle'},     // on the bank above the datum: no ripples
  {id:'wader',root:body(),p:[-50,-2.8,-4] as const,activity:'stand'},   // standing in the water: recorded contact
 ];
 const w=new WorldWaterDetail();w.update(scene,camera,souls,100,1,0);
 assert.equal(w.stats.regions,2);assert.equal(w.stats.surfaces,1,'the lake waits for its realism pass');
 assert.deepEqual(WATER_DETAIL.uWaterLevel.value.map(v=>[v.x,v.y]),[[-2,1],[0,0],[0,0],[0,0],[0,0],[0,0]],'only the pond the swimmers are in');assert.equal(w.stats.swimmers,2);assert.equal(w.stats.bodies,2);
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

void test('ripple cost cap: boats afloat ripple too; phone keeps 3 sources and no shimmer; offscreen sources are culled',()=>{
 const o=shore();const scene=new THREE.Scene();scene.add(o.group);scene.updateMatrixWorld(true);
 const camera=new THREE.PerspectiveCamera();camera.position.set(-40,4,0);camera.lookAt(-52,-2,0);
 const boat=(x:number,z:number)=>{const g=new THREE.Group();g.position.set(x,-2,z);g.userData.boat={size:3};scene.add(g);return g;};
 const b1=boat(-56,4);scene.updateMatrixWorld(true);const afloat=new Set([b1]);
 const souls=Array.from({length:2},(_,i)=>({id:'s'+i,root:null,p:[-55+i,-2.5,-2] as const,activity:'swim'}));
 const w=new WorldWaterDetail();w.boats=afloat;w.update(scene,camera,souls,10,1,0);
 assert.equal(w.stats.swimmers,2);assert.equal(w.stats.boats,1);assert.equal(w.stats.culled,0);assert.equal(WATER_DETAIL.uSwimN.value,3);
 assert.equal(WATER_DETAIL.uWaterShimmer.value,1);assert.equal(WATER_DETAIL.uSwimMeta.value[2].z,.35,'a boat at rest only bobs');
 // looking away from the water: every source is culled, the loop runs no slot
 const away=new THREE.PerspectiveCamera();away.position.set(-40,4,0);away.lookAt(-20,4,0);w.update(scene,away,souls,10.5,1,.5);
 assert.equal(w.stats.culled,3);assert.equal(w.stats.swimmers+w.stats.boats,0);assert.equal(WATER_DETAIL.uSwimN.value,0);
 b1.position.x+=1;b1.updateMatrixWorld();w.update(scene,camera,souls,11,1,1);assert.equal(WATER_DETAIL.uSwimMeta.value[2].z,.8,'under way: stronger rings and a wake');
 // a crowd fills the desktop slots before any boat
 const crowd=Array.from({length:20},(_,i)=>({id:'c'+i,root:null,p:[-60+i*.5,-2.5,0] as const,activity:'swim'}));
 w.update(scene,camera,crowd,12,1,2);assert.equal(w.stats.swimmers,SWIMMERS);assert.equal(w.stats.boats,0);assert.equal(WATER_DETAIL.uSwimN.value,SWIMMERS);
 // phone tier: at most PHONE_SOURCES sources, Souls and boats together, and no shimmer/sheen/glitter
 const p=new WorldWaterDetail(()=>false,()=>true);p.boats=afloat;p.update(scene,camera,crowd,13,1,0);
 assert.equal(PHONE_SOURCES,3);assert.equal(WATER_DETAIL.uSwimN.value,3);assert.equal(p.stats.swimmers+p.stats.boats,3);
 assert.ok(WATER_DETAIL.uSwimMeta.value.slice(3).every(v=>v.z===0));assert.equal(WATER_DETAIL.uWaterShimmer.value,0);
 p.update(scene,camera,souls.slice(0,1),14,1,1);assert.equal(p.stats.swimmers,1);assert.equal(p.stats.boats,1);assert.equal(WATER_DETAIL.uSwimN.value,2);
 o.dispose();
});

void test('underwater fade: none above the surface, smooth ramp to full at UNDER_FULL metres, camera depth from the drawn water',()=>{
 assert.equal(underwaterAmount(0),0);assert.equal(underwaterAmount(-1),0);assert.equal(underwaterAmount(NaN),0);
 assert.ok(underwaterAmount(.3)>0&&underwaterAmount(.3)<underwaterAmount(1));assert.equal(underwaterAmount(2.2),1);assert.equal(underwaterAmount(9),1);
 const o=shore();const scene=new THREE.Scene();scene.add(o.group);scene.fog=new THREE.FogExp2(0xaabbcc,.01);scene.background=new THREE.Color(0x88aaff);scene.updateMatrixWorld(true);
 const camera=new THREE.PerspectiveCamera();camera.position.set(-55,-1,0);camera.lookAt(-50,-1,0);
 const w=new WorldWaterDetail();w.update(scene,camera,[],10,1,0);
 assert.equal(w.applyUnderwater(scene,camera),0);w.restoreUnderwater();assert.equal(scene.fog.density,.01);
 camera.position.y=-5;camera.updateMatrixWorld();assert.equal(w.cameraDepth(camera),3);
 assert.equal(w.applyUnderwater(scene,camera),1);assert.ok(scene.fog.density>.1);assert.notEqual(scene.background.getHex(),0x88aaff);
 // the atmosphere resets the density per camera inside the render (scene.onBeforeRender): the hook thickens it again
 scene.fog.density=.01;scene.onBeforeRender(null as never,scene,camera,null as never,null as never,null as never);assert.ok(scene.fog.density>.1);
 w.restoreUnderwater();assert.equal(scene.fog.density,.01);assert.equal(scene.fog.color.getHex(),0xaabbcc);
 scene.onBeforeRender(null as never,scene,camera,null as never,null as never,null as never);assert.equal(scene.fog.density,.01,'above water again: untouched');
 const before=scene.onBeforeRender;w.dispose();assert.notEqual(scene.onBeforeRender,before);assert.equal(scene.background.getHex(),0x88aaff);
 o.dispose();
});

void test('selection ring height: on the water surface over a swimmer whose root is under it, else the point itself',()=>{
 const regions=[{minX:0,minZ:0,maxX:10,maxZ:10,level:-2}];
 assert.equal(markHeight(regions,5,-3.2,5),-2);   // a duck's root 1.2 m under the surface: the ring lies on the water
 assert.equal(markHeight(regions,5,-1.5,5),-1.5); // on the bank above the water
 assert.equal(markHeight(regions,12,-3.2,5),-3.2);// outside the water
 assert.equal(markHeight([],5,-3.2,5),-3.2);      // ?water=0 scans no regions: unchanged
});
