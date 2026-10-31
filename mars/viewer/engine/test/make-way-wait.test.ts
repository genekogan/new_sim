import test from 'node:test';
import assert from 'node:assert/strict';
import {Runtime} from '../runtime/runtime.ts';
import {DEFAULT_INVARIANTS} from '../runtime/invariants.ts';
import {Spatial} from '../spatial/service.ts';
import {provingGround} from '../scenes/proving-ground.ts';
import {emptyWorld,human,addAll} from '../world/factory.ts';
import type {ActionDef} from '../actions/types.ts';
import {walkTo} from '../locomotion/walk.ts';

// M03 (Soul Actions entry 28): an action for a body that is mid courtesy step-aside waits the nudge out and then runs,
// planned from where the body stands; it used to fail at once with reservation.conflict (only pose_v1 waited).
function fixture(){const scene=provingGround();const world=addAll(emptyWorld('proving-ground',scene),human('a',-6,-6),human('b',-4,-6));const registry=new Map<string,ActionDef>([[walkTo.verb,walkTo]]);const spatial=new Spatial(scene);spatial.sync(world);return {world,rt:new Runtime(world,registry,{spatial},DEFAULT_INVARIANTS)};}
test('a directed walk waits out a make-way nudge on the same body, then walks from where the nudge left it',()=>{
  const {world,rt}=fixture();
  const nudge=rt.submit('walk_to',{actor:'b',x:-4,z:-4.4},{id:'b:make-way:7'});assert.equal(nudge.status,'executing');
  const walk=rt.submit('walk_to',{actor:'b',x:-1,z:-6});
  assert.equal(walk.status,'requested','waits instead of failing');assert.equal(walk.phase,'make-way');
  let started=-1;for(let i=0;i<400&&!['completed','failed'].includes(walk.status as string);i++){rt.step();if(started<0&&(walk.status as string)==='executing')started=rt.tick;}
  assert.equal(rt.records.get('b:make-way:7')!.status,'completed','the nudge finished first');
  assert.ok(started>0,'the walk started after the nudge');assert.equal(walk.status,'completed',JSON.stringify(walk.diagnostic));
  const p=world.entities.b.pose.p;assert.ok(Math.hypot(p[0]+1,p[2]+6)<0.4,'arrived');
});
test('a real conflict (another directed action on the body) still fails at once',()=>{
  const {rt}=fixture();
  const first=rt.submit('walk_to',{actor:'b',x:-1,z:-6},{preempt:false});assert.equal(first.status,'executing');
  const second=rt.submit('walk_to',{actor:'b',x:-6,z:-1},{preempt:false});
  assert.notEqual(second.status,'requested');
});
