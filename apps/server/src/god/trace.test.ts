// RL7 server trace: bounded per-world ring of god request metadata, loop hints in build show, the `trace` verb.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono, type Context } from 'hono';
import { Db } from '../db.ts';
import { ApiError } from '../souls.ts';
import { GodMode } from './god.ts';
import { mountGodRoutes } from './routes.ts';
import { GodTrace, outcomeOf, TRACE_LIMITS, type TraceRow } from './trace.ts';
import { replayWorld, REPLAY_ORIGIN } from './replay-world.ts';
// the CLI has no type declarations; a computed specifier keeps tsc from asking for them
const CLI = '../../../../tools/god-skill/cli.mjs';

const row = (at: number, code = 'ok', extra: Partial<TraceRow> = {}): TraceRow => ({ at, method: 'POST', route: '/v1/god/act', status: 200, ms: 1, tok: 'aaaaaaaa', code, ...extra });

test('the ring is bounded, newest first, and filters by build and token', () => {
  const t = new GodTrace({ rows: 16, enabled: true, now: () => 1000 });
  for (let i = 0; i < 40; i++) t.record(row(i, 'ok', { build: i % 2 ? 'odd' : 'even', tok: i % 4 ? 'aaaaaaaa' : 'bbbbbbbb' }));
  assert.equal(t.size, 16); assert.equal(t.stats.traced, 40); assert.equal(t.stats.dropped, 24);
  assert.deepEqual(t.rows({ limit: 3 }).map(r => r.at), [39, 38, 37]);
  assert.ok(t.rows({ build: 'odd', limit: 99 }).every(r => r.build === 'odd'));
  assert.deepEqual(t.rows({ tok: 'bbbbbbbb', limit: 99 }).map(r => r.at), [36, 32, 28, 24]);
  assert.deepEqual(t.rows({ since: 35, limit: 99 }).map(r => r.at), [39, 38, 37, 36, 35]);
  t.record(row(41, 'ok', { build: 'Not A Slug!', step: 5000 })); assert.equal(t.rows({ limit: 1 })[0].build, undefined); assert.equal(t.rows({ limit: 1 })[0].step, undefined);
});

test('loop hints: the same code + field 3 or more times inside 2 minutes; repeats are counted', () => {
  let now = 0; const t = new GodTrace({ enabled: true, now: () => now });
  t.record(row(0, 'overlap.solid', { field: 'p', build: 'church' }));
  t.record(row(10_000, 'overlap.solid', { field: 'p', build: 'church', tok: 'bbbbbbbb', route: '/v1/god/dryrun' }));
  t.record(row(20_000, 'overlap.solid', { field: 'ops.0.def' }));               // another field: not the same loop
  now = 30_000; assert.deepEqual(t.loops(), []);
  t.record(row(30_000, 'overlap.solid', { field: 'p', build: 'church' }));
  const [loop] = t.loops();
  assert.deepEqual({ ...loop }, { code: 'overlap.solid', field: 'p', count: 3, firstAt: 0, lastAt: 30_000, routes: ['POST /v1/god/act', 'POST /v1/god/dryrun'], toks: ['aaaaaaaa', 'bbbbbbbb'], builds: ['church'] });
  assert.equal(t.loops({ build: 'church' }).length, 1); assert.equal(t.loops({ build: 'other' }).length, 0);
  now = 125_000; assert.deepEqual(t.loops(), [], 'outside the window the loop is over');
  assert.equal(t.stats.refused, 4); assert.equal(t.stats.repeated, 1);
  assert.equal(t.summary().repeatRefusalRate, 0.25);
});

