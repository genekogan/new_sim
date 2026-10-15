import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {carrierEntity} from '../../../mars/viewer/engine/vehicles/carrier.ts';
import {rowingPuntObject} from '../../../mars/viewer/app/engine-view/rowing-punt.ts';
import {activityBase,activityFrame} from '../../../mars/viewer/app/engine-view/activity-poses.ts';

test('punt depiction has two thwarts, four moving oars and a fixed bank plank; seated rowers share sim-time phase',()=>{
  const entity=carrierEntity({id:'punt',def:'rowing-punt',at:[0,0],y:-.2,route:'test',routeKeys:[{t:0,p:[0,-.2,0]},{t:30,p:[0,-.2,0]}],bank:{door:[3.1,0,0],exits:{'rider-a':[3.6,0,-.85],'rider-b':[3.6,0,.85]}}},0);
  assert.ok(!('code'in entity));const visual=rowingPuntObject(entity);
  assert.equal(visual.group.children.filter(x=>x instanceof THREE.Group).length,4);
  assert.ok(visual.dock.children.length>=3);const dockBefore=visual.dock.matrixWorld.toArray();
  visual.update(0,true);const a=visual.group.children.filter(x=>x instanceof THREE.Group).map(o=>o.rotation.toArray());
  visual.update(.65,true);const b=visual.group.children.filter(x=>x instanceof THREE.Group).map(o=>o.rotation.toArray());
  assert.notDeepEqual(a,b);assert.deepEqual(visual.dock.matrixWorld.toArray(),dockBefore);
  assert.equal(activityBase('row','sit'),'sit');
  assert.deepEqual(activityFrame('row','sit',.65,'ana'),activityFrame('row','sit',.65,'ben'),'partners pull in step independent of body id');
  assert.notDeepEqual(activityFrame('row','sit',0,'ana')?.hands,activityFrame('row','sit',.65,'ana')?.hands);
  visual.dispose();
});
