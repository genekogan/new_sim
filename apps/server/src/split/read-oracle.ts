// Stage B (lane B-facade, items 5–6): the read oracle. The same Soul read answered by main's ledger (LiveMenuWorld) and
// by a read worker's ledger (ReplicaMenuWorld over the stream) must be equal field for field. `diffFields` lists the
// leaf paths that differ; `tradeOff` names the one permitted, agent-visible difference (an exit or offer whose admission
// verdict has not reached the replica yet: shown with an ETA until the verdict arrives, one delta), counted apart.

export type FieldDiff = {path: string; live: unknown; replica: unknown};

/** Leaf-level differences between two JSON-like values (arrays compared index by index; extra items reported once). */
export function diffFields(live: unknown, replica: unknown, path = '', out: FieldDiff[] = [], max = 50): FieldDiff[] {
  if (out.length >= max) return out;
  if (Object.is(live, replica)) return out;
  const lo = live !== null && typeof live === 'object', ro = replica !== null && typeof replica === 'object';
  if (!lo || !ro || Array.isArray(live) !== Array.isArray(replica)) {out.push({path: path || '.', live, replica}); return out;}
  if (Array.isArray(live)) {
    const a = live as unknown[], b = replica as unknown[];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (i >= a.length || i >= b.length) {out.push({path: `${path}[${i}]`, live: a[i], replica: b[i]}); break;}
      diffFields(a[i], b[i], `${path}[${i}]`, out, max);
    }
    return out;
  }
  const a = live as Record<string, unknown>, b = replica as Record<string, unknown>;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (a[k] === undefined && b[k] === undefined) continue;
    diffFields(a[k], b[k], path ? `${path}.${k}` : k, out, max);
  }
  return out;
}

/** The recorded trade-off: a `here` exit the live world refuses (reachable:false, why) that the replica, without the
 *  verdict yet, shows with an ETA. Every other difference is a miss. */
export function isTradeOff(d: FieldDiff): boolean {
  if (!/^exits\[\d+\]\.(reachable|why|eta)$/.test(d.path) && !/^(capabilities|caps)\[\d+\]\.(available|why|code|reason)$/.test(d.path)) return false;
  return true;
}

export type OracleTally = {reads: number; equal: number; tradeOff: number; miss: number; examples: {read: string; soulId: string; diffs: FieldDiff[]}[]};
export const tally = (): OracleTally => ({reads: 0, equal: 0, tradeOff: 0, miss: 0, examples: []});
/** Count one comparison: equal, trade-off only, or a miss (first few kept as examples). */
export function record(t: OracleTally, read: string, soulId: string, diffs: FieldDiff[], verdictMissed = true) {
  t.reads++;
  if (!diffs.length) {t.equal++; return;}
  if (verdictMissed && diffs.every(isTradeOff)) {t.tradeOff++; return;}
  t.miss++; if (t.examples.length < 8) t.examples.push({read, soulId, diffs: (verdictMissed ? diffs.filter(d => !isTradeOff(d)) : diffs).slice(0, 6)});
}

// ---- the in-process soak (item 5): SIM_READ_ORACLE=1 (with SIM_READ_WORKER=1). Main itself holds what a worker holds
// (a ReplicaWorld fed structured clones of the same stream, a ReadOnlyHost over the world DB, a read-only ledger), and
// between ticks, when the replica is at main's exact position (tick and log seq), answers the five reads both ways for
// one Soul at a time and tallies them. A replica read that reached main-only state is counted apart (`mainOnly`): in a
// worker it is forwarded to main, never answered wrong. A trade-off is counted only when the replica's verdict table
// missed during that read.
import {threadCpuUsage} from 'node:process';
import type {WorldHost} from '../world.ts';
import type {EdgeLedger} from '../edge/ledger/ledger.ts';
import type {EdgeSoul} from '../edge/contract.ts';
import type {DeltaTap, StreamMessage} from './delta.ts';