test('outcomes come from the returned object or the thrown error, never from text', () => {
  assert.deepEqual(outcomeOf({ accepted: true, seq: 3 }, undefined, 200), { code: 'ok' });
  assert.deepEqual(outcomeOf({ accepted: false, failures: [{ op: 0, code: 'overlap.solid', field: 'p', detail: 'overlaps the secret garden' }] }, undefined, 200), { code: 'overlap.solid', field: 'p' });
  assert.deepEqual(outcomeOf({ ok: false, failures: [{ code: 'build.lease', field: 'build' }] }, undefined, 200), { code: 'build.lease', field: 'build' });
  assert.deepEqual(outcomeOf({ ok: false, reason: { code: 'verify.busy' } }, undefined, 200), { code: 'verify.busy' });
  assert.deepEqual(outcomeOf({ ok: false, code: 'rate-limited' }, new ApiError(429, 'rate-limited', 'too many'), 429), { code: 'rate-limited' });
  assert.deepEqual(outcomeOf(undefined, new Error('boom'), 500), { code: 'internal' });
  assert.deepEqual(outcomeOf(undefined, undefined, 304), { code: 'ok' });
  assert.deepEqual(outcomeOf(undefined, undefined, 404), { code: 'http.404' });
  assert.equal(outcomeOf({ accepted: false, failures: [{ code: 'x'.repeat(500) }] }, undefined, 200).code.length, TRACE_LIMITS.code);
  // fields keep their schema shape; ids, refs and keys a caller chose are masked
  assert.deepEqual(outcomeOf({ accepted: false, failures: [{ code: 'revision.stale', field: 'expect.house/secret-room' }] }, undefined, 200), { code: 'revision.stale', field: 'expect.*' });
  assert.deepEqual(outcomeOf({ accepted: false, failures: [{ code: 'revision.stale', field: 'preview.subtrees.e-123.x' }] }, undefined, 200), { code: 'revision.stale', field: 'preview.subtrees.*' });
  assert.deepEqual(outcomeOf({ accepted: false, failures: [{ code: 'schema', field: 'ops.12.param.my secret-key' }] }, undefined, 200), { code: 'schema', field: 'ops.12.param.*' });
  assert.deepEqual(outcomeOf(undefined, new ApiError(413, 'asset.budget', 'big', { field: 'core/secret@1' }), 413), { code: 'asset.budget', field: '*' });
  assert.ok(outcomeOf({ accepted: false, failures: [{ code: 'schema', field: 'a.'.repeat(300) }] }, undefined, 200).field!.length <= TRACE_LIMITS.field);
});

test('the loop window map stays bounded under many distinct live refusal keys', () => {
  const t = new GodTrace({ enabled: true, now: () => 1000 });
  for (let i = 0; i < 5000; i++) t.record(row(1000, `code.${i}`));
  assert.ok((t as unknown as { recent: Map<string, number[]> }).recent.size <= TRACE_LIMITS.keys + 1);
  for (let i = 0; i < 3; i++) t.record(row(1000, 'overlap.solid', { field: 'p' }));
  assert.equal(t.loops()[0].code, 'overlap.solid', 'a fresh loop is still seen after the map was trimmed');
});

test('recording costs about a microsecond and memory stays bounded', () => {
  const t = new GodTrace({ enabled: true }), rows = Array.from({ length: 200_000 }, (_, i) => row(i, i % 50 ? 'ok' : 'overlap.solid', { field: 'p' }));
  const t0 = performance.now(); for (const r of rows) t.record(r); const per = (performance.now() - t0) * 1000 / rows.length;
  assert.equal(t.size, TRACE_LIMITS.rows);
  assert.ok(per < 20, `record took ${per.toFixed(2)} µs per row`);
});

function bareWorld(env?: string) {
  const previous = process.env.GOD_TRACE; if (env !== undefined) process.env.GOD_TRACE = env;
  try { return replayWorld({ schema: 'genesis/1', batches: [] }); } finally { if (previous === undefined) delete process.env.GOD_TRACE; else process.env.GOD_TRACE = previous; }
}
const ask = async (w: ReturnType<typeof replayWorld>, path: string, body?: unknown, token = w.token) => {
  const r = await w.app.request(path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => null) as any };
};

