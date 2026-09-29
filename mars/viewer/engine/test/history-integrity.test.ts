import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { WorldHistory, HistoryError, type Cause, type HistoryJSON } from '../history/store.ts';
import { pgHistory, pgWorld, registry } from './sequence-fixtures.ts';
import { hashOf } from '../core/hash.ts';
import { Runtime } from '../runtime/runtime.ts';

const corrupt = (e: unknown) => e instanceof HistoryError && e.code === 'corrupt-history';
const captures: unknown[] = [];
test('LM075 history returns independent workspaces, checkpoints, nested causes and serialized values', () => {
  const h = pgHistory(), state = h.read('ws');
  const cause: Cause = { kind: 'reconstruction-edit', note: 'test provenance', evidence: ['source'] };
  const cp = h.commit('ws', state, cause), before = h.toJSON();
  cause.evidence!.push('not stored');
  cp.cause = { kind: 'design-edit', note: 'not stored' };
  cp.parent = null;
  h.head('ws').stateHash = 'bad';
  h.checkpoint(cp.id).label = 'not stored';
  h.log('ws')[0].cause = { kind: 'fork' };
  h.workspaces.get('ws')!.protected = true;
  h.checkpoints.get(cp.id)!.parent = null;
  for (const w of h.workspaces.values()) w.head = 'bad';
  h.checkpoints.forEach((c) => { c.stateHash = 'bad'; });
  const out = h.toJSON();
  out.workspaces[0].head = 'bad';
  out.checkpoints[0].cause = { kind: 'fork' };
  out.states![0][1].tick++;
  assert.deepEqual(h.toJSON(), before);
  assert.equal('set' in h.workspaces, false);
  assert.equal('delete' in h.checkpoints, false);
  const fresh = new WorldHistory('test');
  const published = fresh.publishCanonical('canon', 'canon', pgWorld(), 'test');
  const forked = fresh.fork('canon', 'fork', 'fork');
  published.head = 'bad'; forked.head = 'bad';
  assert.doesNotThrow(() => fresh.read('canon'));
  assert.doesNotThrow(() => fresh.read('fork'));
  captures.push({ case: 'returned mutation', hash: hashOf(before), unchanged: hashOf(h.toJSON()) === hashOf(before) });
});
test('LM075 repeated publication and protected/nonleaf deletion refuse atomically', () => {
  const h = pgHistory(), before = h.toJSON();
  assert.throws(() => h.publishCanonical('pg', 'replace', pgWorld(), 'bad'), (e: unknown) => e instanceof HistoryError && e.code === 'exists');
  assert.throws(() => h.publishCanonical('ws', 'replace fork', pgWorld(), 'bad'), (e: unknown) => e instanceof HistoryError && e.code === 'exists');
  assert.throws(() => h.deleteWorkspace('pg'), /protected/);
  assert.deepEqual(h.toJSON(), before);
  h.fork('ws', 'child', 'child');
  assert.throws(() => h.deleteWorkspace('ws'), /surviving forks/);
  const cp = h.head('child');
  h.deleteWorkspace('child');
  assert.equal(h.workspaces.has('child'), false);
  assert.equal(h.checkpoint(cp.id).id, cp.id);
});
test('LM075 inline stored hashes, duplicate index entries and broken ancestry are rejected', () => {
  const h = pgHistory();
  h.commit('ws', h.read('ws'), { kind: 'design-edit', note: 'next' });
  const original = h.toJSON();
  const edits: [string, (j: HistoryJSON) => void][] = [
    ['state hash', (j) => { j.states![0][1].tick++; }],
    ['checkpoint hash', (j) => { j.checkpoints[0].cause = { kind: 'canonical-publish', note: 'tampered' }; }],
    ['physical hash', (j) => { j.checkpoints[0].physicalHash = '0'.repeat(64); }],
    ['duplicate checkpoint', (j) => { j.checkpoints.push(j.checkpoints[0]); }],
    ['duplicate state', (j) => { j.states!.push(j.states![0]); }],
    ['duplicate workspace', (j) => { j.workspaces.push(j.workspaces[0]); }],
    ['sequence', (j) => { j.seq = 0; }],
    ['head', (j) => { j.workspaces[0].head = '0'.repeat(24); }],
    ['protection', (j) => { j.workspaces[0].protected = false; }],
    ['workspace self-cycle', (j) => { j.workspaces.find((w) => w.id === 'ws')!.forkedFrom = 'ws'; }],
    ['canonical advanced head', (j) => { j.workspaces.find((w) => w.id === 'pg')!.head = j.checkpoints[1].id; }],
    ['parent cycle', (j) => { j.checkpoints[1].created = 0; }],
  ];
  for (const [name, edit] of edits) {
    const j = structuredClone(original); edit(j);
    assert.throws(() => WorldHistory.fromJSON(j), corrupt, name);
    captures.push({ case: name, diagnostic: 'corrupt-history' });
  }
  const cycle = structuredClone(original);
  cycle.workspaces.push({ id: 'child', head: cycle.checkpoints[1].id, protected: false, label: 'child', forkedFrom: 'ws' });
  cycle.workspaces.find((w) => w.id === 'ws')!.forkedFrom = 'child';
  assert.throws(() => WorldHistory.fromJSON(cycle), corrupt, 'two-workspace cycle');
  const input = structuredClone(original), restored = WorldHistory.fromJSON(input);
  input.checkpoints[0].cause = { kind: 'fork' }; input.states![0][1].tick++;
  assert.deepEqual(restored.toJSON(), original);
});
test('LM075 lazy state and pause blobs are verified before caching, without freezing external values', () => {
  const h = pgHistory(), rt = new Runtime(h.read('ws'), registry(), {});
  const cp = h.commit('ws', rt.snapshot(), { kind: 'pause', note: 'idle pause' });
  const full = h.toJSON(), index = { ...full, states: undefined, resumes: undefined };
  const states = new Map(structuredClone(full.states)), resumes = new Map(structuredClone(full.resumes));
  const store = { get: (id: string) => states.get(id), put: () => {}, getResume: (id: string) => resumes.get(id), putResume: () => {} };
  const restored = WorldHistory.fromJSON(index); restored.attachStateStore(store);
  states.get(cp.stateHash)!.tick++;
  assert.throws(() => restored.read('ws'), corrupt);
  states.set(cp.stateHash, structuredClone(full.states!.find(([id]) => id === cp.stateHash)![1]));
  resumes.get(cp.resume!)!.nextId++;
  assert.throws(() => restored.read('ws', { resume: true }), corrupt);
  resumes.set(cp.resume!, rt.snapshot());
  const result = restored.read('ws', { resume: true });
  assert.equal(result.snapshot!.stateHash, cp.stateHash);
  assert.equal(Object.isFrozen(states.get(cp.stateHash)), false);
  assert.equal(Object.isFrozen(resumes.get(cp.resume!)), false);
  states.get(cp.stateHash)!.tick++;
  resumes.get(cp.resume!)!.nextId++;
  assert.equal(restored.read('ws').tick, rt.tick, 'cached clone remains intact');
  assert.equal(restored.read('ws', { resume: true }).snapshot!.nextId, rt.snapshot().nextId);
  const badResume = h.toJSON(); badResume.resumes![0][1].nextId++;
  assert.throws(() => WorldHistory.fromJSON(badResume), corrupt);
  captures.push({ case: 'lazy blob verification', stateHash: cp.stateHash, resumeHash: cp.resume, diagnostic: 'corrupt-history', recovered: true });
  if (process.env.MARS_HISTORY_INTEGRITY_CAPTURE) writeFileSync(process.env.MARS_HISTORY_INTEGRITY_CAPTURE, JSON.stringify(captures, null, 2) + '\n');
});

