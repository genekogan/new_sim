import * as THREE from 'three';
import {clone as cloneSkinned} from 'three/examples/jsm/utils/SkeletonUtils.js';
/** W3 fading visuals (edge §8). Presentation only, driven by Core's fading
 * state (C9): idle minutes per Soul, and the moment a Soul is beamed out or
 * reclaimed. Never moves simulation state: body motion is drawn on a ghost.
 *
 *  green (<30 min) → yellow (30) → red from 50 with gathering mist → beam at 60.
 *  Beam-up (Gene, WN3): a tall soft column of light gathers over the Soul for ~5 s; the body slowly reclines
 *  (3–5 s) and rises straight up at ~1.5 m/s to the top of the sky (~100 m, ~70 s), fading out only at the top;
 *  then the column fades. Core removes the body when the fade starts, so the layer keeps a GHOST: a frozen copy
 *  of the body (its last pose, own materials, lit like the world), snapshot while the Soul is red and refreshed
 *  every few seconds, or at the beam itself if the body is still there. Viewers who join mid-ascent see the
 *  column (no body to copy). Reclaim: the body falls from the sky onto its feet at its new starting place. */
export type FadingState={idleMinutes:number;beamedAt?:number;reclaimedAt?:number};
export const FADING=Object.freeze({yellowAt:30,redAt:50,beamAt:60,
 /** Whole beam-up sequence (s): column in, rise to the top, column out. */
 beamSeconds:74,beamIn:5,riseStart:2,riseSpeed:1.5,riseAccel:2,top:100,fadeFrom:78,reclineSeconds:4,recline:1.32,beamOpacity:.33,
 fallSeconds:1.3,fallHeight:14});
const GREEN=new THREE.Color('#5ee08a'),YELLOW=new THREE.Color('#ffd34d'),RED=new THREE.Color('#ff4d4d');
const sm=(a:number,b:number,x:number)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);};
/** Ring colour and mist amount for an idle time (pure, testable). */
export function fadingLook(idleMinutes:number,out=new THREE.Color()){
 const m=Math.max(0,idleMinutes);
 if(m<FADING.yellowAt)out.copy(GREEN).lerp(YELLOW,Math.max(0,(m-FADING.yellowAt+5)/5));
 else if(m<FADING.redAt)out.copy(YELLOW).lerp(RED,Math.max(0,(m-FADING.redAt+5)/5));
 else out.copy(RED);
 const mist=m<FADING.redAt?0:Math.min(1,(m-FADING.redAt)/(FADING.beamAt-FADING.redAt));
 return {colour:out,mist};
}
/** Height risen at t s into the beam: still until riseStart, easing up to riseSpeed over riseAccel s, then steady. */
export function beamLift(t:number){const u=t-FADING.riseStart,a=FADING.riseAccel,v=FADING.riseSpeed;if(u<=0)return 0;return Math.min(FADING.top,u<a?v*u*u/(2*a):v*(u-a/2));}
/** Seconds into the beam when the body reaches the top. */
export const BEAM_TOP_AT=FADING.riseStart+FADING.top/FADING.riseSpeed+FADING.riseAccel/2;
/** Body offset for beam-out / reclaim at time t (seconds since the event). `scale` is always 1: no shrinking. */
export function bodyMotion(kind:'beam'|'reclaim',t:number){
 if(kind==='beam'){const lift=beamLift(t);
  return {lift,tilt:-FADING.recline*sm(FADING.riseStart,FADING.riseStart+FADING.reclineSeconds,t),scale:1,
   opacity:1-sm(FADING.fadeFrom,FADING.top,lift),
   beam:sm(0,FADING.beamIn,t)*(1-sm(BEAM_TOP_AT,FADING.beamSeconds,t))};}
 const k=Math.min(1,Math.max(0,t/FADING.fallSeconds));return {lift:FADING.fallHeight*(1-k*k),tilt:0,scale:1,opacity:1,beam:0,landed:k>=1};
}
const BEAM_H=160;
const BEAM_VERT=/* glsl */`varying float vH;varying vec3 vN;varying vec3 vV;
void main(){vH=position.y/${BEAM_H.toFixed(1)};vec4 w=modelMatrix*vec4(position,1.0);vN=normalize(mat3(modelMatrix)*normal);vV=normalize(cameraPosition-w.xyz);gl_Position=projectionMatrix*viewMatrix*w;}`;
const BEAM_FRAG=/* glsl */`uniform vec4 uBeam; // x strength, y time
varying float vH;varying vec3 vN;varying vec3 vV;
void main(){float edge=pow(abs(dot(normalize(vN),normalize(vV))),1.4);
 // brightest low down, fading softly with height; faint bands of light drifting upward with the body
 float h=pow(1.0-clamp(vH,0.0,1.0),.7)*smoothstep(0.0,.004,vH);
 float bands=.82+.18*sin(vH*${BEAM_H.toFixed(1)}*.55-uBeam.y*1.5*.55);
 gl_FragColor=vec4(vec3(1.0,.95,.82)*edge*h*bands*uBeam.x,1.0);}`;
