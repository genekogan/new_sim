#!/usr/bin/env node
// Operator step for old Eden's office upper floors (--building office, the default) and seafront hotels 1-3 (--building
// hotels: a second, separate guarded install of three facts) on a world-launcher's fork (lane L4b, 2026-10-17; Gene's
// decision #5). The descriptor's `upperFloors` is one fact path, or an array of them when both buildings are installed.
// The engine support is upper-floors/1 (packages/engine-mars/src/upper-floors.ts): the fork's descriptor names a fact file
// (`upperFloors`) that the edge server installs once at boot as a logged rules fact, plus an activity-spots file with the
// twelve upstairs spots. Rollback is the {remove} fact (refused while anyone is upstairs; then retry later).
// Guarded like tools/mars-rotation/add-patch.mjs: pure reads until --confirm, a backup first, receipts on disk.
// Run as the launcher's user from the release dir on the launcher's machine (eden2: cd /srv/sim-worlds/legacy && sudo -u
// simworlds node --experimental-transform-types tools/upper-floors/upper-floors.mjs ...). No credentials are read.
//
//   (every command takes [--building office|hotels])
//   review   --data <launcher data dir> [--slug eden]                       pure reads: state + what apply would write
//   backup   --data <dir> --out <new abs dir>                               VACUUM INTO compact copy + descriptor + spots
//   plan     --data <dir> --scratch <new abs dir> --port <free port>        boot a compact copy in this process (dev auth,
//            [--copy <compact sim.db>]                                       no minds), install, check reach + that nothing
//                                                                            outside the office changed, remove, check exact
//   apply    --data <dir> --backup <dir from backup> --port <launcher port> [--base ''] [--confirm]
//   verify   --data <dir> [--expect installed|removed]                      the world DB's last upper-floors fact + audit
//   rollback --data <dir> --backup <dir> --port <launcher port> [--base ''] [--confirm]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { officeFact, officeSpots } from './old-eden-office.mjs';
import { hotelsFacts, hotelsRemoveFacts, hotelsSpots } from './old-eden-hotels.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const AUTHOR = 'operator:upper-floors', DIR = 'upper-floors';
/** What each install puts in: its facts (installed in order), their removal, the spots it adds, the files it writes, and a
 *  ground point a resident can walk to today (the plan's walker). The office's files stay byte-compatible with its first install. */
export const BUILDINGS = {
  office: { key: 'office', ids: ['eden-office-1'], facts: () => [officeFact()], file: () => officeFact(), removeFile: () => removeFact(), spots: officeSpots, ownPlaces: false, probe: null },
  hotels: { key: 'hotels', ids: ['eden-hotel-1', 'eden-hotel-2', 'eden-hotel-3'], facts: hotelsFacts, file: hotelsFacts, removeFile: hotelsRemoveFacts, spots: hotelsSpots, ownPlaces: true, probe: [104, 128] },
};
const factsOf = (spec) => spec.facts();
/** The descriptor's upper-floors fact files (a path or an array of them). */
export const entriesOf = (d) => [d.upperFloors ?? []].flat().filter(Boolean);
const upperFloorsValue = (list) => (list.length === 0 ? undefined : list.length === 1 ? list[0] : list);
const sha = (s) => createHash('sha256').update(s).digest('hex');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const pretty = (v) => JSON.stringify(v, null, 1) + '\n';

/** Where everything lives for one fork under a launcher data dir. */
export function layout(data, slug = 'eden', building = 'office') {
  const art = join(data, 'forks/artifacts', DIR), spec = BUILDINGS[building]; assert(spec, `--building office|hotels, not ${building}`);
  return { data, slug, descriptor: join(data, 'forks/descriptors', `${slug}.json`), db: join(data, 'worlds', slug, 'sim.db'), art, spec,
    fact: join(art, `${building}.fact.json`), remove: join(art, `${building}.remove.json`), spots: join(art, `activity-spots.${building}.json`),
    spotsRollback: join(art, `activity-spots.${building}-rollback.json`) };
}
export const removeFact = () => ({ version: 'upper-floors/1', remove: 'eden-office-1' });

/** The live spots file plus a building's spots; refuses ids or places that clash, places neither the place data nor the
 *  building's own rooms (`ownRooms`, the facts' regions: hotel rooms are not in places.v1) know. */
