import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {readMars2026Source,MARS_2026_SOURCE_HASH} from './mars-2026-map.ts';
test('Mars source bytes are pinned even when geometry changes but declared contentHash is unchanged',()=>{
 const bytes=readFileSync(new URL('../../../mars/viewer/public/engine/campus-2026.json',import.meta.url));
 const original=readMars2026Source(bytes);assert.equal(original.contentHash,MARS_2026_SOURCE_HASH);
 const changed=structuredClone(original);changed.obstacles[0][2]+=1;
 assert.equal(changed.contentHash,original.contentHash);
 assert.throws(()=>readMars2026Source(Buffer.from(JSON.stringify(changed))),/source-bytes-changed/);
 assert.throws(()=>readMars2026Source(Buffer.concat([bytes,Buffer.from(' ')])),/source-bytes-changed/);
});
