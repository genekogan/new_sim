import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldBroadcast } from '../src/WorldBroadcast.ts';
import type { Entity } from '../../../mars/viewer/engine/world/types.ts';
import type { SampledEntity } from '../../../mars/viewer/engine/take/replay.ts';

// Broadcast spreads each shot decision's candidate search over display frames
// (Director.advance). These checks pin the bounded per-frame work, the same
// editorial result as deciding on one frame, determinism and clean resets.
const scene = { bounds: [-40,-40,40,40] as [number,number,number,number], levels: [], surfaces: [], obstacles: [], links: [] };
const material = new THREE.MeshBasicMaterial();
function village() {
  const group = new THREE.Group();
  // Rows of huts and posts around a square: real occluders for every shot.
  for (let x=-24;x<=24;x+=8)for(const z of [-12,12]){const hut=new THREE.Mesh(new THREE.BoxGeometry(4,3,4),material);hut.position.set(x,1.5,z);group.add(hut);}
  for (let k=0;k<12;k++){const post=new THREE.Mesh(new THREE.CylinderGeometry(.15,.15,3),material);post.position.set(Math.cos(k/12*Math.PI*2)*7,1.5,Math.sin(k/12*Math.PI*2)*7);group.add(post);}
  group.updateWorldMatrix(true,true);
  return group;
}
type Cast = Record<string,[number,number,number,string]>;
const cast: Cast = { a:[0,0,0,'talk'], b:[1.4,.6,3,'listen'], c:[.5,1.8,2,'listen'], d:[-1.2,1,1,'idle'], w:[-14,-4,1.2,'walk'] };
/** Speaker rotates every 2 s; the walker crosses the square. */
function script(f: number, frame: Record<string,SampledEntity>) {
  const t=f/60,k=Math.floor(t/2)%3;
  ['a','b','c'].forEach((id,i)=>{frame[id].activity=i===k?'talk':'listen';});
  frame.w.p=[-14+t*1.3,0,-4+t*.3];
}
function run(sync: boolean, frames=720, seekAt=-1) {
  const roots=[village()], camera=new WorldBroadcast(), director=(camera as any).director, rendered=(camera as any).rendered;
  // Reference: the whole decision on the frame it is due (pre-amortisation).
  if(sync)director.advance=(o:unknown,dt:number,start:boolean)=>start?director.update(o,dt):director.track(o,dt);
  const records:Record<string,Entity>={},frame:Record<string,SampledEntity>={};
  for(const [id,[x,z,yaw,activity]] of Object.entries(cast)){records[id]={kind:'human'} as Entity;frame[id]={p:[x,0,z],yaw,pitch:0,roll:0,activity,state:{}} as SampledEntity;}
  const out:{shot?:string;pose:{position:number[];target:number[];fov:number};work:number}[]=[];
  for(let f=0;f<frames;f++){
    // After seekAt the take restarts at its beginning (tick goes back).
    const g=seekAt>=0&&f>=seekAt?f-seekAt:f,wall=(g+1)/60;script(g,frame);
    const before=rendered.work;
    const shot=camera.sample(structuredClone(frame),records,scene,Math.floor(wall*20),1/20,16/9,wall,1/60,roots);
    assert.ok(shot?.pose,`frame ${f}: a program pose exists`);
    out.push({shot:shot.shot,pose:shot.pose,work:rendered.work-before});
  }
  return out;
}

test('Broadcast decision work is spread over frames: bounded rendered rays per display frame', () => {
  const live=run(false), sync=run(true);
  const peak=(r:typeof live)=>Math.max(...r.slice(1).map(x=>x.work));
  // The one-frame decision casts its whole search at once; slices stay near
  // the per-frame budget (one search step may finish past it).
  assert.ok(peak(sync)>250,`reference decisions are heavy (${peak(sync)} rays)`);
assert.ok(peak(live)<=200,`sliced decisions stay bounded (${peak(live)} rays)`);
});

test('Sliced decisions choose the same shots as one-frame decisions, at most a few frames later', () => {
  const live=run(false), sync=run(true);
  const changes=(r:typeof live)=>r.flatMap((x,i)=>i&&x.shot!==r[i-1].shot?[{i,shot:x.shot}]:[]);
  const a=changes(sync), b=changes(live);
assert.ok(a.length>=2,`the script makes editorial changes (${a.length})`);
  assert.deepEqual(b.map(x=>x.shot),a.map(x=>x.shot),'same shot sequence');
  b.forEach((x,k)=>assert.ok(x.i-a[k].i>=0&&x.i-a[k].i<=4,`change ${k} lags ${x.i-a[k].i} frames`));
  const same=live.filter((x,i)=>x.shot===sync[i].shot).length;
  assert.ok(same/live.length>.97,`same shot on ${same}/${live.length} frames`);
});

test('Sliced decisions are deterministic and a seek resets cleanly', () => {
  assert.deepEqual(run(false,360),run(false,360),'identical pose sequences');
  // Seek back to the start: the next frame is a fresh decision, exactly what
  // a new camera gives for that frame.
  const seek=run(false,400,300), fresh=run(false,100);
  assert.deepEqual(seek[300].pose,fresh[0].pose,'post-seek frame equals a fresh camera');
});
