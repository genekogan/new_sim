#!/usr/bin/env node
// Operator step for old Eden's office upper floors on a world-launcher's fork (lane L4b, 2026-10-17; Gene's decision #5).
// The engine support is upper-floors/1 (packages/engine-mars/src/upper-floors.ts): the fork's descriptor names a fact file
// (`upperFloors`) that the edge server installs once at boot as a logged rules fact, plus an activity-spots file with the
// twelve upstairs spots. Rollback is the {remove} fact (refused while anyone is upstairs; then retry later).
// Guarded like tools/mars-rotation/add-patch.mjs: pure reads until --confirm, a backup first, receipts on disk.
// Run as the launcher's user from the release dir on the launcher's machine (eden2: cd /srv/sim-worlds/legacy && sudo -u
// simworlds node --experimental-transform-types tools/upper-floors/upper-floors.mjs ...). No credentials are read.
//
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

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BUILDING = 'eden-office-1', AUTHOR = 'operator:upper-floors', DIR = 'upper-floors';
const sha = (s) => createHash('sha256').update(s).digest('hex');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const pretty = (v) => JSON.stringify(v, null, 1) + '\n';

/** Where everything lives for one fork under a launcher data dir. */
export function layout(data, slug = 'eden') {
  const art = join(data, 'forks/artifacts', DIR);
  return { data, slug, descriptor: join(data, 'forks/descriptors', `${slug}.json`), db: join(data, 'worlds', slug, 'sim.db'), art,
    fact: join(art, 'office.fact.json'), remove: join(art, 'office.remove.json'), spots: join(art, 'activity-spots.office.json') };
}
export const removeFact = () => ({ version: 'upper-floors/1', remove: BUILDING });

/** The live spots file plus the office's upstairs spots; refuses ids or places that clash, places the rooms don't know. */
export function mergeSpots(base, places, extra = officeSpots()) {
  const ids = new Set(base.spots.map((s) => s.id)), clash = extra.filter((s) => ids.has(s.id)).map((s) => s.id);
  assert(!clash.length, `office spots already in the spots file: ${clash.join(', ')}`);
  const placeIds = new Set(places.places.map((p) => p.id)), missing = [...new Set(extra.map((s) => s.place))].filter((p) => !placeIds.has(p));
  assert(!missing.length, `office rooms missing from the place data: ${missing.join(', ')}`);
  return { ...base, spots: [...base.spots, ...extra] };
}
/** The descriptor with the office installed (or removed again), every other field byte-identical in value. */
export function editDescriptor(d, { upperFloors, activitySpots }) { return { ...d, activitySpots, upperFloors }; }

