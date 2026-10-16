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

test('a thing that carves its own ground (a sunken pool) is still a landmark; a landform-only def is not', () => {
  const fp = () => [{c: [0, 0] as [number, number], half: [8, 5.5] as [number, number], y0: -1.6, y1: 0.2}];
  const m = (make: {kind: string}) => ({editSeq: Math.random(), entities: new Map([['p1', {id: 'p1', name: 'lido', def: 'core/swimming-pool@1', in: {parent: 'world'}}]]),
    resolvedDef: () => ({tags: ['water', 'body'], components: {landform: {kind: 'carve'}}, make}), footprint: fp});
  assert.equal(godTourViews({model: m({kind: 'gen'})}, () => 0)[0]?.label, 'lido');
  assert.equal(godTourViews({model: m({kind: 'none'})}, () => 0).length, 0);
});

test("a god thing drawn as instances is pictured even when its palette names water (a pool's parts)", async () => {
  const seen: {triangles: number}[] = [], box = new THREE.BoxGeometry(10, 1, 5), mat = new THREE.MeshStandardMaterial();
  const inst = new THREE.InstancedMesh(box, mat, 1); inst.name = 'instances:kit/2|abc:{"deck":"#ddd","water":"#4fb0c8"}:111:0';
  inst.setMatrixAt(0, new THREE.Matrix4().makeTranslation(30, 0, -10)); const g = new THREE.Group(); g.add(inst);
  let rendered = 0;
  const renderer = {...(recordingRenderer(seen) as any), render: () => { rendered++; throw Error('recorded'); }} as unknown as THREE.WebGLRenderer;
  const previews = new WorldPlacePreviews(renderer, () => [g]);
  await previews.captureLocation({id: 'god:p', label: 'lido', regionId: 'god:p', p: [40, 10, 0], target: [30, 0, -10], radius: 10}, 'k');
  assert.equal(rendered, 1, 'the instanced pool was put in the picture');
  previews.dispose();
});
