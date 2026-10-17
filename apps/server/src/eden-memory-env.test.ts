// TEMPORARY (lane L1 experiment): Eden 2026 memory with one resident under different glibc malloc settings, on Linux.
import test from 'node:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PROBE = fileURLToPath(new URL('../test/eden-memory-probe.ts', import.meta.url));
const run = (env: Record<string, string>) => new Promise<string>((resolve) => {
  const c = spawn(process.execPath, ['--expose-gc', PROBE], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'ignore'] });
  let out = ''; c.stdout.on('data', (d) => (out += d)); c.on('close', () => resolve(out));
});
const MATRIX: Record<string, Record<string, string>> = {
  default: {},
  arena2: { MALLOC_ARENA_MAX: '2' },
  mmap256k: { MALLOC_MMAP_THRESHOLD_: '262144', MALLOC_TRIM_THRESHOLD_: '1048576' },
  both: { MALLOC_ARENA_MAX: '2', MALLOC_MMAP_THRESHOLD_: '262144', MALLOC_TRIM_THRESHOLD_: '1048576' },
};
test('Eden 2026 memory under malloc settings (diagnostic)', { timeout: 1_800_000, skip: process.platform !== 'linux' && 'Linux only' }, async (t) => {
  const outs = await Promise.all(Object.entries(MATRIX).map(async ([k, env]) => [k, await run(env)] as const));
  for (const [k, out] of outs) for (const line of out.trim().split('\n')) t.diagnostic(`${k} ${line}`);
});
