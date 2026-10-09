import * as THREE from 'three';
/** Immutable height lookup of the actual drawn triangles. Decorative consumers
 * share this surface; this never grants native support or a walking route. */
export function groundTriangleSampler(mesh:THREE.Mesh,cell=16){
 const p=mesh.geometry.getAttribute('position'),index=mesh.geometry.index;
 if(!p||!Number.isFinite(cell)||cell<=0)throw Error('ground-triangles.invalid-input');
 mesh.updateWorldMatrix(true,false);
 const buckets=new Map<string,number[]>(),triangles:number[][]=[];
 const point=new THREE.Vector3(),key=(x:number,z:number)=>`${x},${z}`;
 for(let i=0;i<(index?.count??p.count);i+=3){
  const t:number[]=[];for(let j=0;j<3;j++){point.fromBufferAttribute(p,index?index.getX(i+j):i+j).applyMatrix4(mesh.matrixWorld);t.push(point.x,point.y,point.z);}
  const det=(t[3]-t[0])*(t[8]-t[2])-(t[5]-t[2])*(t[6]-t[0]);if(!t.every(Number.isFinite)||Math.abs(det)<1e-12)continue;
  const n=triangles.length;triangles.push(t);
  const xs=[t[0],t[3],t[6]],zs=[t[2],t[5],t[8]];
  for(let x=Math.floor(Math.min(...xs)/cell);x<=Math.floor(Math.max(...xs)/cell);x++)for(let z=Math.floor(Math.min(...zs)/cell);z<=Math.floor(Math.max(...zs)/cell);z++){
   const k=key(x,z),rows=buckets.get(k)??[];rows.push(n);buckets.set(k,rows);
  }
 }
 return {triangles:triangles.length,cells:buckets.size,heightAt(x:number,z:number):number|null{
  if(!Number.isFinite(x)||!Number.isFinite(z))return null;let top:number|null=null;
  for(const n of buckets.get(key(Math.floor(x/cell),Math.floor(z/cell)))??[]){const t=triangles[n],dx=t[3]-t[0],dz=t[5]-t[2],ex=t[6]-t[0],ez=t[8]-t[2],det=dx*ez-dz*ex;
   const u=((x-t[0])*ez-(z-t[2])*ex)/det,v=(dx*(z-t[2])-dz*(x-t[0]))/det;
   if(u< -1e-8||v< -1e-8||u+v>1+1e-8)continue;const y=t[1]+u*(t[4]-t[1])+v*(t[7]-t[1]);if(top===null||y>top)top=y;
  }return top;
 }};
}
