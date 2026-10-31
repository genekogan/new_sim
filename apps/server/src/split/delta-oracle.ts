// Stage B (lane B-delta): the WorldDelta v1 oracle harness. TEST ONLY, never loaded in production.
//   node --import ./apps/server/src/split/delta-oracle.ts apps/server/src/main.ts   (env ORACLE_CONTROL_PORT)
// Finds the host and the ledger as the server boots (prototype wraps, no server change), installs the delta tap, and
// feeds a Replica from WorldInit + every WorldDelta through structuredClone (what a MessagePort does). After every delta
// that carries a write (and every ORACLE_EVERY ticks) it compares the replica with a fresh read of every replicated table
// from main (split/world-init.ts freshTables, entities read from the live table), and counts the write paths it covered.
// A second consumer lags and catches up from the ring (`since`); /resnapshot restarts the stream mid-run.
// The control server drives 6 scripted walkers, Soul births/retirements, comms object save/act/remove/sweep and god commits.
import {createServer} from 'node:http';
import {Worker} from 'node:worker_threads';
import {threadCpuUsage} from 'node:process';
import {WorldHost} from '../world.ts';
import {EdgeLedger} from '../edge/ledger/ledger.ts';
import {GodMode} from '../god/god.ts';
import {DeltaTap} from './delta.ts';
import {freshTables, worldInit} from './world-init.ts';
import {Replica, type WorldDelta, type WorldInit} from './read-model.ts';

const CONTROL = Number(process.env.ORACLE_CONTROL_PORT ?? 5212), EVERY = Number(process.env.ORACLE_EVERY ?? 20);
const cpuMs = () => {const u = threadCpuUsage(); return (u.user + u.system) / 1000;};
const log = (m: string) => console.log(`[oracle] ${m}`);
let host: WorldHost | undefined, L: EdgeLedger | undefined, god: GodMode | undefined, tap: DeltaTap | undefined;

const boot = WorldHost.prototype.boot;
WorldHost.prototype.boot = function (this: WorldHost, ...a: unknown[]) {
  const out = (boot as (...x: unknown[]) => unknown).apply(this, a); host = this;
  const tickOnce = this.tickOnce.bind(this);
  this.tickOnce = () => {const c = cpuMs(); tickOnce(); tickCost.push(cpuMs() - c); if (tickCost.length > 50000) tickCost.splice(0, 10000);};
  setTimeout(start, 0); return out as ReturnType<WorldHost['boot']>;
};
const attach = EdgeLedger.prototype.attachComms;
EdgeLedger.prototype.attachComms = function (this: EdgeLedger, c) {attach.call(this, c); L = this; setTimeout(start, 0);};
const onCommit = GodMode.prototype.onCommit;
GodMode.prototype.onCommit = function (this: GodMode, f) {god = this; return onCommit.call(this, f);};
const tickCost: number[] = [];

