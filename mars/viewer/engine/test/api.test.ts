// Engine API controller (spec §13, §15, §16, §24): the same op registry drives
// in-process calls and the Durable Object's engine_* MCP tools.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { createController, engineTools, ENGINE_SCENES, opSchemas, seedHistory, sliceTake, type EngineController, type StoredPlan } from '../api/index.ts';
import { WorldHistory } from '../history/store.ts';
import { hashOf, stableStringify } from '../core/hash.ts';
import { sampleTake } from '../take/replay.ts';
import type { Take } from '../take/types.ts';
import { crossBindings, crossTemplate, minuteBindings, minuteTemplate } from './sequence-fixtures.ts';

const TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
/** Structural JSON Schema check (no validator dependency): known types, well-formed properties/required/items/combinators. */
function checkSchema(s: unknown, path = '#'): string[] {
  if (s === true || s === false) return [];
  if (!s || typeof s !== 'object' || Array.isArray(s)) return [`${path}: schema must be an object`];
  const o = s as Record<string, any>;
  const out: string[] = [];
  if (o.type !== undefined) for (const t of [o.type].flat()) if (!TYPES.has(t)) out.push(`${path}: bad type ${t}`);
  if (o.properties !== undefined) {
    if (typeof o.properties !== 'object') out.push(`${path}: properties must be an object`);
    else for (const [k, v] of Object.entries(o.properties)) out.push(...checkSchema(v, `${path}/properties/${k}`));
  }
  if (o.required !== undefined && (!Array.isArray(o.required) || o.required.some((r: unknown) => typeof r !== 'string' || !(o.properties && r in o.properties))))
    out.push(`${path}: required must list declared properties`);
  if (o.items !== undefined) out.push(...checkSchema(o.items, `${path}/items`));
  if (o.prefixItems !== undefined) (o.prefixItems as unknown[]).forEach((x, i) => out.push(...checkSchema(x, `${path}/prefixItems/${i}`)));
  if (o.additionalProperties !== undefined) out.push(...checkSchema(o.additionalProperties, `${path}/additionalProperties`));
  for (const k of ['anyOf', 'oneOf', 'allOf'])
    if (o[k] !== undefined) {
      if (!Array.isArray(o[k])) out.push(`${path}: ${k} must be an array`);
      else o[k].forEach((x: unknown, i: number) => out.push(...checkSchema(x, `${path}/${k}/${i}`)));
    }
  if (o.$defs) for (const [k, v] of Object.entries(o.$defs)) out.push(...checkSchema(v, `${path}/$defs/${k}`));
  if (o.$ref !== undefined && typeof o.$ref !== 'string') out.push(`${path}: $ref must be a string`);
  return out;
}

const fresh = () => {
  const c = createController({ history: seedHistory(), scenes: ENGINE_SCENES });
  assert.ok(c.call('fork', { from: 'proving-ground', name: 'ws' }).ok);
  return c;
};
const bind = (c: EngineController, template: unknown, bindings: unknown, workspace = 'ws') => {
  const r = c.call('bind_plan', { template, bindings, workspace });
  assert.ok(r.ok, JSON.stringify(r));
  return r.plan_id as string;
};

test('api: list_verbs exposes every registry verb with a valid JSON Schema generated from its zod schema', () => {
  const c = fresh();
  const r = c.call('list_verbs', {}) as any;
  assert.ok(r.ok);
  const verbs = r.verbs.map((v: any) => v.verb);
  for (const v of ['walk_to', 'carry', 'raise_upright', 'connect_beam', 'release_support', 'install_joist', 'install_plywood', 'install_stair_flight', 'install_tread']) assert.ok(verbs.includes(v), v);
  for (const v of r.verbs) {
    assert.equal(v.inputSchema.type, 'object', v.verb);
    assert.match(v.inputSchema.$schema, /json-schema\.org/);
    assert.deepEqual(checkSchema(v.inputSchema), [], v.verb);
    assert.deepEqual(JSON.parse(JSON.stringify(v.inputSchema)), v.inputSchema, 'plain JSON');
    assert.ok(v.description.length > 10);
  }
  assert.deepEqual(checkSchema(r.templateJsonSchema), []);
  // MCP tool descriptors come from the same op schemas
  const tools = engineTools();
  assert.deepEqual(tools.map((t) => t.op).sort(), Object.keys(opSchemas).sort());
  for (const t of tools) {
    assert.match(t.name, /^engine_[a-z_]+$/);
    const js = z.toJSONSchema(t.inputSchema, { unrepresentable: 'any', io: 'input' });
    assert.equal((js as any).type, 'object', t.name);
    assert.deepEqual(checkSchema(js), [], t.name);
  }
});

test('api: bind → rehearse → execute → get_take (60 s, 3 walkers) — rehearsal and execution produce the same take', () => {
  const c = fresh();
  const plan = bind(c, minuteTemplate, minuteBindings);
  let t0 = performance.now();
  const reh = c.call('rehearse', { plan_id: plan }) as any;
  const rehMs = performance.now() - t0;
  assert.ok(reh.ok, JSON.stringify(reh.report?.diagnostics));
  assert.equal(reh.stale, undefined);
  assert.ok(reh.report.metrics.duration > 50, `${reh.report.metrics.duration} s`);
  const headBefore = c.history.head('ws').id;
  assert.equal(c.history.head('ws').id, headBefore, 'rehearsal never moves the head');
  t0 = performance.now();
  const ex = c.call('execute', { plan_id: plan, workspace: 'ws', label: 'minute walk' }) as any;
  const exMs = performance.now() - t0;
  assert.ok(ex.ok, ex.message);
  assert.equal(ex.take_id, reh.take.take_id, 'identical take id');
  assert.equal(ex.checkpoint.parent, headBefore);
  assert.deepEqual(ex.checkpoint.cause, { kind: 'simulation-run', take: ex.take_id, plan });
  const log = c.call('log', { workspace: 'ws' }) as any;
  assert.equal(log.head, ex.checkpoint.id);
  console.log(`  minute walk: rehearse ${rehMs.toFixed(0)} ms, execute ${exMs.toFixed(0)} ms, take ${ex.take.bytes} B, ${ex.take.samples} samples, ${reh.report.metrics.duration} s simulated`);
  // compact slice: sampling the slice equals sampling the full take within range
  const full = c.take(ex.take_id)!;
  const sl = c.call('get_take', { take_id: ex.take_id, from: 10, to: 20 }) as any;
  assert.ok(sl.ok);
  assert.equal(sl.finalState, undefined);
  assert.deepEqual(sl.range, { from: 200, to: 400 });
  const asTake = { ...full, tracks: sl.tracks, changes: sl.changes, events: sl.events } as Take;
  for (const t of [10, 12.34, 15, 19.95, 20]) assert.deepEqual(sampleTake(asTake, t), sampleTake(full, t), `t=${t}`);
  assert.ok(stableStringify(sl).length < stableStringify(full).length / 2, 'slice is compact');
  const withFinal = c.call('get_take', { take_id: ex.take_id, include: ['final'] }) as any;
  assert.equal(hashOf(withFinal.finalState), full.finalStateHash);
  assert.equal(c.call('get_take', { take_id: 'nope' }).code, 'take.unknown');
});

