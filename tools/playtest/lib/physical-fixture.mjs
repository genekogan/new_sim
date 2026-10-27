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
  return {path,physicalSha256:actual};
}
