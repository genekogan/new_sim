import test from 'node:test';import assert from 'node:assert/strict';import{withKinematics}from'./kinematics.mjs';
test('moving public sample cannot acquire a later seated posture at its old position or time',()=>{
 const pub={t:'old',pos:{x:1,z:2},posture:'walking',activity:'walk',place:'hall',seat:null,tick:1,receipts:[{id:'r'}]};
 const sample=withKinematics(pub,{tick:2,me:{pos:[8,9],posture:'seated',activity:{kind:'sit'},place:'podium',seat:'chair',heading:90}},{startedAt:'start',endedAt:'end',mono:8});
 assert.deepEqual(sample.pos,{x:8,z:9,region:null,src:'here'});assert.equal(sample.t,'end');assert.equal(sample.tick,2);assert.equal(sample.seat,'chair');assert.equal(sample.perceptionSampleStartedAt,'start');assert.deepEqual(sample.receipts,pub.receipts);
});
test('missing here body fields remain unknown rather than borrowing older public values',()=>{
 const s=withKinematics({pos:{x:1,z:2},posture:'seated',seat:'chair',activity:'sit',heading:90,level:1,place:'hall'},{me:{}},{endedAt:'end'});
 for(const key of ['pos','posture','seat','activity','heading','level','place','tick'])assert.equal(s[key],null,key);
});