test('api: stale plans and protected canonical workspaces are refused with diagnostics', () => {
  const c = fresh();
  const plan = bind(c, crossTemplate, crossBindings);
  const prot = c.call('execute', { plan_id: plan, workspace: 'proving-ground' });
  assert.equal(prot.ok, false);
  assert.equal(prot.code, 'workspace.protected');
  assert.match(String(prot.message), /fork/);
  assert.ok(c.call('execute', { plan_id: plan, workspace: 'ws' }).ok);
  const stale = c.call('execute', { plan_id: plan, workspace: 'ws' }) as any;
  assert.equal(stale.code, 'plan.stale');
  assert.ok(stale.diff.changed.some((d: any) => d.id === 'n1' && d.fields.includes('pose')));
  assert.match(stale.message, /n1 changed \(pose\)/);
  // rehearsal still runs from its own baseline and flags the staleness
  const reh = c.call('rehearse', { plan_id: plan }) as any;
  assert.ok(reh.ok);
  assert.equal(reh.stale.code, 'plan.stale');
  // bad inputs fail loudly, all binding problems at once
  assert.equal(c.call('rehearse', { plan_id: 'x'.repeat(24) }).code, 'plan.unknown');
  assert.equal(c.call('execute', { plan_id: plan }).code, 'op.invalid-input');
  assert.equal(c.call('nope', {}).code, 'op.unknown');
  const badBind = c.call('bind_plan', { template: crossTemplate, bindings: { crew: ['n1', 'ghost', 'panel'], deck: [10, 10] }, workspace: 'ws' }) as any;
  assert.equal(badBind.ok, false);
  assert.deepEqual(badBind.diagnostics.map((d: any) => d.code).sort(), ['plan.not-an-actor', 'plan.unknown-entity']);
  assert.equal(c.call('fork', { from: 'proving-ground', name: 'ws' }).code, 'exists');
});

test('api: take replay is independent of camera track attachment', () => {
  const c = fresh();
  const plan = bind(c, crossTemplate, crossBindings);
  const ex = c.call('execute', { plan_id: plan, workspace: 'ws' }) as any;
  assert.ok(ex.ok);
  const before = c.call('get_take', { take_id: ex.take_id, include: ['events', 'changes', 'final'] }) as any;
  const hash = c.takes.takeHash(ex.take_id);
  const cam1 = c.call('attach_camera_track', { take_id: ex.take_id, shot: { kind: 'follow', subject: 'n1', offset: [-6, 2.5, 0], frame: 'world' } }) as any;
  const cam2 = c.call('attach_camera_track', { take_id: ex.take_id, track_id: 'wide', shot: { kind: 'frameGroup', subjects: ['n1', 's1'], azimuth: Math.PI / 2, elevation: 0.5 } }) as any;
  assert.ok(cam1.ok && cam2.ok, JSON.stringify([cam1.report, cam2.report]));
  assert.ok(cam1.takeHashUnchanged && cam2.takeHashUnchanged);
  assert.equal(c.takes.takeHash(ex.take_id), hash);
  const after = c.call('get_take', { take_id: ex.take_id, include: ['events', 'changes', 'final'] }) as any;
  const { cameras: cb, ...b } = before, { cameras: ca, ...a } = after;
  assert.deepEqual(a, b, 'take slice identical after attaching cameras');
  assert.deepEqual(cb, []);
  assert.deepEqual(ca.map((x: any) => x.id).sort(), [cam1.track_id, 'wide'].sort());
  const withCams = c.call('get_take', { take_id: ex.take_id, include: ['cameras'] }) as any;
  assert.equal(withCams.cameras.length, 2);
  assert.ok(withCams.cameras[0].data.samples.length > 10);
  // a shot naming a subject that isn't in the take fails loudly
  const bad = c.call('attach_camera_track', { take_id: ex.take_id, shot: { kind: 'follow', subject: 'ghost', offset: [-6, 2, 0] } });
  assert.equal(bad.ok, false);
});

