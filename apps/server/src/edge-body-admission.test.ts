import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {admitBodyGLB,BODY_LIMITS} from './edge/body/admission.ts';
import {RIGID_MANIFEST,packGLB,rigidGLB,canonicalHumanoidGLB} from './edge/body/testing.ts';
import {deflateSync} from 'node:zlib';
const code=(f:()=>unknown,c:string)=>assert.throws(f,(e:any)=>e.code===c);
function png(w:number,h:number){const chunk=(name:string,data:Buffer)=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(name,4,4,'ascii');data.copy(b,8);let crc=0xffffffff;for(const byte of b.subarray(4,-4)){crc^=byte;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}b.writeUInt32BE((crc^0xffffffff)>>>0,b.length-4);return b;};const head=Buffer.alloc(13);head.writeUInt32BE(w);head.writeUInt32BE(h,4);head[8]=8;head[9]=6;return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',head),chunk('IDAT',deflateSync(Buffer.alloc(h*(w*4+1)))),chunk('IEND',Buffer.alloc(0))]);}
function textured(image:Buffer,count=1,mimeType='image/png'){const base=rigidGLB(),n=base.readUInt32LE(12),j=JSON.parse(base.toString('utf8',20,20+n)),bin=Buffer.concat([base.subarray(28+n),image]);j.buffers[0].byteLength=bin.length;j.bufferViews.push({buffer:0,byteOffset:36,byteLength:image.length});j.images=Array.from({length:count},()=>({bufferView:1,mimeType}));return packGLB(j,bin);}
test('BODY admission: embedded image completeness, dimensions, count and byte budget',()=>{
 const image=png(1,1);assert.equal(admitBodyGLB(textured(image),RIGID_MANIFEST).images,1);
 code(()=>admitBodyGLB(textured(image.subarray(0,24)),RIGID_MANIFEST),'body.image-invalid');
 const corrupt=Buffer.from(image);corrupt[corrupt.length-1]^=1;code(()=>admitBodyGLB(textured(corrupt),RIGID_MANIFEST),'body.image-invalid');
 code(()=>admitBodyGLB(textured(png(2049,1)),RIGID_MANIFEST),'body.image-too-large');
 code(()=>admitBodyGLB(textured(image,9),RIGID_MANIFEST),'body.too-complex');
 code(()=>admitBodyGLB(textured(Buffer.alloc(BODY_LIMITS.imageBytes+1)),RIGID_MANIFEST),'body.image-too-large');
 const jpeg=readFileSync(new URL('../test/fixtures/sample-texture.jpg', import.meta.url));assert.equal(admitBodyGLB(textured(jpeg,1,'image/jpeg'),RIGID_MANIFEST).images,1);
 code(()=>admitBodyGLB(textured(jpeg.subarray(0,-2),1,'image/jpeg'),RIGID_MANIFEST),'body.image-invalid');
});

