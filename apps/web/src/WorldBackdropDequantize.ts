import * as THREE from 'three';
/** Lane BLOBS: the campus backdrop ships quantized (KHR_mesh_quantization) to cut its download ~4x. Static batching
 * only merges Float32 position/normal geometry, so convert quantized position/normal/uv back to Float32 right after
 * loading. Values are the dequantized ones three would use on the GPU (getComponent denormalizes), so the look is
 * unchanged; the node transforms that carry each mesh's quantization volume stay as loaded. Returns attributes converted. */
const NAMES=/^(position|normal|uv\d?)$/;
export function dequantizeBackdrop(root:THREE.Object3D):number{
  let converted=0;const done=new Set<THREE.BufferGeometry>();
  root.traverse(object=>{
    const geometry=(object as THREE.Mesh).geometry as THREE.BufferGeometry|undefined;
    if(!geometry?.isBufferGeometry||done.has(geometry))return;done.add(geometry);
    for(const [name,attribute] of Object.entries(geometry.attributes)){
      const a=attribute as THREE.BufferAttribute;
      if(!NAMES.test(name)||a.array instanceof Float32Array)continue;
      const n=a.count,size=a.itemSize,out=new Float32Array(n*size);
      for(let i=0;i<n;i++)for(let k=0;k<size;k++)out[i*size+k]=a.getComponent(i,k);
      geometry.setAttribute(name,new THREE.BufferAttribute(out,size));converted++;
    }
  });
  return converted;
}
