#!/usr/bin/env node
// A fake world that answers every request `503 world.busy, Retry-After: 4`; the real Soul CLI asks `here`, then three
// agents' worth of `listen` relaunches. Prints the timeline: the CLI waits ~4 s between tries and stops (exit 75),
// and only one listen ever reaches the world. Usage: node tools/bench/capacity/busy-scenario.mjs  (~15 s, no network)
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const cli = new URL('../../world-launcher/soul/eden.mjs', import.meta.url).pathname, t0 = Date.now(), seen = [];
const at = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(5) + 's';
const server = createServer((req, res) => {
  seen.push(req.url); console.log(`${at()}  world <- ${req.method} ${req.url.split('?')[0]}`);
  if (req.url.startsWith('/v1/edge/inbox/listen')) return;   // a held long-poll
  res.writeHead(503, { 'content-type': 'application/json', 'retry-after': '4', 'x-sim-load': 'red' });
  res.end(JSON.stringify({ error: { code: 'world.busy', message: 'busy' }, world: { load: 'red', retry_after_s: 4, note: 'It is crowded here right now; things take a little longer.' } }));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const dir = mkdtempSync(join(tmpdir(), 'busy-scenario-'));
writeFileSync(join(dir, '.eden-agent.json'), JSON.stringify({ world: `http://127.0.0.1:${server.address().port}`, soul: 's_demo', token: 't' }));
const run = (...args) => new Promise(done => { const c = spawn(process.execPath, [cli, ...args], { cwd: dir }); let err = '';
  c.stderr.on('data', d => { for (const l of String(d).trim().split('\n')) console.log(`${at()}  cli  : ${l}`); err += d; });
  c.on('exit', code => done({ code, child: c })); setTimeout(() => args[0] === 'listen' && c.kill('SIGTERM'), 1500); });
const here = await run('here');
console.log(`${at()}  here exited ${here.code} after ${seen.length} requests (an old client looped; this one waited and stopped)`);
const first = spawn(process.execPath, [cli, 'listen'], { cwd: dir }); await new Promise(r => setTimeout(r, 400));
for (let i = 0; i < 3; i++) { const r = await run('listen'); console.log(`${at()}  relaunched listen exited ${r.code}`); }
first.kill('SIGTERM');
console.log(`${at()}  listen requests that reached the world: ${seen.filter(u => u.includes('/inbox/listen')).length} (one per Soul)`);
server.closeAllConnections(); server.close();
