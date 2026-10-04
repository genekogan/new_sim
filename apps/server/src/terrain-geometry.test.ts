import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { generateTerrainGeometryFixture } from '../test/fixtures/terrain-geometry/generate.ts';

const directory=new URL('../test/fixtures/terrain-geometry/',import.meta.url);
test('pinned public terrain/support producer matches supplied sweep and footing JSON exactly',()=>{
  const bytes=readFileSync(new URL('shore-geometry.v1.json',directory)),manifest=JSON.parse(readFileSync(new URL('source.v1.json',directory),'utf8'));
  assert.equal(bytes.byteLength,manifest.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),manifest.sha256);
  const fixture=JSON.parse(bytes.toString());assert.deepEqual(generateTerrainGeometryFixture(),fixture);
  assert.equal(fixture.contract,'core-terrain-geometry-fixture/1');assert.equal(fixture.paid,0);
  assert.deepEqual(fixture.sweeps.map((s:any)=>[s.id,s.result.geometryStatus,s.result.reason]),[
    ['bank','clear',undefined],['shore-straddle','blocked','slope-exceeded'],['outside-edge','blocked','outside-terrain']]);
  assert.equal(fixture.footings.length,2);assert.equal(fixture.footings.flatMap((f:any)=>f.proposedRootIds).length,8);
  for(const field of ['ownerId','soulId','intentId','installedAt','acceptedTick','contactId'])assert.ok(!bytes.toString().includes('"'+field+'"'));
});

test('fresh native Node process reconstructs the exact JSON without models or canonical state',()=>{
  const generator=new URL('../test/fixtures/terrain-geometry/generate.ts',import.meta.url).href;
  const child=spawnSync(process.execPath,['--input-type=module','-e',`import {generateTerrainGeometryFixture} from ${JSON.stringify(generator)};process.stdout.write(JSON.stringify(generateTerrainGeometryFixture())+${JSON.stringify('\n')});`],
    {encoding:'utf8',timeout:10000,maxBuffer:128000});
  assert.equal(child.status,0,child.stderr);assert.equal(child.signal,null);
  assert.equal(child.stdout,readFileSync(new URL('shore-geometry.v1.json',directory),'utf8'));
});
