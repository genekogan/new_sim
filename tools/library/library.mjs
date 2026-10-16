#!/usr/bin/env node
// library — the shared object library across worlds (lane C16, backlog M4): Gene's "mini Thingiverse".
//
//   node tools/library/library.mjs publish --from <worldUrl> --ref <name@v> [--licence CC0-1.0|CC-BY-4.0]
//                                  [--attribution <text>] [--source <url>] [--title <t>] [--author-name <n>]
//   node tools/library/library.mjs find <words…> [--for <worldUrl>] [--k 10] [--json]
//   node tools/library/library.mjs show <world>/<name>[@n]
//   node tools/library/library.mjs place <world>/<name>[@n] --into <worldUrl> [--name <n>] [--at x,z] [--r <deg>]
//   node tools/library/library.mjs yank <world>/<name>@n --reason <why>
//
// Common: --lib <dir> (default $SIM_LIBRARY_DIR). A world is addressed by its URL (http://127.0.0.1:6120/w/alpha);
// its slug is the /w/<slug> segment. God access: --token-file <path> (read at runtime, never printed) or $SIM_GOD_TOKEN,
// or --dev on a DEV_AUTH world (mints a short-lived god token as dev:admin). Publishing reads the creator's world as its
// god; placing writes the target world as its god, uploads the item's models first, then sends ONE batch (define the
// item and its dependencies, then place it).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SharedLibrary, LibraryError } from '../../packages/library/src/index.ts';

const argv = process.argv.slice(2), cmd = argv[0], flags = {}, pos = [];
for (let i = 1; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : true; flags[k] = v; } else pos.push(a); }
const die = (msg, code = 2) => { console.error(msg); process.exit(code); };
const libDir = flags.lib ?? process.env.SIM_LIBRARY_DIR;
if (!cmd || cmd === 'help' || flags.help) { console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 17).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); }
if (!libDir) die('library: pass --lib <dir> or set SIM_LIBRARY_DIR');
const lib = new SharedLibrary(resolve(libDir));

/** A world over HTTP, as its god. */
async function connect(url) {
  const u = new URL(url); const m = /\/w\/([a-z][a-z0-9-]{0,31})\/?$/.exec(u.pathname);
  if (!m) die(`library: ${url} is not a world URL (…/w/<slug>)`);
  const base = url.replace(/\/$/, ''), slug = m[1];
  let token = process.env.SIM_GOD_TOKEN;
  if (flags['token-file']) token = readFileSync(resolve(flags['token-file']), 'utf8').trim();
  if (flags.dev) {
    const r = await fetch(`${base}/v1/god/mint`, { method: 'POST', headers: { authorization: 'Bearer dev:admin', 'content-type': 'application/json' }, body: JSON.stringify({ label: 'library-cli' }) });
    if (!r.ok) die(`library: --dev mint failed (${r.status}); is this a DEV_AUTH world?`);
    token = (await r.json()).token;
  }
  if (!token) die('library: no god token (use --token-file, SIM_GOD_TOKEN, or --dev on a dev world)');
  const auth = { authorization: `Bearer ${token}` };
  const call = async (path, init = {}) => {
    const r = await fetch(base + path, { ...init, headers: { ...auth, ...(init.headers ?? {}) } });
    const ct = r.headers.get('content-type') ?? '';
    return { status: r.status, data: ct.includes('json') ? await r.json() : new Uint8Array(await r.arrayBuffer()) };
  };
  return { base, slug, call };
}

/** The creator's world as a WorldSource: raw stored bodies from the god snapshot, the current hash per ref from /v1/god/defs. */
async function source(w) {
  const snap = await w.call('/v1/god/snapshot');
  if (snap.status !== 200) die(`library: ${w.base} god snapshot ${snap.status} (${snap.data?.error?.message ?? ''})`);
  const bySha = new Map(snap.data.library.map((d) => [d.hash, d]));
  return {
    world: w.slug,
    async def(ref) {
      const r = await w.call(`/v1/god/defs/${encodeURIComponent(ref)}`);
      if (r.status !== 200) return undefined;
      return bySha.get(r.data.def.hash) ?? r.data.def;
    },
    async asset(sha) {
      const info = await w.call(`/v1/god/assets/${sha}`); if (info.status !== 200) return undefined;
      const a = info.data.asset, bytes = await w.call(`/assets/${sha}.${a.ext}`);
      if (bytes.status !== 200) return undefined;
      return { bytes: bytes.data, ext: a.ext, license: a.license, source: a.source, name: a.name };
    },
  };
}

const show = (e) => [
  `${e.id}@${e.version}  "${e.text.title}"  (${e.text.category})`,
  `  place as ${e.ref}  hash ${e.hash.slice(0, 16)}…  ${e.defs.length} def(s), ${e.assets.length} model(s), core: ${e.core.join(', ') || 'none'}`,
  `  by ${e.author.name ? e.author.name + ' / ' : ''}${e.author.by} in world ${e.author.world}, ${e.at}`,
  `  licence ${e.licence.spdx}${e.licence.attribution ? `, attribution: ${e.licence.attribution}` : ''}${e.licence.source ? `, source: ${e.licence.source}` : ''}`,
  `  moderation: ${e.moderation.gate}, ${e.moderation.checked.length} file(s) checked`,
  ...(e.text.description ? [`  ${e.text.description.slice(0, 200)}`] : []),
].join('\n');