/** The release the launcher is serving now (keeper.json) and whether it carries upper-floors/1. */
export function runningRelease(L) {
  const k = join(L.data, 'keeper.json'); if (!existsSync(k)) return { dir: null, upperFloors: null };
  const dir = readJson(k).active?.dir, entry = dir && join(dir, 'tools/core/edge-server.mjs');
  return { dir, build: readJson(k).active?.build ?? null, upperFloors: !!entry && existsSync(entry) && readFileSync(entry, 'utf8').includes('upperFloors') && existsSync(join(dir, 'packages/engine-mars/src/upper-floors.ts')) };
}
/** Pure reads: what is installed now and what apply would write. */
export function review(L) {
  const d = readJson(L.descriptor), out = { descriptor: L.descriptor, descriptorSHA256: sha(readFileSync(L.descriptor)), worldId: d.worldId,
    upperFloors: d.upperFloors ?? null, activitySpots: d.activitySpots, release: runningRelease(L), files: {} };
  for (const k of ['fact', 'remove', 'spots']) out.files[k] = existsSync(L[k]) ? sha(readFileSync(L[k])) : null;
  out.last = lastFact(L.db);
  out.state = !d.upperFloors ? (out.last?.install ? 'installed-without-descriptor?' : 'not-applied') : d.upperFloors === L.fact ? (out.last?.install ? 'applied' : 'descriptor-only (restart pending or refused)') : d.upperFloors === L.remove ? (out.last && !out.last.install ? 'rolled-back' : 'rollback pending or refused (someone upstairs?)') : 'unknown upperFloors path';
  if (!d.upperFloors) {
    const spots = mergeSpots(readJson(d.activitySpots), readJson(d.placeData)), fact = officeFact();
    out.wouldWrite = { fact: { path: L.fact, sha256: sha(pretty(fact)), levels: fact.building.levels.map((l) => l.id), rooms: fact.building.regions.map((r) => r.id) },
      spots: { path: L.spots, sha256: sha(pretty(spots)), spots: spots.spots.length, added: officeSpots().length }, descriptor: { upperFloors: L.fact, activitySpots: L.spots } };
  }
  return out;
}
/** The world log's last upper-floors fact (read-only open; WAL readers never block the writer). */
export function lastFact(dbPath) {
  if (!existsSync(dbPath)) return null;
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const r = db.prepare('SELECT seq,tick,at,payload FROM events WHERE author=? ORDER BY seq DESC LIMIT 1').get(AUTHOR);
    if (!r) return null; const p = JSON.parse(r.payload).upperFloorsV1;
    return { seq: r.seq, tick: r.tick, at: r.at, install: !!p?.building, building: p?.building?.id ?? p?.remove };
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
  const out = {}, put = (k, v) => { out[k] = sha(JSON.stringify(v) ?? 'undefined'); }, w = engine.world, mine = `upper:${office.building}:`;
  for (const [id, x] of Object.entries(w.entities)) put('entity:' + id, x);
  for (const [id, x] of Object.entries(w.regions)) if (!office.rooms.has(id)) put('region:' + id, x);
  for (const k of Object.keys(w)) if (!['entities', 'regions', 'upperFloorsV1'].includes(k)) put('world:' + k, w[k]);
  for (const [id, x] of Object.entries(kernel.things)) if (!office.rooms.has(id)) put('thing:' + id, x);
  for (const k of Object.keys(kernel)) if (k !== 'things') put('kernel:' + k, kernel[k]);
  for (const [id, e] of Object.entries(engine.ents ?? {})) if (e.kind === 'human') put('body:' + id, { p: e.pose.p, level: e.human?.level ?? 0, activity: e.human?.activity });
  const b = engine.rt?.services?.spatial?.base;
  if (b) {
    for (const l of b.levels) if (!office.levels.has(l.id)) put('level:' + l.id, l);
    for (const [kind, list] of [['solid', b.obstacles], ['surface', b.surfaces], ['link', b.links]]) for (const o of list) if (!String(o.id).startsWith(mine)) put(`${kind}:${o.id}`, o);
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
  const d = readJson(L.descriptor), fact = officeFact(), spotsFile = join(scratch, 'activity-spots.office.json');
  writeFileSync(spotsFile, pretty(mergeSpots(readJson(d.activitySpots), readJson(d.placeData))));
  if (copy) copyFileSync(copy, join(scratch, 'sim.db'));
  else { const db = new DatabaseSync(L.db, { readOnly: true }); try { db.exec(`VACUUM INTO '${join(scratch, 'sim.db').replaceAll("'", "''")}'`); } finally { db.close(); } }
  const { forkOptions } = await import(pathToFileURL(join(ROOT, 'tools/world-launcher/fork-world.mjs')).href);
  const { openEdgeServerV1 } = await import(pathToFileURL(join(ROOT, 'tools/core/edge-server.mjs')).href);
  const o = forkOptions(d, { PORT: String(port), DATA_DIR: scratch, PUBLIC_URL: `http://127.0.0.1:${port}`, WORLD_PATH: `/worlds/w/${L.slug}`, BUILD_ID: 'upper-floors-plan' }), f = o.flags ?? {};
  const app = await openEdgeServerV1({ ...o, activitySpots: spotsFile, upperFloors: undefined, webDir: undefined, marsWebDir: undefined, accountAuth: false, seedObjects: o.objects, localBudget: 0, autonomous: false, quiesceThought: true,
    officeStairGuards: f.officeStairGuards ?? false, ambient: o.ambient !== false, humanRest: f.humanRest ?? true, provisions: f.provisions ?? true, sequences: f.sequences ?? true, floorGoals: f.floorGoals ?? true,
    kitchen: f.kitchen ?? true, shore: f.shore ?? true, foodDeliveryId: f.foodDeliveryId, quietLandingCourtesy: f.quietLandingCourtesy ?? true, social: f.social ?? true, approachRetention: f.approachRetention ?? true,
    closedGoals: f.closedGoals ?? true, activateExpansion: f.activateExpansion ?? true });
  const host = app.host, e = host.engine, receipt = { at: new Date().toISOString(), worldId: o.worldId, copy: join(scratch, 'sim.db'), factSHA256: sha(pretty(fact)) };
  try {
    host.stop();   // no ticks from here: every difference below is the fact's own
    const drive = async (p) => { let done = false, val, err; p.then((v) => { done = true; val = v; }, (x) => { done = true; err = x; });
      for (let i = 0; i < 200 && !done; i++) { await new Promise((r) => setImmediate(r)); host.drainInputs(); }
      assert(done, 'fact not settled by the sequencer'); if (err) throw err; return val; };
    const office = { building: BUILDING, rooms: new Set(fact.building.regions.map((r) => r.id)), levels: new Set(fact.building.levels.map((l) => l.id)) };
    // a resident on the ground who can walk to the foot of the office stairs today (not one in the shore's own domain)
    const foot = fact.building.links.find((l) => l.from.level === 0).from.p;
    const walker = Object.keys(e.ents).sort().find((id) => e.ents[id].kind === 'human' && (e.ents[id].human?.level ?? 0) === 0 && e.routeEstimateV1(id, foot, 0).ok);
    const reach = () => officeSpots().map((s) => ({ spot: s.id, level: s.level, ...(walker ? e.routeEstimateV1(walker, s.at, s.level) : { ok: false, code: 'no-walker' }) }));
    receipt.tick = e.world.tick; receipt.seqBefore = host.seq; receipt.walker = walker ?? null;
    const A = capture(e, host.kernel, office); receipt.compared = Object.keys(A).length;
    receipt.reachBefore = reach().filter((r) => r.ok).map((r) => r.spot);
    receipt.install = await drive(host.installUpperFloorsV1(fact));
    const B = capture(e, host.kernel, office);
    receipt.rooms = [...office.rooms].map((id) => ({ id, region: !!e.world.regions[id], place: !!host.kernel.things[id], placeLevel: e.world.regions[id]?.placeLevel ?? null }));
    receipt.levels = e.rt.services.spatial.base.levels.map((l) => l.id);
    receipt.reach = reach().map((r) => ({ spot: r.spot, ok: r.ok, ...(r.ok ? { metres: r.metres } : { code: r.code }) }));
    receipt.outsideOffice = outside(diffCaptures(A, B));
    receipt.remove = await drive(host.installUpperFloorsV1(removeFact()));
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
  assert(!d.upperFloors, `descriptor already names ${d.upperFloors}: review first`);
  const fact = officeFact(), spots = mergeSpots(readJson(d.activitySpots), readJson(d.placeData)), next = editDescriptor(d, { upperFloors: L.fact, activitySpots: L.spots });
  const steps = { write: [L.fact, L.spots, L.descriptor], restart: [`remove-fork ${L.slug}`, `register-fork ${L.slug}`, 'set-claimable false (when it was)'], backup: b.simDb };
  if (!confirm) return { dryRun: true, ...steps };
  mkdirSync(L.art, { recursive: true, mode: 0o755 });
  writeAtomic(L.fact, pretty(fact)); writeAtomic(L.spots, pretty(spots)); writeAtomic(L.descriptor, JSON.stringify(next, null, 1) + '\n');
  return { applied: true, ...steps, op: restartFork(L, next, { port, base }) };
}
export function rollback(L, { backupDir, confirm, port, base }) {
  const b = readJson(join(backupDir, 'backup.json')), d = readJson(L.descriptor);
  assert.equal(d.upperFloors, L.fact, `descriptor does not name the installed office (${d.upperFloors ?? 'none'})`);
  assert(b.activitySpots && existsSync(b.activitySpots), 'the original spots file named in the backup is missing');
  const next = editDescriptor(d, { upperFloors: L.remove, activitySpots: b.activitySpots });
  if (!confirm) return { dryRun: true, write: [L.remove, L.descriptor], activitySpots: b.activitySpots, note: 'refused at boot while anyone is upstairs: verify, and re-run restart later' };
  writeAtomic(L.remove, pretty(removeFact())); writeAtomic(L.descriptor, JSON.stringify(next, null, 1) + '\n');
  return { rolledBack: true, op: restartFork(L, next, { port, base }) };
}
export function verify(L, expect) {
  const r = review(L), last = r.last, ok = expect === 'installed' ? !!last?.install && r.state === 'applied' : expect === 'removed' ? !!last && !last.install && r.state === 'rolled-back' : true;
  return { ok, expect: expect ?? null, state: r.state, last, upperFloors: r.upperFloors, activitySpots: r.activitySpots };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2), flag = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; }, has = (k) => argv.includes(`--${k}`);
  const cmd = argv[0], data = flag('data');
  const usage = () => { console.error(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).slice(8, 18).join('\n')); process.exit(2); };
  if (!data) usage();
  const L = layout(resolve(data), flag('slug') ?? 'eden'), net = { port: Number(flag('port')), base: flag('base') ?? '' };
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
