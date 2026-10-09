import test from 'node:test';import assert from 'node:assert/strict';
import {Builder} from '../../../mars/viewer/app/engine-view/content/assets/eden-regions/kit.ts';
test('new blocking authors must share draw and source band; legacy and decoration exceptions are explicit',()=>{
 const strict=new Builder();assert.throws(()=>strict.box('plaster',0,0,0,2,2,2,'#777'),/requires-authoredBox/);assert.equal(strict.buf.size,0);
 strict.authoredBox('plaster',0,0,0,2,2,2,'#777','new-building','wall');assert.equal(strict.boundaries.length,1);assert.equal(strict.boundaries[0].collision,'solid');assert.ok(strict.buf.size>0);
 const decorative=new Builder('decorative');assert.doesNotThrow(()=>decorative.box('flower',0,0,0,.1,.2,.1,'#abc'));const legacy=new Builder('legacy');assert.doesNotThrow(()=>legacy.box('stone',0,0,0,1,1,1,'#777'));
});