export function mergeSpots(base, places, extra = officeSpots(), ownRooms = []) {
  const ids = new Set(base.spots.map((s) => s.id)), clash = extra.filter((s) => ids.has(s.id)).map((s) => s.id);
  assert(!clash.length, `office spots already in the spots file: ${clash.join(', ')}`);
  const placeIds = new Set([...places.places.map((p) => p.id), ...ownRooms]), missing = [...new Set(extra.map((s) => s.place))].filter((p) => !placeIds.has(p));
  assert(!missing.length, `office rooms missing from the place data: ${missing.join(', ')}`);
  return { ...base, spots: [...base.spots, ...extra] };
}
/** The descriptor with the office installed (or removed again), every other field byte-identical in value. */
export function editDescriptor(d, { upperFloors, activitySpots }) { return { ...d, activitySpots, upperFloors }; }
const roomsOf = (spec) => factsOf(spec).flatMap((f) => f.building.regions.map((r) => r.id));
const specSpots = (L, d) => mergeSpots(readJson(d.activitySpots), readJson(d.placeData), L.spec.spots(), L.spec.ownPlaces ? roomsOf(L.spec) : []);

/** The release the launcher is serving now (keeper.json) and whether it carries upper-floors/1. */
export function runningRelease(L) {
  const k = join(L.data, 'keeper.json'); if (!existsSync(k)) return { dir: null, upperFloors: null };
  const dir = readJson(k).active?.dir, entry = dir && join(dir, 'tools/core/edge-server.mjs');
  return { dir, build: readJson(k).active?.build ?? null, upperFloors: !!entry && existsSync(entry) && readFileSync(entry, 'utf8').includes('upperFloors') && existsSync(join(dir, 'packages/engine-mars/src/upper-floors.ts')) };
}
/** Pure reads: what is installed now and what apply would write. */
export function review(L) {
  const d = readJson(L.descriptor), out = { descriptor: L.descriptor, descriptorSHA256: sha(readFileSync(L.descriptor)), worldId: d.worldId,
    building: L.spec.key, upperFloors: d.upperFloors ?? null, activitySpots: d.activitySpots, release: runningRelease(L), files: {} };
  for (const k of ['fact', 'remove', 'spots']) out.files[k] = existsSync(L[k]) ? sha(readFileSync(L[k])) : null;
  const list = entriesOf(d), lasts = L.spec.ids.map((id) => lastFact(L.db, id)), all = (f) => lasts.every((x) => !!x && f(x));
  out.last = lastFact(L.db, L.spec.ids); if (L.spec.ids.length > 1) out.lastEach = lasts;
  out.state = list.includes(L.fact) ? (all((x) => x.install) ? 'applied' : 'descriptor-only (restart pending or refused)')
    : list.includes(L.remove) ? (all((x) => !x.install) ? 'rolled-back' : 'rollback pending or refused (someone upstairs?)')
    : list.every((p) => Object.keys(BUILDINGS).some((k) => p === join(L.art, `${k}.fact.json`) || p === join(L.art, `${k}.remove.json`))) ? (lasts.some((x) => x?.install) ? 'installed-without-descriptor?' : 'not-applied') : 'unknown upperFloors path';
  if (out.state === 'not-applied') {
    const spots = specSpots(L, d), facts = factsOf(L.spec);
    out.wouldWrite = { fact: { path: L.fact, sha256: sha(pretty(L.spec.file())), levels: facts.flatMap((f) => f.building.levels.map((l) => l.id)), rooms: facts.flatMap((f) => f.building.regions.map((r) => r.id)) },
      spots: { path: L.spots, sha256: sha(pretty(spots)), spots: spots.spots.length, added: L.spec.spots().length }, descriptor: { upperFloors: upperFloorsValue([...list, L.fact]), activitySpots: L.spots } };
  }
  return out;
}
/** The world log's last upper-floors fact for these buildings (read-only open; WAL readers never block the writer). */
export function lastFact(dbPath, buildings = ['eden-office-1']) {
  if (!existsSync(dbPath)) return null;
  const want = new Set([buildings].flat()), db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    for (const r of db.prepare('SELECT seq,tick,at,payload FROM events WHERE author=? ORDER BY seq DESC').iterate(AUTHOR)) {
      const p = JSON.parse(r.payload).upperFloorsV1, building = p?.building?.id ?? p?.remove;
      if (want.has(building)) return { seq: r.seq, tick: r.tick, at: r.at, install: !!p?.building, building };
    }
    return null;
  } finally { db.close(); }
}
function maxSeq(dbPath) { const db = new DatabaseSync(dbPath, { readOnly: true }); try { return db.prepare('SELECT max(seq) AS s FROM events').get().s; } finally { db.close(); } }

