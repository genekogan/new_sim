// Run only inside the two explicitly owned transient preflight units. No live world.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, renameSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { EyesWorker } from '../../apps/server/src/edge/eyes/worker.ts';

const cfg = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (process.platform !== 'linux' || !['a', 'b'].includes(cfg.role)) throw Error('isolated Linux unit configuration required');
const abort = new AbortController(), started = Date.now();
const record = value => appendFileSync(resolve(cfg.directory, 'events.jsonl'), JSON.stringify({ at: Date.now(), role: cfg.role, ...value }) + '\n');
const publish = (name, value) => {
  const path = resolve(cfg.directory, name); writeFileSync(path + '.next', JSON.stringify(value)); renameSync(path + '.next', path);
};
const env = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/nonexistent', LANG: 'C.UTF-8',
  WEB_DIR: cfg.webDir, HOST: '127.0.0.1', PORT: String(cfg.port), WORLD_KEY: 'context-linux-' + cfg.role,
  WORLD_ID: 'context-linux-' + cfg.role, WORLD_OWNER_ID: 'dev:admin', PUBLIC_URL: `http://127.0.0.1:${cfg.port}`,
  GENESIS_FILE: cfg.genesis, DATA_DIR: resolve(cfg.directory, 'data'), ASSET_DIR: resolve(cfg.directory, 'assets'),
  ENGINE: 'mars', DEV_AUTH: '1', AUTH_PROVIDER: 'none', SEED_NATIVES: '0', EDGE_EYES: '',
  BRAIN_MODE: 'fake', MIND_DRIVER: 'edge', INVITE_REQUIRED: '0', ARCHIVE_TAKES: '0', TAKES_PERSIST: '0',
  ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', EDEN_GOD_NO_NPX: '1', SIM_CONTEXT_TRACE: '1',
  SIM_RENDER_LOCK_DIR: cfg.lockDir, GOD_LOOK_CHROME: cfg.chrome, EDEN_GOD_GL: 'swiftshader',
  EDGE_EYES_GPU: 'swiftshader', EDGE_EYES_NICE: '10', PLAYWRIGHT_BROWSERS_PATH: cfg.browserPath,
  EDGE_EYES_PLAYWRIGHT: cfg.eyesPackage };
let main, eyes, mainExit, eyeRequested = false, starts = 0;
const stop = reason => { record({ kind: 'stop', reason }); abort.abort(Error(reason)); };
process.once('SIGTERM', () => stop('SIGTERM')); process.once('SIGINT', () => stop('SIGINT'));
const timer = setTimeout(() => stop('work deadline'), Math.max(1, cfg.deadline - Date.now()));
try {
  main = spawn(cfg.node, ['apps/server/src/main.ts'], { cwd: cfg.root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  mainExit = new Promise((yes, no) => { main.once('error', no); main.once('exit', (code, signal) => { record({ kind: 'main-exit', code, signal }); yes(); if (!abort.signal.aborted) stop('main exited'); }); });
  void mainExit.catch(error => stop(String(error)));
  record({ kind: 'main', pid: main.pid });
  for (const stream of [main.stdout, main.stderr]) {
    let pending = '';
    stream.on('data', chunk => {
      appendFileSync(resolve(cfg.directory, 'server.log'), chunk);
      pending += chunk.toString();
      if (pending.length > 1024 * 1024) { stop('oversized server line'); return; }
      for (;;) {
        const end = pending.indexOf('\n'); if (end < 0) break;
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        for (const marker of ['[context-job]', '[context-phase]']) {
          const index = line.indexOf(marker); if (index < 0) continue;
          try {
            const event = JSON.parse(line.slice(index + marker.length).trim()); record({ kind: marker, event });
            // One selected ref per independent cache; built-in retry limit is two.
            if (marker === '[context-job]' && event.phase === 'start' && ++starts > 2) stop('per-unit two-start ceiling');
          } catch { stop('invalid context trace'); }
        }
      }
    });
  }
  for (;;) {
    abort.signal.throwIfAborted();
    try { if ((await fetch(cfg.base + '/healthz', { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(1000)]) })).ok) break; } catch { abort.signal.throwIfAborted(); }
    await delay(100, undefined, { signal: abort.signal });
  }
  if (cfg.role === 'a') {
    // Real production EyesWorker implementation; a fixed fixture camera, no Soul or live request.
    eyes = new EyesWorker({ viewerUrl: cfg.base + '/', env, timeoutMs: 15000, maxQueue: 1 });
    while (eyes.status().state !== 'ready') {
      abort.signal.throwIfAborted();
      if (eyes.status().state === 'down') throw Error('isolated Eyes startup failed; no retry');
      await delay(100, undefined, { signal: abort.signal });
    }
  }
  publish('ready.json', { role: cfg.role, pid: process.pid, mainPid: main.pid, at: Date.now(), eyes: eyes?.status() ?? null });
  while (!abort.signal.aborted) {
    if (eyes && eyes.status().state === 'down') throw Error('isolated Eyes went down; no retry');
    if (eyes && !eyeRequested && existsSync(resolve(cfg.directory, 'request-eyes.json'))) {
      eyeRequested = true;
      const request = JSON.parse(readFileSync(resolve(cfg.directory, 'request-eyes.json'), 'utf8'));
      if (request.kind !== 'one-fixture-frame') throw Error('invalid isolated Eyes request');
      const begin = Date.now(); record({ kind: 'eyes-start', begin });
      const result = await eyes.render({ mode: 'eyes', w: 512, h: 320, quality: .75,
        pose: { p: [-15, 6, 10], yaw: Math.atan2(-10, -9), pitch: Math.atan2(-5, Math.hypot(10, 9)), vfov: 55 * Math.PI / 180 }, self: 'preflight-no-soul', show: [] });
      const end = Date.now(); writeFileSync(resolve(cfg.directory, 'isolated-eyes.jpg'), result.jpeg);
      const proof = { begin, end, bytes: result.jpeg.length, sha256: createHash('sha256').update(result.jpeg).digest('hex'), frameTick: result.frameTick, ms: result.ms, status: eyes.status(), scope: 'One direct EyesWorker fixture job; no Soul authentication or production Eyes action.' };
      record({ kind: 'eyes-finish', ...proof }); publish('eyes.json', proof);
    }
    await delay(50, undefined, { signal: abort.signal });
  }
} catch (error) {
  if (!abort.signal.aborted) { publish('failure.json', { at: Date.now(), error: String(error) }); process.exitCode = 1; }
} finally {
  clearTimeout(timer); eyes?.close();
  if (main && main.exitCode === null && main.signalCode === null) {
    main.kill('SIGTERM');
    const kill = setTimeout(() => main.kill('SIGKILL'), 3000);
    await mainExit?.catch(() => {}); clearTimeout(kill);
  }
  record({ kind: 'worker-finished', elapsedMs: Date.now() - started, starts });
  // systemd KillMode=control-group is the independent final custody boundary,
  // including detached Chromium helpers and the five-second Eyes close fallback.
}
