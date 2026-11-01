// LOAD-CONTRACT §4: the watchdog thread. Reads the shared numbers (shared.ts) and every 2 s writes <DATA_DIR>/live.json by
// atomic rename; optionally answers GET /healthz on its own loopback port (SIM_HEALTH_PORT). It never touches world
// state, so it keeps reporting while the main thread is stuck in a long request, a GC storm or a replay: the stuck
// thread shows as a growing `loop.lastTurnAgeMs`.
import {renameSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {parentPort, workerData} from 'node:worker_threads';
import {liveOf} from './shared.ts';

const {buffer, file, pid, port, everyMs} = workerData as {buffer: SharedArrayBuffer; file: string; pid: number; port?: number; everyMs?: number};
const a = new Float64Array(buffer);
let failed = false;
function write() {
  const body = JSON.stringify(liveOf(a, pid, Date.now()));
  try { writeFileSync(file + '.tmp', body + '\n'); renameSync(file + '.tmp', file); failed = false; }
  catch (e) { if (!failed) parentPort?.postMessage({error: `live.json not written: ${(e as Error).message}`}); failed = true; }
}
write();
setInterval(write, everyMs ?? 2000);
if (port !== undefined) {
  const server = createServer((req, res) => {
    if (req.method !== 'GET' || !/^\/(?:[^?]*\/)?healthz(?:\?|$)/.test(req.url ?? '')) { res.writeHead(404).end(); return; }
    const live = liveOf(a, pid, Date.now()), up = live.phase === 'serving' && live.loop.lastTurnAgeMs < 30_000;
    res.writeHead(up ? 200 : 503, {'content-type': 'application/json', 'cache-control': 'no-store'}).end(JSON.stringify({ok: up, ...live}));
  });
  server.listen(port, '127.0.0.1', () => parentPort?.postMessage({listening: (server.address() as {port: number}).port}))
    .on('error', e => parentPort?.postMessage({error: `health port ${port}: ${e.message}`}));
}
