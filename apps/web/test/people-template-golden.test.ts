// Phone arrival (lane d3) cached the Idle standing box per template look and dropped a redundant whole-model matrix
// update per walk sample. Templates (walk/jog/sprint/run speeds, arm fits) and spawned bodies' placement must equal what
// the uncached code measured on the three canonical character GLBs (golden values recorded from trunk 32a8ed40).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {createRig,templateFromGltf} from '../../../mars/viewer/app/engine-view/people.ts';

async function load(name:string){
 const source=readFileSync(new URL(`../../../mars/viewer/public/modular/environment/animated-${name}.glb`,import.meta.url));
 const jsonSize=source.readUInt32LE(12),json=JSON.parse(source.subarray(20,20+jsonSize).toString()),binHeader=20+jsonSize;
 json.materials=json.materials.map(()=>({pbrMetallicRoughness:{baseColorFactor:[.5,.5,.5,1],metallicFactor:0,roughnessFactor:.8}}));delete json.textures;delete json.images;delete json.samplers;
 let chunk=Buffer.from(JSON.stringify(json));chunk=Buffer.concat([chunk,Buffer.alloc((4-chunk.length%4)%4,32)]);const bin=source.subarray(binHeader);
 const header=Buffer.alloc(20);source.copy(header,0,0,12);header.writeUInt32LE(20+chunk.length+bin.length,8);header.writeUInt32LE(chunk.length,12);header.writeUInt32LE(0x4e4f534a,16);
 const bytes=Buffer.concat([header,chunk,bin]);return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
}
export async function measure(){
 const out:Record<string,unknown>={};
 for(const name of ['casual','punk','woman']){
  const t=templateFromGltf(name,await load(name)) as unknown as Record<string,unknown>;
  const bodies=[0,1].map(()=>{const r=createRig(t as never);return [...r.model.position.toArray(),...r.model.scale.toArray()];});
  out[name]={walkSpeed:t.walkSpeed,forward:t.forward,jogSpeed:t.jogSpeed,sprintSpeed:t.sprintSpeed,runSpeed:t.runSpeed,bodyScale:t.bodyScale,arms:t.arms,bodies};
 }
 return out;
}
const GOLDEN=JSON.parse(readFileSync(new URL('./people-template-golden.json',import.meta.url),'utf8'));
test('character templates and spawned bodies equal the uncached measurements exactly',async()=>{
 assert.deepEqual(JSON.parse(JSON.stringify(await measure())),GOLDEN);
});
