#!/usr/bin/env node
// Template upgrade for a lived world (lane E1, 2026-10-18): bring a world made from an older genesis template up to the
// current one with ordinary public Godmode, changing only what the template diff changes and only where the world still
// holds exactly what the old template made there. Residents' and visitors' work (moved or set things, things they added,
// occupied buildings) is left alone and reported.
//
//   spec:     node upgrade.mjs spec --old <old template.json> --new <new template.json> --id <id> --world <slug> --from <rev> --to <rev> --out <spec.json>
//   review:   node upgrade.mjs review   --spec <spec.json> --base <world URL>                         (public snapshot, no credential)
//   plan:     node upgrade.mjs plan     --spec <spec.json> --base <world URL> --receipt <abs.json> --token-file <path>   (previews every batch, writes nothing to the world)
//   apply:    node upgrade.mjs apply    --spec <spec.json> --base <world URL> --receipt <abs.json> --token-file <path>
//   verify:   node upgrade.mjs verify   --base <world URL> --receipt <abs.json>
//   rollback: node upgrade.mjs rollback --base <world URL> --receipt <abs.json> --token-file <path> [--apply]
//   restore:  node upgrade.mjs restore ... (re-runs rollback's second step, exact poses, after an interrupted or older rollback)
//   recover:  node upgrade.mjs recover  --base <world URL> --receipt <abs.json> --token-file <path>  (an apply cut off mid-act)
//
// Match by name path (root/child/grandchild). A whole unit (one root entity and everything in it) is skipped when it is
// occupied (a body inside) or changed since genesis (a thing in it that neither template made, or one that equals neither
// template). Units are packed whole into batches of <= 256 ops and < 56 KB under one group; each batch is preview -> act
// with the plan-time revisions as `expect` (stale = refused). Rollback undoes the group (journal inverses) after a guard.
// The credential is read by path at runtime and never written anywhere; the receipt and the pre-apply snapshot are 0600.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export const MAX_OPS = 256, MAX_BYTES = 56_000;
const J = JSON.stringify;
const PLACE_FIELDS = ['def', 'name', 'in', 'p', 'r', 's', 'shape', 'anchor', 'params', 'state', 'seed', 'constraints', 'mode'];
export const normDef = (d) => String(d ?? '').replace(/^core\//, 'core-');
const isBody = (e) => e.by === 'engine' || /humanoid/.test(e.def ?? '');

// ---------- templates -> spec ----------
/** Every place op of a template keyed by its name path; tmp parents are resolved within their batch. Defines by name. */
export function templateIndex(tpl) {
  const places = new Map(), defines = new Map();
  for (const b of tpl.batches) {
    const tmp = {};
    for (const o of b.ops) {
      if (o.op === 'define') { defines.set(o.def.name, o.def); continue; }
      if (o.op !== 'place') continue;
      const par = o.in?.parent ?? 'world', pp = tmp[par] ?? (par === 'world' ? '' : par), path = pp ? `${pp}/${o.name}` : o.name;
      assert(!places.has(path), `duplicate template path ${path}`);
      if (o.tmp) tmp[o.tmp] = path;
      const { tmp: _t, ...op } = o; places.set(path, { op, parent: pp || null });
    }
  }
  return { places, defines };
}
const same = (a, b) => J(a) === J(b);
export function makeSpec(oldTpl, newTpl, meta) {
  const A = templateIndex(oldTpl), B = templateIndex(newTpl), items = [];
  for (const [name, def] of B.defines) if (!same(A.defines.get(name), def)) items.push({ kind: 'define', name, old: A.defines.get(name) ?? null, new: def });
  for (const [path, { op, parent }] of A.places) if (!B.places.has(path)) items.push({ kind: 'remove', path, parent, old: op, new: null });
  for (const [path, { op, parent }] of B.places) {
    const was = A.places.get(path);
    if (!was) items.push({ kind: 'add', path, parent, old: null, new: op });
    else if (!same(was.op, op)) items.push({ kind: 'change', path, parent, old: was.op, new: op });
  }
  // the old template's full unit contents (to tell "changed since genesis" from template-made) travel with the spec
  const unitsOf = new Set(items.filter((i) => i.path).map((i) => i.path.split('/')[0]));
  const oldUnits = {}, newUnits = {};
  for (const [path, { op }] of A.places) { const u = path.split('/')[0]; if (unitsOf.has(u)) (oldUnits[u] ??= {})[path] = op; }
  for (const [path, { op }] of B.places) { const u = path.split('/')[0]; if (unitsOf.has(u)) (newUnits[u] ??= {})[path] = op; }
  return { schema: 'template-upgrade/1', ...meta, counts: Object.fromEntries(['define', 'add', 'remove', 'change'].map((k) => [k, items.filter((i) => i.kind === k).length])), items, oldUnits, newUnits };
}

// ---------- live matching ----------
const near = (a, b, tol) => Math.abs((a ?? 0) - (b ?? 0)) <= tol;
function deepNear(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return near(a, b, 1e-6);
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => deepNear(x, b[i]));
  if (a && typeof a === 'object') return !!b && typeof b === 'object' && !Array.isArray(b) && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => deepNear(a[k], b[k]));
  return a === b;
}
/** Does live entity e still hold what template place op `op` made? (def, position, yaw, scale, params, slot, shape; not state) */
export function matchesOp(e, op) {
  if (!e || !op) return false;
  if (normDef(e.def) !== normDef(op.def)) return false;
  if ((op.in?.slot ?? null) !== (e.in?.slot ?? null)) return false;
  if (op.p) {
    const ep = e.p ?? [0, 0, 0];
    // x/z only: y is where the thing rests (ground, floor, a table top), which the world settles itself
    if (!near(ep[0], op.p[0], 0.05) || !near(ep[ep.length - 1], op.p[op.p.length - 1], 0.05)) return false;
  }
  const r0 = Array.isArray(op.r) ? op.r : [op.r ?? 0, 0, 0], r1 = Array.isArray(e.r) ? e.r : [e.r ?? 0, 0, 0];
  if (!r0.every((v, i) => near(r1[i], v, 0.002))) return false;
  if (!near(e.s ?? 1, op.s ?? 1, 0.001)) return false;
  for (const [k, v] of Object.entries(op.params ?? {})) if (!deepNear(v, e.params?.[k])) return false;
  if (op.shape && !deepNear(op.shape, e.shape)) return false;
  return true;
}
export function indexWorld(snapshot) {
  const byId = new Map(snapshot.entities.map((e) => [e.id, e])), kids = new Map();
  for (const e of snapshot.entities) { const p = e.in?.parent ?? 'world'; if (!kids.has(p)) kids.set(p, []); kids.get(p).push(e); }
  const child = (parentId, name) => { const xs = (kids.get(parentId) ?? []).filter((e) => e.name === name && !isBody(e)); return xs.length > 1 ? { ambiguous: true } : xs[0]; };
  /** entity at a name path, undefined if absent, {ambiguous} if two share a name */
  const resolve = (path) => { let at = 'world', e; for (const n of path.split('/')) { e = child(at, n); if (!e || e.ambiguous) return e; at = e.id; } return e; };
  const subtree = (id) => { const out = []; const walk = (x) => { for (const c of kids.get(x) ?? []) { out.push(c); walk(c.id); } }; walk(id); return out; };
  const pathOf = (e) => { const ns = []; for (let x = e; x && x !== 'world'; x = byId.get(x.in?.parent)) { if (!x.name) return null; ns.unshift(x.name); if ((x.in?.parent ?? 'world') === 'world') break; } return ns.join('/'); };
  return { byId, kids, resolve, subtree, pathOf, bodies: snapshot.entities.filter(isBody), defs: new Map((snapshot.defs ?? []).map((d) => [d.name, d])) };
}
/** A body standing inside a building's footprint (rooms are slots, bodies stay at the world root). */
function occupied(root, bodies) {
  const w = root.params?.w, d = root.params?.d; if (!(w > 0 && d > 0) || !root.p) return null;
  const rad = Math.hypot(w, d) / 2 + 1, x = root.p[0], z = root.p[root.p.length - 1];
  return bodies.find((b) => b.p && Math.hypot(b.p[0] - x, b.p[b.p.length - 1] - z) <= rad) ?? null;
}

