// Operator step for old Eden's office upper floors: the pure parts (spots merge, descriptor edit, capture diff) and the
// guarded file steps on a throwaway launcher data layout (review, backup, apply/rollback dry runs, verify).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { officeFact, officeSpots } from './old-eden-office.mjs';
import { layout, mergeSpots, editDescriptor, diffCaptures, review, backup, apply, rollback, verify, removeFact, planVerdict, upperFloorsState } from './upper-floors.mjs';
import { HOTELS, hotelsFacts, hotelsSpots, hotelOpenings } from './old-eden-hotels.mjs';

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

test('hotels: openings are real Builder door bands, apply after the office makes an array, rollback keeps the office', async (t) => {
  const R = new URL('../../mars/viewer/app/engine-view/content/assets/eden-regions/', import.meta.url).href;
  const { Builder } = await import(R + 'kit.ts'), { Terrain } = await import(R + 'terrain.ts'), { Trees } = await import(R + 'trees.ts'), { buildResort, resortPads } = await import(R + 'resort-lake.ts');
  const b = new Builder('legacy'), ter = new Terrain(() => 0); resortPads(ter); buildResort(b, ter, new Trees());
  const facts = hotelsFacts(); assert.deepEqual(facts.map((f) => f.building.id), ['eden-hotel-1', 'eden-hotel-2', 'eden-hotel-3']);
  for (const [i, f] of facts.entries()) {
    const { bands } = hotelOpenings(HOTELS[i]); assert.deepEqual(f.building.openings, bands.map((x) => x.id));
    for (const x of bands) { const v = b.boundaries.find((y) => y.id === x.id); assert.ok(v, x.id);
      assert.deepEqual([v.c[0] - v.half[0], v.c[0] + v.half[0]].map((n) => +n.toFixed(3)), [x.x0, x.x1], x.id); }
  }
  const spotIds = hotelsSpots().map((s) => s.id), rooms = new Set(facts.flatMap((f) => f.building.regions.map((r) => r.id)));
  assert.equal(new Set(spotIds).size, spotIds.length); assert.ok(hotelsSpots().every((s) => rooms.has(s.place)));
  const root = mkdtempSync(join(tmpdir(), 'upper-floors-h-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const O = layout(root, 'eden'), H = layout(root, 'eden', 'hotels'); mkdirSync(join(root, 'forks/descriptors'), { recursive: true }); mkdirSync(join(root, 'worlds/eden'), { recursive: true });
  const spots = join(root, 'spots.json'), placeData = join(root, 'places.json');
  writeFileSync(spots, JSON.stringify({ spots: [{ id: 'commons-bench', place: 'commons' }] })); writeFileSync(placeData, JSON.stringify(places));
  const db = new DatabaseSync(O.db); db.exec('CREATE TABLE events (world_id TEXT, seq INTEGER, tick INTEGER, kind TEXT, author TEXT, payload TEXT, at INTEGER, soul_id TEXT)'); db.close();
  // the office installed first: its fact path in the descriptor, its spots merged
  const officeSpotsFile = join(root, 'office-spots.json'); writeFileSync(officeSpotsFile, JSON.stringify(mergeSpots({ spots: [{ id: 'commons-bench', place: 'commons' }] }, places)));
  writeFileSync(O.descriptor, JSON.stringify({ worldId: 'w', worldKey: 'eden', activitySpots: officeSpotsFile, placeData, upperFloors: O.fact }));
  const r = review(H); assert.equal(r.state, 'not-applied'); assert.deepEqual(r.wouldWrite.descriptor.upperFloors, [O.fact, H.fact]); assert.equal(r.wouldWrite.spots.added, spotIds.length);
  backup(H, join(root, 'bk'));
  const dry = apply(H, { backupDir: join(root, 'bk'), confirm: false, port: 1 }); assert.equal(dry.dryRun, true); assert.deepEqual(dry.write, [H.fact, H.spots, H.descriptor]);
  // as if applied: both buildings named, hotel spots merged on the office's
  mkdirSync(H.art, { recursive: true }); const live = JSON.parse(readFileSync(officeSpotsFile, 'utf8')); writeFileSync(H.spots, JSON.stringify({ ...live, spots: [...live.spots, ...hotelsSpots()] }));
  writeFileSync(H.descriptor, JSON.stringify({ worldId: 'w', worldKey: 'eden', activitySpots: H.spots, placeData, upperFloors: [O.fact, H.fact] }));
  const rb = rollback(H, { backupDir: join(root, 'bk'), confirm: false, port: 1 });
  assert.equal(rb.dryRun, true); assert.equal(rb.activitySpots, officeSpotsFile, 'live minus the hotel spots is exactly the backed-up office file');
  assert.equal(rollback(O, { backupDir: join(root, 'bk'), confirm: false, port: 1 }).dryRun, true, 'the office can still roll back on its own');
});

test('plan verdict: removal must restore the pre-install upper-floors record (none first; the office when the hotels follow it)', () => {
  const office = { version: 'upper-floors/1', buildings: { 'eden-office-1': officeFact().building } };
  const both = { ...office, buildings: { ...office.buildings, 'eden-hotel-1': hotelsFacts()[0].building } };
  const r = (before, after) => ({ install: { installed: true }, rooms: [{ region: true, place: true }], reach: [{ ok: true }], outsideOffice: { same: true },
    remove: { installed: true }, upperFloorsBefore: upperFloorsState(before), afterRemove: { same: true, rooms: [], upperFloorsV1: upperFloorsState(after) } });
  assert.equal(planVerdict(r(undefined, undefined)), true, 'office first: no record before or after');
  assert.equal(planVerdict(r(office, structuredClone(office))), true, 'hotels after the office: the office record stays (the 3.6 false negative)');
  assert.deepEqual(upperFloorsState(office).buildings, ['eden-office-1']);
  assert.equal(planVerdict(r(undefined, office)), false, 'office first but a record is left behind');
  assert.equal(planVerdict(r(office, undefined)), false, 'removing the hotels took the office with it');
  assert.equal(planVerdict(r(office, both)), false, 'a hotel left installed');
  const changed = structuredClone(office); changed.buildings['eden-office-1'].levels = changed.buildings['eden-office-1'].levels.slice(1);
  assert.equal(planVerdict(r(office, changed)), false, 'same buildings but a changed office entry');
  assert.equal(planVerdict({ ...r(office, office), afterRemove: { ...r(office, office).afterRemove, rooms: ['eden-hotel-1-lobby'] } }), false);
});