export type ReadName = 'here' | 'observe' | 'capabilities' | 'resolve' | 'around';
export const READS: readonly ReadName[] = ['here', 'observe', 'capabilities', 'resolve', 'around'];
export type Soak = {startedAt: number; rounds: number; /** thread CPU ms of the replica's per-round god-layer sync */ syncCpuMs: number; /** thread CPU ms of the after-delta warm-up (as a worker's background) */ bgCpuMs: number; bgRuns: number; skipped: Record<string, number>; reads: Record<ReadName, OracleTally & {mainOnly: Record<string, number>; liveMs: number; replicaMs: number; paths: Record<string, number>; lateDelta?: number}>; replica: unknown};

const cpu = () => {const u = threadCpuUsage(); return (u.user + u.system) / 1000;};
export async function installReadOracle(host: WorldHost, L: EdgeLedger, src: {tap: DeltaTap; init: () => unknown; ask: (m: never[]) => void}, dbPath: string, o: {everyMs?: number; log?: (s: string) => void; logEveryMs?: number} = {}) {
  const [{ReplicaWorld}, {ReadOnlyHost, readLedger, MainOnly}, {hereFrame}, {aroundFrame}, {readBridgeSync, readBridgeCost}] = await Promise.all([import('./replica-world.ts'), import('./read-host.ts'), import('../edge/perception/here.ts'), import('../edge/perception/around.ts'), import('./read-bridge.ts')]);
  const {readFileSync, writeFileSync, mkdirSync} = await import('node:fs');
  const DUMP = process.env.SIM_READ_ORACLE_DUMP || '', DUMP_AFTER = Number(process.env.SIM_READ_ORACLE_DUMP_AFTER ?? 0), dumped: Record<string, number> = {}; if (DUMP) mkdirSync(DUMP, {recursive: true});
  const RW = new ReplicaWorld();
  RW.init(structuredClone(src.init()) as never);
  const H = new ReadOnlyHost(RW, host.worldId, dbPath), RL = readLedger(H, process.env.PLACE_DATA ? JSON.parse(readFileSync(process.env.PLACE_DATA, 'utf8')) : undefined);
  let warmMs = 0, warmed: unknown = null;
  /** as a worker does before 'ready': label connectivity outside any read (again after a rebuild) */
  const warm = () => {if (RW.spatial && warmed !== RW.spatial) {warmMs += RW.spatial.warmLabelsV1(); warmed = RW.spatial;}};
  let bgQueued = false;
  const S: Soak = {startedAt: Date.now(), rounds: 0, syncCpuMs: 0, bgCpuMs: 0, bgRuns: 0, skipped: {}, replica: null,
    reads: Object.fromEntries(READS.map(r => [r, {...tally(), mainOnly: {}, liveMs: 0, replicaMs: 0, paths: {}}])) as Soak['reads']};
  const skip = (why: string) => {S.skipped[why] = (S.skipped[why] ?? 0) + 1;};
  src.tap.subscribe((m: StreamMessage) => {
    if ('t' in m || !RW.apply(structuredClone(m) as never)) {RW.init(structuredClone(src.init()) as never); skip('reinit');}
    RL.replicaSync(RW.R.faded, RW.R.static?.places);
    // as a worker does after each delta (read-worker.ts background): the god layer and a connectivity slice, outside reads
    if (!bgQueued) {bgQueued = true; setImmediate(() => {bgQueued = false; if (!RW.spatial || warmed !== RW.spatial) return; const c = cpu(); try {readBridgeSync(H, RL); RW.spatial.warmSliceV1(8);} catch {} S.bgCpuMs += cpu() - c; S.bgRuns++;});}
  });
  const souls = () => [...host.minds.values()].filter(m => m.owner && m.owner !== 'system' && !m.native && host.engine.world.entities[m.entityId]).map(m => ({soulId: m.soulId, entityId: m.entityId, name: m.name, owner: m.owner}) as EdgeSoul);
  const ask: Record<ReadName, (L: EdgeLedger, s: EdgeSoul, i: number) => unknown> = {
    here: (l, s) => hereFrame(l, s),
    observe: (l, s) => l.observe(s, new Set()),
    capabilities: (l, s) => l.capabilitiesPage(s, {}),
    resolve: (l, s, i) => l.intents.dryRun(s, (i % 2 ? {capability: 'walk to the pond'} : {capability: 'sit on a bench'}) as never),
    around: (l, s) => aroundFrame(l, s),
  };
  /** the body facts a place answer depends on (dump only) */
  const diag = (l: EdgeLedger, s: EdgeSoul) => {
    try {
      const x = l as unknown as {body(id: string): {pose: {p: number[]}; human?: {level?: number; activity?: string}} | undefined; placeLevel(n?: number): number; places: {byId: Map<string, {level?: number}>}};
      const b = x.body(s.entityId), lv = b?.human?.level, pl = x.placeLevel(lv), path = l.placePathOf(s.soulId).map(p => p.id);
      const y = l as unknown as {carriersNative(): {id: string}[]; carrierView(id: string): unknown};
      let rides: unknown; try {const cs = y.carriersNative(); rides = {ids: cs.map(c => c.id).slice(0, 3), view: (() => {try {return JSON.stringify(y.carrierView(cs[0]?.id ?? '')).slice(0, 300);} catch (e) {return 'throws ' + String(e).slice(0, 300);}})()};} catch (e) {rides = 'throws ' + String(e).slice(0, 300);}
      return {p: b?.pose.p, level: lv, placeLevel: pl, activity: b?.human?.activity, path, places: x.places.byId.size, levels: path.map(id => x.places.byId.get(id)?.level ?? 0), rides};
    } catch (e) {return {error: String(e)};}
  };
  const facts = (l: EdgeLedger, ids: string[]) => ids.map(id => {const p = (l as unknown as {places: {byId: Map<string, {level?: number; carrier?: unknown; parent?: string | null; polygon?: number[][]}>}}).places.byId.get(id); return p ? {id, level: p.level, carrier: !!p.carrier, parent: p.parent, n: p.polygon?.length, poly: JSON.stringify(p.polygon).slice(0, 120)} : {id, missing: true};});
  /** the whole menus' ids, both ways (dump only): what only one side offers */
  const fullDiff = (s: EdgeSoul) => {
    const ids = (l: EdgeLedger) => {try {return (l.capabilities(s) as {id: string; available?: boolean}[]).map(c => c.id + (c.available === false ? '!' : ''));} catch (e) {return [String(e)];}};
    const a = ids(L), b = ids(RL), A = new Set(a), B = new Set(b);
    return {live: a.length, replica: b.length, onlyLive: a.filter(x => !B.has(x)).slice(0, 12), onlyReplica: b.filter(x => !A.has(x)).slice(0, 12)};
  };
  let next = 0;
  const round = () => {
    if (RW.R.pos.tick !== host.engine.world.tick) {skip('tick'); return;}
    if (RW.R.pos.logSeq !== host.seq) {skip('logSeq'); return;}
    // the object table moves between deltas too (a layer step after the tick, an advance a listing wrote): the next delta brings it
    {const g = (L.comms as unknown as {objects?: {generation?(): number}} | undefined)?.objects?.generation?.(); if (g !== undefined && g !== RW.R.objectGen) {skip('objectGen'); return;}}
    warm(); if (!RW.spatial) {skip('no-spatial'); return;}
    // main's own god places not published yet (boot): main answers from a half-built world the worker is already past
    if (!(L as unknown as {bodyPlacesReady(): boolean}).bodyPlacesReady()) {skip('main-places'); return;}
    const all = souls(); if (!all.length) {skip('no-souls'); return;}
    const s = all[next++ % all.length]; S.rounds++;
    {const c = cpu(); readBridgeSync(H, RL); S.syncCpuMs += cpu() - c;}   // as a worker does before each read (its CPU apart)
    for (const name of READS) {
      const T = S.reads[name];
      let a: unknown, b: unknown, t = cpu();
      const genOf = () => (L.comms as unknown as {objects?: {generation?(): number}} | undefined)?.objects?.generation?.(), g0 = genOf();
      // (thread CPU of the read alone: the JSON copy both sides make for the compare is the harness's, not the read's)
      try {const v = ask[name](L, s, S.rounds); T.liveMs += cpu() - t; a = JSON.parse(JSON.stringify(v));} catch (e) {T.liveMs += cpu() - t; a = {error: String(e)};}
      // (against the replica's generation, not this read's start: an earlier read of the same round may have written)
      const mainWrote = genOf() !== g0 || genOf() !== RW.R.objectGen;
      const missBefore = RW.verdicts.missCount; t = cpu();
      try {const v = ask[name](RL, s, S.rounds); T.replicaMs += cpu() - t; b = JSON.parse(JSON.stringify(v));}
      catch (e) {T.replicaMs += cpu() - t; if (e instanceof MainOnly) {const k = e.message.replace(/^read worker: | is main-only$/g, ''); T.mainOnly[k] = (T.mainOnly[k] ?? 0) + 1; T.reads++; continue;} b = {error: String(e)};}
      // observe's `at` is the wall clock of the call (two calls, two instants): not a field the replica can differ in
      if (name === 'observe' && a && b && typeof a === 'object' && typeof b === 'object') {delete (a as {at?: unknown}).at; delete (b as {at?: unknown}).at;}
      const missed = RW.verdicts.missCount > missBefore, diffs = diffFields(a, b);
      // where the misses are: the first differing path of each, indices dropped (diagnosis)
      if (diffs.length) {const k = diffs[0].path.replace(/\[\d+\]/g, '[]').split('.').slice(0, 3).join('.'); T.paths[k] = (T.paths[k] ?? 0) + 1;}
      // SIM_READ_ORACLE_DUMP=<dir>: the first three unequal pairs per read, whole (diagnosis; lane only)
      if (diffs.length && DUMP && S.rounds > DUMP_AFTER && (dumped[name] = (dumped[name] ?? 0) + 1) <= 3) {const dl = diag(L, s) as {path?: string[]}, ids = dl.path ?? []; writeFileSync(`${DUMP}/${name}-${dumped[name]}.json`, JSON.stringify({soulId: s.soulId, tick: RW.R.pos.tick, diag: {live: dl, replica: diag(RL, s), placesLive: facts(L, ids), placesReplica: facts(RL, ids), ...(name === 'capabilities' ? {full: fullDiff(s)} : {})}, live: a, replica: b}));}
      // main wrote objects inside its own read (a perception catch-up the read started, a listing's advance): the replica
      // shows the rows main had before it, and the next delta brings the new ones. Counted apart, never as equal.
      if (diffs.length && mainWrote) {T.lateDelta = (T.lateDelta ?? 0) + 1; T.reads++; continue;}
      record(T, name, s.soulId, diffs, missed);
    }
    if (RW.verdicts.misses.size) {src.ask([...RW.verdicts.misses.values()] as never[]); RW.verdicts.misses.clear();}
    RL.knowledge.outbox.length = 0;
  };
  const iv = setInterval(() => {try {round();} catch (e) {skip('error'); console.error('[read-oracle]', e instanceof Error ? e.stack?.split('\n').slice(0, 3).join(' | ') : e);}}, o.everyMs ?? 1000); iv.unref();
  const summary = () => ({...S, syncCpuMs: Math.round(S.syncCpuMs), bgCpuMs: Math.round(S.bgCpuMs), warmMs: Math.round(warmMs), replica: RW.cost, god: readBridgeCost(RL), verdicts: {hits: RW.verdicts.hits, misses: RW.verdicts.missCount},
    reads: Object.fromEntries(READS.map(r => {const T = S.reads[r]; return [r, {...T, liveMs: Math.round(T.liveMs), replicaMs: Math.round(T.replicaMs)}];}))});
  const lg = setInterval(() => (o.log ?? console.log)('[read-oracle] ' + JSON.stringify(summary())), o.logEveryMs ?? 60_000); lg.unref();
  return {summary, stop: () => {clearInterval(iv); clearInterval(lg); H.close();}};
}