// ---------- plan ----------
const placeOp = (op, parent, tmp) => { const o = { op: 'place' }; for (const k of PLACE_FIELDS) if (op[k] !== undefined) o[k] = structuredClone(op[k]); if (tmp) o.tmp = tmp; o.in = { ...(op.in ?? {}), parent }; return o; };
/** Plan on a snapshot: per unit, the ops to apply and the status of every item. Pure. */
export function plan(snapshot, spec) {
  assert.equal(spec.schema, 'template-upgrade/1', 'spec schema');
  const W = indexWorld(snapshot), units = new Map(), report = { done: [], kept: [], skipped: [] };
  for (const it of spec.items.filter((i) => i.path)) { const u = it.path.split('/')[0]; if (!units.has(u)) units.set(u, []); units.get(u).push(it); }
  const out = [];
  for (const [unit, items] of units) {
    const root = W.resolve(unit), ops = [], meta = [], expect = {};
    if (root?.ambiguous) { report.skipped.push({ unit, why: 'two roots share this name' }); continue; }
    // unit health: everything in the unit was made by one of the two templates and still equals it
    if (root) {
      const oldU = spec.oldUnits[unit] ?? {}, newU = spec.newUnits[unit] ?? {}, why = [];
      for (const e of [root, ...W.subtree(root.id)]) {
        if (isBody(e)) { why.push(`body ${e.id} inside`); continue; }
        const p = W.pathOf(e); if (!p || !(p in oldU || p in newU)) { why.push(`foreign ${e.name ?? e.id}`); continue; }
        if (!matchesOp(e, oldU[p]) && !matchesOp(e, newU[p])) why.push(`changed ${p}`);
      }
      for (const p of Object.keys(oldU)) if (p in newU && !W.resolve(p)) why.push(`missing ${p}`);
      const body = occupied(root, W.bodies); if (body) why.push(`occupied by ${body.id}`);
      if (why.length) { report.skipped.push({ unit, why: why.slice(0, 6).join('; ') + (why.length > 6 ? ` (+${why.length - 6})` : '') }); continue; }
    }
    const tmpOf = new Map(); let t = 0;
    // removes, then changes deepest first (furniture moves under the old plan, then the plan; the journal's inverse then
    // restores the old plan before it moves furniture back, so a group undo never crosses the new rooms), then adds
    const order = { remove: 0, change: 1, add: 2 }, depth = (it) => it.path.split('/').length;
    for (const it of [...items].sort((a, b) => order[a.kind] - order[b.kind] || (a.kind === 'change' ? depth(b) - depth(a) : 0))) {
      const e = W.resolve(it.path);
      if (it.kind === 'remove') {
        if (!e) { report.done.push(`${it.path} (already gone)`); continue; }
        if (!matchesOp(e, it.old)) { report.kept.push(`${it.path}: changed since genesis`); continue; }
        ops.push({ op: 'remove', id: e.id, cascade: true }); meta.push(it.path); expect[e.id] = { id: e.id, v: e.v };
      } else if (it.kind === 'change') {
        if (!e) { report.kept.push(`${it.path}: missing`); continue; }
        if (matchesOp(e, it.new)) { report.done.push(it.path); continue; }
        if (!matchesOp(e, it.old)) { report.kept.push(`${it.path}: changed since genesis`); continue; }
        if (normDef(it.new.def) !== normDef(it.old.def)) {
          // a def change (E2: the 17 m core wheel becomes a bigger local wheel): the old thing goes and the new one is placed
          // under the same name in the same batch, so what keys on the name (a ride) carries on; group undo restores the old
          assert(!W.subtree(e.id).length, `${it.path}: a def change replaces only a thing with nothing inside it`);
          ops.push({ op: 'remove', id: e.id, cascade: true }); meta.push(it.path); expect[e.id] = { id: e.id, v: e.v };
          const parent = it.parent ? W.resolve(it.parent)?.id : 'world';
          assert(parent, `${it.path}: parent ${it.parent} missing`);
          ops.push(placeOp(it.new, parent)); meta.push(it.path);
          continue;
        }
        const mv = { op: 'move', id: e.id }, n = it.new, o = it.old;
        for (const k of ['p', 'r', 's', 'shape']) if (!same(n[k], o[k])) mv[k] = structuredClone(n[k] ?? (k === 'r' ? 0 : k === 's' ? 1 : undefined));
        // a root that rests on the ground ([x, z]) and turns settles again with its new footprint, as genesis seats it
        if (Object.keys(mv).length > 2 && !mv.p && !it.parent && n.p?.length === 2) mv.p = [...n.p];
        if (Object.keys(mv).length > 2) { ops.push(mv); meta.push(it.path); }
        const pk = Object.keys(n.params ?? {}).filter((k) => !same(n.params[k], o.params?.[k]));
        const gone = Object.keys(o.params ?? {}).filter((k) => !(k in (n.params ?? {})));
        assert(!gone.length, `${it.path}: the new template drops params ${gone} (set cannot remove keys)`);
        if (pk.length) { ops.push({ op: 'set', id: e.id, params: Object.fromEntries(pk.map((k) => [k, structuredClone(n.params[k])])) }); meta.push(it.path); }
        if (!same(n.state, o.state) && n.state) { ops.push({ op: 'set', id: e.id, state: structuredClone(n.state) }); meta.push(it.path); }
        expect[e.id] = { id: e.id, v: e.v };
      } else {
        if (e && !e.ambiguous) { report[matchesOp(e, it.new) ? 'done' : 'kept'].push(matchesOp(e, it.new) ? it.path : `${it.path}: name taken by a different thing`); continue; }
        const parent = it.parent ? (tmpOf.get(it.parent) ?? W.resolve(it.parent)?.id) : 'world';
        if (!parent) { report.kept.push(`${it.path}: parent ${it.parent} missing`); continue; }
        const tmp = items.some((x) => x.kind === 'add' && x.parent === it.path) ? `$u${t++}` : undefined;
        if (tmp) tmpOf.set(it.path, tmp);
        if (parent !== 'world' && !parent.startsWith('$')) { const pe = W.byId.get(parent); expect[parent] = { id: parent, v: pe.v }; }
        ops.push(placeOp(it.new, parent, tmp)); meta.push(it.path);
      }
    }
    if (ops.length) out.push({ unit, ops, meta, expect });
  }
  // defines: new or still-old local defs; a def the world already changed is kept
  const defOps = [];
  for (const it of spec.items.filter((i) => i.kind === 'define')) {
    const live = W.defs.get(it.name), lm = live && J(live.make);
    if (live && lm === J(it.new.make)) { report.done.push(`def ${it.name}`); continue; }
    if (live && (!it.old || lm !== J(it.old.make))) { report.kept.push(`def ${it.name}: changed in this world`); continue; }
    defOps.push({ op: 'define', def: structuredClone(it.new) });
  }
  return { units: out, defOps, report };
}
/** Pack whole units into batches; defines and the units that use them go first, together. Each op carries its name path in `meta`. */
export function batches(p, group, note) {
  const defNames = new Set(p.defOps.map((o) => o.def.name));
  const uses = (u) => u.ops.some((o) => o.def && defNames.has(normDef(o.def).replace(/@\d+$/, '')));
  const out = [], size = (x) => J(x).length;
  const open = () => ({ group, ops: [], meta: [], expect: {}, units: [] });
  const fits = (b, u) => b.ops.length + u.ops.length <= MAX_OPS && size(b.ops) + size(b.expect) + size(u.ops) + size(u.expect) < MAX_BYTES;
  const add = (b, u) => { b.ops.push(...u.ops); b.meta.push(...u.meta); Object.assign(b.expect, u.expect); b.units.push(u.unit); };
  let cur = open(); cur.ops.push(...p.defOps); cur.meta.push(...p.defOps.map((o) => 'def:' + o.def.name));
  // E2: units that only move, set or remove go before the users of new defines when they fit, so a thing moved out of
  // the way (a ticket booth) makes room for a bigger new one (a wheel) in the same edit
  const clears = (u) => !uses(u) && u.ops.every((o) => o.op !== 'place'), early = new Set();
  if (p.units.some(uses)) for (const u of p.units.filter(clears)) if (fits(cur, u) && p.units.filter(uses).reduce((n, x) => n + x.ops.length, 0) + cur.ops.length + u.ops.length <= MAX_OPS) { add(cur, u); early.add(u); }
  for (const u of p.units.filter(uses)) { assert(fits(cur, u), `defines and their users do not fit one batch (${u.unit})`); add(cur, u); }
  for (const u of p.units.filter((x) => !uses(x) && !early.has(x))) {
    assert(fits(open(), u), `unit ${u.unit} alone is over ${MAX_OPS} ops or ${MAX_BYTES} bytes`);
    if (!fits(cur, u)) { if (cur.ops.length) out.push(cur); cur = open(); }
    add(cur, u);
  }
  if (cur.ops.length) out.push(cur);
  return out.map((b, i) => ({ ...b, clientRef: `${group}-b${i}`, note: `${note} (${i + 1}/${out.length}): ${b.units.join(', ')}`.slice(0, 400) }));
}

