// node --test tools/world-launcher/health-dash-backup.test.mjs
// Fixup 2026-10-21: right after a release no stage has backup-last.json yet (backup-restic.mjs writes it from its first
// nightly run), and the 3.60 page alerted "no backup in its record" / Last backup "none" for stages whose backups were fine.
// The page now falls back read-only to the backup unit's last success (host-health) or the newest dated copy, and alerts
// only when the last success is older than 26 h. No ports, no world processes: healthDash() with stubs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { healthDash, lastBackup } from './health-dash.mjs';

const H = 3_600_000, T = Date.parse('2026-10-21T14:00:00.000Z');
const isoAgo = (h) => new Date(T - h * H).toISOString();

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'health-dash-backup-'));
  const root = join(dir, 'srv'), backupRoot = join(dir, 'backups');
  for (const s of ['production', 'legacy', 'fresh', 'stale']) {
    mkdirSync(join(root, s), { recursive: true });
    writeFileSync(join(root, s, 'keeper.json'), JSON.stringify({ active: { gen: 1, build: `we-${s}`, since: isoAgo(2) } }));
  }
  // legacy: no record, no unit success, only an old-style dated copy from 5 h ago
  mkdirSync(join(backupRoot, 'legacy', '20261021'), { recursive: true }); mkdirSync(join(backupRoot, 'legacy', '20261019'));
  const d5 = new Date(T - 5 * H); utimesSync(join(backupRoot, 'legacy', '20261021'), d5, d5);
  // stale: the newest dated copy is 3 days old and the unit last succeeded 40 h ago
  mkdirSync(join(backupRoot, 'stale', '20261018'), { recursive: true });
  const d72 = new Date(T - 72 * H); utimesSync(join(backupRoot, 'stale', '20261018'), d72, d72);
  return { root, dataDir: join(root, 'production'), backupRoot };
}

const host = {
  ok: true, at: isoAgo(0.1), problems: [], codes: [], units: {},
  backups: {
    production: { enabled: true, result: 'success', startedAt: isoAgo(10.1), endedAt: isoAgo(10), exitStatus: 0 },
    legacy: { enabled: true, result: 'exit-code', startedAt: isoAgo(9), endedAt: isoAgo(9), exitStatus: 1 },
    fresh: { enabled: true },
    stale: { enabled: true, result: 'success', startedAt: isoAgo(40), endedAt: isoAgo(40), exitStatus: 0 },
  },
};

function dashFor({ dataDir, backupRoot }) {
  return healthDash({
    dataDir, build: 'we-production', base: '', backupRoot, now: () => T,
    registry: { worlds: [], get: () => null }, pool: { status: () => ({ status: 'stopped' }), kids: new Map() },
    live: new Map(), stats: new Map(), refreshStats: async () => {},
    errors: { summary: () => ({ arrivals: null, newSinceRelease: 0, kinds: {}, top: [] }) },
    hostHealth: () => host, auth: null, verify: async () => null, worldOwner: () => null, wp: (s) => `/w/${s}`,
  });
}

test('lastBackup: the record wins; else the newest of unit success and dated copy; else null', () => {
  const f = setup();
  writeFileSync(join(f.dataDir, 'backup-last.json'), JSON.stringify({ at: isoAgo(1), ok: true, dbs: 7, dbsOk: 7 }));
  assert.equal(lastBackup(f.dataDir, 'production', host.backups.production, f.backupRoot).source, 'record');
  const leg = lastBackup(join(f.root, 'legacy'), 'legacy', host.backups.legacy, f.backupRoot);
  assert.deepEqual([leg.source, leg.name, leg.at, leg.ok], ['dated', '20261021', isoAgo(5), true]);   // a failed unit run is not a success
  const st = lastBackup(join(f.root, 'stale'), 'stale', host.backups.stale, f.backupRoot);
  assert.deepEqual([st.source, st.at], ['unit', isoAgo(40)]);   // newer than the 72 h dated copy
  assert.equal(lastBackup(join(f.root, 'fresh'), 'fresh', host.backups.fresh, f.backupRoot), null);
});

test('after a release with no backup-last.json anywhere: no outage alert unless the last success is older than 26 h', async () => {
  const f = setup(), d = await dashFor(f).json();
  const by = Object.fromEntries(d.stages.map((s) => [s.stage, s]));
  assert.deepEqual([by.production.backup.source, by.production.backup.at], ['unit', isoAgo(10)]);
  assert.equal(by.legacy.backup.source, 'dated');
  assert.equal(by.fresh.backup, null);
  const texts = d.alerts.map((a) => a.text);
  assert.ok(!texts.some((t) => /its record/.test(t)), texts.join(' | '));
  assert.ok(!texts.some((t) => /^(production|legacy|fresh):/.test(t)), texts.join(' | '));
  assert.ok(texts.includes('stale: no backup in 40 h'), texts.join(' | '));
});

test('a record from the first nightly run takes over; a stale record still alerts', async () => {
  const f = setup();
  writeFileSync(join(f.dataDir, 'backup-last.json'), JSON.stringify({ at: isoAgo(30), ok: true, dbs: 7, dbsOk: 7 }));
  const d = await dashFor(f).json();
  assert.equal(d.stages.find((s) => s.self).backup.source, 'record');
  assert.ok(d.alerts.some((a) => a.text === 'production: no backup in 30 h'));
});

test('the page says when the first record comes instead of "none"', () => {
  const page = dashFor(setup()).shell();
  assert.match(page, /first record after tonight’s backup/);
  assert.doesNotMatch(page, /tonight\\'s/);
  new Function(page.split('<script>').at(-1).split('</script>')[0].replace(/^\s*import .*$/gm, ''));   // the inline script still parses
});
