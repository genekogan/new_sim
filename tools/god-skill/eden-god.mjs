#!/usr/bin/env node
// eden-god — god mode for one Eden world, from any folder (spec <eden4>/28 §7).
// State lives in ./.eden-god.json (private: world URL + god token). v0: register,
// pair/mint, map, defs, act/dryrun, place/terrain/remove/move/set/recolor, undo/redo,
// prayers/answer, stream. The relation solver and import pipeline arrive with M2–M5.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export const SKILL_VERSION = '0.1';
const STATE = '.eden-god.json';
const load = () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {});
const save = (patch) => { const s = { ...load(), ...patch }; writeFileSync(STATE, JSON.stringify(s, null, 2) + '\n', { mode: 0o600 }); return s; };
const need = (s, k, hint) => { if (!s[k]) throw new Error(`${k} missing. ${hint}`); return s[k]; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(path, { body, method, as = 'god', timeoutMs = 60_000 } = {}) {
  const s = load(), url = need(s, 'world', 'Run: node eden-god.mjs register <world-url>') + path, headers = { 'content-type': 'application/json' };
  if (as === 'god' && s.token) headers.authorization = `Bearer ${s.token}`;
  if (as === 'owner' && s.identity) headers.authorization = `Bearer ${s.identity}`;
  let r; try { r = await fetch(url, { method: method ?? (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) }); }
  catch (e) { return { status: 0, data: { ok: false, code: 'unreachable', message: String(e.message) } }; }
  const text = await r.text(); let data; try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 400) }; }
  return { status: r.status, data };
}
const ok = (r, what) => { if (r.status >= 200 && r.status < 300) return r.data; throw new Error(`${what}: HTTP ${r.status} ${JSON.stringify(r.data).slice(0, 300)}`); };

/** register <world-url> [--dev-identity dev:name]: remember the world; a dev identity lets `mint` skip browser pairing on local servers. */
export async function register(url, identity) {
  if (!url) throw new Error('usage: register <world-url> [dev:identity]');
  const base = url.replace(/\/$/, '');
  save({ world: base, ...(identity ? { identity } : {}) });
  const cfg = ok(await call('/v1/config', { as: 'none' }), 'register');
  return { world: base, worldId: cfg.worldId, devAuth: !!cfg.devAuth, next: cfg.devAuth && identity ? 'Run: mint' : 'Run: pair (your human approves in the browser)' };
}
/** pair: agent-initiated; prints a link for the owner, polls until approved, stores the god token. */
export async function pair(agent = 'eden-god ' + SKILL_VERSION) {
  const start = ok(await call('/v1/god/pair/start', { as: 'none', body: { agent } }), 'pair');
  console.error(start.tell_your_human);
  for (let i = 0; i < 300; i++) {
    const p = ok(await call('/v1/god/pair/poll', { as: 'none', body: { poll_token: start.poll_token } }), 'pair');
    if (p.status === 'approved') { save({ token: p.token }); return { paired: true, world: p.world }; }
    await sleep((start.interval_s ?? 3) * 1000);
  }
  throw new Error('pairing timed out; run pair again');
}
/** mint: local/dev shortcut using the registered dev identity (the world owner). */
export async function mint(label = 'eden-god') {
  const r = ok(await call('/v1/god/mint', { as: 'owner', body: { label } }), 'mint');
  save({ token: r.token }); return { paired: true, world: r.world };
}

