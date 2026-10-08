import assert from 'node:assert/strict';
import {test} from 'node:test';
import {officeStairGuardBoxes,officeGuardSweepFraction} from './office-stair-guards.ts';

test('six exact upper guard boxes never form a ground-floor column and leave the south mouth open',()=>{
 const guards=officeStairGuardBoxes();assert.equal(guards.length,6);
 for(const floorY of[3.1,6.1]){
  assert.equal(guards.filter(g=>g.floorY===floorY).length,3);
  assert.ok(officeGuardSweepFraction(guards,[86, floorY+1.65,15],[88,floorY+1.65,15],.08,1.65,.1)<1);
  assert.ok(officeGuardSweepFraction(guards,[88,floorY+1.65,15],[86,floorY+1.65,15],.08,1.65,.1)<1);
  assert.equal(officeGuardSweepFraction(guards,[88.6,floorY+1.65,17],[88.6,floorY+1.65,16.28],.08,1.65,.1),1);
 }
 assert.equal(officeGuardSweepFraction(guards,[86,1.75,15],[90,1.75,15],.08,1.65,.1),1);
 assert.equal(officeGuardSweepFraction(guards,[86,9,15],[90,9,15],.08,1.65,.1),1);
});

test('both complete switchback flights and northern landings clear a standing body in both directions',()=>{
 const guards=officeStairGuardBoxes(),path=[...Array.from({length:8},(_,i)=>[87.6,.1+(i+1)*.2,16.34-(i+.5)*.28]),
  [87.6,1.7,13.8],[88.6,1.7,13.8],...Array.from({length:7},(_,i)=>[88.6,1.7+(i+1)*.2,14.1+(i+.5)*.28]),[88.6,3.1,16.28],[88.6,3.1,16.8]];
 for(const offset of[0,3])for(let i=1;i<path.length;i++){
  const from=path[i-1].map((v,j)=>j===1?v+offset:v),to=path[i].map((v,j)=>j===1?v+offset:v);
  assert.equal(officeGuardSweepFraction(guards,from,to,.28,0,1.75),1,`up flight${offset/3} segment${i}`);
  assert.equal(officeGuardSweepFraction(guards,to,from,.28,0,1.75),1,`down flight${offset/3} segment${i}`);
 }
});

test('fast diagonal sweeps cannot tunnel; an embedded camera can escape only toward its nearest face',()=>{
 const guards=officeStairGuardBoxes();
 assert.ok(officeGuardSweepFraction(guards,[90,4.75,17],[86,4.75,13],.08,1.65,.1)<1);
 assert.equal(officeGuardSweepFraction(guards,[87.16,4,15],[86.5,4,15],.08),1);
 assert.equal(officeGuardSweepFraction(guards,[87.16,4,15],[87.19,4,15],.08),0);
 assert.equal(officeGuardSweepFraction(guards,[NaN,4,15],[88,4,15],.08),0);
});
