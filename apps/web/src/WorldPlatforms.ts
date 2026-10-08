import * as THREE from 'three';
import {platformFloorOffset,type PlatformFloor} from '../../../mars/viewer/lib/platform-floor.ts';
/** Plain support for captured declared floors when the authored live scenery is absent. */
export class WorldPlatforms{
 readonly group=new THREE.Group();private key='';
 private material=new THREE.MeshStandardMaterial({color:'#a8835a',roughness:.9});
 constructor(){this.group.name='declared-platform-floors';}
 set(platforms:readonly PlatformFloor[],baseY:number,authored:boolean){
  this.group.visible=!authored;const key=JSON.stringify([platforms,baseY]);if(key===this.key)return;this.key=key;
  for(const child of [...this.group.children]){(child as THREE.Mesh).geometry.dispose();child.removeFromParent();}
  const add=(geometry:THREE.BufferGeometry,x:number,y:number,z:number,yaw=0)=>{const m=new THREE.Mesh(geometry,this.material);m.position.set(x,y,z);m.rotation.y=-yaw;m.receiveShadow=m.castShadow=true;this.group.add(m);};
  for(const p of platforms){
   if(p.half)add(new THREE.BoxGeometry(p.half[0]*2,p.top,p.half[1]*2),p.c[0],baseY+p.top/2,p.c[1],p.yaw);
   else if(p.r)add(new THREE.CylinderGeometry(p.r,p.r,p.top,p.segments??32),p.c[0],baseY+p.top/2,p.c[1],p.yaw);
   if(p.step){const h=p.step.top??p.top/2;add(new THREE.BoxGeometry(p.step.half[0]*2,h,p.step.half[1]*2),p.step.c[0],baseY+h/2,p.step.c[1]);}
   if(p.ramp){const ramp=p.ramp,g=new THREE.BoxGeometry(ramp.half[0]*2,1,ramp.half[1]*2),positions=g.attributes.position as THREE.BufferAttribute;
    for(let i=0;i<positions.count;i++){const y=positions.getY(i)>0?platformFloorOffset([p],ramp.c[0]+positions.getX(i),ramp.c[1]+positions.getZ(i),baseY,baseY):0;positions.setY(i,y);}
    positions.needsUpdate=true;g.computeVertexNormals();add(g,ramp.c[0],baseY,ramp.c[1]);
   }
  }
 }
 dispose(){this.group.removeFromParent();for(const child of this.group.children)(child as THREE.Mesh).geometry.dispose();this.group.clear();this.material.dispose();}
}
