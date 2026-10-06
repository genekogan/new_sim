import test from 'node:test';
import assert from 'node:assert/strict';
import {connectedCommonsShoreFixture} from './connected-shore.ts';
import {EDEN_GROUND_EXTENSION_V1} from './eden-ground.ts';
test('World east/north level-zero additions preserve every old shore height/water/obstacle/link and refuse western flattening',async()=>{
 const old=await connectedCommonsShoreFixture(),expanded=await connectedCommonsShoreFixture(undefined,EDEN_GROUND_EXTENSION_V1);assert.deepEqual(expanded.terrain,old.terrain);assert.deepEqual(expanded.water,old.water);assert.deepEqual(expanded.scene.obstacles,old.scene.obstacles);assert.deepEqual(expanded.scene.links,old.scene.links);for(const s of old.scene.surfaces)assert.deepEqual(expanded.scene.surfaces.find(q=>q.id===s.id),s);assert.equal(expanded.scene.surfaces.length,old.scene.surfaces.length+2);assert.deepEqual(expanded.scene.bounds,[-62,-65,105,85]);for(const at of [[-54,0],[-46,0],[-30,0]] as [number,number][])assert.deepEqual(expanded.geometry.point(at),old.geometry.point(at));await assert.rejects(connectedCommonsShoreFixture(undefined,{version:'eden-expansion-ground/1',rectangles:[{id:'bad-west-floor',boundsXZ:[-80,-12,-46,12]}]}),/invalid-dry-extension/);
});
