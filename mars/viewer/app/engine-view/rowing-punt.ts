import * as THREE from 'three';
import {rowingStroke} from './rowing-motion.ts';
import type {Entity} from '../../engine/world/types.ts';

/** Small procedural punt and fixed boarding plank. Native carrier poses and bank points are the sole authority. */
export function rowingPuntObject(e:Entity){
  const group=new THREE.Group(),dock=new THREE.Group(),geos:THREE.BufferGeometry[]=[],mats:THREE.Material[]=[];
  group.name='two-seat cedar rowing punt';dock.name=`${e.id} dry-bank boarding plank`;
  const material=(color:string)=>{const m=new THREE.MeshStandardMaterial({color,roughness:.85});mats.push(m);return m;};
  const cedar=material('#995b32'),rim=material('#573623'),plank=material('#c7985b'),metal=material('#5d6966'),blade=material('#d3b681');
  const unit=new THREE.BoxGeometry(1,1,1);geos.push(unit);
  const box=(parent:THREE.Object3D,mat:THREE.Material,at:number[],size:number[])=>{const m=new THREE.Mesh(unit,mat);m.position.set(at[0],at[1],at[2]);m.scale.set(size[0],size[1],size[2]);m.castShadow=m.receiveShadow=true;parent.add(m);return m;};
  // Flat bottom, shallow gunwales and two separate rowing thwarts; the open top makes riders legible.
  for(let i=0;i<7;i++)box(group,i%2?cedar:plank,[0,.075,-.57+i*.19],[3.25,.1,.18]);
  for(const side of [-1,1]){
    box(group,cedar,[0,.29,side*.635],[3.35,.42,.08]);
    box(group,rim,[0,.51,side*.64],[3.45,.055,.11]);
    box(group,cedar,[side*1.65,.26,0],[.12,.4,1.28]);
  }
  const pivots:{o:THREE.Group;side:number}[]=[];
  for(const x of [-.65,.65]){
    box(group,plank,[x,.465,0],[.33,.08,1.2]);
    for(const side of [-1,1]){
      box(group,metal,[x-.1,.58,side*.65],[.065,.12,.08]);
      const o=new THREE.Group();o.position.set(x-.1,.64,side*.66);o.scale.z=side;group.add(o);
      box(o,plank,[0,0,.43],[.045,.045,1.95]);
      box(o,rim,[0,0,-.46],[.06,.06,.28]);
      box(o,blade,[0,0,1.5],[.2,.045,.46]);pivots.push({o,side});
    }
  }
  const home=e.carrier?.home,bank=e.carrier?.bank;
  if(home&&bank){const d=bank.door,dx=d[0]-home[0],dz=d[2]-home[2],n=Math.hypot(dx,dz),ux=dx/n,uz=dz/n;
    const a=new THREE.Vector3(home[0]+ux*1.65,home[1]+.15,home[2]+uz*1.65),b=new THREE.Vector3(...d);b.y+=.04;
    const middle=a.clone().add(b).multiplyScalar(.5),length=a.distanceTo(b);
    const ramp=box(dock,plank,middle.toArray(),[length,.09,.85]);ramp.rotation.y=-Math.atan2(dz,dx);ramp.rotation.z=Math.atan2(b.y-a.y,Math.hypot(b.x-a.x,b.z-a.z));
    for(const side of [-1,1])box(dock,rim,[d[0]-uz*side*.37,d[1]-.2,d[2]+ux*side*.37],[.07,.5,.07]);
  }
  return {group,dock,update(seconds:number,moving:boolean){const {pull,lift}=rowingStroke(seconds);for(const {o,side} of pivots){o.rotation.y=side*(.12+(moving?.34*pull:0));o.rotation.x=side*(moving?.1+.12*lift:.03);}},
    dispose(){group.removeFromParent();dock.removeFromParent();for(const g of geos)g.dispose();for(const m of mats)m.dispose();}};
}
export type RowingPuntVisual=ReturnType<typeof rowingPuntObject>;
