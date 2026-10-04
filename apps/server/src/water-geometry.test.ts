import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { generateShoreWaterGeometry } from '../test/fixtures/water-geometry/generate.ts';

const fixtureUrl=new URL('../test/fixtures/water-geometry/shore-water-geometry.v1.json',import.meta.url);
test('actual pinned shore water producer serializes exact depth/hull geometry without canonical or actor claims',()=>{
  const raw=readFileSync(fixtureUrl,'utf8'),out=JSON.parse(raw);
  assert.equal(JSON.stringify(generateShoreWaterGeometry(),null,2)+'\n',raw);
  assert.equal(out.stage,'geometry-only');assert.deepEqual(out.columns.map((q:any)=>q.geometryStatus),['wet','wet','dry','dry','outside-terrain']);
  assert.deepEqual(out.hullClearances.map((q:any)=>q.geometryStatus),['sufficient-depth','insufficient-depth','outside-water-domain']);
  assert.deepEqual(out.hullClearances[0].depthRangeMetres,[.75,1.5]);assert.ok(out.hullClearances.every((q:any)=>q.unresolved.includes('canonical-installation')));
  for(const marker of ['owner','principal','actorId','swimming','admitted','canonicalTick'])assert.ok(!raw.includes('"'+marker+'"'));
});
test('fresh producer process reconstructs the exact supplied JSON without models or databases',()=>{
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('../test/fixtures/water-geometry/generate.ts',import.meta.url))],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,readFileSync(fixtureUrl,'utf8'));
});
