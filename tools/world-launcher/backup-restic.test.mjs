// Lane BK: versioned nightly backups (deploy/backup-restic.mjs) against a real local restic repository.
// Skips when restic is not installed (eden2 gets it from apt; the laptop from Homebrew).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), 'deploy/backup-restic.mjs');
const hasRestic = spawnSync('restic', ['version']).status === 0;
const T = mkdtempSync(join(tmpdir(), 'backup-restic-'));
const env = {
  ...process.env, TZ: 'UTC', RESTIC_REPOSITORY: join(T, 'repo'), RESTIC_PASSWORD_FILE: join(T, 'pass'), RESTIC_CACHE_DIR: join(T, 'cache'),
  SIM_BACKUP_DATA_ROOT: join(T, 'data'), SIM_BACKUP_STAGING: join(T, 'staging'), SIM_BACKUP_OFFSITE: '',
};
const run = (args, extra = {}) => spawnSync(process.execPath, ['--no-warnings', SCRIPT, ...args], { env: { ...env, ...extra }, encoding: 'utf8' });
const restic = (args, extra = {}) => spawnSync('restic', args, { env: { ...env, ...extra }, encoding: 'utf8' });
const world = (stage, slug) => join(T, 'data', stage, 'worlds', slug, 'sim.db');
function makeDb(file, rows) {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY, payload TEXT NOT NULL)');
  const ins = db.prepare('INSERT INTO events (payload) VALUES (?)');
  for (let i = 0; i < rows; i++) ins.run(`event ${i} ${'x'.repeat(2000)}`);
  return db;   // left open, as a live world holds it (the backup must be consistent with a WAL writer present)
}
const count = (file) => { const d = new DatabaseSync(file, { readOnly: true }); try { return d.prepare('SELECT count(*) AS n FROM events').get().n; } finally { d.close(); } };
const snaps = (tag, extra) => JSON.parse(restic(['snapshots', '--json', ...(tag ? ['--tag', tag] : [])], extra).stdout || '[]');

