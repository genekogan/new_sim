// Shared by fixture authoring and the runner. Only semantic blocks and human batch labels are omitted.
// Physical ops retain order, parameters, parentage and poses. Failed/different fixture files cannot spend inference.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sha256 } from './hash.mjs';
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])) : value;
export function physicalGenesisSha256(genesis) {
  const physical = structuredClone(genesis);
  if (physical.state) delete physical.state.about;
  const ops = (physical.batches ?? []).flatMap(batch => batch.ops ?? []).flatMap(op => {
    delete op.about;
    if (op.op === 'world' && op.state) { delete op.state.about; if (!Object.keys(op.state).length) return []; }
    if (op.op === 'set' && Object.keys(op).every(k => ['op','id'].includes(k))) return [];
    return [op];
  });
  return sha256(JSON.stringify(canonical({schema:physical.schema,constants:physical.constants,state:physical.state,ops})));
}
export function assertFrozenGenesis(scenario, serverRoot) {
  if (!scenario.freeze) return null;
  if (!scenario.world?.genesis) throw Error('frozen measurement requires an explicit genesis file');
  const path = resolve(serverRoot,scenario.world.genesis);
  const actual = physicalGenesisSha256(JSON.parse(readFileSync(path,'utf8')));
  if (actual !== scenario.freeze.physicalSha256) throw Error(`frozen physical fixture mismatch: ${path}; expected ${scenario.freeze.physicalSha256}, got ${actual}`);
  if (scenario.world.snapshot) {
    const snapshotPath=resolve(serverRoot,scenario.world.snapshot), bytes=readFileSync(snapshotPath);
    const snapshot=JSON.parse(bytes), physical=physicalSnapshotSha256(snapshot);
    if (sha256(bytes)!==scenario.freeze.snapshotSha256 || physical!==scenario.freeze.physicalSnapshotSha256) throw Error(`frozen snapshot fixture mismatch: ${snapshotPath}`);
    return {path,physicalSha256:actual,snapshotPath,snapshotSha256:sha256(bytes),physicalSnapshotSha256:physical};
  }
  return {path,physicalSha256:actual};
}

/** Only compiler model fields enter an isolated seed DB. Public transport metadata is not state. */
export function compilerSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.entities) || !Array.isArray(snapshot.defs) || !snapshot.ground || !snapshot.constants || typeof snapshot.seed !== 'string') throw Error('invalid compiler snapshot fixture');
  if (snapshot.entities.some(e=>typeof e.id!=='string'||e.id.startsWith('h_')||/humanoid|soul-body/.test(e.def??''))) throw Error('snapshot fixture must contain no Soul bodies');
  if (snapshot.state?.layers?.wallets && Object.keys(snapshot.state.layers.wallets).length) throw Error('snapshot fixture must contain no private layer wallets');
  const seq=snapshot.contract==='world/1'?snapshot.counter:snapshot.seq;
  if (!Number.isSafeInteger(seq)||seq<0) throw Error('snapshot fixture has invalid entity counter');
  return structuredClone({constants:snapshot.constants,state:snapshot.state,seed:snapshot.seed,seq,editSeq:0,defs:snapshot.defs,defRefs:snapshot.defRefs,entities:snapshot.entities,ground:snapshot.ground});
}
export function physicalSnapshotSha256(snapshot) {
  const s=compilerSnapshot(snapshot); delete s.seq;delete s.editSeq;delete s.seed;delete s.defRefs;
  if(s.state)delete s.state.about;
  s.entities=s.entities.map(e=>{for(const k of ['about','by','born','v'])delete e[k];return e;}).sort((a,b)=>a.id.localeCompare(b.id));
  s.defs=s.defs.map(d=>{delete d.by;return d;}).sort((a,b)=>a.hash.localeCompare(b.hash));
  return sha256(JSON.stringify(canonical(s)));
}
