import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const root = new URL('../', import.meta.url);
const assets = JSON.parse(
  await readFile(new URL('.cloudflare/large-assets.json', root)),
);
let uploaded = [];
try {
  uploaded = JSON.parse(
    await readFile(new URL('.cloudflare/uploaded.json', root)),
  );
} catch {}
for (const [path, asset] of Object.entries(assets)) {
  if (uploaded.includes(asset.key)) {
    console.log(`Already uploaded: ${path}`);
    continue;
  }
  const result = spawnSync(
    './node_modules/.bin/wrangler',
    [
      'r2',
      'object',
      'put',
      `mars-campus-2026-models/${asset.key}`,
      '--remote',
      '--file',
      `.cloudflare/large${path}`,
      '--content-type',
      asset.type,
      '--cache-control',
      'public, max-age=3600',
    ],
    { cwd: root, stdio: 'inherit' },
  );
  if (result.status !== 0) process.exit(result.status || 1);
  uploaded.push(asset.key);
  await writeFile(
    new URL('.cloudflare/uploaded.json', root),
    JSON.stringify(uploaded, null, 2),
  );
}
