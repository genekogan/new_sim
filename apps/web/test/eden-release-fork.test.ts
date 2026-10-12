import {test} from 'node:test';
import assert from 'node:assert/strict';
import {edenExperienceEnabled} from '../src/eden-release.ts';
// Lane FORKFIX: the operator's fork /worlds/w/eden is the same Eden under the launcher's prefix.
const W=['pm-preview-eden-20261005'],id=W[0];
void test('the root Eden keeps its experience (root build, base "")',()=>{
 assert.equal(edenExperienceEnabled('sim.eden.art','/w/eden',id,id,W),true);
 assert.equal(edenExperienceEnabled('sim.eden.art','/w/mars',id,id,W),false);
});
void test('the /worlds fork of Eden gets the same experience; other prefixed worlds and ids do not',()=>{
 assert.equal(edenExperienceEnabled('sim.eden.art','/worlds/w/eden',id,id,W,'/worlds'),true);
 assert.equal(edenExperienceEnabled('sim.eden.art','/worlds/w/eden',id,id,W,''),false);
 assert.equal(edenExperienceEnabled('sim.eden.art','/worlds/w/mars',id,id,W,'/worlds'),false);
 assert.equal(edenExperienceEnabled('sim.eden.art','/worlds/w/eden','my-eden','my-eden',W,'/worlds'),false);
 assert.equal(edenExperienceEnabled('sim.eden.art','/worlds/w/eden',id,id,[],'/worlds'),false);
});
