import type * as THREE from 'three';
/** Registration is explicit, after loader attachment, and based on the GLTF's
 * animation list (scene.animations alone need not contain its clips). */
export class StaticRootRegistry{
 private owner:THREE.Object3D;private registered=new Map<THREE.Object3D,boolean>();private serial=0;
 constructor(owner:THREE.Object3D){this.owner=owner;}
 register(root:THREE.Object3D,animations:readonly unknown[]|undefined){if(!animations||animations.length||this.registered.has(root))return false;this.registered.set(root,root.visible);this.serial++;return true;}
 private refresh(){for(const[root,wasVisible]of this.registered){let attached=false;for(let p:THREE.Object3D|null=root;p;p=p.parent)if(p===this.owner){attached=true;break;}if(!attached){this.registered.delete(root);this.serial++;}else if(root.visible!==wasVisible){this.registered.set(root,root.visible);this.serial++;}}}
 get revision(){this.refresh();return this.serial;}
 roots(){this.refresh();return [...this.registered.keys()].filter(root=>root.visible);}
 clear(){if(this.registered.size){this.registered.clear();this.serial++;}}
}