test('api: query_world — filters, levels/links, route and carry previews use the verbs’ own planners', () => {
  const c = fresh();
  const all = c.call('query_world', {}) as any;
  assert.deepEqual(all.workspaces.map((w: any) => w.id).sort(), ['carry-yard', 'proving-ground', 'ws']);
  const q = c.call('query_world', { workspace: 'ws', kind: 'human', region: { min: [10, -25], max: [20, -5] }, include: ['levels', 'links', 'stability'], route: { actor: 'p1', x: 10, z: 10, level: 1 } }) as any;
  assert.deepEqual(q.entities.map((e: any) => e.id), ['n1', 's1']);
  assert.deepEqual(q.levels.map((l: any) => l.id), [0, 1]);
  assert.deepEqual(q.links.find((l: any) => l.id === 'stairs-b'), { ...q.links.find((l: any) => l.id === 'stairs-b'), usable: false });
  assert.ok(q.route.ok && q.route.legs.some((l: any) => l.kind === 'link' && l.link === 'stairs-a'), JSON.stringify(q.route));
  assert.deepEqual(q.stability, []);
  const blocked = c.call('query_world', { workspace: 'ws', route: { actor: 'p1', x: -15, z: -15 } }) as any;
  assert.equal(blocked.route.ok, false);
  assert.equal(blocked.route.diagnostic.code, 'route.goal-blocked');
  const cy = c.call('query_world', { workspace: 'carry-yard', carry: { crew: ['p1', 'p2'], item: 'b1', to: { x: 18, z: 11, yaw: Math.PI / 2 } } }) as any;
  assert.ok(cy.carry.ok, JSON.stringify(cy.carry));
  assert.ok(cy.carry.rotation > 1.4 && cy.carry.path.length > 5);
  const hist = hashOf(c.history.toJSON());
  c.call('query_world', { workspace: 'carry-yard', carry: { crew: ['p1'], item: 'b1', to: { x: 18, z: 11, yaw: 0 } } });
  assert.equal(hashOf(c.history.toJSON()), hist, 'previews never mutate history');
});

test('api: persisted state round-trips through JSON with lazy take/plan/camera loaders', () => {
  const c = fresh();
  const plan = bind(c, crossTemplate, crossBindings);
  const ex = c.call('execute', { plan_id: plan, workspace: 'ws' }) as any;
  c.call('attach_camera_track', { take_id: ex.take_id, track_id: 'f', shot: { kind: 'follow', subject: 's1', offset: [-6, 2, 0], frame: 'world' } });
  const ch = c.drainChanges();
  assert.equal(ch.history, true);
  assert.deepEqual(ch.plans, [plan]);
  assert.deepEqual(ch.takes, [ex.take_id]);
  assert.deepEqual(ch.cameras, [ex.take_id]);
  const db = new Map<string, string>();
  db.set('history', JSON.stringify(c.history.toJSON()));
  db.set(`plan:${plan}`, JSON.stringify(c.plans.get(plan)));
  db.set(`take:${ex.take_id}`, JSON.stringify(c.take(ex.take_id)));
  db.set(`cams:${ex.take_id}`, JSON.stringify(c.cameras(ex.take_id)));
  const get = <T>(k: string) => (db.has(k) ? (JSON.parse(db.get(k)!) as T) : undefined);
  const c2 = createController({
    history: WorldHistory.fromJSON(get('history')!),
    scenes: ENGINE_SCENES,
    store: { loadTake: (id) => get<Take>(`take:${id}`), loadPlan: (id) => get<StoredPlan>(`plan:${id}`), loadCameras: (id) => get(`cams:${id}`) },
  });
  assert.equal(c2.history.head('ws').id, c.history.head('ws').id);
  const t2 = c2.call('get_take', { take_id: ex.take_id, include: ['cameras'] }) as any;
  assert.ok(t2.ok);
  assert.deepEqual(t2.cameras.map((x: any) => x.id), ['f']);
  assert.equal(c2.call('execute', { plan_id: plan, workspace: 'ws' }).code, 'plan.stale', 'plan loaded lazily, still bound to its baseline');
  assert.deepEqual(sliceTake(c2.take(ex.take_id)!, 0, 10).tracks, sliceTake(c.take(ex.take_id)!, 0, 10).tracks);
});

test('api: pathological inputs (5,000-deep nesting, 1 MB array) return input.invalid instead of throwing', () => {
  const c = fresh();
  let deep: unknown = { leaf: 1 };
  for (let i = 0; i < 5000; i++) deep = { n: deep };
  let r: any;
  assert.doesNotThrow(() => (r = c.call('bind_plan', { template: crossTemplate, bindings: deep, workspace: 'ws' })));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'input.invalid');
  assert.match(r.message, /nesting exceeds 32 levels/);
  const big = new Array(1024 * 1024).fill(0);
  assert.doesNotThrow(() => (r = c.call('bind_plan', { template: crossTemplate, bindings: { crew: big }, workspace: 'ws' })));
  assert.equal(r.code, 'input.invalid');
  assert.match(r.message, /exceeds 256 KiB/);
  // deep nesting in any op, including ones whose schema would reject it anyway
  assert.equal((c.call('query_world', deep) as any).code, 'input.invalid');
  // ordinary inputs are unaffected
  assert.ok(c.call('bind_plan', { template: crossTemplate, bindings: crossBindings, workspace: 'ws' }).ok);
});

