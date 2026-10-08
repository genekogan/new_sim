import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {HumanViews} from '../../../mars/viewer/app/engine-view/humans.ts';
import {templateFromGltf} from '../../../mars/viewer/app/engine-view/people.ts';

test('uploaded node names cannot replace another actor root used for avatars or Eyes hiding',async()=>{
 // Real canonical mesh/skin/clips, with textures removed only for this CPU geometry proof.
 const source=readFileSync(new URL('../../../mars/viewer/public/modular/environment/animated-casual.glb',import.meta.url));
 const jsonSize=source.readUInt32LE(12),json=JSON.parse(source.subarray(20,20+jsonSize).toString()),binHeader=20+jsonSize;
 json.materials=json.materials.map(()=>({pbrMetallicRoughness:{baseColorFactor:[.5,.5,.5,1],metallicFactor:0,roughnessFactor:.8}}));delete json.textures;delete json.images;delete json.samplers;
 let chunk=Buffer.from(JSON.stringify(json));chunk=Buffer.concat([chunk,Buffer.alloc((4-chunk.length%4)%4,32)]);const bin=source.subarray(binHeader);
 const header=Buffer.alloc(20);source.copy(header,0,0,12);header.writeUInt32LE(20+chunk.length+bin.length,8);header.writeUInt32LE(chunk.length,12);header.writeUInt32LE(0x4e4f534a,16);
 const bytes=Buffer.concat([header,chunk,bin]);const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 const spoof=new THREE.Group();spoof.name='victim';spoof.userData.entity='victim';gltf.scene.add(spoof);
 const view=new HumanViews();view.setTemplates([templateFromGltf('owned-canonical-proof',gltf)]);
 view.setFrame([{id:'uploader',p:[0,0,0],yaw:0,walk:0,walkDist:0},{id:'victim',p:[3,0,0],yaw:0,walk:0,walkDist:0}],0);
 assert.notEqual(view.group.getObjectByName('victim'),view.bodyObject('victim'),'a name search reaches an uploaded spoof first');
 assert.equal(view.bodyObject('victim')?.parent,view.group);assert.equal(view.bodyObject('victim')?.name,'victim');assert.equal(view.bodyObject('unrelated'),null);
 assert.equal(view.bodyObject('uploader')?.getObjectByName('victim')?.userData.entity,'uploader','uploaded extras cannot impersonate hover identity');
 const performer={id:'uploader',p:[0,.6,0] as [number,number,number],yaw:0,walk:0,walkDist:0,activity:'play-music',instrument:'guitar',activityAge:3};
 view.setFrame([performer],3);view.render(1);view.group.updateMatrixWorld(true);
 const guitar=view.bodyObject('uploader')?.getObjectByName('activity prop: guitar');
 assert.ok(guitar?.visible,'recorded guitar musician carries a visible instrument');
 const bounds=new THREE.Box3().setFromObject(guitar);
 assert.ok(!bounds.isEmpty()&&[...bounds.min.toArray(),...bounds.max.toArray()].every(Number.isFinite));
 assert.ok(bounds.min.y>.6&&bounds.max.y<3,'held instrument follows the elevated actual actor, not the ground stand');
 view.setFrame([{...performer,hands:{left:[.3,1.8,-.2],right:[.3,1.6,.2]}}],4);view.render(1);
 assert.equal(guitar.visible,false,'native hand contacts take priority over cosmetic instrument props');
 view.setFrame([{...performer,instrument:'keyboard'}],5);view.render(1);
 assert.equal(guitar.visible,false,'stationary keyboard does not leave a stale guitar in the hands');
 view.clear();assert.equal(view.bodyObject('victim'),null);
});
