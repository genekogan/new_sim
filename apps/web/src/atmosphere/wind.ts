import * as THREE from 'three';
/** Wind sway for existing plants and hanging cloth, by material patch only.
 *
 * Found at runtime by name (never by editing their modules). Each eligible
 * material gets one vertex-stage displacement that reads ONE shared uniform
 * (time, strength, direction), so a frame costs one object write. Geometry,
 * bounds, transforms and raycast cost are untouched; with strength 0 the
 * displacement is exactly zero. A material is only patched when every mesh that
 * uses it is a plant / cloth (never shared with a building). */
export type WindMode='grass'|'crown'|'trunk'|'bunting'|'hang'|'belly'|'flag';
const CLOTH=new Set<WindMode>(['hang','belly','flag']);
const PARAMS:Record<'grass'|'crown'|'trunk',[number,number,number]>={
 // kLocal (per m² above piece base), kOrigin (per m of piece origin height), flutter (m)
 grass:[.2,0,.012],crown:[.011,.018,.018],trunk:[.0035,0,0],
};
/** Whole plants modelled from their root (local y = height above the root): trunk and crown share ONE
 * bend curve so crowns never detach from trunks, wherever the terrain puts the root. */
const ROOTED:Record<'grass'|'crown'|'trunk',[number,number,number]>={
 grass:[.2,0,.012],crown:[.012,0,.018],trunk:[.012,0,0],
};
const ORDER:WindMode[]=['trunk','crown','grass'];
// Merged world-space batches (their local height is height above the whole batch) and ground litter stay still.
const SKIP=/fallen|litter|static foliage|:static |greenhouse|interior|indoor|frame|trellis|planters?\b|\bpot\b|vase|box|\bbed\b|plot|ground|soil|stone|rock|path|hedge.*stems|roof garden.*bed/i;
export function windModeOf(path:string):WindMode|null{
 const p=path.toLowerCase();
 if(/(^|>\s*)bunting-flags$/.test(p))return'bunting';
 // Cloth other lanes may add with its own material: laundry hangs from a line, banners are held top and bottom, flags fly from a pole.
 const leaf=(p.split('>').pop()??p).trim(),rigid=/stone|roof|metal|iron|steel|corrugat|\btin\b/.test(leaf)||/(poles?|posts?|masts?|rails?|frames?|brackets?|pegs?|lines?)$/.test(leaf);
 if(!rigid&&/laundry|washing|clothes ?line|towel|sheet/.test(p))return'hang';
 if(!rigid&&/banner/.test(p))return'belly';
 if(!rigid&&/flag|pennant|windsock/.test(p))return'flag';
 if(SKIP.test(p))return null;
 const plantish=/tree|vegetation|forest|wood(land)?\b|orchard|palm|bamboo|grove|shrub|hedge|plant/.test(p);
 if(/stem:bark|trunk|branches|segmented closed stems/.test(p)||(/bark/.test(p)&&plantish))return'trunk';
 if(/bark|crown|canopy(?! foliage)/.test(p)&&!/foliage|leaf|leaves/.test(p))return null;
 if(/vegetation:(ball|cone)|leaf clusters|leaf masses|leaves|foliage|fronds|palm|clipped/.test(p))return'crown';
 if(/blade|grass|reed|fern|herb|flower|petal|bloom|stems|seedhead|bud|wetland|broadleaf|vegetation:stem|planter-leaves|meadow/.test(p))return'grass';
 return null;
}
/** Shared by every patched material: x time (s, wrapped), y strength, zw unit direction (xz). */
export const WIND={value:{x:0,y:0,z:1,w:0}};
const KEY='eden-atmos-wind-v2';
const HEAD=/* glsl */`
uniform vec4 uEdenWind;
uniform vec4 uEdenWindP;
`;
const BODY=/* glsl */`
vEdenGust=0.0;
{
 mat4 edenWM=modelMatrix;
 #ifdef USE_INSTANCING
  edenWM=modelMatrix*instanceMatrix;
 #endif
 float edenS=uEdenWind.y;
 if(edenS>0.0){
  vec3 edenO=edenWM[3].xyz;vec2 edenD=uEdenWind.zw;float edenT=uEdenWind.x;
  float edenSy=length(edenWM[1].xyz);
  float edenHL=max(transformed.y-uEdenWindP.w,0.0)*edenSy;
  float edenHO=clamp(edenO.y+2.5,0.0,14.0);
  float edenPh=dot(edenO.xz,vec2(.31,.17));
  // Gust fronts travel downwind across the world.
  float edenTr=dot(edenO.xz,edenD)*.05-edenT*1.1;
  float edenG=.5+.5*sin(edenTr)*sin(edenTr*.43+1.3);
  // Rolling gust waves read as a lighter sheen sweeping over grass and crowns.
  vEdenGust=edenS*(edenG-.45)*min(max(transformed.y-uEdenWindP.w,0.0)*edenSy*2.0+.3,1.0);
  float edenSw=edenS*(.55+.9*edenG*edenS)*(.7+.3*sin(edenT*1.6+edenPh)+.15*sin(edenT*2.9+edenPh*1.9));
  float edenB=uEdenWindP.x*edenHL*edenHL+uEdenWindP.y*edenHO;
  vec3 edenV=vec3(edenD.x,0.0,edenD.y)*edenSw*edenB;
  edenV.xz+=vec2(-edenD.y,edenD.x)*edenB*edenS*.3*sin(edenT*2.2+edenPh*1.3);
  vec3 edenWp=(edenWM*vec4(transformed,1.0)).xyz;
  // Flutter starts at the actual local piece root. Absolute terrain elevation
  // cannot move a blade's pinned base (including a root on a hill).
  edenV+=uEdenWindP.z*edenS*(.6+edenG)*vec3(sin(edenT*7.0+edenWp.x*3.1+edenWp.y*2.0),.5*sin(edenT*8.3+edenWp.z*2.7),cos(edenT*6.4+edenWp.z*3.3+edenWp.y*1.7))*min(edenHL,1.0);
  // world offset → local: column projections (exact for rotation×scale, close enough with mild shear)
  transformed+=vec3(dot(edenWM[0].xyz,edenV)/dot(edenWM[0].xyz,edenWM[0].xyz),dot(edenWM[1].xyz,edenV)/dot(edenWM[1].xyz,edenWM[1].xyz),dot(edenWM[2].xyz,edenV)/dot(edenWM[2].xyz,edenWM[2].xyz));
 }
}
`;
// Bunting: the third vertex of each triangle is the free (hanging) tip.
const BUNTING=/* glsl */`
{
 float edenS=uEdenWind.y;
 if(edenS>0.0&&gl_VertexID%3==2){
  vec2 edenD=uEdenWind.zw;float edenT=uEdenWind.x;
  vec3 edenWp=(modelMatrix*vec4(transformed,1.0)).xyz;float edenPh=dot(edenWp.xz,vec2(.9,.7));
  float edenTr=dot(edenWp.xz,edenD)*.05-edenT*1.1;float edenG=.5+.5*sin(edenTr)*sin(edenTr*.43+1.3);
  vec3 edenV=vec3(edenD.x,0.0,edenD.y)*(.06+.16*edenS*(.4+edenG))*edenS;
  edenV+=vec3(-edenD.y,0.0,edenD.x)*sin(edenT*(5.0+2.0*edenS)+edenPh)*(.03+.07*edenS);
  edenV.y+=length(edenV.xz)*.35;
  transformed+=vec3(dot(modelMatrix[0].xyz,edenV)/dot(modelMatrix[0].xyz,modelMatrix[0].xyz),dot(modelMatrix[1].xyz,edenV)/dot(modelMatrix[1].xyz,modelMatrix[1].xyz),dot(modelMatrix[2].xyz,edenV)/dot(modelMatrix[2].xyz,modelMatrix[2].xyz));
 }
}
`;
// Cloth: P = (minY, maxY, minX, maxX) of the local geometry; the pinned edge never moves.
const cloth=(mode:WindMode)=>/* glsl */`
{
 float edenS=uEdenWind.y;
 if(edenS>0.0){
  mat4 edenWM=modelMatrix;
  #ifdef USE_INSTANCING
   edenWM=modelMatrix*instanceMatrix;
  #endif
  vec2 edenD=uEdenWind.zw;float edenT=uEdenWind.x;vec3 edenWp=(edenWM*vec4(transformed,1.0)).xyz;
  float edenV=clamp((transformed.y-uEdenWindP.x)/max(uEdenWindP.y-uEdenWindP.x,1e-3),0.0,1.0);
  float edenU=clamp((transformed.x-uEdenWindP.z)/max(uEdenWindP.w-uEdenWindP.z,1e-3),0.0,1.0);
  float edenPin=${mode==='hang'?'1.0-edenV':mode==='belly'?'sin(3.14159*edenV)':'edenU'};
  float edenTr=dot(edenWp.xz,edenD)*.05-edenT*1.1;float edenG=.5+.5*sin(edenTr)*sin(edenTr*.43+1.3);
  float edenAmp=edenPin*(.04+.16*edenS*(.5+edenG));
  float edenWave=sin(edenT*(5.0+3.0*edenS)+dot(edenWp.xz,vec2(3.1,2.3))+transformed.y*4.0+transformed.x*3.0);
  vec3 edenOff=vec3(edenD.x,0.0,edenD.y)*edenAmp*(.55+.25*edenWave)+vec3(-edenD.y,0.0,edenD.x)*edenAmp*.45*edenWave;
  edenOff.y+=edenAmp*.25*max(edenWave,0.0);
  transformed+=vec3(dot(edenWM[0].xyz,edenOff)/dot(edenWM[0].xyz,edenWM[0].xyz),dot(edenWM[1].xyz,edenOff)/dot(edenWM[1].xyz,edenWM[1].xyz),dot(edenWM[2].xyz,edenOff)/dot(edenWM[2].xyz,edenWM[2].xyz));
 }
}
`;
type Patched={material:THREE.Material;onBeforeCompile:THREE.Material['onBeforeCompile'];key:THREE.Material['customProgramCacheKey'];mode:WindMode};
const BUILTIN=new Set(['MeshStandardMaterial','MeshPhysicalMaterial','MeshLambertMaterial','MeshPhongMaterial','MeshToonMaterial','MeshBasicMaterial']);
/** Owns the wind patches it installs; `scan` is idempotent and cheap to repeat every few seconds. */
export class WindPatches{
 private readonly patched=new Map<THREE.Material,Patched>();
 private readonly rejected=new WeakSet<THREE.Material>();
 private readonly firstSeen=new WeakMap<THREE.Material,number>();
 /** Walk `root` once; patch eligible materials. `settleScans`>0 defers newly seen materials to a later scan
  * (so another owner — surface realism — can install first; it refuses materials already hooked). */
 scan(root:THREE.Object3D,scanIndex:number,settleScans=0,skip?:(o:THREE.Object3D)=>boolean){
  const users=new Map<THREE.Material,{modes:Set<WindMode|null>;minY:number;indexed:boolean;box:THREE.Box3;pieces:boolean}>();
  const visit=(o:THREE.Object3D)=>{
   if(skip?.(o))return;
   const mesh=o as THREE.Mesh;
   if(mesh.isMesh&&!(o as THREE.SkinnedMesh).isSkinnedMesh){
    const path=(o.parent?.name??'')+' > '+o.name,candidate=windModeOf(path);
    // Merged world-space plants have many distinct roots baked into their
    // vertices. A single origin/base uniform cannot represent those anchors.
    const mode=o.userData.edenWindRooted===false&&candidate&&['grass','crown','trunk'].includes(candidate)?null:candidate;
    for(const m of ([] as THREE.Material[]).concat(mesh.material)){
     if(this.patched.has(m)||this.rejected.has(m))continue;
     let u=users.get(m);if(!u){u={modes:new Set(),minY:Infinity,indexed:false,box:new THREE.Box3(),pieces:false};users.set(m,u);}
     u.modes.add(mode);if(mesh.geometry.index)u.indexed=true;if(o.name.startsWith('vegetation:'))u.pieces=true;
     if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();u.minY=Math.min(u.minY,mesh.geometry.boundingBox!.min.y);u.box.union(mesh.geometry.boundingBox!);
    }
   }
   for(const c of o.children)visit(c);
  };
  visit(root);
  let added=0;
  for(const [m,u] of users){
   if(!this.firstSeen.has(m))this.firstSeen.set(m,scanIndex);
   if(scanIndex-this.firstSeen.get(m)!<settleScans)continue;
   if(u.modes.has(null)||!BUILTIN.has(m.type)){this.rejected.add(m);continue;}
   let mode:WindMode;
   if(u.modes.has('bunting')){if(u.modes.size>1||u.indexed){this.rejected.add(m);continue;}mode='bunting';}
   else if([...u.modes].some(k=>k!==null&&CLOTH.has(k))){if(u.modes.size>1){this.rejected.add(m);continue;}mode=[...u.modes][0]!;}
   else mode=ORDER.find(k=>u.modes.has(k))!;
   // Piece-built plants (VegetationViews: one instance per ball/stem) bend from each piece; others from the root.
   this.install(m,mode,u.pieces?(Number.isFinite(u.minY)?u.minY:0):0,u.box,!u.pieces);added++;
  }
  return added;
 }
 private install(material:THREE.Material,mode:WindMode,minY:number,box:THREE.Box3,rooted=false){
  const previous=material.onBeforeCompile,previousKey=material.customProgramCacheKey;
  const p=mode==='grass'||mode==='crown'||mode==='trunk'?(rooted?ROOTED:PARAMS)[mode]:[0,0,0];
  const params={value:CLOTH.has(mode)?{x:box.min.y,y:box.max.y,z:box.min.x,w:box.max.x}:{x:p[0],y:p[1],z:p[2],w:minY}};
  material.onBeforeCompile=function(shader,renderer){
   previous.call(this,shader,renderer);
   if(!shader.vertexShader.includes('#include <begin_vertex>'))return;
   shader.uniforms.uEdenWind=WIND;shader.uniforms.uEdenWindP=params;
   const plant=mode==='grass'||mode==='crown'||mode==='trunk';
   shader.vertexShader=HEAD+(plant?'varying float vEdenGust;\n':'')+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n'+(mode==='bunting'?BUNTING:CLOTH.has(mode)?cloth(mode):BODY));
   if(plant)shader.fragmentShader='varying float vEdenGust;\n'+shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.rgb*=1.0+vEdenGust*'+(mode==='grass'?'.32':mode==='crown'?'.12':'0.0')+';');
  };
  material.customProgramCacheKey=function(){return previousKey.call(this)+'|'+KEY+':'+mode;};
  material.needsUpdate=true;
  this.patched.set(material,{material,onBeforeCompile:previous,key:previousKey,mode});
 }
 get count(){return this.patched.size;}
 modes(){const out:Record<string,number>={};for(const p of this.patched.values())out[p.mode]=(out[p.mode]??0)+1;return out;}
 /** Restore every hook this owner installed (unless someone replaced it since). */
 dispose(){
  for(const p of this.patched.values()){p.material.onBeforeCompile=p.onBeforeCompile;p.material.customProgramCacheKey=p.key;p.material.needsUpdate=true;}
  this.patched.clear();
 }
}
