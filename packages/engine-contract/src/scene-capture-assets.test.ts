import test from 'node:test';import assert from 'node:assert/strict';
import {captureRenderScene,parseRenderSceneCapture} from './scene-capture.ts';
const legacy={scene:{id:'old-public-scene'},buildings:[{file:'house.glb',p:[1,2,3] as [number,number,number],yaw:.4}]};
test('capture asset fields are optional, preserve the legacy hash and roundtrip trusted scaled scenery',()=>{
 assert.equal(captureRenderScene('fixture/1',legacy).ref.hash,'21382e6ebf2544583efd144db8c49461cf4c03a6a855a418bbb6ea54f856596e');
 for(const scale of [2,[1,2,3] as [number,number,number]]){const input={...legacy,assetRoot:'/world-assets/littlemartians',buildings:[{...legacy.buildings[0],scale}]},capture=captureRenderScene('fixture/1',input);assert.deepEqual(parseRenderSceneCapture(capture),capture);assert.deepEqual(capture.body,input);}
});
test('capture refuses external/traversing asset roots and malformed or excessive scenery scales',()=>{
 for(const assetRoot of ['https://example.invalid','//example.invalid','/world-assets/../private','/world-assets/littlemartians?x=1','/world-assets/littlemartians/kin'])assert.throws(()=>captureRenderScene('fixture/1',{...legacy,assetRoot}));
 for(const scale of [0,-1,NaN,Infinity,101,[1,0,1],[1,2],[1,2,101]])assert.throws(()=>captureRenderScene('fixture/1',{...legacy,buildings:[{...legacy.buildings[0],scale:scale as any}]}));
});
