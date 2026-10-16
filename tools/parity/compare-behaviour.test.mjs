import test from 'node:test';
import assert from 'node:assert/strict';
import { runComparisonBehaviour } from './compare-behaviour.mjs';

const input = { oldBase: 'http://127.0.0.1:5900/w/mars', newBase: 'http://127.0.0.1:5901/w/my-mars-college-2026-3', world: 'mars', freshWorld: true };
function fake({ empty = false, refuseSit = false, fail = false } = {}) {
  const states = new Map(), calls = [];
  const request = async (base, path, opts = {}) => {
    calls.push({ base, path, opts });
    if (fail) throw Object.assign(new Error('Credential-bearing exception token=DO-NOT-SERIALIZE'), { code: 'offline', status: 503 });
    const side = base === input.oldBase ? 'old' : 'new';
    const state = states.get(side) ?? { activity: 'idle', capability: null }; states.set(side, state);
    const place = side === 'old' ? 'kitchen' : 'g-mimos.floor';
    if (path === '/v1/admin') return { code: 'private-invite' };
    if (path === '/v1/invite') return {};
    if (path === '/v1/souls') return { soul: { id: `s_${side}`, entityId: `h_${side}` } };
    if (path.endsWith('/pair') && path !== '/v1/agent/pair') return { code: 'private-pair' };
    if (path === '/v1/agent/pair') return { token: `private-token-${side}` };
    if (path === '/v1/edge/body') return { body: null };
    if (path === '/v1/edge/map') return { places: [{ id: place, name: side === 'old' ? 'Kitchen' : 'mimos/floor', enclosed: true, walkable: true }] };
    if (path === '/v1/edge/capabilities') return { capabilities: empty ? [] : [
      { id: side === 'old' ? 'walk:kitchen' : 'walk:mimos/floor', verb: 'walk', target: { id: place, kind: 'place' }, available: true, label: 'Enter the interior' },
      { id: 'sit:chair', verb: 'sit', target: { id: 'chair', kind: 'object' }, available: true, label: 'Sit on the chair' },
      { id: 'stand:here', verb: 'stand', available: true, label: 'Stand' },
      side === 'old' ? { id: 'read:book', verb: 'read', target: { id: 'book', kind: 'spot' }, available: true, label: 'Read the book' }
        : { id: 'pick-up:bowl', verb: 'pick-up', target: { id: 'bowl', kind: 'item' }, available: true, label: 'Pick up the bowl' },
    ] };
    if (path === '/v1/edge/act') {
      const cap = opts.body.capability;
      if (refuseSit && cap.startsWith('sit:')) return { accepted: false, code: 'seat.taken' };
      state.capability = cap; state.activity = cap.startsWith('sit:') ? 'sit' : cap.startsWith('read:') ? 'read' : 'idle';
      return { accepted: true, receipt: { id: `r_${side}`, capability: cap, phase: 'started' } };
    }
    if (path === '/v1/edge/observe') return { tick: 100, self: { entityId: `h_${side}`, position: [2, 0, 3], activity: state.activity, state: 'standing', placePath: state.capability ? [{ id: place }] : [], holding: null } };
    if (path.startsWith('/v1/edge/receipts/')) return { receipt: { id: `r_${side}`, capability: state.capability, phase: state.activity === 'sit' || state.activity === 'read' ? 'started' : 'completed' } };
    if (path === '/v1/world/entities/bowl') return { entity: { id: 'bowl', in: { parent: `h_${side}` } } };
    throw new Error(`Unexpected mock request ${path}`);
  };
  return { request, calls };
}

test('only two explicitly fresh lane endpoints can be acted on', async () => {
  const f = fake();
  await assert.rejects(runComparisonBehaviour({ ...input, oldBase: 'http://127.0.0.1:4963/w/mars', request: f.request }), /disposable/);
  await assert.rejects(runComparisonBehaviour({ ...input, freshWorld: false, request: f.request }), /disposable/);
  await assert.rejects(runComparisonBehaviour({ ...input, newBase: input.oldBase, request: f.request }), /distinct/);
  assert.equal(f.calls.length, 0);
});

test('measures actual enter/sit/use on both sides and keeps catalogue separate from original cast', async () => {
  const f = fake(), report = await runComparisonBehaviour({ ...input, request: f.request });
  for (const side of ['old', 'new']) for (const activity of ['enter', 'sit', 'use']) assert.equal(report.sides[side].steps[activity].status, 'OBSERVED');
  assert.equal(report.sides.old.steps.use.effect.activity, 'read');
  assert.equal(report.sides.new.steps.use.effect.heldEntity, 'bowl');
  assert.equal(report.rows.find((r) => r.activity === 'original-cast').old.status, 'UNMEASURED');
  assert.equal(report.rows.find((r) => r.activity === 'catalogue').new.status, 'LISTED');
  assert.equal('mayMove' in report, false); assert.equal('verdict' in report, false);
  assert.doesNotMatch(JSON.stringify(report), /private-token|private-invite|private-pair/);
});

test('missing offers are gaps and real refusals remain visible', async () => {
  const missing = await runComparisonBehaviour({ ...input, request: fake({ empty: true }).request });
  assert.equal(missing.sides.old.steps.use.status, 'NOT_OFFERED');
  assert.equal(missing.sides.new.steps.enter.status, 'NOT_OFFERED');
  const blocked = await runComparisonBehaviour({ ...input, request: fake({ refuseSit: true }).request });
  assert.equal(blocked.sides.old.steps.sit.status, 'REFUSED');
  assert.equal(blocked.sides.old.steps.sit.code, 'seat.taken');
});

test('request failure remains unknown and never serializes credential-bearing exception text', async () => {
  const report = await runComparisonBehaviour({ ...input, request: fake({ fail: true }).request });
  assert.equal(report.sides.old.steps.enter.status, 'UNKNOWN');
  assert.equal(report.sides.new.steps.sit.status, 'UNKNOWN');
  assert.doesNotMatch(JSON.stringify(report), /DO-NOT-SERIALIZE/);
});
