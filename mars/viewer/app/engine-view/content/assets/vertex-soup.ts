import * as THREE from 'three';
/** A flat-shaded, vertex-coloured triangle soup for low-poly scenery kits: boxes, cylinders, cones and spheres
 * placed with a yaw (and optional tilt), all merged into ONE geometry (one draw for a whole kit). */
export class VertexSoup{
 readonly p:number[]=[];readonly n:number[]=[];readonly c:number[]=[];
 private readonly col=new THREE.Color();private readonly m=new THREE.Matrix4();private readonly e=new THREE.Euler();private readonly q=new THREE.Quaternion();
 private readonly v=new THREE.Vector3();private readonly w=new THREE.Vector3();private readonly s=new THREE.Vector3();private readonly nm=new THREE.Matrix3();
 /** Add a geometry (indexed or not) at `at` with yaw (about y), pitch (about local x), roll (about local z) and scale. */
 add(g:THREE.BufferGeometry,at:readonly number[],color:string,yaw=0,pitch=0,roll=0,scale:readonly number[]=[1,1,1]){
  const geo=g.index?g.toNonIndexed():g;geo.computeVertexNormals();
  this.m.compose(this.v.set(at[0],at[1],at[2]),this.q.setFromEuler(this.e.set(pitch,yaw,roll,'YXZ')),this.s.set(scale[0],scale[1],scale[2]));this.nm.getNormalMatrix(this.m);
  this.col.set(color);const P=geo.attributes.position,N=geo.attributes.normal;
  for(let i=0;i<P.count;i++){this.v.fromBufferAttribute(P,i).applyMatrix4(this.m);this.w.fromBufferAttribute(N,i).applyMatrix3(this.nm).normalize();
   this.p.push(this.v.x,this.v.y,this.v.z);this.n.push(this.w.x,this.w.y,this.w.z);this.c.push(this.col.r,this.col.g,this.col.b);}
  if(geo!==g)geo.dispose();g.dispose();
 }
 box(at:readonly number[],size:readonly number[],color:string,yaw=0,pitch=0,roll=0){this.add(new THREE.BoxGeometry(size[0],size[1],size[2]),at,color,yaw,pitch,roll);}
 cyl(at:readonly number[],r:number,h:number,color:string,seg=10,yaw=0,pitch=0,roll=0,r2=r){this.add(new THREE.CylinderGeometry(r2,r,h,seg),at,color,yaw,pitch,roll);}
 cone(at:readonly number[],r:number,h:number,color:string,seg=8,yaw=0,pitch=0,roll=0){this.add(new THREE.ConeGeometry(r,h,seg),at,color,yaw,pitch,roll);}
 ball(at:readonly number[],r:number,color:string,scale:readonly number[]=[1,1,1],seg=8){this.add(new THREE.SphereGeometry(r,seg,Math.max(4,seg*.6|0)),at,color,0,0,0,scale);}
 /** A thin rod between two points. */
 rod(a:readonly number[],b:readonly number[],r:number,color:string,seg=6){const A=new THREE.Vector3(a[0],a[1],a[2]),B=new THREE.Vector3(b[0],b[1],b[2]),d=B.clone().sub(A),len=d.length();if(len<1e-6)return;
  const g=new THREE.CylinderGeometry(r,r,len,seg);const q=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());g.applyQuaternion(q);this.add(g,A.add(B).multiplyScalar(.5).toArray(),color);}
 get triangles(){return this.p.length/9;}
 geometry(){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(this.p,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(this.n,3));g.setAttribute('color',new THREE.Float32BufferAttribute(this.c,3));g.computeBoundingSphere();g.computeBoundingBox();return g;}
}
/** Local frame helper: point `[dx, dy, dz]` relative to `origin` turned by `yaw` (three.js rotation.y convention). */
export const local=(origin:readonly number[],yaw:number)=>(dx:number,dy:number,dz:number):[number,number,number]=>{const c=Math.cos(yaw),s=Math.sin(yaw);return[origin[0]+dx*c+dz*s,origin[1]+dy,origin[2]-dx*s+dz*c];};
