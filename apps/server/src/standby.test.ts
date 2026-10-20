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

// G9 (lane Z1): the pre-warm rehearses the snapshot restore on a read-only connection while the previous process still
// writes: it reads the latest snapshot, never writes (the writer's next commit and the file are unaffected), never throws.
test('the restore rehearsal reads the latest snapshot read-only beside a live writer', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { mkdtempSync, statSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { rehearseRestore } = await import('./standby.ts');
  const path = join(mkdtempSync(join(tmpdir(), 'standby-')), 'sim.db');
  const writer = new DatabaseSync(path);
  writer.exec('PRAGMA journal_mode = WAL; CREATE TABLE snapshots (world_id TEXT, tick INTEGER, rules_version TEXT, snapshot TEXT)');
  const put = writer.prepare('INSERT INTO snapshots VALUES (?,?,?,?)');
  put.run('w-1', 10, 'r/1', JSON.stringify({ runtime: { tick: 10 } }));
  put.run('w-1', 20, 'r/1', JSON.stringify({ runtime: { tick: 20 } }));
  put.run('w-2', 99, 'r/1', JSON.stringify({ runtime: { tick: 99 } }));
  const restored: unknown[] = [];
  const factory = { rulesVersion: 'r/1', restore: (rt: never) => { restored.push(rt); return {}; } };
  const size = statSync(path).size;
  rehearseRestore(path, 'w-1', factory);
  assert.deepEqual(restored, [{ tick: 20 }], 'the latest snapshot of this world, once');
  assert.equal(statSync(path).size, size, 'the database file is unchanged');
  put.run('w-1', 30, 'r/1', '{}');   // the writer is not blocked by the rehearsal
  rehearseRestore(path, 'w-1', { rulesVersion: 'r/2', restore: () => { throw new Error('not for another rules version'); } });
  rehearseRestore(path, 'w-1', { rulesVersion: 'r/1', restore: () => { throw new Error('a failed rehearsal is only logged'); } });
  rehearseRestore(join(path, '..', 'missing.db'), 'w-1', factory);
  assert.equal(restored.length, 1);
  assert.throws(() => statSync(join(path, '..', 'missing.db')), 'a missing database is not created');
  writer.close();
});

test('the boot grids wait in a file beside the database, read once and removed (lane t4-mem)', async () => {
  const { mkdtempSync, readdirSync } = await import('node:fs'), { tmpdir } = await import('node:os'), { join } = await import('node:path');
  const { bootGridFile } = await import('./standby.ts');
  const dir = mkdtempSync(join(tmpdir(), 'standby-grids-')), f = bootGridFile(dir);
  f.put('0', [new Uint8Array([1, 2, 3]), new Uint8Array([4])]);
  assert.deepEqual(readdirSync(dir), ['.standby-grids-0.bin']);
  assert.deepEqual([...f.take('0')!], [1, 2, 3, 4]);
  assert.deepEqual(readdirSync(dir), [], 'removed once read');
  assert.equal(f.take('0'), null);
  f.put('1', [new Uint8Array(8)]); f.drop('1');
  assert.deepEqual(readdirSync(dir), []);
});