// ---------------------------------------------------------------- reading
export async function snapshot() { return ok(await call('/v1/god/snapshot'), 'snapshot'); }
/** map: a compact, structural description a model can plan from. */
export async function map(opts = {}) {
  const s = await snapshot();
  const byId = new Map(s.entities.map((e) => [e.id, e]));
  const path = (e) => { const parts = []; let cur = e; while (cur) { parts.unshift(cur.name ?? cur.id); cur = cur.in.parent === 'world' ? null : byId.get(cur.in.parent); } return parts.join('/'); };
  const lines = [];
  lines.push(`# ${s.worldId} — ${s.constants.extent} m square, ground ${s.constants.ground}, base ${s.constants.base} m, seq ${s.seq}, tick ${s.tick}`);
  lines.push(`sky ${s.state.sky.palette}, ${s.entities.length} entities, ${s.library.length} defs in the library, ${s.prayers.length} prayers waiting, undo ${s.undoable ?? '-'} / redo ${s.redoable ?? '-'}`);
  const land = s.ground.landforms.filter((l) => !l.id.endsWith(':pad'));
  const nameOf = (id) => { const e = byId.get(id); return e ? path(e) : id; };
  if (land.length) { lines.push('## landforms'); for (const l of land) lines.push(`- ${l.kind} ${nameOf(l.id)}: ${l.kind === 'bump' ? `at (${l.c[0]}, ${l.c[1]}) r ${l.r} h ${l.h}` : l.kind === 'ridge' ? `path ${JSON.stringify(l.path)} w ${l.w} h ${l.h}` : l.kind === 'carve' ? `bed ${l.bed}` : l.kind === 'plateau' ? `h ${l.h}` : ''}`); }
  if (s.ground.waters.length) { lines.push('## water'); for (const w of s.ground.waters) lines.push(`- ${nameOf(w.id)}: level ${w.level}${w.area ? ` over ${w.area.length}-gon` : ''}`); }
  const roots = s.entities.filter((e) => e.in.parent === 'world');
  if (roots.length) { lines.push('## things'); for (const e of roots) { const kids = s.entities.filter((k) => k.in.parent === e.id); lines.push(`- ${path(e)} [${e.def}] ${e.p ? `at (${e.p.map((v) => +v.toFixed(2)).join(', ')})` : e.shape ? `shape ${Object.keys(e.shape)[0]}` : ''}${e.r !== undefined ? ` yaw ${typeof e.r === 'number' ? e.r.toFixed(2) : e.r.map((v) => v.toFixed(2)).join('/')}` : ''}${e.state ? ` state ${JSON.stringify(e.state)}` : ''}${kids.length ? ` (${kids.map((k) => k.name ?? k.id).join(', ')})` : ''}`); } }
  const fl = s.entities.filter((e) => e.def.includes('flag'));
  if (fl.length) { lines.push('## flags (reference points: --at flag:<name> [--offset dx,dz])'); for (const e of fl) lines.push(`- flag:${e.name} "${e.state?.label ?? ''}" at (${e.p?.[0]}, ${e.p?.[e.p.length - 1]})`); }
  if (s.prayers.length) { lines.push('## prayers'); for (const p of s.prayers) lines.push(`- ${p.id} from ${p.soul_name}: ${p.text}`); }
  if (opts.json) return { text: lines.join('\n'), snapshot: s };
  return lines.join('\n');
}
/** defs: the library this world can compose with (god only). */
export async function defs(filter) {
  const s = await snapshot();
  return s.library.filter((d) => !filter || d.name.includes(filter) || d.tags.includes(filter)).map((d) => ({ ref: d.ref, name: d.name, form: d.form, layer: d.layer, tags: d.tags, box: d.size.box, params: Object.fromEntries(Object.entries(d.params).map(([k, f]) => [k, f.default ?? f.type])), slots: d.slots.map((x) => x.id), description: d.description }));
}

