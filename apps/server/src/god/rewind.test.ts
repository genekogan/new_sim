import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { Hono } from 'hono';
import { Db } from '../db.ts';
import { ApiError } from '../souls.ts';
import { GodMode, type GodEvent, type WorldDiffMessage, type WorldBuildMessage } from './god.ts';
import { mountGodRoutes } from './routes.ts';
import type { BuildBody, BuildField } from './builds.ts';
import { godSchema } from './schema.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Decor parts keep these tests about rewind bookkeeping rather than support/collision rules.
const partDef = { schema: 'def/1', name: 'part', size: { box: [1, 1, 1] }, layer: 'decor', make: { kind: 'gen', gen: 'kit/2', args: { shapes: [{ kind: 'box', at: [0, 0, 0], size: [1, 1, 1] }] } } };
const place = (name: string, x = 0, z = 0, parent = 'world') => ({ op: 'place', def: 'part@1', name, p: [x, z], in: { parent } });
const code = (r: any) => r.failures?.[0]?.code;
const accepted = (r: any) => { assert.equal(r.accepted, true, JSON.stringify(r)); return r; };

function fixture() {
  const db = new Db(':memory:'), emitted: (WorldDiffMessage | WorldBuildMessage)[] = [], events: GodEvent[] = []; let now = 1_000_000;
  const god = new GodMode(db, { worldId: 'rewind', ownerId: 'owner', tick: () => 0, now: () => now, buildPauseMs: 50, buildClosureMs: 500, assetDir: join(tmpdir(), 'y5-rewind-assets'), emit: (m: WorldDiffMessage | WorldBuildMessage) => emitted.push(m) });
  const tokens = ['lead', 'helper', 'owner-panel'].map(label => god.mintFor({ id: 'owner', role: 'user' }, label)), ids = tokens.map(t => god.godIdentity(t)!);
  god.subscribe(0, e => events.push(e));
  accepted(god.act({ ops: [{ op: 'define', def: partDef }] }));
  const app = new Hono(); mountGodRoutes(app, { god, worldName: 'Rewind', requireUser: async () => { throw new ApiError(401, 'unauthorized', 'owner only'); }, soulFromBearer: () => null, baseOf: () => 'http://127.0.0.1:5364', limitIp: () => {} });
  app.onError((e, c) => e instanceof ApiError ? c.json({ ok: false, code: e.code, ...e.extra }, e.status as 400) : c.json({ internal: String(e) }, 500));
  const raw = async (path: string, data?: unknown, who: number | null = 0) => app.request(path, { method: data === undefined ? 'GET' : 'POST', headers: { ...(who === null ? {} : { authorization: `Bearer ${tokens[who]}` }), 'content-type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const req = async (path: string, data?: unknown, who = 0) => { const r = await raw(path, data, who); assert.equal(r.status, 200, await r.clone().text()); assert.equal(r.headers.get('cache-control'), 'no-store'); return await r.json() as any; };
  const started = god.builds.start({ id: 'church', title: 'Church', steps: ['shell', 'roof', 'towers', 'interior', 'garden'], site: { at: [0, 0], size: [200, 200] } }, ids[0]) as any; assert.equal(started.ok, true);
  const lead = (step: number, extra = {}): BuildField => ({ id: 'church', lease: started.lease, step, ...extra });
  const act = (ops: unknown[], build?: BuildField, who = 0, extra = {}) => req('/v1/god/act', { ops, ...(build ? { build } : {}), ...extra }, who);
  const rewind = (data: unknown, who = 2) => req('/v1/god/builds/church/rewind', data, who);
  const body = (): BuildBody => JSON.parse(god.store.build('church')!.body);
  const state = () => JSON.stringify([god.model.snapshot(), god.store.edits(200), god.store.buildsRev(), god.store.build('church'), emitted.length]);
  return { db, god, raw, req, act, rewind, lead, body, state, emitted, events, ids, started, now: () => now, advance: (ms: number) => { now += ms; } };
}
/** shell (1) · roof-1, roof-2 (2) · tower + tower/bell (3). Returns each edit's seq. */
async function threeSteps(f: ReturnType<typeof fixture>) {
  const seq = async (ops: unknown[], step: number) => accepted(await f.act(ops, f.lead(step))).seq as number;
  return { shell: await seq([place('shell')], 1), roof1: await seq([place('roof-1', 10)], 2), roof2: await seq([place('roof-2', 12)], 2), tower: await seq([place('tower', 30)], 3), bell: await seq([place('bell', 0, 0, 'tower')], 3) };
}

test('Y5: rewind to after step k reverts later steps atomically, keeps the build open at step k and re-arms closure', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const s = await threeSteps(f);
  f.advance(600); f.god.builds.sweep();
  assert.ok(f.body().closureLapsedAt); assert.equal(f.god.builds.publicList().builds[0].closed, false);
  // --dry: the same summary, and nothing at all changes.
  const before = f.state();
  const dry = await f.rewind({ to: 1, dry: true });
  assert.equal(dry.ok, true); assert.equal(dry.dry, true); assert.equal(f.state(), before);
  assert.deepEqual(dry.rewind.edits, [s.bell, s.tower, s.roof2, s.roof1]);
  assert.equal(dry.rewind.removes.count, 4); assert.deepEqual(dry.rewind.removes.names, ['roof-1', 'roof-2', 'tower']);
  assert.deepEqual(dry.rewind.steps.map((x: any) => x.n), [2, 3]); assert.equal(dry.rewind.from, 3); assert.equal(dry.rewind.to, 1);
  const rev = f.god.store.buildsRev();
  const r = await f.rewind({ to: 1 });
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.dry, undefined);
  assert.deepEqual({ ...r.rewind }, { ...dry.rewind });
  assert.ok(f.god.model.get('shell')); for (const gone of ['roof-1', 'roof-2', 'tower', 'tower/bell']) assert.equal(f.god.model.get(gone), undefined, gone);
  // One journal row per reverted edit, newest first, all in one transaction (a single build revision step per row).
  const undos = f.god.store.edits(10).filter(e => e.kind === 'undo');
  assert.deepEqual(undos.map(e => e.undo_of).reverse(), [s.bell, s.tower, s.roof2, s.roof1]);
  assert.equal(f.god.store.buildsRev(), rev + 4);
  const b = f.body();
  assert.deepEqual([b.step.n, b.step.label, b.step.seq], [1, 'shell', s.shell]); assert.ok(b.steps.every(x => x.n <= 1));
  // The lead went quiet before the owner's rewind: the record stays open and paused (no faked liveness), closure re-armed.
  assert.equal(f.god.store.build('church')!.status, 'paused');
  assert.equal(b.lastBatchAt, f.now()); assert.equal(b.closureLapsedAt, undefined);
  const site = f.god.builds.publicList().builds[0]; assert.equal(site.closed, true); assert.equal(site.reopensAt, f.now() + 500); assert.equal(site.step.n, 1);
  assert.deepEqual(b.rewinds, [{ at: f.now(), to: 1, from: 3, edits: 4, removed: 4, byLabel: 'owner-panel' }]);
  assert.equal(b.say!.text, 'Rewound to step 1: shell'); assert.deepEqual(b.designing, []); assert.deepEqual(b.stepCalls, []);
  // Viewers hear the chain as diffs with the record's last delta; gods get a 'rewound' notice.
  const delta = (f.emitted.at(-1) as WorldDiffMessage).builds!.at(-1)!; assert.equal(delta.step!.n, 1); assert.equal(delta.closed, true); assert.equal(delta.say!.text, b.say!.text);
  assert.equal((f.events.filter(e => e.event === 'build').at(-1)!.data as any).kind, 'rewound');
  // The next step announcement applies (no stale replay key) and redo still works on the open build.
  assert.equal((await f.req('/v1/god/builds/church/step', { lease: f.started.lease, n: 2, say: 'Roof again' })).build.step.n, 2);
  for (let i = 0; i < 4; i++) accepted(f.god.redo());
  for (const back of ['roof-1', 'roof-2', 'tower', 'tower/bell']) assert.ok(f.god.model.get(back), back);
  assert.equal(f.god.store.build('church')!.status, 'active', 'the lead\'s step call resumed it; redo keeps it open');
  assert.ok(f.body().roots.includes(f.god.model.get('tower')!.id), 'redone parts are adopted by the still-open site');
});

test('Y5: helpers — steps attribute interleaved claim edits by group; a live claim refuses unless forced', async t => {
  const f = fixture(); t.after(() => f.db.close());
  accepted(await f.act([place('shell')], f.lead(1)));
  const c = await f.req('/v1/god/builds/church/claims', { part: 'east', root: 'shell' }, 1); assert.equal(c.ok, true);
  const helper = (step: number): BuildField => ({ id: 'church', claim: c.claim.id, step });
  const roof = accepted(await f.act([place('roof', 40)], f.lead(2))).seq;
  const wall = accepted(await f.act([place('east-wall', 5, 0, 'shell')], helper(2), 1)).seq;
  const tower = accepted(await f.act([place('tower', 60)], f.lead(3))).seq;
  const door = accepted(await f.act([place('east-door', 6, 0, 'shell')], helper(2), 1)).seq;
  const spire = accepted(await f.act([place('east-spire', 7, 0, 'shell')], helper(3), 1)).seq;
  const tower2 = accepted(await f.act([place('tower-2', 70)], f.lead(3))).seq;
  // The lead's step-3 range now spans the helper's later step-2 door: only the group tells them apart.
  const leadRange = f.body().steps.find(x => x.n === 3 && !x.claim)!; assert.ok(leadRange.firstSeq < door && door < leadRange.lastSeq);
  const before = f.state();
  const held = await f.rewind({ to: 2 }); assert.equal(code(held), 'build.claimed'); assert.deepEqual(held.edits, [tower2, spire, tower]); assert.equal(f.state(), before);
  const r = await f.rewind({ to: 2, force: true }); assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.rewind.edits, [tower2, spire, tower]); assert.deepEqual(r.rewind.removes.names, ['shell/east-spire', 'tower', 'tower-2']);
  for (const kept of ['shell', 'roof', 'shell/east-wall', 'shell/east-door']) assert.ok(f.god.model.get(kept), kept);
  assert.deepEqual([roof, wall].every(seq => !f.god.store.edits(50).find(e => e.seq === seq)!.undone), true);
  const b = f.body(), claim = b.claims.find(x => x.id === c.claim.id)!;
  assert.equal(claim.status, 'released'); assert.deepEqual(claim.step, { n: 2, label: b.steps.find(x => x.claim === claim.id && x.n === 2)!.label });
  assert.ok(b.steps.every(x => x.n <= 2)); assert.equal(b.step.n, 2);
  assert.deepEqual(claim.made.filter(id => !f.god.model.entities.has(id)), [], 'removed parts leave the retained claim');
});

