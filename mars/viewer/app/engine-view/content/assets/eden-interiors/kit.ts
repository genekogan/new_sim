import * as THREE from 'three';
/** Buildings & Interiors geometry kit. Every static part is accumulated as a flat-shaded, vertex-coloured
 * triangle soup per (room, layer) and emitted as ONE mesh per layer, so a furnished room costs a handful of
 * draws however much is in it. Layers:
 *  - furn  : furniture and dressing — camera-transparent (never blocks a Broadcast/Follow sightline)
 *  - glow  : lamp shades, screens, candle flames — unlit (MeshBasic), camera-transparent; fakes light
 *  - cloth : rugs, curtains, bedding, upholstery — camera-transparent, softer
 *  - wall  : walls, partitions, ceilings — opaque for indoor framing (NOT camera-transparent)
 *  - floor : floor boards / tiles — opaque
 *  - roof  : roofs — opaque
 *  - glass : window panes — camera-transparent */
export type Layer='furn'|'glow'|'cloth'|'wall'|'floor'|'roof'|'glass';
const LAYER_NAMES:Record<Layer,string>={furn:'Interiors furniture (see-through)',glow:'Interiors lamp glow',cloth:'Interiors fabric (see-through)',wall:'Interiors plaster wall',floor:'Interiors timber floor',roof:'Interiors roof tile',glass:'Interiors window glass'};
export const SEE_THROUGH:readonly Layer[]=['furn','glow','cloth','glass'];
export class Materials{
 readonly all=new Map<Layer,THREE.Material>();
 get(k:Layer){let m=this.all.get(k);if(m)return m;
  if(k==='glow')m=new THREE.MeshBasicMaterial({vertexColors:true});
  else if(k==='glass')m=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.15,metalness:.2,transparent:true,opacity:.35,depthWrite:false,side:THREE.DoubleSide});
  else m=new THREE.MeshStandardMaterial({vertexColors:true,roughness:k==='cloth'?.97:k==='furn'?.75:.9,metalness:0,side:k==='wall'||k==='roof'?THREE.DoubleSide:THREE.FrontSide});
  m.name=LAYER_NAMES[k];this.all.set(k,m);return m;}
 dispose(){for(const m of this.all.values())m.dispose();this.all.clear();}
}
export type Col=THREE.ColorRepresentation;
const tmpC=new THREE.Color();
/** Unit primitives, non-indexed, centred at origin (cylinders/cones span y∈[-.5,.5]). */
const unit=new Map<string,THREE.BufferGeometry>();
function prim(key:string,make:()=>THREE.BufferGeometry){let g=unit.get(key);if(!g){const made=make();g=made.index?made.toNonIndexed():made;if(g!==made)made.dispose();unit.set(key,g);}return g;}
export type Box3Rec={min:[number,number,number];max:[number,number,number];label:string;layer:Layer};
/** Per-layer triangle soup with a transform stack (push = translate + yaw about +Y). */
export class Builder{
 readonly buf=new Map<Layer,{p:number[];n:number[];c:number[]}>();
 readonly boxes:Box3Rec[]=[];
 label='';
 private m=new THREE.Matrix4();private stack:THREE.Matrix4[]=[];
 private l=new THREE.Matrix4();private nm=new THREE.Matrix3();private v=new THREE.Vector3();private q=new THREE.Quaternion();private s=new THREE.Vector3();private t=new THREE.Vector3();private e=new THREE.Euler();
 push(x:number,y:number,z:number,yaw=0){this.stack.push(this.m.clone());this.m.multiply(new THREE.Matrix4().makeRotationY(yaw).setPosition(x,y,z));return this;}
 pop(){this.m=this.stack.pop()??new THREE.Matrix4();return this;}
 /** Run `f` inside a local frame. */
 at(x:number,y:number,z:number,yaw:number,f:()=>void){this.push(x,y,z,yaw);try{f();}finally{this.pop();}return this;}
 private add(g:THREE.BufferGeometry,cx:number,cy:number,cz:number,sx:number,sy:number,sz:number,col:Col,layer:Layer,rx=0,ry=0,rz=0){
  this.q.setFromEuler(this.e.set(rx,ry,rz));this.l.compose(this.t.set(cx,cy,cz),this.q,this.s.set(sx,sy,sz));this.l.premultiply(this.m);this.nm.getNormalMatrix(this.l);
  let b=this.buf.get(layer);if(!b){b={p:[],n:[],c:[]};this.buf.set(layer,b);}
  const P=g.attributes.position,N=g.attributes.normal;tmpC.set(col);
  const mn=[Infinity,Infinity,Infinity],mx=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<P.count;i++){this.v.fromBufferAttribute(P,i).applyMatrix4(this.l);b.p.push(this.v.x,this.v.y,this.v.z);
   mn[0]=Math.min(mn[0],this.v.x);mn[1]=Math.min(mn[1],this.v.y);mn[2]=Math.min(mn[2],this.v.z);mx[0]=Math.max(mx[0],this.v.x);mx[1]=Math.max(mx[1],this.v.y);mx[2]=Math.max(mx[2],this.v.z);
   this.v.fromBufferAttribute(N,i).applyMatrix3(this.nm).normalize();b.n.push(this.v.x,this.v.y,this.v.z);b.c.push(tmpC.r,tmpC.g,tmpC.b);}
  this.boxes.push({min:mn as [number,number,number],max:mx as [number,number,number],label:this.label,layer});
 }
 /** Axis box by its bottom-centre (x, y = bottom, z) and size. */
 box(x:number,y:number,z:number,w:number,h:number,d:number,col:Col,layer:Layer='furn',yaw=0){this.add(prim('box',()=>new THREE.BoxGeometry(1,1,1)),x,y+h/2,z,w,h,d,col,layer,0,yaw,0);return this;}
 /** Box from min/max corners (local frame). */
 span(x0:number,y0:number,z0:number,x1:number,y1:number,z1:number,col:Col,layer:Layer='furn'){return this.box((x0+x1)/2,Math.min(y0,y1),(z0+z1)/2,Math.abs(x1-x0),Math.abs(y1-y0),Math.abs(z1-z0),col,layer);}
 /** Vertical cylinder (bottom at y). rTop≠rBot gives a frustum; seg=4..16. */
 cyl(x:number,y:number,z:number,rTop:number,rBot:number,h:number,col:Col,layer:Layer='furn',seg=8){const r=Math.max(rTop,rBot,1e-4);this.add(prim('cyl'+seg+':'+(rTop/r).toFixed(3)+':'+(rBot/r).toFixed(3),()=>new THREE.CylinderGeometry(rTop/r,rBot/r,1,seg)),x,y+h/2,z,r,h,r,col,layer);return this;}
 /** Horizontal cylinder along local X (e.g. rolls, logs, barrels on side). */
 cylX(x:number,y:number,z:number,r:number,len:number,col:Col,layer:Layer='furn',seg=8){this.add(prim('cyl'+seg+':1.000:1.000',()=>new THREE.CylinderGeometry(1,1,1,seg)),x,y,z,r,len,r,col,layer,0,0,Math.PI/2);return this;}
 /** Low-poly ball (foliage, fruit, loaves) centred at (x,y,z), scaled per axis. */
 ball(x:number,y:number,z:number,rx:number,ry:number,rz:number,col:Col,layer:Layer='furn'){this.add(prim('ico',()=>new THREE.IcosahedronGeometry(1,1)),x,y,z,rx,ry,rz,col,layer);return this;}
 /** Cone (bottom at y). */
 cone(x:number,y:number,z:number,r:number,h:number,col:Col,layer:Layer='furn',seg=8){this.add(prim('cone'+seg,()=>new THREE.ConeGeometry(1,1,seg)),x,y+h/2,z,r,h,r,col,layer);return this;}
 /** Tilted box: centre, size and Euler (rx about X then rz). */
 tilt(x:number,y:number,z:number,w:number,h:number,d:number,rx:number,rz:number,col:Col,layer:Layer='furn',ry=0){this.add(prim('box',()=>new THREE.BoxGeometry(1,1,1)),x,y,z,w,h,d,col,layer,rx,ry,rz);return this;}
 /** Triangular prism (gable roof body) along local Z: width w, ridge height h, length d, bottom at y. */
 prism(x:number,y:number,z:number,w:number,h:number,d:number,col:Col,layer:Layer='roof'){this.add(prim('prism',()=>{const s=new THREE.Shape([new THREE.Vector2(-.5,0),new THREE.Vector2(.5,0),new THREE.Vector2(0,1)]);const g=new THREE.ExtrudeGeometry(s,{depth:1,bevelEnabled:false});g.translate(0,0,-.5);return g;}),x,y,z,w,h,d,col,layer);return this;}
 /** Emit one mesh per layer into `group`. */
 emit(group:THREE.Group,mats:Materials,name:string){let draws=0,tris=0;
  for(const [k,b] of this.buf){if(!b.p.length)continue;const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(b.p,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(b.n,3));g.setAttribute('color',new THREE.Float32BufferAttribute(b.c,3));g.computeBoundingBox();g.computeBoundingSphere();
   const mesh=new THREE.Mesh(g,mats.get(k));mesh.name=name+' '+k;mesh.matrixAutoUpdate=false;mesh.updateMatrix();
   if(SEE_THROUGH.includes(k))mesh.userData.cameraTransparent=true;
   mesh.castShadow=k!=='glow'&&k!=='glass'&&k!=='cloth';mesh.receiveShadow=k!=='glow';
   group.add(mesh);draws++;tris+=b.p.length/9;}
  this.buf.clear();return {draws,tris};}
}
export function disposeUnits(){for(const g of unit.values())g.dispose();unit.clear();}
/** Deterministic PRNG for book colours, loaves, hay. */
export function rng(seed:number){let s=seed>>>0||1;return ()=>{s=Math.imul(s^(s>>>15),2246822507)>>>0;s=Math.imul(s^(s>>>13),3266489909)>>>0;s=(s^(s>>>16))>>>0;return s/4294967296;};}