// ---------- verify / rollback ----------
const touchedIds = (receipt) => [...new Set(receipt.batches.flatMap((b) => b.ops.filter((o) => o.id).map((o) => o.id)))];
/** After apply: every planned change holds the new template; everything else (bodies aside) is exactly as before. */
export function verifyApplied(after, pre, receipt) {
  const W = indexWorld(after), problems = [], placed = {};
  for (const b of receipt.batches) for (const o of b.ops) {
    if (o.op === 'remove') { if (W.byId.has(o.id)) problems.push(`still present ${o.id}`); }
    else if (o.op === 'place') {
      const path = b.meta[b.ops.indexOf(o)], e = W.resolve(path);
      if (!e || e.ambiguous || !matchesOp(e, receipt.newOps[path])) problems.push(`not as template: ${path}`); else placed[e.id] = path;
    } else if (o.op === 'move' || o.op === 'set') { const path = b.meta[b.ops.indexOf(o)]; if (!matchesOp(W.byId.get(o.id), receipt.newOps[path])) problems.push(`not as template: ${path}`); }
  }
  const touched = new Set(touchedIds(receipt)), redefined = new Set(receipt.batches.flatMap((b) => b.ops.filter((o) => o.op === 'define').map((o) => o.def.name)));
  let same = 0; const resettled = [];
  for (const e of pre.entities) {
    if (isBody(e) || touched.has(e.id)) continue;
    const now = W.byId.get(e.id);
    if (!now) { problems.push(`gone ${e.id} ${e.name ?? ''}`); continue; }
    if (J(now) === J(e)) { same++; continue; }
    const base = normDef(e.def).replace(/@\d+$/, '');
    if (redefined.has(base) && J({ ...now, def: e.def, v: e.v }) === J(e)) { same++; continue; }
    // new ground (a terrace, a rail bed) lets things that rest on it settle: only the height may differ
    // (a child re-seated with its building writes its implicit origin out: no p = [0, 0, 0], no r = 0; x/z to the centimetre)
    const cm = (v) => Math.round((v ?? 0) * 100) / 100 || 0, seat = (x) => { const p = x.p ?? [0, 0, 0]; return J({ ...x, p: [cm(p[0]), 0, cm(p[p.length - 1])], r: x.r ?? 0, v: 0 }); };
    if (seat(now) === seat(e)) { resettled.push(`${W.pathOf(now) ?? e.id} y ${(e.p?.[1] ?? 0).toFixed(2)}->${(now.p?.[1] ?? 0).toFixed(2)}`); continue; }
    problems.push(`changed ${e.id} ${W.pathOf(now) ?? ''}`);
  }
  const preIds = new Set(pre.entities.map((e) => e.id)), extra = after.entities.filter((e) => !preIds.has(e.id) && !isBody(e) && !placed[e.id] && !Object.keys(placed).includes(e.in?.parent));
  for (const e of extra) problems.push(`new thing not in the plan ${e.id} ${e.name ?? ''}`);
  return { ok: problems.length === 0, problems: problems.slice(0, 40), problemCount: problems.length, untouchedIdentical: same, resettled, placed: Object.keys(placed).length };
}
/** Rollback guard: everything the apply touched or placed is still exactly as the apply left it, and nobody put anything into a placed thing. */
export function rollbackGuard(now, receipt) {
  assert(receipt.applied, 'receipt has no applied record');
  const W = indexWorld(now), bad = [];
  for (const [id, v] of Object.entries(receipt.applied.versions)) { const e = W.byId.get(id); if (!e) bad.push(`${id} gone`); else if (e.v !== v) bad.push(`${id} changed since the upgrade (v${v} -> v${e.v})`); }
  const placed = new Set(receipt.applied.placed);
  for (const id of placed) for (const c of W.kids.get(id) ?? []) if (!placed.has(c.id)) bad.push(`${c.id} was put into upgraded ${id}`);
  for (const b of W.bodies) for (const id of receipt.applied.roots) { const r = W.byId.get(id); if (r && occupied(r, [b])) bad.push(`${b.id} inside ${r.name}`); }
  return bad;
}
/** The stored meaning of an entity: no version counter, implicit pose defaults (p origin, r 0, s 1) and null params
 *  (a cleared param) are the same as absent, object keys in any order. The engine's undo writes such defaults out. */
