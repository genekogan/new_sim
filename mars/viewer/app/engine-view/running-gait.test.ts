import test from 'node:test';
import assert from 'node:assert/strict';
import {runningGaitAt} from './running-gait.ts';
test('fallback running pose has opposite legs, raised recovery foot and bent counter-swinging arms',()=>{const a=runningGaitAt(.2,2.5),b=runningGaitAt(.8,2.5);assert.ok(a.legs[0].up>0);assert.equal(a.legs[1].up,0);assert.ok(a.legs[0].forward*a.legs[1].forward<0);assert.notDeepEqual(a.legs,b.legs);assert.ok(a.hands.every(h=>h.up<0));assert.deepEqual(runningGaitAt(.2,2.5),a);});
test('run has a longer, higher stride than jog',()=>{const jog=runningGaitAt(.15,2.5),run=runningGaitAt(.15,4);assert.ok(run.lean>jog.lean);assert.ok(Math.max(...run.legs.map(l=>l.up))>Math.max(...jog.legs.map(l=>l.up)));assert.ok(Math.max(...run.legs.map(l=>Math.abs(l.forward)))>Math.max(...jog.legs.map(l=>Math.abs(l.forward))));});
