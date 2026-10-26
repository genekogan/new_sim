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

const SHA = 'a'.repeat(64), VIEW = 'public, no-cache';
test('mutable GLB views and legacy aliases include root and world-scoped paths', () => {
  for (const prefix of ['', '/worlds', '/w/eden-2026', '/worlds/w/eden-2026']) {
    assert.equal(originCacheClass(`${prefix}/asset-view/${SHA}.glb`), 'mutable-view');
    assert.equal(originCacheClass(`${prefix}/asset-view/${SHA}.glb?cache=unchanged`), 'mutable-view');
    assert.equal(originCacheClass(`${prefix}/assets/${SHA}.glb`), 'legacy-glb');
    assert.equal(originCacheClass(`${prefix}/assets/${SHA}.png`), 'hashed');
    assert.equal(originCacheClass(`${prefix}/asset-view/${SHA}.png`), null);
  }
});
test('mutable views require public no-cache without immutable and allow dynamic origin validation', () => {
  const path = `/worlds/w/eden-2026/asset-view/${SHA}.glb`;
  for (const cf of ['DYNAMIC', 'BYPASS', 'HIT', 'MISS', 'REVALIDATED']) assert.equal(originCacheProblem(r(path, VIEW, cf)), null);
  for (const cc of [null, IMM, 'no-cache', 'public, max-age=0', 'public, no-cache, immutable', 'public, no-cache="ETag"']) assert.match(originCacheProblem(r(path, cc)), /mutable asset view/, cc);
  for (const cc of ['private, no-cache', 'no-store']) assert.match(originCacheProblem(r(path, cc)), /not publicly cacheable/);
  assert.match(originCacheProblem(r(path, IMM, 'BYPASS')), /mutable asset view/);
});
test('legacy core GLBs may revalidate while uploaded GLBs and other hash objects retain immutable checks', () => {
  const glb = `/worlds/w/eden-2026/assets/${SHA}.glb`, png = glb.replace('.glb', '.png');
  assert.equal(originCacheProblem(r(glb, VIEW, 'DYNAMIC')), null);
  assert.equal(originCacheProblem(r(glb, VIEW, 'BYPASS')), null);
  assert.equal(originCacheProblem(r(glb, IMM, 'HIT')), null);
  assert.match(originCacheProblem(r(glb, IMM, 'DYNAMIC')), /Cloudflare DYNAMIC/);
  assert.match(originCacheProblem(r(glb, IMM, 'BYPASS')), /Cloudflare BYPASS/);
  assert.match(originCacheProblem(r(glb, 'public, max-age=3600')), /immutable/);
  assert.match(originCacheProblem(r(glb, 'no-cache')), /mutable asset view/);
  assert.match(originCacheProblem(r(glb, 'public, no-cache, immutable')), /mutable asset view/);
  assert.match(originCacheProblem(r(png, VIEW, 'DYNAMIC')), /immutable/);
  assert.equal(originCacheProblem(r(png, IMM, 'HIT')), null);
});