const sortKeys = (x) => Array.isArray(x) ? x.map(sortKeys) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sortKeys(x[k])])) : x;
export function canon(e) {
  const { v: _v, ...r } = e;
  if (r.s === 1) delete r.s; if (r.r === 0) delete r.r;
  if (Array.isArray(r.p) && r.p.every((x) => x === 0)) delete r.p;
  if (r.params) { r.params = Object.fromEntries(Object.entries(r.params).filter(([, x]) => x !== null)); if (!Object.keys(r.params).length) delete r.params; }
  return J(sortKeys(r));
}
const POSE_KEYS = ['in', 'p', 'r', 's', 'shape'];
const poseOf = (e) => canon(Object.fromEntries(Object.entries(e).filter(([k]) => !POSE_KEYS.includes(k))));
/** After the group undo: things whose meaning differs from before only in pose (ground under them re-seated them, or the
 *  undo wrote a re-seat out) get one strict move each back to their exact stored pose. Anything else is left to verify. */
export function restoreOps(now, pre, also = new Set()) {
  const W = indexWorld(now), ops = [];
  for (const e of pre.entities) {
    if (isBody(e)) continue;
    const x = W.byId.get(e.id);
    if (!x || poseOf(x) !== poseOf(e) || (canon(x) === canon(e) && !also.has(e.id))) continue;
    ops.push({ op: 'move', id: e.id, in: e.in, p: e.p ?? [0, 0, 0], r: e.r ?? 0, s: e.s ?? 1, ...(e.shape ? { shape: e.shape } : {}), mode: 'strict' });
  }
  return ops;
}
/** After rollback: every touched thing is back as before, every placed thing is gone, nothing else differs (bodies aside). */
export function verifyRolledBack(now, pre, receipt) {
  const W = indexWorld(now), problems = [], preIds = new Set(pre.entities.map((e) => e.id));
  const strip = (e) => { const { v: _v, ...r } = e; return J(r); };
  let exact = 0, sameButVersion = 0, sameMeaning = 0;
  for (const e of pre.entities) {
    if (isBody(e)) continue;
    const x = W.byId.get(e.id);
    if (!x) problems.push(`missing ${e.id} ${e.name ?? ''}`);
    else if (J(x) === J(e)) exact++;
    else if (strip(x) === strip(e)) sameButVersion++;
    else if (canon(x) === canon(e)) sameMeaning++;
    else problems.push(`differs ${e.id} ${e.name ?? ''}`);
  }
  for (const e of now.entities) if (!isBody(e) && !preIds.has(e.id)) problems.push(`left behind ${e.id} ${e.name ?? ''}`);
  const defs = (s) => J((s.defs ?? []).map((d) => [d.name, d.make]).sort());
  return { ok: problems.length === 0, problems: problems.slice(0, 40), problemCount: problems.length, exact, sameButVersion, sameMeaning, defsEqual: defs(now) === defs(pre) };
}

