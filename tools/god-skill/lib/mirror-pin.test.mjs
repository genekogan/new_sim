import {test} from 'node:test';
import assert from 'node:assert/strict';
import {view} from './mirror.mjs';
import {selectRows} from './select.mjs';
test('mirror resolves both SHA revisions and recognizes pinned flags and selection names', () => {
  const hash = 'a'.repeat(64), other = 'b'.repeat(64), flagHash = 'c'.repeat(64);
  const rows = [{id: 'old', path: 'old', name: 'old', def: 'sha:' + hash, parent: 'world'},
    {id: 'new', path: 'new', name: 'new', def: 'sha:' + other, parent: 'world'},
    {id: 'flag', path: 'flag', name: 'flag', def: 'sha:' + flagHash, parent: 'world'}];
  const v = view({rows, extent: 100, snapshot: {entities: rows.map(r=>({...r,state:r.id==='flag'?{label:'Camp'}:{}})),
    library: [{ref: 'core-bench@1', hash: other}], defs: [{ref: 'core-bench@1', hash}, {ref: 'core-bench@1',hash: other}, {ref: 'core-flag@1', hash: flagHash}]}});
  assert.equal(v.def('sha:' + hash).hash, hash);
  assert.equal(v.def('sha:' + other).hash, other);
  assert.equal(v.get('Camp').id, 'flag');
  assert.deepEqual(selectRows(v, {def: 'bench'}).map(r=>r.id), ['old','new']);
  assert.deepEqual(selectRows(v, {}).map(r=>r.id), ['old','new']);
});
