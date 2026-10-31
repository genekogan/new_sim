// Starts the watchdog thread (watchdog-worker.ts) first thing in main.ts. Unref'd: it never keeps the process alive.
import {renameSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {Worker} from 'node:worker_threads';
import {liveOf, sharedLoad} from './shared.ts';

/** live.json from this thread, now (the stop path: the process may exit before the watchdog's next write). */
export function writeLiveNow(dataDir: string, a: Float64Array = sharedLoad) {
  const file = join(dataDir, 'live.json');
  try { writeFileSync(file + '.main.tmp', JSON.stringify(liveOf(a, process.pid, Date.now())) + '\n'); renameSync(file + '.main.tmp', file); } catch { /* best effort */ }
}

export function startWatchdog(opts: {dataDir: string; port?: number; everyMs?: number; shared?: Float64Array; onListening?: (port: number) => void}) {
  const worker = new Worker(new URL('./watchdog-worker.ts', import.meta.url), {
    workerData: {buffer: (opts.shared ?? sharedLoad).buffer, file: join(opts.dataDir, 'live.json'), pid: process.pid, port: opts.port, everyMs: opts.everyMs},
    execArgv: [], resourceLimits: {maxOldGenerationSizeMb: 32},
  });
  worker.on('message', (m: {error?: string; listening?: number}) => { if (m.error) console.error(`[load] watchdog: ${m.error}`); else if (m.listening) { console.log(`[load] watchdog /healthz on 127.0.0.1:${m.listening}`); opts.onListening?.(m.listening); } });
  worker.on('error', e => console.error('[load] watchdog thread failed', e));
  worker.unref();
  return worker;
}
