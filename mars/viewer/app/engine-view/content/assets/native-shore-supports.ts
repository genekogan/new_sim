/** Exact published support appearance; caller owns recorded placement/visibility gates. */
import * as THREE from 'three';
import {nativeBoatLayoutV1Schema,type NativeBoatLayoutV1} from '../../../../../../packages/engine-contract/src/boat.ts';

export type NativeShoreSupports={readonly group:THREE.Group;readonly dock:THREE.Group;readonly ramp:THREE.Group;readonly connector:THREE.Group;dispose():void};
export function createNativeShoreSupports(layout:NativeBoatLayoutV1):NativeShoreSupports {
 const l=nativeBoatLayoutV1Schema.parse(layout);
 const bounded=(v:unknown):boolean=>typeof v==='number'?Number.isFinite(v)&&Math.abs(v)<=10000:Array.isArray(v)?v.every(bounded):v!==null&&typeof v==='object'?Object.values(v).every(bounded):true;
 if(!bounded(l)||[l.ramp,l.connector].some(c=>Math.hypot(c.to[0]-c.from[0],c.to[2]-c.from[2])===0))throw Error('Unsupported finite native shore supports');
 const group=new THREE.Group(),dock=new THREE.Group(),connector=new THREE.Group(),ramp=new THREE.Group();
 // Preserve the existing owner's support-filtered hierarchy and names, without its boat/state logic.
 group.name='recorded native boat and dock';dock.name=l.dockId;connector.name='recorded boarding connector';ramp.name='published bank ramp';group.add(dock,connector,ramp);
 const geometry=new THREE.BoxGeometry(1,1,1),material=new THREE.MeshStandardMaterial({color:'#a68b60',roughness:.9});
 const geometries:THREE.BufferGeometry[]=[geometry],materials:THREE.Material[]=[material];
 const slab=new THREE.Mesh(geometry,material);slab.name='published dock slab';slab.position.set(0,l.dock.size[1]/2,0);slab.scale.fromArray(l.dock.size);slab.castShadow=slab.receiveShadow=true;dock.add(slab);
 const corridor=(parent:THREE.Group,c:NativeBoatLayoutV1['ramp'],name:string)=>{
  const a=c.from,b=c.to,dx=b[0]-a[0],dz=b[2]-a[2],len=Math.hypot(dx,dz),ox=-dz/len*c.width/2,oz=dx/len*c.width/2;
  const g=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([a[0]+ox,a[1],a[2]+oz,a[0]-ox,a[1],a[2]-oz,b[0]+ox,b[1],b[2]+oz,b[0]-ox,b[1],b[2]-oz],3));g.setIndex([0,2,1,1,2,3]);g.computeVertexNormals();
  const m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:'#b9a077',roughness:.9,side:THREE.DoubleSide}));m.name=name;m.receiveShadow=true;parent.add(m);
  geometries.push(g);materials.push(m.material);
 };
 corridor(ramp,l.ramp,'supported ramp top');corridor(connector,l.connector,'supported connector top');
 let closed=false;return{group,dock,ramp,connector,dispose(){
  if(closed)return;closed=true;
  const failures:unknown[]=[],attempt=(operation:()=>void)=>{try{operation();}catch(error){failures.push(error);}};
  attempt(()=>group.removeFromParent());
  // Resource and removed listeners may throw; each owned release and residual membership still gets its attempt.
  for(const g of geometries)attempt(()=>g.dispose());for(const m of materials)attempt(()=>m.dispose());
  for(const child of group.children.slice())attempt(()=>group.remove(child));
  geometries.length=materials.length=0;
  if(failures.length)throw new AggregateError(failures,'Native shore support cleanup failed');
 }};
}