export function backup(L, out) {
  assert(!existsSync(out), `${out} exists: pick a new backup dir`); mkdirSync(out, { recursive: true, mode: 0o750 });
  const d = readJson(L.descriptor), db = new DatabaseSync(L.db, { readOnly: true });
  try { db.exec(`VACUUM INTO '${join(out, 'sim.db').replaceAll("'", "''")}'`); } finally { db.close(); }
  copyFileSync(L.descriptor, join(out, `${L.slug}.json`)); copyFileSync(d.activitySpots, join(out, 'activity-spots.json'));
  const receipt = { at: new Date().toISOString(), descriptor: L.descriptor, descriptorSHA256: sha(readFileSync(L.descriptor)), activitySpots: d.activitySpots,
    upperFloors: d.upperFloors ?? null, simDb: join(out, 'sim.db'), maxSeq: maxSeq(join(out, 'sim.db')) };
  writeFileSync(join(out, 'backup.json'), pretty(receipt)); return receipt;
}

/** What a capture of the running world is keyed by: every entity, region, world field, kernel thing and field, body
 *  pose and planner level/solid/surface/link — minus the office's own rooms, levels and `upper:<building>:` items. */
export function capture(engine, kernel, office) {
  const out = {}, put = (k, v) => { out[k] = sha(JSON.stringify(v) ?? 'undefined'); }, w = engine.world, mine = (office.buildings ?? [office.building]).map((b) => `upper:${b}:`);
  const opened = new Set((office.openings ?? []).map((o) => 'authored-boundary:' + o));   // a hotel's door bands leave the scene while it is installed
  for (const [id, x] of Object.entries(w.entities)) put('entity:' + id, x);
  for (const [id, x] of Object.entries(w.regions)) if (!office.rooms.has(id)) put('region:' + id, x);
  for (const k of Object.keys(w)) if (!['entities', 'regions', 'upperFloorsV1'].includes(k)) put('world:' + k, w[k]);
  for (const [id, x] of Object.entries(kernel.things)) if (!office.rooms.has(id)) put('thing:' + id, x);
  for (const k of Object.keys(kernel)) if (k !== 'things') put('kernel:' + k, kernel[k]);
  for (const [id, e] of Object.entries(engine.ents ?? {})) if (e.kind === 'human') put('body:' + id, { p: e.pose.p, level: e.human?.level ?? 0, activity: e.human?.activity });
  const b = engine.rt?.services?.spatial?.base;
  if (b) {
    for (const l of b.levels) if (!office.levels.has(l.id)) put('level:' + l.id, l);
    for (const [kind, list] of [['solid', b.obstacles], ['surface', b.surfaces], ['link', b.links]]) for (const o of list) if (!mine.some((m) => String(o.id).startsWith(m)) && !(kind === 'solid' && opened.has(o.id))) put(`${kind}:${o.id}`, o);
  }
  return out;
}
/** Keys added, removed or changed between two captures. */
export function diffCaptures(a, b) {
  const changed = [], added = [], removed = [];
  for (const k of Object.keys(a)) if (!(k in b)) removed.push(k); else if (a[k] !== b[k]) changed.push(k);
  for (const k of Object.keys(b)) if (!(k in a)) added.push(k);
  return { changed, added, removed, same: !changed.length && !added.length && !removed.length };
}
// a logged fact advances the kernel's own log counters (it records one more accepted event); nothing else may move
const LOG_COUNTERS = new Set(['kernel:seq', 'kernel:lastSeq', 'kernel:events', 'kernel:eventCount']);
const outside = (d) => ({ ...d, changed: d.changed.filter((k) => !LOG_COUNTERS.has(k)), same: !d.added.length && !d.removed.length && d.changed.every((k) => LOG_COUNTERS.has(k)) });

