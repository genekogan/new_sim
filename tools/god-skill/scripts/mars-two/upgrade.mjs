#!/usr/bin/env node
// MARSLAND: bring an existing world made from an older mars-two template up to the current one with god ops, keeping
// its history, its Souls and anything its god or Souls added (Gene's /worlds/w/my-mars-college-2026, made 2026-10-11
// 10:40 UTC from the template of e6613f11).
//
//   node tools/god-skill/scripts/mars-two/upgrade.mjs <world-base-url> [--token <god token>] [--dry] [--template file]
//
// (without --token it reads ./.eden-god.json, the god CLI's state, so `cli.mjs register … && cli.mjs pair` first.)
// What it does, in a few god edits (POST /v1/god/act, ≤ 256 ops each; --dry = /v1/god/dryrun, nothing changes):
//   1. expand the world to the template's extent (grow only);
//   2. the template's sky / weather / ground palette (`world` op; the constitution is left as the owner has it);
//   3. turn the campus into the geographic frame (frame.mjs): every root thing the template names moves to the template's
//      pose; root things the template does not know (the god's or Souls' own) turn with the same rigid transform, so they
//      keep their place relative to the campus. Things inside a parent (furniture in rooms, cups on tables) are
//      parent-local and travel with their parent. Moves go in two phases (all first 400 m east, then home) so no move
//      lands on a thing that has not moved yet;
//   4. place every template thing the world lacks (new furniture, the landscape, MARSLIVED's loft stair and glazing), in
//      template order (parents first).
// A world already in the geographic frame (mars-two.json's frame tag in its constants is not readable, so: a world
// whose Mimos stands at (0, 0)) is only topped up (steps 1, 2 and 4, and moves of template things that differ).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './v3.mjs';
import { toWorld, YAW } from './frame.mjs';

