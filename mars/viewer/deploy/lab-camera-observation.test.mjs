import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LabCameraGeometryCache, labCameraDiagnostic } from '../app/lab/camera-observation.ts';
import { Runtime } from '../engine/runtime/runtime.ts';
import { Spatial } from '../engine/spatial/service.ts';
import { emptyWorld, human, addAll, FIXTURE } from '../engine/world/factory.ts';

function setup() {
  const base = { bounds: [-10,-10,10,10], levels: [{id:0,y:0,label:'ground'}], surfaces: [{id:'ground',level:0,y:0,obb:{c:[0,0],half:[10,10],yaw:0}}], obstacles: [], links: [] };
  const chair = {id:'chair',def:'camp-chair',kind:'fixture',pose:{p:[3,0,3],yaw:0},provenance:FIXTURE};
  const world = addAll(emptyWorld('camera-hooks',base),chair,human('person',-4,-4));
  return new Runtime(world,new Map(),{spatial:new Spatial(base)});
}
test('camera geometry caches a frozen clone; actor movement does not invalidate, moved fixture does', () => {
  const rt = setup(), cache = new LabCameraGeometryCache(), original = rt.stateHash();
  const first = cache.read(rt,1); assert.ok(!('code' in first));
  assert.equal(rt.stateHash(),original); assert.equal(cache.read(rt,1),first);
  assert.equal(first.fixtures[0].id,'chair');
  assert.throws(() => {first.fixtures[0].obb.c[0] = 999;},TypeError);
  rt.world.entities.person.pose.p[0] += 1;
  assert.equal(cache.read(rt,1),first);
  rt.world.entities.chair.pose.p[0] += 2;
  const moved = cache.read(rt,1); assert.ok(!('code' in moved));
  assert.notEqual(moved,first); assert.ok(moved.epoch > first.epoch);
  assert.equal(first.fixtures[0].obb.c[0],3); assert.equal(moved.fixtures[0].obb.c[0],5);
  const fresh = cache.read(setup(),2); assert.ok(!('code' in fresh));
  assert.notEqual(fresh,moved); assert.equal(fresh.scenarioEpoch,2);
});
test('camera render requests reject invalid vectors and FOV without silent clamping', () => {
  assert.equal(labCameraDiagnostic([2,3,4],[0,1,0],20),null);
  assert.equal(labCameraDiagnostic([2,3,4],[0,1,0],80),null);
  for(const value of [NaN,Infinity,19.99,80.01]) assert.equal(labCameraDiagnostic([2,3,4],[0,1,0],value)?.code,'camera.lab.invalid-fov');
  for(const position of [[],[1,2],[1,2,3,4],[NaN,1,2],[Infinity,1,2],[0,1,0]]) assert.equal(labCameraDiagnostic(position,[0,1,0])?.code,'camera.lab.invalid-pose');
  assert.equal(labCameraDiagnostic([2,3,4],[NaN,1,0])?.code,'camera.lab.invalid-pose');
});
test('camera geometry names an unsupported scene without modifying the world', () => {
  const rt=setup(), before=rt.stateHash(); delete rt.services.spatial;
  assert.equal(new LabCameraGeometryCache().read(rt,1).code,'camera.lab.geometry-unavailable');
  assert.equal(rt.stateHash(),before);
});
