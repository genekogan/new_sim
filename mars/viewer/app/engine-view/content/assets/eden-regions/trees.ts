import * as THREE from 'three';
import type {Materials} from './kit.ts';
export type TreeKind='round'|'conifer'|'cypress'|'fruit'|'poplar';
type T={x:number;y:number;z:number;s:number;k:TreeKind;c:THREE.Color;yaw:number};
/** All Regions trees share 4 instanced draws (canopy kinds + one trunk). */
export class Trees{
 list:T[]=[];
 add(x:number,y:number,z:number,s:number,k:TreeKind,c:string|THREE.Color,yaw=0){this.list.push({x,y,z,s,k,c:c instanceof THREE.Color?c:new THREE.Color(c),yaw});}
 /** seeThrough: distant forests that can never stand between a camera and the inhabited world. */
 emit(group:THREE.Group,mats:Materials,geos:THREE.BufferGeometry[],seeThrough=false,far?:(x:number,z:number)=>boolean,farSink?:Trees){let tris=0;
  if(far&&farSink){const f=far;farSink.list.push(...this.list.filter(t=>f(t.x,t.z)));this.list=this.list.filter(t=>!f(t.x,t.z));far=undefined;}
  const flat=(g:THREE.BufferGeometry)=>{const n=g.index?g.toNonIndexed():g;n.computeVertexNormals();geos.push(n);if(n!==g)g.dispose();return n;};
  const round=flat(new THREE.IcosahedronGeometry(1,0).scale(1.25,1.05,1.25).translate(0,2.9,0));
  const cone=(()=>{const a=new THREE.ConeGeometry(1.5,2.6,7,1,true).translate(0,2.4,0),b=new THREE.ConeGeometry(1.15,2.2,7,1,true).translate(0,3.7,0),c=new THREE.ConeGeometry(.75,1.8,7,1,true).translate(0,4.8,0);
   const parts=[a,b,c].map(g=>g.toNonIndexed());const p:number[]=[];for(const g of parts){p.push(...(g.attributes.position.array as Float32Array));g.dispose();}a.dispose();b.dispose();c.dispose();const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.computeVertexNormals();geos.push(g);return g;})();
  const cyp=flat(new THREE.ConeGeometry(.75,5.2,6,1,true).translate(0,3.2,0));
  const pop=flat(new THREE.OctahedronGeometry(1,0).scale(.9,3.2,.9).translate(0,4.2,0));
  const trunk=flat(new THREE.CylinderGeometry(.12,.2,2.4,5,1,true).translate(0,1.2,0));
  const kinds:[string,THREE.BufferGeometry,(t:T)=>boolean][]=[['round canopy foliage',round,t=>t.k==='round'||t.k==='fruit'],['conifer canopy foliage',cone,t=>t.k==='conifer'],['cypress canopy foliage',cyp,t=>t.k==='cypress'],['poplar canopy foliage',pop,t=>t.k==='poplar'],['tree trunk bark',trunk,t=>t.k!=='conifer'&&t.k!=='cypress']];
  const m=new THREE.Matrix4(),q=new THREE.Quaternion(),up=new THREE.Vector3(0,1,0),bark=new THREE.Color('#5b4636');
  const runs:[string,THREE.BufferGeometry,(t:T)=>boolean,boolean][]=[];for(const [name,g,f] of kinds){if(far){runs.push([name,g,t=>f(t)&&!far(t.x,t.z),seeThrough],[name+' far',g,t=>f(t)&&far(t.x,t.z),true]);}else runs.push([name,g,f,seeThrough]);}
  for(const [name,g,f,clear] of runs){const sel=this.list.filter(f);if(!sel.length)continue;const isTrunk=name.startsWith('tree trunk');
   const mesh=new THREE.InstancedMesh(g,mats.instanced(isTrunk?'bark':'foliage'),sel.length);mesh.name='Regions '+name;
   sel.forEach((t,i)=>{q.setFromAxisAngle(up,t.yaw);const sy=t.k==='fruit'?t.s*.8:t.s;m.compose(new THREE.Vector3(t.x,t.y-.15,t.z),q,new THREE.Vector3(t.s,sy,t.s));mesh.setMatrixAt(i,m);mesh.setColorAt(i,isTrunk?bark:t.c);});
   mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;mesh.computeBoundingBox();mesh.computeBoundingSphere();mesh.castShadow=false;mesh.receiveShadow=true;if(clear||isTrunk)mesh.userData.cameraTransparent=true;group.add(mesh);
   tris+=sel.length*(g.attributes.position.count/3);}
  return tris;}
}
