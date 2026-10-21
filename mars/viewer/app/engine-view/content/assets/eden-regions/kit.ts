import * as THREE from 'three';
import {validAuthoredBoundary,type AuthoredBoundaryBox} from '../../../../../lib/authored-boundaries.ts';
import {EDEN_ROOM_GLSL} from '../eden-window-interiors.ts';
/** Regions panes (merged facades, no pane coordinates): rooms on a 3.2 m × 2.9 m world grid behind each facade
 * plane; lit-tone panes (vertex colour) light up when their room's threshold is under the evening's lit fraction;
 * about a third carry a net curtain. Lamp heads share this material: they keep their plain warm glow. */
const REGION_ROOMS=`float edenLit=step(.035,vColor.r),edenLamp=step(.3,vColor.r),edenPane=edenLit-edenLamp;
{vec3 wp=vEdenNightWorld,nW=normalize(inverseTransformDirection(normal,viewMatrix)),vW=normalize(wp-cameraPosition);
 if(dot(nW,vW)>0.0)nW=-nW;
 float vertical=1.0-smoothstep(.35,.6,abs(nW.y));
 vec3 tW=normalize(vec3(-nW.z,0.0,nW.x)+vec3(1e-5,0.0,0.0));vec3 R=vec3(3.2,2.9,3.4);
 float along=dot(wp,tW),plane=dot(wp,nW);vec3 cell=vec3(floor(along/R.x),floor((wp.y+.35)/R.y),floor(plane*2.0+.5));
 float seed=edenRh(cell+vec3(17.0,3.0,5.0));
 vec3 o=vec3(along-cell.x*R.x,wp.y+.35-cell.y*R.y,0.0),d=vec3(dot(vW,tW),vW.y,dot(vW,-nW));
 float on=step(seed,uEdenWindows.x)*vertical;
 vec3 room=edenRoom(o,d,R,seed,uEdenWindows.y);
 if(fract(seed*19.3)<.35)room=mix(room,vec3(.95,.9,.8)*dot(room,vec3(.33))*1.25,.45*(.85+.15*sin(along*55.0)));
 vec3 warm=vec3(1.,.72,.38)*1.4;
 totalEmissiveRadiance+=(warm*edenLamp+edenPane*mix(mix(vec3(.01,.012,.018),room*1.3,on),warm,1.0-vertical))*uEdenNight.x;}`;
/** World Regions geometry kit: everything static is accumulated per shared
 * material (flat-shaded, vertex-coloured, non-indexed) and emitted as ONE mesh
 * per (region, material). Repeated organic parts (trees) are instanced. */
