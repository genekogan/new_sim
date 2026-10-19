// P2: the launcher's template list is parsed once and again only when a template file changes (never per request).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cachedTemplates, listTemplates } from './registry.mjs';

const genesis = (name, extra = {}) => JSON.stringify({ schema: 'genesis/1', name, batches: [{ ops: [{ op: 'place' }] }], ...extra });

test('cachedTemplates equals listTemplates, reuses the parse, and notices a changed, added or hidden template', () => {
  const dir = mkdtempSync(join(tmpdir(), 'p2-templates-'));
  writeFileSync(join(dir, 'alpha.json'), genesis('Alpha'));
  writeFileSync(join(dir, 'beta.json'), genesis('Beta', { hidden: true }));
  let clock = 0; const list = cachedTemplates(dir, { everyMs: 1000, now: () => clock });
  assert.deepEqual(list(), listTemplates(dir)); assert.deepEqual(list({ all: true }), listTemplates(dir, { all: true }));
  const first = list({ all: true });
  clock = 500; assert.equal(list({ all: true }), first, 'within the check interval: the same parse');
  clock = 1500; assert.equal(list({ all: true }), first, 'nothing changed on disk: the same parse');
  writeFileSync(join(dir, 'alpha.json'), genesis('Alpha two')); utimesSync(join(dir, 'alpha.json'), 1e6, 1e6);
  clock = 3000; assert.equal(list({ all: true }).find((t) => t.id === 'alpha').name, 'Alpha two');
  writeFileSync(join(dir, 'gamma.json'), genesis('Gamma'));
  clock = 4500; assert.deepEqual(list().map((t) => t.id), listTemplates(dir).map((t) => t.id)); assert.ok(list().some((t) => t.id === 'gamma'));
  assert.ok(!list().some((t) => t.id === 'beta') && list({ all: true }).some((t) => t.id === 'beta'), 'hidden stays out of the shown list');
});
