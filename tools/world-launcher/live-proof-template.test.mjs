// Frozen public physical geometry from the pre-enrichment Mars snapshot. The digest
// covers every entity, historical definition, local/world pose and physical field.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GodMode} from '../../apps/server/src/god/god.ts';
import {Db} from '../../apps/server/src/db.ts';
import {hashOf} from '../../packages/world-compiler/src/index.ts';
export function physicalDigest(model) {
  return hashOf({constants:model.constants,entities:[...model.entities.values()].map(e=>({
    path:model.pathOf(e.id),defHash:model.def(e.def)?.hash,parent:e.in.parent==='world'?'world':model.pathOf(e.in.parent),slot:e.in.slot,
    worldPose:model.worldPose(e),...Object.fromEntries(['p','r','s','params','shape','anchor','seed','constraints','state'].filter(k=>e[k]!==undefined).map(k=>[k,e[k]])),
  })).sort((a,b)=>a.path.localeCompare(b.path))});
}
const genesis=JSON.parse(readFileSync(new URL('../../worlds/templates/unified-mars-live-proof-20261027.json',import.meta.url)));
test('hidden Mars live proof preserves all 176 public non-Soul physical entities and historical definitions',()=>{
  assert.equal(genesis.hidden,true);
  assert.deepEqual(Object.keys(genesis).sort(),['batches','constants','description','hidden','name','schema','state'].sort());
  const db=new Db(':memory:');
  try {
    const god=new GodMode(db,{worldId:'offline-hidden-proof',ownerId:null,tick:()=>0,emit(){},genesis});
    assert.equal(god.model.entities.size,176);
    assert.ok([...god.model.entities.values()].every(e=>e.by==='god'&&!/^core[-/]humanoid/.test(god.model.def(e.def)?.ref??'')));
    assert.equal(physicalDigest(god.model),'b6c5de017f255cbbd534f1d6bfb15f2cad19355bc3f0a25f731ae20b116993c3');
    const sofa=[...god.model.entities.values()].find(e=>e.name==='navy-sofa');
    assert.deepEqual(sofa.p,[-10.812,.373,-24.732],'trusted genesis preserves the historical pose rather than applying an ordinary-edit buildsafe nudge');
  } finally {db.close();}
});