test('Y5: a later edit outside the build that depends on rewound work refuses with field and fix; earlier and unrelated edits do not', async t => {
  const f = fixture(); t.after(() => f.db.close());
  accepted(await f.act([place('oak', 150, 150)]));
  accepted(await f.act([place('rename-me', 160, 150)]));
  await threeSteps(f);
  // An outside rename made BEFORE step 4 moved the oak is restored with it, not refused.
  accepted(await f.act([{ op: 'set', id: 'oak', name: 'old-oak' }]));
  assert.equal((await f.req('/v1/god/builds/church/step', { lease: f.started.lease, include: ['old-oak'] })).ok, true);
  accepted(await f.act([{ op: 'move', id: 'old-oak', p: [140, 150] }], f.lead(4)));
  accepted(await f.act([{ op: 'set', id: 'rename-me', name: 'unrelated' }]));
  accepted(await f.act([{ op: 'set', id: 'roof-1', name: 'kept-roof' }]));
  // Each of these makes a step-3 part carry later outside work.
  for (const [label, op, verb] of [['rename', { op: 'set', id: 'tower', name: 'tall-tower' }, 'remove'], ['child', place('lamp', 0, 0, 'tower'), 'remove']] as const) {
    const outside = accepted(await f.act([op])), before = f.state();
    const r = await f.rewind({ to: 2 });
    assert.equal(code(r), 'build.depends', label); assert.equal(f.state(), before, label);
    const failure = r.failures[0];
    assert.equal(failure.field, 'to'); assert.equal(failure.measured.seq, outside.seq); assert.equal(failure.limit.to, 3);
    assert.match(failure.detail, new RegExp(`edit ${outside.seq} \\(ungrouped\\).*would ${verb} it`)); assert.match(failure.fix, /Rewind to step 3 or later, or undo edit \d+ first \(`undo`/);
    accepted(f.god.undo());
  }
  const r = await f.rewind({ to: 2 }); assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(f.god.model.get('tower'), undefined); assert.ok(f.god.model.get('kept-roof')); assert.ok(f.god.model.get('unrelated'));
  const oak = f.god.model.get('old-oak')!; assert.deepEqual([oak.p![0], oak.p!.at(-1)], [150, 150], 'moved back, keeping the earlier outside rename');
});

test('Y5: an outside undo of an edit made before a reverted edit refuses; the rewind would put that edit back', async t => {
  const f = fixture(); t.after(() => f.db.close());
  accepted(await f.act([place('oak', 150, 150)]));
  await threeSteps(f);
  const early = accepted(await f.act([{ op: 'set', id: 'oak', name: 'renamed-oak' }], undefined, 0, { group: 'misc' })).seq;
  assert.equal((await f.req('/v1/god/builds/church/step', { lease: f.started.lease, include: ['renamed-oak'] })).ok, true);
  accepted(await f.act([{ op: 'set', id: 'renamed-oak', name: 'build-oak' }], f.lead(4)));
  const undone = f.god.undoGroup('misc'); assert.equal(undone.accepted, true); assert.ok(f.god.model.get('oak'), 'the outside undo restored the first name');
  const before = f.state(), r = await f.rewind({ to: 3 });
  assert.equal(code(r), 'build.depends'); assert.equal(f.state(), before);
  assert.equal(r.failures[0].measured.kind, 'undo'); assert.equal(r.failures[0].measured.dependsOn > early, true); assert.match(r.failures[0].fix, new RegExp(`redo edit ${early} first \\(\`redo\` while undo \\d+ is the newest undo\\)`));
});

test('Y5: a kept later edit of the build that builds on rewound work refuses with the subgroup to undo', async t => {
  const f = fixture(); t.after(() => f.db.close());
  await threeSteps(f);
  const c = await f.req('/v1/god/builds/church/claims', { part: 'belfry', root: 'tower' }, 1); assert.equal(c.ok, true);
  const bell = accepted(await f.act([place('rope', 1, 0, 'tower')], { id: 'church', claim: c.claim.id, step: 2 }, 1)).seq;
  assert.equal((await f.req(`/v1/god/builds/church/claims/${c.claim.id}/release`, { done: true }, 1)).ok, true);
  const before = f.state(), r = await f.rewind({ to: 2 });
  assert.equal(code(r), 'build.depends'); assert.equal(f.state(), before);
  assert.match(r.failures[0].detail, new RegExp(`kept edit ${bell} of this build \\(church/belfry\\)`));
  assert.match(r.failures[0].fix, /undo --group church\/belfry/);
  assert.equal((await f.rewind({ to: 3 })).ok, true, 'rewinding to the depended step is accepted');
});

test('Y5 panel: undoing an open build\'s whole group keeps it open at the start with closure re-armed; finished builds are unchanged', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const s = await threeSteps(f);
  f.advance(600); f.god.builds.sweep();
  const r = await f.req('/v1/god/undo?group=church', {}, 2);
  accepted(r); assert.deepEqual(r.reverted, [s.bell, s.tower, s.roof2, s.roof1, s.shell]); assert.deepEqual(r.notReverted, []);
  assert.equal(r.rewound.to, 0); assert.equal(r.rewound.removes.count, 5);
  const b = f.body(); assert.equal(f.god.store.build('church')!.status, 'paused', 'open; the quiet lead is not revived'); assert.deepEqual(b.steps, []); assert.deepEqual([b.step.n, b.step.label], [1, 'shell']);
  assert.equal(f.god.builds.publicList().builds[0].closed, true); assert.equal(b.say!.text, 'Rewound to the start');
  assert.equal(f.god.model.get('shell'), undefined);
  for (let i = 0; i < 5; i++) accepted(f.god.redo());
  assert.ok(f.god.model.get('tower/bell')); assert.equal(f.god.store.build('church')!.status, 'paused');
  assert.equal(f.body().roots.length, 4, 'redone tops are adopted again');
  assert.equal((await f.req('/v1/god/builds/church/done', {})).ok, true);
  const done = await f.req('/v1/god/undo?group=church', {}, 2); accepted(done); assert.equal(done.rewound, undefined);
  assert.equal(f.god.store.build('church')!.status, 'done'); assert.equal(f.god.model.get('shell'), undefined);
});