const args = process.argv.slice(2), flag = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args.splice(i, 2)[1] : d; };
const dry = args.includes('--dry'); if (dry) args.splice(args.indexOf('--dry'), 1);
const tplFile = flag('template', join(ROOT, 'worlds/templates/mars-two.json'));
let token = flag('token'), base = args[0];
if (!token && existsSync('.eden-god.json')) { const s = JSON.parse(readFileSync('.eden-god.json', 'utf8')); token = s.token; base ??= s.world; }
if (!base || !token) { console.error('usage: upgrade.mjs <world-base-url> [--token t] [--dry] [--template file]'); process.exit(2); }
base = base.replace(/[?#].*$/, '').replace(/\/$/, '');
const call = async (path, body) => { const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); try { return { status: r.status, data: JSON.parse(t) }; } catch { return { status: r.status, data: t }; } };

const T = JSON.parse(readFileSync(tplFile, 'utf8'));
const snap = (await call('/v1/god/snapshot')).data;
if (!snap?.entities) { console.error('snapshot failed', JSON.stringify(snap).slice(0, 300)); process.exit(1); }
const byId = new Map(snap.entities.map((e) => [e.id, e]));
const pathOf = (e) => { const out = []; for (let x = e; x; x = x.in.parent === 'world' ? null : byId.get(x.in.parent)) out.unshift(x.name ?? x.id); return out.join('/'); };
const have = new Map(snap.entities.map((e) => [pathOf(e), e]));
const tplOps = T.batches.flatMap((b) => b.ops.filter((o) => o.op === 'place').map((o) => ({ ...o, group: b.group })));
const tplPath = (o) => (o.in ? `${o.in.parent}/${o.name}` : o.name);
const tplNames = new Set(tplOps.map(tplPath));
const r3 = (v) => Math.round(v * 1000) / 1000;
const mimos = have.get('mimos');
const oldFrame = !!mimos && Math.abs(mimos.p[0] - 46.88) < 3 && Math.abs(mimos.p[mimos.p.length - 1] + 2.46) < 3;   // the old frame: Mimos at (46.88, −2.46)

const ops = [];
// 1. bounds
const want = T.constants.extent ?? 1000, now = snap.constants?.extent ?? 0;
if (want > now) ops.push({ op: 'expand', extent: want });
// 2. sky, weather, ground
const st = T.state ?? {};
ops.push({ op: 'world', state: { ...(st.sky ? { sky: st.sky } : {}), ...(st.weather ? { weather: st.weather } : {}), ...(st.ground ? { ground: st.ground } : {}) } });
// 3. moves (root things only; children ride along)
const roots = snap.entities.filter((e) => e.in.parent === 'world' && !/^soul|body/.test(e.def ?? '') && e.by !== 'engine');
const target = new Map();
for (const e of roots) {
  const t = e.name ? tplOps.find((o) => !o.in && o.name === e.name) : tplOps.find((o) => !o.in && !o.name && o.def.replace("/", "-") === e.def);
  const p0 = e.p, y = p0.length === 3 ? p0[1] : undefined;
  let p, r;
  if (t) { p = t.p.length === 3 ? t.p : (y !== undefined ? [t.p[0], y, t.p[1]] : t.p); r = t.r ?? 0; }
  else if (oldFrame) { const [x, z] = toWorld(p0[0], p0[p0.length - 1]); p = y !== undefined ? [x, y, z] : [x, z]; r = r3((Array.isArray(e.r) ? e.r[0] : e.r ?? 0) + YAW); }
  else continue;
  const same = Math.hypot(p[0] - p0[0], p[p.length - 1] - p0[p0.length - 1]) < 0.01 && Math.abs((Array.isArray(e.r) ? e.r[0] : e.r ?? 0) - r) < 1e-3;
  if (!same) target.set(e.id, { e, p, r });
}
if (target.size > 1) for (const { e } of target.values()) { const p = e.p.map((v, i) => (i === 0 ? r3(v + 400) : v)); ops.push({ op: 'move', id: e.id, p, mode: 'strict' }); }
for (const { e, p, r } of target.values()) ops.push({ op: 'move', id: e.id, p, r, mode: 'strict' });
// 4. new things
let placed = 0;
const defsHere = new Set(snap.entities.map((e) => e.def));
for (const o of tplOps) {
  if (o.name ? have.has(tplPath(o)) : defsHere.has(o.def.replace('/', '-'))) continue;   // unnamed (the far land, the panorama): one per def
  const { group, ...op } = o; ops.push(op); placed++;
}

console.log(`${base}: ${snap.entities.length} things (${oldFrame ? 'old frame' : 'geographic frame'}); ops: expand ${want > now ? `${now}→${want}` : 'no'}, world 1, moves ${target.size} (${target.size > 1 ? '2 phases' : '1'}), places ${placed}; not in the template (kept, turned with the campus): ${roots.filter((e) => !tplNames.has(e.name)).map((e) => e.name ?? e.id).join(', ') || 'none'}`);
// batches of ≤ 256 ops (the edit schema's limit): bounds + world, the moves out, the moves home, then the new things
const batches = [], cut = (list) => { for (let i = 0; i < list.length; i += 250) batches.push(list.slice(i, i + 250)); };
const isOut = (o) => o.op === 'move' && o.r === undefined;
cut(ops.filter((o) => o.op === 'expand' || o.op === 'world')); cut(ops.filter(isOut)); cut(ops.filter((o) => o.op === 'move' && !isOut(o))); cut(ops.filter((o) => o.op === 'place'));
let ok = true;
for (const [i, b] of batches.entries()) {
  if (!b.length) continue;
  const res = await call(dry ? '/v1/god/dryrun' : '/v1/god/act', { ops: b, note: `marsland upgrade ${i + 1}/${batches.length}: Mars 2026 as it really is` });
  const d = res.data, good = res.status === 200 && d?.accepted !== false && !d?.failures?.length;
  console.log(`${dry ? 'dry run' : 'act'} ${i + 1}/${batches.length} (${b.length} ops): HTTP ${res.status} ${good ? 'accepted' : 'REFUSED'}${d?.failures?.length ? ` ${JSON.stringify(d.failures.slice(0, 6))}` : ''}${d?.seq ? ` seq ${d.seq}` : ''}`);
  if (!good) { ok = false; break; }
  if (dry && i > 0) console.log('  (a dry run checks each batch against the world as it is now; later batches assume the earlier ones)');
}
process.exit(ok ? 0 : 1);