/** Boot a compact copy in this process (no ticks between captures), install, check, remove, check. */
export async function plan(L, { scratch, port, copy }) {
  assert(!existsSync(scratch), `${scratch} exists: pick a new scratch dir`); mkdirSync(scratch, { recursive: true });
  const d = readJson(L.descriptor), facts = factsOf(L.spec), spotsFile = join(scratch, `activity-spots.${L.spec.key}.json`), spotList = L.spec.spots();
  writeFileSync(spotsFile, pretty(specSpots(L, d)));
  if (copy) copyFileSync(copy, join(scratch, 'sim.db'));
  else { const db = new DatabaseSync(L.db, { readOnly: true }); try { db.exec(`VACUUM INTO '${join(scratch, 'sim.db').replaceAll("'", "''")}'`); } finally { db.close(); } }
  const { forkOptions } = await import(pathToFileURL(join(ROOT, 'tools/world-launcher/fork-world.mjs')).href);
  const { openEdgeServerV1 } = await import(pathToFileURL(join(ROOT, 'tools/core/edge-server.mjs')).href);
  const o = forkOptions(d, { PORT: String(port), DATA_DIR: scratch, PUBLIC_URL: `http://127.0.0.1:${port}`, WORLD_PATH: `/worlds/w/${L.slug}`, BUILD_ID: 'upper-floors-plan' }), f = o.flags ?? {};
  const app = await openEdgeServerV1({ ...o, activitySpots: spotsFile, upperFloors: undefined, webDir: undefined, marsWebDir: undefined, accountAuth: false, seedObjects: o.objects, localBudget: 0, autonomous: false, quiesceThought: true,
    officeStairGuards: f.officeStairGuards ?? false, ambient: o.ambient !== false, humanRest: f.humanRest ?? true, provisions: f.provisions ?? true, sequences: f.sequences ?? true, floorGoals: f.floorGoals ?? true,
    kitchen: f.kitchen ?? true, shore: f.shore ?? true, foodDeliveryId: f.foodDeliveryId, quietLandingCourtesy: f.quietLandingCourtesy ?? true, social: f.social ?? true, approachRetention: f.approachRetention ?? true,
    closedGoals: f.closedGoals ?? true, activateExpansion: f.activateExpansion ?? true });
  const host = app.host, e = host.engine, receipt = { at: new Date().toISOString(), building: L.spec.key, worldId: o.worldId, copy: join(scratch, 'sim.db'), factSHA256: sha(pretty(L.spec.file())) };
  try {
    host.stop();   // no ticks from here: every difference below is the fact's own
    const drive = async (p) => { let done = false, val, err; p.then((v) => { done = true; val = v; }, (x) => { done = true; err = x; });
      for (let i = 0; i < 200 && !done; i++) { await new Promise((r) => setImmediate(r)); host.drainInputs(); }
      assert(done, 'fact not settled by the sequencer'); if (err) throw err; return val; };
    const office = { buildings: facts.map((f) => f.building.id), rooms: new Set(facts.flatMap((f) => f.building.regions.map((r) => r.id))), levels: new Set(facts.flatMap((f) => f.building.levels.map((l) => l.id))), openings: facts.flatMap((f) => f.building.openings ?? []) };
    // a resident on the ground who can walk to the foot of the office stairs today (hotels: to the harbour strip's east end,
    // where their walkway starts; their lobbies have no floor until installed)
    const foot = L.spec.probe ?? facts[0].building.links.find((l) => l.from.level === 0).from.p;
    const walker = Object.keys(e.ents).sort().find((id) => e.ents[id].kind === 'human' && (e.ents[id].human?.level ?? 0) === 0 && e.routeEstimateV1(id, foot, 0).ok);
    const reach = () => spotList.map((s) => ({ spot: s.id, level: s.level, ...(walker ? e.routeEstimateV1(walker, s.at, s.level) : { ok: false, code: 'no-walker' }) }));
    const installAll = async (list) => { const outs = []; for (const f of list) outs.push(await drive(host.installUpperFloorsV1(f))); return { installed: outs.every((x) => x?.installed === true), each: outs }; };
    receipt.tick = e.world.tick; receipt.seqBefore = host.seq; receipt.walker = walker ?? null;
    const A = capture(e, host.kernel, office); receipt.compared = Object.keys(A).length;
    receipt.reachBefore = reach().filter((r) => r.ok).map((r) => r.spot);
    receipt.install = await installAll(facts);
    const B = capture(e, host.kernel, office);
    receipt.rooms = [...office.rooms].map((id) => ({ id, region: !!e.world.regions[id], place: !!host.kernel.things[id], placeLevel: e.world.regions[id]?.placeLevel ?? null }));
    receipt.levels = e.rt.services.spatial.base.levels.map((l) => l.id);
    receipt.reach = reach().map((r) => ({ spot: r.spot, ok: r.ok, ...(r.ok ? { metres: r.metres } : { code: r.code }) }));
    receipt.outsideOffice = outside(diffCaptures(A, B));
    receipt.remove = await installAll([L.spec.removeFile()].flat());
    const C = capture(e, host.kernel, office);
    receipt.afterRemove = { ...outside(diffCaptures(A, C)), rooms: [...office.rooms].filter((id) => e.world.regions[id] || host.kernel.things[id]), upperFloorsV1: !!e.world.upperFloorsV1 };
    receipt.seqAfter = host.seq;
    receipt.ok = receipt.install?.installed === true && receipt.rooms.every((r) => r.region && r.place) && receipt.reach.every((r) => r.ok) && receipt.outsideOffice.same
      && receipt.remove?.installed === true && receipt.afterRemove.same && !receipt.afterRemove.rooms.length && !receipt.afterRemove.upperFloorsV1;
  } finally { await app.close().catch((x) => { receipt.closeError = String(x?.message ?? x); }); }
  writeFileSync(join(scratch, 'plan.json'), pretty(receipt)); return receipt;
}

