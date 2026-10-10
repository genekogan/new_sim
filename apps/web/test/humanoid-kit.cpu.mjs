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
const results={};const ok=(name,v,detail='')=>{assert.ok(v,name+' '+detail);results[name]=detail||true;console.log('ok',name,detail);};
// kit/look consistency
ok('palette slots agree',JSON.stringify(manifest.slots)===JSON.stringify(L.SLOTS));
for(const s of L.PART_SLOTS)ok(`def enum ${s} matches kit`,JSON.stringify(L.HUMANOID_PARAMS[s].values.filter(v=>v!=='bald'))===JSON.stringify(Object.keys(manifest.parts[s])),L.HUMANOID_PARAMS[s].values.join('/'));
const legacy={};
for(const n of ['casual','punk','woman']){const b=readFileSync(M+`public/modular/environment/animated-${n}.glb`);const g=await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'');applyHumanFinish(n,g.scene);legacy[n]=templateFromGltf(n,g);}
const joints=['Hips','Head','UpperArmL','WristL','WristR','FootL','FootR','LowerLegR','Middle2L'];
function pose(t,clip,time){const r=createRig(t);r.mixer.stopAllAction();const a=r.mixer.clipAction(THREE.AnimationClip.findByName(r.template.gltf.animations,clip));a.play();a.time=time;r.mixer.update(0);r.holder.updateMatrixWorld(true);
 return Object.fromEntries(joints.map(j=>[j,r.model.getObjectByName(j).getWorldPosition(new THREE.Vector3())]));}
const arm=(t)=>{const r=createRig(t);r.mixer.update(0.01);r.holder.updateMatrixWorld(true);const w=n=>r.model.getObjectByName(n).getWorldPosition(new THREE.Vector3());
 return ['L','R'].map(s=>{const sh=w('UpperArm'+s),el=w('LowerArm'+s),wr=w('Wrist'+s),mid=w('Middle2'+s),palm=wr.clone().add(mid.clone().sub(wr).multiplyScalar(.5));return sh.distanceTo(el)+el.distanceTo(palm);});};
for(const p of L.PRESETS){const t=await kit.template({preset:p});let worst=0,where='';
 for(const clip of ['Idle','Walk','Sitting_Idle_Loop','Jog_Fwd_Loop','PickUp_Table'])for(const time of [0,.37,.81]){const a=pose(t,clip,time),b=pose(legacy[p],clip,time);for(const j of joints){const d=a[j].distanceTo(b[j]);if(d>worst){worst=d;where=`${clip}@${time} ${j}`;}}}
 ok(`preset ${p}: joints match today's template within 1 mm`,worst<1e-3,`max ${(worst*1000).toFixed(3)} mm (${where})`);
 ok(`preset ${p}: walk speed matches`,Math.abs(t.walkSpeed-legacy[p].walkSpeed)<1e-3,`${t.walkSpeed.toFixed(4)} vs ${legacy[p].walkSpeed.toFixed(4)}`);
 const reach=arm(t);ok(`preset ${p}: arms reach the body model`,reach.every(v=>Math.abs(v-BODY_MODEL.armLength)<0.02),reach.map(v=>v.toFixed(4)).join('/'));
 ok(`preset ${p}: 51 clips`,t.gltf.animations.length===51);}
// cross-frame parts: the woman's look on the masc frame and the casual look on the fem frame stay on the body model
for(const [frame,p] of [['masc','woman'],['fem','casual'],['fem','punk']]){const look={...L.PRESET_LOOKS[p],frame};const t=await kit.template(look),reach=arm(t);
 const r=createRig(t);r.mixer.update(.01);r.holder.updateMatrixWorld(true);const sh=['UpperArmL','UpperArmR'].map(n=>r.model.getObjectByName(n).getWorldPosition(new THREE.Vector3()).y);
 ok(`${p} parts on ${frame} frame: shoulders at body model`,sh.every(y=>Math.abs(y-BODY_MODEL.shoulderHeight)<0.02),sh.map(v=>v.toFixed(4)).join('/'));
 ok(`${p} parts on ${frame} frame: palms within 2 cm`,reach.every(v=>Math.abs(v-BODY_MODEL.armLength)<0.02),reach.map(v=>v.toFixed(4)).join('/'));}
// budget: every frame × part × prop combination (pattern/colours don't change geometry)
let maxTris=0,maxLook='',n=0;const P=k=>L.HUMANOID_PARAMS[k].values;
for(const frame of P('frame'))for(const face of P('face'))for(const hair of P('hair'))for(const top of P('top'))for(const hat of P('hat'))for(const glasses of P('glasses'))for(const bag of P('bag')){
 const look={frame,face,hair,top,bottom:'ripped',shoes:'sneakers',hat,glasses,bag};const tris=await kit.tris(look);n++;if(tris>maxTris){maxTris=tris;maxLook=JSON.stringify(look);}}
ok('every combination ≤ 20k tris',maxTris<=20000,`${n} combinations, max ${maxTris} (${maxLook})`);
// material: one program, zero textures, finish hook reused
{const t=await kit.template(L.appearanceFromSeed(3));const mats=new Set();t.gltf.scene.traverse(o=>{if(o.isMesh)mats.add(o.material);});
 ok('one material per composed body',mats.size===1);const m=[...mats][0];ok('no textures',!m.map&&!m.normalMap&&!m.roughnessMap);
 const shader={vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.physical.fragmentShader,uniforms:{}};m.onBeforeCompile(shader);
 ok('finish.ts shader reused with per-vertex role',shader.fragmentShader.includes('varying float edenHumanRole')&&shader.fragmentShader.includes('hNoise')&&shader.vertexShader.includes('edenHumanRole=hinfo.y'));
 ok('program cache key shared',m.customProgramCacheKey()==='eden-humanoid2-v1');
 let draws=0;t.gltf.scene.traverse(o=>{if(o.isMesh)draws++;});ok('four draws per body',draws===4,String(draws));}
console.log(JSON.stringify({bytesFetched:kit.bytes,files:kit.files}));