// ---------------------------------------------------------------- writing
export async function act(batch, note) { return ok(await call('/v1/god/act', { body: { ...batch, ...(note ? { note } : {}) } }), 'act'); }
export async function dryrun(batch) { return ok(await call('/v1/god/dryrun', { body: batch }), 'dryrun'); }
const num = (v) => { const n = Number(v); if (!Number.isFinite(n)) throw new Error(`not a number: ${v}`); return n; };
/** Resolve "x,z" | "flag:<name>" | "<path>" [+ "--offset dx,dz"] to [x, z] using the live snapshot. */
async function resolveAt(spec, offset) {
  let p;
  if (/^-?\d/.test(spec)) p = spec.split(',').map(num);
  else {
    const s = await snapshot(); const byId = new Map(s.entities.map((e) => [e.id, e]));
    const name = spec.replace(/^flag:/, '');
    const e = s.entities.find((x) => x.name === name && (!spec.startsWith('flag:') || x.def.includes('flag'))) ?? s.entities.find((x) => x.state?.label === name);
    if (!e) throw new Error(`no such reference: ${spec} (run: flags)`);
    // world pose: walk up parents (flags and most references are roots; children use the parent's frame)
    let x = 0, z = 0, cur = e; const chain = []; while (cur) { chain.unshift(cur); cur = cur.in.parent === 'world' ? null : byId.get(cur.in.parent); }
    let yaw = 0; for (const c of chain) { const lp = c.p ?? [0, 0], lx = lp[0], lz = lp[lp.length - 1], ly = typeof c.r === 'number' ? c.r : Array.isArray(c.r) ? c.r[0] : 0; x += lx * Math.cos(yaw) + lz * Math.sin(yaw); z += -lx * Math.sin(yaw) + lz * Math.cos(yaw); yaw += ly; }
    p = [Math.round(x * 100) / 100, Math.round(z * 100) / 100];
  }
  if (offset) { const [dx, dz] = offset.split(',').map(num); p = [p[0] + dx, p[1] + dz]; }
  return p;
}
/** flags: every reference point with its label and position. */
export async function flags() { const s = await snapshot(); return s.entities.filter((e) => e.def.includes('flag')).map((e) => ({ name: e.name, label: e.state?.label ?? '', at: e.p ? [e.p[0], e.p[e.p.length - 1]] : null })); }
/** flag <label> --at x,z : drop a reference point. */
export async function flag(label, flagsIn) { const p = await resolveAt(flagsIn.at ?? '0,0', flagsIn.offset); const name = label.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'flag'; return act({ ops: [{ op: 'place', def: 'core/flag@1', name, p, state: { label } }] }); }
/** place <def> --at x,z [--yaw r] [--name n] [--in parent[/slot]] [--param k=v]... [--nudge] */
export async function place(def, flags) {
  const op = { op: 'place', def: def.includes('@') ? def : `core/${def}@1`, mode: flags.nudge ? 'nudge' : 'strict' };
  if (flags.at) op.p = flags.in ? flags.at.split(',').map(num) : await resolveAt(flags.at, flags.offset);
  if (flags.yaw !== undefined) op.r = num(flags.yaw);
  if (flags.name) op.name = flags.name;
  if (flags.in) { const [parent, slot] = flags.in.split('/'); op.in = { parent, ...(slot ? { slot } : {}) }; }
  if (flags.path) op.shape = { path: JSON.parse(flags.path), ...(flags.width ? { width: num(flags.width) } : {}) };
  if (flags.area) op.shape = { area: JSON.parse(flags.area) };
  if (flags.param) op.params = Object.fromEntries([].concat(flags.param).map((kv) => { const [k, v] = kv.split('='); return [k, /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v === 'true' ? true : v === 'false' ? false : v]; }));
  if (flags.scale) op.s = num(flags.scale);
  return act({ ops: [op] }, flags.note);
}
/** terrain <mountain|hill|knoll|plateau|lake|pond> ... same flags as place; shapes for ranges/lakes. */
export const terrain = place;
export async function remove(id) { return act({ ops: [{ op: 'remove', id }] }); }
export async function move(id, flags) { const op = { op: 'move', id, mode: flags.nudge ? 'nudge' : 'strict' }; if (flags.at) op.p = flags.in ? flags.at.split(',').map(num) : await resolveAt(flags.at, flags.offset); if (flags.yaw !== undefined) op.r = num(flags.yaw); if (flags.in) { const [parent, slot] = flags.in.split('/'); op.in = { parent, ...(slot ? { slot } : {}) }; } if (flags.scale) op.s = num(flags.scale); return act({ ops: [op] }); }
export async function set(id, flags) { const op = { op: 'set', id }; if (flags.state) op.state = JSON.parse(flags.state); if (flags.param) op.params = Object.fromEntries([].concat(flags.param).map((kv) => { const [k, v] = kv.split('='); return [k, /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v]; })); if (flags.name) op.name = flags.name; return act({ ops: [op] }); }
export async function recolor(id, color) { return act({ ops: [{ op: 'set', id, state: { paint: color } }] }).catch(() => act({ ops: [{ op: 'set', id, params: { color } }] })); }
export async function sky(flags) { return act({ ops: [{ op: 'world', state: { sky: { palette: flags.palette ?? 'clear-day', sun: flags.sun !== undefined ? num(flags.sun) : 0.6 } } }] }); }
export async function constitution(text) { return act({ ops: [{ op: 'world', state: { constitution: text } }] }); }
export async function undo() { return ok(await call('/v1/god/undo', { method: 'POST' }), 'undo'); }
export async function redo() { return ok(await call('/v1/god/redo', { method: 'POST' }), 'redo'); }
export async function prayers() { return ok(await call('/v1/god/prayers'), 'prayers'); }
export async function answer(prayer, text) { return ok(await call('/v1/god/answer', { body: { prayer, text } }), 'answer'); }
export async function edits(limit = 20) { return ok(await call(`/v1/god/edits?limit=${limit}`), 'edits'); }
/** stream [seconds]: print god events (diffs, prayers) as they arrive. */
export async function stream(seconds = 60) {
  const s = load(); const r = await fetch(need(s, 'world', 'register first') + '/v1/god/stream', { headers: { authorization: `Bearer ${s.token}`, accept: 'text/event-stream' }, signal: AbortSignal.timeout(seconds * 1000) }).catch((e) => { throw new Error('stream: ' + e.message); });
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
  try { for (;;) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const frame = buf.slice(0, i); buf = buf.slice(i + 2); if (frame.startsWith(':')) continue; const ev = /^event: (.*)$/m.exec(frame)?.[1], data = /^data: (.*)$/m.exec(frame)?.[1]; if (ev) console.log(JSON.stringify({ event: ev, data: data ? JSON.parse(data) : null })); } } } catch { /* timeout */ }
  return { ended: true };
}

