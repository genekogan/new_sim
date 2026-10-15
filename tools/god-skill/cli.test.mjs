import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SKILL_VERSION, COMMANDS, answer, checkArgs, commit, explainFailure, preview, request, status, undo, verifyUse } from './cli.mjs';
import { view } from './lib/mirror.mjs';

function fixture(t, data) {
  const cwd = process.cwd(), originalFetch = globalThis.fetch, dir = mkdtempSync(join(tmpdir(), 'god-cli-offline-')), calls = [];
  process.chdir(dir);
  writeFileSync('.eden-god.json', JSON.stringify({ world: 'https://world.invalid', token: 'fixture-only', group: 'previewed-group' }));
  globalThis.fetch = async (url, options) => { calls.push({ url, ...options }); return Response.json(data); };
  t.after(() => { globalThis.fetch = originalFetch; process.chdir(cwd); rmSync(dir, { recursive: true, force: true }); });
  return calls;
}

test('verify-use posts typed options and returns the full JSON receipt', async t => {
  const receipt = {ok: true, target: 'chapel', uses: [{use: 'enter', ok: true, room: 'nave'}], probe: {removed: true}, ms: 9, notes: []};
  const calls = fixture(t, receipt);
  assert.deepEqual(await COMMANDS['verify-use'](['chapel'], {from: '-2,3.5', seat: 'chapel/pew', uses: 'enter,sit', json: true}), receipt);
  assert.equal(calls[0].url, 'https://world.invalid/v1/god/verify-use');
  assert.deepEqual(JSON.parse(calls[0].body), {target: 'chapel', from: [-2, 3.5], seat: 'chapel/pew', uses: ['enter', 'sit']});
  await verifyUse('chapel', {from: 'plaza', json: true}); assert.equal(JSON.parse(calls[1].body).from, 'plaza');
  checkArgs('verify-use', {seat: 'pew', from: 'plaza', uses: 'sit', json: true}, ['chapel']);
  assert.throws(() => checkArgs('verify-use', {}, ['chapel', 'extra']), /takes one word/);
});

test('verify-use prints each verdict, engine refusal, and cleanup state', async t => {
  fixture(t, {ok: false, uses: [{use: 'enter', ok: true, room: 'nave', door: 'main-door'}, {use: 'sit', ok: false, reason: {code: 'verify.refused', engineCode: 'route.blocked', message: 'No passage.'}}], probe: {removed: true}, ms: 12});
  const output = await verifyUse('chapel');
  assert.match(output, /enter: OK.*nave via main-door/); assert.match(output, /sit: FAILED.*verify.refused.*route.blocked.*No passage/); assert.match(output, /probe removed; 12 ms/);
});

test('verify-use validates options before contacting the server', async t => {
  const calls = fixture(t, {});
  await assert.rejects(verifyUse(), /usage: verify-use/);
  for (const flags of [{uses: 'fly'}, {uses: 'sit,sit'}, {from: '1,no'}, {from: '1,2,3'}, {from: ',2'}]) await assert.rejects(verifyUse('chapel', flags));
  assert.equal(calls.length, 0);
});

test('repairable refusals show their op, field and concrete fix', () => {
  assert.equal(explainFailure({ op: 2, code: 'def.invalid', detail: 'profile has one point', field: 'make.args.shapes.0.profile', fix: 'lathe profile needs ≥2 points' }), 'def.invalid (op 2): profile has one point — field make.args.shapes.0.profile — fix: lathe profile needs ≥2 points');
  assert.equal(explainFailure({ op: 0, code: 'custom', detail: 'ordinary refusal' }), 'custom (op 0): ordinary refusal');
});

test('preview prints its id and concrete commit command', async (t) => {
  const calls = fixture(t, { accepted: true, id: 'preview-123', summary: { upserts: 1 } });
  const result = await preview({ ops: [{ op: 'remove', id: 'bench' }] });
  assert.equal(result.id, 'preview-123');
  assert.equal(result.commit, 'node eden-god.mjs commit preview-123');
  assert.match(result.tell, /Preview preview-123/);
  assert.match(result.tell, /commit preview-123/);
  assert.equal(JSON.parse(calls[0].body).group, 'previewed-group');
});

