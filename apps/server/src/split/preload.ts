// Stage B spike (lane L9): harness preload. PROTOTYPE, never loaded in production.
//   node --import ./apps/server/src/split/preload.ts apps/server/src/main.ts   (env SPLIT_CONTROL_PORT, SPLIT_WORKER_PORT)
// Taps the real server without changing it: wraps WorldHost.prototype.boot (to find the host and wrap its engine.step,
// which reports the entities each tick touched) and EdgeLedger.prototype.attachComms (to find the ledger). Then it
// starts the read-model worker, sends WorldInit, and a WorldDelta after every tick. A loopback control server drives
// walkers, runs the oracle (main-thread answer vs worker answer at the same tick) and busy-loops the main thread.
import {Worker, isMainThread} from 'node:worker_threads';
import {createServer} from 'node:http';
import {threadCpuUsage} from 'node:process';
import {WorldHost} from '../world.ts';
import {EdgeLedger} from '../edge/ledger/ledger.ts';
import {hereFrame, Perception} from '../edge/perception/here.ts';
import {DeltaTap} from './delta.ts';

const CONTROL = Number(process.env.SPLIT_CONTROL_PORT ?? 5202), WPORT = Number(process.env.SPLIT_WORKER_PORT ?? 5203);
const cpuMs = () => {const u = threadCpuUsage(); return (u.user + u.system) / 1000;};
let host: WorldHost | undefined, L: EdgeLedger | undefined, tap: DeltaTap | undefined, worker: Worker | undefined;
const changed = new Set<string>(), tickCost = {n: 0, cpuMs: 0, max: 0};
const log = (m: string) => console.log(`[split] ${m}`);

if (!isMainThread) throw Error('split/preload.ts: main thread only');
const boot = WorldHost.prototype.boot;
WorldHost.prototype.boot = function (this: WorldHost, ...a: unknown[]) {
  const out = (boot as (...x: unknown[]) => unknown).apply(this, a); host = this;
  const eng = this.engine as unknown as {step: () => {paths: {entity: string}[]; changes: [number, string, string, unknown][]}};
  const step = eng.step.bind(eng);
  eng.step = () => {const o = step(); for (const p of o.paths) changed.add(p.entity); for (const c of o.changes) changed.add(c[1]); return o;};
  const tickOnce = this.tickOnce.bind(this);
  this.tickOnce = () => {const c = cpuMs(); tickOnce(); const ms = cpuMs() - c; tickCost.n++; tickCost.cpuMs += ms; tickCost.max = Math.max(tickCost.max, ms);};
  maybeStart(); return out as ReturnType<WorldHost['boot']>;
};
const attach = EdgeLedger.prototype.attachComms;
EdgeLedger.prototype.attachComms = function (this: EdgeLedger, c) {attach.call(this, c); L = this; setTimeout(maybeStart, 0);};

function maybeStart() {
  if (!host || !L || tap) return;
  tap = new DeltaTap(host, L);
  const c = cpuMs(), init = tap.init(), initCpu = cpuMs() - c, initBytes = JSON.stringify(init).length;
  worker = new Worker(new URL('./read-worker.ts', import.meta.url), {workerData: {port: WPORT}, execArgv: []});
  worker.on('message', m => {if (m.t === 'ready') log(`worker ready at tick ${m.tick} ${JSON.stringify(m.stats)} init ${m.initCpuMs.toFixed(1)} ms`); else pending.get(m.id)?.(m.v);});
  worker.on('error', e => log(`worker error ${e.stack}`));
  worker.postMessage({t: 'init', w: init});
  initInfo = {tick: init.tick, mainCpuMs: +initCpu.toFixed(1), bytes: initBytes, staticBytes: JSON.stringify(init.static).length, entities: init.bodies.length};
  log(`init ${JSON.stringify(initInfo)}`);
  host.listeners.push({afterTickComplete: () => {const d = tap!.delta(changed); changed.clear(); worker!.postMessage({t: 'delta', d});}});
}
let initInfo: unknown = null;
const pct = (a: number[], p: number) => {const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0;};
function summary(rows: [number, number][]) {const c = rows.map(r => r[0]), b = rows.map(r => r[1]), r2 = (x: number) => Math.round(x * 1000) / 1000;
  return {n: rows.length, cpuMs: {p50: r2(pct(c, .5)), p99: r2(pct(c, .99)), mean: r2(c.reduce((x, y) => x + y, 0) / Math.max(1, c.length))}, bytes: {p50: pct(b, .5), p99: pct(b, .99), mean: Math.round(b.reduce((x, y) => x + y, 0) / Math.max(1, b.length))}};}
const pending = new Map<number, (v: unknown) => void>(); let qid = 0;
const ask = (kind: string, soulId: string) => new Promise<{tick: number; cpuMs: number} & Record<string, unknown>>(r => {const id = ++qid; pending.set(id, r as never); worker!.postMessage({t: 'query', id, kind, soulId});});

