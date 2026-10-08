// Library clips (UAL1 Pro + UAL2, retargeted; clip-library.ts) on the three visitors: every mapped clip is in every GLB,
// and the placed bodies sit on their seat, lie on the ground, swim at the water surface, with no NaN anywhere.
// node apps/web/test/world-library-clips.cpu.mjs   (GLB_DIR=… to check another export)
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import*as THREE from 'three';import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const M=new URL('../../../mars/viewer/',import.meta.url).pathname;
{const {registerHooks,createRequire}=await import('node:module');const esbuild=createRequire(import.meta.url)(new URL('../../../node_modules/.pnpm/esbuild@0.28.1/node_modules/esbuild/lib/main.js',import.meta.url).pathname);
 registerHooks({resolve(spec,ctx,next){try{return next(spec,ctx);}catch(e){if(ctx.parentURL?.startsWith('file://'+M)&&spec.startsWith('.'))return next(spec+'.ts',ctx);throw e;}},load(url,ctx,next){if(url.startsWith('file://'+M)&&url.endsWith('.ts')){const src=readFileSync(new URL(url),'utf8');return {format:'module',source:esbuild.transformSync(src,{loader:'ts',format:'esm'}).code,shortCircuit:true};}return next(url,ctx);}});}
// loadTemplates fetches /modular/environment/…: serve those from the GLB directory
const DIR=process.env.GLB_DIR??M+'public/modular/environment/';
globalThis.location??={href:'http://local/'};
globalThis.fetch=async url=>{const name=String(url).split('/').pop().split('?')[0];const b=readFileSync(DIR+name);return new Response(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));};
const {loadTemplates}=await import(M+'app/engine-view/people.ts');
const {HumanViews}=await import(M+'app/engine-view/humans.ts');
const {libraryPick,pickClip}=await import(M+'app/engine-view/clip-library.ts');
const {ThreeResources}=await import(M+'lib/three-resources.ts');
const ts=await loadTemplates(new AbortController().signal,new ThreeResources());
// every clip the library can pick is present in every GLB
const ACTS=['idle','sit','sit-down','stand-up','sit-ground','lie','nap','dance','jump','cheer','nod','shake-head','pick-up','put-down','eat','drink','talk','listen','phone','plant','water','harvest','chop','fix','push','throw','open','tired'];
const want=new Set(['Jog_Fwd_Loop','Sprint_Loop','Idle_LookAround_Loop','Idle_FoldArms_Loop','Sitting_Talking_Loop','Sitting_Nodding_Loop','Sitting_Idle02_Loop','Swim_Fwd_Loop','Swim_Idle_Loop','LayToIdle']);
for(const a of ACTS)for(const seated of [false,true]){const p=libraryPick({activity:a,base:seated?'sit':'idle',seated,ground:a==='sit-ground',speaking:false,speed:0});if(p){want.add(p.clip);for(const c of p.alt??[])want.add(c);}}
for(const t of ts)for(const c of want){const ok=!!THREE.AnimationClip.findByName(t.gltf.animations,c);if(process.env.LAX&&!ok)console.log("missing",t.name,c);else assert.ok(ok,`${t.name} has ${c}`);}
assert.ok(ts.every(t=>t.jogSpeed>1.5&&t.jogSpeed<6),'jog speed measured: '+ts.map(t=>t.jogSpeed?.toFixed(2)));
// one body per (template, case), posed through the take path
const views=new HumanViews(false);views.setTemplates(ts);
const idFor=(name,base)=>{for(let k=0;k<500;k++){const id=`${base}-${k}`;let h=0;for(const ch of id)h=(h*31+ch.charCodeAt(0))>>>0;if(ts[h%ts.length].name===name)return id;}};
const shore=s=>({contract:'shore-contact/1',terrainId:'t',waterId:'w',mode:'buoyant',bedY:-2,datumY:0,depthMetres:2,submergedHeightMetres:s,normal:[0,1,0]});
const CASES={sit45:{activity:'sit',seatHeight:.45},sit70:{activity:'sit',seatHeight:.7},sitground:{activity:'sit-ground'},lie:{activity:'lie'},nap:{activity:'nap'},
 sleep:{activity:'sleep',sleepPose:{mat:'m',standingFraction:0}},swim:{activity:'swim',shore:shore(1.25)},tread:{activity:'tread',shore:shore(1.25)},dance:{activity:'dance'},hug:{activity:'hug'},read:{activity:'read',baseActivity:'sit',seatHeight:.45}};