test('commit posts only the preview id and a fresh clientRef', async (t) => {
  const calls = fixture(t, { accepted: true, seq: 9 });
  await commit('preview-123');
  await COMMANDS.commit(['preview-123']);
  const [one, two] = calls.map((c) => JSON.parse(c.body));
  assert.equal(calls[0].url, 'https://world.invalid/v1/god/act');
  assert.deepEqual(Object.keys(one).sort(), ['clientRef', 'preview']);
  assert.equal(one.preview, 'preview-123');
  assert.notEqual(one.clientRef, two.clientRef);
  await assert.rejects(commit(), /usage: commit/);
  checkArgs('commit', {}, ['preview-123']);
  assert.throws(() => checkArgs('commit', {}, ['preview-123', 'extra']), /takes one word/);
});

test('request looks up an escaped receipt ref without writing', async (t) => {
  const receipt = { world: 'fixture', clientRef: 'ref/part', payloadHash: 'hash', seq: 9, result: { accepted: true, seq: 9 } };
  const calls = fixture(t, receipt);
  assert.deepEqual(await request('ref/part'), receipt);
  assert.equal(calls[0].url, 'https://world.invalid/v1/god/requests/ref%2Fpart');
  assert.equal(calls[0].method, 'GET');
  await assert.rejects(request(), /usage: request/);
  checkArgs('request', {}, ['ref']);
});

test('status exposes the local skill and server version tuple', async (t) => {
  fixture(t, { you: 'god', entities: 3, seq: 8, versions: { protocol: 'god/1', schema: 'god-schema/1', skill: '1.1', source: 'abc123' } });
  assert.equal(SKILL_VERSION, '1.1');
  const text = await status();
  for (const part of ['skill 1.1', 'protocol god/1', 'schema god-schema/1', 'source abc123']) assert.ok(text.includes(part), part);
});

test('answer and layer commands use receipt-protected acts with fresh refs', async (t) => {
  const calls = fixture(t, { accepted: true, seq: 9 });
  await answer('prayer-1', 'A place to rest');
  await COMMANDS.access(['bench', 'private'], {});
  assert.ok(calls.every((c) => c.url === 'https://world.invalid/v1/god/act'));
  const [one, two] = calls.map((c) => JSON.parse(c.body));
  assert.deepEqual(one.ops, [{ op: 'answer', prayer: 'prayer-1', text: 'A place to rest' }]);
  assert.notEqual(one.clientRef, two.clientRef);
});

test('group undo prints failures and both sides of a partial revert', async t => {
  fixture(t, { accepted: false, reverted: [16], notReverted: [15, 14], failed: 15, failures: [{ op: 0, code: 'occupied.by-body', detail: 'Ada occupies bench', entity: 'e_bench', field: 'def', fix: 'Wait until Ada is done.' }] });
  const text = await undo({ group: 'g' });
  assert.match(text, /incomplete/); assert.match(text, /undone edits: 16/); assert.match(text, /not undone edits: 15, 14/);
  assert.match(text, /occupied.by-body/); assert.match(text, /field def/); assert.match(text, /Wait until Ada/);
});

test('group undo never hides failures behind an accepted partial response from an older server', async t => {
  fixture(t, { accepted: true, reverted: [16], failures: [{ op: 0, code: 'undo.conflict', detail: 'edit 15 conflicts' }] });
  const text = await undo({ group: 'g' });
  assert.match(text, /incomplete/); assert.match(text, /undone edits: 16/); assert.match(text, /edit 15 conflicts/);
});

test('a complete group undo prints all reverted edits', async t => {
  fixture(t, { accepted: true, reverted: [16, 15, 14], notReverted: [] });
  assert.equal(await undo({ group: 'g' }), 'undid group "g": edits 16, 15, 14');
});

test('mirror preserves the active named definition when only an older hash-pinned revision is in use', () => {
  const old = { hash: 'old', ref: 'post@1' }, active = { hash: 'active', ref: 'post@1' };
  const v = view({ rows: [], snapshot: { defs: [old], library: [active], entities: [] } });
  assert.equal(v.def('post@1'), active); assert.equal(v.def('sha:old'), old);
});
