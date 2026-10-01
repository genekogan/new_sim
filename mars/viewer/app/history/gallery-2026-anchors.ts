import * as T from 'three';
import {componentMeshes} from './cad-components';
/** Receiver faces in the actual retained model, not presentation magic positions. */
export function gallery2026Mounts(root:T.Group,opposite=false){
 root.updateWorldMatrix(true,true);
 const frame=root.getObjectByName('Chiba auditorium · photographed furnishings');
 const chiba=root.getObjectByName('Chiba')??root;
 if(!frame)return [];
 const source:T.Mesh[]=[];
 root.traverse(o=>{if(!(o.userData.component_id??'').startsWith('wood_component-'))return;o.traverse(m=>{if((m as T.Mesh).isMesh)source.push(m as T.Mesh);});});
 return [0,1,2,3,4,5].map(i=>{
  const p=new T.Vector3([3.45,7.45,11.30][i%3],i<3?4.45:1.55,opposite?-5.6945:-9.5).applyMatrix4(frame.matrixWorld);
  const direction=new T.Vector3(0,0,opposite?1:-1).transformDirection(frame.matrixWorld);
  const hit=new T.Raycaster(p,direction,0,6).intersectObjects(source,false).find(h=>{if(!h.face)return false;const normal=h.face.normal.clone().transformDirection(h.object.matrixWorld);return Math.abs(normal.y)<.25;});
  if(!hit)return undefined;
  const normal=hit.face!.normal.clone().transformDirection(hit.object.matrixWorld);if(normal.dot(direction)>0)normal.negate();
  let owner:T.Object3D|undefined=hit.object;while(owner&&!owner.userData.component_id)owner=owner.parent??undefined;
  const orientation=new T.Quaternion().setFromUnitVectors(new T.Vector3(0,0,1),normal),into=new T.Matrix4().compose(hit.point,orientation,new T.Vector3(1,1,1)).invert();let standOff=0;
  const clip=(poly:T.Vector3[],axis:'x'|'y',value:number,positive:boolean)=>{const out:T.Vector3[]=[];for(let j=0;j<poly.length;j++){const a=poly[j],b=poly[(j+1)%poly.length],da=(a[axis]-value)*(positive?1:-1),db=(b[axis]-value)*(positive?1:-1);if(da>=0)out.push(a);if((da>=0)!==(db>=0))out.push(a.clone().lerp(b,da/(da-db)));}return out;};
  root.traverse(o=>{if(o.userData.kind!=='rack_member')return;o.traverse(child=>{const m=child as T.Mesh;if(!m.isMesh)return;const p=m.geometry.attributes.position,ix=m.geometry.index,mat=into.clone().multiply(m.matrixWorld);for(let j=0;j<(ix?.count??p.count);j+=3){let poly=[0,1,2].map(k=>new T.Vector3().fromBufferAttribute(p,ix?ix.getX(j+k):j+k).applyMatrix4(mat));for(const [axis,v,pos]of [['x',-.72,true],['x',.72,false],['y',-.54,true],['y',.54,false]] as const)poly=clip(poly,axis,v,pos);for(const q of poly)if(q.z>0&&q.z<.8)standOff=Math.max(standOff,q.z+.025);}});});
  return {point:hit.point,normal,receiverId:owner?.userData.component_id,chiba,standOff};
 });
}
export function projection2026Mount(root:T.Group){
 const chiba=root.getObjectByName('Chiba')??root,frame=root.getObjectByName('Chiba auditorium · photographed furnishings');
 const {meshes}=componentMeshes(root,'wood_component-1985');const mesh=meshes[0];if(!mesh||!frame)return;
 root.updateWorldMatrix(true,true);
 const reference=new T.Vector3(11,2.65,-5.6945).applyMatrix4(frame.matrixWorld),p=mesh.geometry.attributes.position,index=mesh.geometry.index;
 const triangles:{point:T.Vector3,normal:T.Vector3,area:number}[]=[];
 for(let i=0;i<(index?.count??p.count);i+=3){const vs=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(p,index?index.getX(i+j):i+j).applyMatrix4(mesh.matrixWorld));const tri=new T.Triangle(vs[0],vs[1],vs[2]),normal=tri.getNormal(new T.Vector3()),area=tri.getArea();if(Math.abs(normal.y)<.25&&area>.001)triangles.push({point:tri.getMidpoint(new T.Vector3()),normal,area});}
 triangles.sort((a,b)=>b.area-a.area);if(!triangles.length)return;
 const broad=triangles[0],normal=broad.normal.clone();if(reference.clone().sub(broad.point).dot(normal)<0)normal.negate();
 // Choose the actual front skin nearest auditorium, rather than the opposite
 // plywood skin or an axis-aligned bbox face of this rotated partition.
 const parallel=triangles.filter(t=>Math.abs(t.normal.dot(normal))>.99).sort((a,b)=>Math.abs(reference.clone().sub(a.point).dot(normal))-Math.abs(reference.clone().sub(b.point).dot(normal)));
 const point=reference.clone().addScaledVector(normal,-reference.clone().sub(parallel[0].point).dot(normal)),worldNormal=normal;
 return {point,normal:worldNormal,receiverId:'wood_component-1985',chiba};
}
