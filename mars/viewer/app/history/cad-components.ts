import * as T from 'three';
/** Browser GLB uses component Groups with anonymous child meshes; modular GLB
 * uses component Meshes. Always resolve the owner before editing descendants. */
export function componentOwner(root:T.Object3D,id:string){let owner:T.Object3D|undefined;root.traverse(o=>{if(o.userData.component_id===id)owner=o;});return owner;}
export function componentMeshes(root:T.Object3D,id:string){const owner=componentOwner(root,id),meshes:T.Mesh[]=[];owner?.traverse(o=>{if((o as T.Mesh).isMesh)meshes.push(o as T.Mesh);});return {owner,meshes};}