const frame=[],ids={};let x=0;
for(const t of ts)for(const [k,c] of Object.entries(CASES)){const id=idFor(t.name,`${t.name}-${k}`);ids[`${t.name}/${k}`]=id;frame.push({id,p:[x+=4,0,0],yaw:.3,walk:0,walkDist:0,activityAge:2,...c});}
views.setFrame(frame,7.3);views.render(1);
const root=views.group,V=()=>new THREE.Vector3();
const holder=id=>root.getObjectByName(id);
const bone=(id,n)=>holder(id).getObjectByName(n).getWorldPosition(V());
const hipY=id=>(bone(id,'UpperLegL').y+bone(id,'UpperLegR').y)/2;
root.updateMatrixWorld(true);
// lowest skinned vertex of a body
const lowest=id=>{let lo=Infinity;const p=V();holder(id).traverse(o=>{if(!o.isSkinnedMesh)return;const pos=o.geometry.attributes.position;for(let i=0;i<pos.count;i+=3){o.getVertexPosition(i,p);o.localToWorld(p);lo=Math.min(lo,p.y);}});return lo;};
const out={},fails=[];const check=(ok,msg)=>{if(!ok)fails.push(msg);};
for(const t of ts){const g=k=>ids[`${t.name}/${k}`];
 holder(g('sit45')).traverse(o=>{if(o.isBone)assert.ok(o.matrixWorld.elements.every(Number.isFinite),'finite '+o.name);});
 const r={sit45:hipY(g('sit45')),sit70:hipY(g('sit70')),sitGroundLow:lowest(g('sitground')),lieLow:lowest(g('lie')),napLow:lowest(g('nap')),sleepLow:lowest(g('sleep')),swimHip:hipY(g('swim')),treadHead:bone(g('tread'),'Head').y,feetSit45:lowest(g('sit45'))};
 out[t.name]=Object.fromEntries(Object.entries(r).map(([k,v])=>[k,+v.toFixed(3)]));
 check(Math.abs(r.sit45-(.45+.09))<.04,t.name+' pelvis on a 0.45 seat: '+r.sit45);
 check(Math.abs(r.sit70-(.70+.09))<.04,t.name+' pelvis on a 0.70 seat: '+r.sit70);
 check(r.feetSit45>-.02,t.name+' seated feet not under the ground: '+r.feetSit45);
 for(const k of ['lieLow','napLow','sleepLow'])check(r[k]>-.01&&r[k]<.06,`${t.name} ${k} rests on the ground: ${r[k]}`);
 // layouts: lie = hips over the body point, head along −yaw; sleep on a mat = along +yaw, centred on the body point as the prone sleep pose was
 for(const [k,sleep] of [['lie',false],['sleep',true]]){const id=g(k),f=frame.find(q=>q.id===id),P=new THREE.Vector3(f.p[0],0,f.p[2]),fwd=new THREE.Vector3(Math.cos(f.yaw),0,Math.sin(f.yaw));
  const hip=bone(id,'UpperLegL').add(bone(id,'UpperLegR')).multiplyScalar(.5).setY(0),feet=bone(id,'FootL').add(bone(id,'FootR')).multiplyScalar(.5).setY(0),head=bone(id,'Head').setY(0);
  const dir=head.clone().sub(hip).normalize().dot(fwd);r[k+'HeadDot']=dir;
  if(sleep){const hd=head.clone().sub(P).dot(fwd);check(hd>.55&&hd<1.15,`${t.name} sleeper head where the prone sleep pose had it (0.83 m ahead): ${hd.toFixed(2)}`);check(dir>.8,`${t.name} sleeper head along +yaw: ${dir.toFixed(2)}`);}
  else{check(hip.distanceTo(P)<.25,`${t.name} lying hips over the body point: ${hip.distanceTo(P).toFixed(2)}`);check(dir<-.8,`${t.name} lying head along −yaw: ${dir.toFixed(2)}`);}}
 check(r.sitGroundLow>-.03&&r.sitGroundLow<.08,t.name+' sitting on the grass: '+r.sitGroundLow);
 check(r.swimHip>1.25-.2&&r.swimHip<1.25+.02,t.name+' swimmer hips at the surface: '+r.swimHip);
 check(r.treadHead>1.3&&r.treadHead<1.6,t.name+' treading head above the water: '+r.treadHead);
}
console.log(JSON.stringify(out));if(fails.length){console.log(fails.join('\n'));process.exit(1);}console.log('library clips cpu PASS');