type Ghost={root:THREE.Object3D;base:THREE.Matrix4;feet:THREE.Vector3;forward:THREE.Vector3;materials:THREE.Material[];skeletons:THREE.Skeleton[];at:number};
type Entry={ring:THREE.Mesh;mist:THREE.Points;beam:THREE.Mesh;dust:THREE.Mesh;ghost:Ghost|null;feet:THREE.Vector3|null};
const SNAPSHOT_EVERY=8000;
/** Pooled per-Soul cues; add `group` to the scene (outside camera visibility roots). */
export class WorldFadingLayer{
 readonly group=new THREE.Group();
 private states=new Map<string,FadingState>();private entries=new Map<string,Entry>();
 private ringGeometry=new THREE.RingGeometry(.42,.55,40).rotateX(-Math.PI/2);
 private beamGeometry=new THREE.CylinderGeometry(1.5,.62,BEAM_H,24,1,true).translate(0,BEAM_H/2,0);
 private dustGeometry=new THREE.RingGeometry(.2,.6,32).rotateX(-Math.PI/2);
 private mistGeometry:THREE.BufferGeometry;
 private disposables:(THREE.BufferGeometry|THREE.Material|THREE.Texture)[]=[];
 private colour=new THREE.Color();
 /** Round soft-edged sprite so mist reads as haze, not squares (no DOM needed). */
 private puff=(()=>{const n=32,d=new Uint8Array(n*n*4);for(let j=0;j<n;j++)for(let i=0;i<n;i++){const r=Math.min(1,Math.hypot((i+.5)/n*2-1,(j+.5)/n*2-1));d.set([255,255,255,Math.round(255*Math.pow(1-r,1.8))],(j*n+i)*4);}const t=new THREE.DataTexture(d,n,n,THREE.RGBAFormat);t.magFilter=t.minFilter=THREE.LinearFilter;t.needsUpdate=true;return t;})();
 private hidden:THREE.Object3D[]=[];
 private readonly m=new THREE.Matrix4();private readonly r=new THREE.Matrix4();private readonly q=new THREE.Quaternion();private readonly v=new THREE.Vector3();private readonly axis=new THREE.Vector3();
 constructor(){
  this.group.name='fading-cues';this.group.renderOrder=997;
  const n=60,pts=new Float32Array(n*3);for(let i=0;i<n;i++){const a=i*2.399,r=.25+.5*((i*37)%11)/11;pts.set([Math.cos(a)*r,(i%13)/13*1.9,Math.sin(a)*r],i*3);}
  this.mistGeometry=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(pts,3));
  this.disposables.push(this.ringGeometry,this.beamGeometry,this.dustGeometry,this.mistGeometry,this.puff);
 }
 /** Replace the fading state from Core (or a dev override). Unknown Souls are cleared. */
 setStates(states:ReadonlyMap<string,FadingState>){this.states=new Map(states);for(const id of [...this.entries.keys()])if(!this.states.has(id))this.drop(id);}
 private entry(id:string):Entry{let e=this.entries.get(id);if(e)return e;
  const ringM=new THREE.MeshBasicMaterial({transparent:true,opacity:.85,depthWrite:false,side:THREE.DoubleSide}),mistM=new THREE.PointsMaterial({color:'#ffd9d9',size:.5,map:this.puff,alphaTest:.01,transparent:true,depthWrite:false,opacity:0}),
   beamM=new THREE.ShaderMaterial({vertexShader:BEAM_VERT,fragmentShader:BEAM_FRAG,uniforms:{uBeam:{value:new THREE.Vector4()}},transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,side:THREE.DoubleSide,fog:false}),
   dustM=new THREE.MeshBasicMaterial({color:'#d8cfbf',transparent:true,depthWrite:false,side:THREE.DoubleSide,opacity:0});
  e={ring:new THREE.Mesh(this.ringGeometry,ringM),mist:new THREE.Points(this.mistGeometry,mistM),beam:new THREE.Mesh(this.beamGeometry,beamM),dust:new THREE.Mesh(this.dustGeometry,dustM),ghost:null,feet:null};
  for(const o of [e.ring,e.mist,e.beam,e.dust]){o.frustumCulled=false;o.userData.cameraTransparent=true;o.raycast=()=>{};this.group.add(o);}e.beam.renderOrder=1e6+4;
  this.disposables.push(ringM,mistM,beamM,dustM);this.entries.set(id,e);return e;}
 private drop(id:string){const e=this.entries.get(id);if(!e)return;for(const o of [e.ring,e.mist,e.beam,e.dust]){this.group.remove(o);(o.material as THREE.Material).dispose();}this.dropGhost(e);this.entries.delete(id);}
 private dropGhost(e:Entry){const g=e.ghost;if(!g)return;g.root.removeFromParent();for(const m of g.materials)m.dispose();for(const s of g.skeletons)s.dispose();e.ghost=null;}
 /** Freeze a copy of the body as posed now (own materials so it can fade; shares geometry). */
 private snapshot(e:Entry,body:THREE.Object3D,feet:THREE.Vector3,nowMs:number){
  this.dropGhost(e);body.updateWorldMatrix(true,true);
  const root=cloneSkinned(body),materials:THREE.Material[]=[],skeletons:THREE.Skeleton[]=[];
  const strip:THREE.Object3D[]=[];
  root.traverse(o=>{if((o as {isCSS2DObject?:boolean}).isCSS2DObject){strip.push(o);return;}const mesh=o as THREE.Mesh;
   if(mesh.isMesh){mesh.material=Array.isArray(mesh.material)?mesh.material.map(m=>{const c=m.clone();c.userData.edenWas=[c.transparent,c.depthWrite];c.userData.edenOpacity=c.opacity;materials.push(c);return c;}):(()=>{const c=(mesh.material as THREE.Material).clone();c.userData.edenWas=[c.transparent,c.depthWrite];c.userData.edenOpacity=c.opacity;materials.push(c);return c;})();mesh.frustumCulled=false;mesh.castShadow=true;}
   if((o as THREE.SkinnedMesh).isSkinnedMesh)skeletons.push((o as THREE.SkinnedMesh).skeleton);o.raycast=()=>{};});
  for(const o of strip)o.removeFromParent();
  root.userData.cameraTransparent=true;root.name='beam ghost';root.matrixAutoUpdate=false;root.visible=false;
  const base=body.matrixWorld.clone(),forward=new THREE.Vector3(1,0,0).transformDirection(base).setY(0);if(forward.lengthSq()<1e-6)forward.set(1,0,0);forward.normalize();
  e.ghost={root,base,feet:feet.clone(),forward,materials,skeletons,at:nowMs};
 }
 /** Call once per frame before render. feet(id) → ground position; body(id) → rendered body root (hidden while its
  * ghost rises). nowMs = performance.now(). */
 update(nowMs:number,seconds:number,feet:(soulId:string)=>THREE.Vector3|null,body:(soulId:string)=>THREE.Object3D|null){
  for(const [id,s] of this.states){const e=this.entry(id),live=feet(id),b=body(id);
   if(live)e.feet=(e.feet??new THREE.Vector3()).copy(live);
   const p=live??e.feet;
   if(s.beamedAt!==undefined){
    const t=(nowMs-s.beamedAt)/1000,mo=bodyMotion('beam',t);e.ring.visible=false;e.mist.visible=false;e.dust.visible=false;
    // the body as it was at the beam (or the latest red snapshot), copied once
    if(b&&live&&t<FADING.riseStart+.5&&(!e.ghost||e.ghost.at<s.beamedAt))this.snapshot(e,b,live,nowMs);
    if(b){b.visible=false;this.hidden.push(b);}
    const g=e.ghost,at=g?.feet??p;
    if(g&&t<FADING.beamSeconds&&mo.opacity>.002){
     if(!g.root.parent)this.group.add(g.root);g.root.visible=true;
     // pivot ~1 m above the feet: recline (face to the sky) about the body's right axis, then lift straight up
     this.axis.crossVectors(g.forward,this.v.set(0,1,0)).normalize();this.q.setFromAxisAngle(this.axis,-mo.tilt);
     this.m.makeTranslation(g.feet.x,g.feet.y+1+mo.lift,g.feet.z).multiply(this.r.makeRotationFromQuaternion(this.q)).multiply(this.r.makeTranslation(-g.feet.x,-g.feet.y-1,-g.feet.z)).multiply(g.base);
     g.root.matrix.copy(this.m);g.root.matrixWorldNeedsUpdate=true;
     const fade=mo.opacity<.999;for(const mat of g.materials){const [wasT,wasD]=mat.userData.edenWas as [boolean,boolean],tr=fade||wasT;if(mat.transparent!==tr){mat.transparent=tr;mat.needsUpdate=true;}mat.opacity=(fade?mo.opacity:1)*(mat.userData.edenOpacity as number);mat.depthWrite=fade?false:wasD;}
    }else if(g)g.root.visible=false;
    e.beam.visible=mo.beam>.003&&!!at;if(e.beam.visible&&at){e.beam.position.copy(at);(e.beam.material as THREE.ShaderMaterial).uniforms.uBeam.value.set(FADING.beamOpacity*mo.beam,seconds%600,0,0);}
    continue;}
   if(!p){for(const o of [e.ring,e.mist,e.beam,e.dust])o.visible=false;continue;}
   const look=fadingLook(s.idleMinutes,this.colour);
   e.ring.visible=true;e.ring.position.set(p.x,p.y+.04,p.z);(e.ring.material as THREE.MeshBasicMaterial).color.copy(look.colour);
   const mistM=e.mist.material as THREE.PointsMaterial;e.mist.visible=look.mist>0;e.mist.position.set(p.x,p.y,p.z);e.mist.rotation.y=seconds*.25;mistM.opacity=.55*look.mist;
   // red: keep a recent copy of the body, so the beam can still show it after Core removes the body
   if(s.idleMinutes>=FADING.redAt&&b&&live&&(!e.ghost||nowMs-e.ghost.at>SNAPSHOT_EVERY))this.snapshot(e,b,live,nowMs);
   e.beam.visible=false;
   if(s.reclaimedAt!==undefined){const t=(nowMs-s.reclaimedAt)/1000,m=bodyMotion('reclaim',t);if(b){this.lifted.push({o:b,y:b.position.y});b.position.y+=m.lift;}const dust=e.dust.material as THREE.MeshBasicMaterial;
    const after=t-FADING.fallSeconds;e.dust.visible=after>0&&after<1;if(e.dust.visible){e.dust.position.set(p.x,p.y+.03,p.z);e.dust.scale.setScalar(1+after*2.5);dust.opacity=.7*(1-after);}}
  }
 }
 private lifted:{o:THREE.Object3D;y:number}[]=[];
 /** Undo this frame's render-time body changes (call right after renderer.render). */
 restore(){for(const o of this.hidden)o.visible=true;this.hidden.length=0;for(const t of this.lifted)t.o.position.y=t.y;this.lifted.length=0;}
 dispose(){this.restore();for(const id of [...this.entries.keys()])this.drop(id);this.group.removeFromParent();for(const d of this.disposables)d.dispose();this.group.clear();}
}
/** Souls beaming out at perf-clock `nowMs` (their labels and speech anchors are hidden from the start of the beam:
 * the body itself is drawn as a rising ghost). */
