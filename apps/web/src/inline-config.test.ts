import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { INLINE_CONFIG_GLOBAL, takeInlineConfig } from './inline-config.ts';

test('the inline config is taken once, as a JSON response; none on the page means the GET', async () => {
  const g = globalThis as unknown as { window?: Record<string, unknown> }; const had = g.window; g.window = {};
  try {
    assert.equal(takeInlineConfig(), null);
    g.window[INLINE_CONFIG_GLOBAL] = { worldKey: 'eden-2026', worldId: 'w1', worldPath: '/w/eden-2026' };
    const r = await takeInlineConfig()!;
    assert.equal(r.status, 200); assert.match(r.headers.get('content-type') ?? '', /application\/json/);
    assert.deepEqual(await r.json(), { worldKey: 'eden-2026', worldId: 'w1', worldPath: '/w/eden-2026' });
    assert.equal(takeInlineConfig(), null, 'a retry fetches afresh');
  } finally { g.window = had; }
});

test('main.tsx uses the inline config before the entry prefetch and the GET, on the first try only', () => {
  const src = readFileSync(new URL('./main.tsx', import.meta.url), 'utf8');
  assert.match(src, /\(\(tries === 0 \? takeInlineConfig\(\) \?\? takeConfigPrefetch\(apiPath\('\/v1\/config'\)\) : null\) \?\? fetch\(apiPath\('\/v1\/config'\)\)\)\.then\(r=>readWorldBootstrap/);
});
