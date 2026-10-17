#!/usr/bin/env node
// Measure what a visitor sees while the world launcher is swapped (lane C4 `downtime`, backlog G9).
//
//   node tools/world-launcher/deploy/swap-probe.mjs --origin http://127.0.0.1:6010 --base /worlds \
//        --slugs a,b,c [--every 100] [--posts] [--out probe.json] [--stop-file <path>]
//
// Every --every ms, for the homepage and for each world: GET <base>/ and <base>/w/<slug>/v1/config (what a page load and
// the viewer's first request need). Per world one WebSocket <base>/w/<slug>/ws is held open; when it drops, it is
// retried every --every ms (not the viewer's backoff) to find the moment the world takes viewers again.
// --posts adds, per world, a POST with a small body to <base>/w/<slug>/v1/probe-post (unknown route: the world answers 404).
// A proxy cannot replay a POST whose upstream connection was closed under it, so these catch what GETs cannot: any 5xx
// (Caddy's 502) counts; a 4xx means the world answered and counts as fine.
// It runs until SIGINT/SIGTERM or until --stop-file exists, then prints and writes a summary:
//   errorMs      longest run of failed GETs (connection refused = what Caddy shows as a raw 502 page; 5xx; timeout)
//   refused      how many GETs found nobody listening (would be Caddy's error page)
//   slowestMs    the slowest successful GET (a request that waited for a world to boot instead of failing)
//   wsDownMs     longest time the world's WebSocket could not be (re)opened; wsDrops how often it dropped
// Read-only: it only sends GETs, POSTs to an unknown route (--posts) and opens viewer sockets; nothing is written to any world.
import { existsSync, writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const flag = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const origin = flag('origin', 'http://127.0.0.1:6010').replace(/\/$/, '');
const base = (flag('base', '') ?? '').replace(/\/$/, '');
const slugs = (flag('slugs', '') ?? '').split(',').filter(Boolean);
const every = Number(flag('every', '100'));
const out = flag('out');
const stopFile = flag('stop-file');
const posts = argv.includes('--posts');
const port = Number(new URL(origin).port);
if ([3999, ...range(4930, 4970), 4986, 4987].includes(port)) { console.error('refusing a live-world port'); process.exit(2); }
function range(a, b) { return Array.from({ length: b - a + 1 }, (_, i) => a + i); }

const t0 = Date.now();
const now = () => Date.now() - t0;
const targets = [{ name: 'home', url: `${origin}${base}/` }, ...slugs.map((s) => ({ name: s, url: `${origin}${base}/w/${s}/v1/config` })),
  ...(posts ? slugs.map((s) => ({ name: `${s}:post`, url: `${origin}${base}/w/${s}/v1/probe-post`, post: true })) : [])];
const rec = Object.fromEntries(targets.map((t) => [t.name, { gets: 0, ok: 0, refused: 0, status5xx: 0, timeout: 0, other: 0, slowestMs: 0, slowestAt: null, runs: [], cur: null, statuses: {} }]));
let stopping = false;

async function probe(t) {
  const r = rec[t.name];
  while (!stopping) {
    const at = now(), started = performance.now();
    let kind = 'ok', status = 0;
    try {
      const res = await fetch(t.url, { signal: AbortSignal.timeout(15_000), headers: { accept: t.name === 'home' ? 'text/html' : 'application/json', ...(t.post ? { 'content-type': 'application/json' } : {}) }, ...(t.post ? { method: 'POST', body: JSON.stringify({ probe: at }) } : {}) });
      status = res.status; await res.arrayBuffer();
      if (status >= 500) kind = 'status5xx'; else if (status >= 400 && !t.post) kind = 'other';
    } catch (e) {
      const code = e?.cause?.code ?? e?.name ?? 'error';
      kind = code === 'ECONNREFUSED' ? 'refused' : code === 'TimeoutError' ? 'timeout' : 'other';
      status = code;
    }
    const ms = Math.round(performance.now() - started);
    r.gets++; r.statuses[status] = (r.statuses[status] ?? 0) + 1;
    if (kind === 'ok') {
      r.ok++;
      if (ms > r.slowestMs) { r.slowestMs = ms; r.slowestAt = at; }
      if (r.cur) { r.cur.to = at; r.runs.push(r.cur); r.cur = null; }
    } else {
      r[kind]++;
      if (!r.cur) r.cur = { from: at, to: at, kinds: {} };
      r.cur.to = at + ms; r.cur.kinds[kind] = (r.cur.kinds[kind] ?? 0) + 1;
    }
    await new Promise((y) => setTimeout(y, Math.max(0, every - ms)));
  }
}

const ws = Object.fromEntries(slugs.map((s) => [s, { drops: 0, downs: [], downSince: null, opens: 0, lastWelcomeBuild: null, builds: [] }]));
function holdSocket(slug) {
  const w = ws[slug];
  const url = `${origin.replace(/^http/, 'ws')}${base}/w/${slug}/ws`;
  const open = () => {
    if (stopping) return;
    let sock; try { sock = new WebSocket(url); } catch { setTimeout(open, every); return; }
    let opened = false;
    // a viewer is back when the world welcomes it (its hello answered), not merely when the socket opens
    sock.onopen = () => { opened = true; w.opens++; sock.send(JSON.stringify({ t: 'hello', proto: 1 })); };
    sock.onmessage = (m) => {
      let d; try { d = JSON.parse(String(m.data)); } catch { return; }
      if (d.t !== 'welcome') return;
      if (w.downSince !== null) { w.downs.push({ from: w.downSince, to: now() }); w.downSince = null; }
      const b = d.build ?? null; if (b !== w.lastWelcomeBuild) { w.builds.push({ at: now(), build: b }); w.lastWelcomeBuild = b; }
    };
    sock.onclose = () => {
      if (stopping) return;
      if (opened) { w.drops++; if (w.downSince === null) w.downSince = now(); }
      setTimeout(open, every);
    };
    sock.onerror = () => { /* onclose follows */ };
  };
  open();
}

function summary() {
  const res = { origin, base, every, durationMs: now(), at: new Date().toISOString(), targets: {}, sockets: {} };
  for (const t of targets) {
    const r = rec[t.name]; if (r.cur) { r.runs.push(r.cur); r.cur = null; }
    const longest = r.runs.reduce((m, x) => Math.max(m, x.to - x.from), 0);
    res.targets[t.name] = { gets: r.gets, ok: r.ok, refused: r.refused, status5xx: r.status5xx, timeout: r.timeout, other: r.other, errorMs: longest, errorRuns: r.runs, slowestMs: r.slowestMs, slowestAt: r.slowestAt, statuses: r.statuses };
  }
  for (const s of slugs) {
    const w = ws[s]; if (w.downSince !== null) w.downs.push({ from: w.downSince, to: now(), stillDown: true });
    res.sockets[s] = { drops: w.drops, opens: w.opens, wsDownMs: w.downs.reduce((m, x) => Math.max(m, x.to - x.from), 0), downs: w.downs, builds: w.builds };
  }
  return res;
}
function finish() {
  if (stopping) return; stopping = true;
  const s = summary();
  if (out) writeFileSync(out, JSON.stringify(s, null, 2) + '\n');
  const line = (n, t, k) => `${n.padEnd(24)} gets ${String(t.gets).padStart(4)}  errorMs ${String(t.errorMs).padStart(6)}  refused ${String(t.refused).padStart(3)}  5xx ${String(t.status5xx).padStart(3)}  slowestMs ${String(t.slowestMs).padStart(6)}${k ? `  wsDrops ${k.drops}  wsDownMs ${k.wsDownMs}${k.downs.some((d) => d.stillDown) ? ' (STILL DOWN)' : ''}` : ''}`;
  for (const [n, t] of Object.entries(s.targets)) console.log(line(n, t, s.sockets[n]));
  setTimeout(() => process.exit(0), 50);
}
process.on('SIGINT', finish); process.on('SIGTERM', finish);
if (stopFile) setInterval(() => { if (existsSync(stopFile)) finish(); }, 100);
console.log(`probing ${targets.length} targets every ${every} ms at ${origin}${base}`);
for (const t of targets) void probe(t);
for (const s of slugs) holdSocket(s);
