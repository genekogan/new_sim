import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { fadingLook, bodyMotion, WorldFadingLayer, FADING, BEAM_TOP_AT, beamedOut, parseFadeOverride } from '../src/WorldFading.ts';

test('colour: green early, yellow from 30, red with mist from 50, full mist at 60', () => {
  const g=fadingLook(5).colour.clone(),y=fadingLook(35).colour.clone(),r=fadingLook(55);
  assert.ok(g.g>g.r,'green');assert.ok(y.r>.9&&y.g>.5&&y.b<.2,'yellow (linear space)');assert.ok(r.colour.r>.9&&r.colour.g<.4,'red');
  assert.equal(fadingLook(40).mist,0);assert.ok(r.mist>0&&r.mist<1);assert.equal(fadingLook(FADING.beamAt).mist,1);
});

test('beam: column gathers over 5 s, body reclines and rises straight up at ~1.5 m/s to ~100 m, fading only at the top; never shrinks', () => {
  const start=bodyMotion('beam',0),in5=bodyMotion('beam',5),mid=bodyMotion('beam',40),top=bodyMotion('beam',BEAM_TOP_AT),end=bodyMotion('beam',FADING.beamSeconds);
  assert.equal(start.lift,0);assert.equal(start.beam,0);assert.ok(in5.beam>.99,'column fully in at 5 s');
  assert.ok(Math.abs(bodyMotion('beam',6).tilt+FADING.recline)<.05,'reclined by ~6 s');assert.ok(bodyMotion('beam',3).tilt<0&&bodyMotion('beam',3).tilt>-FADING.recline);
  assert.ok(Math.abs((bodyMotion('beam',31).lift-bodyMotion('beam',30).lift)-1.5)<1e-9,'1.5 m/s');
  assert.ok(mid.opacity===1&&mid.lift>50&&mid.lift<60);assert.ok(Math.abs(top.lift-100)<1e-6&&top.opacity<.01);
  assert.ok(BEAM_TOP_AT>60&&BEAM_TOP_AT<75);assert.ok(end.beam<.01);
  for(let t=0;t<80;t+=.5)assert.equal(bodyMotion('beam',t).scale,1);
  const fall=bodyMotion('reclaim',0),land=bodyMotion('reclaim',FADING.fallSeconds);
  assert.equal(fall.lift,FADING.fallHeight);assert.equal(land.lift,0);assert.equal((land as any).landed,true);
});

test('beam: the live body is hidden and a ghost copy rises; the ghost survives the body being removed; nothing accumulates', () => {
  const layer=new WorldFadingLayer(),body=new THREE.Group();body.add(new THREE.Mesh(new THREE.BoxGeometry(.4,1.8,.3),new THREE.MeshStandardMaterial()));body.position.set(1,0,2);
  // red first: a snapshot is kept
  layer.setStates(new Map([['s_a',{idleMinutes:55}]]));layer.update(0,0,()=>new THREE.Vector3(1,0,2),()=>body);layer.restore();
  layer.setStates(new Map([['s_a',{idleMinutes:60,beamedAt:1000}]]));
  layer.update(1000+30000,30,()=>null,()=>null);   // body already removed by Core
  const ghost=layer.group.getObjectByName('beam ghost')!;assert.ok(ghost&&ghost.visible,'ghost drawn');
  const y=new THREE.Vector3().setFromMatrixPosition(ghost.matrix).y;assert.ok(y>35&&y<45,'rising straight up: '+y);
  const x=new THREE.Vector3().setFromMatrixPosition(ghost.matrix);assert.ok(Math.hypot(x.x-1,x.z-2)<1.2,'no sideways pull');
  layer.restore();
  // body still present at the beam: hidden for the frame, restored after
  const live=new THREE.Group();live.add(new THREE.Mesh(new THREE.BoxGeometry(.4,1.8,.3),new THREE.MeshStandardMaterial()));
  layer.setStates(new Map([['s_b',{idleMinutes:60,beamedAt:0}]]));
  for(let f=0;f<3;f++){layer.update(500+f*100,f,()=>new THREE.Vector3(5,0,5),()=>live);assert.equal(live.visible,false);layer.restore();assert.equal(live.visible,true);assert.deepEqual(live.position.toArray(),[0,0,0]);}
  assert.deepEqual([...beamedOut(new Map([['s_b',{idleMinutes:60,beamedAt:0}]]),10)],['s_b']);
  layer.dispose();
});

test('preview override parsing', () => {
  const m=parseFadeOverride('?fade=Alice:42,Bob:beam, Carol:reclaim');
  assert.equal(m.get('alice'),'42');assert.equal(m.get('bob'),'beam');assert.equal(m.get('carol'),'reclaim');
});
