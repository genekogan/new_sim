import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {createEdenStreetProps} from '../../../mars/viewer/app/engine-view/content/assets/eden-street-props/index.ts';
import {STREET_PROP_PLACEMENTS} from '../../../mars/viewer/app/engine-view/content/assets/eden-street-props/placements.ts';
import {KINDS,mergeParts} from '../../../mars/viewer/app/engine-view/content/assets/eden-street-props/kit.ts';

// Placements were solved offline against every installed expansion object
// (world-props .e2e/check.mjs: zero overlap, route + door + visible-path clearance).
// Any change to them must re-run that check and update this digest.
const PLACEMENT_DIGEST='ed27eb042cbfc6a5';
const layout=JSON.parse(readFileSync(new URL('../../../mars/viewer/app/engine-view/content/eden-expansion/layout.v1.json',import.meta.url),'utf8'));
const total=Object.values(STREET_PROP_PLACEMENTS).reduce((a,l)=>a+l.length,0);
const height=(kind:string)=>{const g=mergeParts(KINDS[kind].parts());g.computeBoundingBox();const h=g.boundingBox!.max.y;g.dispose();return h;};

test('street props: few draws, budgets and flags', () => {
  const made=createEdenStreetProps(()=>0)!;
  assert.ok(made);
  const meshes=made.group.children as THREE.Mesh[];
  assert.ok(meshes.length<=24,`draw-call budget: ${meshes.length}`);
  let count=0;const seen=new Set<string>();
  for(const mesh of meshes){
    const kinds=mesh.userData.streetPropKinds as string[];count+=mesh.userData.streetPropCount;
    for(const kind of kinds){assert.ok(!seen.has(kind));seen.add(kind);
      const tris=mergeParts(KINDS[kind].parts()).attributes.position.count/3;assert.ok(tris<=420,`${kind} has ${tris} triangles`);
      // Shadows only for props taller than ~1 m; clutter never occludes Broadcast visibility.
      assert.equal(mesh.castShadow,KINDS[kind].shadow);if(mesh.castShadow)assert.ok(height(kind)>1,`${kind} casts shadow`);
      assert.equal(mesh.userData.cameraTransparent,true,'street props never occlude Broadcast visibility');}
    if(mesh instanceof THREE.InstancedMesh)assert.equal(mesh.count,STREET_PROP_PLACEMENTS[kinds[0]].length);
  }
  assert.equal(seen.size,Object.keys(STREET_PROP_PLACEMENTS).length);
  assert.equal(count,total);assert.equal(made.placed,total);
  assert.ok(new Set(meshes.map(m=>m.material)).size<=7,'shared class materials');
  made.dispose();assert.equal(made.group.children.length,0);
});

test('street props: refuse without ground, skip non-flat points', () => {
  assert.equal(createEdenStreetProps(undefined as any),null);
  const made=createEdenStreetProps((x)=>x>60?2:0)!;
  const expected=Object.values(STREET_PROP_PLACEMENTS).flat().filter(([x])=>x<=60).length;
  assert.equal(made.placed,expected);
  for(const mesh of made.group.children as THREE.Mesh[]){mesh.geometry.computeBoundingBox();if(!(mesh instanceof THREE.InstancedMesh))assert.ok(mesh.geometry.boundingBox!.max.x<=62);}
  made.dispose();
});

test('street props: placements pinned and clear of route centrelines', () => {
  assert.equal(createHash('sha256').update(JSON.stringify(STREET_PROP_PLACEMENTS)).digest('hex').slice(0,16),PLACEMENT_DIGEST);
  for(const [kind,list] of Object.entries(STREET_PROP_PLACEMENTS)){const g=mergeParts(KINDS[kind].parts());g.computeBoundingBox();
    list.forEach(([x,z,ry,,dy=0,sx=1],i)=>{const b=g.boundingBox!.clone().applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x,dy,z),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),ry),new THREE.Vector3(sx,1,1)));
      for(const r of layout.routes)for(let k=1;k<r.points.length;k++){const [ax,,az]=r.points[k-1],[cx,,cz]=r.points[k],L=Math.hypot(cx-ax,cz-az);
        for(let t=0;t<=L;t+=.1){const px=ax+(cx-ax)*t/L,pz=az+(cz-az)*t/L,d=Math.hypot(Math.max(b.min.x-px,0,px-b.max.x),Math.max(b.min.z-pz,0,pz-b.max.z));
          assert.ok(d>=1.2,`${kind}#${i} ${d.toFixed(2)} m from ${r.id}`);}}});g.dispose();}
});

test('street props: sign lettering is finite and wayfinding points at real destinations', async () => {
  const {signQuads,DESTINATIONS,STREET_SIGN_NAMES}=await import('../../../mars/viewer/app/engine-view/content/assets/eden-street-props/signs.ts');
  const quads=signQuads();assert.ok(quads.length>=40);
  for(const q of quads)assert.ok(q.m.elements.every(Number.isFinite),q.label.text);
  assert.equal(STREET_SIGN_NAMES.length,(STREET_PROP_PLACEMENTS.streetSign??[]).length);
  // Every wayfinding label faces along the board's pointing direction within ~37°.
  const names=new Map(DESTINATIONS.map(([n,x,z])=>[n,[x,z]]));
  let checked=0;
  for(const q of quads){const d=names.get(q.label.text);if(!d)continue;const p=new THREE.Vector3().setFromMatrixPosition(q.m);
    const right=new THREE.Vector3(1,0,0).transformDirection(q.m),to=new THREE.Vector3(d[0]-p.x,0,d[1]-p.z).normalize();
    // Board text reads along its face; the arrow points along local ±x (boards 1/3) or the face normal's tangent (board 2): accept either axis.
    const fwd=new THREE.Vector3(0,0,1).transformDirection(q.m);
    assert.ok(Math.max(Math.abs(right.dot(to)),Math.abs(fwd.dot(to)))>.75,`${q.label.text} label misaligned`);checked++;}
  assert.ok(checked>=10);
  // No DOM in node: the lettering mesh is simply absent.
  const {createEdenStreetSigns}=await import('../../../mars/viewer/app/engine-view/content/assets/eden-street-props/signs.ts');
  assert.equal(createEdenStreetSigns(),null);
});

test('street props: contact shadow blobs only under ground-standing non-casters', async () => {
  const {contactShadowQuads,createEdenContactShadows}=await import('../../../mars/viewer/app/engine-view/content/assets/eden-street-props/shadows.ts');
  const quads=contactShadowQuads();assert.ok(quads.length>100);
  for(const q of quads)assert.ok([q.x,q.z,q.ry,q.w,q.d,q.ox,q.oz].every(Number.isFinite)&&q.w>0&&q.d>0&&q.w<6&&q.d<6);
  assert.equal(createEdenContactShadows(()=>0),null,'no DOM → no blob mesh');
});