export type MatKey='dressing'|'plaster'|'timber'|'stone'|'roof'|'glass'|'foliage'|'bark'|'path'|'ground'|'metal'|'cloth'|'flower'|'water'|'soil';
const MAT_NAMES:Record<MatKey,string>={dressing:'Regions small dressing (see-through)',plaster:'Regions plaster stucco wall',timber:'Regions timber boards',stone:'Regions stone masonry',roof:'Regions roof tile',glass:'Regions window glass',foliage:'Regions foliage canopy',bark:'Regions tree trunk bark',path:'Regions path appearance',ground:'Regions cosmetic ground terrain',metal:'Regions painted metal',cloth:'Regions fabric awning',flower:'Regions flower blossom',water:'Regions water surface',soil:'Regions tilled soil'};
export class Materials{
 readonly all=new Map<MatKey,THREE.MeshStandardMaterial>();
 get(k:MatKey){let m=this.all.get(k);if(m)return m;
  const base:THREE.MeshStandardMaterialParameters={vertexColors:true,roughness:k==='glass'?.25:k==='metal'?.5:k==='dressing'?.7:.92,metalness:k==='glass'?.25:k==='metal'?.35:k==='dressing'?.1:0,side:THREE.DoubleSide};
  if(k==='water')Object.assign(base,{transparent:true,opacity:.82,roughness:.12,metalness:.05,side:THREE.DoubleSide,depthWrite:false});
  m=new THREE.MeshStandardMaterial(base);m.name=MAT_NAMES[k];this.all.set(k,m);return m;}
 readonly inst=new Map<MatKey,THREE.MeshStandardMaterial>();
 /** Instanced variant (colour from instanceColor, no vertex colours). */
 instanced(k:MatKey){let m=this.inst.get(k);if(!m){m=new THREE.MeshStandardMaterial({roughness:.92,side:THREE.DoubleSide});m.name=MAT_NAMES[k]+' instanced';this.inst.set(k,m);}return m;}
 /** Window glass that glows warm at night: reads the shared Eden night uniform when the viewer installed it
  * (no-op otherwise). Lit panes are the lighter glass tone (and lamp heads); darker panes stay dark. */
 windows(){let m=this.all.get('glass');if(m&&m.userData.night)return m;m=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.25,metalness:.25,side:THREE.DoubleSide});m.name='Regions window glass (night-lit)';m.userData.night=true;
  // Glass reads as glass by day: a Fresnel sky/ground reflection (no env map, no texture), fading out at night.
  m.onBeforeCompile=sh=>{const night=!!sh.uniforms.uEdenNight,rooms=night&&!!sh.uniforms.uEdenWindows;
   if(rooms)sh.fragmentShader=sh.fragmentShader.replace('void main() {','uniform vec4 uEdenWindows;\n'+EDEN_ROOM_GLSL+'\nvoid main() {');
   sh.fragmentShader=sh.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\n'+
   '{vec3 gV=normalize(vViewPosition),gR=inverseTransformDirection(reflect(-gV,normal),viewMatrix);float gF=.1+.55*pow(1.-clamp(abs(dot(normal,gV)),0.,1.),4.);'+
   'vec3 gSky=mix(vec3(.3,.31,.28),mix(vec3(.66,.74,.8),vec3(.5,.62,.78),smoothstep(.2,.8,gR.y)),smoothstep(-.12,.1,gR.y));totalEmissiveRadiance+=gSky*gF*'+(night?'(1.-uEdenNight.x)':'1.')+';}'+
   (rooms?'\n'+REGION_ROOMS:night?'\n float edenLit=step(.035,vColor.r);totalEmissiveRadiance+=vec3(1.,.72,.38)*edenLit*uEdenNight.x*1.4;':''));};
  m.customProgramCacheKey=()=>'eden-regions-night-windows-v3';this.all.set('glass',m);return m;}
 dispose(){for(const m of [...this.all.values(),...this.inst.values()])m.dispose();this.all.clear();this.inst.clear();}
}
const _a=new THREE.Vector3(),_b=new THREE.Vector3(),_c=new THREE.Vector3(),_n=new THREE.Vector3(),_e1=new THREE.Vector3(),_e2=new THREE.Vector3();
export type Col=THREE.Color|string|number;
// One parsed Color per string/number (tri() only reads r,g,b): a district parsed the same CSS colour for every triangle.
const COLS=new Map<string|number,THREE.Color>();
const col=(c:Col)=>{if(c instanceof THREE.Color)return c;let v=COLS.get(c);if(!v)COLS.set(c,v=new THREE.Color(c));return v;};
/** Thin/flat dressing that never blocks a camera sightline (walls/roofs/stone/timber stay opaque). */
export const SEE_THROUGH:readonly MatKey[]=['glass','path','flower','cloth','metal','soil','water','foliage'];
/** Per-material triangle soup with a transform stack. */
type Buf={p:number[];n:number[];c:number[]};
/** Appends triangle t (9 floats each of position, normal, colour) of A to B. */
function moveTri(A:Buf,B:Buf,t:number){const p=A.p,n=A.n,c=A.c;
 B.p.push(p[t],p[t+1],p[t+2],p[t+3],p[t+4],p[t+5],p[t+6],p[t+7],p[t+8]);B.n.push(n[t],n[t+1],n[t+2],n[t+3],n[t+4],n[t+5],n[t+6],n[t+7],n[t+8]);B.c.push(c[t],c[t+1],c[t+2],c[t+3],c[t+4],c[t+5],c[t+6],c[t+7],c[t+8]);}
