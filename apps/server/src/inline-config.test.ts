import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { INLINE_CONFIG_GLOBAL, scriptJson, withInlineConfig } from './inline-config.ts';

test('the world page carries its config first thing in <head>, script-safe even with a hostile host', () => {
  const html = '<!doctype html><html><head><meta charset="utf-8"><script src="/x.js"></script></head><body></body></html>';
  const cfg = { publicUrl: 'https://evil.example.test</script><script>alert(1)</script>', worldKey: 'eden-2026', n: ' ' };
  const out = withInlineConfig(html, cfg);
  assert.ok(out.startsWith(`<!doctype html><html><head><script>window.${INLINE_CONFIG_GLOBAL}=`));
  assert.ok(out.indexOf(INLINE_CONFIG_GLOBAL) < out.indexOf('/x.js'), 'before any page script');
  assert.equal((out.match(/<\/script>/g) ?? []).length, 2, 'the hostile value cannot close the tag');
  const json = out.slice(out.indexOf('=') + 1, out.indexOf('</script>'));
  assert.deepEqual(JSON.parse(json), cfg, 'the same value after the escapes');
  assert.ok(!scriptJson({ a: '  ' }).includes(' '));
  assert.equal(withInlineConfig(html, null), html); assert.equal(withInlineConfig('<p>no head</p>', cfg), '<p>no head</p>');
});

test('http.ts serves the page with the same config object the /v1/config route answers', () => {
  const src = readFileSync(new URL('./http.ts', import.meta.url), 'utf8');
  assert.match(src, /app\.get\('\/v1\/config', \(c\) => c\.json\(configOf\(c\)\)\);/);
  assert.match(src, /c\.html\(withInlineConfig\(withSnapshotKey\(currentIndex\(\), safeKey\(currentSnapshotKey\), godRoutes\?\.partRefs\(\)\), safeConfig\(c\)\)/);  // P7: + the parts' refs
});