// ---- consumers
const R = new Replica(), lagR = new Replica();
const stats = {inits: 0, applied: 0, refused: 0, resnapshots: 0, checks: 0, same: 0, diff: 0, lagCatchups: 0, lagResnapshots: 0, lagApplied: 0, postCpuMs: [] as number[], initMs: 0, initBytes: 0, initCpuMs: 0};
const coverage: Record<string, {seen: number; verified: number}> = {};
const diffs: unknown[] = [];
let worker: Worker | undefined;
const clone = <T>(v: T): T => structuredClone(v);
function loadInit(r: Replica, why: string) {
  const c = cpuMs(), init: WorldInit = worldInit(host!, L!, tap!), built = cpuMs() - c, w = clone(init); r.init(w);
  if (r === R) {stats.inits++; stats.initCpuMs = +built.toFixed(2); log(`init (${why}) gen ${init.gen} seq ${init.seq} tick ${init.tick}: build ${built.toFixed(1)} ms cpu`);}
}
function kinds(d: WorldDelta): string[] {
  const k: string[] = [];
  for (const r of d.receipts ?? []) k.push(r.phase === 'waiting' || r.phase === 'started' ? `receipt ${r.phase} (act accepted)` : `receipt closed (${r.phase})`);
  for (const x of d.objects?.deltas ?? []) k.push(!x.record ? 'object remove' : x.record.version <= 1 ? 'object save (create)' : (x.record.state as {removed?: boolean})?.removed ? 'object save (take-down)' : 'object save/advance');
  if (d.minds?.length) k.push('body birth (mind)'); if (d.mindsGone?.length) k.push('body retire (mind)');
  if (d.ents?.length) k.push('entity rest changed'); if (d.gone?.length) k.push('entity gone');
  if (d.static) k.push('static change'); if (d.menuInputs) k.push('menu inputs (god commit / sites)');
  if (d.ents?.some(e => (e as {carrier?: unknown}).carrier)) k.push('carrier state'); if (d.programs?.length) k.push('programme'); if (d.holds?.length) k.push('seat hold');
  if (d.sceneKey !== undefined) k.push('scene'); if (d.pages !== undefined) k.push('pages'); if (d.navReady !== undefined) k.push('navReady');
  if (d.items) k.push('placed items'); if (d.faded) k.push('faded'); if (d.env) k.push('env');
  return [...new Set(k)];
}
function onMessage(m: WorldDelta | {t: 'resnapshot'; gen: number; reason: string}) {
  if ('t' in m) {stats.resnapshots++; loadInit(R, `resnapshot: ${m.reason}`); if (worker) worker.postMessage({t: 'init', w: worldInit(host!, L!, tap!)}); return;}
  if (worker) {const c = cpuMs(); worker.postMessage({t: 'delta', d: m}); stats.postCpuMs.push(cpuMs() - c); if (stats.postCpuMs.length > 50000) stats.postCpuMs.splice(0, 10000);}
  if (!R.apply(clone(m))) {stats.refused++; loadInit(R, `refused seq ${m.seq} at ${R.pos.seq}`); return;}
  stats.applied++;
  const ks = kinds(m), write = ks.some(k => k !== 'env' && k !== 'programme');
  for (const k of ks) (coverage[k] ??= {seen: 0, verified: 0}).seen++;
  if (write || m.tick % EVERY === 0) {const ok = check(`tick ${m.tick} ${ks.join(',')}`, m); if (ok) for (const k of ks) coverage[k].verified++;}
}

