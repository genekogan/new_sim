import test from 'node:test';
import assert from 'node:assert/strict';
import { attachLookPage } from './look-renderer.ts';

type Target = { targetId: string; type: string; url: string; attached?: boolean };
function cdpFixture(targetInfos: Target[], fail?: string) {
  const calls: { method: string; params: object }[] = [];
  return {
    calls,
    async send(method: string, params: object = {}) {
      calls.push({ method, params });
      if (method === fail || (fail === 'initial-attach' && method === 'Target.attachToTarget' && (params as { targetId: string }).targetId === 'initial')) throw new Error('target unavailable');
      if (method === 'Target.getTargets') return { targetInfos };
      if (method === 'Target.createTarget') return { targetId: 'created' };
      return { sessionId: `session:${(params as { targetId: string }).targetId}` };
    },
  };
}
const blank: Target = { targetId: 'initial', type: 'page', url: 'about:blank', attached: false };

test('capture attaches to the sole unused initial blank page without creating another page', async () => {
  const cdp = cdpFixture([blank, { targetId: 'worker', type: 'service_worker', url: '' }]);
  assert.deepEqual(await attachLookPage(cdp), { sessionId: 'session:initial' });
  assert.deepEqual(cdp.calls, [
    { method: 'Target.getTargets', params: {} },
    { method: 'Target.attachToTarget', params: { targetId: 'initial', flatten: true } },
  ]);
});

test('capture creates an owned blank page when the initial page is absent, changed, attached or ambiguous', async () => {
  for (const targets of [[], [{ ...blank, url: 'chrome://newtab/' }], [{ ...blank, attached: true }], [blank, { ...blank, targetId: 'second' }]]) {
    const cdp = cdpFixture(targets);
    assert.deepEqual(await attachLookPage(cdp), { sessionId: 'session:created' });
    assert.deepEqual(cdp.calls.slice(1), [
      { method: 'Target.createTarget', params: { url: 'about:blank' } },
      { method: 'Target.attachToTarget', params: { targetId: 'created', flatten: true } },
    ]);
  }
});

test('discovery or initial attachment failure falls back; new-target failure still rejects', async () => {
  for (const fail of ['Target.getTargets', 'initial-attach']) {
    const cdp = cdpFixture([blank], fail);
    assert.deepEqual(await attachLookPage(cdp), { sessionId: 'session:created' });
    assert.equal(cdp.calls.filter(c => c.method === 'Target.createTarget').length, 1);
  }
  await assert.rejects(attachLookPage(cdpFixture([], 'Target.createTarget')), /target unavailable/);
  await assert.rejects(attachLookPage(cdpFixture([], 'Target.attachToTarget')), /target unavailable/);
});
