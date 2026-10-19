// W3: the campus base tier's coarse furniture is swapped for the detail tier after arrival.
//   node --test apps/web/src/WorldBackdropTiers.test.ts
import test from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
import {dropCoarse} from './WorldBackdropTiers.ts';
import {WorldGeometry} from './WorldGeometry.ts';
import {BACKDROP_BLOBS,BACKDROP_DETAIL} from './backdrop-prefetch.ts';

const blobPath=/^\/blobs\/assets\/([0-9a-f]{2})\/([0-9a-f]{64})\.glb$/;
const mesh=(g:THREE.BufferGeometry,m:THREE.Material,coarse=false)=>{const x=new THREE.Mesh(g,m);if(coarse)x.userData.tier='coarse';return x;};

test('dropCoarse removes the coarse nodes and releases only what nothing else draws',()=>{
  const shared=new THREE.BoxGeometry(),own=new THREE.BoxGeometry(),keep=new THREE.MeshStandardMaterial(),tex=new THREE.Texture(),sharedTex=new THREE.Texture();
  const coarseMat=new THREE.MeshStandardMaterial({map:tex,emissiveMap:sharedTex});keep.map=sharedTex;
  const disposed:string[]=[];for(const [name,x] of Object.entries({shared,own,keep,tex,sharedTex,coarseMat}))x.addEventListener('dispose',()=>disposed.push(name));
  const root=new THREE.Group(),group=new THREE.Group();group.userData.tier='coarse';group.add(mesh(own,coarseMat));
  root.add(mesh(shared,keep),mesh(shared,coarseMat,true),group);
  assert.equal(dropCoarse(root),2);
  assert.equal(root.children.length,1,'only the exact mesh stays');
  assert.deepEqual(disposed.sort(),['coarseMat','own','tex']);
  assert.equal(dropCoarse(root),0);
});

test('the base tier blob brings its detail tier after arrival; the legacy fallback does not',async()=>{
  const url='/browser/campus.glb?v=20260922b';assert.match(BACKDROP_BLOBS[url]!,blobPath);assert.match(BACKDROP_DETAIL[url]!,blobPath);
  const base=()=>{const s=new THREE.Group();s.add(mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial()),mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial(),true));return{scene:s,animations:[]};};
  const detail=()=>{const s=new THREE.Group();s.add(mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial()));return{scene:s,animations:[]};};
  for(const blobOk of [true,false]){
    const calls:string[]=[];const loader={loadAsync:async(u:string)=>{calls.push(u);if(u.startsWith('/blobs/')&&!blobOk)throw Error('404');return u===BACKDROP_DETAIL[url]?detail():base();}};
    const geometry=new WorldGeometry(null as never);
    assert.equal(await geometry.addBackdrop({contract:'mars-campus-backdrop/1',url,at:[1,0,2]},loader as never),true);
    assert.equal(geometry.backdropDetailPending,blobOk);
    assert.equal(await geometry.addBackdropDetail(loader as never),blobOk);
    assert.equal(geometry.backdropDetailPending,false,'tried once');
    assert.deepEqual(calls,blobOk?[BACKDROP_BLOBS[url],BACKDROP_DETAIL[url]]:[BACKDROP_BLOBS[url],url]);
    const coarse:THREE.Object3D[]=[],named:string[]=[];geometry.group.traverse(o=>{if(o.userData.tier==='coarse')coarse.push(o);if(o.name.startsWith('mars-campus'))named.push(o.name);});
    assert.equal(coarse.length,blobOk?0:1,'coarse furniture leaves only when the detail arrived');
    assert.deepEqual(named.sort(),blobOk?['mars-campus-backdrop','mars-campus-detail']:['mars-campus-backdrop']);
    if(blobOk){let detailRoot:THREE.Object3D|undefined;geometry.group.traverse(o=>{if(o.name==='mars-campus-detail')detailRoot=o;});assert.deepEqual(detailRoot!.position.toArray(),[1,0,2],'detail placed like the base');}
  }
});

test('a failed detail load keeps the coarse furniture',async()=>{
  const url='/browser/campus.glb?v=20260922b';
  const loader={loadAsync:async(u:string)=>{if(u===BACKDROP_DETAIL[url])throw Error('offline');const s=new THREE.Group();s.add(mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial(),true));return{scene:s,animations:[]};}};
  const geometry=new WorldGeometry(null as never);
  assert.equal(await geometry.addBackdrop({contract:'mars-campus-backdrop/1',url,at:[0,0,0]},loader as never),true);
  assert.equal(await geometry.addBackdropDetail(loader as never),false);
  let coarse=0;geometry.group.traverse(o=>{if(o.userData.tier==='coarse')coarse++;});assert.equal(coarse,1);
});

test('the detail tier starts 1.5 s after the arrival is ready, once',async()=>{
  const url='/browser/campus.glb?v=20260922b';const calls:string[]=[];
  const loader={loadAsync:async(u:string)=>{calls.push(u);const s=new THREE.Group();s.add(mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial(),u!==BACKDROP_DETAIL[url]));return{scene:s,animations:[]};}};
  const geometry=new WorldGeometry(null as never);
  await geometry.addBackdrop({contract:'mars-campus-backdrop/1',url,at:[0,0,0]},loader as never);
  geometry.backdropDetailWhenSettled(loader as never,1000);geometry.backdropDetailWhenSettled(loader as never,2499);
  assert.equal(calls.length,1,'not yet');
  geometry.backdropDetailWhenSettled(loader as never,2500);geometry.backdropDetailWhenSettled(loader as never,2600);
  assert.deepEqual(calls,[BACKDROP_BLOBS[url],BACKDROP_DETAIL[url]]);
});
