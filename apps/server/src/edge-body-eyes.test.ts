import test from 'node:test';import assert from 'node:assert/strict';
import {eyePose} from './edge/eyes/view.ts';
test('BODY eyes use authoritative feet elevation and body height without changing human posture eyes',()=>{
 const base={pose:{p:[3,4,5],yaw:.8}};
 assert.deepEqual(eyePose({...base,body:{family:'floater',hoverHeight:1.8}},'standing',.2,90,640,400).p,[3,5.8,5]);
 assert.deepEqual(eyePose({...base,body:{family:'floater'}},'standing',.2,90,640,400).p,[3,5.45,5]);
 assert.deepEqual(eyePose(base,'standing',.2,90,640,400).p,[3,5.62,5]);assert.deepEqual(eyePose(base,'seated',.2,90,640,400).p,[3,5.15,5]);
});