test('Y5: an injected mid-chain failure or a preflight conflict changes nothing, and a retry succeeds', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const s = await threeSteps(f), before = f.state(), owner = f.ids[2];
  f.db.db.exec(`CREATE TEMP TRIGGER fail_rewind BEFORE INSERT ON world_edits_v1 WHEN NEW.kind='undo' AND NEW.undo_of=${s.roof2} BEGIN SELECT RAISE(ABORT, 'injected rewind failure'); END;`);
  assert.throws(() => f.god.as({ identity: owner }, () => f.god.rewind('church', { to: 1 })), /injected rewind failure/);
  assert.equal(f.state(), before); assert.equal(f.god.store.load()!.model.get('tower')?.name, 'tower');
  f.db.db.exec('DROP TRIGGER fail_rewind');
  let calls = 0; f.god.bodies = { uses: () => null, refuse: () => ++calls === 2 ? { op: -1, code: 'occupied.by-body', detail: 'seated' } : null };
  const busy = f.god.as({ identity: owner }, () => f.god.rewind('church', { to: 1 })) as any;
  assert.equal(code(busy), 'occupied.by-body'); assert.equal(busy.failed, s.tower); assert.equal(f.state(), before);
  f.god.bodies = null;
  assert.equal((f.god.as({ identity: owner }, () => f.god.rewind('church', { to: 1 })) as any).ok, true); assert.equal(f.god.model.get('tower'), undefined);
});