test('every god request leaves one metadata row; payload text never does', async () => {
  const w = bareWorld();
  try {
    const started = await ask(w, '/v1/god/builds', { id: 'yard', title: 'A yard with SECRET-TITLE', steps: ['benches'], site: { at: [0, 0], size: [40, 40] }, brief: 'SECRET-BRIEF words' });
    assert.equal(started.data.ok, true, JSON.stringify(started.data));
    const lease = started.data.lease as string;
    const place = (name: string, note = 'SECRET-NOTE') => ask(w, '/v1/god/act', { ops: [{ op: 'place', def: 'core/bench@1', p: [2, 2], name }], note, build: { id: 'yard', lease, step: 1 } });
    assert.equal((await place('bench-a')).data.accepted, true);
    for (let i = 0; i < 3; i++) assert.equal((await place('bench-b')).data.accepted, false);
    await ask(w, '/v1/god/defs?q=SECRET-QUERY');
    assert.equal((await ask(w, '/v1/god/act', { ops: [] }, 'god_replay-1_not-a-real-token')).status, 401);
    await ask(w, '/v1/world/snapshot', undefined, ''); await ask(w, '/v1/god/query', { count: {} }, '');            // not god requests
    const t = await ask(w, '/v1/god/trace?limit=100');
    assert.equal(t.status, 200);
    const rows = t.data.rows as TraceRow[], text = JSON.stringify(t.data);
    for (const secret of ['SECRET', 'bench-a', 'bench-b', 'core/bench', 'not-a-real-token']) assert.ok(!text.includes(secret), `${secret} leaked into the trace`);
    assert.deepEqual(rows.map(r => `${r.method} ${r.route} ${r.code}`), [
      'POST /v1/god/act unauthorized', 'GET /v1/god/defs ok',
      'POST /v1/god/act overlap.solid', 'POST /v1/god/act overlap.solid', 'POST /v1/god/act overlap.solid', 'POST /v1/god/act ok', 'POST /v1/god/builds ok']);
    assert.deepEqual(rows.slice(2, 6).map(r => [r.build, r.step]), [['yard', 1], ['yard', 1], ['yard', 1], ['yard', 1]]);
    assert.equal(rows[6].build, 'yard', 'build start echoes its id');
    assert.ok(rows.slice(1).every(r => r.tok === t.data.you), 'the caller sees its own hash8');
    assert.notEqual(rows[0].tok, t.data.you); assert.match(rows[0].tok!, /^[0-9a-f]{8}$/);
    assert.ok(rows.every(r => typeof r.ms === 'number' && r.ms >= 0));
    assert.equal(t.data.stats.traced, 7); assert.equal(t.data.stats.refused, 4); assert.equal(t.data.stats.repeated, 1);
    assert.equal(t.data.loops.length, 1); assert.equal(t.data.loops[0].code, 'overlap.solid'); assert.equal(t.data.loops[0].count, 3);
    // build show carries the loop for its build; the list carries every loop in the world
    const shown = await ask(w, '/v1/god/builds/yard');
    assert.equal(shown.data.loops[0].count, 3); assert.deepEqual(shown.data.loops[0].builds, ['yard']);
    assert.equal((await ask(w, '/v1/god/builds')).data.loops.length, 1);
    // reading the trace is seen but not kept; the share of kept god requests says so
    const again = await ask(w, '/v1/god/trace?limit=1');
    assert.equal(again.data.stats.untraced, 1); assert.ok(again.data.stats.tracedShare < 1 && again.data.stats.tracedShare > 0.8);
    assert.equal((await ask(w, '/v1/god/trace?build=Bad%20Id')).status, 400);
    assert.equal((await ask(w, '/v1/god/trace?limit=0')).status, 400);
  } finally { w.close(); }
});

