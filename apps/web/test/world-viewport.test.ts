import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { visibleViewport, composeVisibleViewport } from '../src/WorldViewport.ts';
const close = (a:number,b:number) => assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
for (const [name,width,height,insets] of [
  ['phone bottom drawer',390,720,{bottom:280}],
  ['desktop right panel',1280,720,{right:360,top:64}],
  ['all edges',900,600,{left:150,right:40,top:30,bottom:100}],
  ['restored hidden panel',390,720,{}],
] as const) {
  test(`${name}: actual Three projection frames the target in visible pixels without changing Follow pose`,()=>{
    const camera=new PerspectiveCamera(45,width/height,.1,600),target=new Vector3(1,1,-2);
    camera.position.set(1,3,8);camera.lookAt(target);camera.updateMatrixWorld();
    const position=camera.position.toArray(),rotation=camera.quaternion.toArray();
    const area=composeVisibleViewport(camera,width,height,insets,45)!;
    const p=target.clone().project(camera);
    close((p.x+1)*width/2,area.left+area.width/2);
    close((1-p.y)*height/2,area.top+area.height/2);
    assert.deepEqual(camera.position.toArray(),position);assert.deepEqual(camera.quaternion.toArray(),rotation);
    // A point at the logical top edge projects to the visible rectangle's top.
    const distance=camera.position.distanceTo(target),up=new Vector3(0,1,0).applyQuaternion(camera.quaternion);
    const top=target.clone().addScaledVector(up,distance*Math.tan(Math.PI/8)).project(camera);
    close((1-top.y)*height/2,area.top);
    const right=new Vector3(1,0,0).applyQuaternion(camera.quaternion);
    const logicalRight=target.clone().addScaledVector(right,distance*Math.tan(Math.PI/8)*area.aspect).project(camera);
    close((logicalRight.x+1)*width/2,area.left+area.width);
    // Overlay removal restores the optical centre/full logical FOV exactly.
    composeVisibleViewport(camera,width,height,{},45);
    const restored=target.clone().project(camera);close(restored.x,0);close(restored.y,0);close(camera.fov,45);
  });
}
test('invalid and fully covered edge insets have honest visible-area behavior',()=>{
  assert.equal(visibleViewport(390,720,{bottom:720}),null);
  assert.equal(visibleViewport(390,720,{left:250,right:250}),null);
  assert.equal(visibleViewport(0,720),null);
  assert.deepEqual(visibleViewport(390,720,{top:NaN,bottom:-20}),{left:0,top:0,width:390,height:720,aspect:390/720});
  const camera=new PerspectiveCamera();const before=camera.projectionMatrix.toArray();
  assert.equal(composeVisibleViewport(camera,390,720,{bottom:720},45),null);
  assert.deepEqual(camera.projectionMatrix.toArray(),before,'a covered view never invents a valid crop');
});
