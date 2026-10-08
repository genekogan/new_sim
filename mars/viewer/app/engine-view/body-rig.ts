import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';

/** The rig used by all limb/contact adapters, after GLTFLoader sanitizes .L/.R names. */
const CHAINS = [
 ['Root','Body','Hips','Abdomen','Torso','Chest','Neck','Head'],
 ...['L','R'].flatMap(side=>[
  ['Chest',`Shoulder${side}`,`UpperArm${side}`,`LowerArm${side}`,`Wrist${side}`,`Middle1${side}`,`Middle2${side}`],
  ['Body',`UpperLeg${side}`,`LowerLeg${side}`], ['Root',`Foot${side}`],
 ]),
];

/** Defense at the consumer boundary too: incompatible admitted rigs get an honest stand-in. */
export function validateBodyRig(gltf:GLTF):void {
 const bones=new Map<string,THREE.Bone>();const skinBones=new Set<THREE.Bone>();
 gltf.scene.traverse(o=>{
  if((o as THREE.Bone).isBone){if(bones.has(o.name))throw Error('Duplicate body bone '+o.name);bones.set(o.name,o as THREE.Bone);}
  if((o as THREE.SkinnedMesh).isSkinnedMesh)for(const bone of (o as THREE.SkinnedMesh).skeleton.bones)skinBones.add(bone);
 });
 for(const chain of CHAINS)for(let i=0;i<chain.length;i++){
  const b=bones.get(chain[i]);if(!b||!skinBones.has(b))throw Error('Missing skinned body bone '+chain[i]);
  if(i){let p=b.parent;while(p&&p!==bones.get(chain[i-1]))p=p.parent;if(!p)throw Error('Incompatible body chain '+chain[i]);}
  if(/^Foot[LR]$/.test(b.name)&&b.parent!==bones.get('Root'))throw Error('Incompatible body chain '+b.name);
 }
 for(const name of ['Idle','Walk']){
  const clip=THREE.AnimationClip.findByName(gltf.animations,name);
  if(!clip||!Number.isFinite(clip.duration)||clip.duration<=0||!clip.tracks.length)throw Error('Missing body animation '+name);
  for(const track of clip.tracks)if(!Array.from(track.times).every(Number.isFinite)||!Array.from(track.values).every(Number.isFinite))throw Error('Invalid body animation '+name);
 }
 gltf.scene.updateMatrixWorld(true);const box=new THREE.Box3().setFromObject(gltf.scene),size=box.getSize(new THREE.Vector3());
 if(box.isEmpty()||![...box.min.toArray(),...box.max.toArray()].every(Number.isFinite)||Math.min(size.x,size.y,size.z)<=0)throw Error('Empty or invalid body bounds');
 // Bounds above validate the source. Fitting must measure the played Idle pose, not inherit a cached bind-pose box.
 gltf.scene.traverse(o=>{if((o as THREE.SkinnedMesh).isSkinnedMesh){
  // Three initializes these caches to null; its current declarations omit that runtime state.
  const bounds=o as unknown as {boundingBox:THREE.Box3|null;boundingSphere:THREE.Sphere|null};bounds.boundingBox=null;bounds.boundingSphere=null;
 }});
}
