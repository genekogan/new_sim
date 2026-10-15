#!/usr/bin/env node
// eden-god — god mode for one Eden world, from any folder (spec <eden4>/28 §7, 29 WP5, 33 §3.4).
// SOURCE of the downloadable single file eden-god.mjs (built by build.mjs: `node build.mjs`).
// State: ./.eden-god.json (world URL + god token + current group; private), ./.eden-god.cache.json
// (the world mirror). Commands print short human text; add --json for machine output.
import { catalog, find, recommend, taxonomy } from './lib/catalog.mjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { call, load, num, ok, r2, save, sleep } from './lib/state.mjs';
import { mirror, view, normDef, follow, invalidate } from './lib/mirror.mjs';
import { exportGenesis } from './lib/export.mjs';
import { solve, refPoint, centreOf, compassOfYaw, rectArea, circleArea, compassKey, COMPASS, setOf, relocate, frameOf, slotTarget, isFlagDef } from './lib/solver.mjs';
import { camera, shoot, keeper, stopKeeper } from './lib/look.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const SELF = (() => { try { return fileURLToPath(import.meta.url); } catch { return process.argv[1]; } })();
import { selectRows } from './lib/select.mjs';
import { PALETTE_LIST } from './lib/sky.mjs';
import { schemaMarkdown } from './lib/schema-md.mjs';
import { time as envTime, weather as envWeather, strike as envStrike, land as envLand, ENV_FLAGS, ENV_BOOLS, LAND_HELP } from './lib/env.mjs';
import { hours, own, access, price, currency, give, pay, zone, zoneSuggest, relate, layers, LAYERS_FLAGS, LAYERS_BOOLS, LAYERS_POS, LAYERS_HELP } from './lib/layers.mjs';
export { schemaMarkdown };

import { SKILL_VERSION } from './lib/version.mjs';
export { SKILL_VERSION };

