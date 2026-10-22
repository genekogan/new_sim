import test from 'node:test';
import assert from 'node:assert/strict';
import { originCacheClass, originCacheProblem } from './origin-cache.mjs';

const IMM = 'public, max-age=31536000, immutable', DAYSWR = 'public, max-age=86400, stale-while-revalidate=604800';
const r = (path, cc, cf = 'HIT', status = 200) => ({ path, status, headers: { ...(cc ? { 'cache-control': cc } : {}), ...(cf ? { 'cf-cache-status': cf } : {}) } });

test('classes: hashed bundles and parts, release-stable static, everything else ignored', () => {
  assert.equal(originCacheClass('/worlds/assets/LiveWorld-BN26MIPk.js'), 'hashed');
  assert.equal(originCacheClass('/assets/cdn-manifest-BN26MIPk.json'), 'hashed');
  assert.equal(originCacheClass('/worlds/w/eden-2026/v1/world/part/8cd8bf3068833a807af5426e595f3290'), 'hashed');
  assert.equal(originCacheClass('/worlds/mars-assets/draco/draco_decoder.wasm'), 'stable');
  assert.equal(originCacheClass('/worlds/modular/humanoid/kit.json'), 'stable');
  for (const p of ['/worlds/w/eden-2026/', '/worlds/w/eden-2026/v1/world/snapshot?defs=ref', '/v1/site/worlds', '/manifest.webmanifest']) assert.equal(originCacheClass(p), null, p);
});

test('problems: the 3.62 draco miss, a short-lived hashed bundle, an uncacheable part; first-request MISS passes', () => {
  assert.match(originCacheProblem(r('/worlds/mars-assets/draco/draco_wasm_wrapper.js', null, 'DYNAMIC')), /max-age < 1h/);
  assert.match(originCacheProblem(r('/worlds/mars-assets/draco/draco_decoder.wasm', DAYSWR, 'DYNAMIC')), /Cloudflare DYNAMIC/);
  assert.match(originCacheProblem(r('/assets/index-AbCdEf12.js', 'public, max-age=3600')), /immutable/);
  assert.match(originCacheProblem(r('/worlds/w/x/v1/world/part/0123456789abcdef', 'no-store')), /not publicly cacheable/);
  assert.equal(originCacheProblem(r('/worlds/assets/index-AbCdEf12.js', IMM, 'MISS')), null);
  assert.equal(originCacheProblem(r('/worlds/modular/humanoid/kit.json', DAYSWR, 'HIT')), null);
  assert.equal(originCacheProblem(r('/worlds/mars-assets/draco/draco_decoder.wasm', DAYSWR, 'REVALIDATED')), null);
  assert.equal(originCacheProblem(r('/worlds/assets/index-AbCdEf12.js', null, null, 304)), null);
});