export class Builder{
 readonly authoring:'authored'|'legacy'|'decorative';
 private drawingAuthored=false;
 constructor(authoring:'authored'|'legacy'|'decorative'='authored'){this.authoring=authoring;}
 readonly boundaries:AuthoredBoundaryBox[]=[];
 readonly buf=new Map<MatKey,{p:number[];n:number[];c:number[]}>();
 m=new THREE.Matrix4();private stack:THREE.Matrix4[]=[];
 push(x:number,y:number,z:number,yaw=0,s=1){this.stack.push(this.m.clone());const t=new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw),new THREE.Vector3(s,s,s));this.m.multiply(t);return this;}
 pushM(t:THREE.Matrix4){this.stack.push(this.m.clone());this.m.multiply(t);return this;}
 pop(){this.m=this.stack.pop()!;return this;}
 /** Capture the exact authored prism beside its draw. Never infer a collider
  * from a mesh name, foundation, floor or a merged district bounding box. */
 boundary(kind:'wall'|'guard',cx:number,y0:number,cz:number,sx:number,sy:number,sz:number,buildingId:string,partId:string):void{
  const e=this.m.elements,scaleX=Math.hypot(e[0],e[2]),scaleY=Math.abs(e[5]),scaleZ=Math.hypot(e[8],e[10]);
  if(Math.max(Math.abs(e[1]),Math.abs(e[4]),Math.abs(e[6]),Math.abs(e[9]))>1e-8||e[5]<=0||Math.abs(e[0]*e[8]+e[2]*e[10])>1e-8)throw Error('authored-boundary.requires-upright-orthogonal-frame');
  const p=new THREE.Vector3(cx,y0+sy/2,cz).applyMatrix4(this.m),b:AuthoredBoundaryBox={id:buildingId+':'+partId,buildingId,kind,c:p.toArray() as [number,number,number],half:[sx*scaleX/2,sy*scaleY/2,sz*scaleZ/2],yaw:Math.atan2(e[2],e[0])};
  if(!validAuthoredBoundary(b))throw Error('authored-boundary.invalid-prism');this.boundaries.push(b);
 }
 /** Future authored prisms have one draw/collision definition. Solid is the
  * default; decorative opt-out is explicit and retained in the source pin.
  * Legacy box() stays geometry-only until its author selects this contract. */
 authoredBox(k:MatKey,cx:number,y0:number,cz:number,sx:number,sy:number,sz:number,color:Col,buildingId:string,partId:string,kind:'wall'|'guard'='wall',collision:'solid'|'decorative'='solid'){
  this.boundary(kind,cx,y0,cz,sx,sy,sz,buildingId,partId);this.boundaries[this.boundaries.length-1].collision=collision;
  this.drawingAuthored=true;try{this.box(k,cx,y0,cz,sx,sy,sz,color);}finally{this.drawingAuthored=false;}
 }
 /** Push a rotation about local x or z (tilted parts: see-saws, wheels, hay bales). */
 pushRot(axis:'x'|'z',angle:number){return this.pushM(axis==='x'?new THREE.Matrix4().makeRotationX(angle):new THREE.Matrix4().makeRotationZ(angle));}
 b(k:MatKey){let b=this.buf.get(k);if(!b)this.buf.set(k,b={p:[],n:[],c:[]});return b;}
 tri(k:MatKey,a:number[],b:number[],c:number[],color:Col){if(this.authoring==='authored'&&!this.drawingAuthored)throw Error('authored-geometry.requires-authoredBox-or-explicit-legacy/decorative');const B=this.b(k),C=col(color);_a.fromArray(a).applyMatrix4(this.m);_b.fromArray(b).applyMatrix4(this.m);_c.fromArray(c).applyMatrix4(this.m);
  _e1.subVectors(_b,_a);_e2.subVectors(_c,_a);_n.crossVectors(_e1,_e2);if(_n.lengthSq()<1e-14)return;_n.normalize();
  B.p.push(_a.x,_a.y,_a.z,_b.x,_b.y,_b.z,_c.x,_c.y,_c.z);const nx=_n.x,ny=_n.y,nz=_n.z,r=C.r,g=C.g,bl=C.b;B.n.push(nx,ny,nz,nx,ny,nz,nx,ny,nz);B.c.push(r,g,bl,r,g,bl,r,g,bl);}
 quad(k:MatKey,a:number[],b:number[],c:number[],d:number[],color:Col){this.tri(k,a,b,c,color);this.tri(k,a,c,d,color);}
 /** Axis-aligned (local) box from min corner extents. bottom=false skips the underside. */
 box(k:MatKey,cx:number,y0:number,cz:number,sx:number,sy:number,sz:number,color:Col,bottom=false){const x0=cx-sx/2,x1=cx+sx/2,z0=cz-sz/2,z1=cz+sz/2,y1=y0+sy;
  this.quad(k,[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1],color);this.quad(k,[x1,y0,z0],[x0,y0,z0],[x0,y1,z0],[x1,y1,z0],color);
  this.quad(k,[x1,y0,z1],[x1,y0,z0],[x1,y1,z0],[x1,y1,z1],color);this.quad(k,[x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0],color);
  this.quad(k,[x0,y1,z1],[x1,y1,z1],[x1,y1,z0],[x0,y1,z0],color);if(bottom)this.quad(k,[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1],color);}
 /** Gable roof: ridge along local x, eaves at y0, ridge at y0+h, footprint w×d plus overhang o. Gable ends in wall material. */
 gable(k:MatKey,cx:number,y0:number,cz:number,w:number,d:number,h:number,color:Col,wallK:MatKey|null,wallColor:Col,o=.35){const x0=cx-w/2-o,x1=cx+w/2+o,z0=cz-d/2-o,z1=cz+d/2+o,yr=y0+h,dy=h*o/(d/2);
  this.quad(k,[x0,y0-dy,z1],[x1,y0-dy,z1],[x1,yr,cz],[x0,yr,cz],color);this.quad(k,[x1,y0-dy,z0],[x0,y0-dy,z0],[x0,yr,cz],[x1,yr,cz],color);
  if(wallK){const gx0=cx-w/2,gx1=cx+w/2;this.tri(wallK,[gx1,y0,cz+d/2],[gx1,y0,cz-d/2],[gx1,yr-.02,cz],wallColor);this.tri(wallK,[gx0,y0,cz-d/2],[gx0,y0,cz+d/2],[gx0,yr-.02,cz],wallColor);}}
 /** Hip roof (pyramid when ridge=0). */
 hip(k:MatKey,cx:number,y0:number,cz:number,w:number,d:number,h:number,color:Col,o=.35,ridge=-1){const x0=cx-w/2-o,x1=cx+w/2+o,z0=cz-d/2-o,z1=cz+d/2+o,yr=y0+h;const r=ridge<0?Math.max(0,(w-d)/2):ridge;
  const ra=[cx-r,yr,cz],rb=[cx+r,yr,cz];this.quad(k,[x0,y0,z1],[x1,y0,z1],rb,ra,color);this.quad(k,[x1,y0,z0],[x0,y0,z0],ra,rb,color);this.tri(k,[x1,y0,z1],[x1,y0,z0],rb,color);this.tri(k,[x0,y0,z0],[x0,y0,z1],ra,color);}
 /** Mono-pitch (shed) roof sloping down toward +z. */
 shed(k:MatKey,cx:number,y0:number,cz:number,w:number,d:number,h:number,color:Col,o=.3){const x0=cx-w/2-o,x1=cx+w/2+o,z0=cz-d/2-o,z1=cz+d/2+o;this.quad(k,[x0,y0,z1],[x1,y0,z1],[x1,y0+h,z0],[x0,y0+h,z0],color);
  this.box(k,cx,y0+h-.05,z0+.03,w+2*o,.12,.08,color);}
 cyl(k:MatKey,cx:number,y0:number,cz:number,r:number,h:number,seg:number,color:Col,cap=true,r2=r){for(let i=0;i<seg;i++){const a=i/seg*Math.PI*2,b=(i+1)/seg*Math.PI*2,ca=Math.cos(a),sa=Math.sin(a),cb=Math.cos(b),sb=Math.sin(b);
  this.quad(k,[cx+ca*r,y0,cz+sa*r],[cx+cb*r,y0,cz+sb*r],[cx+cb*r2,y0+h,cz+sb*r2],[cx+ca*r2,y0+h,cz+sa*r2],color);if(cap&&r2>0)this.tri(k,[cx,y0+h,cz],[cx+cb*r2,y0+h,cz+sb*r2],[cx+ca*r2,y0+h,cz+sa*r2],color);}}
 cone(k:MatKey,cx:number,y0:number,cz:number,r:number,h:number,seg:number,color:Col){for(let i=0;i<seg;i++){const a=i/seg*Math.PI*2,b=(i+1)/seg*Math.PI*2;this.tri(k,[cx+Math.cos(a)*r,y0,cz+Math.sin(a)*r],[cx+Math.cos(b)*r,y0,cz+Math.sin(b)*r],[cx,y0+h,cz],color);}}
 dome(k:MatKey,cx:number,y0:number,cz:number,r:number,seg:number,rings:number,color:Col,hScale=1){for(let j=0;j<rings;j++){const p0=j/rings*Math.PI/2,p1=(j+1)/rings*Math.PI/2;for(let i=0;i<seg;i++){const a=i/seg*Math.PI*2,b=(i+1)/seg*Math.PI*2;
  const P=(t:number,p:number)=>[cx+Math.cos(t)*Math.cos(p)*r,y0+Math.sin(p)*r*hScale,cz+Math.sin(t)*Math.cos(p)*r];if(j===rings-1)this.tri(k,P(a,p0),P(b,p0),[cx,y0+r*hScale,cz],color);else this.quad(k,P(a,p0),P(b,p0),P(b,p1),P(a,p1),color);}}}
 /** Vertical rectangle facing +z (window/door panel), centred at x,y on plane z. */
 panel(k:MatKey,x:number,y:number,z:number,w:number,h:number,color:Col,face=1){this.quad(k,[x-w/2*face,y-h/2,z],[x+w/2*face,y-h/2,z],[x+w/2*face,y+h/2,z],[x-w/2*face,y+h/2,z],color);}
 /** Flat horizontal polygon (fan) at given y. */
 disc(k:MatKey,cx:number,y:number,cz:number,r:number,seg:number,color:Col){for(let i=0;i<seg;i++){const a=i/seg*Math.PI*2,b=(i+1)/seg*Math.PI*2;this.tri(k,[cx,y,cz],[cx+Math.cos(b)*r,y,cz+Math.sin(b)*r],[cx+Math.cos(a)*r,y,cz+Math.sin(a)*r],color);}}
 /** Moves every triangle to the builder chosen by its centroid (glass to the windows sink, far parts to the
  * distant sink, the rest to its sector) so many small districts share a few draws and ray objects. */
  drain(route:(cx:number,cz:number,k:MatKey)=>Builder){for(const [k,B] of this.buf){const p=B.p;for(let t=0;t<p.length;t+=9){const T=route((p[t]+p[t+3]+p[t+6])/3,(p[t+2]+p[t+5]+p[t+8])/3,k).b(k);moveTri(B,T,t);}}this.buf.clear();for(const b of this.boundaries)route(b.c[0],b.c[2],b.kind==='guard'?'metal':'stone').boundaries.push(b);this.boundaries.length=0;}
 /** Emits one mesh per material into group; returns triangle count. */
 emit(group:THREE.Group,mats:Materials,name:string,geos:THREE.BufferGeometry[],opts:{transparent?:MatKey[];splitX?:number;far?:(x:number,z:number)=>boolean;farSink?:Builder;allClear?:boolean;glassSink?:Builder}={}){let tris=0;
  group.userData.edenAuthoredBoundaries=[...(group.userData.edenAuthoredBoundaries??[]),...this.boundaries.map(b=>({...b,c:[...b.c],half:[...b.half]}))];
  group.userData.edenGeometryAuthoring=this.authoring;
  // All window glass (and lamp heads) goes to one shared night-lit draw.
  if(opts.glassSink){const B=this.buf.get('glass');if(B){const G=opts.glassSink.b('glass');for(let i=0;i<B.p.length;i++){G.p.push(B.p[i]);G.n.push(B.n[i]);G.c.push(B.c[i]);}this.buf.delete('glass');}}
  // Far triangles (that can never stand between a Broadcast camera and a subject) move to a shared sink that is
  // emitted once for all districts, camera-transparent; the rest may split by x to keep bounding spheres local.
  if(opts.far&&opts.farSink){for(const [k,B] of this.buf){if(k==='water')continue;const keep={p:[] as number[],n:[] as number[],c:[] as number[]},F=opts.farSink.b(k);
    for(let t=0;t<B.p.length;t+=9){const cx=(B.p[t]+B.p[t+3]+B.p[t+6])/3,cz=(B.p[t+2]+B.p[t+5]+B.p[t+8])/3,T=opts.far(cx,cz)?F:keep;moveTri(B,T,t);}
    this.buf.set(k,keep);}}
  // Small see-through dressing (glass, metal, cloth, flowers, beds, paths) shares one draw: it never gets realism finishes anyway.
  const d=this.buf.get('dressing')??{p:[] as number[],n:[] as number[],c:[] as number[]};for(const k of SEE_THROUGH){if(k==='water')continue;const B=this.buf.get(k);if(!B)continue;for(let i=0;i<B.p.length;i++){d.p.push(B.p[i]);d.n.push(B.n[i]);d.c.push(B.c[i]);}this.buf.delete(k);}
  if(d.p.length)this.buf.set('dressing',d);
  const parts:[MatKey,{p:number[];n:number[];c:number[]},string][]=[];
  for(const [k,B] of this.buf){if(opts.splitX===undefined||k==='dressing'||k==='water'){parts.push([k,B,'']);continue;}const A={p:[] as number[],n:[] as number[],c:[] as number[]},C={p:[] as number[],n:[] as number[],c:[] as number[]};
   for(let t=0;t<B.p.length;t+=9){const T=(B.p[t]+B.p[t+3]+B.p[t+6])/3<opts.splitX?A:C;moveTri(B,T,t);}parts.push([k,A,' west'],[k,C,' east']);}
  for(const [k,B,suffix] of parts){if(!B.p.length)continue;const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(B.p,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(B.n,3));g.setAttribute('color',new THREE.Float32BufferAttribute(B.c,3));g.computeBoundingBox();g.computeBoundingSphere();geos.push(g);
   const mesh=new THREE.Mesh(g,mats.get(k));mesh.name=name+' / '+mats.get(k).name.replace('Regions ','')+suffix;mesh.receiveShadow=k!=='glass'&&k!=='water';mesh.castShadow=false;mesh.userData.edenWindRooted=false;
   if(opts.allClear||k==='dressing'||(opts.transparent??SEE_THROUGH).includes(k))mesh.userData.cameraTransparent=true;
   mesh.matrixAutoUpdate=false;group.add(mesh);tris+=B.p.length/9;}
  this.buf.clear();return tris;}
}
/** Deterministic PRNG. */
export function rng(seed:number){let s=Math.imul((seed^0x9e3779b9)>>>0,2654435761)>>>0;s=(s^(s>>>15))>>>0||1;return()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};}
export const pick=<T>(r:()=>number,a:readonly T[])=>a[Math.floor(r()*a.length)%a.length];
export const PLASTER=['#e8d8b8','#d9a85e','#c96f4a','#e6c86e','#a9c3b0','#9db8c9','#d49a8c','#efe9dc','#c7b6d6','#b9cf8c','#e9b07a','#8fb3a8','#f0d9a8','#cf8b6a'];
export const ROOFS=['#a8553a','#b86a45','#5a5f66','#3f4448','#6f7f5a','#8a3a2a','#4f5d6b','#9c6b4a','#5d4a3f'];
export const TIMBER=['#8a5a36','#6e4a30','#a0764e','#5b4030','#b08a5f'];
export const STONE=['#a59d8e','#8f877a','#b9b0a0','#7c766c','#c4b9a2'];
export const TRIM=['#f3eee2','#4a4038','#2f4f5f','#7a2f2a','#e8e2d2','#355e3b'];
