import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// Pure bounded fixture builders for BODY admission tests.
export const RIGID_MANIFEST={type:'ceramic',license:'owned',rightsConfirmed:true};
export function packGLB(j:unknown,bin:Buffer){const raw=Buffer.from(JSON.stringify(j)),json=Buffer.alloc(Math.ceil(raw.length/4)*4,32);raw.copy(json);const binary=Buffer.alloc(Math.ceil(bin.length/4)*4);bin.copy(binary);const b=Buffer.alloc(28+json.length+binary.length);b.writeUInt32LE(0x46546c67,0);b.writeUInt32LE(2,4);b.writeUInt32LE(b.length,8);b.writeUInt32LE(json.length,12);b.writeUInt32LE(0x4e4f534a,16);json.copy(b,20);b.writeUInt32LE(binary.length,20+json.length);b.writeUInt32LE(0x004e4942,24+json.length);binary.copy(b,28+json.length);return b;}
export function rigidGLB(change?:(j:any,b:Buffer)=>void){const b=Buffer.alloc(36);[0,0,0,1,0,0,0,1,0].forEach((v,i)=>b.writeFloatLE(v,i*4));const j:any={asset:{version:'2.0'},buffers:[{byteLength:b.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:36}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3'}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0};change?.(j,b);return packGLB(j,b);}

// Owned upload derivative: retain the canonical visible mesh, skin and embedded image
// bytes, but remove unrelated animation clips and all their unused accessors/views.
// The complete renderer asset intentionally has many more clips than uploads allow.
type RigFixtureGLTF={
 animations:{name:string;samplers:{input:number;output:number}[]}[];
 meshes:{primitives:{attributes:Record<string,number>;indices?:number;targets?:Record<string,number>[]}[]}[];
 skins?:{inverseBindMatrices?:number}[];images?:{bufferView?:number}[];
 accessors:{bufferView:number;sparse?:unknown}[];
 bufferViews:{buffer:number;byteOffset?:number;byteLength:number}[];
 buffers:{byteLength:number;uri?:string}[];
};
export function canonicalHumanoidGLB(source=readFileSync(process.env.BODY_TEST_ASSET??new URL('../../../../../mars/viewer/public/modular/environment/animated-casual.glb',import.meta.url))){
 assert.equal(source.readUInt32LE(0),0x46546c67);assert.equal(source.readUInt32LE(4),2);
 const n=source.readUInt32LE(12),j=JSON.parse(source.toString('utf8',20,20+n)) as RigFixtureGLTF,bin=source.subarray(28+n);
 assert.equal(j.buffers.length,1);assert.equal(j.buffers[0].uri,undefined);
 j.animations=j.animations.filter(a=>a.name==='Idle'||a.name==='Walk');
 assert.deepEqual(j.animations.map(a=>a.name).sort(),['Idle','Walk']);
 const used=new Set<number>();const use=(i:number)=>{assert.ok(Number.isInteger(i)&&i>=0&&i<j.accessors.length);used.add(i);};
 for(const mesh of j.meshes)for(const p of mesh.primitives){Object.values(p.attributes).forEach(use);if(p.indices!==undefined)use(p.indices);for(const target of p.targets??[])Object.values(target).forEach(use);}
 for(const skin of j.skins??[])if(skin.inverseBindMatrices!==undefined)use(skin.inverseBindMatrices);
 for(const a of j.animations)for(const sampler of a.samplers){use(sampler.input);use(sampler.output);}
 const ai=[...used].sort((a,b)=>a-b),amap=new Map(ai.map((i,n)=>[i,n])),remap=(i:number)=>{const n=amap.get(i);assert.notEqual(n,undefined);return n!;};
 for(const mesh of j.meshes)for(const p of mesh.primitives){for(const key of Object.keys(p.attributes))p.attributes[key]=remap(p.attributes[key]);if(p.indices!==undefined)p.indices=remap(p.indices);for(const target of p.targets??[])for(const key of Object.keys(target))target[key]=remap(target[key]);}
 for(const skin of j.skins??[])if(skin.inverseBindMatrices!==undefined)skin.inverseBindMatrices=remap(skin.inverseBindMatrices);
 for(const a of j.animations)for(const sampler of a.samplers){sampler.input=remap(sampler.input);sampler.output=remap(sampler.output);}
 j.accessors=ai.map(i=>j.accessors[i]);const views=new Set<number>();
 for(const a of j.accessors){assert.equal(a.sparse,undefined);views.add(a.bufferView);}
 for(const image of j.images??[]){assert.notEqual(image.bufferView,undefined);views.add(image.bufferView!);}
 const vi=[...views].sort((a,b)=>a-b),vmap=new Map(vi.map((i,n)=>[i,n]));let offset=0;const chunks:Buffer[]=[];
 j.bufferViews=vi.map(i=>{const v=j.bufferViews[i];assert.ok(v);assert.equal(v.buffer,0);const start=v.byteOffset??0;assert.ok(start>=0&&start+v.byteLength<=bin.length);const bytes=bin.subarray(start,start+v.byteLength),next={...v,byteOffset:offset};chunks.push(bytes,Buffer.alloc((4-bytes.length%4)%4));offset+=Math.ceil(bytes.length/4)*4;return next;});
 for(const a of j.accessors)a.bufferView=vmap.get(a.bufferView)!;
 for(const image of j.images??[])image.bufferView=vmap.get(image.bufferView!)!;
 j.buffers=[{byteLength:offset}];return packGLB(j,Buffer.concat(chunks));
}
