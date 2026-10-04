import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { generateNativeGatheringObservation } from '../test/fixtures/gathering-observation/generate.ts';
const fixture=new URL('../test/fixtures/gathering-observation/native-gathering.v1.json',import.meta.url);
test('actual native gathering producer matches exact public fixture and reconstructed checkpoint',async()=>{
  const raw=readFileSync(fixture,'utf8'),out=await generateNativeGatheringObservation();
  assert.equal(JSON.stringify(out,null,2)+'\n',raw);
  assert.deepEqual(out.samples.map(s=>s.observation.situation),['ordinary','ordinary','gathering','ordinary','ordinary']);
  assert.deepEqual(out.samples.map(s=>s.observation.largestCommonTargetMembers),[0,0,2,1,0]);
  assert.deepEqual(out.reconstruction.observation,out.samples[2].observation);
  for(const marker of ['fake-soul','actorId','ownerId','principal','label','words','stationEpoch','cueId','pieceId','seed'])assert.ok(!raw.includes('"'+marker+'"'));
});
test('fresh native producer process reproduces exact fixture with no model or owner DB',()=>{
  const child=spawnSync(process.execPath,[fileURLToPath(new URL('../test/fixtures/gathering-observation/generate.ts',import.meta.url))],{encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);assert.equal(child.stdout,readFileSync(fixture,'utf8'));
});
