import {test} from 'node:test';import assert from 'node:assert/strict';
import {indexGroundQuads} from '../app/engine-view/content/environment/eden-expansion-landscape/quad-ground.ts';
void test('quad height keeps native diagonal and first-drawn shared-edge choice',()=>{
 const a=new Float32Array([0,0,0,4,4,0,4,10,4,0,6,4,4,100,0,8,104,0,8,110,4,4,106,4]);
 const index=indexGroundQuads(a);
 assert.equal(index.heightAt(3,1),4.5);assert.equal(index.heightAt(1,3),5.5);
 assert.equal(index.heightAt(4,1),5.5); // First quad wins the exact boundary despite second's discontinuous Y.
 assert.ok(index.heightAt(4+1e-7,1)!>100);
 assert.equal(index.heightAt(-1,1),null);assert.equal(index.heightAt(1,NaN),null);
 index.dispose();index.dispose();assert.equal(index.heightAt(3,1),null);assert.deepEqual(index.inspect(),{cells:0,references:0,retainsPositions:false});
});
void test('negative and Float32 fractional cell edges remain reachable',()=>{
 const a=new Float32Array([-4,1,-4,-.1,2,-4,-.1,3,-.1,-4,2,-.1]);const index=indexGroundQuads(a);
 assert.equal(index.heightAt(a[6],a[8]),3);assert.equal(index.heightAt(-4,-4),1);assert.equal(index.heightAt(-4-1e-7,-4),null);index.dispose();
});