try {
  if (cmd === 'publish') {
    if (!flags.from || !flags.ref) die('library publish --from <worldUrl> --ref <name@v>');
    const w = await connect(flags.from);
    const licence = { spdx: flags.licence ?? 'CC0-1.0', ...(flags.attribution ? { attribution: flags.attribution } : {}), ...(flags.source ? { source: flags.source } : {}) };
    const { entry, created } = await lib.publish(await source(w), flags.ref, { by: `god:${w.slug}`, licence, title: flags.title, authorName: flags['author-name'] });
    console.log(created ? `published ${entry.id}@${entry.version}` : `unchanged: ${entry.id}@${entry.version} is already the latest`);
    console.log(show(entry));
  } else if (cmd === 'find') {
    const forWorld = flags.for ? new URL(flags.for).pathname.match(/\/w\/([a-z0-9-]+)/)?.[1] : flags.world;
    const hits = lib.find(pos.join(' '), { forWorld, k: Number(flags.k ?? 10) });
    if (flags.json) console.log(JSON.stringify(hits, null, 1));
    else if (!hits.length) console.log('nothing in the shared library matches');
    else for (const h of hits) console.log(`${h.id}@${h.version}  "${h.title}"  ${h.category}  by ${h.author.name ?? h.author.by} (${h.author.world})  ${h.licence.spdx}  versions ${h.versions.join(',')}  [${h.why.join(' ')}]${h.first ? `\n    ${h.first}` : ''}`);
  } else if (cmd === 'show') {
    const e = lib.get(pos[0] ?? ''); if (!e) die(`library: ${pos[0]} not found`, 1);
    console.log(show(e)); const off = lib.offered(e); if (!off.ok) console.log(`  NOT OFFERED: ${off.why}`);
  } else if (cmd === 'place') {
    if (!pos[0] || !flags.into) die('library place <world>/<name>[@n] --into <worldUrl> [--name n] [--at x,z]');
    const w = await connect(flags.into);
    const e0 = lib.get(pos[0]); if (!e0) die(`library: ${pos[0]} is not in the shared library`, 1);
    // what the target already holds under the library's refs (a clash is refused; an identical def is reused)
    const existing = new Map();
    for (const d of e0.defs) { const r = await w.call(`/v1/god/defs/${encodeURIComponent(d.ref)}`); if (r.status === 200 && r.data.def.ref === d.ref) existing.set(d.ref, { hash: r.data.def.hash }); }
    const at = String(flags.at ?? '0,0').split(',').map(Number);
    const plan = lib.placement(pos[0], { world: w.slug, name: flags.name, p: [at[0] || 0, 0, at[1] || 0], ...(flags.r !== undefined ? { r: Number(flags.r) } : {}), existing: (ref) => existing.get(ref) });
    for (const a of plan.assets) {
      const q = new URLSearchParams({ name: `lib-${a.sha.slice(0, 8)}`, ...(a.licence ? { license: a.licence } : {}), ...(a.source ? { source: a.source } : {}) });
      const r = await w.call(`/v1/god/assets?${q}`, { method: 'POST', headers: { 'content-type': a.ext === 'glb' ? 'model/gltf-binary' : 'application/octet-stream' }, body: lib.assetBytes(a) });
      if (r.status !== 200) die(`library: model upload to ${w.slug} refused (${r.status}: ${r.data?.error?.message ?? ''})`, 1);
      if (r.data.asset.sha !== a.sha) die(`library: ${w.slug} stored the model as ${r.data.asset.sha.slice(0, 12)}, not ${a.sha.slice(0, 12)} (its upload gate changed the bytes)`, 1);
    }
    const r = await w.call('/v1/god/act', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ops: plan.ops, note: `library: place ${plan.entry.id}@${plan.entry.version}` }) });
    if (r.status !== 200 || !r.data.accepted) die(`library: ${w.slug} refused the placement: ${JSON.stringify(r.data?.failures ?? r.data).slice(0, 400)}`, 1);
    console.log(`placed ${plan.entry.id}@${plan.entry.version} in ${w.slug} as ${plan.entry.ref}${flags.name ? ` (named ${flags.name})` : ''}, edit ${r.data.seq}; ${plan.ops.length - 1} define(s), ${plan.assets.length} model(s) uploaded; licence ${plan.entry.licence.spdx}, by ${plan.entry.author.by}`);
  } else if (cmd === 'yank') {
    if (!pos[0] || !/@\d+$/.test(pos[0])) die('library yank <world>/<name>@n --reason <why>');
    lib.yank(pos[0], process.env.USER ?? 'operator', String(flags.reason ?? 'no reason given'));
    console.log(`yanked ${pos[0]}: gone from find and new placement; worlds that placed it keep it`);
  } else die(`library: unknown command ${cmd} (publish, find, show, place, yank)`);
} catch (e) {
  if (e instanceof LibraryError || /^(upload|moderation)\./.test(e?.code ?? '')) die(`library: refused — ${e.message}`, 1);
  throw e;
}