// ---------------------------------------------------------------- pairing
export async function register(url, identity) {
  if (!url) throw new Error('usage: register <world-url> [dev:identity]');
  const base = url.replace(/[?#].*$/, '').replace(/\/$/, '');
  save({ world: base, ...(identity ? { identity } : {}) });
  const cfg = ok(await call('/v1/config', { as: 'none' }), 'register');
  return { world: base, worldId: cfg.worldId, devAuth: !!cfg.devAuth, next: cfg.devAuth && identity ? 'Run: mint' : 'Run: pair (your human approves in the browser)' };
}
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
export async function mint(label = 'eden-god') { const r = ok(await call('/v1/god/mint', { as: 'owner', body: { label } }), 'mint'); save({ token: r.token }); return { paired: true, world: r.world }; }

// ---------------------------------------------------------------- reading
export async function snapshot() { return ok(await call('/v1/god/snapshot'), 'snapshot'); }
const fmtP = (p) => (p ? `(${p.map((v) => r2(v)).join(', ')})` : '');
const dxdz = (x, what) => { const a = String(x).split(',').map(Number); if (a.length !== 2 || !a.every(Number.isFinite)) throw new Error(`${what} takes dx,dz (two numbers), got ${x}`); return a; };
const yawWord = (y) => (typeof y === 'number' ? `facing ${compassOfYaw(y)}` : '');

/** map: the whole world as structure — extent, terrain, water, every root thing with pose and children, flags, prayers. */
export async function map(opts = {}) {
  const m = await mirror(); const v = view(m); const s = m.snapshot;
  const lines = [];
  lines.push(`# ${s.worldId} — ${s.constants.extent} m square (±${s.constants.extent / 2}), ground ${s.constants.ground}, seq ${s.seq}${m.offline ? ' (OFFLINE: cached)' : ''}`);
  lines.push(`sky ${s.state.sky.palette}, ${s.entities.length} entities, ${s.library.length} defs, ${s.prayers.length} prayers waiting, undo ${s.undoable ?? '-'} / redo ${s.redoable ?? '-'}${load().group ? `, group "${load().group}"` : ''}`);
  const land = s.ground.landforms.filter((l) => !l.id.endsWith(':pad'));
  const nameOf = (id) => v.byId.get(id)?.path ?? id;
  if (land.length) { lines.push('## terrain'); for (const l of land) lines.push(`- ${nameOf(l.id)}: ${l.kind}${l.kind === 'bump' ? ` at (${r2(l.c[0])}, ${r2(l.c[1])}) r ${r2(l.r)} h ${r2(l.h)}` : l.kind === 'ridge' ? ` along ${l.path.length} pts w ${l.w} h ${l.h}` : l.h !== undefined ? ` h ${l.h}` : ''}`); }
  if (s.ground.waters.length) { lines.push('## water'); for (const w of s.ground.waters) lines.push(`- ${nameOf(w.id)}: level ${w.level}`); }
  const roots = v.rows.filter((r) => r.parent === 'world' && !isFlagDef(v.def(r.def)?.ref ?? r.def));
  const limit = opts.all ? Infinity : 120;
  if (roots.length) {
    lines.push(`## things (${roots.length} at the root${roots.length > limit ? `; first ${limit}, --all for every one` : ''})`);
    for (const r of roots.slice(0, limit)) {
      const kids = v.children(r.id);
      const shape = r.shape ? (r.shape.area ? ` area ~${r2(r.aabb[2] - r.aabb[0])}×${r2(r.aabb[3] - r.aabb[1])} m around ${fmtP([centreOf(r).x, centreOf(r).z])}` : ` path ${r.shape.path.length} pts ${fmtP(r.shape.path[0])}→${fmtP(r.shape.path.at(-1))}`) : ` at ${fmtP([r.pose[0], r.pose[1], r.pose[2]])} ${yawWord(r.pose[3])}`;
      lines.push(`- ${r.path} [${r.def.replace(/^core-/, 'core/')}]${shape}${r.form === 'point' && !r.shape ? ` ${r2(r.box[0])}×${r2(r.box[2])} m` : ''}${kids.length ? ` — ${kids.length} inside: ${kids.slice(0, 8).map((k) => k.name ?? k.id).join(', ')}${kids.length > 8 ? '…' : ''}` : ''}`);
    }
  }
  const fl = v.rows.filter((r) => isFlagDef(v.def(r.def)?.ref ?? r.def));
  if (fl.length) { lines.push('## flags (refer to them as flag:<name>)'); for (const r of fl) lines.push(`- flag:${r.name} "${v.entity(r.id)?.state?.label ?? ''}" at (${r.pose[0]}, ${r.pose[2]})`); }
  if (s.prayers.length) { lines.push('## prayers'); for (const p of s.prayers) lines.push(`- ${p.id} from ${p.soul_name}: ${p.text}`); }
  return opts.json ? { text: lines.join('\n'), snapshot: s } : lines.join('\n');
}

/** defs <query>: search the library (always search before you define). */
/** Builder words the server's catalog search (L5, ranked, with its own synonyms) does not map yet: their
 *  matches are appended after the server's own ranking. */
const SYNONYMS = { house: ['townhouse'], home: ['townhouse'], street: ['road'], lane: ['road', 'track'], trail: ['footpath'], path: ['footpath'],
  walkway: ['footpath'], square: ['plaza'], forest: ['woodland'], woods: ['woodland'], wood: ['woodland'], meadow: ['wildflowers'], field: ['lawn', 'wildflowers'],
  grass: ['lawn'], water: ['lake', 'pond', 'river'], creek: ['stream'], wall: ['garden-wall', 'fence'], animal: ['creature'], animals: ['animals'],
  herd: ['animals'], flock: ['animals'], pet: ['dog', 'cat'], stall: ['parasol-table', 'crate'], market: ['parasol-table', 'crate', 'barrel'], church: ['chapel'] };
const forms = (w) => [...new Set([w, ...(w.length > 3 ? [w.replace(/s$/, ''), w.replace(/es$/, ''), w.replace(/ies$/, 'y')] : [])])];
const synonymsOf = (w) => [...new Set(forms(w).flatMap((f) => SYNONYMS[f] ?? []))];
/** A def's --scale range in words: "--scale 0.4–2.5" or "fixed size". */
const scaleText = (d) => { const sc = d?.size?.scale; return !sc ? '' : sc[0] === sc[1] ? (sc[0] === 1 ? 'fixed size (no --scale)' : `--scale ${sc[0]} only`) : `--scale ${sc[0]}–${sc[1]}`; };
const fieldText = (k, f) => `${k}: ${f.type}${f.values ? ` ${f.values.join('|')}` : ''}${f.min !== undefined || f.max !== undefined ? ` ${f.min ?? ''}…${f.max ?? ''}` : ''}${f.default !== undefined ? ` = ${typeof f.default === 'object' ? JSON.stringify(f.default) : f.default}` : ''}${f.doc ? ` — ${f.doc}` : ''}`;
/** defs <one def's name or full ref>: that def in full (params with ranges and defaults, size, slots, rooms). */
async function defDetail(d, others) {
  const ref = d.ref.replace(/^core-/, 'core/');
  const L = [`${ref} — ${d.form}, ${d.layer}, ${d.size.box.map(r2).join('×')} m${d.form === 'point' ? `, ${scaleText(d)}` : ''}${d.make?.gen ? `, made by ${d.make.gen}` : ''}${d.tags.length ? ` [${d.tags.join(' ')}]` : ''}`];
  if (d.description) L.push(`  ${d.description}`);
  const ps = Object.entries(d.params ?? {});
  if (ps.length) { L.push(`  params (--param k=v):`); for (const [k, f] of ps) L.push(`  - ${fieldText(k, f).slice(0, 240)}`); }
  if (d.state && Object.keys(d.state).length) L.push(`  state (--state '{…}'): ${Object.entries(d.state).map(([k, f]) => fieldText(k, f)).join('; ').slice(0, 300)}`);
  // VOCAB-MECH: where it sits in the catalogue, the words for it, and what Souls can do with it
  if (d.category || d.synonyms?.length) L.push(`  catalogue: ${d.category ?? '(inferred)'}${d.synonyms?.length ? ` · aka ${d.synonyms.join(', ')}` : ''}`);
  if (d.actions?.length) L.push(`  Souls can: ${d.actions.map((a) => `${a.name}${a.when?.length ? ` (when ${a.when.map((w) => `${w.field}${w.is !== undefined ? '=' + JSON.stringify(w.is) : '≠' + JSON.stringify(w.not)}`).join(', ')})` : ''}`).join('; ')} — offered to Souls near it as object:<id>:<action>`);
  try {
    const b = await bakeInfo(ref.includes('@') ? ref : `${ref}@1`, {});
    if (b.rooms?.length) L.push(`  rooms at the defaults: ${b.rooms.map((r) => `${r.id} (floor ${r.floor})`).join(', ')}`);
    const sl = (b.slots ?? []).filter((x) => !['room', 'wall'].includes(x.kind));
    if (sl.length) L.push(`  slots: ${sl.map((x) => `${x.id} (${x.kind}, holds ${x.capacity})`).join(', ')}`);
  } catch { /* bake is a nicety */ }
  if (others.length) L.push(`  other defs matching: ${others.slice(0, 12).join(', ')}${others.length > 12 ? ' …' : ''}`);
  return L.join('\n');
}
export async function defs(q, flags = {}) {
  if (q && !/\s/.test(q.trim())) {
    const name = q.trim().toLowerCase().replace(/^core[/-]/, '').replace(/@\d+$/, '');
    const qs = new URLSearchParams({ q: name.replace(/-/g, ' ') });
    const list = ok(await call(`/v1/god/defs?${qs}`), 'defs').defs;
    const want = /@\d+$/.test(q) ? q.trim().replace(/^core\//, 'core-') : null;
    const hit = list.find((d) => (want ? d.ref === want || d.ref === want.replace(/^core-/, '') : d.name === `core-${name}` || d.name === name));
    if (hit && !flags.json) return defDetail(hit, list.filter((d) => d !== hit).map((d) => d.ref.replace(/^core-/, 'core/')));
    if (hit && flags.json) return hit;
    if (want) return `no def ${q}. \`defs ${name.replace(/-/g, ' ')}\` searches the library.`;
  }
  const get = async (words) => { const qs = new URLSearchParams(); if (words) qs.set('q', words); if (flags.tag) qs.set('tag', flags.tag); return ok(await call(`/v1/god/defs?${qs}`), 'defs').defs; };
  const r = { defs: await get(q) };
  if (q) {
    const seen = new Set(r.defs.map((d) => d.ref));
    for (const syn of [...new Set(q.toLowerCase().split(/\s+/).filter(Boolean).flatMap(synonymsOf))]) for (const d of (await get(syn)).slice(0, 3)) if (!seen.has(d.ref)) { seen.add(d.ref); r.defs.push(d); }
  }
  const rows = r.defs.map((d) => ({ ref: d.ref.replace(/^core-/, 'core/'), form: d.form, layer: d.layer, box: d.size.box, scale: d.size.scale, tags: d.tags, params: Object.fromEntries(Object.entries(d.params).map(([k, f]) => [k, f.default ?? f.type])), slots: d.slots.map((x) => `${x.id}:${x.kind}`), description: d.description }));
  if (flags.json) return rows;
  if (!rows.length) return `no defs match "${q ?? ''}". Try a broader word, or define one: define-kit (see SKILL.md).`;
  return [`${rows.length} defs${q ? ` matching "${q}"` : ''}:`, ...rows.slice(0, flags.all ? 999 : 40).map((d) => `- ${d.ref} (${d.form}, ${d.layer}, ${d.box.map(r2).join('×')} m${d.form === 'point' && d.scale ? `, ${d.scale[0] === d.scale[1] ? 'fixed size' : `scale ${d.scale[0]}–${d.scale[1]}`}` : ''})${d.tags.length ? ` [${d.tags.slice(0, 6).join(' ')}]` : ''}${Object.keys(d.params).length ? ` params: ${Object.entries(d.params).slice(0, 10).map(([k, v]) => `${k}=${typeof v === 'object' ? 'json' : v}`).join(' ')}` : ''}${d.slots.length ? ` slots: ${d.slots.slice(0, 6).join(' ')}` : ''}${d.description ? ` — ${d.description.slice(0, 110)}` : ''}`), rows.length > 40 && !flags.all ? `… ${rows.length - 40} more (--all)` : ''].filter(Boolean).join('\n');
}

export async function schema(flags = {}) { const s = ok(await call('/v1/god/schema', { as: 'none' }), 'schema'); return flags.md ? schemaMarkdown(s) : s; }

export async function query(q) { return ok(await call('/v1/god/query', { body: typeof q === 'string' ? JSON.parse(q) : q }), 'query'); }
/** verify-use: a temporary server-side resident proves actual entry and seating. */
export async function verifyUse(target, flags = {}) {
  if (!target) throw new Error('usage: verify-use <target> [--seat <ref>] [--from <ref|x,z>] [--uses enter,sit] [--json]');
  const body = { target };
  if (flags.seat) body.seat = flags.seat;
  if (flags.from !== undefined) {
    const text = String(flags.from), parts = text.split(',').map(Number);
    if (text.includes(',')) {
      if (parts.length !== 2 || text.split(',').some(x => !x.trim()) || !parts.every(Number.isFinite)) throw new Error('--from takes a reference or x,z');
      body.from = parts;
    } else body.from = text;
  }
  if (flags.uses !== undefined) {
    const uses = String(flags.uses).split(',');
    if (!uses.length || uses.some(x => !['enter', 'sit'].includes(x)) || new Set(uses).size !== uses.length) throw new Error('--uses takes enter, sit, or enter,sit');
    body.uses = uses;
  }
  const receipt = ok(await call('/v1/god/verify-use', { body, timeoutMs: 190_000 }), 'verify-use');
  if (flags.json) return receipt;
  const lines = (receipt.uses ?? []).map(r => `${r.use}: ${r.ok ? 'OK' : 'FAILED'}${r.ok ? (r.use === 'sit' ? ` — ${r.seat}; ${r.occupant}; ${r.distanceToSlot} m from slot` : ` — ${r.room ?? target}${r.door ? ` via ${r.door}` : ''}`) : ` — ${r.reason?.code ?? 'verify.refused'}${r.reason?.engineCode ? ` (${r.reason.engineCode})` : ''}: ${r.reason?.message ?? 'unconfirmed'}`}`);
  if (!lines.length && receipt.reason) lines.push(`FAILED: ${receipt.reason.code}: ${receipt.reason.message}`);
  lines.push(`probe ${receipt.probe?.created === false ? 'not created' : receipt.probe?.removed ? 'removed' : receipt.probe?.removal === 'pending' ? 'removal pending (native retirement accepted)' : 'REMOVAL UNCONFIRMED'}; ${Math.round(receipt.ms ?? 0)} ms`);
  if (receipt.timings) lines.push(`timings (ms): ${['birth', 'start', 'enter', 'sit', 'retire'].map(phase => `${phase} ${Math.round(receipt.timings[phase] ?? 0)}`).join('; ')}`);
  for (const result of receipt.uses ?? []) {
    if (result.proof) lines.push(`  ${result.use} proof: ${result.proof.kind} at ${result.proof.at.join(',')}; tick ${result.proof.tick}; ${Math.round(result.proof.ms)} ms`);
    if (result.interiorRoute) { const route = result.interiorRoute; lines.push(`  interior route: engine planner ${route.reach.ok ? `OK (${route.reach.length} m)` : `FAILED (${route.reach.code})`}${route.relocatedTo ? `; relocated to ${route.relocatedTo.join(',')}` : ''}; final approach physical`); }
  }
  for (const note of receipt.notes ?? []) if (/full physical walk/.test(note)) lines.push(note);
  return lines.join('\n');
}

/** describe <ref>: rooms, doors, stairs, slots, occupants, constraints (satisfied or not), behaviours, ground, neighbours. */
export async function describe(ref, flags = {}) {
  if (!ref) throw new Error('usage: describe <path|flag:name>');
  { const v = view(await mirror()); const set = !v.get(ref) && setOf(v, ref); if (set) { const parts = []; for (const r of set.members) parts.push((await describe(r.path, flags)).split('\n').slice(0, 3).join('\n')); return flags.json ? parts : [`${ref} is a set of ${set.members.length}: ${set.members.map((r) => r.name).join(', ')} — refer to all of them as ${ref} (--near, --facing, look --at, move --by, remove, recolor) or one by its own name`, ...parts].join('\n'); } }
  let d = (await query({ describe: ref.replace(/^flag:/, '') })).describe;
  if (d.error && ref.includes('/')) {
    // a room of a building: house/<room> (rooms are slots, not entities)
    const cut = ref.lastIndexOf('/'), h = (await query({ describe: ref.slice(0, cut) })).describe, word = ref.slice(cut + 1).toLowerCase().replace(/[^a-z0-9]/g, '');
    const room = h.error ? null : (h.rooms ?? []).find((r) => r.id === ref.slice(cut + 1)) ?? (h.rooms ?? []).find((r) => r.id.replace(/[^a-z0-9]/g, '').startsWith(word));
    if (room) { if (flags.json) return room; return [`${h.path}/${room.id} — room "${room.name}" of ${h.path}, floor ${room.floor} (y ${room.y}), ${room.size.join('×')} m, headroom ${room.height} m`, `  doors: ${room.doors.join(', ') || 'none'}`, `  holds: ${room.occupants.map((o) => o.name).join(', ') || 'nothing'}`, `  place into it: --inside ${h.path}/${room.id} [--wall back|front|left|right] [--corner back-left|…]; furnish ${h.path}/${room.id}`].join('\n'); }
  }
  if (d.error) throw new Error(d.error);
  if (flags.json) return d;
  const L = [];
  L.push(`${d.path} [${d.def.replace(/^core-/, 'core/')}] ${d.layer} ${d.form}${d.anchor !== 'base' ? `, anchor ${d.anchor}` : ''} — ${d.in === 'world' ? 'at the root' : `in ${d.in.parent}${d.in.slot ? ` (slot ${d.in.slot})` : ''}`}`);
  if (d.description) L.push(`  ${d.description.slice(0, 200)}`);
  const sc = d.form === 'point' ? scaleText(view(await mirror()).def(d.def)) : '';
  L.push(`  pose (${d.pose.x}, ${d.pose.y}, ${d.pose.z}) facing ${d.pose.faces} (yaw ${d.pose.yaw})${d.pose.s !== 1 ? ` scale ${d.pose.s}` : ''}${sc ? `, ${sc}` : ''}; size ${d.box.join('×')} m; bounds x ${d.aabb[0]}…${d.aabb[2]}, z ${d.aabb[1]}…${d.aabb[3]}, y ${d.y[0]}…${d.y[1]}; ${d.colliders} colliders, ~${d.tris} tris`);
  if (d.shape?.path) L.push(`  path: ${d.shape.points} points, ${d.shape.length} m${d.shape.width ? `, ${d.shape.width} m wide` : ''}: ${d.shape.path.map((p) => `${r2(p[0])},${r2(p[1])}`).join(' → ')}${d.shape.points > d.shape.path.length ? ' (ends)' : ''}; middle ${d.shape.middle.join(',')}`);
  if (d.shape?.points && !d.shape.path) L.push(`  area: ${d.shape.points} corners, ${d.shape.size.join('×')} m around ${d.shape.centre.join(',')}`);
  if (Object.keys(d.params).length) L.push(`  params ${JSON.stringify(d.params).slice(0, 300)}`);
  if (Object.keys(d.state).length) L.push(`  state ${JSON.stringify(d.state).slice(0, 300)}`);
  if (d.rooms.length) { L.push(`  rooms (${d.rooms.length}):`); for (const r of d.rooms) L.push(`  - ${r.id} "${r.name}" floor ${r.floor} (y ${r.y}), ${r.size.join('×')} m, headroom ${r.height} m${r.doors.length ? `, ${r.doors.join(', ')}` : ''}; ${r.occupants.length ? `holds ${r.occupants.map((o) => o.name).join(', ')}` : 'empty'} — place into it with --inside ${d.path}/${r.id}`); }
  if (d.openings.length) L.push(`  openings: ${d.openings.map((o) => `${o.kind} ${o.id} (floor ${o.level}, ${o.width}×${o.height} m, faces ${o.faces}, ${o.state}) at (${o.at.join(', ')})`).join('; ')}`);
  if (d.links.length) L.push(`  links: ${d.links.map((l) => `${l.kind} ${l.id} floor ${l.from}→${l.to}, ${l.width} m wide`).join('; ')}`);
  if (d.slots.length) L.push(`  slots: ${d.slots.map((s) => `${s.id} (${s.kind}, ${s.used}/${s.capacity}${s.occupants.length ? ': ' + s.occupants.join(', ') : ''})`).join('; ')}`);
  if (d.children.length) L.push(`  children: ${d.children.map((c) => c.name).join(', ')}`);
  if (d.constraints.length) L.push(`  constraints: ${d.constraints.map((c) => `${c.ok ? 'ok' : 'VIOLATED'} ${c.kind}${c.ref ? ' ' + c.ref : ''}${c.why ? ` (${c.why})` : ''}`).join('; ')}`);
  const b = d.behaviours; if (b.supported.length || Object.keys(b.missing).length) L.push(`  behaviours: ${b.supported.join(', ') || 'none'}${Object.keys(b.missing).length && (b.supported.length || d.tags.some((t) => /creature|animal/.test(t))) ? `; cannot: ${Object.entries(b.missing).map(([k, why]) => `${k} (${why})`).join('; ')}` : ''}`);
  L.push(`  ground: y ${d.ground.y}, slope ${d.ground.slopeDeg}°, ${d.ground.medium}${d.ground.water ? `, water ${d.ground.water} m deep` : ''}`);
  if (d.near.length) L.push(`  near: ${d.near.map((n) => `${n.path} ${n.dist} m ${n.dir}`).join(', ')}`);
  if (d.notes.length) L.push(`  notes: ${d.notes.join(' | ')}`);
  return L.join('\n');
}

/** where <x,z|ref>: terrain, water, what contains the point, the room it is in, the nearest things. */
export async function where(spec, flags = {}) {
  const m = await mirror(); const v = view(m);
  const p = refPoint(v, spec, flags.offset);
  const d = (await query({ where: [p.x, p.z] })).where;
  if (flags.json) return d;
  return [`(${d.x}, ${d.z}): ground y ${d.y}, slope ${d.slopeDeg}°, ${d.medium}${d.water ? `, water level ${d.water.level} (${d.water.depth} m deep)` : ''}`,
    d.room ? `  inside ${d.room.building}, room ${d.room.room} (floor ${d.room.floor})` : '',
    d.inside.length ? `  within: ${d.inside.map((x) => `${x.path} [${x.layer}]`).join(', ')}` : '  nothing built here',
    d.near.length ? `  nearest: ${d.near.map((n) => `${n.path} ${n.dist} m ${n.dir}`).join(', ')}` : ''].filter(Boolean).join('\n');
}

/** free WxD [--near ref] [--radius r] [--count n]: flat dry plots nobody occupies. */
export async function freePlots(size, flags = {}) {
  const [w, d] = String(size ?? '8x8').split(/[x×,]/).map(Number);
  const m = await mirror(); const v = view(m);
  const near = flags.near ? refPoint(v, flags.near) : { x: 0, z: 0 };
  const r = (await query({ free: { size: [w, d], near: [near.x, near.z], radius: flags.radius ? num(flags.radius) : 150, count: flags.count ? num(flags.count) : 4, maxSlope: flags.slope ? num(flags.slope) : 0.25 } })).free;
  return flags.json ? r : r.length ? r.map((f) => `- (${f.at.join(', ')}) y ${f.y}, slope ${f.slope}, ${f.dist} m from (${near.x}, ${near.z})`).join('\n') : 'no free plot of that size within the radius';
}

// ---------------------------------------------------------------- writing
const withGroup = (batch) => { const g = load().group; return g && !batch.group ? { ...batch, group: g } : batch; };
export async function act(batch, note) { const r = ok(await call('/v1/god/act', { body: withGroup({ ...batch, ...(note ? { note } : {}) }) }), 'act'); invalidate(); return r; }
export async function dryrun(batch) { return ok(await call('/v1/god/dryrun', { body: withGroup(batch) }), 'dryrun'); }
export async function preview(batch) {
  const r = ok(await call('/v1/god/preview', { body: withGroup(typeof batch === 'string' ? JSON.parse(batch) : batch) }), 'preview');
  return r.accepted ? { ...r, url: `${load().world}?preview=${r.id}`, commit: `node eden-god.mjs commit ${r.id}`, tell: `Preview ${r.id}: open ${load().world}?preview=${r.id} to see the ghost; run \`node eden-god.mjs commit ${r.id}\` to build it.` } : r;
}
export async function commit(id) { if (!id) throw new Error('usage: commit <preview-id>'); const r = ok(await call('/v1/god/act', { body: { preview: id } }), 'commit'); invalidate(); return r; }
export async function request(clientRef) { if (!clientRef) throw new Error('usage: request <clientRef>'); return ok(await call(`/v1/god/requests/${encodeURIComponent(clientRef)}`), 'request'); }
/** plan '<batch>': a dry run, summarised in words. */
export async function planBatch(batch) {
  const b = typeof batch === 'string' ? JSON.parse(batch) : batch;
  const r = await dryrun(b);
  if (!r.accepted) return `would be REFUSED: ${r.failures.map(explainFailure).join('; ')}`;
  return `would be accepted: ${r.diff.upserts} things placed/changed, ${r.diff.removes} removed${r.diff.defs.length ? `, defines ${r.diff.defs.join(', ')}` : ''}${r.diff.tiles ? `, ${r.diff.tiles} terrain tiles` : ''}${r.warnings.length ? `; warnings: ${r.warnings.join('; ')}` : ''}`;
}
const HINTS = {
  'overlap.solid': 'something solid is there; the server suggests a spot (suggest.p) — the solver already tried it; try --near with --dist, --free, or remove the blocker',
  'support.none': 'nothing to rest on; give a parent or a 2-D p so it settles on the ground',
  'extent.outside': 'outside the world; `expand <metres>` grows it, or place nearer the centre',
  'slot.unknown': 'that slot does not exist; `describe <parent>` lists slots and rooms',
  'slot.full': 'the slot is full; pick another slot or room',
  'slot.incompatible': 'the slot does not accept this kind/size',
  'slot.outside': 'the point is not inside that room; use --inside <house>/<room> or a world point inside it',
  'size.range': 'that scale or size is outside what the def allows: `defs <name>` shows its --scale range (fixed size = no --scale); use params (w, d, height, radius) or a bigger def instead',
  'float.no-water': 'there is no water there; use --float --at <lake|pond|river>',
  'def.unknown': 'no such def; `defs <word>` searches the library',
  'params.invalid': '`defs <name>` shows params with ranges',
  'state.invalid': 'unknown or bad state field; `describe` shows the state',
  'name.taken': 'names are unique per parent; choose another --name',
  'occupied.by-body': 'a Soul is there; wait, or ask it to move',
  'held.by-body': 'a Soul holds it',
  'entity.unknown': 'no such thing; `map` lists paths',
  'architecture.unreachable': 'a room has no way in; add a door (plan) or stairs',
  'architecture.headroom': 'a floor is too low; raise floorHeight',
  'constraint.unsatisfied': 'the constraint cannot hold (its ref is gone or impossible)',
  'undo.conflict': 'the world changed since; undo the later edit first or fix by hand',
};
export const explainFailure = (f) => `${f.code} (op ${f.op}): ${f.detail}${f.field ? ` — field ${f.field}` : ''}${f.fix ? ` — fix: ${f.fix}` : ''}${f.suggest?.p ? ` — suggest p ${JSON.stringify(f.suggest.p)}` : ''}${HINTS[f.code] ? ` [${HINTS[f.code]}]` : ''}`;

const parseKV = (list) => Object.fromEntries([].concat(list ?? []).map((kv) => { const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); return [k, /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v === 'true' ? true : v === 'false' ? false : /^[[{]/.test(v) ? JSON.parse(v) : v]; }));
const bakeCache = new Map();
/** The physical facts of a def at given params (box, rooms, slots), from the server's own generators. */
export async function bakeInfo(def, params, shape) {
  const key = JSON.stringify([def, params ?? {}, shape ?? null]);
  if (!bakeCache.has(key)) { const b = (await query({ bake: { def: normDef(def), params: params ?? {}, ...(shape ? { shape } : {}) } })).bake; if (b.error) { const word = String(def).replace(/^core[/-]/, '').replace(/@\d+$/, '').replace(/-/g, ' '); let near = []; if (/def\.unknown/.test(b.error)) try { near = (await defs(word, { json: true })).slice(0, 4).map((d) => d.ref); } catch { /* offline */ } throw new Error(`${b.error}${near.length ? ` — the library has: ${near.join(', ')}` : ''}. \`defs ${word}\` searches the library; define only what it lacks.`); } bakeCache.set(key, b); }
  return bakeCache.get(key);
}
const uniqueName = (v, parentId, stem, taken) => { const has = (n) => taken.has(`${parentId}/${n}`) || v.rows.some((r) => r.parent === parentId && r.name === n); if (!has(stem)) return stem; for (let k = 2; k < 9999; k++) if (!has(`${stem}-${k}`)) return `${stem}-${k}`; return `${stem}-${Date.now() % 1e5}`; };
const relFrom = (f) => ({
  at: f.at, offset: f.offset, near: f.near, around: f.around, dist: f.dist, dir: f.dir, count: f.count, facing: f.facing, yaw: f.yaw,
  against: f.against, between: f.between ? [].concat(f.between).flatMap((x) => String(x).split(/\s+|;/)).filter(Boolean).slice(0, 2) : undefined,
  along: f.along, t: f.t, side: f.side, setback: f.setback ?? (f.along ? f.offset : undefined), inside: f.inside, corner: f.corner, wall: f.wall, on: f.on,
  row: f.row, grid: f.grid, gap: f.gap, spacing: f.spacing, float: !!f.float, from: f.from, to: f.to, via: f.via, width: f.width, across: f.across, span: f.span,
});
const hasRelation = (f) => ['at', 'near', 'around', 'against', 'between', 'along', 'across', 'inside', 'on', 'free', 'from', 'row', 'grid'].some((k) => f[k] !== undefined);

/**
 * place <def> [relations] — the solver turns relations into a pose, dry-runs, walks to the next candidate
 * (or the server's suggestion, or a nudge) on overlap, then commits and says what it did.
 */
export async function place(defIn, flags = {}) {
  if (!defIn) throw new Error('usage: place <def> [--at …|--near …|--inside …|--on …|--along …|--against …|--between a b] [--facing …] [--name n] [--param k=v]');
  const def = normDef(defIn);
  const params = flags.param ? parseKV(flags.param) : undefined;
  let shape;
  if (flags.path) shape = { path: JSON.parse(flags.path), ...(flags.width ? { width: num(flags.width) } : {}) };
  if (flags.area) shape = { area: JSON.parse(flags.area) };
  if (flags.rect) shape = { area: rectArea(flags.rect) };
  if (flags.circle) shape = { area: circleArea(flags.circle) };
  const info = await bakeInfo(def, params, shape);
  if (info.form !== 'point' && !shape && !(info.form === 'path' && (flags.from || flags.between || flags.across))) throw new Error(`${def} is a ${info.form} def: give ${info.form === 'path' ? '--path \'[[x,z],…]\' [--width w] or --from <ref> --to <ref> [--via x,z]' : '--area \'[[x,z],…]\', --rect cx,cz,w,d or --circle cx,cz,r'}`);
  const m = await mirror(); const v = view(m);
  if (flags.free) {
    const near = flags.near ? refPoint(v, flags.near) : flags.at ? refPoint(v, flags.at) : { x: 0, z: 0 };
    const spots = (await query({ free: { size: [info.box[0] + 1, info.box[2] + 1], near: [near.x, near.z], radius: flags.radius ? num(flags.radius) : 200, count: Number(flags.count ?? 1) } })).free;
    if (!spots.length) throw new Error('no free flat dry plot found; try --radius or a smaller thing');
    flags = { ...flags, at: undefined, near: undefined };
    return commitItems(v, def, info, flags, params, spots.map((s) => ({ candidates: [{ p: s.at, ...(flags.facing ? {} : {}), note: `on a free plot ${s.dist} m from (${near.x}, ${near.z})` }] })), []);
  }
  if (shape) return commitItems(v, def, info, flags, params, [{ candidates: [{ shape, note: shape.path ? `path of ${shape.path.length} points` : `area of ${shape.area.length} corners` }] }], []);
  if (!hasRelation(flags) && flags.yaw === undefined && flags.facing === undefined) throw new Error('where? give --at x,z|ref, --near ref, --inside house/room, --on table, --along road, --against ref, --between a b, or --free');
  const sol = solve(v, { def, form: info.form, layer: info.layer, box: info.box, s: flags.scale ? num(flags.scale) : 1 }, relFrom(flags));
  return commitItems(v, def, info, flags, params, sol.items, sol.notes);
}
const PREPARED = new Set(['road/1', 'path/1', 'river/1', 'bridge/1', 'pier/1', 'deck/1']);
/** Roads, rivers, bridges, piers, decks freeze ground facts (grade, bridge spans, flow, deck height) into params
 *  before placement (L3's prepareFor, run on the server where the ground is). Returns { params, shape }. */
export async function prepareShape(def, info, shape, params) {
  if (!shape || !PREPARED.has(info.gen)) return { params, shape };
  const p = (await query({ prepare: { def: normDef(def), shape, params: params ?? {} } })).prepare;
  if (!p || p.error) return { params, shape };
  return { params: { ...(params ?? {}), ...(p.params ?? {}) }, shape: p.path ? { ...shape, path: p.path } : shape };
}
/** Build ops from solver items, dry-run, repair, commit. */
async function commitItems(v, def, info, flags, params, items, notes, { op = 'place', id, rowId } = {}) {
  if (!items.length) throw new Error('the solver found no placement');
  for (const it of items) for (const c of it.candidates) if (c.shape && PREPARED.has(info.gen)) { const pr = await prepareShape(def, info, c.shape, params); c.shape = pr.shape; c.params = pr.params; }
  const taken = new Set();
  if (op === 'place' && flags.name && items.length === 1) {
    const parentId = items[0].candidates[0]?.in ? v.get(items[0].candidates[0].in.parent)?.id ?? items[0].candidates[0].in.parent : 'world';
    const clash = v.rows.find((r) => r.parent === parentId && r.name === flags.name);
    if (clash) throw new Error(`REFUSED: name.taken: "${flags.name}" is already ${clash.path} [${clash.def.replace(/^core-/, 'core/')}]. Pick another --name, or move/remove that one.`);
  }
  const stem = flags.name ?? def.replace(/^core\//, '').replace(/@\d+$/, '').replace(/^core-/, '');
  const state = flags.state ? JSON.parse(flags.state) : undefined;
  const choice = items.map(() => 0), fixes = items.map(() => []);
  const mk = (k) => {
    const c = items[k].candidates[Math.min(choice[k], items[k].candidates.length - 1)];
    const o = { op, ...(op === 'place' ? { def } : { id }), mode: flags.nudge ? 'nudge' : 'strict' };
    if (c.p) o.p = c.p; if (c.r !== undefined) o.r = c.r; if (c.shape) o.shape = c.shape; if (c.in) o.in = c.in; if (c.anchor && op === 'place') o.anchor = c.anchor;
    if (flags.yaw !== undefined && c.r === undefined) o.r = num(flags.yaw);
    if (c.constraints?.length) o.constraints = c.constraints;
    if (op === 'place') {
      if (c.params ?? params) o.params = c.params ?? params; if (state) o.state = state; if (flags.scale) o.s = num(flags.scale);
      const parentId = c.in ? v.get(c.in.parent)?.id ?? c.in.parent : 'world';
      o.name = items.length > 1 || !flags.name ? uniqueName(v, parentId, items.length > 1 && flags.name ? `${stem}-${k + 1}` : stem, taken) : flags.name;
      taken.add(`${parentId}/${o.name}`);
    }
    return o;
  };
  let ops = items.map((_, k) => mk(k));
  let r;
  for (let attempt = 0; attempt < 12; attempt++) {
    r = await dryrun({ ops });
    if (r.accepted) break;
    const f = r.failures[0]; const k = f.op;
    if (k < 0 || k >= ops.length) break;
    if (f.code === 'overlap.solid') {
      if (choice[k] + 1 < items[k].candidates.length) { choice[k]++; ops[k] = mk(k); fixes[k].push(`blocked (${f.detail}) → next candidate`); continue; }
      if (f.suggest?.p && !ops[k]._suggested && !ops[k].in) { ops[k] = { ...ops[k], p: f.suggest.p, _suggested: true }; fixes[k].push(`blocked (${f.detail}) → the server's suggestion ${JSON.stringify(f.suggest.p)}`); continue; }
      if (ops[k].mode !== 'nudge') { ops[k] = { ...ops[k], mode: 'nudge' }; fixes[k].push(`blocked (${f.detail}) → nudge`); continue; }
    }
    if (f.code === 'name.taken' && op === 'place') { ops[k] = { ...ops[k], name: uniqueName(v, 'world', ops[k].name, new Set([...taken, `world/${ops[k].name}`])) }; continue; }
    break;
  }
  ops = ops.map(({ _suggested, ...o }) => o);
  if (!r.accepted) {
    const msg = `REFUSED: ${r.failures.map(explainFailure).join('; ')}`;
    if (flags.json) return { accepted: false, failures: r.failures, ops };
    return msg + (fixes.some((x) => x.length) ? `\n  tried: ${fixes.flat().join('; ')}` : '');
  }
  if (flags.dry || flags.plan) return flags.json ? { dry: true, ops, notes } : [`dry run OK (nothing built): ${ops.length} op(s)`, ...ops.map((o) => '  ' + JSON.stringify(o))].join('\n');
  const res = await act({ ops, ...(flags.group ? { group: flags.group } : {}) }, flags.note);
  if (!res.accepted) return `REFUSED at commit: ${res.failures.map(explainFailure).join('; ')}`;
  if (flags.json) return { ...res, ops };
  const m2 = await mirror(); const v2 = view(m2);
  const lines = [];
  for (let k = 0; k < ops.length; k++) {
    const o = ops[k]; const c = items[k].candidates[Math.min(choice[k], items[k].candidates.length - 1)];
    const placedIds = Object.keys(res.ids).filter((key) => res.ids[key] === key);
    const row = op === 'place' ? v2.byId.get(placedIds[k]) : v2.byId.get(rowId) ?? v2.get(id);
    const where = row ? (row.shape ? '' : ` at (${row.pose[0]}, ${row.pose[1]}, ${row.pose[2]}) ${yawWord(row.pose[3])}`) : '';
    lines.push(`${op === 'place' ? 'placed' : 'moved'} ${row?.path ?? o.name ?? id}${op === 'place' ? ` [${def}]` : ''}${where} — ${c?.note ?? ''}${fixes[k].length ? ` (${fixes[k].join('; ')})` : ''}${o.constraints?.length ? `; keeps: ${o.constraints.map((x) => x.kind + (x.ref ? ' ' + x.ref : '')).join(', ')}` : ''}`);
  }
  if (notes?.length) lines.push(...notes.map((n) => `  note: ${n}`));
  if (res.warnings?.length) lines.push(`  warnings: ${res.warnings.join('; ')}`);
  lines.push(`  seq ${res.seq}${load().group || flags.group ? `, group "${flags.group ?? load().group}"` : ''} — undo with: undo`);
  return lines.join('\n');
}
export const terrain = place;

/** move <ref> [relations] (or --by dx,dz, --yaw, --in parent[/slot]). Children ride along. A thing inside a house or
 *  on a table moves in the world frame like everything else; where it lands decides its parent (still on the
 *  table, the room the point is in, else the world root), and the answer says so. A set (a row's name) moves --by. */
export async function move(ref, flags = {}) {
  const m = await mirror(); const v = view(m);
  if (!ref) throw new Error('usage: move <ref> --at …|--near …|--by dx,dz|--yaw r|--facing …|--in parent[/slot]');
  const row = v.get(ref);
  if (!row) {
    const set = setOf(v, ref); if (!set) throw new Error(`no such thing: ${ref} (see: map)`);
    if (!flags.by && flags.yaw === undefined) throw new Error(`${ref} is a set of ${set.members.length} (${set.members.map((r) => r.name).join(', ')}): move it with --by dx,dz, or move one member by its own name`);
    const out = []; for (const r of set.members) out.push(await move(r.path, flags)); return out.join('\n');
  }
  const sub = new Set([row.id]); for (let grew = true; grew;) { grew = false; for (const r of v.rows) if (sub.has(r.parent) && !sub.has(r.id)) { sub.add(r.id); grew = true; } }
  const e = v.entity(row.id);
  // the op that puts a contained thing at a world point: same parent if it still fits there, else a new one
  const relocated = (wx, wz, wy, extra = []) => {
    const L = relocate(v, row, wx, wz, wy);
    const o = {}; let note = '';
    if (row.parent === 'world') { o.p = L.p; return { o, note }; }
    const parentPath = v.byId.get(row.parent)?.path;
    const changed = L.in && (L.in.parent !== parentPath || (L.in.slot ?? null) !== (row.slot ?? null));
    o.p = e.p?.length === 3 && !changed ? [L.p[0], e.p[1], L.p[1]] : L.p;
    if (changed) { o.in = L.in; o.r = L.r; note = L.note; }
    const kept = (e.constraints ?? []).filter((c) => c.kind !== 'inside' && !extra.some((x) => x.kind === c.kind));
    if (changed || extra.length) o.constraints = [...kept, ...extra.filter((c) => c.kind !== 'inside'), ...(L.room ? [{ kind: 'inside', ref: L.room }] : [])];
    return { o, note };
  };
  if (flags.by) {
    const [dx, dz] = dxdz(flags.by, '--by');
    const o = { op: 'move', id: row.path, mode: flags.nudge ? 'nudge' : 'strict' };
    let note = '';
    if (e.shape) o.shape = e.shape.area ? { area: e.shape.area.map(([x, z]) => [x + dx, z + dz]) } : { ...e.shape, path: e.shape.path.map(([x, z]) => [x + dx, z + dz]) };
    else { const R = relocated(row.pose[0] + dx, row.pose[2] + dz, row.pose[3]); Object.assign(o, R.o); note = R.note; }
    if (flags.yaw !== undefined) o.r = num(flags.yaw);
    const r = await act({ ops: [o] }, flags.note);
    if (!r.accepted) return `REFUSED: ${r.failures.map(explainFailure).join('; ')}`;
    const after = view(await mirror()).byId.get(row.id);
    return `moved ${row.path} by (${dx}, ${dz})${after && !after.shape ? ` to (${after.pose[0]}, ${after.pose[1]}, ${after.pose[2]})` : ''}${note ? ` — ${note}${after ? `; now ${after.path}` : ''}` : ''}`;
  }
  if (!hasRelation(flags) && flags.yaw === undefined && flags.facing === undefined && !flags.in) throw new Error('usage: move <ref> --at …|--near …|--by dx,dz|--yaw r|--facing …|--in parent[/slot]');
  if (flags.in && !hasRelation(flags)) {
    // --in world: out to the root where it stands; --in <host>[/slot] --local x,z: exactly there in the slot's frame
    if (flags.in === 'world' || flags.local) {
      const [parent, slot] = String(flags.in).split(/\/(?=[^/]+$)/); const host = flags.in === 'world' || v.get(flags.in) ? flags.in : parent;
      const o = { op: 'move', id: row.path, in: host === flags.in ? { parent: host } : { parent, ...(slot ? { slot } : {}) }, p: flags.local ? String(flags.local).split(',').map(Number) : [row.pose[0], row.pose[2]] };
      const r = await act({ ops: [o] }); if (!r.accepted) return `REFUSED: ${r.failures.map(explainFailure).join('; ')}`;
      const after = view(await mirror()).byId.get(row.id);
      return `moved ${row.path} into ${flags.in}${after ? ` — now ${after.path} at (${after.pose[0]}, ${after.pose[1]}, ${after.pose[2]})` : ''}`;
    }
    // otherwise the solver picks the spot: a room (--inside) or a slot to stand on (--on: a table top, a pier's end, a balcony)
    const T = slotTarget(v, flags.in); if (!T) throw new Error(`no such thing: ${flags.in}`);
    const rooms = (T.host.slots ?? []).some((x) => x.kind === 'room'), tops = (T.host.slots ?? []).some((x) => ['surface', 'shelf'].includes(x.kind));
    const intoRoom = T.slot ? T.slot.kind === 'room' : rooms && !tops;
    flags = { ...flags, in: undefined, [intoRoom ? 'inside' : 'on']: flags.in };
  }
  const info = { form: row.form, layer: row.layer, box: row.box };
  const rel = relFrom(flags);
  if (!hasRelation(flags)) rel.at = `${row.pose[0]},${row.pose[2]}`;
  const sol = solve(v, { def: row.def, ...info, s: row.pose[4] }, { ...rel, skip: [...sub] });
  // world-frame answers (near, at, along…) for a thing that lives inside something: into its parent's frame
  const items = sol.items.slice(0, 1).map((it) => ({ candidates: it.candidates.map((c) => {
    // into a slot: keep the thing's world heading unless the solver turned it
    if (c.in && c.r === undefined) { const h = v.get(c.in.parent); return h ? { ...c, r: r2(row.pose[3] - frameOf(h, c.in.slot).RY) } : c; }
    if (c.in || c.shape || row.parent === 'world') return c;
    const R = relocated(c.p[0], c.p[1], c.r ?? row.pose[3], c.constraints ?? []);
    return { ...c, ...R.o, ...(R.o.r === undefined && c.r !== undefined ? { r: r2(c.r - (frameOf(v.byId.get(row.parent), row.slot).RY)) } : {}), note: `${c.note}${R.note ? `; ${R.note}` : ''}` };
  }) }));
  return commitItems(v, row.def, info, { ...flags, name: undefined }, undefined, items, sol.notes, { op: 'move', id: row.path, rowId: row.id });
}
export async function set(id, flags) { const op = { op: 'set', id }; if (flags.state) op.state = JSON.parse(flags.state); if (flags.param) op.params = parseKV(flags.param); if (flags.name) op.name = flags.name; if (flags.constraints) op.constraints = JSON.parse(flags.constraints); const r = await act({ ops: [op] }, flags.note); return r.accepted ? `set ${id}: ${Object.keys(op).filter((k) => !['op', 'id'].includes(k)).map((k) => `${k} ${JSON.stringify(op[k])}`).join(', ')}` : `REFUSED: ${r.failures.map(explainFailure).join('; ')}`; }
/** The op that recolours one thing: its `paint` state, else its `color` param, else its main colour param (the first
 *  colour-typed param: a dog's fur, a lamp's iron) or the one named with --part. */
function recolorOp(d, id, color, part) {
  const colorParams = Object.entries(d?.params ?? {}).filter(([, f]) => f?.type === 'color').map(([k]) => k);
  if (part) { if (!colorParams.includes(part)) throw new Error(`${id} has no colour part ${part}; parts: ${colorParams.join(', ') || 'none'}`); return { op: 'set', id, params: { [part]: color } }; }
  if (d?.state?.paint) return { op: 'set', id, state: { paint: color } };
  const k = colorParams.includes('color') ? 'color' : colorParams[0];
  return k ? { op: 'set', id, params: { [k]: color } } : null;
}
export async function recolor(id, color, flags = {}) {
  if (!id || !color) throw new Error('usage: recolor <ref> <#hex> [--part fur]');
  const v = view(await mirror()), row = v.get(id);
  if (!row && setOf(v, id)) { const out = []; for (const r of setOf(v, id).members) out.push(await recolor(r.path, color, flags)); return out.join('\n'); }
  if (!row) throw new Error(`no such thing: ${id}`);
  const op = recolorOp(v.def(row.def), row.path, color, flags.part);
  if (!op) return `${id} has no colour to change (no paint state, no colour params)`;
  const r = await act({ ops: [op] });
  return r.accepted ? `recoloured ${id} ${color}${op.params ? ` (${Object.keys(op.params)[0]})` : ''}` : `REFUSED: ${r.failures.map(explainFailure).join('; ')}`;
}
export async function remove(ids) { const v0 = view(await mirror()); const list = [].concat(ids).filter(Boolean).flatMap((id) => (v0.get(id) ? [id] : setOf(v0, id)?.members.map((r) => r.path) ?? [id])); if (!list.length) throw new Error('usage: remove <ref> [<ref>…]'); const r = await act({ ops: list.map((id) => ({ op: 'remove', id })) }); return r.accepted ? `removed ${list.join(', ')} (and what was inside)` : `REFUSED: ${r.failures.map(explainFailure).join('; ')}`; }
export async function clone(id, flags) { const o = { op: 'clone', id, ...(flags.name ? { name: flags.name } : {}), ...(flags.count ? { count: num(flags.count) } : {}), ...(flags.step ? { step: String(flags.step).split(',').map(Number) } : {}), ...(flags.yaw !== undefined ? { r: num(flags.yaw) } : {}), mode: flags.nudge ? 'nudge' : 'strict' }; if (flags.at) { const v = view(await mirror()); const p = refPoint(v, flags.at, flags.offset); o.p = [p.x, p.z]; } const r = await act({ ops: [o] }, flags.note); return r.accepted ? `cloned ${id}${o.count > 1 ? ` ×${o.count}` : ''} (seq ${r.seq})` : `REFUSED: ${r.failures.map(explainFailure).join('; ')}`; }
/** The sky palettes the viewer draws (apps/web; the server refuses others once L7 patch S2 lands). */
export const SKY_PALETTES = PALETTE_LIST;
async function worldState() { return (await snapshot()).state ?? {}; }
const skyText = (st) => `sky ${st.sky?.palette ?? 'clear-day'}, sun ${st.sky?.sun ?? 0.6}; weather clouds ${st.weather?.clouds ?? 0}, wind ${st.weather?.wind ?? 0}, rain ${st.weather?.rain ?? 0}`;
/** sky [--palette p] [--sun 0…1]: no flags = show the sky and the palettes. Weather is kept. */
export async function sky(flags = {}) {
  const st = await worldState();
  if (flags.palette === undefined && flags.sun === undefined) return `${skyText(st)}\npalettes: ${SKY_PALETTES.map((p) => p.id).join(', ')}\n${SKY_PALETTES.map((p) => `  ${p.id}: ${p.doc}`).join('\n')}\nset with: sky --palette <name> [--sun 0…1]`;
  const palette = flags.palette ?? st.sky?.palette ?? 'clear-day';
  if (!SKY_PALETTES.some((p) => p.id === palette)) throw new Error(`unknown sky palette "${palette}"; palettes: ${SKY_PALETTES.map((p) => p.id).join(', ')}`);
  const sun = flags.sun !== undefined ? num(flags.sun) : st.sky?.sun ?? 0.6;
  if (!(sun >= 0 && sun <= 1)) throw new Error('--sun is 0…1 (0 = night, 1 = noon)');
  const r = await act({ ops: [{ op: 'world', state: { sky: { ...(st.sky ?? {}), palette, sun }, ...(st.weather ? { weather: st.weather } : {}) } }] });
  return r.accepted ? `${skyText({ ...st, sky: { palette, sun } })} (seq ${r.seq})` : `REFUSED: ${r.failures.map(explainFailure).join('; ')}`;
}
export async function constitution(text) { return act({ ops: [{ op: 'world', state: { constitution: text } }] }); }
export async function expand(extent) { return act({ ops: [{ op: 'expand', extent: num(extent) }] }); }

// ---------------------------------------------------------------- groups, undo, history
/** group <name>: label every following edit (until `group --off`); `undo --group <name>` reverts them all. */
export async function group(name, flags = {}) { if (flags.off || name === 'off' || name === '-') { save({ group: undefined }); return 'no current group'; } if (!name) return load().group ? `current group: ${load().group}` : 'no current group'; save({ group: String(name).slice(0, 60) }); return `current group: ${name} (every edit until \`group --off\`; undo it all with \`undo --group ${name}\`)`; }
export async function undo(flags = {}) {
  const g = flags.group === true ? load().group : flags.group;
  const r = ok(await call(`/v1/god/undo${g ? `?group=${encodeURIComponent(g)}` : ''}`, { method: 'POST' }), 'undo'); invalidate();
  if (g) {
    if (r.accepted && !r.failures?.length && !r.notReverted?.length) return `undid group "${g}": edits ${r.reverted.join(', ')}`;
    return `group "${g}" undo incomplete; undone edits: ${r.reverted?.join(', ') || 'none'}; not undone edits: ${r.notReverted?.join(', ') || (r.failed !== undefined ? r.failed : 'unknown (server did not list them)')}\n${r.failures?.map(explainFailure).join('; ') || 'Undo did not complete.'}`;
  }
  return r.accepted ? `undid edit ${r.reverted}` : `nothing undone: ${r.failures?.map(explainFailure).join('; ')}`;
}
export async function redo() { const r = ok(await call('/v1/god/redo', { method: 'POST' }), 'redo'); invalidate(); return r.accepted ? `redid edit ${r.reverted}` : `nothing to redo: ${r.failures?.map(explainFailure).join('; ')}`; }
export async function history(n = 20, flags = {}) {
  const r = ok(await call(`/v1/god/edits?limit=${n}`), 'history');
  if (flags.json) return r.edits;
  return r.edits.map((e) => `${e.seq}. ${e.kind}${e.undone ? ' (undone)' : ''}${e.grp ? ` [${e.grp}]` : ''} ${e.note ?? ''} — ${summarizeOps(e.ops)}`).join('\n') || 'no edits yet';
}
const summarizeOps = (ops = []) => { const c = {}; for (const o of ops) { const k = o.op === 'place' ? `place ${String(o.def).replace(/^core\//, '').replace(/@\d+$/, '')}` : o.op; c[k] = (c[k] ?? 0) + 1; } return Object.entries(c).map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join(', '); };
export async function resolveCmd(refs, flags = {}) {
  const r = (await query({ resolve: refs.length ? refs : true })).resolve;
  if (flags.json) return r;
  return r.violated.length ? [`${r.violated.length} constraint(s) violated of ${r.checked} constrained things:`, ...r.violated.map((x) => `- ${x.path}: ${x.kind} — ${x.why}`), 'Fix: move the thing (the solver re-solves), or `set <ref> --constraints []` to drop a relation.'].join('\n') : `all constraints hold (${r.checked} constrained things)`;
}

// ---------------------------------------------------------------- select + bulk
/** select [--def d] [--tag t] [--name glob] [--in ref] [--area x0,z0,x1,z1] [--near ref --radius r] [--all] then optionally --remove | --by dx,dz | --set-state json | --set-param k=v | --recolor #hex | --yaw r */
export async function select(flags = {}) {
  const v = view(await mirror());
  const rows = selectRows(v, flags);
  const bulk = flags.remove || flags.by || flags['set-state'] || flags['set-param'] || flags.recolor || flags.yaw !== undefined;
  if (!bulk) return flags.json ? rows : rows.length ? [`${rows.length} selected:`, ...rows.slice(0, 200).map((r) => `- ${r.path} [${r.def.replace(/^core-/, 'core/')}] at (${r.pose[0]}, ${r.pose[2]})`)].join('\n') : 'nothing matches';
  if (!rows.length) return 'nothing matches; nothing changed';
  const ops = [];
  for (const r of rows) {
    if (flags.remove) { if (!rows.some((o) => o.id === r.parent)) ops.push({ op: 'remove', id: r.path }); continue; }
    const e = v.entity(r.id);
    if (flags.by || flags.yaw !== undefined) {
      const o = { op: 'move', id: r.path, mode: 'nudge' };
      if (flags.by) { const [dx, dz] = String(flags.by).split(',').map(Number); if (e.shape) o.shape = e.shape.area ? { area: e.shape.area.map(([x, z]) => [x + dx, z + dz]) } : { ...e.shape, path: e.shape.path.map(([x, z]) => [x + dx, z + dz]) }; else o.p = r.parent === 'world' ? [e.p[0] + dx, e.p[e.p.length - 1] + dz] : e.p.length === 3 ? [e.p[0] + dx, e.p[1], e.p[2] + dz] : [e.p[0] + dx, e.p[1] + dz]; }
      if (flags.yaw !== undefined) o.r = num(flags.yaw);
      if (rows.some((x) => x.id === r.parent)) continue;   // children ride with a selected parent
      ops.push(o);
    }
    if (flags['set-state']) ops.push({ op: 'set', id: r.path, state: JSON.parse(flags['set-state']) });
    if (flags.recolor) { const o = recolorOp(v.def(r.def), r.path, flags.recolor, flags.part); if (o) ops.push(o); }
    if (flags['set-param']) ops.push({ op: 'set', id: r.path, params: parseKV(flags['set-param']) });
  }
  if (!ops.length) return `${rows.length} selected, but none of them has that to change (recolor needs a paint state or a colour param)`;
  const res = await act({ ops: ops.slice(0, 256) }, flags.note ?? `bulk ${flags.remove ? 'remove' : 'edit'} of ${rows.length}`);
  return res.accepted ? `${flags.remove ? 'removed' : 'changed'} ${ops.length} thing(s) in one batch (seq ${res.seq})${ops.length > 256 ? ' — first 256 only; run again' : ''}` : `REFUSED: ${res.failures.map(explainFailure).join('; ')}`;
}

// ---------------------------------------------------------------- look
/** look [--at ref|x,z] [--from n|e|s|w|ne…|above] [--dist m] [--inside] [--out file]: a screenshot to read. */
export async function look(flags = {}) {
  if (flags.stop) return stopKeeper();
  const m = await mirror(); const v = view(m);
  let target, span;
  if (flags.at) {
    const p = refPoint(v, flags.at);
    if (p.kind === 'entity') { const [x0, z0, x1, z1] = p.row.aabb; target = [p.x, p.row.y?.[0] ?? p.row.pose[1], p.z]; span = Math.max(x1 - x0, z1 - z0, 4); }
    else { target = [p.x, 0, p.z]; span = flags.span ? num(flags.span) : 40; }
  } else {
    const roots = v.rows.filter((r) => r.parent === 'world' && !isFlagDef(v.def(r.def)?.ref ?? r.def) && !(r.shape && r.aabb[2] - r.aabb[0] > m.extent * 0.6));
    if (!roots.length) { target = [0, 0, 0]; span = 160; }
    else { const x0 = Math.min(...roots.map((r) => r.aabb[0])), z0 = Math.min(...roots.map((r) => r.aabb[1])), x1 = Math.max(...roots.map((r) => r.aabb[2])), z1 = Math.max(...roots.map((r) => r.aabb[3])); target = [(x0 + x1) / 2, 0, (z0 + z1) / 2]; span = Math.max(30, x1 - x0, z1 - z0); }
  }
  if (target[1] === 0 || flags.at === undefined || !Number.isFinite(target[1])) { const g = (await query({ points: [[target[0], target[2]]] })).points[0]; target[1] = Math.max(g.y, g.y + (g.water > 0 ? g.water : 0)); }
  if (flags.span) span = num(flags.span);
  const cam = camera({ target, span, from: flags.from ?? 's', dist: flags.dist ? num(flags.dist) : undefined, inside: !!flags.inside, height: flags.height ? num(flags.height) : undefined });
  const out = resolve(flags.out ?? `looks/look-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`);
  const args = { worldUrl: load().world, eye: cam.eye, at: cam.at, out, hideRoofs: !!(flags.inside || flags['hide-roofs'] || flags.floor !== undefined), cut: flags.floor !== undefined ? num(flags.floor) : null, span: flags.inside ? 0 : span, expect: m.snapshot.entities.length, cliPath: SELF, keep: !!flags.keep, ...(flags.width ? { width: num(flags.width) } : {}), ...(flags.h ? { height: num(flags.h) } : {}) };
  let shot;
  if (!flags.keep) shot = await shoot(args);
  else {
    // a kept browser: the shot runs in a child process so its browser connection does not keep this one alive
    const child = spawnSync(process.execPath, [SELF, 'look-shot', JSON.stringify(args)], { encoding: 'utf8', cwd: process.cwd(), env: process.env, maxBuffer: 1 << 24 });
    if (child.status !== 0) throw new Error(`look failed: ${(child.stderr || child.stdout || '').trim().slice(0, 500)}`);
    shot = JSON.parse(child.stdout.trim().split('\n').pop());
  }
  if (flags.json) return { ...shot, eye: cam.eye, at: cam.at };
  return `look: ${shot.file}\n  from the ${cam.from} at (${(shot.frames?.eye ?? cam.eye).join(', ')}) toward (${cam.at.join(', ')}), ${Math.round(shot.ms / 100) / 10} s${shot.state && !shot.state.ready ? ` (not fully settled: ${JSON.stringify(shot.state)})` : ''}\n  Read the image file; then fix what looks wrong.`;
}

// ---------------------------------------------------------------- export / import / define
/** export [file]: the world as a genesis/1 template (defines + places in dependency order). */
export async function exportWorld(file, flags = {}) {
  const s = await snapshot();
  const g = exportGenesis(s, flags);
  const out = resolve(file ?? `${s.worldId}.genesis.json`);
  writeFileSync(out, JSON.stringify(g, null, 1));
  const ops = g.batches.flatMap((b) => b.ops), things = ops.filter((op) => op.op === 'place').length, defs = ops.filter((op) => op.op === 'define').length;
  return `exported ${things} things${defs ? ` and ${defs} defs` : ''} in ${g.batches.length} batches to ${out}`;
}
const pathOf = (byId, e) => { const parts = []; for (let c = e; c; c = byId.get(c.in.parent)) parts.unshift(c.name ?? c.id); return parts.join('/'); };
/** import <genesis.json>: apply a template's batches to this world, each atomic (group "import" unless the batch says). */
export async function importWorld(file, flags = {}) {
  const g = JSON.parse(readFileSync(file, 'utf8'));
  if (g.schema !== 'genesis/1') throw new Error('import: file must be genesis/1');
  const out = [];
  const s = await snapshot();
  if (g.constants?.extent && g.constants.extent > s.constants.extent) { await expand(g.constants.extent); out.push(`expanded to ${g.constants.extent} m`); }
  if (g.state) { const r = await act({ ops: [{ op: 'world', state: g.state }] }, 'import: state'); out.push(r.accepted ? 'world state set' : `state refused: ${r.failures.map(explainFailure).join('; ')}`); }
  for (const [i, b] of g.batches.entries()) {
    const r = await act({ ops: b.ops, group: b.group ?? flags.group ?? 'import' }, `import ${i + 1}/${g.batches.length}${b.note ? ': ' + b.note : ''}`);
    out.push(r.accepted ? `batch ${i + 1} (${b.note ?? ''}): ${b.ops.length} ops` : `batch ${i + 1} REFUSED: ${r.failures.map(explainFailure).join('; ')}`);
    if (!r.accepted) break;
  }
  return out.join('\n');
}
export async function define(json) {
  const def = typeof json === 'string' ? JSON.parse(existsSync(json) ? readFileSync(json, 'utf8') : json) : json;
  // a generator-made def exposes the generator's params (ranges, defaults) unless it declares its own
  if (def.make?.kind === 'gen' && !def.params) { const g = (await schema()).generators?.find((x) => x.id === def.make.gen); if (g && Object.keys(g.params).length) def.params = g.params; }
  const r = await act({ ops: [{ op: 'define', def: { schema: 'def/1', ...def } }] }, `define ${def.name}`); return r.accepted ? `defined ${def.name}@${def.version ?? 1} — place it with: place ${def.name}@${def.version ?? 1} --at …` : `REFUSED: ${r.failures.map(explainFailure).join('; ')}`; }
/** define-kit <json|file>: a kit/2 prop or creature from rounded primitives. {name, shapes:[{kind, at, size|r|h, color, role…}], tags?, gait?, layer?, slots?, components?, description?} */
export async function defineKit(json, flags = {}) {
  const k = typeof json === 'string' ? JSON.parse(existsSync(json) ? readFileSync(json, 'utf8') : json) : json;
  if (!k.name || !Array.isArray(k.shapes)) throw new Error('define-kit needs {name, shapes:[…]} (see SKILL.md, kit primitives in SCHEMA.md)');
  // search before define: say what already exists
  const similar = ok(await call(`/v1/god/defs?q=${encodeURIComponent(k.name.replace(/[-_.]/g, ' '))}`), 'defs').defs.slice(0, 5).map((d) => d.ref.replace(/^core-/, 'core/'));
  const ext = (sh) => { const [x, y, z] = sh.at; const sz = sh.size ?? [2 * (sh.r ?? 0.5), sh.h ?? 2 * (sh.r ?? 0.5), 2 * (sh.r ?? 0.5)]; return [x - sz[0] / 2, y - (sh.kind === 'box' || sh.kind === 'rbox' || sh.kind === 'sphere' || sh.kind === 'capsule' ? sz[1] / 2 : 0), z - sz[2] / 2, x + sz[0] / 2, y + sz[1], z + sz[2] / 2]; };
  const e = k.shapes.map(ext);
  const box = k.box ?? [Math.max(...e.map((b) => b[3])) - Math.min(...e.map((b) => b[0])), Math.max(...e.map((b) => b[4])), Math.max(...e.map((b) => b[5])) - Math.min(...e.map((b) => b[2]))].map((v) => Math.max(0.05, r2(v)));
  const def = { schema: 'def/1', name: k.name, version: k.version ?? 1, description: k.description ?? '', tags: k.tags ?? [], form: 'point', layer: k.layer ?? 'solid', make: { kind: 'gen', gen: 'kit/2', args: { shapes: k.shapes, ...(k.gait ? { gait: k.gait } : {}), ...(k.slots ? { slots: k.slots } : {}), ...(k.round !== undefined ? { round: k.round } : {}) } }, size: { box, scale: k.scale ?? [0.5, 2] }, ...(k.components ? { components: k.components } : {}), ...(k.anchor ? { anchor: k.anchor } : {}), ...(k.state ? { state: k.state } : {}), ...(k.params ? { params: k.params } : {}) };
  if (flags.dry) return { def, similar };
  const r = await define(def);
  return `${r}${similar.length ? `\n  (similar defs already in the library: ${similar.join(', ')} — prefer them when they fit)` : ''}`;
}

// ---------------------------------------------------------------- furnish / gallery (other lanes' libs)
/** furnish <house>[/room] [--style townhouse] [--dry]: L2's recipes, run on the server (where the model and the
 *  recipe files are), dry-run, then one batch the audience sees arrive. */
export async function furnish(ref, flags = {}) {
  if (!ref) throw new Error('usage: furnish <house>[/room] [--style cottage|townhouse|shop|…] [--dry]');
  const v = view(await mirror());
  const [houseRef, room] = v.get(ref) ? [ref, undefined] : String(ref).split(/\/(?=[^/]+$)/);
  const host = v.get(houseRef); if (!host) throw new Error(`no such building: ${ref}`);
  const rooms = room ? (host.slots ?? []).filter((x) => x.kind === 'room').map((x) => x.id).filter((id) => id === room || id.replace(/[^a-z]/g, '').startsWith(room.replace(/[^a-z]/g, ''))) : undefined;
  if (room && !rooms.length) throw new Error(`${host.path} has no room ${room}; rooms: ${(host.slots ?? []).filter((x) => x.kind === 'room').map((x) => x.id).join(', ')}`);
  const f = (await query({ furnish: { ref: host.path, ...(flags.style ? { style: flags.style } : {}), ...(rooms ? { rooms } : {}) } })).furnish;
  if (!f || f.error) throw new Error(f?.error ?? 'furnish is not available on this server; place furniture with --inside <house>/<room> [--corner|--wall]');
  const lines = [...(f.notes ?? []).map((n) => `  note: ${n}`), ...(f.dropped ?? []).slice(0, 8).map((d) => `  dropped: ${typeof d === 'string' ? d : `${d.name ?? d.def} (${d.why ?? d.reason ?? ''})`}`)];
  if (!f.ops?.length) return [`nothing to furnish in ${ref}`, ...lines].join('\n');
  if (flags.dry) return [`would furnish ${ref}: ${summarizeOps(f.ops)}`, ...lines].join('\n');
  const r = await act({ ops: f.ops, ...(flags.group ? { group: flags.group } : {}) }, `furnish ${ref}`);
  return r.accepted ? [`furnished ${ref}: ${summarizeOps(f.ops)} (seq ${r.seq})`, ...lines].join('\n') : `REFUSED: ${r.failures.map(explainFailure).join('; ')}`;
}
export const EXAMPLES = { hamlet: 'a hamlet in 8 commands: knoll, cottage, pond + bench, trees, well + lamps, a dog', 'two-floor-house': 'a townhouse furnished, an upstairs bedroom by hand, look --inside --floor 1', 'river-bridge': 'a lake, a river to the south edge, roads that bridge it', 'market-square': 'a plaza, a row of stalls, benches, lamps, a fountain', 'forest-edge': 'a woodland, a meadow, a track along the edge, deer', 'hillside-village': 'a hill, a road up it, cottages along it, a chapel, door paths' };
/** examples [name]: the worked examples served by the world (the exact commands and their answers). */
export async function examples(name) {
  if (!name) return ['worked examples (each = the exact commands a god agent typed and the answers it got):', ...Object.entries(EXAMPLES).map(([k, d]) => `- ${k}: ${d}`), `read one: examples <name>  (saves examples/<name>.log and .mjs here; also served at ${load().world}/god/examples/<name>.log)`].join('\n');
  if (!EXAMPLES[name]) throw new Error(`no example ${name}; examples: ${Object.keys(EXAMPLES).join(', ')}`);
  mkdirSync('examples', { recursive: true });
  const out = [];
  for (const ext of ['log', 'mjs']) { const r = await fetch(`${load().world}/god/examples/${name}.${ext}`); if (!r.ok) throw new Error(`the world did not serve ${name}.${ext} (${r.status})`); const t = await r.text(); writeFileSync(`examples/${name}.${ext}`, t); if (ext === 'log') out.push(t); }
  return `${out[0].trim()}\n(saved examples/${name}.log and examples/${name}.mjs)`;
}
export async function gallery() { return 'gallery: run `node tools/god-skill/scripts/gallery.mjs <world-url>` from the sim repo (it places every core def in a labelled grid and screenshots it).'; }

// ---------------------------------------------------------------- flags, prayers, stream
export async function flags() { const v = view(await mirror()); return v.rows.filter((r) => isFlagDef(v.def(r.def)?.ref ?? r.def)).map((r) => ({ name: `flag:${r.name}`, label: v.entity(r.id)?.state?.label ?? '', at: [r.pose[0], r.pose[2]] })); }
export async function flag(label, f) { const v = view(await mirror()); const p = refPoint(v, f.at ?? '0,0', f.offset); const name = label.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'flag'; const r = await act({ ops: [{ op: 'place', def: 'core/flag@1', name, p: [p.x, p.z], state: { label } }] }); return r.accepted ? `flag:${name} at (${p.x}, ${p.z})` : `REFUSED: ${r.failures.map(explainFailure).join('; ')}`; }
/** prayers [--all]: the prayers waiting for an answer (an answered prayer leaves this list); --all also the answered ones, with their answers. */
export async function prayers(flags = {}) { return ok(await call(`/v1/god/prayers${flags.all ? '?all=1' : ''}`), 'prayers'); }
export async function answer(prayer, text) { return act({ ops: [{ op: 'answer', prayer, text }] }); }
export async function stream(seconds = 60) { return follow(seconds, (e) => console.log(JSON.stringify(e))); }
export async function status() { const s = load(); const st = ok(await call('/v1/god/status'), 'status'); const v = st.versions; return `${s.world} — you are ${st.you}; ${st.entities} entities, seq ${st.seq}${s.group ? `; group "${s.group}"` : ''}; skill ${SKILL_VERSION}${v ? `; server protocol ${v.protocol}, schema ${v.schema}, skill ${v.skill}, source ${v.source}` : ''}`; }

// ---------------------------------------------------------------- cli
/** Flags that never take a value (the next word stays a positional argument). */
const BOOL = new Set(['float', 'dry', 'plan', 'nudge', 'json', 'all', 'keep', 'hide-roofs', 'stop', 'off', 'md', 'fresh', 'remove', 'free', 'list', ...ENV_BOOLS, ...LAYERS_BOOLS]);
const boolsFor = (cmd) => (cmd === 'look' ? new Set([...BOOL, 'inside']) : BOOL);
export function parseFlags(argv, bools = BOOL) {
  const flags = {}, rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--') && a.length > 2) {
      const eq = a.indexOf('=');
      const k = eq > 0 ? a.slice(2, eq) : a.slice(2);
      let v;
      if (eq > 0) v = a.slice(eq + 1);
      else if (k === 'between') { v = [argv[++i], argv[++i]]; }
      else if (bools.has(k)) v = true;
      else v = argv[i + 1] !== undefined && !(argv[i + 1].startsWith('--') && argv[i + 1].length > 2) ? argv[++i] : true;
      if (flags[k] !== undefined && k !== 'between') flags[k] = [].concat(flags[k], v); else flags[k] = v;
    } else rest.push(a);
  }
  return { flags, rest };
}
// What each command accepts: anything else is refused, never silently ignored.
const REL = 'at offset near around dist dir count facing yaw against between along t side setback inside corner wall on row grid gap spacing float from to via width across span free radius';
const FLAGS = {
  'verify-use': 'seat from uses',
  place: `${REL} path area rect circle name param state scale dry plan nudge group note`, terrain: `${REL} path area rect circle name param state scale dry plan nudge group note`,
  move: `${REL} by in local nudge note dry plan`, look: 'at from dist inside floor keep out span height width h hide-roofs stop', defs: 'tag all', where: 'at offset', free: 'near radius count slope',
  select: 'def tag name in area near radius all remove by set-state set-param recolor yaw part note', set: 'state param name constraints note', recolor: 'part', clone: 'name count step yaw at offset nudge note',
  sky: 'palette sun list', ...ENV_FLAGS, group: 'off', undo: 'group', map: 'all', furnish: 'style dry group', 'define-kit': 'dry', register: 'identity', mirror: 'fresh', export: 'name', import: 'group', flag: 'at offset', schema: 'md', act: 'note', prayers: 'all',
  catalog: 'category has tag page per', find: 'category has tag all', recommend: 'per', taxonomy: '',
  ...LAYERS_FLAGS,
};
// how many positional words each command takes (Infinity: free text or a list)
const POS = { 'verify-use': 1, ...LAYERS_POS, catalog: 0, taxonomy: 0, time: 2, strike: 0, land: 3, place: 1, terrain: 1, move: 1, set: 1, recolor: 2, clone: 1, describe: 1, where: 1, free: 1, look: 0, sky: 0, weather: 0, select: 0, group: 1, undo: 0, redo: 0, history: 1, map: 0, furnish: 1, mint: 1, pair: 1, register: 2, status: 0, flags: 0, prayers: 0, schema: 0, snapshot: 0, examples: 1, expand: 1, import: 1, export: 1, define: 1, 'define-kit': 1, act: 1, dryrun: 1, plan: 1, preview: 1, commit: 1, request: 1, query: 1, stream: 1, follow: 1, mirror: 0, gallery: 0, help: 1 };
const NUMERIC = new Set(['dist', 'count', 't', 'setback', 'row', 'spacing', 'width', 'span', 'radius', 'sun', 'clouds', 'wind', 'rain', 'fog', 'intensity', 'speed', 'amount', 'level', 'depth', 'metres', 'peak', 'edge', 'face', 'steps', 'side', 'scale', 'floor', 'height', 'h', 'slope', 'gap', 'yaw']);
/** Refuse what the CLI cannot read: unknown options, missing values, extra words, non-numbers. */
export function checkArgs(cmd, f, rest) {
  const allowed = new Set(['json', ...(FLAGS[cmd] ?? '').split(/\s+/).filter(Boolean)]);
  for (const [k, v] of Object.entries(f)) {
    if (/\s/.test(k)) throw new Error(`cannot read "--${k}…": several options arrived as ONE argument (a quoted string or an unsplit shell variable). Give each option separately, e.g. --param floors=1 --param w=8`);
    if (!allowed.has(k)) throw new Error(`${cmd} has no option --${k}. Its options: ${[...allowed].map((x) => '--' + x).join(' ')}`);
    for (const x of [].concat(v)) {
      if (x === true && !BOOL.has(k) && !(cmd === 'look' && k === 'inside') && !(cmd === 'undo' && k === 'group') && !(k === 'free')) throw new Error(`--${k} needs a value`);
      if (NUMERIC.has(k) && x !== true && !Number.isFinite(Number(x))) throw new Error(`--${k} takes a number, got "${x}"`);
      if (k === 'param' && (typeof x !== 'string' || !/^[A-Za-z][\w-]*=/.test(x))) throw new Error(`--param takes key=value (one per --param), got "${x}"`);
      if ((k === 'by' || k === 'step') && cmd !== 'land' && !/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(String(x))) throw new Error(`--${k} takes dx,dz (e.g. --${k} 1.5,-2), got "${x}"`);
      if (k === 'grid' && !/^\d+[x×]\d+$/.test(String(x))) throw new Error(`--grid takes WxH (e.g. 3x2), got "${x}"`);
    }
  }
  const max = POS[cmd] ?? Infinity;
  if (rest.length > max) throw new Error(`${cmd} takes ${max === 0 ? 'no words' : max === 1 ? 'one word' : `${max} words`} before its options; cannot read: ${rest.slice(max).map((x) => JSON.stringify(x)).join(' ')}${rest.slice(max).some((x) => /^-\w/.test(x)) ? ' (options start with two dashes)' : ''}`);
}
const readArg = (r) => (r[0] !== undefined ? (existsSync(r[0]) && !r[0].trim().startsWith('{') ? readFileSync(r[0], 'utf8') : r[0]) : readFileSync(0, 'utf8'));
export const COMMANDS = {
  'verify-use': (r, f) => verifyUse(r[0], f),
  register: (r, f) => register(r[0], r[1] ?? f.identity), pair: (r) => pair(r[0]), mint: (r) => mint(r[0]), status,
  map: (r, f) => map({ json: !!f.json, all: !!f.all }), defs: (r, f) => defs(r.join(' ') || undefined, f), schema: (r, f) => schema(f), snapshot,
  describe: (r, f) => describe(r[0], f), where: (r, f) => where(r[0] ?? f.at, f), query: (r) => query(readArg(r)), free: (r, f) => freePlots(r[0], f),
  place: (r, f) => place(r[0], f), terrain: (r, f) => place(r[0], f), move: (r, f) => move(r[0], f), set: (r, f) => set(r[0], f), recolor: (r, f) => recolor(r[0], r[1], f), remove: (r) => remove(r), clone: (r, f) => clone(r[0], f),
  act: (r, f) => act(JSON.parse(readArg(r)), f.note), dryrun: (r) => dryrun(JSON.parse(readArg(r))), plan: (r) => planBatch(readArg(r)), preview: (r) => preview(readArg(r)), commit: (r) => commit(r[0]), request: (r) => request(r[0]),
  select: (r, f) => select(f), group: (r, f) => group(r[0], f), undo: (r, f) => undo(f), redo, history: (r, f) => history(r[0] ? Number(r[0]) : 20, f), resolve: (r, f) => resolveCmd(r, f),
  look: (r, f) => look(f), 'look-keeper': (r) => keeper(r[0], Number(r[1])), 'look-shot': async (r) => { const res = await shoot(JSON.parse(r[0])); console.log(JSON.stringify(res)); process.exit(0); }, export: (r, f) => exportWorld(r[0], f), import: (r, f) => importWorld(r[0], f), define: (r) => define(readArg(r)), 'define-kit': (r, f) => defineKit(readArg(r), f),
  furnish: (r, f) => furnish(r[0], f), gallery, examples: (r) => examples(r[0]),
  catalog: (r, f) => catalog(f), find: (r, f) => find(r.join(' ') || undefined, f), recommend: (r, f) => recommend(r.join(' '), f), taxonomy: (r, f) => taxonomy(f),
  sky: (r, f) => sky(f), weather: (r, f) => envWeather(f), time: (r, f) => envTime(r, f), strike: (r, f) => envStrike(f), land: (r, f) => envLand(r, f), constitution: (r) => constitution(r.join(' ')), expand: (r) => expand(r[0]),
  flags, flag: (r, f) => flag(r.join(' '), f), prayers: (r, f) => prayers(f), answer: (r) => answer(r[0], r.slice(1).join(' ')), stream: (r) => stream(r[0] ? Number(r[0]) : 60),
  follow: (r) => follow(r[0] ? Number(r[0]) : 3600, (e) => console.log(`${e.event} ${e.data?.seq ?? ''}`)), mirror: async (r, f) => { const m = await mirror({ fresh: !!f.fresh }); return `mirror: seq ${m.seq}, ${m.rows.length} entities${m.offline ? ' (offline)' : ''}`; },
  hours: (r, f) => hours(r[0], f), own: (r, f) => own(r[0], r[1], f), access: (r) => access(r[0], r[1]), price: (r, f) => price(r[0], r[1], f), currency: (r) => currency(r[0]),
  give: (r) => give(r[0], r[1]), pay: (r) => pay(r[0], r[1], r[2]), zone: (r, f) => zone(r[0], r[1], f), 'zone-suggest': (r) => zoneSuggest(r[0]), relate: (r, f) => relate(r[0], r[1], r[2], f), layers: (r, f) => layers(f),
  help: () => HELP,
};
const HELP = `eden-god ${SKILL_VERSION} — god mode for one Eden world. Read SKILL.md.
read:   verify-use <target> [--seat ref] [--from ref|x,z] [--uses enter,sit] · map · defs <words> · describe <ref> · where <x,z|ref> · free WxD [--near ref] · look [--at ref] [--from s|n|e|w|above] [--inside [--floor k]] · history · resolve · schema [--md]
build:  place <def> --at x,z|ref | --near ref [--dist m] [--dir ne] [--count n] | --inside house/room [--wall back|front|left|right|n…] [--corner back-left|…] | --on table|pier|house/balcony [--count n] | --along road [--t 0.3] [--side left|right|both] [--offset m] [--row n --gap g] | --against ref[.n] | --between a b | --free   [--facing ref|n|e|s|w] [--float] [--row n|--grid WxH --gap g] [--name n] [--param k=v] [--scale s (defs <name> shows its range)] [--dry]
shapes: place <path-def> --from ref --to ref [--via x,z] [--width w] | --path '[[x,z],…]' · place <area-def> --rect cx,cz,w,d | --circle cx,cz,r | --area '[[x,z],…]'
edit:   move <ref> <relations>|--by dx,dz|--in pier/end|house/kitchen · set <ref> --param k=v --state '{…}' · recolor <ref> #hex · remove <ref>… · clone <ref> [--at] [--count n --step dx,dz] · select [filters] [--remove|--by|--recolor|--set-state|--set-param]
groups: group <name> · group --off · undo [--group name] · redo
batch:  plan '<batch>' · preview '<batch>' · commit <preview-id> · act '<batch>' · dryrun '<batch>' · request <clientRef>
world:  sky [--palette p --sun s] · time [19:30|7pm] [--speed h/h] [--pause|--resume] · weather [--kind storm|rain|fog|wind|cloudy|clear|auto] [--intensity i] [--clouds --wind --rain --fog] · strike [--at x,z|thing] · constitution <md> · expand <m> · export [file] · import <genesis.json> · define <def.json> · define-kit <kit.json> · furnish <house>[/room]
pair:   register <world-url> · pair · flags · flag <label> --at x,z · prayers [--all: answered too] · answer <id> <text> · status
${LAND_HELP}
find:   catalog [--category c] [--has slot:sit|actuator:door|comp:light] [--page n] (every def, one line each) · find <words> [--category c] [--has …] · recommend <what you want> · taxonomy (categories, counts, param conventions, actuators)
${LAYERS_HELP}
learn:  examples [name] · defs <name|core/x@1> (one def in full) · sky (palettes) · a row named stall = the set "stall"`;

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('eden-god.mjs')) {
  const [cmd, ...argv] = process.argv.slice(2); const { flags: f, rest } = parseFlags(argv, boolsFor(cmd));
  const fn = COMMANDS[cmd ?? 'help'];
  if (!fn) { console.error(`unknown command ${cmd}\n${HELP}`); process.exit(2); }

  const t0 = Date.now();
  // optional transcript (blind tests, demos): `"transcript": "<file>"` in .eden-god.json appends every command and answer
  const tr = (() => { try { return load().transcript; } catch { return null; } })();
  const record = (out, error) => { if (!tr || cmd === 'look-shot' || cmd === 'look-keeper') return; try { appendFileSync(tr, JSON.stringify({ at: new Date().toISOString(), cmd: [cmd, ...argv].join(' ').replace(/god_[A-Za-z0-9_-]+/g, 'god_…'), ms: Date.now() - t0, ...(error ? { error } : { out: typeof out === 'string' ? out : JSON.stringify(out).slice(0, 4000) }) }) + '\n'); } catch { /* best effort */ } };
  if (!['look-shot', 'look-keeper'].includes(cmd)) try { checkArgs(cmd ?? 'help', f, rest); } catch (e) { record(null, `REFUSED by the CLI: ${e.message}`); console.error(`REFUSED by the CLI: ${e.message}`); process.exit(2); }
  if (tr && cmd === 'look') try { appendFileSync(tr, JSON.stringify({ at: new Date().toISOString(), cmd: [cmd, ...argv].join(' '), phase: 'start' }) + '\n'); } catch { /* best effort */ }
  Promise.resolve(fn(rest, f)).then((out) => { record(out); if (typeof out === 'string') console.log(out); else console.log(JSON.stringify(out, null, 2)); if (process.env.EDEN_GOD_TIMING) console.error(`(${Date.now() - t0} ms)`); }).catch((e) => { record(null, String(e.message ?? e)); console.error(String(e.message ?? e)); process.exit(1); });
}
export { mirror, view, solve, refPoint, compassKey, COMPASS, mkdirSync };
