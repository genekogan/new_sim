// Release pre-warm (standby.ts): a world process started with SIM_STANDBY=1 loads its code, says so, and opens nothing
// until SIGUSR2; SIGTERM while waiting exits without opening. No ports, no database: a child prints what it reached.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const STANDBY = fileURLToPath(new URL('./standby.ts', import.meta.url));
const script = `import { standby, STANDBY_MARK } from ${JSON.stringify(STANDBY)};
await standby(async () => { console.log('warmed'); });
console.log('opened');`;

function run(env: Record<string, string>) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  const exited = new Promise<number | null>((r) => child.once('exit', (code) => r(code)));
  const until = async (s: string) => { for (let i = 0; i < 200 && !out.includes(s); i++) await new Promise((r) => setTimeout(r, 25)); assert.ok(out.includes(s), `reached "${s}": ${out}`); };
  return { child, exited, until, out: () => out };
}

test('without SIM_STANDBY a world boots straight through', async () => {
  const p = run({ SIM_STANDBY: '' });
  assert.equal(await p.exited, 0);
  assert.equal(p.out(), 'opened\n');
});

test('in standby the code is loaded and nothing opens until SIGUSR2', async () => {
  const p = run({ SIM_STANDBY: '1' });
  await p.until('[standby] ready');
  assert.match(p.out(), /^warmed\n\[standby\] ready pid \d+\n$/);
  await new Promise((r) => setTimeout(r, 300));
  assert.doesNotMatch(p.out(), /opened/, 'still waiting');
  p.child.kill('SIGUSR2');
  assert.equal(await p.exited, 0);
  assert.match(p.out(), /\[standby\] go\nopened\n$/);
});

test('SIGTERM in standby exits without opening anything', async () => {
  const p = run({ SIM_STANDBY: '1' });
  await p.until('[standby] ready');
  p.child.kill('SIGTERM');
  assert.equal(await p.exited, 0);
  assert.doesNotMatch(p.out(), /opened/);
});
