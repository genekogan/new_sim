// Stage B spike (lane L9): the read-model worker. PROTOTYPE. Ingests WorldInit/WorldDelta from the tick thread over
// its parentPort and answers `here`/`capabilities` subset queries for one Soul, both over the port and over its own
// HTTP listener (workerData.port), so a Soul read never needs the tick thread to be free.
import {parentPort, workerData} from 'node:worker_threads';
import {createServer} from 'node:http';
import {threadCpuUsage} from 'node:process';
import {ReadModel, type WorldDelta, type WorldInit} from './read-model.ts';

const M = new ReadModel(), cpuMs = () => {const u = threadCpuUsage(); return (u.user + u.system) / 1000;};
const cost = {deltas: 0, ingestCpuMs: 0, maxIngestCpuMs: 0, queries: 0, queryCpuMs: 0, maxQueryCpuMs: 0, initCpuMs: 0};
const answer = (kind: string, soulId: string) => {
  const c = cpuMs(), v = kind === 'here' ? M.here(soulId) : kind === 'caps' ? {tick: M.tick, ids: M.capabilities(soulId)} : {tick: M.tick, stats: M.stats(), cost};
  const ms = cpuMs() - c; if (kind !== 'stats') {cost.queries++; cost.queryCpuMs += ms; cost.maxQueryCpuMs = Math.max(cost.maxQueryCpuMs, ms);}
  return {...v, cpuMs: Math.round(ms * 1000) / 1000};
};
parentPort!.on('message', (m: {t: 'init'; w: WorldInit} | {t: 'delta'; d: WorldDelta} | {t: 'query'; id: number; kind: string; soulId: string}) => {
  if (m.t === 'init') {const c = cpuMs(); M.init(m.w); cost.initCpuMs = cpuMs() - c; parentPort!.postMessage({t: 'ready', tick: M.tick, stats: M.stats(), initCpuMs: cost.initCpuMs});}
  else if (m.t === 'delta') {const c = cpuMs(); M.apply(m.d); const ms = cpuMs() - c; cost.deltas++; cost.ingestCpuMs += ms; cost.maxIngestCpuMs = Math.max(cost.maxIngestCpuMs, ms);}
  else if (m.t === 'query') parentPort!.postMessage({t: 'answer', id: m.id, v: answer(m.kind, m.soulId)});
});
if (workerData?.port) createServer((req, res) => {
  const u = new URL(req.url ?? '/', 'http://x'), kind = u.pathname.slice(1), soul = u.searchParams.get('soul') ?? '';
  res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(answer(kind, soul)));
}).listen(workerData.port, '127.0.0.1');
