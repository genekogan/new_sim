import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldBroadcast, followWeight } from '../src/WorldBroadcast.ts';
import type { Entity } from '../../../mars/viewer/engine/world/types.ts';
import type { SampledEntity } from '../../../mars/viewer/engine/take/replay.ts';

const scene = { bounds: [-22,-22,22,22] as [number,number,number,number], levels: [], surfaces: [], obstacles: [], links: [] };
const frame: Record<string, SampledEntity> = {
  a: { p: [0,0,0], yaw: 0, pitch: 0, roll: 0, activity: 'presenting', state: {} },
  b: { p: [3,0,0], yaw: Math.PI, pitch: 0, roll: 0, activity: 'listen', state: {} },
};
const records = { a: { kind: 'human' }, b: { kind: 'human' } } as Record<string, Entity>;

test('Broadcast consumes public sampled activity, gives readable safe poses and never mutates takes', () => {
  const camera = new WorldBroadcast(), before = JSON.stringify([frame,records,scene]);
  const first = camera.sample(frame,records,scene,100,.05,16/9,0,1/60);
  assert.ok(first?.pose);
  assert.ok(first.shot?.includes('a'));
  for (let i=1; i<20; i++) assert.ok(camera.sample(frame,records,scene,100+i/3,.05,16/9,i/60,1/60)?.pose);
  assert.equal(JSON.stringify([frame,records,scene]),before);
  const rewind = camera.sample(frame,records,scene,80,.05,16/9,1,1/60);
  assert.deepEqual(rewind?.pose, first.pose, 'historical seek resets the old camera motion');
});

test('Broadcast waits for real scene and actors; follow response is frame-rate independent', () => {
  const camera = new WorldBroadcast();
  assert.equal(camera.sample(frame,records,null,0,.05,1,0,1/60),null);
  assert.equal(camera.sample({},records,scene,0,.05,1,0,1/60),null);
  const response = (fps: number) => { let x=0; for(let i=0;i<fps;i++)x+=(1-x)*followWeight(1/fps); return x; };
  assert.ok(Math.abs(response(30)-response(120))<1e-12);
  assert.equal(followWeight(0),0);
});
