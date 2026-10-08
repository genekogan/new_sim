import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldBroadcast } from '../src/WorldBroadcast.ts';
import { WorldRenderedVisibility } from '../src/WorldRenderedVisibility.ts';
import type { Entity } from '../../../mars/viewer/engine/world/types.ts';
import type { SampledEntity } from '../../../mars/viewer/engine/take/replay.ts';

// Rendered architecture only: the native scene has no obstacles here, exactly
// like expansion buildings (scenery without native collision grants).
const scene = { bounds: [-30,-30,30,30] as [number,number,number,number], levels: [], surfaces: [], obstacles: [], links: [] };
type Box = [number,number,number,number,number,number];
const material = new THREE.MeshBasicMaterial();
function build(boxes: Box[]) {
  const group = new THREE.Group();
  for (const [x0,y0,z0,x1,y1,z1] of boxes) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1-x0,y1-y0,z1-z0), material);
    mesh.position.set((x0+x1)/2,(y0+y1)/2,(z0+z1)/2); group.add(mesh);
  }
  group.updateWorldMatrix(true,true);
  return group;
}
// 6 x 6 m room, 3 m walls 0.2 m thick, roofed. Optional 1.2 m doorway in +z.
function room(door: boolean): Box[] {
  const t=.2,h=3,r=3;
  const south: Box[] = door
    ? [[-r-t,0,r,-.6,h,r+t],[.6,0,r,r+t,h,r+t],[-.6,2.2,r,.6,h,r+t]]
    : [[-r-t,0,r,r+t,h,r+t]];
  return [[-r-t,0,-r-t,r+t,h,-r],...south,[-r-t,0,-r,-r,h,r],[r,0,-r,r+t,h,r],[-r-t,h,-r-t,r+t,h+t,r+t]];
}
// Pavilion: roof slab on four posts, open sides.
const pavilion: Box[] = [[-2.5,2.6,-2.5,2.5,2.8,2.5],...[[-2.4,-2.4],[2.2,-2.4],[-2.4,2.2],[2.2,2.2]].map(([x,z])=>[x,0,z,x+.2,2.6,z+.2] as Box)];

const inside = (p: number[], b: Box, pad=0) => p[0]>b[0]-pad&&p[0]<b[3]+pad&&p[1]>b[1]-pad&&p[1]<b[4]+pad&&p[2]>b[2]-pad&&p[2]<b[5]+pad;

function run(boxes: Box[]|THREE.Group, people: Record<string,[number,number,number,string]>, frames=300, move?: (f:number,frame:Record<string,SampledEntity>)=>void) {
  const roots=[Array.isArray(boxes)?build(boxes):boxes], camera=new WorldBroadcast(), probe=new WorldRenderedVisibility();probe.prepare(roots);
  const records:Record<string,Entity>={},frame:Record<string,SampledEntity>={};
  for(const [id,[x,z,yaw,activity]] of Object.entries(people)){records[id]={kind:'human'} as Entity;frame[id]={p:[x,0,z],yaw,pitch:0,roll:0,activity,state:{}} as SampledEntity;}
  const poses:{position:[number,number,number];target:[number,number,number];fov:number;visible:number;seen:number;clear:boolean}[]=[];
  let wall=0;
  for(let f=0;f<frames;f++){
    wall+=1/60;move?.(f,frame);
    const shot=camera.sample(structuredClone(frame),records,scene,Math.floor(wall*20),1/20,16/9,wall,1/60,roots);
    assert.ok(shot?.pose,`frame ${f}: a program pose exists (camera never left stuck)`);
    const ids=Object.keys(frame).filter(id=>Math.hypot(frame[id].p[0]-shot.pose.target[0],frame[id].p[2]-shot.pose.target[2])<3);
    const subjects=Object.fromEntries(Object.entries(frame).map(([id,e])=>[id,{p:e.p,yaw:e.yaw,height:e.activity==='sit'?1.35:1.75}]));
    poses.push({...shot.pose,seen:probe.evaluate(()=>probe.seen(shot.pose,ids,subjects)),visible:probe.evaluate(()=>probe.score(shot.pose,ids,subjects)),clear:probe.evaluate(()=>probe.clear(shot.pose.position,.39))});
  }
  return poses;
}
function assertIndoorQuality(poses: ReturnType<typeof run>, boxes: Box[], label: string) {
  let cuts=0;
  poses.forEach((p,i)=>{
    assert.ok(p.visible>=.85&&p.seen>=.85,`${label} frame ${i}: subject visible (${p.visible}/${p.seen})`);
    assert.ok(p.clear,`${label} frame ${i}: camera has rendered clearance`);
    for(const b of boxes)assert.ok(!inside(p.position,b,.3),`${label} frame ${i}: camera ${p.position} not in/against a wall solid`);
    assert.ok(p.fov>=20&&p.fov<=80);
    if(i&&Math.hypot(...p.position.map((v,k)=>v-poses[i-1].position[k]))>.5)cuts++;
  });
  assert.ok(cuts<=2,`${label}: stable framing (${cuts} cuts)`);
  const tail=poses.slice(-150);
  for(let i=1;i<tail.length;i++)assert.ok(Math.hypot(...tail[i].position.map((v,k)=>v-tail[i-1].position[k]))<.05,`${label}: settled, no oscillation`);
}

