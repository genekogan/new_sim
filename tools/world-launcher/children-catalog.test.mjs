import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultCommand} from './children.mjs';
test('default entity child inherits only explicit catalogue settings alongside existing fake-mind policy', () => {
  const values = {CATALOG_REGISTRY_DIR:'/tmp/catalog-fixture', CATALOG_CHANNEL:'stable', CATALOG_GENE_OWNER_ID:'fixture-owner'};
  const before = Object.fromEntries(Object.keys(values).map(key=>[key,process.env[key]]));
  try {
    Object.assign(process.env, values);
    const command = defaultCommand({slug:'fixture',dataDir:'/tmp/world-fixture'}, 6111, {publicOrigin:'http://localhost:6110'});
    for (const [key,value] of Object.entries(values)) assert.equal(command.env[key], value);
    assert.equal(command.env.BRAIN_MODE,'fake');
    assert.equal(command.env.OPENAI_API_KEY,'');
  } finally {for (const [key,value] of Object.entries(before)) {if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