// ---------------------------------------------------------------- cli
function parseFlags(argv) { const flags = {}, rest = []; for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : true; if (flags[k] !== undefined) flags[k] = [].concat(flags[k], v); else flags[k] = v; } else rest.push(a); } return { flags, rest }; }
const COMMANDS = {
  register: (r, f) => register(r[0], r[1] ?? f.identity), pair: (r) => pair(r[0]), mint: (r) => mint(r[0]),
  map: (r, f) => map({ json: !!f.json }), defs: (r) => defs(r[0]), snapshot,
  act: (r, f) => act(JSON.parse(r[0] ?? readFileSync(0, 'utf8')), f.note), dryrun: (r) => dryrun(JSON.parse(r[0] ?? readFileSync(0, 'utf8'))),
  place: (r, f) => place(r[0], f), terrain: (r, f) => terrain(r[0], f), remove: (r) => remove(r[0]), move: (r, f) => move(r[0], f), set: (r, f) => set(r[0], f), recolor: (r) => recolor(r[0], r[1]), sky: (r, f) => sky(f), constitution: (r) => constitution(r.join(' ')),
  flags, flag: (r, f) => flag(r.join(' '), f),
  undo, redo, prayers, answer: (r) => answer(r[0], r.slice(1).join(' ')), edits: (r) => edits(r[0] ? Number(r[0]) : 20), stream: (r) => stream(r[0] ? Number(r[0]) : 60),
};
if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...argv] = process.argv.slice(2); const { flags, rest } = parseFlags(argv);
  const fn = COMMANDS[cmd];
  if (!fn) { console.error(`eden-god ${SKILL_VERSION}\ncommands: ${Object.keys(COMMANDS).join(', ')}`); process.exit(2); }
  fn(rest, flags).then((out) => { if (typeof out === 'string') console.log(out); else console.log(JSON.stringify(out, null, 2)); }).catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
}