test('backup, version history, restore by night, retention, off-box copy', { skip: !hasRestic && 'restic not installed', timeout: 180_000 }, (t) => {
  writeFileSync(env.RESTIC_PASSWORD_FILE, 'test-only-password\n', { mode: 0o600 });
  assert.equal(run(['backup', 'production']).status, 1, 'refuses without a data dir / repository');
  const a = makeDb(world('production', 'alpha'), 200);
  const b = makeDb(world('production', 'beta'), 50);
  makeDb(join(T, 'data/production/accounts.sqlite'), 1).close();
  writeFileSync(join(T, 'data/production/worlds.json'), '[{"slug":"alpha"},{"slug":"beta"}]\n');
  mkdirSync(join(T, 'data/production/worlds/assets/wire'), { recursive: true });
  writeFileSync(join(T, 'data/production/worlds/assets/aa.glb'), 'glb-a'); writeFileSync(join(T, 'data/production/worlds/assets/wire/aa.glb.br'), 'br-a');
  let r = run(['backup', 'production']);
  assert.equal(r.status, 1); assert.match(r.stderr, /restic cat exited/, 'no repository: fails, never inits on its own');
  assert.equal(restic(['init']).status, 0);

  // night 1
  r = run(['backup', 'production'], { SIM_BACKUP_TIME: '2026-01-01 03:30:00' });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /3\/3 databases ok \(quick_check\), 1 files, 2 new assets/);
  // night 2: alpha grows, beta is deleted, an asset arrives
  const ins = a.prepare('INSERT INTO events (payload) VALUES (?)'); for (let i = 0; i < 5; i++) ins.run(`night two ${i}`);
  b.close(); renameSync(join(T, 'data/production/worlds/beta'), join(T, 'gone-beta'));
  writeFileSync(join(T, 'data/production/worlds/assets/bb.png'), 'png-b');
  r = run(['backup', 'production'], { SIM_BACKUP_TIME: '2026-01-02 03:30:00' });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /2\/2 databases ok.*1 new assets.*\(\+\d+\.\d MB\); 2 snapshots kept/);
  const growth = Number(/\(\+(\d+\.\d) MB\)/.exec(r.stdout)[1]);
  assert.ok(growth < 0.2, `second night adds only the change (${growth} MB)`);

  // restore night 1 and latest
  r = run(['restore', 'production', '2026-01-01', join(T, 'r1')]);
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /3\/3 databases ok/);
  assert.equal(count(join(T, 'r1/worlds/alpha/sim.db')), 200); assert.equal(count(join(T, 'r1/worlds/beta/sim.db')), 50);
  assert.ok(existsSync(join(T, 'r1/worlds.json')) && existsSync(join(T, 'r1/worlds/assets/wire/aa.glb.br')) && !existsSync(join(T, 'r1/worlds/assets/bb.png')));
  r = run(['restore', 'production', 'latest', join(T, 'r2')]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(count(join(T, 'r2/worlds/alpha/sim.db')), 205); assert.ok(!existsSync(join(T, 'r2/worlds/beta')) && existsSync(join(T, 'r2/worlds/assets/bb.png')));
  assert.notEqual(run(['restore', 'production', 'latest', join(T, 'r2')]).status, 0, 'never restores over a non-empty dir');
  r = run(['restore', 'production', '2025-12-31', join(T, 'r3')]);
  assert.equal(r.status, 1); assert.match(r.stderr, /no production snapshot for "2025-12-31"; have: \w{8} 2026-01-01T03:30Z/);

  // a corrupt database fails the run (exit 1) but the others are still snapshotted
  mkdirSync(join(T, 'data/production/worlds/broken'), { recursive: true });
  writeFileSync(join(T, 'data/production/worlds/broken/sim.db'), 'this is not a database'.repeat(300));
  r = run(['backup', 'production'], { SIM_BACKUP_TIME: '2026-01-03 03:30:00' });
  assert.equal(r.status, 1); assert.match(r.stdout, /2\/3 databases ok/); assert.match(r.stderr, /FAILED worlds\/broken\/sim\.db/);
  renameSync(join(T, 'data/production/worlds/broken'), join(T, 'gone-broken'));

  // retention: 200 earlier nights (made directly with restic) + another stage's snapshot; one scripted night applies 7/4/6
  const filler = join(T, 'filler'); mkdirSync(filler);
  const host = snaps('production')[0].hostname;
  for (let d = 200; d >= 4; d -= 1) {
    if (d % 3) continue;   // every third night is enough to exercise daily/weekly/monthly buckets quickly
    const when = new Date(Date.UTC(2026, 0, 1) - d * 86400_000).toISOString().slice(0, 10);
    writeFileSync(join(filler, 'n'), when);
    assert.equal(restic(['backup', '-q', '--host', host, '--tag', 'production', '--time', `${when} 03:30:00`, filler]).status, 0);
  }
  assert.equal(restic(['backup', '-q', '--host', host, '--tag', 'legacy', '--time', '2025-01-01 03:30:00', filler]).status, 0);
  r = run(['backup', 'production'], { SIM_BACKUP_TIME: '2026-01-04 03:30:00' });
  assert.equal(r.status, 0, r.stderr);
  const kept = snaps('production').map((s) => s.time.slice(0, 10)).sort();
  assert.ok(kept.length <= 17, `at most 7+4+6 snapshots (${kept.length})`);
  for (const d of ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04']) assert.ok(kept.includes(d), `newest nights kept (${d})`);
  assert.ok(kept[0] <= '2025-08-01', `monthly history reaches back ~6 months (${kept[0]})`);
  assert.equal(snaps('legacy').length, 1, 'other stage untouched');

  // off-box: one setting copies there (initialised with the same chunker) and applies the same retention
  const off = join(T, 'offsite');
  r = run(['backup', 'production'], { SIM_BACKUP_TIME: '2026-01-05 03:30:00', SIM_BACKUP_OFFSITE: off });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /offsite initialised \+ copied/);
  const local = snaps('production').length, remote = snaps('production', { RESTIC_REPOSITORY: off }).length;
  assert.equal(remote, local, `offsite holds the same kept snapshots (${remote} vs ${local})`);
  r = run(['backup', 'production'], { SIM_BACKUP_TIME: '2026-01-06 03:30:00', SIM_BACKUP_OFFSITE: off });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /offsite copied$/m);
  r = run(['restore', 'production', 'latest', join(T, 'r4')], { RESTIC_REPOSITORY: off });
  assert.equal(r.status, 0, r.stderr); assert.equal(count(join(T, 'r4/worlds/alpha/sim.db')), 205);
  a.close();
  assert.equal(run(['list', 'production']).status, 0);
  assert.equal(run(['backup', '../etc']).status, 2, 'stage name is validated');
  t.diagnostic(`tmp ${T} (${readdirSync(T).length} entries)`);
});
