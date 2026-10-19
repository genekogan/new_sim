// Offline: node --test apps/web/src/old-eden-split.test.ts
// P1 phones: the old Eden expansion (old /w/eden's town builders, ~560 KB) is its own lazy chunk. A static (value) import
// of any of these modules from the web app would pull it back into the Shell bundle every new world downloads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = new URL('.', import.meta.url).pathname;
const LAZY = [/\/WorldEdenExpansion\.ts'/, /\/old-eden\.ts'/, /eden-regions\/index\.ts'/, /eden-interiors\/index\.ts'/, /eden-expansion-assets\/eden-house-windows\.ts'/];
const files = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx|mjs)$/.test(f) && !/\.test\./.test(f) ? [p] : []; });

test('no web module statically imports the old Eden expansion (only LiveWorld\'s dynamic import of old-eden.ts)', () => {
  const bad: string[] = [];
  for (const f of files(SRC)) {
    if (f.endsWith('/old-eden.ts') || f.endsWith('/WorldEdenExpansion.ts')) continue;  // inside the lazy chunk
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      if (!/^\s*(import|export)\b/.test(line) || /^\s*import\s+type\b/.test(line) || /import\(/.test(line)) continue;
      if (LAZY.some((r) => r.test(line))) bad.push(`${f.slice(SRC.length)}: ${line.trim().slice(0, 120)}`);
    }
  }
  assert.deepEqual(bad, []);
  assert.match(readFileSync(join(SRC, 'LiveWorld.tsx'), 'utf8'), /import\('\.\/old-eden\.ts'\)/);
});