const souls = () => [...host!.minds.values()].map(m => ({soulId: m.soulId, entityId: m.entityId, name: m.name, owner: (m as {owner?: string}).owner ?? ''}));
let walkers: string[] = [], k = 0;
async function walk() {
  for (const s of souls().filter(s => walkers.includes(s.soulId))) {
    if (L!.openReceipts(s.soulId).length) continue;
    const caps = L!.capabilities(s).filter(c => c.verb === 'walk' && c.available && c.target?.kind === 'place');
    if (!caps.length) continue;
    try {await L!.act(s as never, {capability: caps[(k++ * 7) % caps.length].id} as never);} catch (e) {log(`walk ${s.name}: ${(e as Error).message}`);}
  }
}
// the main-thread answer, cut to the subset the worker serves
function mainSubset(s: ReturnType<typeof souls>[number]) {
  const c0 = cpuMs(), h = hereFrame(L!, s as never) as {tick: number; me: {pos: [number, number] | null}; near: {id: string; dist: number}[]}, hereMs = cpuMs() - c0;
  const c1 = cpuMs(), P = new Perception(L!, s as never), things = P.things().filter(t => t.kind === 'fire' || t.kind === 'spot' || t.kind === 'item' || (t.kind === 'object' && pointed(t.id)))
    .map(t => ({kind: t.kind, id: t.id, dist: t.distance})), thingsMs = cpuMs() - c1;
  const c2 = cpuMs(), caps = L!.capabilities(s as never), capsMs = cpuMs() - c2;
  const ids = caps.map(c => c.id).filter(id => /^(go-near|wave|face|warm-by-fire|gather):/.test(id) && id !== 'wave:here').sort();
  return {tick: h.tick, here: {me: {pos: h.me.pos}, near: h.near.map(n => ({id: n.id, dist: n.dist})), things}, caps: ids, cpuMs: {here: +hereMs.toFixed(2), things: +thingsMs.toFixed(2), caps: +capsMs.toFixed(2)}, offers: caps.length};
}
function pointed(id: string) {const o = L!.comms?.objects.all().find(x => x.id === id), st = o?.state as {at?: unknown; carrier?: string} | undefined, w = host!.engine.world.entities; return !!o && (Array.isArray(st?.at) || !!w[o.id] || (o.kind === 'ride' && typeof st?.carrier === 'string' && !!w[st.carrier]));}

async function oracle() {
  const out: unknown[] = []; let same = 0, diff = 0;
  for (const s of souls()) {
    if (!host!.engine.world.entities[s.entityId]) continue;
    const m = mainSubset(s), wh = await ask('here', s.soulId), wc = await ask('caps', s.soulId);
    if (wh.tick !== m.tick) {out.push({soul: s.name, skipped: `tick ${wh.tick} vs ${m.tick}`}); continue;}
    const wHere = {me: wh.me, near: wh.near, things: wh.things}, okHere = JSON.stringify(wHere) === JSON.stringify(m.here), okCaps = JSON.stringify(wc.ids) === JSON.stringify(m.caps);
    if (okHere && okCaps) same++; else diff++;
    out.push({soul: s.name, tick: m.tick, okHere, okCaps, mainCpuMs: m.cpuMs, offers: m.offers, workerCpuMs: {here: wh.cpuMs, caps: wc.cpuMs}, near: m.here.near.length, things: m.here.things.length, capsSubset: m.caps.length,
      ...(okHere ? {} : {mainHere: m.here, workerHere: wHere}), ...(okCaps ? {} : {mainCaps: m.caps, workerCaps: wc.ids})});
  }
  return {same, diff, out};
}

setInterval(() => {if (walkers.length) void walk();}, 10000).unref();
createServer(async (req, res) => {
  const u = new URL(req.url ?? '/', 'http://x'); res.setHeader('content-type', 'application/json');
  try {
    if (!tap) {res.end(JSON.stringify({ready: false})); return;}
    let v: unknown;
    if (u.pathname === '/status') v = {steady: summary(tap.steady), tick: host!.engine.world.tick, init: initInfo, delta: tap.cost, tickCost, walkers, souls: souls().map(s => ({id: s.soulId, name: s.name, body: !!host!.engine.world.entities[s.entityId], faded: L!.faded.has(s.soulId), open: L!.openReceipts(s.soulId).length})), worker: await ask('stats', '')};
    else if (u.pathname === '/walkers') {const n = Number(u.searchParams.get('n') ?? 6); walkers = souls().filter(s => host!.engine.world.entities[s.entityId] && !L!.faded.has(s.soulId)).slice(0, n).map(s => s.soulId); await walk(); v = {walkers};}
    else if (u.pathname === '/converge') {   // every walker walks to the same place, so near/wave/face are exercised
      const ws = souls().filter(s => walkers.includes(s.soulId)), sets = ws.map(s => new Set(L!.capabilities(s as never).filter(c => c.verb === 'walk' && c.available && c.target?.kind === 'place').map(c => c.target!.id)));
      const common = [...sets[0]].filter(id => sets.every(x => x.has(id))), to = u.searchParams.get('to') ?? common[Number(u.searchParams.get('i') ?? 0)];
      const res: unknown[] = []; for (const s of ws) {const c = L!.capabilities(s as never).find(c => c.verb === 'walk' && c.target?.id === to); try {res.push(c ? await L!.act(s as never, {capability: c.id} as never).then(r => !!(r as {accepted?: boolean}).accepted) : 'no-offer');} catch (e) {res.push((e as Error).message);}}
      walkers = []; v = {to, common: common.length, res};}
    else if (u.pathname === '/walk') {await walk(); v = {ok: true};}
    else if (u.pathname === '/reset') {for (const key of Object.keys(tap.cost)) (tap.cost as Record<string, number>)[key] = 0; tap.steady.length = 0; tickCost.n = tickCost.cpuMs = tickCost.max = 0; v = {ok: true};}
    else if (u.pathname === '/oracle') v = await oracle();
    else if (u.pathname === '/busy') {const ms = Number(u.searchParams.get('ms') ?? 2000), t0 = host!.engine.world.tick; setTimeout(() => {const end = performance.now() + ms; while (performance.now() < end) { /* the tick thread is deliberately busy */ }}, 50); v = {busyFromTick: t0, ms};}
    else {res.statusCode = 404; v = {error: 'unknown'};}
    res.end(JSON.stringify(v));
  } catch (e) {res.statusCode = 500; res.end(JSON.stringify({error: (e as Error).stack}));}
}).listen(CONTROL, '127.0.0.1', () => log(`control on ${CONTROL}, worker http on ${WPORT}`));
