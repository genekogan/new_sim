#!/usr/bin/env node
// Additive Mars world patches (lane mars, 2026-10-16): world-local defs plus named placements, written in the template's
// campus frame (bearing 90) and turned onto the live campus at apply time (the bearing is read from Mimos's yaw, so the
// patch lands right before or after the true-rotation patch). Ordinary public Godmode: one atomic batch with a group,
// guarded preview → act, saved receipt, --recover for an uncertain apply, guarded removal of exactly what it placed for --rollback.
// Pure reads until --apply. The credential is read by path at runtime, never copied into the receipt.
//   node add-patch.mjs --spec <worlds/patches/<id>/spec.json> --base <world URL> --receipt <abs JSON> [--token-file <path>]
//                      [--apply | --recover | --rollback [--apply]]
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { turn, FROM } from './patch.mjs';

const MIMOS_R = -1.571; // Mimos's yaw in worlds/templates/mars-two.json (bearing 90)
const first = (r) => (Array.isArray(r) ? r[0] : (r ?? 0));
export function loadSpec(path) {
  const spec = JSON.parse(readFileSync(path, 'utf8')); assert.equal(spec.schema, 'mars-add-patch/1', 'spec schema');
  const defs = spec.defs ? JSON.parse(readFileSync(resolve(dirname(path), spec.defs), 'utf8')) : [];
  return { ...spec, defList: defs };
}
/** The live campus bearing, from Mimos's yaw (the rotation patch adds (90 - bearing) degrees to every campus yaw). */
export function bearingOf(snapshot) {
  const m = snapshot.entities.find((e) => e.name === 'mimos' && e.in.parent === 'world'); assert(m, 'no mimos at the world root: wrong world?');
  const b = FROM - ((first(m.r) - MIMOS_R) * 180) / Math.PI;
  assert(b >= 70 - 0.5 && b <= 90 + 0.5, `campus bearing ${b.toFixed(2)} outside 70..90: wrong world?`);
  return Math.round(b * 1000) / 1000;
}
export function makePatch(snapshot, spec, { group = `${spec.id}-${randomBytes(6).toString('hex')}` } = {}) {
  assert.equal(typeof snapshot.worldId, 'string', 'world identity required');
  const bearing = bearingOf(snapshot);
  const taken = spec.items.filter((it) => findItem(snapshot, it)).map((it) => it.name);
  assert(!taken.length, `names already in the world (${taken.join(', ')}): applied before? use --recover or --rollback with its receipt`);
  for (const a of spec.anchors ?? []) assert(snapshot.entities.some((e) => e.name === a && e.in.parent === 'world'), `anchor ${a} missing: wrong world?`);
  const ops = [
    ...spec.defList.map((def) => ({ op: 'define', def })),
    // an item `in` a campus building is placed in its frame (it turns with the building); others are turned here
    ...spec.items.map((it) => { if (it.in) return { op: 'place', def: it.def, name: it.name, in: { parent: it.in }, p: it.at, r: it.r ?? 0, ...(it.state ? { state: it.state } : {}), ...(it.params ? { params: it.params } : {}) };
      const t = turn(it.at.length === 3 ? it.at : [it.at[0], it.at[1]], it.r ?? 0, bearing); return { op: 'place', def: it.def, name: it.name, p: t.p, r: t.r, ...(it.state ? { state: it.state } : {}), ...(it.params ? { params: it.params } : {}) }; }),
  ];
  return { schema: 'mars-add-patch-receipt/1', spec: spec.id, worldId: snapshot.worldId, beforeSeq: snapshot.seq, bearing, names: spec.items.map((i) => i.name), items: spec.items.map((i) => ({ name: i.name, in: i.in ?? null })),
    batch: { group, clientRef: group, note: spec.note, ops } };
}
/** A patch item in a snapshot: by name at the world root, or by name under its named root parent. */
function findItem(snapshot, it) {
  const parent = it.in ? snapshot.entities.find((e) => e.in.parent === 'world' && e.name === it.in)?.id : 'world';
  return parent ? snapshot.entities.find((e) => e.in.parent === parent && e.name === it.name) : undefined;
}
const placed = (snapshot, items) => items.map((it) => findItem(snapshot, it));
export function verify(snapshot, receipt, rollback = false) {
  assert.equal(snapshot.worldId, receipt.worldId, 'world identity');
  const got = placed(snapshot, receipt.items);
  if (rollback) { assert(got.every((e) => !e), 'rollback left ' + receipt.names.filter((_, i) => got[i]).join(', ')); return; }
  const want = receipt.batch.ops.filter((o) => o.op === 'place');
  for (const [i, e] of got.entries()) {
    assert(e, receipt.names[i] + ' present'); const w = want[i];
    const nd = (d) => String(d).replace(/^core\//, 'core-'); assert(nd(e.def) === nd(w.def), `${e.name} def ${e.def} vs ${w.def}`);
    for (let j = 0; j < w.p.length; j += w.p.length === 3 ? 2 : 1) assert(Math.abs(e.p[j === 1 && w.p.length === 2 ? 2 : j] - w.p[j]) < 0.05, `${e.name}.p[${j}] ${e.p} vs ${w.p}`);
  }
}
/** Rollback = remove exactly the things this patch placed (by id), guarded: each must still be where the patch put it
 *  (not in a resident's hand, not moved into something else). Residents' use (water levels, a lit fire) does not block
 *  it. Works however much history came after (a group undo only reaches the last 500 edits of a lived world). The
 *  world-local defs stay defined and unused. */
export function rollbackBatch(receipt, snapshot) {
  assert(Number.isInteger(receipt.appliedSeq), 'receipt has no accepted sequence'); assert.equal(snapshot.worldId, receipt.worldId, 'world identity');
  const expect = {}, ops = [];
  for (const it of receipt.items) {
    const id = receipt.ids?.[it.name], e = snapshot.entities.find((x) => x.id === id), home = it.in ? snapshot.entities.find((x) => x.in.parent === 'world' && x.name === it.in)?.id : 'world';
    if (!e) continue; // already gone (removed by hand): nothing to do for it
    assert.equal(e.in.parent, home, `rollback refused: ${it.name} is held or moved into ${e.in.parent}; wait until it is put down`);
    expect[id] = { id, v: e.v }; ops.push({ op: 'remove', id, cascade: true });
  }
  assert(ops.length, 'rollback: none of the patch things are in the world any more');
  const group = receipt.batch.group + '-rollback';
  return { group, clientRef: group, expect, note: `Roll back ${receipt.spec}: remove ${ops.length} thing(s) it placed`, ops };
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const args = process.argv.slice(2), flag = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
  const base = flag('base', null)?.replace(/\/+$/, ''), out = flag('receipt', null), specPath = flag('spec', null), rollback = args.includes('--rollback');
  assert(base && out && specPath, '--spec <spec.json> --base <world URL> --receipt <absolute JSON path> [--apply|--recover|--rollback [--apply]]');
  const spec = loadSpec(resolve(specPath));
  const tokenFile = flag('token-file', process.env.EDEN_GOD_TOKEN_FILE); let token = '';
  if (tokenFile) { const raw = readFileSync(tokenFile, 'utf8').trim(); try { token = JSON.parse(raw).token ?? ''; } catch { token = raw; } }
  const request = async (path, body) => { const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); const d = await r.json().catch(() => ({})); assert(r.ok, `${path}: HTTP ${r.status} ${d.code ?? d.error ?? ''}`); return d; };
  const snapshot = await request('/v1/world/snapshot'), existing = existsSync(out);
  const save = (r) => writeFileSync(out, JSON.stringify(r, null, 2) + '\n', { mode: 0o600 });
  const record = (receipt, result, snap) => { assert(result.accepted && Number.isInteger(result.seq), 'accepted result required'); receipt.appliedSeq = result.seq; receipt.appliedVersions = Object.fromEntries(placed(snap, receipt.items).map((e) => [e.id, e.v])); receipt.ids = Object.fromEntries(placed(snap, receipt.items).map((e) => [e.name, e.id])); receipt.status = 'applied'; };
  if (rollback || (existing && args.includes('--recover'))) {
    assert(existing, 'receipt required'); const receipt = JSON.parse(readFileSync(out, 'utf8')); assert.equal(receipt.worldId, snapshot.worldId, 'receipt world identity'); assert(token, 'credential path required');
    if (!rollback) { record(receipt, (await request('/v1/god/requests/' + encodeURIComponent(receipt.batch.clientRef))).result, snapshot); verify(snapshot, receipt); save(receipt); console.log(JSON.stringify({ mode: 'recovered', seq: receipt.appliedSeq })); process.exit(0); }
    const batch = rollbackBatch(receipt, snapshot);
    if (!args.includes('--apply')) { console.log(JSON.stringify({ mode: 'rollback-review', removes: batch.ops.map((o) => o.id), names: receipt.names })); process.exit(0); }
    const pv = await request('/v1/god/preview', batch); assert(pv.accepted, 'rollback preview refused: ' + JSON.stringify(pv.failures ?? pv));
    receipt.rollback = { batch, status: 'prepared' }; save(receipt);
    const undone = await request('/v1/god/act', { ...batch, preview: pv.id }); assert(undone.accepted, 'rollback refused: ' + JSON.stringify(undone.failures));
    receipt.rollback.seq = undone.seq; receipt.status = 'removed'; save(receipt); verify(await request('/v1/world/snapshot'), receipt, true); receipt.status = 'rollback-verified'; save(receipt);
    console.log(JSON.stringify({ mode: 'rollback', accepted: true, seq: undone.seq, removed: batch.ops.length })); process.exit(0);
  }
  assert(!existing, 'receipt exists; use --recover or --rollback');
  const receipt = makePatch(snapshot, spec);
  if (!token) { console.log(JSON.stringify({ mode: 'review', worldId: receipt.worldId, bearing: receipt.bearing, defines: spec.defList.map((d) => d.name), places: receipt.batch.ops.filter((o) => o.op === 'place').map((o) => `${o.name} ${o.def} @${o.p.map((v) => v.toFixed(2))}`) }, null, 2)); process.exit(0); }
  const preview = await request('/v1/god/preview', receipt.batch); assert(preview.accepted, 'preview refused: ' + JSON.stringify(preview.failures ?? preview));
  if (!args.includes('--apply')) { console.log(JSON.stringify({ mode: 'preview', accepted: true, bearing: receipt.bearing, ops: receipt.batch.ops.length })); process.exit(0); }
  receipt.status = 'prepared'; save(receipt);
  const applied = await request('/v1/god/act', { ...receipt.batch, preview: preview.id }); assert(applied.accepted, 'act refused: ' + JSON.stringify(applied.failures));
  const after = await request('/v1/world/snapshot'); record(receipt, applied, after); save(receipt); verify(after, receipt);
  console.log(JSON.stringify({ mode: 'apply', accepted: true, seq: applied.seq, bearing: receipt.bearing, placed: receipt.ids }));
}
