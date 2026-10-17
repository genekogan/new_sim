#!/usr/bin/env node
// A local, fake-mind copy of live Mars (`my-mars-college-2026-3`) for patch work (lane M, 2026-10-17). Never a DB copy:
// a fresh world from worlds/templates/mars-two.json (the live world's genesis, same 167 named entities) plus the four
// patches applied live on 2026-10-17 01:28 UTC (fidelity -> rotation 82 -> field -> water), each through its own guarded
// tool exactly as on live. With --live-snapshot the entity names are checked against a public snapshot of the live world.
// Then any extra add-patch specs (--extra a.json,b.json) are applied the same way. The server keeps running (detached);
// its pid, URL and a local god token path are written to <out>/copy.json. Stop it with --stop <out>.
//   node tools/mars-m2/local-copy.mjs --port 6340 --out <dir> [--live-snapshot <json>] [--extra <spec,...>]
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { boot, ROOT } from '../mars-rotation/proof/lib.mjs';
const args = process.argv.slice(2), flag = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
if (args.includes('--stop')) {
  const c = JSON.parse(readFileSync(`${flag('stop')}/copy.json`, 'utf8'));
  try { process.kill(-c.pid, 'SIGTERM'); } catch { try { process.kill(c.pid, 'SIGTERM'); } catch { /* gone */ } }
  console.log('stopped', c.pid); process.exit(0);
}
const port = Number(flag('port', 6340)), S = flag('out'), liveSnap = flag('live-snapshot', null);
const extra = (flag('extra', '') || '').split(',').filter(Boolean);
assert(S, '--out <dir>'); mkdirSync(S, { recursive: true, mode: 0o700 });
for (const f of ['fidelity', 'rotation', 'field', 'water', ...extra.map((_, i) => 'extra' + i)]) rmSync(`${S}/${f}.receipt.json`, { force: true });
const ctx = await boot({ slug: flag('slug', 'mars-copy'), port, template: `${ROOT}/worlds/templates/mars-two.json`, out: `${S}/world` });
ctx.child.unref();
const tokenFile = `${S}/local-god.token`; writeFileSync(tokenFile, ctx.god, { mode: 0o600 });
const env = { ...process.env, EDEN_GOD_TOKEN_FILE: tokenFile };
const run = (argv) => JSON.parse(execFileSync(process.execPath, argv, { encoding: 'utf8', maxBuffer: 1e8, env }));
const T = {
  fidelity: (...f) => [`${ROOT}/tools/mars-fidelity/patch.mjs`, '--base', ctx.base, '--receipt', `${S}/fidelity.receipt.json`, ...f],
  rotation: (...f) => [`${ROOT}/tools/mars-rotation/patch.mjs`, '--base', ctx.base, '--receipt', `${S}/rotation.receipt.json`, '--bearing', '82', ...f],
  field: (...f) => [`${ROOT}/tools/mars-rotation/add-patch.mjs`, '--spec', `${ROOT}/worlds/patches/mars-field-20261016/spec.json`, '--base', ctx.base, '--receipt', `${S}/field.receipt.json`, ...f],
  water: (...f) => [`${ROOT}/tools/mars-rotation/add-patch.mjs`, '--spec', `${ROOT}/worlds/patches/mars-water-20261016/spec.json`, '--base', ctx.base, '--receipt', `${S}/water.receipt.json`, ...f],
};
extra.forEach((spec, i) => { T['extra' + i] = (...f) => [`${ROOT}/tools/mars-rotation/add-patch.mjs`, '--spec', spec, '--base', ctx.base, '--receipt', `${S}/extra${i}.receipt.json`, ...f]; });
const out = { port, base: ctx.base, pid: ctx.child.pid, tokenFile, applied: {} };
try {
  for (const k of Object.keys(T)) { run(T[k]()); out.applied[k] = run(T[k]('--apply')); console.log(k, JSON.stringify(out.applied[k]).slice(0, 200)); }
  const snap = await ctx.api('/v1/world/snapshot', { as: 'public' });
  out.seq = snap.seq; out.entities = snap.entities.length;
  if (liveSnap) {
    const live = JSON.parse(readFileSync(liveSnap, 'utf8')), names = (s) => new Set(s.entities.map((e) => e.name));
    const a = names(snap), b = names(live);
    out.vsLive = { liveSeq: live.seq, liveEntities: live.entities.length, onlyLocal: [...a].filter((n) => !b.has(n)), onlyLive: [...b].filter((n) => !a.has(n)) };
    console.log('vs live', JSON.stringify(out.vsLive));
  }
} catch (e) { out.error = String(e.stderr || e.stack || e).slice(0, 2000); console.log('ERROR', out.error); }
writeFileSync(`${S}/copy.json`, JSON.stringify(out, null, 1));
console.log(`${ctx.base}?dev=1 pid ${ctx.child.pid}`);
process.exit(out.error ? 1 : 0);