test('BODY admission: content addressed rigid GLB; malformed/external/extensions/count/finite geometry refusals',()=>{
 const b=rigidGLB(),a=admitBodyGLB(b,RIGID_MANIFEST);assert.equal(a.triangles,1);assert.match(a.assetId,/^body_[a-f0-9]{64}$/);assert.deepEqual(admitBodyGLB(b,RIGID_MANIFEST),a);
 code(()=>admitBodyGLB(b,{...RIGID_MANIFEST,rightsConfirmed:false}),'body.rights');code(()=>admitBodyGLB(Buffer.alloc(BODY_LIMITS.bytes+1),RIGID_MANIFEST),'body.too-large');
 code(()=>admitBodyGLB(b.subarray(0,-1),RIGID_MANIFEST),'body.invalid');
 for(const uri of ['https://example.invalid/secret','data:application/octet-stream;base64,AAAA'])code(()=>admitBodyGLB(rigidGLB(j=>j.buffers[0].uri=uri),RIGID_MANIFEST),'body.external-resource');
 code(()=>admitBodyGLB(rigidGLB(j=>j.nodes[0].extensions={BAD_script:{url:'javascript:'}}),RIGID_MANIFEST),'body.extension');
 code(()=>admitBodyGLB(rigidGLB(j=>j.accessors[0].count=999999),RIGID_MANIFEST),'body.invalid');
 code(()=>admitBodyGLB(rigidGLB((_,b)=>b.writeFloatLE(NaN,0)),RIGID_MANIFEST),'body.invalid');
 code(()=>admitBodyGLB(rigidGLB(j=>j.nodes[0].children=[0]),RIGID_MANIFEST),'body.invalid');
 code(()=>admitBodyGLB(rigidGLB(j=>j.nodes[0].scale=[0,0,0]),RIGID_MANIFEST),'body.mesh-bounds');
 code(()=>admitBodyGLB(rigidGLB(j=>j.nodes[0].scale=[1e308,1e308,1e308]),RIGID_MANIFEST),'body.mesh-bounds');
 code(()=>admitBodyGLB(rigidGLB((_,b)=>{for(let i=0;i<3;i++)b.writeFloatLE(0,i*12+4);}),RIGID_MANIFEST),'body.mesh-bounds');
 code(()=>admitBodyGLB(rigidGLB(j=>j.skins=[{joints:[0]}]),RIGID_MANIFEST),'body.rigid');
 code(()=>admitBodyGLB(rigidGLB(j=>j.meshes[0].primitives[0].mode=1),RIGID_MANIFEST),'body.mesh-mode');
 const huge=Buffer.alloc(300003*12),j={asset:{version:'2.0'},buffers:[{byteLength:huge.length}],bufferViews:[{buffer:0,byteLength:huge.length}],accessors:[{bufferView:0,componentType:5126,count:300003,type:'VEC3'}],meshes:[{primitives:[{attributes:{POSITION:0}}]}]};code(()=>admitBodyGLB(packGLB(j,huge),RIGID_MANIFEST),'body.too-complex');
});
test('BODY admission: actual canonical Quaternius humanoid admits; missing bone/hierarchy/skin/clip refuse',()=>{
 const b=canonicalHumanoidGLB(),m={type:'humanoid',license:'CC0',rightsConfirmed:true,rig:'quaternius/1'};
 const a=admitBodyGLB(b,m);assert.equal(a.rig,'quaternius/1');assert.ok(a.triangles>100);assert.ok(a.triangles<BODY_LIMITS.triangles);
 const n=b.readUInt32LE(12),j=JSON.parse(b.toString('utf8',20,20+n)),bin=b.subarray(28+n);const altered=(fn:(j:any)=>void)=>{const clone=structuredClone(j);fn(clone);return packGLB(clone,bin);};
 code(()=>admitBodyGLB(b,{...m,rig:'arbitrary/1'}),'body.rig');
 code(()=>admitBodyGLB(altered(j=>j.nodes.find((n:any)=>n.name==='Head').name='OtherHead'),m),'body.rig');
 code(()=>admitBodyGLB(altered(j=>j.skins[0].joints=j.skins[0].joints.filter((i:number)=>j.nodes[i].name!=='Head')),m),'body.rig');
 code(()=>admitBodyGLB(altered(j=>j.animations=j.animations.filter((a:any)=>a.name!=='Walk')),m),'body.clips');
 code(()=>admitBodyGLB(altered(j=>j.nodes.find((n:any)=>n.name==='CharacterArmature').scale=[0,0,0]),m),'body.mesh-bounds');
 code(()=>admitBodyGLB(altered(j=>{for(const n of j.nodes)if(['LowerArm.L','Wrist.L'].includes(n.name))n.translation=[0,0,0];}),m),'body.rig');
 code(()=>admitBodyGLB(altered(j=>{const n=j.nodes.find((n:any)=>n.name==='LowerArm.L');n.translation=n.translation.map((v:number)=>v*100);}),m),'body.rig');
 code(()=>admitBodyGLB(altered(j=>{const feet=j.nodes.map((n:any,i:number)=>/^Foot[.]?[LR]$/.test(n.name)?i:-1);j.animations.find((a:any)=>a.name==='Walk').channels=j.animations.find((a:any)=>a.name==='Walk').channels.filter((c:any)=>!feet.includes(c.target.node));}),m),'body.clips');
 const c=structuredClone(j),head=c.nodes.findIndex((n:any)=>n.name==='Head');for(const node of c.nodes)node.children=node.children?.filter((i:number)=>i!==head);c.nodes.find((n:any)=>n.name==='Root').children.push(head);code(()=>admitBodyGLB(packGLB(c,bin),m),'body.rig');
});
