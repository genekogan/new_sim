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
import type {WorldHost} from '../world.ts';
import type {EdgeLedger} from '../edge/ledger/ledger.ts';
import type {EdgeSoul} from '../edge/contract.ts';
import type {DeltaTap, StreamMessage} from './delta.ts';

export type ReadName = 'here' | 'observe' | 'capabilities' | 'resolve' | 'around';
export const READS: readonly ReadName[] = ['here', 'observe', 'capabilities', 'resolve', 'around'];
export type Soak = {startedAt: number; rounds: number; skipped: Record<string, number>; reads: Record<ReadName, OracleTally & {mainOnly: Record<string, number>; liveMs: number; replicaMs: number}>; replica: unknown};

export async function installReadOracle(host: WorldHost, L: EdgeLedger, src: {tap: DeltaTap; init: () => unknown; ask: (m: never[]) => void}, dbPath: string, o: {everyMs?: number; log?: (s: string) => void; logEveryMs?: number} = {}) {
  const [{ReplicaWorld}, {ReadOnlyHost, readLedger, MainOnly}, {hereFrame}, {aroundFrame}, {readBridgeSync, readBridgeCost}] = await Promise.all([import('./replica-world.ts'), import('./read-host.ts'), import('../edge/perception/here.ts'), import('../edge/perception/around.ts'), import('./read-bridge.ts')]);
  const {readFileSync, writeFileSync, mkdirSync} = await import('node:fs');
  const DUMP = process.env.SIM_READ_ORACLE_DUMP || '', dumped: Record<string, number> = {}; if (DUMP) mkdirSync(DUMP, {recursive: true});
  const RW = new ReplicaWorld();
  RW.init(structuredClone(src.init()) as never);
  const H = new ReadOnlyHost(RW, host.worldId, dbPath), RL = readLedger(H, process.env.PLACE_DATA ? JSON.parse(readFileSync(process.env.PLACE_DATA, 'utf8')) : undefined);
  let warmMs = 0, warmed: unknown = null;
  /** as a worker does before 'ready': label connectivity outside any read (again after a rebuild) */
  const warm = () => {if (RW.spatial && warmed !== RW.spatial) {warmMs += RW.spatial.warmLabelsV1(); warmed = RW.spatial;}};
  const S: Soak = {startedAt: Date.now(), rounds: 0, skipped: {}, replica: null,
    reads: Object.fromEntries(READS.map(r => [r, {...tally(), mainOnly: {}, liveMs: 0, replicaMs: 0}])) as Soak['reads']};
  const skip = (why: string) => {S.skipped[why] = (S.skipped[why] ?? 0) + 1;};
  src.tap.subscribe((m: StreamMessage) => {
    if ('t' in m || !RW.apply(structuredClone(m) as never)) {RW.init(structuredClone(src.init()) as never); skip('reinit');}
    RL.replicaSync(RW.R.faded, RW.R.static?.places);
  });
  const souls = () => [...host.minds.values()].filter(m => m.owner && m.owner !== 'system' && !m.native && host.engine.world.entities[m.entityId]).map(m => ({soulId: m.soulId, entityId: m.entityId, name: m.name, owner: m.owner}) as EdgeSoul);
  const ask: Record<ReadName, (L: EdgeLedger, s: EdgeSoul, i: number) => unknown> = {
    here: (l, s) => hereFrame(l, s),
    observe: (l, s) => l.observe(s, new Set()),
    capabilities: (l, s) => l.capabilitiesPage(s, {}),
    resolve: (l, s, i) => l.intents.dryRun(s, (i % 2 ? {capability: 'walk to the pond'} : {capability: 'sit on a bench'}) as never),
    around: (l, s) => aroundFrame(l, s),
  };
  let next = 0;
  const round = () => {
    if (RW.R.pos.tick !== host.engine.world.tick) {skip('tick'); return;}
    if (RW.R.pos.logSeq !== host.seq) {skip('logSeq'); return;}
    warm(); if (!RW.spatial) {skip('no-spatial'); return;}
    const all = souls(); if (!all.length) {skip('no-souls'); return;}
    const s = all[next++ % all.length]; S.rounds++;
    readBridgeSync(H, RL);   // as a worker does before each read
    for (const name of READS) {
      const T = S.reads[name];
      let a: unknown, b: unknown, t = performance.now();
      try {a = JSON.parse(JSON.stringify(ask[name](L, s, S.rounds)));} catch (e) {a = {error: String(e)};}
      T.liveMs += performance.now() - t;
      const missBefore = RW.verdicts.missCount; t = performance.now();
      try {b = JSON.parse(JSON.stringify(ask[name](RL, s, S.rounds)));}
      catch (e) {T.replicaMs += performance.now() - t; if (e instanceof MainOnly) {const k = e.message.replace(/^read worker: | is main-only$/g, ''); T.mainOnly[k] = (T.mainOnly[k] ?? 0) + 1; T.reads++; continue;} b = {error: String(e)};}
      T.replicaMs += performance.now() - t;
      const missed = RW.verdicts.missCount > missBefore, diffs = diffFields(a, b);
      // SIM_READ_ORACLE_DUMP=<dir>: the first three unequal pairs per read, whole (diagnosis; lane only)
      if (diffs.length && DUMP && (dumped[name] = (dumped[name] ?? 0) + 1) <= 3) writeFileSync(`${DUMP}/${name}-${dumped[name]}.json`, JSON.stringify({soulId: s.soulId, tick: RW.R.pos.tick, live: a, replica: b}));
      record(T, name, s.soulId, diffs, missed);
    }
    if (RW.verdicts.misses.size) {src.ask([...RW.verdicts.misses.values()] as never[]); RW.verdicts.misses.clear();}
    RL.knowledge.outbox.length = 0;
  };
  const iv = setInterval(() => {try {round();} catch (e) {skip('error'); console.error('[read-oracle]', e instanceof Error ? e.stack?.split('\n').slice(0, 3).join(' | ') : e);}}, o.everyMs ?? 1000); iv.unref();
  const summary = () => ({...S, warmMs: Math.round(warmMs), replica: RW.cost, god: readBridgeCost(RL), verdicts: {hits: RW.verdicts.hits, misses: RW.verdicts.missCount},
    reads: Object.fromEntries(READS.map(r => {const T = S.reads[r]; return [r, {...T, liveMs: Math.round(T.liveMs), replicaMs: Math.round(T.replicaMs)}];}))});
  const lg = setInterval(() => (o.log ?? console.log)('[read-oracle] ' + JSON.stringify(summary())), o.logEveryMs ?? 60_000); lg.unref();
  return {summary, stop: () => {clearInterval(iv); clearInterval(lg); H.close();}};
}