test('rate-limited and unknown-route god requests are traced with their codes', async () => {
  const god = new GodMode(new Db(':memory:'), { worldId: 'rl-1', ownerId: 'dev:admin', tick: () => 1, emit: () => {} });
  const app = new Hono(), user = { id: 'dev:admin', role: 'admin' as const, email: null, wallet: null, created_at: 0, last_seen: 0, invited_by: null };
  mountGodRoutes(app, { god, worldName: 'RL', requireUser: async (_c: Context) => user, soulFromBearer: () => null, baseOf: () => 'http://x.invalid', limitIp: () => {} });
  app.onError((err, c) => err instanceof ApiError ? c.json({ ok: false, code: err.code, message: err.message }, err.status as 400) : c.json({ ok: false, code: 'internal' }, 500));
  const token = god.mintFor(user, 'rl'), headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  for (let i = 0; i < 181; i++) await (await app.request('/v1/god/dryrun', { method: 'POST', headers, body: JSON.stringify({ ops: [] }) })).arrayBuffer();
  await (await app.request('/v1/god/no-such-route', { headers })).arrayBuffer();
  const rows = god.trace.rows({ limit: 3 });
  assert.deepEqual(rows.map(r => [r.route, r.status, r.code]), [['/v1/god/*', 404, 'http.404'], ['/v1/god/dryrun', 429, 'rate-limited'], ['/v1/god/dryrun', 200, 'schema']]);
  assert.equal(god.trace.loops()[0].code, 'schema', 'sixty identical schema refusals are one loop');
});

test('GOD_TRACE=0 turns the trace off; the trace verb says so', async () => {
  const w = bareWorld('0');
  try {
    await ask(w, '/v1/god/builds');
    const t = await ask(w, '/v1/god/trace');
    assert.equal(t.data.enabled, false); assert.deepEqual(t.data.rows, []); assert.equal(w.god.trace.stats.traced, 0);
  } finally { w.close(); }
});

test('the CLI: trace lists rows and loops; build show prints the LOOP line', async () => {
  const w = bareWorld(), dir = mkdtempSync(join(tmpdir(), 'god-trace-cli-')), cwd = process.cwd(), realFetch = globalThis.fetch, err = console.error;
  try {
    writeFileSync(join(dir, '.eden-god.json'), JSON.stringify({ world: REPLAY_ORIGIN, token: w.token }));
    process.chdir(dir); globalThis.fetch = w.fetch; console.error = () => {};
    const { COMMANDS } = await import(CLI) as { COMMANDS: Record<string, (r: string[], f: Record<string, unknown>) => Promise<unknown>> };
    const run = (args: string[], flags: Record<string, unknown> = {}) => COMMANDS[args[0]](args.slice(1), flags);
    await run(['build', 'start', 'yard'], { title: 'Yard', steps: 'benches', at: '0,0', size: '40,40', brief: 'benches' });
    const act = '{"ops":[{"op":"place","def":"core/bench@1","p":[3,3],"name":"twin"}]}';
    await run(['act', act]);
    for (let i = 0; i < 3; i++) assert.equal(((await run(['act', act])) as { accepted: boolean }).accepted, false);
    const shown = String(await run(['build', 'show', 'yard']));
    assert.match(shown, /LOOP ×3 in \d+ s: name\.taken via POST \/v1\/god\/act \[build yard\] — the same refusal keeps coming back; change the request/);
    const traced = String(await run(['trace'], { limit: '5' }));
    assert.match(traced, /^trace: \d+ of \d+ god requests kept .*; 3 refused, 1 of them repeats inside a loop/);
    assert.match(traced, /LOOP ×3/);
    assert.match(traced, /POST \/v1\/god\/act → name\.taken \S* ?[\d.]+ ms \[yard 1\] [0-9a-f]{8} \(you\)/);
    assert.equal(traced.split('\n').filter(l => l.startsWith('  ')).length, 5);
    const json = await run(['trace'], { build: 'yard', json: true }) as { rows: TraceRow[] };
    assert.ok(json.rows.length > 0 && json.rows.every(r => r.build === 'yard'));
    await assert.rejects(run(['trace'], { limit: 'lots' }), /--limit takes 1..1024/);
    await assert.rejects(run(['trace'], { build: 'Bad Id' }), /--build takes a build id/);
  } finally { console.error = err; globalThis.fetch = realFetch; process.chdir(cwd); rmSync(dir, { recursive: true, force: true }); w.close(); }
});
