// Operator step for old Eden's office upper floors: the pure parts (spots merge, descriptor edit, capture diff) and the
// guarded file steps on a throwaway launcher data layout (review, backup, apply/rollback dry runs, verify).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { officeFact, officeSpots } from './old-eden-office.mjs';
import { layout, mergeSpots, editDescriptor, diffCaptures, review, backup, apply, rollback, verify, removeFact } from './upper-floors.mjs';

const ROOMS = ['eden-office-1-floor-1', 'eden-office-1-floor-2', 'int-office-studio', 'int-office-upper-lounge'];
const places = { places: [...ROOMS, 'commons'].map((id) => ({ id })) };

test('spots merge adds the upstairs spots once and refuses clashes or unknown rooms', () => {
  const base = { contract: 'x', spots: [{ id: 'commons-bench', place: 'commons' }] }, merged = mergeSpots(base, places);
  assert.equal(merged.spots.length, 1 + officeSpots().length); assert.equal(merged.contract, 'x');
  assert.ok(officeSpots().every((s) => ROOMS.includes(s.place) && [11, 12].includes(s.level)));
  assert.throws(() => mergeSpots(merged, places), /already in the spots file/);
  assert.throws(() => mergeSpots(base, { places: [{ id: 'commons' }] }), /missing from the place data/);
  const d = { worldId: 'w', flags: { a: 1 }, activitySpots: '/old' }, e = editDescriptor(d, { upperFloors: '/f', activitySpots: '/new' });
  assert.deepEqual(e, { worldId: 'w', flags: { a: 1 }, activitySpots: '/new', upperFloors: '/f' }); assert.equal(d.activitySpots, '/old');
  assert.deepEqual(diffCaptures({ a: '1', b: '2' }, { a: '1', b: '3', c: '4' }), { changed: ['b'], added: ['c'], removed: [], same: false });
  assert.equal(diffCaptures({ a: '1' }, { a: '1' }).same, true);
});

test('review, backup, apply/rollback dry runs and verify on a throwaway launcher layout', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'upper-floors-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const L = layout(root, 'eden'); mkdirSync(join(root, 'forks/descriptors'), { recursive: true }); mkdirSync(join(root, 'worlds/eden'), { recursive: true });
  const spots = join(root, 'spots.json'), placeData = join(root, 'places.json');
  writeFileSync(spots, JSON.stringify({ spots: [] })); writeFileSync(placeData, JSON.stringify(places));
  writeFileSync(L.descriptor, JSON.stringify({ worldId: 'w', worldKey: 'eden', activitySpots: spots, placeData }));
  const db = new DatabaseSync(L.db); db.exec('CREATE TABLE events (world_id TEXT, seq INTEGER, tick INTEGER, kind TEXT, author TEXT, payload TEXT, at INTEGER, soul_id TEXT)'); db.close();
  const r = review(L);
  assert.equal(r.state, 'not-applied'); assert.equal(r.wouldWrite.spots.added, officeSpots().length); assert.deepEqual(r.wouldWrite.fact.rooms, ROOMS);
  const b = backup(L, join(root, 'bk'));
  assert.equal(b.activitySpots, spots); assert.equal(b.maxSeq, null); assert.throws(() => backup(L, join(root, 'bk')), /exists/);
  writeFileSync(join(root, 'keeper.json'), JSON.stringify({ active: { dir: join(root, 'old-release'), build: 'old' } }));
  assert.equal(review(L).release.upperFloors, false);
  assert.throws(() => apply(L, { backupDir: join(root, 'bk'), confirm: false, port: 1 }), /refresh the legacy release/);
  rmSync(join(root, 'keeper.json'));
  const dry = apply(L, { backupDir: join(root, 'bk'), confirm: false, port: 1 });
  assert.equal(dry.dryRun, true); assert.deepEqual(dry.write, [L.fact, L.spots, L.descriptor]);
  assert.equal(JSON.parse(readFileSync(L.descriptor, 'utf8')).upperFloors, undefined, 'a dry run writes nothing');
  assert.throws(() => rollback(L, { backupDir: join(root, 'bk'), confirm: false, port: 1 }), /does not name the installed office/);
  // a changed descriptor needs a fresh backup
  writeFileSync(L.descriptor, JSON.stringify({ worldId: 'w', worldKey: 'eden', activitySpots: spots, placeData, x: 1 }));
  assert.throws(() => apply(L, { backupDir: join(root, 'bk'), confirm: false, port: 1 }), /fresh backup/);
  // the world's own log decides verify
  writeFileSync(L.descriptor, JSON.stringify({ worldId: 'w', worldKey: 'eden', activitySpots: L.spots, placeData, upperFloors: L.fact }));
  assert.equal(verify(L, 'installed').ok, false);
  const w = new DatabaseSync(L.db), add = (seq, payload) => w.prepare('INSERT INTO events VALUES (?,?,?,?,?,?,?,?)').run('w', seq, seq, 'rules', 'operator:upper-floors', JSON.stringify(payload), 0, null);
  add(1, { upperFloorsV1: officeFact() });
  assert.deepEqual({ ok: verify(L, 'installed').ok, state: verify(L).state }, { ok: true, state: 'applied' });
  const rb = rollback(L, { backupDir: join(root, 'bk'), confirm: false, port: 1 });
  assert.equal(rb.dryRun, true); assert.equal(rb.activitySpots, spots);
  writeFileSync(L.descriptor, JSON.stringify({ worldId: 'w', worldKey: 'eden', activitySpots: spots, placeData, upperFloors: L.remove }));
  assert.equal(verify(L, 'removed').ok, false, 'remove not logged yet (refused while someone is upstairs)');
  add(2, { upperFloorsV1: removeFact() }); w.close();
  assert.deepEqual({ ok: verify(L, 'removed').ok, state: verify(L).state }, { ok: true, state: 'rolled-back' });
});
