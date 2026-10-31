// L3 (server reliability, 2026-10-31): cheap counters for the menu caches (the ledger's per-Soul capability menu and
// together's item sources): hits, misses by cause, clears by site, and the CPU a rebuild costs. The counts are always
// kept (an integer add); the CPU timing of a rebuild and the periodic log line only with EDGE_MENU_STATS=1.
import {threadCpuUsage} from 'node:process';

export const MENU_STATS = process.env.EDGE_MENU_STATS === '1';
/** Debug: compare every kept menu with a fresh build and log differences (costs a full rebuild per read). */
export const MENU_ORACLE = process.env.EDGE_MENU_ORACLE === '1';
type Counts = Record<string, number>;
export const menuStats = {
  cap: {hit: 0, hitKept: 0, miss: 0, missKey: 0, missAge: 0, missReads: 0, missAbsent: 0, oracleMiss: 0, cpuUs: 0} as Counts,   // hit: same tick; hitKept: kept across ticks (tail redone)
  capClear: {} as Counts,   // site → global clears
  capDrop: {} as Counts,    // site → one Soul's entry dropped
  src: {hit: 0, miss: 0, cpuUs: 0} as Counts,
  missBySoul: {} as Counts,   // soulId → menu rebuilds
};
export function countClear(site: string, one = false) {const m = one ? menuStats.capDrop : menuStats.capClear; m[site] = (m[site] ?? 0) + 1;}
/** Thread CPU microseconds now (0 when stats are off, so the subtraction costs nothing). */
export function cpuNow(): number {if (!MENU_STATS) return 0; const u = threadCpuUsage(); return u.user + u.system;}
export function resetMenuStats() {
  for (const k of Object.keys(menuStats.cap)) menuStats.cap[k] = 0;
  for (const k of Object.keys(menuStats.src)) menuStats.src[k] = 0;
  menuStats.capClear = {}; menuStats.capDrop = {}; menuStats.missBySoul = {};
}
export function snapshotMenuStats() {return JSON.parse(JSON.stringify(menuStats)) as typeof menuStats;}
if (MENU_STATS) setInterval(() => console.log('[menu-stats]', JSON.stringify(menuStats)), 60_000).unref();
