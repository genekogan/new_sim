#!/usr/bin/env node
// A local, fake-mind copy of live Little Martians (Arium) (`little-martians-arium`) for patch work (lane M, 2026-10-17).
// Never a DB copy: a fresh world from worlds/templates/littlemartians-two.json (its genesis: 432 things), then the god's
// later live additions re-placed from a public snapshot of the live world (named root things the template lacks, same
// def / pose / shape / params), then any extra add-patch specs (--extra). The server keeps running; <out>/copy.json has its
// pid, URL and a local god token path (same shape as local-copy.mjs, so attach.mjs / shots.mjs work). Stop: --stop <out>.
//   node tools/mars-m2/lm-copy.mjs --port 6341 --out <dir> --live-snapshot <json> [--extra <spec,...>] [--no-later]
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
const port = Number(flag('port', 6341)), S = flag('out'), liveSnap = flag('live-snapshot');
const extra = (flag('extra', '') || '').split(',').filter(Boolean);
assert(S && liveSnap, '--out <dir> --live-snapshot <json>'); mkdirSync(S, { recursive: true, mode: 0o700 });
const template = JSON.parse(readFileSync(`${ROOT}/worlds/templates/littlemartians-two.json`, 'utf8'));
const ctx = await boot({ slug: flag('slug', 'lm-copy'), port, template: `${ROOT}/worlds/templates/littlemartians-two.json`, out: `${S}/world` });
ctx.child.unref();
const tokenFile = `${S}/local-god.token`; writeFileSync(tokenFile, ctx.god, { mode: 0o600 });
const out = { port, base: ctx.base, pid: ctx.child.pid, tokenFile, applied: {} };
try {
  const live = JSON.parse(readFileSync(liveSnap, 'utf8'));
  const tnames = new Set(template.batches.flatMap((b) => b.ops.map((o) => o.name)));
  const later = live.entities.filter((e) => e.in.parent === 'world' && e.name && !tnames.has(e.name));
  const ops = later.map((e) => ({ op: 'place', def: e.def, name: e.name, ...Object.fromEntries(['p', 'r', 's', 'shape', 'params', 'state', 'constraints'].filter((k) => e[k] !== undefined).map((k) => [k, e[k]])) }));
  if (ops.length && !args.includes('--no-later')) { const r = await ctx.api('/v1/god/act', { body: { note: 'the live world\'s later god additions (from its public snapshot)', ops } }); out.applied.later = { names: later.map((e) => e.name), accepted: r.accepted, failures: r.failures }; console.log('later', JSON.stringify(out.applied.later).slice(0, 300)); }
  // the template may since have gained things the live world was born without (e.g. lm-grotto-20261017): remove them so
  // the copy matches live, unless --keep-template-additions
  if (!args.includes('--keep-template-additions')) {
    const s0 = await ctx.api('/v1/world/snapshot', { as: 'public' }), ln = new Set(live.entities.map((e) => e.name));
    const extraIds = s0.entities.filter((e) => e.in.parent === 'world' && e.name && !ln.has(e.name) && !later.some((x) => x.name === e.name)).map((e) => e.id);
    if (extraIds.length) { const r = await ctx.api('/v1/god/act', { body: { note: 'match the live world: remove template additions it was born without', ops: extraIds.map((id) => ({ op: 'remove', id })) } }); out.applied.removedTemplateAdditions = { n: extraIds.length, accepted: r.accepted }; }
  }
  extra.forEach((spec, i) => {
    const env = { ...process.env, EDEN_GOD_TOKEN_FILE: tokenFile }, rc = `${S}/extra${i}.receipt.json`; rmSync(rc, { force: true });
    const argv = [`${ROOT}/tools/mars-rotation/add-patch.mjs`, '--spec', spec, '--base', ctx.base, '--receipt', rc];
    execFileSync(process.execPath, argv, { encoding: 'utf8', env }); out.applied['extra' + i] = JSON.parse(execFileSync(process.execPath, [...argv, '--apply'], { encoding: 'utf8', env }));
    console.log('extra' + i, JSON.stringify(out.applied['extra' + i]).slice(0, 200));
  });
  const snap = await ctx.api('/v1/world/snapshot', { as: 'public' }), names = (s) => new Set(s.entities.map((e) => e.name));
  const a = names(snap), b = names(live);
  out.vsLive = { liveSeq: live.seq, liveEntities: live.entities.length, entities: snap.entities.length, onlyLocal: [...a].filter((n) => !b.has(n)), onlyLive: [...b].filter((n) => !a.has(n)) };
  console.log('vs live', JSON.stringify(out.vsLive));
} catch (e) { out.error = String(e.stderr || e.stack || e).slice(0, 2000); console.log('ERROR', out.error); }
writeFileSync(`${S}/copy.json`, JSON.stringify(out, null, 1));
console.log(`${ctx.base}?dev=1 pid ${ctx.child.pid}`);
process.exit(out.error ? 1 : 0);
