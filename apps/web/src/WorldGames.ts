import * as THREE from 'three';
import {recordedGameObjects} from '../../../mars/viewer/app/engine-view/recorded-games.ts';
import type {SampledEntity} from '../../../mars/viewer/engine/take/replay.ts';
/** One prop per recorded court flight; landed boules persist for exactly the current end. */
export class WorldGames{
 readonly group=new THREE.Group();private meshes=new Map<string,THREE.Mesh>();
 private ball=new THREE.SphereGeometry(1,16,12);private disc=new THREE.CylinderGeometry(.12,.12,.018,24);
 private materials={frisbee:new THREE.MeshStandardMaterial({color:'#e9712e',roughness:.5}),petanque:new THREE.MeshStandardMaterial({color:'#9ca5ac',metalness:.8,roughness:.3}),volleyball:new THREE.MeshStandardMaterial({color:'#f2eee3',roughness:.7}),jack:new THREE.MeshStandardMaterial({color:'#dfb356',roughness:.7})};
 constructor(){this.group.name='recorded-games';}
 update(entities:Readonly<Record<string,SampledEntity>>,tick:number){
  const seen=new Set<string>();for(const obj of recordedGameObjects(entities,tick)){seen.add(obj.key);let mesh=this.meshes.get(obj.key);
   if(!mesh){mesh=new THREE.Mesh(obj.kind==='frisbee'?this.disc:this.ball,this.materials[obj.kind]);mesh.name=obj.key;mesh.castShadow=mesh.receiveShadow=true;mesh.userData.gameKind=obj.kind;this.meshes.set(obj.key,mesh);this.group.add(mesh);}
   const size=obj.kind==='volleyball' ? .105 : obj.kind==='petanque' ? .045 : obj.kind==='jack' ? .025 : 1;mesh.scale.setScalar(size);mesh.position.set(...obj.p);mesh.rotation.set(0,obj.progress*Math.PI*4,obj.kind==='frisbee'&&obj.flight ? .08 : 0);mesh.visible=true;
  }
  for(const [key,mesh] of this.meshes)if(!seen.has(key)){mesh.removeFromParent();this.meshes.delete(key);}
 }
 dispose(){this.group.removeFromParent();this.group.clear();this.meshes.clear();this.ball.dispose();this.disc.dispose();Object.values(this.materials).forEach(m=>m.dispose());}
}