export function beamedOut(states:ReadonlyMap<string,FadingState>,nowMs:number):Set<string>{
 const out=new Set<string>();for(const [id,s] of states)if(s.beamedAt!==undefined&&nowMs>=s.beamedAt)out.add(id);return out;
}
/** Dev/preview override: `?fade=Alice:42,Bob:58,Carol:beam,Dan:reclaim` (names resolved by caller). */
export function parseFadeOverride(search:string):Map<string,string>{
 const raw=new URLSearchParams(search).get('fade');const out=new Map<string,string>();if(!raw)return out;
 for(const part of raw.split(',')){const [name,v]=part.split(':');if(name&&v)out.set(name.trim().toLowerCase(),v.trim());}return out;
}

/** Core's spectator `fade` messages → per-Soul fading state (latest wins).
 *  colour green/yellow/red/gone map to idle minutes; `removed` starts the beam, `reclaimed` the fall. */
export function fadingFromEdge(messages:readonly {kind:string;at:number;soulId?:unknown;colour?:unknown;change?:unknown;souls?:unknown}[],clock:(atMs:number)=>number):Map<string,FadingState>{
 let out=new Map<string,FadingState>();const minutes:Record<string,number>={green:0,yellow:FADING.yellowAt,red:FADING.redAt+5,gone:FADING.beamAt};
 for(const m of messages){
  // DLG1 standing roster (on join and every sweep): replaces the state; a Soul already gone stays beamed out
  // (its beam finished long ago) so a viewer that joined later never sees an absent Soul standing about.
  if(m.kind==='fade.roster'&&Array.isArray(m.souls)){const next=new Map<string,FadingState>();
   for(const r of m.souls as {soulId?:unknown;colour?:unknown;idleSeconds?:unknown}[]){if(!r||typeof r.soulId!=='string')continue;const prior=out.get(r.soulId);
    if(r.colour==='gone')next.set(r.soulId,prior?.beamedAt!==undefined?prior:{idleMinutes:FADING.beamAt,beamedAt:clock(m.at)-600_000});
    else if(r.colour==='yellow'||r.colour==='red')next.set(r.soulId,{idleMinutes:Math.max(minutes[String(r.colour)],Number(r.idleSeconds)/60||0)});}
   out=next;continue;}
  if(m.kind!=='fade'||typeof m.soulId!=='string')continue;const colour=String(m.colour);
  if(m.change==='reclaimed'){out.set(m.soulId,{idleMinutes:0,reclaimedAt:clock(m.at)});continue;}
  if(m.change==='removed'||colour==='gone'){out.set(m.soulId,{idleMinutes:FADING.beamAt,beamedAt:clock(m.at)});continue;}
  if(colour==='green'){out.delete(m.soulId);continue;}
  out.set(m.soulId,{idleMinutes:minutes[colour]??0});}
 return out;
}
