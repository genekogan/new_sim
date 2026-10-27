import test from 'node:test';
import assert from 'node:assert/strict';
import { physicalFingerprint, runPhotographerQualification } from './photographer-runner.mjs';

test('fresh baseline fingerprint tolerates counters but detects physical and semantic drift', () => {
  const entity = { id: 'e_fixture', def: 'core/bench@1', p: [0, 0], in: { parent: 'world' },
    seed: 2, about: { front: [0, 1] }, access: 'public', v: 1, born: 1, by: 'fixture' };
  const baseline = physicalFingerprint({ entities: [entity] });
  assert.equal(physicalFingerprint({ entities: [{ ...entity, v: 9, born: 8, by: 'undo' }] }), baseline);
  for (const patch of [{ p: [1, 0] }, { seed: 3 }, { about: { front: [1, 0] } }, { access: 'private' }, { constraints: { kept: true } }])
    assert.notEqual(physicalFingerprint({ entities: [{ ...entity, ...patch }] }), baseline);
});

const cases = ['landmark', 'enclosed-room', 'interior-seat', 'lake', 'wall-artwork'].map(id => ({ id }));
test('metadata failure is retained once with every unattempted result and no retry/capture', async () => {
  let requests = 0;
  const report = {};
  const result = await runPhotographerQualification({ cases, report, deadline: Date.now() + 1000,
    signal: new AbortController().signal, out: '/unused', save() {}, setPhase() {},
    async withFixtureSession(_options, callback) {
      let error;
      try { await callback({ setPhase() {}, async request() { requests++; throw Error('HTTP 503 readiness'); } }); } catch (caught) { error = String(caught); }
      return { contextJobs: [], cleanup: { ownedPids: [] }, error };
    } });
  assert.equal(requests, 1);
  assert.match(result.error, /503 readiness/);
  assert.equal(result.results.length, 11);
  assert.ok(result.results.every(row => row.status === 'not-run' && !row.oracle));
  assert.equal(result.machinePass, false);
  assert.deepEqual(result.sessions[0].receipt.cleanup, { ownedPids: [] });
});

test('expired owner slot starts no requests and remains failed', async () => {
  let requests = 0;
  const result = await runPhotographerQualification({ cases, report: {}, deadline: Date.now() - 1,
    signal: new AbortController().signal, out: '/unused', save() {}, setPhase() {},
    async withFixtureSession() { requests++; throw Error('must not start session'); } });
  assert.equal(requests, 0);
  assert.match(result.error, /absolute deadline/);
  assert.equal(result.machinePass, false);
});

test('capture phase reaches the active session sampler rather than only the owner', async () => {
  const sessionPhases = [], ownerPhases = [];
  const bindings = cases.map(c => ({ id: c.id, ref: c.id === 'enclosed-room' ? 'e_hall/slot/real-room' : `e_${c.id}`,
    entity: c.id === 'enclosed-room' ? 'e_hall' : `e_${c.id}`, ...(c.id === 'enclosed-room' ? { slot: 'real-room' } : {}) }));
  const targets = [...bindings, { ref: 'e_hall', entity: 'e_hall' }];
  let selectedRequests = 0;
  const result = await runPhotographerQualification({ cases, report: {}, deadline: Date.now() + 1000,
    signal: new AbortController().signal, out: '/unused', save() {}, setPhase(phase) { ownerPhases.push(phase); },
    async withFixtureSession(_options, callback) {
      let error;
      try { await callback({ bindings, setPhase(phase) { sessionPhases.push(phase); }, async request(path) {
        if (path === '/v1/world/snapshot') return Response.json({ entities: [{ id: 'e_hall', name: 'hall' }] });
        if (path === '/v1/world/context') return Response.json({ targets });
        if (path === '/v1/world/context/views' && ++selectedRequests === 1)
          return Response.json({ views: [{ status: 'unavailable', photo: { status: 'unavailable', diagnostics: [] } }] });
        throw Error('fixture stops after first capture');
      } }); } catch (caught) { error = String(caught); }
      return { contextJobs: [], cleanup: { ownedPids: [] }, error };
    } });
  assert.equal(sessionPhases[0], 'photographer:base:landmark');
  assert.equal(ownerPhases.length, 0);
  assert.match(result.error, /stops after first capture/);
});