// ---------- CLI ----------
async function main(argv) {
  const [mode, ...args] = argv, flag = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
  const say = (o) => console.log(J(o, null, 2));
  if (mode === 'spec') {
    const rd = (k) => JSON.parse(readFileSync(flag(k), 'utf8'));
    const spec = makeSpec(rd('old'), rd('new'), { id: flag('id'), world: flag('world'), from: flag('from'), to: flag('to') });
    writeFileSync(flag('out'), J(spec, null, 1) + '\n'); say({ out: flag('out'), counts: spec.counts }); return;
  }
  const base = flag('base')?.replace(/\/+$/, ''), out = flag('receipt'); assert(base, '--base <world URL>');
  const tokenFile = flag('token-file', process.env.EDEN_GOD_TOKEN_FILE); let token = '';
  if (tokenFile) { const raw = readFileSync(tokenFile, 'utf8').trim(); try { token = JSON.parse(raw).token ?? ''; } catch { token = raw; } }
  const request = async (path, body) => { const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: J(body) } : {}) }); const d = await r.json().catch(() => ({})); assert(r.ok, `${path}: HTTP ${r.status} ${d.code ?? d.error ?? ''} ${d.message ?? ''}`); return d; };
  const snap = () => request('/v1/world/snapshot');
  const save = (r) => writeFileSync(out, J(r, null, 1) + '\n', { mode: 0o600 });
  const load = () => JSON.parse(readFileSync(out, 'utf8'));
  const preFile = () => out.replace(/\.json$/, '') + '.pre.json';

  if (mode === 'review' || mode === 'plan' || mode === 'apply') {
    const spec = JSON.parse(readFileSync(flag('spec'), 'utf8')), snapshot = await snap();
    assert.equal(snapshot.worldId.replace(/-\d+$/, ''), spec.world, `world ${snapshot.worldId} is not ${spec.world}`);
    const p = plan(snapshot, spec), opCount = p.defOps.length + p.units.reduce((n, u) => n + u.ops.length, 0);
    const summary = { worldId: snapshot.worldId, seq: snapshot.seq, units: p.units.length, defines: p.defOps.length, ops: opCount, done: p.report.done.length, kept: p.report.kept, skipped: p.report.skipped };
    if (mode === 'review') { say({ mode, ...summary }); return; }
    assert(out && token, '--receipt <abs.json> and --token-file <path> required');
    if (mode === 'plan') assert(!existsSync(out), 'receipt exists: apply it, verify it or roll it back');
    else { const r = load(); assert.equal(r.status, 'planned', `receipt status ${r.status}: plan again or use verify / rollback / recover`); }
    const group = mode === 'plan' ? `${spec.world}-upgrade-${randomBytes(4).toString('hex')}` : load().group;
    const bs = batches(p, group, `Template upgrade ${spec.from}->${spec.to}`);
    const newOps = {};
    for (const it of spec.items) if (it.new && it.path) newOps[it.path] = it.new;
    const receipt = { schema: 'template-upgrade-receipt/1', spec: spec.id, from: spec.from, to: spec.to, worldId: snapshot.worldId, plannedSeq: snapshot.seq, group, summary, newOps, batches: bs };
    // every batch previews on the current world (defines travel with their users, so each batch stands alone)
    const previews = [];
    for (const b of bs) { const pv = await request('/v1/god/preview', { group: b.group, clientRef: b.clientRef, note: b.note, ops: b.ops }); previews.push({ clientRef: b.clientRef, accepted: !!pv.accepted, failures: (pv.failures ?? []).slice(0, 5) }); }
    const refused = previews.filter((x) => !x.accepted);
    if (mode === 'plan') { receipt.status = refused.length ? 'refused' : 'planned'; receipt.previews = previews; save(receipt); say({ mode, status: receipt.status, group, batches: bs.length, ...summary, refused }); return; }
    assert(!refused.length, 'preview refused: ' + J(refused));
    const planned = load(); assert(same(planned.batches.map((b) => b.ops), bs.map((b) => b.ops)), 'the world changed since plan: run plan again (new receipt)');
    writeFileSync(preFile(), J(snapshot) + '\n', { mode: 0o600 });
    Object.assign(receipt, { status: 'applying', results: [] }); save(receipt);
    for (const b of bs) {
      const pv = await request('/v1/god/preview', { group: b.group, clientRef: b.clientRef, note: b.note, ops: b.ops }); assert(pv.accepted, `${b.clientRef} preview refused: ${J(pv.failures ?? pv)}`);
      const res = await request('/v1/god/act', { group: b.group, clientRef: b.clientRef, note: b.note, ops: b.ops, expect: b.expect, preview: pv.id });
      assert(res.accepted && Number.isInteger(res.seq), `${b.clientRef} refused: ${J(res.failures ?? res)}`);
      receipt.results.push({ clientRef: b.clientRef, seq: res.seq }); save(receipt);
    }
    const after = await snap(); recordApplied(receipt, after); receipt.status = 'applied'; save(receipt);
    const v = verifyApplied(after, snapshot, receipt); receipt.verify = v; receipt.status = v.ok ? 'verified' : 'applied-with-problems'; save(receipt);
    say({ mode, status: receipt.status, group, batches: bs.length, seqs: receipt.results.map((x) => x.seq), verify: v }); return;
  }
  assert(out && existsSync(out), '--receipt required'); const receipt = load(), pre = JSON.parse(readFileSync(preFile(), 'utf8'));
  const now = await snap(); assert.equal(now.worldId, receipt.worldId, 'receipt world identity');
  if (mode === 'verify') { const v = receipt.status.startsWith('rolled') ? verifyRolledBack(now, pre, receipt) : verifyApplied(now, pre, receipt); if (v.ok && receipt.status.startsWith('applied')) { receipt.status = 'verified'; receipt.verify = v; save(receipt); } say({ mode, status: receipt.status, verify: v }); process.exitCode = v.ok ? 0 : 1; return; }
  assert(token, 'credential path required');
  if (mode === 'recover') {
    for (const b of receipt.batches.slice(receipt.results.length)) { const r = await request('/v1/god/requests/' + encodeURIComponent(b.clientRef)).catch(() => null); if (!r?.result?.accepted) break; receipt.results.push({ clientRef: b.clientRef, seq: r.result.seq }); }
    recordApplied(receipt, now); receipt.status = receipt.results.length === receipt.batches.length ? 'applied' : 'partial'; save(receipt); say({ mode, status: receipt.status, applied: receipt.results.length, of: receipt.batches.length }); return;
  }
  if (mode === 'rollback') {
    const bad = rollbackGuard(now, receipt);
    if (bad.length) { say({ mode, refused: true, why: bad.slice(0, 20), count: bad.length }); process.exitCode = 1; return; }
    if (!args.includes('--apply')) { say({ mode: 'rollback-review', group: receipt.group, edits: receipt.results.length, touched: Object.keys(receipt.applied.versions).length }); return; }
    receipt.status = 'rolling-back'; save(receipt);
    const r = await request('/v1/god/undo?group=' + encodeURIComponent(receipt.group), {}); assert(r.accepted, 'undo refused: ' + J(r.failures ?? r));
    receipt.rollback = { reverted: r.reverted }; receipt.status = 'rolled-back'; save(receipt);
    await restore(receipt); return;
  }
  if (mode === 'restore') { assert(receipt.status.startsWith('rolled-back'), `receipt status ${receipt.status}: restore follows a rollback`); await restore(receipt); return; }
  throw new Error(`unknown mode ${mode}`);

  /** Second rollback step: strict moves put re-seated things back to their exact stored pose, then the check. A move can
   *  re-seat a neighbour on the changed ground (stacked cliff houses and their pads), so each round moves again everything
   *  moved before in one edit (touched things are not re-seated by their own edit) until nothing is left (at most 6 rounds). */
  async function restore(receipt) {
    const group = receipt.group + '-restore', seqs = receipt.rollback?.restoreSeqs ?? []; let moved = receipt.rollback?.restored ?? 0;
    const ever = new Set(receipt.rollback?.restoredIds ?? []);
    for (let round = 0; round < 6; round++) {
      const differing = restoreOps(await snap(), pre); if (!differing.length) break;
      for (const o of differing) ever.add(o.id);
      const ops = restoreOps(await snap(), pre, ever);
      assert(ops.length <= MAX_OPS, `restore needs ${ops.length} moves in one edit (max ${MAX_OPS})`);
      for (let i = 0; i < ops.length; i += MAX_OPS) {
        const b = { group, clientRef: `${group}-${seqs.length + 1}`, note: `Template upgrade rollback: exact poses (${ops.length})`, ops: ops.slice(i, i + MAX_OPS) };
        const pv = await request('/v1/god/preview', b); assert(pv.accepted, 'restore preview refused: ' + J(pv.failures ?? pv));
        const res = await request('/v1/god/act', { ...b, preview: pv.id }); assert(res.accepted, 'restore refused: ' + J(res.failures ?? res)); seqs.push(res.seq);
        receipt.rollback = { ...receipt.rollback, restored: moved + ops.length, restoredIds: [...ever], restoreSeqs: seqs }; save(receipt);
      }
      moved += ops.length;
    }
    const v = verifyRolledBack(await snap(), pre, receipt);
    receipt.rollback = { ...receipt.rollback, restored: moved, restoredIds: [...ever], restoreSeqs: seqs, verify: v }; receipt.status = v.ok ? 'rolled-back-verified' : 'rolled-back-with-problems'; save(receipt);
    say({ mode, status: receipt.status, reverted: receipt.rollback.reverted?.length, restored: moved, verify: v });
  }
}
/** Versions of everything the apply touched or placed (the rollback guard compares against these). */
function recordApplied(receipt, after) {
  const W = indexWorld(after), versions = {}, placed = [], roots = new Set();
  for (const id of touchedIds(receipt)) { const e = W.byId.get(id); if (e) versions[id] = e.v; }
  for (const path of receipt.batches.flatMap((b) => b.meta.filter((_, i) => b.ops[i].op === 'place'))) { const e = W.resolve(path); if (e && !e.ambiguous) { versions[e.id] = e.v; placed.push(e.id); } }
  for (const b of receipt.batches) for (const u of b.units) { const r = W.resolve(u); if (r && !r.ambiguous) roots.add(r.id); }
  receipt.applied = { versions, placed, roots: [...roots] };
}

if (import.meta.url === 'file://' + process.argv[1]) main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(1); });
