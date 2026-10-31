// B-facade rotation 4: GodReplica's incremental refresh. Engine edits that change only entities patch the model in place;
// the result must equal a whole rebuild from the same rows (entities, names, children, solid footprints).
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Db} from '../db.ts';
import {GodMode} from '../god/god.ts';
import {GodReplica} from './god-replica.ts';

const readOnly = (path: string) => {const db = new DatabaseSync(path, {readOnly: true}); return {db, path, soul: () => undefined} as unknown as Db;};
const view = (g: GodReplica) => {
  const m = g.model, ids = [...m.entities.keys()].sort();
  return {snap: JSON.stringify({...m.snapshot(), entities: undefined}), entities: ids.map(id => JSON.stringify(m.entities.get(id))),
    names: [...m.names].sort().map(x => x.join('=')), children: [...m.children].map(([k, v]) => `${k}:${[...v].sort().join(',')}`).filter(x => !x.endsWith(':')).sort(),
    footprints: ids.map(id => `${id}:${JSON.stringify(m.footprintsOf(id))}`)};
};

test('god replica: entity-only engine edits patch the model to what a whole rebuild gives', t => {
  const dir = mkdtempSync(join(tmpdir(), 'god-replica-')), path = join(dir, 'sim.db');
  const db = new Db(path);
  const g = new GodMode(db, {worldId: 'gr', ownerId: 'dev:owner', tick: () => 0, emit: () => {}});
  t.after(() => {db.close(); rmSync(dir, {recursive: true, force: true});});
  assert.equal(g.act({ops: [{op: 'place', def: 'core/bench@1', name: 'a', p: [1, 1]}, {op: 'place', def: 'core/bench@1', name: 'b', p: [5, 5]}] as never}).accepted, true);
  const r = new GodReplica(readOnly(path), 'gr', () => 0);
  let commits = 0; r.onCommit(() => {commits++;});
  const ok = (x: {accepted: boolean}) => assert.equal(x.accepted, true, JSON.stringify(x));
  ok(g.engineAct([{op: 'move', id: 'a', mode: 'strict', p: [3, 2]}] as never, 'writeback'));
  assert.equal(r.sync(), true);
  ok(g.engineAct([{op: 'place', def: 'core/bench@1', p: [9, 0]}] as never, 'growth'));
  ok(g.engineAct([{op: 'remove', id: 'b', cascade: true}] as never, 'retire'));
  assert.equal(r.sync(), true);
  assert.equal(commits, 2);
  assert.equal(r.cost.whole, 1, 'only the first load was whole');
  assert.ok(r.cost.patched >= 3, JSON.stringify(r.cost));
  const fresh = new GodReplica(readOnly(path), 'gr', () => 0);
  assert.deepEqual(view(r), view(fresh));
  assert.ok(r.model.get('a')); assert.equal(r.model.get('b'), undefined);
  // a world-state edit rebuilds whole
  assert.equal(g.act({ops: [{op: 'world', state: {constitution: 'changed'}}] as never}).accepted, true);
  assert.equal(r.sync(), true); assert.equal(r.cost.whole, 2);
  assert.deepEqual(view(r), view(new GodReplica(readOnly(path), 'gr', () => 0)));
});
