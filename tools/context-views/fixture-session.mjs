// Fresh-cache sessions for the bounded photographer suite. The caller owns the
// single machine/Chrome lease and absolute deadline; this owns only its children.
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { loadavg } from 'node:os';
import { freeMemGb } from '../playtest/lib/platform.mjs';
import { genesis, cases } from './fixture.mjs';
import { bindCases } from './bindings.mjs';
import { artwork } from './fixture-artwork.mjs';
const exec = promisify(execFile);

async function processRows() {
  const { stdout } = await exec('ps', ['-axo', 'pid=,ppid=,pgid=,lstart=,rss=,%cpu='], { timeout: 500, env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' } });
  return stdout.trim().split('\n').flatMap(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.{24})\s+(\d+)\s+([\d.]+)$/);
    return match ? [{ pid: +match[1], parent: +match[2], group: +match[3], start: match[4], rssMiB: +match[5] / 1024, cpu: +match[6] }] : [];
  });
}
function descendants(rows, root, known) {
  const found = new Set(rows.filter(row => known.get(row.pid) === row.start).map(row => row.pid));
  if (!known.has(root) && rows.some(row => row.pid === root)) found.add(root);
  for (let i = 0; i < rows.length; i++) {
    const before = found.size;
    for (const row of rows) if (found.has(row.parent)) found.add(row.pid);
    if (found.size === before) break;
  }
  for (const row of rows) if (found.has(row.pid)) known.set(row.pid, row.start);
  return rows.filter(row => found.has(row.pid));
}
const freePort = port => new Promise((yes, no) => {
  const server = createServer(); server.once('error', no);
  server.listen(port, '127.0.0.1', () => server.close(yes));
});
export function createFixtureSessions({ root, out, port = 5980, deadline, signal, abort, report, save, setPhase }) {
  let totalStarts = 0, reservedAttempts = 0;
  const downloaded = new Set();
  return async function withFixtureSession({ variant }, callback) {
    const output = resolve(out, `session-${variant}`), base = `http://127.0.0.1:${port}/w/context-baseline`;
    const receipt = { variant, startedAt: new Date().toISOString(), contextJobs: [], cleanup: { complete: false }, samples: [] };
    const known = new Map(), admitted = new Set(), downloadsBefore = downloaded.size;
    let child, token, monitor, sampling = false, sampleTask, created = false, phase = 'startup';
    const tails = { stdout: '', stderr: '' }, localAbort = new AbortController();
    const fetchSignal = AbortSignal.any([signal, localAbort.signal]);
    const check = () => { signal.throwIfAborted(); if (Date.now() >= deadline) throw Error('photographer absolute deadline'); };
    const fetchBounded = (url, options = {}) => { check(); return fetch(url, { ...options, signal: fetchSignal }); };
    const request = async (path, body, auth = token) => {
      check();
      if (path === '/v1/world/context/views' && body) {
        const keys = body.refs.map(ref => `${ref}:${!!body.detail}`);
        if (body.sheet) keys.push(`sheet:${keys.join(',')}`);
        for (const key of keys) if (!admitted.has(key)) {
          if (reservedAttempts + 2 > 22) throw Error('insufficient two-attempt budget for selected result');
          admitted.add(key); reservedAttempts += 2;
        }
      }
      const response = await fetchBounded(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(auth ? { authorization: `Bearer ${auth}` } : {}), 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (!response.ok) throw Error(`${path} HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
      if (body === undefined && response.headers.get('content-type')?.includes('image/png')) {
        downloaded.add(`${variant}:${path}`);
        if (downloaded.size > 10) throw Error('photographer PNG ceiling exceeded');
      }
      return response;
    };
    const trace = (stream, chunk) => {
      appendFileSync(resolve(output, 'server.log'), chunk);
      tails[stream] += chunk;
      const lines = tails[stream].split('\n'); tails[stream] = lines.pop();
      for (const line of lines) {
        const at = line.indexOf('[context-job] '); if (at < 0) continue;
        try {
          const event = JSON.parse(line.slice(at + 14)); receipt.contextJobs.push(event);
          if (event.phase === 'start' && ++totalStarts > 22) abort(new Error('actual renderer job starts exceeded22'));
        } catch (error) { receipt.traceError = String(error); abort(error); }
      }
    };
    const sample = async () => {
      if (sampling || !child?.pid) return; sampling = true;
      const started = performance.now(), startedPhase = phase;
      try {
        const query = await fetchBounded(base + '/v1/edge/platforms'); const state = await query.json();
        const queryMs = performance.now() - started;
        const owned = descendants(await processRows(), child.pid, known);
        receipt.samples.push({ at: Date.now(), phase: startedPhase, tick: state.tick, queryMs, load: loadavg(), freeGiB: freeMemGb(), rssMiB: owned.reduce((n, row) => n + row.rssMiB, 0), cpuPercent: owned.reduce((n, row) => n + row.cpu, 0) });
      } catch (error) { receipt.samples.push({ phase: startedPhase, error: String(error) }); }
      finally { sampling = false; }
    };
    try {
      check(); mkdirSync(output); created = true; // Refuse reusing a previous session/cache.
      await freePort(port);
      writeFileSync(resolve(output, 'genesis.json'), JSON.stringify(genesis));
      child = spawn(process.execPath, ['apps/server/src/main.ts'], { cwd: root, env: { ...process.env, SIM_CONTEXT_TRACE: '1', SIM_CONTEXT_TIMINGS: '1', HOST: '127.0.0.1', PORT: String(port), WORLD_KEY: 'context-baseline', WORLD_ID: 'context-baseline-1', WORLD_OWNER_ID: 'dev:admin', PUBLIC_URL: `http://127.0.0.1:${port}`, GENESIS_FILE: resolve(output, 'genesis.json'), DATA_DIR: resolve(output, 'data'), ASSET_DIR: resolve(output, 'assets'), ENGINE: 'mars', DEV_AUTH: '1', AUTH_PROVIDER: 'none', SEED_NATIVES: '0', EDGE_EYES: '', BRAIN_MODE: 'fake', MIND_DRIVER: 'edge', INVITE_REQUIRED: '0', ARCHIVE_TAKES: '0', TAKES_PERSIST: '0', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', EDEN_GOD_NO_NPX: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.on('data', chunk => trace('stdout', chunk)); child.stderr.on('data', chunk => trace('stderr', chunk));
      receipt.serverPid = child.pid;
      child.on('error', error => { receipt.spawnError = String(error); abort(error); });
      descendants(await processRows(), child.pid, known);
      console.log(JSON.stringify({ photographerSession: variant, pid: child.pid, deadline: new Date(deadline).toISOString() }));
      for (;;) {
        check(); if (child.exitCode !== null) throw Error('fixture exited before ready');
        try { if ((await fetchBounded(base + '/healthz')).ok) break; } catch { check(); }
        await delay(100, undefined, { signal });
      }
      token = (await (await request('/v1/god/mint', { label: 'context-baseline' }, 'dev:admin')).json()).token;
      const png = artwork(0); receipt.artworkSha = createHash('sha256').update(png).digest('hex');
      const uploaded = await fetchBounded(base + '/v1/god/assets?name=baseline-artwork&license=CC0', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'image/png' }, body: png });
      if (!uploaded.ok) throw Error(`fixture image upload HTTP${uploaded.status}`);
      const assets = [await uploaded.json()], first = assets[0].asset ?? assets[0], sha = first.sha ?? first.hash;
      const edit = await (await request('/v1/god/act', { ops: [{ op: 'set', id: 'hall/artwork', state: { media: `/assets/${sha}.png` } }] })).json();
      if (!edit.accepted) throw Error('frozen artwork binding refused');
      const baselineSnapshot = await (await request('/v1/world/snapshot', undefined, null)).json();
      const listing = await (await request('/v1/world/context', undefined, null)).json();
      const bindings = bindCases(cases, baselineSnapshot.entities, listing.targets);
      await sample(); monitor = setInterval(() => { if (!sampling) sampleTask = sample(); }, 500);
      await callback({ request, out, deadline, signal, bindings, baselineSnapshot, entities: baselineSnapshot.entities, cases, assets, report, save,
        base,
        jobEvents: () => receipt.contextJobs.map(event => ({ ...event })),
        registerProcess: async pid => { descendants(await processRows(), pid, known); },
        ownedProcesses: async () => descendants(await processRows(), child.pid, known).map(row => ({ pid: row.pid, start: row.start, server: row.pid === child.pid })),
        uploadArtwork: async png => {
          const response = await fetchBounded(base + '/v1/god/assets?name=baseline-artwork&license=CC0', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'image/png' }, body: png });
          if (!response.ok) throw Error(`fixture image upload HTTP${response.status}`);
          return response.json();
        },
        rawGet: path => fetchBounded(base + path),
        setPhase: value => { phase = value; setPhase(value); } });
    } catch (error) { receipt.error = String(error); }
    finally {
      clearInterval(monitor); localAbort.abort(new Error('session ended')); await sampleTask;
      if (child?.pid) {
        // Keep the server alive through this final ancestry scan: detached Chrome
        // must be registered before killing its parent can reparent it.
        try { descendants(await processRows(), child.pid, known); } catch (error) { receipt.cleanup.scanError = String(error); }
        child.kill('SIGTERM');
        await Promise.race([new Promise(resolve => child.exitCode !== null || child.signalCode !== null ? resolve() : child.once('exit', resolve)), delay(1500)]);
        try {
          const remaining = descendants(await processRows(), child.pid, known);
          receipt.cleanup.groupsKilled = [];
          for (const row of remaining) if (known.get(row.pid) === row.start) {
            try {
              // Only a matched owned group leader can authorize killing a group.
              // The server shares our group; detached Chrome owns its own group.
              if (row.group === row.pid) { process.kill(-row.group, 'SIGKILL'); receipt.cleanup.groupsKilled.push({ group: row.group, start: row.start }); }
              else process.kill(row.pid, 'SIGKILL');
            } catch {}
          }
          await delay(50);
          receipt.cleanup.remaining = (await processRows()).filter(row => known.get(row.pid) === row.start).map(row => ({ pid: row.pid, start: row.start }));
        } catch (error) { receipt.cleanup.error = String(error); }
      } else receipt.cleanup.remaining = [];
      try { await freePort(port); receipt.cleanup.portClosed = true; } catch { receipt.cleanup.portClosed = false; }
      receipt.cleanup.complete = !receipt.cleanup.remaining?.length && receipt.cleanup.portClosed && !receipt.cleanup.error && !receipt.cleanup.scanError;
      receipt.cleanup.owned = [...known].map(([pid, start]) => ({ pid, start }));
      const starts = receipt.contextJobs.filter(event => event.phase === 'start').length;
      if (starts < downloaded.size - downloadsBefore) receipt.error ??= 'renderer start traces missing for downloaded PNGs';
      receipt.endedAt = new Date().toISOString(); receipt.totalActualStarts = totalStarts; receipt.reservedAttempts = reservedAttempts;
      if (!receipt.cleanup.complete) { receipt.error ??= 'fixture cleanup incomplete'; abort(new Error(receipt.error)); }
      if (created) writeFileSync(resolve(output, 'receipt.json'), JSON.stringify(receipt, null, 2));
      save();
    }
    return receipt;
  };
}