// ---- the oracle: replica == fresh read of every replicated table
const J = JSON.stringify;
function canon(v: unknown): string {return J(v, (_k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : x);}
function check(where: string, d?: WorldDelta): boolean {
  const full = !d || stats.checks % 25 === 0;
  const f = freshTables(host!, L!, tap!, {cloneEntities: false}), out: string[] = [];
  const live = (host!.engine.world as unknown as {entities: Record<string, unknown>}).entities;
  let ents = 0;
  for (const [id, e] of Object.entries(live)) {const r = R.entities.get(id); if (!r) {out.push(`entity ${id} missing`); continue;} if (J(r) !== J(e) && canon(r) !== canon(e)) {const x = canon(r), y = canon(e); let i = 0; while (i < x.length && x[i] === y[i]) i++; out.push(`entity ${id}: replica …${x.slice(Math.max(0, i - 80), i + 120)} | main …${y.slice(Math.max(0, i - 80), i + 120)}`);} ents++;}
  for (const id of R.entities.keys()) if (!(id in live)) out.push(`entity ${id} extra`);
  const eq = (name: string, a: unknown, b: unknown) => {const x = canon(a), y = canon(b); if (x !== y) {let i = 0; while (i < x.length && x[i] === y[i]) i++; out.push(`${name}: replica …${x.slice(Math.max(0, i - 60), i + 160)} | main …${y.slice(Math.max(0, i - 60), i + 160)}`);}};
  eq('env', R.env, f.env);
  eq('minds', [...R.minds.values()].sort((a, b) => a.soulId.localeCompare(b.soulId)), [...f.minds].sort((a, b) => a.soulId.localeCompare(b.soulId)));
  eq('faded', [...R.faded].sort(), f.faded);
  for (const m of f.minds) eq(`receipts ${m.name}`, R.openReceipts(m.soulId), f.receipts.filter(r => r.soulId === m.soulId));
  const mine = new Set(f.minds.map(m => m.entityId));
  eq('programs', [...R.programs.values()].filter(r => mine.has(r[0])).sort(), [...f.programs].sort());
  eq('holds', [...R.holds.values()].filter(r => mine.has(r[0])).sort(), [...f.holds].sort());
  const eng = host!.engine as unknown as {carriers?(): {id: string; def: string; label: string; state: unknown}[]};
  eq('carriers', R.carrierRows().sort((a, b) => a.id.localeCompare(b.id)), (eng.carriers?.() ?? []).map(c => ({id: c.id, def: c.def, label: c.label, state: c.state})).sort((a, b) => a.id.localeCompare(b.id)));
  if (R.objectGen !== f.objects.gen) out.push(`objects gen replica ${R.objectGen} main ${f.objects.gen}`);
  if (R.objects.size !== f.objects.records.length) out.push(`objects count replica ${R.objects.size} main ${f.objects.records.length}`);
  // every record on a full check; otherwise the records this delta named (count and generation always)
  const byId = full ? null : new Map(f.objects.records.map(o => [o.id, o]));
  for (const o of full ? f.objects.records : (d?.objects?.deltas ?? []).map(x => byId!.get(x.id)).filter(o => !!o)) {const r = R.objects.get(o!.id); if (J(r ?? null) !== J(o)) {out.push(`object ${o!.id}: replica ${J(r ?? null).slice(0, 160)} | main ${J(o).slice(0, 160)}`); if (out.length > 20) break;}}
  for (const x of d?.objects?.deltas ?? []) if (!x.record && R.objects.has(x.id)) out.push(`object ${x.id} removed on main, kept by the replica`);
  eq('sceneKey', R.sceneKey, f.sceneKey); eq('pages', R.pages, f.pages); eq('navReady', R.navReady, f.navReady);
  eq('items', R.items, f.items); eq('togetherVersion', R.togetherVersion, f.togetherVersion);
  if (full || d?.static) eq('static', R.static, f.static); else eq('static epoch', R.static.epoch, f.static.epoch); eq('menuInputs', R.menuInputs, f.menuInputs); eq('living', R.living, f.living);
  stats.checks++;
  if (!out.length) {stats.same++; return true;}
  stats.diff++; if (diffs.length < 60) diffs.push({where, at: R.pos, ents, out: out.slice(0, 12)}); log(`DIFF ${where}: ${out.slice(0, 3).join(' || ')}`);
  return false;
}

// ---- the lagging consumer: catches up from the ring every LAG_MS (and re-snapshots when told to or when behind)
let lagTimer: NodeJS.Timeout | undefined;
function lagCatchup() {
  const ds = tap!.since(lagR.pos.gen, lagR.pos.seq);
  if (!ds) {stats.lagResnapshots++; loadInit(lagR, 'lag'); return;}
  for (const d of ds) {if (!lagR.apply(clone(d))) {stats.lagResnapshots++; loadInit(lagR, 'lag refused'); return;} stats.lagApplied++;}
  stats.lagCatchups++;
}

function start() {
  if (!host || !L || tap) return;
  tap = new DeltaTap(host, L); tap.measureBytes = process.env.ORACLE_BYTES !== '0';
  const t = tap; host.splitTap = (tick, out) => t.onTick(tick, out);
  const c0 = cpuMs(), init = worldInit(host, L, tap), initCpu = cpuMs() - c0, j = JSON.stringify(init);
  stats.initCpuMs = +initCpu.toFixed(1); stats.initBytes = j.length;
  log(`init: ${Object.keys(init.entities).length} entities, ${init.minds.length} minds, ${init.objects.records.length} objects, ${init.static.places.length} places; ${initCpu.toFixed(1)} ms cpu, ${(j.length / 1e6).toFixed(2)} MB; static ${(JSON.stringify(init.static).length / 1e6).toFixed(2)} MB`);
  R.init(clone(init)); lagR.init(clone(init)); stats.inits++;
  if (process.env.ORACLE_WORKER === '1') {   // a real worker on the far side of a port, to measure postMessage on the tick thread
    worker = new Worker(new URL('./read-worker.ts', import.meta.url), {workerData: {}, execArgv: []});
    worker.on('error', e => log(`worker error ${e.stack}`)); worker.postMessage({t: 'init', w: init});
  }
  tap.subscribe(onMessage);
  lagTimer = setInterval(lagCatchup, Number(process.env.ORACLE_LAG_MS ?? 2000)); lagTimer.unref();
  check('after init');
}

// ---- write-path drivers
type S = {soulId: string; entityId: string; name: string; owner: string};
const souls = (): S[] => [...host!.minds.values()].map(m => ({soulId: m.soulId, entityId: m.entityId, name: m.name, owner: m.owner}));
let walkers: string[] = [], k = 0;
async function walk() {
  for (const s of souls().filter(s => walkers.includes(s.soulId))) {
    if (L!.openReceipts(s.soulId).length) continue;
    const caps = L!.capabilities(s as never).filter(c => c.verb === 'walk' && c.available && c.target?.kind === 'place');
    if (!caps.length) continue;
    try {await L!.act(s as never, {capability: caps[(k++ * 7) % caps.length].id} as never);} catch (e) {log(`walk ${s.name}: ${(e as Error).message}`);}
  }
}
setInterval(() => {if (walkers.length) void walk();}, 10000).unref();
const objs = () => L!.comms!.objects as unknown as {create(i: Record<string, unknown>): {id: string}; act(id: string, s: S, i: Record<string, unknown>): unknown; remove(id: string): void; sweep(): unknown[]};
let markN = 0;
function objectWrites() {
  const s = souls().find(x => walkers.includes(x.soulId)) ?? souls()[0], e = (host!.engine.world as unknown as {entities: Record<string, {pose: {p: number[]}}>}).entities[s.entityId];
  const at = [e.pose.p[0], e.pose.p[2]], place = L!.places.containing(at[0], at[1], 0)[0]?.id ?? [...L!.places.byId.keys()][0], id = `bdelta-mark-${process.pid}-${++markN}`, res: Record<string, unknown> = {id, place};
  const step = (name: string, f: () => unknown) => {try {res[name] = f() ? 'ok' : 'ok';} catch (er) {res[name] = (er as Error).message;}};
  step('create', () => objs().create({id, kind: 'mark', name: 'a note', placeId: place, params: {author: s.soulId, text: 'B-delta oracle', at}}));
  step('respond', () => objs().act(id, s, {action: 'respond', params: {text: 'seen'}}));
  step('take-down', () => objs().act(id, s, {action: 'take-down', params: {}}));
  step('sweep', () => objs().sweep());
  if (markN % 2 === 0) step('remove', () => objs().remove(id));
  return res;
}
let benchN = 0;
function godCommit() {
  if (!god) return {error: 'no god in this world'};
  const s = souls()[0], e = (host!.engine.world as unknown as {entities: Record<string, {pose: {p: number[]}}>}).entities[s.entityId];
  const name = `bdelta-bench-${++benchN}`, p = [Math.round(e.pose.p[0]) + 6, Math.round(e.pose.p[2]) + 6];
  const placed = god.act({ops: [{op: 'place', def: 'core/bench@1', name, p}]}, 'B-delta oracle');
  const removed = god.act({ops: [{op: 'remove', id: name}]}, 'B-delta oracle');
  return {name, p, placed: placed.accepted ? 'ok' : placed.failures, removed: removed.accepted ? 'ok' : removed.failures};
}
async function api(method: string, path: string, body?: unknown) {
  const r = await fetch(`http://127.0.0.1:${process.env.PORT}${path}`, {method, headers: {authorization: 'Bearer dev:bdelta', 'content-type': 'application/json'}, body: body ? JSON.stringify(body) : undefined});
  return {status: r.status, body: await r.json().catch(() => null) as Record<string, unknown> | null};
}
let born: string[] = [];
async function birth() {const r = await api('POST', '/v1/souls', {name: `Bdelta${Date.now() % 100000}`, description: 'a B-delta oracle test Soul'}); const id = (r.body?.soul as {id?: string} | undefined)?.id ?? (r.body as {soulId?: string} | null)?.soulId; if (id) born.push(id); return {status: r.status, id, body: r.status >= 300 ? r.body : undefined};}
async function retire() {const id = born.shift(); if (!id) return {error: 'none born'}; const r = await api('DELETE', `/v1/souls/${id}`); return {status: r.status, id};}

const pct = (a: number[], p: number) => {const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0;};
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const summ = (a: number[]) => ({n: a.length, p50: r3(pct(a, .5)), p99: r3(pct(a, .99)), max: r3(Math.max(0, ...a)), mean: r3(a.reduce((x, y) => x + y, 0) / Math.max(1, a.length))});
createServer(async (req, res) => {
  const u = new URL(req.url ?? '/', 'http://x'); res.setHeader('content-type', 'application/json');
  try {
    if (!tap) {res.end(J({ready: false})); return;}
    let v: unknown;
    const p = u.pathname;
    if (p === '/status') v = {tick: host!.engine.world.tick, pos: tap.pos, replica: R.pos, lag: lagR.pos, stats: {...stats, postCpuMs: summ(stats.postCpuMs)}, coverage,
      cost: {...tap.cost, cpuMs: summ(tap.samples.map(s => s[0])), bytes: summ(tap.samples.map(s => s[1]))}, tickCpuMs: summ(tickCost), walkers: walkers.length, souls: souls().length, born};
    else if (p === '/diffs') v = diffs;
    else if (p === '/probe') {   // CPU per call of each read the tap makes
      const time = (f: () => unknown, n = 200) => {const c = cpuMs(); for (let i = 0; i < n; i++) f(); return r3((cpuMs() - c) / n);};
      const t = tap, eng = host!.engine as unknown as {staticEpochV1?(): number; carriers?(): unknown[]};
      v = {staticEpochV1: time(() => eng.staticEpochV1?.()), staticVersion: time(() => L!.staticVersion()), epochNow: time(() => t.epochNow()), cheapKey: time(() => t.staticCheapKey()), spotsGetter: time(() => L!.spots), menuInputs: time(() => t.menuInputsNow()),
        objectChanges: time(() => t.objectTable()?.changes(t.objectTable()!.generation)), objectTable: time(() => t.objectTable()), togetherVersion: time(() => L!.together.version),
        programs: time(() => {for (const m of host!.minds.values()) {t.programNow(m.entityId); t.holdsNow(m.entityId);}}), carriers: (eng.carriers?.() ?? []).length,
        humans: Object.values(host!.engine.world.entities as Record<string, {kind?: string}>).filter(e => e.kind === 'human').length, carrierJson: time(() => {for (const c of eng.carriers?.() ?? []) JSON.stringify((host!.engine.world.entities as Record<string, {carrier?: unknown}>)[(c as {id: string}).id]?.carrier);}), carrierBytes: (eng.carriers?.() ?? []).map(c => JSON.stringify((host!.engine.world.entities as Record<string, {carrier?: unknown}>)[(c as {id: string}).id]?.carrier).length),
        envJson: time(() => JSON.stringify(host!.engine.world.env)), minds: time(() => {for (const m of host!.minds.values()) `${m.entityId}|${m.name}|${m.owner}`;}), faded: time(() => [...L!.faded].some(x => !x)),
        livingNow: time(() => t.livingNow()), cpuMsCall: time(() => cpuMs()), menuInputValues: t.menuInputsNow().map(x => x.slice(0, 120))};}
    else if (p === '/walkers') {const n = Number(u.searchParams.get('n') ?? 6); walkers = souls().filter(s => (host!.engine.world.entities as Record<string, unknown>)[s.entityId] && !L!.faded.has(s.soulId)).slice(0, n).map(s => s.soulId); await walk(); v = {walkers};}
    else if (p === '/walk') {await walk(); v = {ok: true};}
    else if (p === '/objects') v = objectWrites();
    else if (p === '/god') v = godCommit();
    else if (p === '/birth') v = await birth();
    else if (p === '/retire') v = await retire();
    else if (p === '/check') v = {ok: check('on demand'), stats};
    else if (p === '/resnapshot') {tap.restart('forced (oracle)'); v = {gen: tap.gen};}
    else if (p === '/lagdrop') {lagR.pos = {...lagR.pos, seq: -5}; v = {ok: true};}   // as if far behind: the ring cannot serve it
    else if (p === '/reset') {tap.samples.length = 0; tickCost.length = 0; stats.postCpuMs.length = 0; v = {ok: true};}
    else {res.statusCode = 404; v = {error: 'unknown'};}
    res.end(J(v));
  } catch (e) {res.statusCode = 500; res.end(J({error: (e as Error).stack}));}
}).listen(CONTROL, '127.0.0.1', () => log(`control on ${CONTROL}`));