test('Roofed room with one doorway: Broadcast frames the Soul inside, clear of walls, stably', () => {
  const boxes=room(true);
  for (const yaw of [0,Math.PI/2,Math.PI,-Math.PI/2]) {
    const poses=run(boxes,{a:[0,-.5,yaw,'idle']});
    assertIndoorQuality(poses,boxes,`door yaw ${yaw}`);
  }
});

test('Closed roofed room: the camera goes inside rather than holding a facade', () => {
  const boxes=room(false);
  for (const [x,z,yaw] of [[0,0,0],[-1,1,2],[1.2,-1,-1]] as const) {
    const poses=run(boxes,{a:[x,z,yaw,'idle']});
    assertIndoorQuality(poses,boxes,`closed ${x},${z}`);
    for(const p of poses)assert.ok(Math.abs(p.position[0])<3&&Math.abs(p.position[2])<3&&p.position[1]<3,`camera inside the closed room: ${p.position}`);
  }
});

test('Conversation in a closed room keeps a readable inside view of both Souls', () => {
  const boxes=room(false);
  const poses=run(boxes,{a:[-.8,0,Math.PI/2,'talk'],b:[.8,0,-Math.PI/2,'listen']});
  assertIndoorQuality(poses,boxes,'closed pair');
});

test('Pavilion with open sides: Broadcast keeps clear of roof and posts', () => {
  for (const yaw of [0,1.3,2.6]) assertIndoorQuality(run(pavilion,{a:[0,0,yaw,'read']}),pavilion,`pavilion ${yaw}`);
});

test('Walking in through the doorway never leaves the program behind a wall', () => {
  const boxes=room(true);
  const poses=run(boxes,{a:[0,8,Math.PI,'walk']},480,(f,frame)=>{const u=Math.min(1,f/360);frame.a.p=[0,0,8-9*u];if(u>=1)frame.a.activity='idle';});
  poses.forEach((p,i)=>{
    assert.ok(p.visible>=.85,`walk frame ${i}: visible`);
    for(const b of boxes)assert.ok(!inside(p.position,b,.3),`walk frame ${i}: not in a wall`);
  });
});

test('Open ground: no rendered architecture leaves outdoor framing unchanged', () => {
  const plain=run([],{a:[0,0,0,'idle']},60), empty=new WorldBroadcast();
  const records={a:{kind:'human'}} as Record<string,Entity>;let wall=0;
  for(const p of plain){wall+=1/60;const shot=empty.sample({a:{p:[0,0,0],yaw:0,pitch:0,roll:0,activity:'idle',state:{}} as SampledEntity},records,scene,Math.floor(wall*20),1/20,16/9,wall,1/60,[]);assert.deepEqual(shot?.pose.position,p.position);}
});

test('Single-sided round tower: never framed from outside its drawn shell', () => {
  // Open-ended cylinder, outward faces only (like a drum/tower shell), with a
  // 50 degree doorway. Subject-side rays pass through its back faces; the
  // camera-side check must still refuse views that face the drawn outside.
  const tower=new THREE.Group(),shell=new THREE.Mesh(new THREE.CylinderGeometry(3,3,4,48,1,true,Math.PI/2+.45,2*Math.PI-.9),material);
  shell.position.y=2;tower.add(shell);tower.updateWorldMatrix(true,true);
  for (const yaw of [0,Math.PI/2,Math.PI,-Math.PI/2]) {
    const poses=run(tower,{a:[0,-.5,yaw,'idle']},120);
    poses.forEach((p,i)=>{assert.ok(p.seen>=.85,`tower yaw ${yaw} frame ${i}: drawn shell does not hide the Soul (${p.seen})`);assert.ok(p.visible>=.85);});
  }
});

test('Doorway room: a conversation is shot from inside the room, not through the door', () => {
  const boxes=room(true);
  for (const yaw of [0,Math.PI/2,-Math.PI/2]) {
    const poses=run(boxes,{a:[-.7,-.6,yaw,'talk'],b:[.7,-.6,yaw+Math.PI,'listen']},120);
    assertIndoorQuality(poses,boxes,`door pair ${yaw}`);
    const last=poses.at(-1)!;
    assert.ok(Math.abs(last.position[0])<3&&Math.abs(last.position[2])<3,`yaw ${yaw}: camera inside the room, got ${last.position}`);
  }
});

test('Roofed doorway room: even the wide shot of a lone idle Soul is taken from inside', () => {
  const boxes=room(true);
  for (const yaw of [0,Math.PI/2,Math.PI,-Math.PI/2]) {
    const poses=run(boxes,{a:[0,-.5,yaw,'idle']},120),last=poses.at(-1)!;
    assert.ok(Math.abs(last.position[0])<3&&Math.abs(last.position[2])<3&&last.position[1]<3,`yaw ${yaw}: camera inside, got ${last.position}`);
  }
});

test('A Soul embedded in scenery still gets a program pose (no stuck camera)', () => {
  // Torso inside a closed solid: no view passes either visibility rule; the
  // ordinary subject-side choice is kept, as before indoor framing existed.
  const roots=[build([[-.5,.8,-.5,.5,1.4,.5]])],camera=new WorldBroadcast(),records={a:{kind:'human'}} as Record<string,Entity>;
  let wall=0;for(let f=0;f<120;f++){wall+=1/60;
    const shot=camera.sample({a:{p:[0,0,0],yaw:0,pitch:0,roll:0,activity:'idle',state:{}} as SampledEntity},records,scene,Math.floor(wall*20),1/20,16/9,wall,1/60,roots);
    assert.ok(shot?.pose,`frame ${f}: program pose exists`);}
});
