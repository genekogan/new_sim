import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { produceScenePlacementCandidate, terrainPatchV1Schema, sampleCandidateTerrain } from './scene-candidate.ts';

const directory=new URL('../test/fixtures/scene-placement/',import.meta.url);
const read=(name:string)=>JSON.parse(readFileSync(new URL(name,directory),'utf8'));
const pins=read('source-pins.json') as {path:string;commit:string;sha256:string;fixture:string|null}[];
const sourcePins=pins.map(({fixture,...pin})=>pin);
const commons=read('commons-world.v1.json'),shore=read('shore-world.v1.json'),garden=read('shore-garden-world.v1.json');
const ref={worldId:'eden-1',proposalId:shore.id,revision:shore.revision,sourcePins:sourcePins.slice(1)};
const {id,originXZ,spacingMetres,columns,rows,heightMetres}=shore.terrain;
const terrain={id,originXZ,spacingMetres,columns,rows,heightMetres,diagonal:'min-min/max-max' as const};
const raw={ref,terrain,placements:garden.placements};

test('pinned World proposal bytes and actual detached shore garden output retain their source identity',()=>{
  for(const pin of pins.filter(pin=>pin.fixture))assert.equal(createHash('sha256').update(readFileSync(new URL(pin.fixture!,directory))).digest('hex'),pin.sha256);
  assert.equal(pins[0].sha256,'18436a40c9153f8385b46118a20537ae5a74ebfe593ee9a45c4348f2c09cfdd6');
  assert.equal(pins[1].sha256,'69ac8401b8ff734f8d23acc8088d6e583d29a31d428a0a8f066cf700c85dfb3b');
  assert.equal(pins[2].sha256,'3b49d5fd033e3cf66226cd172add9dd559898bac415e992dc0ad4db17373ce14');
  assert.equal(createHash('sha256').update(readFileSync(new URL('shore-garden-world.v1.json',directory))).digest('hex'),
    'b46262eb545b548fa18a200565326419055d6381ee51490fa94ee36f29afe5bc');
  assert.deepEqual(garden.sourcePins,sourcePins.slice(1));assert.equal(garden.placements.length,43);
  assert.equal(shore.terrain.interpolation.cellDiagonal,'min-X/min-Z to max-X/max-Z');
  assert.equal(shore.status,'proposed-for-core-validation');assert.equal(commons.status,'asset-lookbook-only');
});

test('actual proposed shore distinguishes35 terrain-aligned roots from8 raised-bed placements needing named support',()=>{
  const before=JSON.stringify(raw),candidate=produceScenePlacementCandidate(raw);
  assert.equal(candidate.contract,'scene-placement-candidate/1');assert.equal(candidate.stage,'proposal-checked');
  assert.equal(candidate.roots.filter(r=>r.status==='terrain-aligned').length,35);
  const raised=candidate.roots.filter(r=>r.status==='requires-support');assert.equal(raised.length,8);
  for(const root of raised){assert.equal(root.code,'root-height-mismatch');assert.ok(Math.abs(root.deltaY!-.415)<1e-12);}
  assert.deepEqual(candidate.unresolved,['obstruction-policy','canonical-installation']);
  assert.deepEqual(candidate.placements,garden.placements,'do not flatten roots or invent bed contacts');
  assert.equal(JSON.stringify(raw),before);
  candidate.terrain.heightMetres[0][0]=99;candidate.placements[0].p[0]=99;candidate.ref.sourcePins[0].sha256='mutated';
  assert.equal(JSON.stringify(raw),before,'producer result is detached from authored data');
});

test('actual31 flat commons roots align on explicit preview terrain without crown/trunk/support or installation claims',()=>{
  const candidate=produceScenePlacementCandidate({ref:{...ref,proposalId:'commons-lookbook',revision:commons.revision,sourcePins:sourcePins.slice(0,1)},
    terrain:{id:'commons-preview-plane',originXZ:[-12,-12],spacingMetres:24,columns:2,rows:2,heightMetres:[[0,0],[0,0]],diagonal:'min-min/max-max'},placements:commons.placements});
  assert.equal(candidate.placements.length,31);assert.ok(candidate.roots.every(r=>r.status==='terrain-aligned'&&r.p[1]===0));
  assert.ok(candidate.unresolved.includes('obstruction-policy'));assert.equal(candidate.stage,'proposal-checked');
});