test('LM075 cached lazy snapshots still validate the world of every referencing checkpoint', () => {
  const h = pgHistory(), rt = new Runtime(h.read('ws'), registry(), {});
  const first = h.commit('ws', rt.snapshot(), { kind: 'pause', note: 'first' });
  rt.step();
  h.commit('ws', rt.snapshot(), { kind: 'pause', note: 'second' });
  const full = h.toJSON(), states = new Map(full.states), resumes = new Map(full.resumes);
  const second = full.checkpoints.at(-1)!;
  second.resume = first.resume;
  const { stateHash, parent, cause, rulesVersion, resume } = second;
  second.id = hashOf({ stateHash, parent, cause, rulesVersion, resume }).slice(0, 24);
  full.workspaces.find((w) => w.id === 'ws')!.head = second.id;
  const restored = WorldHistory.fromJSON({ ...full, states: undefined, resumes: undefined });
  restored.attachStateStore({ get: (k) => states.get(k), put: () => {}, getResume: (k) => resumes.get(k), putResume: () => {} });
  assert.equal(restored.read(first.id, { resume: true }).snapshot!.stateHash, first.stateHash);
  assert.throws(() => restored.read('ws', { resume: true }), corrupt);
  captures.push({ case: 'cached resume referenced by another world', diagnostic: 'corrupt-history' });
  if (process.env.MARS_HISTORY_INTEGRITY_CAPTURE) writeFileSync(process.env.MARS_HISTORY_INTEGRITY_CAPTURE, JSON.stringify(captures, null, 2) + '\n');
});
