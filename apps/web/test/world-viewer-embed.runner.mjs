// Bundle the real browser component for a bounded static-structure assertion.
// ESM preserves Three's import.meta URLs; React's node build needs createRequire.
import { build } from '../../../tools/floaters/node_modules/esbuild/lib/main.js';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = fileURLToPath(new URL('../../../.e2e/runs/world-viewer-interface/embed.test.mjs', import.meta.url));
await mkdir(fileURLToPath(new URL('../../../.e2e/runs/world-viewer-interface/', import.meta.url)), { recursive: true });
await build({ absWorkingDir: root, entryPoints: ['apps/web/test/world-viewer-embed.test.tsx'], bundle: true,
  platform: 'node', format: 'esm', jsx: 'automatic', outfile: output, external: ['node:*'],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url); globalThis.location = new URL('http://127.0.0.1/w/eden');" },
});
const result = spawnSync(process.execPath, ['--test', output], { stdio: 'inherit', cwd: root });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