test('Y5: validation, closed builds, idempotent replay, step-only rewind and lead liveness', async t => {
  const f = fixture(); t.after(() => f.db.close());
  await threeSteps(f);
  const far = await f.rewind({ to: 4 }); assert.equal(code(far), 'build.rewind'); assert.equal(far.failures[0].field, 'to'); assert.equal(far.failures[0].limit, 3);
  for (const bad of [{ to: -1 }, { to: 1.5 }, {}, { to: 1, extra: true }]) assert.equal(code(await f.rewind(bad)), 'schema');
  assert.equal(code(await f.req('/v1/god/builds/nope/rewind', { to: 0 }, 2)), 'build.unknown');
  assert.equal((await f.raw('/v1/god/builds/church/rewind', { to: 1 }, null)).status, 401);
  // The owner's panel rewinds without making the lead look alive; a live lead is named in a warning.
  const leadAt = f.god.store.build('church')!.last_at;
  const owner = await f.rewind({ to: 2 }); assert.equal(owner.ok, true); assert.match(owner.warnings.join(), /lead lead is live; it should run build resume church/);
  assert.equal(f.god.store.build('church')!.last_at, leadAt);
  const rev = f.god.store.buildsRev(), replay = await f.rewind({ to: 2 }); assert.equal(replay.replayed, true); assert.equal(f.god.store.buildsRev(), rev);
  // Announced-but-empty steps move back without a journal row.
  assert.equal((await f.req('/v1/god/builds/church/step', { lease: f.started.lease, n: 4, say: 'Designing the interior' })).build.step.n, 4);
  const seq = f.god.model.editSeq; f.advance(100);
  const stepOnly = await f.rewind({ to: 3 }, 0); assert.equal(stepOnly.ok, true); assert.deepEqual(stepOnly.rewind.edits, []);
  assert.equal(f.god.model.editSeq, seq); assert.deepEqual([f.body().step.n, f.body().step.label], [3, 'towers']);
  assert.equal((f.emitted.at(-1) as WorldBuildMessage).event, 'rewound');
  assert.equal(f.god.store.build('church')!.last_at, f.now(), 'the lead\'s own rewind refreshes its liveness');
  assert.equal(f.body().rewinds!.length, 2);
  assert.equal((await f.req('/v1/god/builds/church/done', {})).ok, true);
  const closed = await f.rewind({ to: 1 }); assert.equal(code(closed), 'build.closed'); assert.match(closed.failures[0].fix, /build continue church/);
  const schema = godSchema(f.god.model.constants.limits) as any;
  assert.ok(schema.builds.actions.rewind); assert.ok(schema.endpoints.god.includes('POST /v1/god/builds/:id/rewind'));
  for (const c of ['build.rewind', 'build.depends']) assert.ok(schema.refusals.includes(c), c);
});

test('Y5 measure: rewinding most of a 60-edit build is one bounded call', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const lead = f.ids[0];
  for (let step = 1; step <= 5; step++) for (let i = 0; i < 12; i++) accepted(f.god.as({ identity: lead }, () => f.god.act({ ops: [place(`p-${step}-${i}`, step * 12 - 60, i * 4 - 24)], build: f.lead(step) })));
  let t0 = performance.now(); const dry = f.god.as({ identity: f.ids[2] }, () => f.god.rewind('church', { to: 2, dry: true })) as any; const dryMs = performance.now() - t0;
  t0 = performance.now(); const r = f.god.as({ identity: f.ids[2] }, () => f.god.rewind('church', { to: 2 })) as any; const ms = performance.now() - t0;
  assert.equal(dry.ok, true); assert.equal(r.ok, true); assert.equal(r.rewind.edits.length, 36); assert.equal(r.rewind.removes.count, 36);
  assert.equal(f.god.model.entities.size, 24);
  console.log('REWIND_BENCH ' + JSON.stringify({ edits: 60, reverted: 36, dryMs: Math.round(dryMs), commitMs: Math.round(ms) }));
  assert.ok(ms < 30_000, `rewind took ${ms} ms`);
});
