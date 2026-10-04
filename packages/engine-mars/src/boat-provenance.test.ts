import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { BOAT_LAYOUT } from '../../../mars/viewer/engine/vehicles/boat.ts';
const root=new URL('../../../',import.meta.url);
const bytes=(path:string)=>readFileSync(new URL(path,root));
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');

test('boat provenance distinguishes exact authored source from older preview wording without altering physical input or recorded journey',()=>{
  const provenance=JSON.parse(bytes('apps/server/test/fixtures/native-boat/provenance.v1.json').toString());
  for(const pin of [provenance.authoredSource,provenance.corePreview,provenance.journey]){
    const b=bytes(pin.publishedCopy??pin.path);assert.equal(b.length,pin.bytes);assert.equal(sha(b),pin.sha256);
  }
  const authored=JSON.parse(bytes(provenance.authoredSource.publishedCopy).toString()),preview=JSON.parse(bytes(provenance.corePreview.path).toString());
  const journey=JSON.parse(bytes(provenance.journey.path).toString());
  assert.equal(journey.geometry.sourceProposalSha256,provenance.authoredSource.sha256);
  assert.notEqual(provenance.authoredSource.sha256,provenance.corePreview.sha256);
  assert.notEqual(preview.boardingConnectorProposal.release,authored.boardingConnectorProposal.release);
  preview.boardingConnectorProposal.release=authored.boardingConnectorProposal.release;assert.deepEqual(preview,authored);
  for(const k of ['id','originXZ','spacingMetres','columns','rows','heightMetres'])assert.deepEqual(journey.geometry.terrain[k],authored.terrain[k]);
  assert.equal(journey.geometry.terrain.diagonal,'min-min/max-max');assert.equal(authored.terrain.interpolation.cellDiagonal,'min-X/min-Z to max-X/max-Z');
  assert.equal(journey.geometry.water.datumY,authored.water.datumY);
  assert.deepEqual(journey.geometry.water.wetBoundsXZ,[-16,-12,0,12]);
  assert.deepEqual(authored.water.wetDomain.closedPolygonXZ,[[-16,-12],[0,-12],[0,12],[-16,12],[-16,-12]]);
  assert.deepEqual(authored.boardingConnectorProposal.centrelineAtProposedDockPose,[BOAT_LAYOUT.connector.from,BOAT_LAYOUT.connector.to]);
  assert.deepEqual(authored.dock.shoreConnectionProposal.path,[BOAT_LAYOUT.ramp.to,BOAT_LAYOUT.ramp.from]);
  assert.deepEqual(journey.layout,BOAT_LAYOUT);assert.equal(provenance.runtimeChanged,false);
});
