#!/usr/bin/env node
// Bounded offline Eden metadata preflight. Never requests a picture or starts a browser.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { loadavg } from 'node:os';
import { readFileSync, writeFileSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freeMemGb } from '../playtest/lib/platform.mjs';
import { sourceReceipt } from './source-receipt.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = resolve(process.argv[2]);
const port = 5981, base = `http://127.0.0.1:${port}/w/context-metadata`;
const deadline = process.env.CONTEXT_METADATA_DEADLINE ? Date.parse(process.env.CONTEXT_METADATA_DEADLINE) : Date.now() + 85000;
const signal = AbortSignal.timeout(Math.max(1, deadline - Date.now()));
const slot = '<team>/lanes/MEASURE.slot';
const claim = `${new Date().toISOString()} context-metadata pid=${process.pid} until=${new Date(deadline + 3000).toISOString()}`;
const templatePath = resolve(root, 'worlds/templates/eden-2026.json');
const report = { worldId: 'context-metadata-1', templateSHA256: createHash('sha256').update(readFileSync(templatePath)).digest('hex'), startedAt: new Date().toISOString(), runnerPid: process.pid, sourceReceipt: sourceReceipt(root, process.env.WEB_DIR), requests: [], queries: [], ambient: { load: loadavg(), freeGiB: freeMemGb() } };
let child, claimed = false, monitor, queryTask = Promise.resolve(), querying = false, phase = 'startup';
const queryAbort = new AbortController();
const querySignal = AbortSignal.any([signal, queryAbort.signal]);
mkdirSync(output, { recursive: true });
const save = () => writeFileSync(resolve(output, 'summary.json'), JSON.stringify(report, null, 2));
const query = async () => {
  if (querying) return;
  querying = true;
  const started = performance.now(), startedPhase = phase;
  try { const r = await fetch(base + '/v1/edge/platforms', { signal: querySignal }); const bytes = await r.arrayBuffer(); report.queries.push({ phase: startedPhase, ms: performance.now() - started, status: r.status, bytes: bytes.byteLength }); }
  catch (error) { report.queries.push({ phase, error: error.message }); }
  finally { querying = false; }
};
const get = async (label, path) => {
  phase = label;
  const started = performance.now(), response = await fetch(base + path, { signal });
  const data = await response.json();
  report.requests.push({ label, ms: performance.now() - started, status: response.status, total: data.total, count: data.targets?.length, hasNext: !!data.nextCursor });
  save();
  if (!response.ok) throw Error(`${label}: HTTP${response.status}`);
  return data;
};
try {
  if (loadavg()[0] >= 10 || freeMemGb() < 6) throw Error('ambient requires load<10/free>=6GiB');
  const current = readFileSync(slot, 'utf8'), active = current.split('\n').filter(line => line.trim() && !line.startsWith('#'));
  const parentClaim = process.env.CONTEXT_PARENT_CLAIM;
  if (parentClaim) { if (active.length !== 1 || active[0] !== parentClaim) throw Error('parent measurement claim differs'); }
  else {
    if (active.length) throw Error('measurement slot held');
    writeFileSync(slot, current + '\n' + claim + '\n'); claimed = true;
  }
  await new Promise((yes, no) => { const server = createServer(); server.once('error', no); server.listen(port, '127.0.0.1', () => server.close(yes)); });
  const fd = openSync(resolve(output, 'server.log'), 'a');
  child = spawn(process.execPath, ['apps/server/src/main.ts'], { cwd: root, env: { ...process.env, SIM_CONTEXT_TIMINGS: '1', HOST: '127.0.0.1', PORT: String(port), WORLD_KEY: 'context-metadata', WORLD_ID: 'context-metadata-1', WORLD_OWNER_ID: 'dev:admin', PUBLIC_URL: `http://127.0.0.1:${port}`, GENESIS_FILE: resolve(root, 'worlds/templates/eden-2026.json'), DATA_DIR: resolve(output, 'data'), ASSET_DIR: resolve(output, 'assets'), ENGINE: 'mars', DEV_AUTH: '1', AUTH_PROVIDER: 'none', SEED_NATIVES: '0', EDGE_EYES: '', BRAIN_MODE: 'fake', MIND_DRIVER: 'edge', INVITE_REQUIRED: '0', ARCHIVE_TAKES: '0', TAKES_PERSIST: '0', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', EDEN_GOD_NO_NPX: '1' }, stdio: ['ignore', fd, fd] });
  closeSync(fd); report.serverPid = child.pid; save();
  console.log(JSON.stringify({ claim: parentClaim ?? claim, parentOwned: !!parentClaim, serverPid: child.pid, port }));
  for (;;) {
    signal.throwIfAborted();
    if (child.exitCode !== null) throw Error('server exited before ready');
    try { if ((await fetch(base + '/healthz', { signal })).ok) break; } catch (error) { signal.throwIfAborted(); }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  for (let i = 0; i < 10; i++) await query();
  monitor = setInterval(() => { if (!querying) queryTask = query(); }, 100);
  const first = await get('first-page-cold', '/v1/world/context');
  const admission = first.targets.find(target => target.ref === target.entity && !target.enclosed && (target.level === undefined || target.level === 0) && !target.stand);
  report.admissionRef = admission ? { ref: admission.ref, entity: admission.entity, title: admission.title, level: admission.level ?? null, hasStand: !!admission.stand, enclosed: !!admission.enclosed } : undefined;
  if (!report.admissionRef) throw Error('no actual public exterior entity on first page for admission probe');
  report.defaultExploreCards = first.total;
  report.defaultExplorePages = Math.ceil(first.total / 100);
  if (first.nextCursor) await get('second-page', '/v1/world/context?cursor=' + encodeURIComponent(first.nextCursor));
  const ref = first.targets[0].ref;
  for (let i = 0; i < 3; i++) await get('exact-ref-' + i, '/v1/world/context?ref=' + encodeURIComponent(ref));
  await get('first-page-warm', '/v1/world/context');
  await get('text-search', '/v1/world/context?q=library');
  report.requestedImages = 0;
} catch (error) { report.error = error.message; process.exitCode = 1; }
finally {
  clearInterval(monitor);
  queryAbort.abort();
  await queryTask;
  if (child) { child.kill('SIGTERM'); await new Promise(resolve => { if (child.exitCode !== null) return resolve(); const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000); child.once('exit', () => { clearTimeout(timer); resolve(); }); }); }
  if (claimed) writeFileSync(slot, readFileSync(slot, 'utf8').split('\n').filter(line => line !== claim).join('\n'));
  report.endedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ output, requests: report.requests, querySamples: report.queries.length, cards: report.defaultExploreCards, error: report.error }));
}
