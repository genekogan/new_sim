import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import {dequantizeBackdrop} from './WorldBackdropDequantize.ts';
import {WorldGeometry,BACKDROP_BLOBS} from './WorldGeometry.ts';

test('dequantizeBackdrop turns quantized position/normal/uv back into the Float32 values three would draw',()=>{
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.BufferAttribute(new Int16Array([32767,0,-32767]),3,true));
  g.setAttribute('normal',new THREE.BufferAttribute(new Int8Array([0,127,0]),3,true));
  g.setAttribute('uv',new THREE.BufferAttribute(new Uint16Array([65535,0]),2,true));
  g.setAttribute('color',new THREE.BufferAttribute(new Uint16Array([65535,0,0]),3,true));
  const root=new THREE.Group();root.add(new THREE.Mesh(g),new THREE.Mesh(g));
  assert.equal(dequantizeBackdrop(root),3,'shared geometry converted once; colours untouched');
  assert.ok(g.attributes.position.array instanceof Float32Array);assert.deepEqual([...g.attributes.position.array],[1,0,-1]);
  assert.deepEqual([...g.attributes.normal.array],[0,1,0]);assert.deepEqual([...g.attributes.uv.array],[1,0]);
  assert.equal(g.attributes.position.normalized,false);assert.ok(g.attributes.color.array instanceof Uint16Array);
});

test('addBackdrop loads the hashed blob, and falls back to the legacy name when the blob is unavailable',async()=>{
  const url='/browser/campus.glb?v=20260922b';assert.match(BACKDROP_BLOBS[url]!,/^\/blobs\/assets\/[0-9a-f]{2}\/[0-9a-f]{64}\.glb$/);
  const scene=()=>{const s=new THREE.Group();s.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial()));return{scene:s,animations:[]};};
  for(const blobOk of [true,false]){
    const calls:string[]=[];const loader={loadAsync:async(u:string)=>{calls.push(u);if(u.startsWith('/blobs/')&&!blobOk)throw Error('404');return scene();}};
    const geometry=new WorldGeometry(null as never);
    assert.equal(await geometry.addBackdrop({contract:'mars-campus-backdrop/1',url,at:[0,0,0]},loader as never),true);
    assert.deepEqual(calls,blobOk?[BACKDROP_BLOBS[url]]:[BACKDROP_BLOBS[url],url]);
  }
});