function op(args, { port, base }) {
  const cmd = [join(ROOT, 'tools/world-launcher/op.mjs'), ...args, '--port', String(port), ...(base ? ['--base', base] : [])];
  console.log('$ node', cmd.join(' '));
  return execFileSync(process.execPath, cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim().slice(0, 600);
}
function writeAtomic(path, text) { const tmp = `${path}.tmp-${process.pid}`; writeFileSync(tmp, text, { mode: 0o644 }); renameSync(tmp, path); }
function checkBackup(L, dir) {
  const b = readJson(join(dir, 'backup.json'));
  assert.equal(b.descriptor, L.descriptor, 'backup is of another descriptor');
  assert.equal(b.descriptorSHA256, sha(readFileSync(L.descriptor)), 'descriptor changed since the backup: take a fresh backup');
  assert(existsSync(b.simDb), 'backup sim.db missing'); return b;
}
/** Re-start the fork on its descriptor: the launcher re-reads the descriptor only at register. */
function restartFork(L, d, flags) {
  const reg = readJson(join(L.data, 'worlds.json')), w = (Array.isArray(reg) ? reg : reg.worlds ?? []).find((x) => x.slug === L.slug);
  assert(w?.fork?.descriptor === L.descriptor, `${L.slug} is not a fork on ${L.descriptor} in this launcher`);
  const out = [];
  out.push(op(['remove-fork', '--slug', L.slug], flags));
  out.push(op(['register-fork', '--slug', L.slug, '--descriptor', L.descriptor, '--accounts', w.fork.accounts, '--name', w.name], flags));
  if (w.claimable === false) out.push(op(['set-claimable', '--slug', L.slug, '--claimable', 'false'], flags));
  return out;
}

export function apply(L, { backupDir, confirm, port, base }) {
  const b = checkBackup(L, backupDir), d = readJson(L.descriptor), rel = runningRelease(L);
  assert(rel.upperFloors !== false, `the running release ${rel.dir} has no upper-floors/1: refresh the legacy release from the trunk first`);
  const list = entriesOf(d);
  assert(!list.some((p) => p === L.fact || p === L.remove), `descriptor already names ${d.upperFloors}: review first`);
  const fact = L.spec.file(), spots = specSpots(L, d), next = editDescriptor(d, { upperFloors: upperFloorsValue([...list, L.fact]), activitySpots: L.spots });
  const steps = { write: [L.fact, L.spots, L.descriptor], restart: [`remove-fork ${L.slug}`, `register-fork ${L.slug}`, 'set-claimable false (when it was)'], backup: b.simDb };
  if (!confirm) return { dryRun: true, ...steps };
  mkdirSync(L.art, { recursive: true, mode: 0o755 });
  writeAtomic(L.fact, pretty(fact)); writeAtomic(L.spots, pretty(spots)); writeAtomic(L.descriptor, JSON.stringify(next, null, 1) + '\n');
  return { applied: true, ...steps, op: restartFork(L, next, { port, base }) };
}
export function rollback(L, { backupDir, confirm, port, base }) {
  const b = readJson(join(backupDir, 'backup.json')), d = readJson(L.descriptor);
  const list = entriesOf(d);
  assert(list.includes(L.fact), `descriptor does not name the installed ${L.spec.key === 'office' ? 'office' : L.spec.key} (${d.upperFloors ?? 'none'})`);
  assert(b.activitySpots && existsSync(b.activitySpots), 'the original spots file named in the backup is missing');
  // the spots go back to the backup's file when that is exactly the live file minus this building's spots; otherwise (the
  // other building was installed since) the live file minus only this building's spot ids
  const own = new Set(L.spec.spots().map((s) => s.id)), live = existsSync(d.activitySpots) ? readJson(d.activitySpots) : null;
  const kept = live && { ...live, spots: live.spots.filter((s) => !own.has(s.id)) }, same = !kept || JSON.stringify(kept) === JSON.stringify(readJson(join(backupDir, 'activity-spots.json')));
  const spotsPath = same ? b.activitySpots : L.spotsRollback;
  const next = editDescriptor(d, { upperFloors: upperFloorsValue(list.map((p) => (p === L.fact ? L.remove : p))), activitySpots: spotsPath });
  const write = [L.remove, ...(same ? [] : [L.spotsRollback]), L.descriptor];
  if (!confirm) return { dryRun: true, write, activitySpots: spotsPath, note: 'refused at boot while anyone is upstairs: verify, and re-run restart later' };
  writeAtomic(L.remove, pretty(L.spec.removeFile())); if (!same) writeAtomic(L.spotsRollback, pretty(kept)); writeAtomic(L.descriptor, JSON.stringify(next, null, 1) + '\n');
  return { rolledBack: true, op: restartFork(L, next, { port, base }) };
}
export function verify(L, expect) {
  const r = review(L), last = r.last, ok = expect === 'installed' ? !!last?.install && r.state === 'applied' : expect === 'removed' ? !!last && !last.install && r.state === 'rolled-back' : true;
  return { ok, expect: expect ?? null, state: r.state, last, upperFloors: r.upperFloors, activitySpots: r.activitySpots };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2), flag = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; }, has = (k) => argv.includes(`--${k}`);
  const cmd = argv[0], data = flag('data');
  const usage = () => { console.error(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//   ')).join('\n')); process.exit(2); };
  if (!data) usage();
  const L = layout(resolve(data), flag('slug') ?? 'eden', flag('building') ?? 'office'), net = { port: Number(flag('port')), base: flag('base') ?? '' };
  try {
    let out;
    if (cmd === 'review') out = review(L);
    else if (cmd === 'backup') { if (!flag('out')) usage(); out = backup(L, resolve(flag('out'))); }
    else if (cmd === 'plan') { if (!flag('scratch') || !flag('port')) usage(); out = await plan(L, { scratch: resolve(flag('scratch')), port: Number(flag('port')), copy: flag('copy') && resolve(flag('copy')) }); }
    else if (cmd === 'apply' || cmd === 'rollback') { if (!flag('backup') || !(net.port > 0)) usage(); out = (cmd === 'apply' ? apply : rollback)(L, { backupDir: resolve(flag('backup')), confirm: has('confirm'), ...net }); }
    else if (cmd === 'verify') out = verify(L, flag('expect'));
    else usage();
    console.log(JSON.stringify(out, null, 1));
    if (out && out.ok === false) process.exit(1);
    if (cmd === 'plan') process.exit(0);   // the closed server may leave timers behind
  } catch (e) { console.error(`upper-floors ${cmd} refused:`, e?.message ?? e); process.exit(1); }
}
