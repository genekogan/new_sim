// E2 #7: a god world's landmarks had no Explore pictures (the generic house icon). The preview owner sliced only the old
// worlds' geometry roots, with an 8 m radius, and cached the empty result forever. Now LiveWorld passes the entity
// layer, each landmark carries the radius that holds its footprint, and an empty capture is retried on the next opening.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as THREE from 'three';
import {godTourViews} from '../src/world-env.ts';
import {WorldPlacePreviews} from '../src/WorldPlacePreviews.ts';

/** A 24 x 18 m hall at (60, 0, -40), built from 1 m tiles so slicing by radius is measurable. */
function hall(){const root=new THREE.Group();root.name='entity-world';const things=new THREE.Group();root.add(things);
 const g=new THREE.BoxGeometry(1,6,1),m=new THREE.MeshStandardMaterial({color:'#b98'});
 for(let x=-12;x<12;x++)for(const z of[-9,8]){const t=new THREE.Mesh(g,m);t.position.set(60.5+x,3,-40+z+.5);things.add(t);}
 for(let z=-9;z<9;z++)for(const x of[-12,11]){const t=new THREE.Mesh(g,m);t.position.set(60+x+.5,3,-40+z+.5);things.add(t);}
 return root;}
const model={editSeq:7,entities:new Map([['e1',{id:'e1',name:'town-hall',def:'core/hall@1',in:{parent:'world'}}]]),
 resolvedDef:()=>({tags:['building']}),footprint:()=>[{c:[60,-40] as [number,number],half:[12,9] as [number,number],y0:0,y1:6}]};

/** A renderer that records the scene it is asked to draw, then fails (so no canvas is needed). */
function recordingRenderer(seen:{triangles:number}[]){const v=new THREE.Vector4(),c=new THREE.Color();let target:unknown=null;
 return {autoClear:true,getRenderTarget:()=>target,setRenderTarget:(t:unknown)=>{target=t;},getViewport:(x:THREE.Vector4)=>x.copy(v),getScissor:(x:THREE.Vector4)=>x.copy(v),getScissorTest:()=>false,setScissorTest(){},setViewport(){},setScissor(){},getClearColor:(x:THREE.Color)=>x.copy(c),getClearAlpha:()=>1,setClearColor(){},
  render:(scene:THREE.Scene)=>{let triangles=0;scene.traverse(o=>{if(o instanceof THREE.Mesh&&!(o instanceof THREE.InstancedMesh))triangles+=o.geometry.getAttribute('position').count/3;});seen.push({triangles});throw Error('recorded');}} as unknown as THREE.WebGLRenderer;}

test('a god landmark view carries a radius that holds its whole footprint', () => {
  const [view] = godTourViews({model}, () => 0);
  assert.equal(view.id, 'god:e1');
  assert.ok(view.radius !== undefined && view.radius >= Math.hypot(12, 9), `radius ${view.radius}`);
});

test('the Explore picture of a god landmark slices the entity layer, all of it, and retries an empty capture', async () => {
  const [view] = godTourViews({model}, () => 0), building = hall(), all = 2 * 24 * 12 + 2 * 18 * 12;
  const seen: {triangles: number}[] = [];let roots: THREE.Object3D[] = [];
  const previews = new WorldPlacePreviews(recordingRenderer(seen), () => roots);
  const location = {id: view.id, label: view.label, regionId: view.id, p: view.p, target: view.target, radius: view.radius!};
  // before the layer draws anything: nothing to picture, and that is not remembered
  assert.equal(await previews.captureLocation(location, 'k'), null); assert.equal(seen.length, 0);
  roots = [new THREE.Group(), building];
  assert.equal(await previews.captureLocation(location, 'k'), null);
  assert.equal(seen.length, 1, 'retried after the entity layer was drawn');
  assert.equal(seen[0].triangles, all, 'every triangle of the 24 x 18 m hall is in the picture');
  // the previous fixed 8 m radius holds none of the hall's walls: no picture at all
  await previews.captureLocation({...location, radius: 8}, 'old');
  assert.equal(seen.length, 1, 'an 8 m slice of a 24 x 18 m hall is empty');
  previews.dispose();
});