test('both triangles, outer edge, upward normals and the exact declared diagonal determine sampling',()=>{
  const patch=terrainPatchV1Schema.parse({id:'non-planar',originXZ:[0,0],spacingMetres:2,columns:2,rows:2,heightMetres:[[0,2],[4,8]],diagonal:'min-min/max-max'});
  const below=sampleCandidateTerrain(patch,1.5,.5)!,above=sampleCandidateTerrain(patch,.5,1.5)!;
  assert.equal(below.p[1],3);assert.equal(above.p[1],4);
  const expectedBelow=[-1/Math.sqrt(11),1/Math.sqrt(11),-3/Math.sqrt(11)],expectedAbove=[-2/3,1/3,-2/3];
  below.normal.forEach((n,i)=>assert.ok(Math.abs(n-expectedBelow[i])<1e-14));
  above.normal.forEach((n,i)=>assert.ok(Math.abs(n-expectedAbove[i])<1e-14));
  assert.equal(sampleCandidateTerrain(patch,2,2)!.p[1],8);
  assert.equal(sampleCandidateTerrain(patch,2.001,1),null);assert.equal(sampleCandidateTerrain(patch,-.001,1),null);
  assert.throws(()=>sampleCandidateTerrain(patch,NaN,0),/finite/);
});

test('actual shore bank normals and unsupported outside placements remain proposals, never extrapolated supports',()=>{
  const parsed=terrainPatchV1Schema.parse(terrain),bank=sampleCandidateTerrain(parsed,.65,0)!;
  assert.ok(Math.abs(bank.p[1]-.0845)<1e-12);assert.ok(bank.normal[0]<0&&bank.normal[1]>0);
  assert.ok(Math.abs(Math.hypot(...bank.normal)-1)<1e-12);assert.equal(sampleCandidateTerrain(parsed,16,12)!.p[1],2);
  const candidate=produceScenePlacementCandidate({...raw,placements:[{...garden.placements[0],p:[17,2,0]}]});
  assert.deepEqual(candidate.roots,[{id:garden.placements[0].id,status:'requires-support',code:'outside-terrain'}]);
});

test('malformed grids, duplicate IDs, unknown authority, nonfinite transforms and unbounded batches are refused',()=>{
  for(const change of [{columns:1},{rows:130},{spacingMetres:0},{heightMetres:[[0,0]]},{diagonal:'opposite'},
    {originXZ:[10000,10000]},{heightMetres:[[NaN,0],[0,0]]}])assert.ok(!terrainPatchV1Schema.safeParse({...terrain,...change}).success);
  for(const changed of [
    {...raw,approved:true},
    {...raw,ref:{...ref,ownerId:'PRIVATE_OWNER'}},
    {...raw,placements:[garden.placements[0],garden.placements[0]]},
    {...raw,placements:[{...garden.placements[0],p:[0,Infinity,0]}]},
    {...raw,placements:[{...garden.placements[0],supportId:'invented'}]},
    {...raw,placements:[{...garden.placements[0],seed:-1}]},
    {...raw,placements:Array.from({length:513},(_,i)=>({...garden.placements[0],id:'plant-'+i}))},
  ])assert.throws(()=>produceScenePlacementCandidate(changed));
});

test('candidate producer is reproducible JSON with no admitted/current-tick/owner or private actor data',()=>{
  const one=produceScenePlacementCandidate(raw),two=produceScenePlacementCandidate(JSON.parse(JSON.stringify(raw)));
  assert.deepEqual(two,one);const text=JSON.stringify(one);
  for(const marker of ['accepted','ownerId','principalId','intentId','tick','contactId'])assert.ok(!text.includes('"'+marker+'"'));
  assert.equal(one.stage,'proposal-checked');assert.deepEqual(one.ref,ref);
});
