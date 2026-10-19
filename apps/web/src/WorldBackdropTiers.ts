import * as THREE from 'three';
/** Lane W3 (2026-10-19): the Mars campus ships in two tiers (tools/blobs/campus-parts.mjs --tier base|detail). The base
 * file has every layer exact except the 3D-Warehouse "Fittings and furniture", which it carries as seen from 32 m or
 * farther, each such node marked extras.tier = 'coarse'. After arrival the detail file (those leaves, exact) is added
 * and the coarse nodes leave the scene: GPU resources only they used are released. Returns the nodes removed. */
export function dropCoarse(root:THREE.Object3D):number{
  const coarse:THREE.Object3D[]=[];
  root.traverse(o=>{if(o.userData.tier==='coarse')coarse.push(o);});
  if(!coarse.length)return 0;
  const gone=new Set<THREE.Mesh>();
  for(const o of coarse)o.traverse(x=>{if(x instanceof THREE.Mesh)gone.add(x);});
  for(const o of coarse)o.removeFromParent();
  const keptGeometry=new Set<THREE.BufferGeometry>(),keptMaterial=new Set<THREE.Material>(),keptTexture=new Set<THREE.Texture>();
  const textures=(m:THREE.Material)=>Object.values(m).filter((v):v is THREE.Texture=>v instanceof THREE.Texture);
  root.traverse(o=>{if(!(o instanceof THREE.Mesh))return;keptGeometry.add(o.geometry);for(const m of [o.material].flat() as THREE.Material[]){keptMaterial.add(m);for(const t of textures(m))keptTexture.add(t);}});
  const doneGeometry=new Set<THREE.BufferGeometry>(),doneMaterial=new Set<THREE.Material>();
  for(const mesh of gone){
    if(!keptGeometry.has(mesh.geometry)&&!doneGeometry.has(mesh.geometry)){doneGeometry.add(mesh.geometry);mesh.geometry.dispose();}
    for(const m of [mesh.material].flat() as THREE.Material[]){
      if(keptMaterial.has(m)||doneMaterial.has(m))continue;doneMaterial.add(m);
      for(const t of textures(m))if(!keptTexture.has(t))t.dispose();
      m.dispose();
    }
  }
  return coarse.length;
}
