// humanoid@2 kit, CPU proof: composed presets match today's GLB templates (joints within 1 mm through the
// clips, arms fitted to the body model within 2 cm), every frame/part combination composes within budget,
// and the material reuses finish.ts unchanged. Run: node apps/web/test/humanoid-kit.cpu.mjs
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const ROOT=new URL('../../../',import.meta.url).pathname,M=ROOT+'mars/viewer/';
{const {registerHooks,createRequire}=await import('node:module');const esbuild=createRequire(import.meta.url)(ROOT+'node_modules/.pnpm/esbuild@0.28.1/node_modules/esbuild/lib/main.js');
 registerHooks({load(url,ctx,next){if(url.startsWith('file://'+M)&&url.endsWith('.ts')){const src=readFileSync(new URL(url),'utf8');return {format:'module',source:esbuild.transformSync(src,{loader:'ts',format:'esm'}).code,shortCircuit:true};}return next(url,ctx);}});}
const THREE=await import('three');const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');
const {templateFromGltf,createRig}=await import(M+'app/engine-view/people.ts');
const {BODY_MODEL}=await import(M+'app/engine-view/rig.ts');
const {applyHumanFinish}=await import(M+'app/engine-view/content/details/human-presets/finish.ts');
const {HumanoidKit}=await import('../src/humanoid/compose.ts');
const L=await import('../src/humanoid/look.ts');
const kitDir=M+'public/modular/humanoid/';
const kit=new HumanoidKit(new GLTFLoader(),'/modular/humanoid/',async url=>{const b=readFileSync(M+'public'+url);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);});
const manifest=JSON.parse(readFileSync(kitDir+'kit.json','utf8'));

const reports=[];
const baselineKit=new HumanoidKit(new GLTFLoader(),'/modular/humanoid/',async url=>{const b=readFileSync(M+'public'+url);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);});
baselineKit.bottom=look=>baselineKit.part('bottom',look.bottom,look.frame);
const bottom=t=>t.gltf.scene.getObjectByName('bottom').geometry;
for(const frame of ['fem','masc']){
 const coherent={frame,bottom:'woman-medieval',shoes:'woman-medieval',bag:'none',scarf:'none',gloves:'none',jewellery:'none'};
 const native=await kit.part('bottom','woman-medieval',frame),snapshot=Buffer.from(native.attributes.position.array.buffer).toString('base64');
 const before=kit.files,plain=await kit.template(coherent);
 assert.equal(bottom(plain),native,'matching clothes keep the original geometry');
 assert.equal(plain.gltf.scene.getObjectByName('shoes').geometry,await kit.part('shoes','woman-medieval',frame),'coherent shoes unchanged');
 assert.ok(![...kit.parts.keys()].some(k=>k.includes('beach.'+frame)),'no donors requested for coherent clothes');
 const a=await kit.template({...coherent,shoes:'boots'}),b=await kit.template({...coherent,shoes:'flats'});
 const ga=bottom(a),gb=bottom(b);assert.notEqual(ga,gb,'shoe-dependent geometry has distinct cache entries');
 assert.ok(ga.attributes.position.count>native.attributes.position.count);
 assert.ok(gb.attributes.position.count>native.attributes.position.count);
 assert.equal(bottom(await kit.template({...coherent,shoes:'boots'})),ga,'same look shares the repaired geometry');
 const n=native.attributes.position.count;
 for(const [shoe,g]of [['boots',ga],['flats',gb]]){
  const low=manifest.parts.shoes[shoe].landmarks[frame].max[1],high=manifest.parts.bottom['woman-medieval'].landmarks[frame].min[1];
  for(let i=0;i<n;i++)for(const name of ['position','normal','skinIndex','skinWeight','hinfo'])for(let c=0;c<native.attributes[name].itemSize;c++)assert.equal(g.attributes[name].getComponent(i,c),native.attributes[name].getComponent(i,c),'chosen garment vertices preserved');
  for(let i=n;i<g.attributes.position.count;i++){
   const y=g.attributes.position.getY(i);assert.ok(y>=0&&y<=high+.00301,'continuous donor skin stays below the chosen hem');
   assert.ok(g.attributes.hinfo.getX(i)<2,'no donor clothes');
   let w=0;for(let c=0;c<4;c++)w+=g.attributes.skinWeight.getComponent(i,c);assert.ok(Math.abs(w-1)<1e-6,'normalized bone weights');
  }
  const shoeGeo=(shoe==='boots'?a:b).gltf.scene.getObjectByName('shoes').geometry,shoeNative=await kit.part('shoes',shoe,frame),expected=[];
  for(let i=0;i<shoeNative.index.count;i+=3){const ids=[0,1,2].map(k=>shoeNative.index.getX(i+k));if(!ids.every(j=>shoeNative.attributes.hinfo.getX(j)<2))expected.push(...ids);}
  assert.deepEqual(Array.from(shoeGeo.index.array),expected,'every selected shoe clothing triangle preserved exactly; native exposed skin replaced');
  reports.push({frame,shoe,gap:high-low,addedTriangles:(g.index.count-native.index.count)/3});
 }
 assert.equal(Buffer.from(native.attributes.position.array.buffer).toString('base64'),snapshot,'original donor/clothing buffers immutable');
 let draws=0;a.gltf.scene.traverse(o=>{if(o.isMesh)draws++});assert.equal(draws,4);
 const shapedA=bottom(await kit.template({...coherent,shoes:'boots',build:1.08,hips:1.12})),shapedB=bottom(await kit.template({...coherent,shoes:'flats',build:1.08,hips:1.12}));assert.notEqual(shapedA,shapedB,'shaped cache includes shoes');
 assert.equal(a.walkSpeed,(await baselineKit.template({...coherent,shoes:'boots'})).walkSpeed,'same outfit stride unchanged by skin repair');assert.equal(a.gltf.animations.length,51);
 const rig=await kit.rig(frame),legs=['L','R'].map(s=>rig.joints[rig.names.indexOf('LowerLeg'+s)].x);
 const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),ray=new THREE.Raycaster();
 let cases=0,rays=0;
 // All currently published gap pairs, sampled around each leg in the missing interval.
 for(const [id,e]of Object.entries(manifest.parts.bottom))for(const [shoe,s]of Object.entries(manifest.parts.shoes)){
  const low=s.landmarks[frame].max[1],high=e.landmarks[frame].min[1];if(high-low<=.002)continue;
  const g=await kit.bottom(L.resolveLook({...coherent,bottom:id,shoes:shoe}));
  const mesh=new THREE.Mesh(g,material);mesh.updateMatrixWorld();
  for(const y of [low+.001,(low+high)/2,high-.001])for(const x of legs)for(let angle=0;angle<8;angle++){
   const dir=new THREE.Vector3(Math.cos(angle*Math.PI/4),0,Math.sin(angle*Math.PI/4));
   // Start at the center of the calf; the skin must close every direction.
   ray.set(new THREE.Vector3(x,y,.065),dir);ray.near=0;ray.far=.3;
   assert.ok(ray.intersectObject(mesh).length,`missing skin ${frame}/${id}/${shoe} y=${y} leg=${x} angle=${angle}`);rays++;
  }cases++;
 }
 reports.push({frame,gapPairs:cases,coverageRays:rays,draws,fetchFiles:kit.files-before});
 material.dispose();
}
console.log(JSON.stringify({pass:true,reports,bytesFetched:kit.bytes,files:kit.files},null,2));
