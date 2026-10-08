import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {triangulateWetUnion} from './wet-union.mjs';
import {createEdenExpansionLandscape} from './landscape.mjs';
import {extractEdenExpansionWaterSupport} from '../eden-expansion-water-support/extract.mjs';
const rect=(x,z,w,h)=>[[x,z],[x+w,z],[x+w,z+h],[x,z+h]];
assert.throws(()=>triangulateWetUnion([rect(0,0,2,2),rect(10,0,2,2)]),/exactly one connected hole-free/);
assert.throws(()=>triangulateWetUnion([rect(0,0,2,2),rect(1,1,2,2).toReversed()]),/boundary not closed|before closure/);
assert.throws(()=>triangulateWetUnion([rect(0,0,4,1),rect(0,3,4,1),rect(0,0,1,4),rect(3,0,1,4)]),/boundary not closed|exactly one connected hole-free|before closure/);
const preserved=JSON.parse(readFileSync(new URL('../eden-expansion-water-support/request.json',import.meta.url),'utf8'));
const owner=createEdenExpansionLandscape(true);
try{
 const actual=extractEdenExpansionWaterSupport(owner);
 assert.deepEqual(actual.wetDomain,preserved.wetDomain);
 assert.deepEqual(actual.bankAndBedSurfaces,preserved.bankAndBedSurfaces);
 assert.deepEqual(actual.underlyingExpansionGround,preserved.underlyingExpansionGround);
 assert.equal(actual.wetDomain.boundaryLoops.length,1);
 assert.equal(actual.wetDomain.boundaryLoops[0].length,52);
 assert.equal(actual.wetDomain.triangleCount,50);
 const receipt={groups:4,disjointRefused:true,nonclosedRefused:true,holeBoundaryRefused:true,currentWaterAndBedOutputExact:true,vertices:52,triangles:50,requestV1V2Unmodified:true,scope:'new topology admission guards and affected output parity only; no graphics/native admission'};
 writeFileSync(new URL('./wet-union-guard-receipt.json',import.meta.url),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{owner.dispose();}
