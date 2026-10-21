import * as THREE from 'three';
/** Immutable height lookup of the actual drawn triangles. Decorative consumers
 * share this surface; this never grants native support or a walking route. */
export function groundTriangleSampler(mesh:THREE.Mesh,cell=16){
 const p=mesh.geometry.getAttribute('position'),index=mesh.geometry.index;
 if(!p||!Number.isFinite(cell)||cell<=0)throw Error('ground-triangles.invalid-input');
 mesh.updateWorldMatrix(true,false);
 // Triangles are kept flat (9 world coordinates each, full precision) and bucketed by a numeric cell key
 // (exact while |cell index| < 2^20, i.e. ~16 000 km at 16 m cells).
 const count=index?.count??p.count,tri=new Float64Array(Math.max(0,Math.floor(count/3))*9),buckets=new Map<number,number[]>();
 const point=new THREE.Vector3(),key=(x:number,z:number)=>x*4294967296+z;let triangles=0;
 for(let i=0;i<count;i+=3){
  const o=triangles*9;let finite=true;
  for(let j=0;j<3;j++){point.fromBufferAttribute(p,index?index.getX(i+j):i+j).applyMatrix4(mesh.matrixWorld);tri[o+j*3]=point.x;tri[o+j*3+1]=point.y;tri[o+j*3+2]=point.z;if(!Number.isFinite(point.x)||!Number.isFinite(point.y)||!Number.isFinite(point.z))finite=false;}
  const x0=tri[o],z0=tri[o+2],x1=tri[o+3],z1=tri[o+5],x2=tri[o+6],z2=tri[o+8];
  const det=(x1-x0)*(z2-z0)-(z1-z0)*(x2-x0);if(!finite||Math.abs(det)<1e-12)continue;
  const n=triangles++;
  const cx1=Math.floor(Math.max(x0,x1,x2)/cell),cz0=Math.floor(Math.min(z0,z1,z2)/cell),cz1=Math.floor(Math.max(z0,z1,z2)/cell);
  for(let x=Math.floor(Math.min(x0,x1,x2)/cell);x<=cx1;x++)for(let z=cz0;z<=cz1;z++){
   const k=key(x,z),rows=buckets.get(k);if(rows)rows.push(n);else buckets.set(k,[n]);
  }
 }
 return {triangles,cells:buckets.size,heightAt(x:number,z:number):number|null{
  if(!Number.isFinite(x)||!Number.isFinite(z))return null;let top:number|null=null;
  const rows=buckets.get(key(Math.floor(x/cell),Math.floor(z/cell)));if(!rows)return null;
  for(const n of rows){const o=n*9,t0=tri[o],t1=tri[o+1],t2=tri[o+2],dx=tri[o+3]-t0,dz=tri[o+5]-t2,ex=tri[o+6]-t0,ez=tri[o+8]-t2,det=dx*ez-dz*ex;
   const u=((x-t0)*ez-(z-t2)*ex)/det,v=(dx*(z-t2)-dz*(x-t0))/det;
   if(u< -1e-8||v< -1e-8||u+v>1+1e-8)continue;const y=t1+u*(tri[o+4]-t1)+v*(tri[o+7]-t1);if(top===null||y>top)top=y;
  }return top;
 }};
}