/** DurableObjectStorage stand-in over node:sqlite, counting bytes/rows written. */
function sqliteStorage() {
  const db = new DatabaseSync(':memory:');
  const io = { bytes: 0, rows: 0 };
  const storage = {
    sql: {
      exec(q: string, ...args: (string | number)[]) {
        if (/^INSERT/i.test(q)) { io.bytes += String(args[2]).length; io.rows++; }
        const st = db.prepare(q);
        const out = /^\s*SELECT/i.test(q) ? st.all(...args) : (st.run(...args), []);
        return { toArray: () => out };
      },
    },
    transactionSync<T>(fn: () => T): T {
      db.exec('BEGIN');
      try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
  const keys = () => (db.prepare('SELECT DISTINCT key FROM engine_blobs ORDER BY key').all() as { key: string }[]).map((r) => r.key);
  const blob = (key: string) => (db.prepare('SELECT data FROM engine_blobs WHERE key=? ORDER BY chunk').all(key) as { data: string }[]).map((r) => r.data).join('');
  return { storage: storage as unknown as DurableObjectStorage, io, keys, blob, db };
}

test('api: rehearse is read-only unless keep: true (review M5); unkept takes stay playable in memory', () => {
  const c = fresh();
  c.drainChanges();
  const plan = bind(c, crossTemplate, crossBindings);
  c.drainChanges();
  const reh = c.call('rehearse', { plan_id: plan }) as any;
  assert.ok(reh.ok);
  assert.equal(reh.take.kept, false);
  assert.deepEqual(c.drainChanges(), { history: false, takes: [], plans: [], cameras: [] }, 'nothing to persist');
  assert.ok((c.call('get_take', { take_id: reh.take.take_id }) as any).ok, 'unkept take is playable');
  const kept = c.call('rehearse', { plan_id: plan, keep: true }) as any;
  assert.equal(kept.take.kept, true);
  assert.deepEqual(c.drainChanges().takes, [reh.take.take_id]);
  // attaching a camera to an unkept take keeps it (the track is stored beside its take)
  const plan2 = bind(c, minuteTemplate, minuteBindings);
  const r2 = c.call('rehearse', { plan_id: plan2 }) as any;
  c.drainChanges();
  assert.ok((c.call('attach_camera_track', { take_id: r2.take.take_id, shot: { kind: 'fixed', position: [0, 10, 30], target: [0, 0, 0] } }) as any).track_id);
  const ch = c.drainChanges();
  assert.deepEqual([ch.takes, ch.cameras], [[r2.take.take_id], [r2.take.take_id]]);
});

test('api: EngineRoom stores states as content-addressed blobs and migrates an old history blob (review M5)', async () => {
  const { EngineRoom } = await import('../../simulation/engine-room.ts');
  // an old-format room: the whole WorldHistory (states inline) under y2026/history
  const c = fresh();
  const plan = bind(c, crossTemplate, crossBindings);
  assert.ok(c.call('execute', { plan_id: plan, workspace: 'ws' }).ok);
  const oldBlob = JSON.stringify(c.history.toJSON());
  const s = sqliteStorage();
  const room = new EngineRoom(s.storage);
  s.storage.sql.exec('INSERT INTO engine_blobs (key, chunk, data) VALUES (?, ?, ?)', 'y2026/history', 0, oldBlob);
  const stateHashes = [...new Set([...c.history.checkpoints.values()].map((cp) => cp.stateHash))];
  s.io.bytes = s.io.rows = 0;
  const log = room.call(2026, 'log', { workspace: 'ws' }) as any;
  assert.equal(log.head, c.history.head('ws').id, 'migrated history keeps its heads');
  assert.deepEqual(s.keys().filter((k) => k.includes('/state/')).sort(), stateHashes.map((h) => `y2026/state/${h}`).sort());
  const index = JSON.parse(s.blob('y2026/history'));
  assert.equal(index.states, undefined, 'index rewritten without states');
  const q = room.call(2026, 'query_world', { workspace: 'ws', ids: ['n1'] }) as any;
  assert.deepEqual(q.entities[0].pose.p, c.history.read('ws').entities.n1.pose.p, 'states load on demand from their blobs');

  // publish (seed) + 3 forks + 3 executes on a fresh room: every write is O(new state + index)
  const f = sqliteStorage();
  const fresh2 = new EngineRoom(f.storage);
  const walk = (x: number) => ({ schema: 'mars-sequence/1', id: `walk-${x}`, params: { a: { kind: 'actor' } }, steps: [{ id: 's', verb: 'walk_to', params: { actor: '$a', x, z: -22 } }] });
  fresh2.call(2026, 'query_world', {});
  const seedBytes = f.io.bytes;
  for (const k of [1, 2, 3]) fresh2.call(2026, 'fork', { from: 'proving-ground', name: `f${k}` });
  const execWrites: Record<string, number>[] = [];
  for (const k of [1, 2, 3]) {
    const b = fresh2.call(2026, 'bind_plan', { template: walk(-5 - k), bindings: { a: 'n1' }, workspace: `f${k}` }) as any;
    const r = fresh2.call(2026, 'rehearse', { plan_id: b.plan_id }) as any;
    assert.deepEqual(r._meta.stored, {}, 'rehearse writes nothing');
    const e = fresh2.call(2026, 'execute', { plan_id: b.plan_id, workspace: `f${k}` }) as any;
    assert.ok(e.ok, e.message);
    execWrites.push(e._meta.stored);
  }
  for (const w of execWrites) {
    const ks = Object.keys(w).map((k) => k.split('/')[1]).sort();
    assert.deepEqual(ks, ['history', 'state', 'store-index', 'take'], JSON.stringify(w));
    assert.ok(w['y2026/store-index'] < 1024, 'plan/take creation-order index stays small');
    assert.ok(w['y2026/history'] < 4096, `index stays small (${w['y2026/history']} B)`);
  }
  const sizes = fresh2.sizes(2026);
  assert.equal(sizes.state.count, 2 + 3, 'two seed states + one per execute');
  console.log(`  M5 engine room: seed ${seedBytes} B, total written ${f.io.bytes} B in ${f.io.rows} rows; stored ${JSON.stringify(sizes)}`);
  // a restarted DO (new EngineRoom over the same storage) sees the same heads
  const again = new EngineRoom(f.storage);
  const l3 = again.call(2026, 'log', { workspace: 'f3' }) as any;
  assert.equal(l3.checkpoints.length, 2);
});

test('api: EngineRoom caps stored plans/takes per room; referenced takes survive; all-referenced refuses (room.storage-full)', async () => {
  const { EngineRoom, MAX_TAKES, MAX_PLANS } = await import('../../simulation/engine-room.ts');
  assert.deepEqual([MAX_PLANS, MAX_TAKES], [64, 32]);
  const s = sqliteStorage();
  const room = new EngineRoom(s.storage);
  const walk = (x: number) => ({ schema: 'mars-sequence/1', id: `walk-${x}`, params: { a: { kind: 'actor' } }, steps: [{ id: 's', verb: 'walk_to', params: { actor: '$a', x, z: -22 } }] });
  assert.ok((room.call(2026, 'fork', { from: 'proving-ground', name: 'w' }) as any).ok);
  // 40 distinct stored takes: the first 3 executed (referenced by simulation-run checkpoints), 37 kept rehearsals
  const order: string[] = [];
  const referenced: string[] = [];
  for (let k = 0; k < 40; k++) {
    const b = room.call(2026, 'bind_plan', { template: walk(-4 - k * 0.25), bindings: { a: 'n1' }, workspace: 'w' }) as any;
    assert.ok(b.ok, b.message);
    const r = k < 3 ? (room.call(2026, 'execute', { plan_id: b.plan_id, workspace: 'w' }) as any) : (room.call(2026, 'rehearse', { plan_id: b.plan_id, keep: true }) as any);
    assert.ok(r.ok, r.message);
    const id = k < 3 ? r.take_id : r.take.take_id;
    order.push(id);
    if (k < 3) referenced.push(id);
  }
  assert.equal(new Set(order).size, 40);
  const takes = s.keys().filter((k) => k.startsWith('y2026/take/')).map((k) => k.slice('y2026/take/'.length));
  assert.equal(takes.length, 32);
  for (const id of referenced) assert.ok(takes.includes(id), `referenced take ${id} survives`);
  // evicted: the 8 oldest unreferenced (rehearsals 3..10)
  assert.deepEqual(order.filter((id) => !takes.includes(id)), order.slice(3, 11));
  const index = JSON.parse(s.blob('y2026/store-index'));
  assert.deepEqual(index.takes, [...referenced, ...order.slice(11)], 'index keeps creation order');
  assert.equal(index.plans.length, 40);
  assert.equal((room.call(2026, 'get_take', { take_id: order[3] }) as any).code, 'take.unknown', 'evicted take is gone in memory too');
  assert.ok((room.call(2026, 'get_take', { take_id: referenced[0] }) as any).ok);
  // a restarted room sees the same caps and index
  assert.equal(new EngineRoom(s.storage).sizes(2026).take.count, 32);

  // every stored take referenced by history: the next store is refused and nothing is persisted
  const f = sqliteStorage();
  const small = new EngineRoom(f.storage, { takes: 2, plans: 3 });
  small.call(2026, 'fork', { from: 'proving-ground', name: 'w' });
  const heads: string[] = [];
  for (let k = 0; k < 2; k++) {
    const b = small.call(2026, 'bind_plan', { template: walk(-4 - k), bindings: { a: 'n1' }, workspace: 'w' }) as any;
    const e = small.call(2026, 'execute', { plan_id: b.plan_id, workspace: 'w' }) as any;
    assert.ok(e.ok, e.message);
    heads.push(e.checkpoint.id);
  }
  const b3 = small.call(2026, 'bind_plan', { template: walk(-7), bindings: { a: 'n1' }, workspace: 'w' }) as any;
  assert.ok(b3.ok, 'third plan fits (cap 3)');
  const keys = f.keys();
  const e3 = small.call(2026, 'execute', { plan_id: b3.plan_id, workspace: 'w' }) as any;
  assert.equal(e3.ok, false);
  assert.equal(e3.code, 'room.storage-full');
  assert.match(e3.message, /2 stored takes \(cap 2\) and 2 of them are referenced .* new room/);
  assert.deepEqual(f.keys(), keys, 'nothing persisted');
  assert.equal((small.call(2026, 'log', { workspace: 'w' }) as any).head, heads[1], 'the refused execute left no checkpoint in memory either');
  // plans: the oldest unreferenced plan (the third, never executed) is evicted; referenced plans are kept
  const b4 = small.call(2026, 'bind_plan', { template: walk(-8), bindings: { a: 'n1' }, workspace: 'w' }) as any;
  assert.ok(b4.ok, b4.message);
  const plans = f.keys().filter((k) => k.startsWith('y2026/plan/')).map((k) => k.slice('y2026/plan/'.length));
  assert.equal(plans.length, 3);
  assert.ok(!plans.includes(b3.plan_id) && plans.includes(b4.plan_id));
  const b5 = small.call(2026, 'bind_plan', { template: walk(-9), bindings: { a: 'n1' }, workspace: 'w' }) as any;
  assert.ok(b5.ok, b5.message);
  const b6 = small.call(2026, 'bind_plan', { template: walk(-10), bindings: { a: 'n1' }, workspace: 'w' }) as any;
  assert.ok(b6.ok, b6.message);
});

// ---- spec §28 isolation proofs through the room (EngineRoom over node:sqlite; the same code the DO runs).
// deploy/simulation-integration.mjs repeats these three against a real `wrangler dev` room over MCP + REST.

/** Every engine_blobs row, for byte-exact "nothing was written" checks. */
const dumpRows = (db: DatabaseSync) => hashOf(db.prepare('SELECT key, chunk, data FROM engine_blobs ORDER BY key, chunk').all());
const walkPlan = (id: string, x: number, z: number) => ({ schema: 'mars-sequence/1', id, params: { a: { kind: 'actor' } }, steps: [{ id: 's', verb: 'walk_to', params: { actor: '$a', x, z } }] });
/** Every workspace head plus every entity pose in every workspace (compact, as the tools return them). */
function roomSnapshot(room: { call(y: number, op: string, input: unknown): any }) {
  const ws = room.call(2026, 'query_world', {}).workspaces as { id: string; head: string }[];
  return {
    heads: Object.fromEntries(ws.map((w) => [w.id, w.head])),
    logs: Object.fromEntries(ws.map((w) => [w.id, room.call(2026, 'log', { workspace: w.id }).checkpoints.length])),
    poses: Object.fromEntries(ws.map((w) => [w.id, room.call(2026, 'query_world', { workspace: w.id }).entities.map((e: any) => [e.id, e.pose, e.human?.activity ?? e.phase ?? null])])),
  };
}

test('replay isolation (room): take fetches and camera tracks never change heads, logs, poses or stored bytes; rooms never see each other', async () => {
  const { EngineRoom } = await import('../../simulation/engine-room.ts');
  const s = sqliteStorage();
  const room = new EngineRoom(s.storage);
  assert.ok((room.call(2026, 'fork', { from: 'proving-ground', name: 'replay' }) as any).ok);
  const b = room.call(2026, 'bind_plan', { template: minuteTemplate, bindings: minuteBindings, workspace: 'replay' }) as any;
  assert.ok((room.call(2026, 'rehearse', { plan_id: b.plan_id }) as any).ok);
  const ex = room.call(2026, 'execute', { plan_id: b.plan_id, workspace: 'replay' }) as any;
  assert.ok(ex.ok, ex.message);
  const snap = roomSnapshot(room);
  assert.equal(snap.heads.replay, ex.checkpoint.id);
  const rows = dumpRows(s.db);
  // viewing: many slices, full take with final state and cameras (the /api/simulation/engine/take path is this op)
  const seen: string[] = [];
  for (const [from, to] of [[0, 1], [5, 5.05], [12.34, 20], [30, 31], [55, undefined], [0, undefined]] as [number, number | undefined][]) {
    const r = room.call(2026, 'get_take', { take_id: ex.take_id, from, to, include: ['final', 'cameras', 'events', 'changes'] }) as any;
    assert.ok(r.ok, r.message);
    assert.deepEqual(r._meta.stored, {}, 'a take fetch stores nothing');
    seen.push(r.finalStateHash);
  }
  assert.deepEqual(new Set(seen), new Set([ex.take.finalStateHash]));
  assert.equal(dumpRows(s.db), rows, 'take fetches wrote no byte to storage');
  assert.deepEqual(roomSnapshot(room), snap, 'heads, log lengths and every pose unchanged after viewing');
  // a camera track is stored beside the take (cams/ only): no head, log, pose, state, plan or take row changes
  const historyBlob = s.blob('y2026/history');
  const keys = s.keys();
  const cam = room.call(2026, 'attach_camera_track', { take_id: ex.take_id, shot: { kind: 'frameGroup', subjects: ['n1', 's1', 'p1'], azimuth: 3.14, elevation: 0.4 } }) as any;
  assert.ok(cam.ok && cam.takeHashUnchanged, JSON.stringify(cam.report));
  assert.deepEqual(Object.keys(cam._meta.stored), [`y2026/cams/${ex.take_id}`]);
  assert.deepEqual(s.keys(), [...keys, `y2026/cams/${ex.take_id}`].sort());
  assert.equal(s.blob('y2026/history'), historyBlob);
  assert.deepEqual(roomSnapshot(room), snap, 'unchanged after attaching a camera track');
  // a restarted room (DO eviction) replays the same take and sees the same heads
  const again = new EngineRoom(s.storage);
  assert.deepEqual(roomSnapshot(again), snap);
  assert.equal((again.call(2026, 'get_take', { take_id: ex.take_id, include: ['cameras'] }) as any).cameras.length, 1);
  // a second, independent room (another DO, another capability): none of room 1's plans or takes, and vice versa
  const s2 = sqliteStorage();
  const room2 = new EngineRoom(s2.storage);
  assert.deepEqual((room2.call(2026, 'query_world', {}) as any).workspaces.map((w: any) => w.id).sort(), ['carry-yard', 'proving-ground']);
  assert.equal((room2.call(2026, 'get_take', { take_id: ex.take_id }) as any).code, 'take.unknown');
  assert.equal((room2.call(2026, 'rehearse', { plan_id: b.plan_id }) as any).code, 'plan.unknown');
  assert.equal((room2.call(2026, 'execute', { plan_id: b.plan_id, workspace: 'replay' }) as any).code, 'plan.unknown');
  room2.call(2026, 'fork', { from: 'proving-ground', name: 'other' });
  const b2 = room2.call(2026, 'bind_plan', { template: walkPlan('other-walk', -8, -22), bindings: { a: 'n1' }, workspace: 'other' }) as any;
  const ex2 = room2.call(2026, 'execute', { plan_id: b2.plan_id, workspace: 'other' }) as any;
  assert.ok(ex2.ok, ex2.message);
  assert.equal((room.call(2026, 'get_take', { take_id: ex2.take_id }) as any).code, 'take.unknown');
  assert.equal((room.call(2026, 'rehearse', { plan_id: b2.plan_id }) as any).code, 'plan.unknown');
  assert.deepEqual(roomSnapshot(room), snap, "room 1 untouched by room 2's work");
});

test('fork isolation (room): a fork executes without touching canonical or a sibling fork; canonical execute refused', async () => {
  const { EngineRoom } = await import('../../simulation/engine-room.ts');
  const s = sqliteStorage();
  const room = new EngineRoom(s.storage);
  const canon0 = roomSnapshot(room);
  assert.ok((room.call(2026, 'fork', { from: 'proving-ground', name: 'w1' }) as any).ok);
  const b = room.call(2026, 'bind_plan', { template: walkPlan('p1-walk', -5, 5), bindings: { a: 'p1' }, workspace: 'w1' }) as any;
  const prot = room.call(2026, 'execute', { plan_id: b.plan_id, workspace: 'proving-ground' }) as any;
  assert.equal(prot.code, 'workspace.protected');
  assert.match(prot.message, /fork/);
  const ex = room.call(2026, 'execute', { plan_id: b.plan_id, workspace: 'w1' }) as any;
  assert.ok(ex.ok, ex.message);
  assert.ok((room.call(2026, 'fork', { from: 'proving-ground', name: 'w2' }) as any).ok);
  const snap = roomSnapshot(room);
  assert.equal(snap.heads['proving-ground'], canon0.heads['proving-ground'], 'canonical head unchanged');
  assert.equal(snap.logs['proving-ground'], 1);
  assert.deepEqual(snap.poses['proving-ground'], canon0.poses['proving-ground']);
  assert.equal(snap.heads.w2, canon0.heads['proving-ground'], 'w2 forks the canonical head, not w1');
  assert.deepEqual(snap.poses.w2, canon0.poses['proving-ground'], "w2's world lacks w1's walk");
  const p1 = (ws: string) => snap.poses[ws].find((e: any) => e[0] === 'p1')[1].p;
  assert.notDeepEqual(p1('w1'), p1('w2'));
  const log = room.call(2026, 'log', { workspace: 'w1' }) as any;
  assert.deepEqual(log.checkpoints[0].cause, { kind: 'simulation-run', take: ex.take_id, plan: b.plan_id });
  assert.equal(log.checkpoints[1].cause.kind, 'canonical-publish');
  // the plan's baseline is the canonical head, which w2 still sits on: it runs there independently
  const ex2 = room.call(2026, 'execute', { plan_id: b.plan_id, workspace: 'w2' }) as any;
  assert.ok(ex2.ok, ex2.message);
  assert.equal(ex2.take_id, ex.take_id, 'same plan, same baseline → same take in a sibling');
  assert.equal(roomSnapshot(room).heads['proving-ground'], canon0.heads['proving-ground']);
});

test('plan invalidation (room): another run moving a walker onto the route stales a rehearsed plan; camera tracks do not', async () => {
  const { EngineRoom } = await import('../../simulation/engine-room.ts');
  const s = sqliteStorage();
  const room = new EngineRoom(s.storage);
  room.call(2026, 'fork', { from: 'proving-ground', name: 'w1' });
  // camera attachment alone never stales: rehearse, shoot the rehearsal take twice, execute
  const c = room.call(2026, 'bind_plan', { template: walkPlan('p1-walk', -5, 5), bindings: { a: 'p1' }, workspace: 'w1' }) as any;
  const rc = room.call(2026, 'rehearse', { plan_id: c.plan_id }) as any;
  assert.ok(rc.ok);
  for (const shot of [{ kind: 'follow', subject: 'p1', offset: [-6, 2.5, 0], frame: 'world' }, { kind: 'fixed', position: [0, 10, 30], target: [0, 0, 0] }])
    assert.ok((room.call(2026, 'attach_camera_track', { take_id: rc.take.take_id, shot }) as any).ok);
  const rc2 = room.call(2026, 'rehearse', { plan_id: c.plan_id }) as any;
  assert.equal(rc2.stale, undefined, 'not stale after camera tracks');
  const exc = room.call(2026, 'execute', { plan_id: c.plan_id, workspace: 'w1' }) as any;
  assert.ok(exc.ok, exc.message);
  assert.equal(exc.take_id, rc.take.take_id);
  // A: n1 north through the 1 m passage (rehearsed). B (bound at the same head): s1 steps into the passage.
  const a = room.call(2026, 'bind_plan', { template: walkPlan('n1-north', 15, -12), bindings: { a: 'n1' }, workspace: 'w1' }) as any;
  const ra = room.call(2026, 'rehearse', { plan_id: a.plan_id }) as any;
  assert.ok(ra.ok, JSON.stringify(ra.report));
  const bb = room.call(2026, 'bind_plan', { template: walkPlan('s1-into-passage', 15, -15), bindings: { a: 's1' }, workspace: 'w1' }) as any;
  const exb = room.call(2026, 'execute', { plan_id: bb.plan_id, workspace: 'w1' }) as any;
  assert.ok(exb.ok, exb.message);
  const s1 = (room.call(2026, 'query_world', { workspace: 'w1', ids: ['s1'] }) as any).entities[0].pose.p;
  assert.ok(Math.abs(s1[0] - 15) < 0.3 && Math.abs(s1[2] + 15) < 0.3, `s1 stands in the passage (${s1})`);
  const head = (room.call(2026, 'log', { workspace: 'w1' }) as any).head;
  const stale = room.call(2026, 'execute', { plan_id: a.plan_id, workspace: 'w1' }) as any;
  assert.equal(stale.code, 'plan.stale');
  assert.deepEqual(stale.diff.changed, [{ id: 's1', fields: ['pose'] }]);
  assert.match(stale.message, /s1 changed \(pose\)/);
  assert.equal((room.call(2026, 'log', { workspace: 'w1' }) as any).head, head, 'a stale plan never commits');
  assert.equal((room.call(2026, 'rehearse', { plan_id: a.plan_id }) as any).stale.code, 'plan.stale', 'rehearsal flags it too');
});

test('api: edit_world — design edits spawn/move/remove/region, all-or-nothing, one design-edit checkpoint, refusals name the blocker', () => {
  const c = createController({ history: seedHistory(), scenes: ENGINE_SCENES });
  const edit = (workspace: string, edits: unknown[], note = 'test edit') => c.call('edit_world', { workspace, edits, note }) as any;
  // protected canonical, finite inventory
  assert.equal(edit('carry-yard', [{ op: 'remove', id: 'b1' }]).code, 'workspace.protected');
  assert.equal(edit('nope', [{ op: 'remove', id: 'b1' }]).code, 'unknown-workspace');
  assert.ok(c.call('fork', { from: 'carry-yard', name: 'fin' }).ok);
  const fin = edit('fin', [{ op: 'spawn', id: 'u1', def: 'upright-19ft', lying: { x: 4, z: 22, yaw: 0 } }]);
  assert.equal(fin.code, 'edit.inventory-finite');
  assert.match(fin.message, /inventory: 'unlimited'/);
  assert.equal(fin.details.index, 0);
  // fork with unlimited inventory: a design-edit checkpoint on the new workspace only
  const f = c.call('fork', { from: 'carry-yard', name: 'yard', inventory: 'unlimited' }) as any;
  assert.equal(f.inventory, 'unlimited');
  assert.deepEqual(c.history.log('yard').map((cp) => cp.cause.kind), ['design-edit', 'canonical-publish']);
  assert.equal(c.history.read('carry-yard').inventory, 'finite');
  const early = bind(c, { schema: 'mars-sequence/1', id: 'w', params: { a: { kind: 'actor' } }, steps: [{ id: 's', verb: 'walk_to', params: { actor: '$a', x: 3, z: 3 } }] }, { a: 'p1' }, 'yard');
  const head0 = c.history.head('yard').id;
  // 19 ft upright in yard B with a crew of four (two moved, two spawned)
  const r = edit('yard', [
    { op: 'spawn', id: 'u1', def: 'upright-19ft', lying: { x: 4, z: 22, yaw: 0 } },
    { op: 'move', id: 'p1', pose: { p: [1.5, 0, 19.5], yaw: 0 } },
    { op: 'move', id: 'p2', pose: { p: [6.5, 0, 19.5], yaw: 0 } },
    { op: 'spawn', id: 'q3', def: 'human', pose: { p: [1.5, 0, 24.5], yaw: 0 } },
    { op: 'spawn', id: 'q4', def: 'human', pose: { p: [6.5, 0, 24.5], yaw: 0 } },
    { op: 'region', id: 'yb', kind: 'staging', polygon: [[0, 18], [8, 18], [8, 26], [0, 26]] },
  ], 'upright + crew in yard B');
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.parent, head0);
  assert.deepEqual(r.checkpoint.cause, { kind: 'design-edit', note: 'upright + crew in yard B' });
  assert.deepEqual(r.diff.added, ['q3', 'q4', 'u1']);
  assert.deepEqual(r.diff.changed, [{ id: 'p1', fields: ['pose'] }, { id: 'p2', fields: ['pose'] }]);
  assert.deepEqual(r.diff.regions, ['yb']);
  assert.equal(r.applied.length, 6);
  const w = c.history.read('yard');
  assert.equal(w.entities.u1.phase, 'staged');
  assert.deepEqual(w.entities.u1.provenance, { origin: 'design-edit', confidence: 'hypothetical', note: 'upright + crew in yard B' });
  assert.equal(w.entities.q3.kind, 'human');
  assert.deepEqual(Object.keys(w.entities), Object.keys(w.entities).sort(), 'canonical entity order');
  // the spawned load is really there: the canonical 19 ft upright vs the 1.5 m corridor B
  const pv = c.call('query_world', { workspace: 'yard', carry: { crew: ['p1', 'p2', 'q3', 'q4'], item: 'u1', to: { x: 18, z: 36, yaw: Math.PI / 2 } } }) as any;
  assert.equal(pv.carry.diagnostic.code, 'carry.clearance');
  assert.match(pv.carry.diagnostic.message, /19 ft upright/);
  // a plan bound before the edit is stale, and the diff names the edit
  const st = c.call('execute', { plan_id: early, workspace: 'yard' }) as any;
  assert.equal(st.code, 'plan.stale');
  assert.deepEqual(st.diff.added, ['q3', 'q4', 'u1']);
  // refusals: wall, person, floor, float, immovable, id taken, unknown def; nothing commits
  const head1 = c.history.head('yard').id;
  const refuse = (edits: unknown[], code: string, re?: RegExp) => {
    const x = edit('yard', edits);
    assert.equal(x.ok, false);
    assert.equal(x.code, code, JSON.stringify(x));
    if (re) assert.match(x.message, re);
    assert.equal(c.history.head('yard').id, head1, `${code}: nothing committed`);
    return x;
  };
  const wall = refuse([{ op: 'move', id: 'b1', lying: { x: 8, z: 4, yaw: Math.PI / 2 } }], 'edit.blocked', /yard A east wall/);
  assert.deepEqual(wall.details.subjects, ['b1', 'ya-e1']);
  refuse([{ op: 'move', id: 'b1', lying: { x: 4, z: 22, yaw: 0.2 } }], 'edit.blocked', /overlap '.*upright.*'/);
  refuse([{ op: 'spawn', id: 'q5', def: 'human', pose: { p: [1.6, 0, 24.5], yaw: 0 } }], 'edit.blocked', /overlap q3/);
  refuse([{ op: 'spawn', id: 'box', def: 'plywood-4x8', lying: { x: 1.5, z: 24.5, yaw: 0 } }], 'edit.blocked', /q3/);
  refuse([{ op: 'spawn', id: 'q5', def: 'human', pose: { p: [12, 0, 12], yaw: 0 } }], 'edit.off-floor');
  refuse([{ op: 'spawn', id: 'box', def: 'plywood-4x8', pose: { p: [4, 1.5, 6], yaw: 0 } }], 'edit.unsupported');
  refuse([{ op: 'spawn', id: 'u1', def: 'upright-8ft', lying: { x: 4, z: 6, yaw: 0 } }], 'edit.id-taken');
  refuse([{ op: 'spawn', id: 'v1', def: 'forklift', lying: { x: 4, z: 6, yaw: 0 } }], 'edit.unknown-def');
  refuse([{ op: 'spawn', id: 'v1', def: 'test-wall', pose: { p: [4, 0, 6], yaw: 0 } }], 'edit.not-spawnable');
  refuse([{ op: 'spawn', id: 'f1', def: 'campfire', lying: { x: 4, z: 6, yaw: 0 } }], 'edit.invalid', /lying/);
  refuse([{ op: 'move', id: 'b1' }], 'edit.invalid', /exactly one of pose, lying/);
  refuse([{ op: 'move', id: 'ghost', lying: { x: 4, z: 6, yaw: 0 } }], 'entity.unknown');
  refuse([{ op: 'remove', id: 'p1' }], 'edit.immovable', /design edit spawned/);
  // atomic: a valid first edit followed by a refused one leaves the head where it was
  const atomic = refuse([{ op: 'move', id: 'b1', lying: { x: 4, z: 5, yaw: 0 } }, { op: 'move', id: 'b1', lying: { x: 8, z: 4, yaw: Math.PI / 2 } }], 'edit.blocked');
  assert.equal(atomic.details.index, 1);
  // remove: a staged component, and a person a design edit spawned
  const rm = edit('yard', [{ op: 'remove', id: 'b1' }, { op: 'remove', id: 'q4' }]);
  assert.ok(rm.ok, JSON.stringify(rm));
  assert.deepEqual(rm.diff.removed, ['b1', 'q4']);
  // a busy/installed item cannot be moved: install the panel on the proving ground first
  assert.ok(c.call('fork', { from: 'proving-ground', name: 'pg', inventory: 'unlimited' }).ok);
  const fire = edit('pg', [{ op: 'spawn', id: 'fire2', def: 'campfire', pose: { p: [-20, 0, 0], yaw: 0 } }, { op: 'move', id: 'fire2', pose: { p: [-21, 0, 0], yaw: 0.3 } }]);
  assert.ok(fire.ok, JSON.stringify(fire));
  assert.equal(c.history.read('pg').entities.fire2.kind, 'fixture');
  const pgw = c.history.read('pg');
  pgw.entities.panel.phase = 'installed';
  c.history.commit('pg', pgw, { kind: 'design-edit', note: 'panel installed' });
  const inst = edit('pg', [{ op: 'move', id: 'panel', lying: { x: -25, z: 20, yaw: 0 } }]);
  assert.equal(inst.code, 'edit.immovable');
  assert.match(inst.message, /installed/);
});
