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
import { hypot } from '../core/math.ts';

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
  assert.deepEqual(sl.range, { from: 10, to: 20, fromTick: 200, toTick: 400 }, 'seconds in, seconds out; ticks as extra fields');
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
  refuse([{ op: 'spawn', id: 'v1', def: 'tower-crane', lying: { x: 4, z: 6, yaw: 0 } }], 'edit.unknown-def');
  refuse([{ op: 'spawn', id: 'v1', def: 'forklift', pose: { p: [4, 0, 6], yaw: 0 } }], 'edit.not-spawnable');
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

test('api: seeds carry regions and a campfire + benches, so social verbs have targets over the op API', () => {
  const c = fresh();
  const pg = c.call('query_world', { workspace: 'proving-ground', include: ['regions'], kind: 'fixture' }) as any;
  assert.deepEqual(pg.regions.map((r: any) => r.id), ['lawn', 'staging', 'deck']);
  assert.deepEqual(pg.entities.map((e: any) => e.def).sort(), ['bench-6ft', 'bench-6ft', 'campfire']);
  const cy = c.call('query_world', { workspace: 'carry-yard', include: ['regions'], kind: 'fixture' }) as any;
  assert.deepEqual(cy.regions.map((r: any) => r.id), ['yard-a', 'yard-b', 'yard-b2']);
  assert.deepEqual(cy.entities.map((e: any) => e.id), ['bench-e', 'bench-s', 'fire']);
  const run = (ws: string, template: unknown, bindings: unknown) => {
    const r = c.call('rehearse', { plan_id: bind(c, template, bindings, ws) }) as any;
    assert.ok(r.ok, JSON.stringify(r.report.steps.map((s: any) => s.diagnostic)));
    return r;
  };
  // a campfire evening: three people take fire-circle places, then stand up at t = 60 s
  const evening = {
    schema: 'mars-sequence/1', id: 'evening', params: { crew: { kind: 'actors' } },
    steps: [
      { id: 'fire', verb: 'campfire_circle', params: { actors: '$crew', fire: 'fire' } },
      ...['n1', 's1', 'p1'].map((a, i) => ({ id: `up${i}`, verb: 'stand', params: { actor: a }, at: 60 })),
    ],
  };
  const ev = run('ws', evening, { crew: ['n1', 's1', 'p1'] });
  assert.equal(ev.report.violations.count, 0);
  // region targets: wander the lawn (proving ground) and yard A (carry yard) for a bounded time
  const wander = (region: string) => ({ schema: 'mars-sequence/1', id: `wander-${region}`, params: { crew: { kind: 'actors' } }, steps: [{ id: 'w', verb: 'ambient_wander', params: { actors: '$crew', region, duration: 30 } }] });
  run('ws', wander('lawn'), { crew: ['n1', 's1'] });
  assert.ok(c.call('fork', { from: 'carry-yard', name: 'cy' }).ok);
  run('cy', wander('yard-a'), { crew: ['p1', 'p2'] });
  // the fixtures in yard B2 keep the beam delivery along corridor A feasible
  assert.ok((c.call('query_world', { workspace: 'cy', carry: { crew: ['p1', 'p2'], item: 'b1', to: { x: 18, z: 11, yaw: Math.PI / 2 } } }) as any).carry.ok);
});

test('api: a historical year room (2022) seeds protected canonical mars-2022; walk across the courtyard; 2026 rooms unchanged', async () => {
  const { EngineRoom } = await import('../../simulation/engine-room.ts');
  const { loadCampusFile } = await import('../campus/history-node.ts');
  const s = sqliteStorage();
  const room = new EngineRoom(s.storage, {}, loadCampusFile);
  const ws = (year: number) => (room.call(year, 'query_world', {}) as any).workspaces.map((w: any) => w.id).sort();
  assert.deepEqual(ws(2026), ['carry-yard', 'proving-ground'], '2026 room behaviour unchanged');
  assert.deepEqual(ws(2022), ['carry-yard', 'mars-2022', 'proving-ground']);
  const q = room.call(2022, 'query_world', { workspace: 'mars-2022', include: ['regions'] }) as any;
  assert.equal(q.protected, true);
  assert.equal(q.entityCount, 0, 'canonical year: no people, no inventory');
  const ids = q.regions.map((r: any) => r.id);
  for (const id of ['chiba', 'kitchen']) assert.ok(ids.includes(id), id);
  const bbox = (id: string) => {
    const pts = q.regions.find((r: any) => r.id === id).polygon;
    return { x0: Math.min(...pts.map((p: any) => p[0])), x1: Math.max(...pts.map((p: any) => p[0])), z0: Math.min(...pts.map((p: any) => p[1])), z1: Math.max(...pts.map((p: any) => p[1])) };
  };
  const n = bbox('chiba'), k = bbox('kitchen');
  const a = [(n.x0 + n.x1) / 2, n.z0 - 3], b = [(k.x0 + k.x1) / 2, k.z1 + 3];
  assert.ok((room.call(2022, 'fork', { from: 'mars-2022', name: 'court', inventory: 'unlimited' }) as any).ok);
  const sp = room.call(2022, 'edit_world', { workspace: 'court', note: 'a walker north of chiba', edits: [{ op: 'spawn', id: 'w1', def: 'human', pose: { p: [a[0], 0, a[1]], yaw: 0 } }] }) as any;
  assert.ok(sp.ok, JSON.stringify(sp));
  const plan = room.call(2022, 'bind_plan', { template: walkPlan('court-walk', b[0], b[1]), bindings: { a: 'w1' }, workspace: 'court' }) as any;
  const reh = room.call(2022, 'rehearse', { plan_id: plan.plan_id }) as any;
  assert.ok(reh.ok, JSON.stringify(reh.report?.steps));
  assert.ok(reh.report.metrics.pathLength > hypot(b[0] - a[0], b[1] - a[1]) + 0.5, 'the walk detours around the courtyard buildings');
  assert.equal((room.call(2022, 'execute', { plan_id: plan.plan_id, workspace: 'mars-2022' }) as any).code, 'workspace.protected');
  assert.equal((room.call(2022, 'edit_world', { workspace: 'mars-2022', note: 'x', edits: [{ op: 'remove', id: 'w1' }] }) as any).code, 'workspace.protected');
  assert.ok((room.call(2022, 'execute', { plan_id: plan.plan_id, workspace: 'court' }) as any).ok);
  // a 2023 room seeded before campus years existed gets canonical mars-2023 on its next load, keeping its work
  const old = sqliteStorage();
  const before = new EngineRoom(old.storage);
  assert.ok((before.call(2023, 'fork', { from: 'proving-ground', name: 'mine' }) as any).ok);
  assert.deepEqual((before.call(2023, 'query_world', {}) as any).workspaces.map((w: any) => w.id).sort(), ['carry-yard', 'mine', 'proving-ground']);
  const after = new EngineRoom(old.storage, {}, loadCampusFile);
  assert.deepEqual((after.call(2023, 'query_world', {}) as any).workspaces.map((w: any) => w.id).sort(), ['carry-yard', 'mars-2023', 'mine', 'proving-ground']);
  const reload = new EngineRoom(old.storage, {}, loadCampusFile);
  assert.equal((reload.call(2023, 'log', { workspace: 'mars-2023' }) as any).checkpoints.length, 1, 'persisted once');
});

test('api: list (plans/takes/workspaces/cameras ledger) and delete_workspace (refusals name what blocks it)', async () => {
  const c = fresh();
  const plan = bind(c, walkPlan('ledger-walk', -5, -20), { a: 'n1' });
  const unkept = bind(c, walkPlan('ledger-peek', -5, -22), { a: 'n1' });
  const ex = c.call('execute', { plan_id: plan, workspace: 'ws' }) as any;
  assert.ok(ex.ok);
  const peek = c.call('rehearse', { plan_id: unkept }) as any;
  assert.ok(c.call('attach_camera_track', { take_id: ex.take_id, track_id: 'wide', shot: { kind: 'fixed', position: [0, 10, 30], target: [0, 0, 0] } }).ok);
  const l = c.call('list', { take_id: ex.take_id }) as any;
  assert.ok(l.ok);
  assert.deepEqual(l.plans.map((p: any) => [p.plan_id, p.order, p.template, p.workspace]), [[plan, 0, 'ledger-walk', 'ws'], [unkept, 1, 'ledger-peek', 'ws']]);
  assert.deepEqual(l.plans[0].referencedByCheckpoint, [ex.checkpoint.id]);
  assert.deepEqual(l.plans[1].referencedByCheckpoint, []);
  assert.deepEqual(l.takes.map((t: any) => [t.take_id, t.kept, t.cameras]), [[ex.take_id, true, true], [peek.take.take_id, false, false]]);
  assert.ok(l.takes[0].bytes > 1000);
  assert.deepEqual(l.takes[0].referencedByCheckpoint, [ex.checkpoint.id]);
  assert.deepEqual(l.cameras.map((x: any) => [x.id, x.shot]), [['wide', 'fixed']]);
  assert.deepEqual(l.workspaces.find((w: any) => w.id === 'proving-ground').forks, ['ws']);
  assert.deepEqual(Object.keys(c.call('list', { include: ['workspaces'] })).sort(), ['ok', 'workspaces']);
  assert.equal(c.call('list', { take_id: 'nope' }).code, 'take.unknown');
  // delete_workspace
  assert.equal(c.call('delete_workspace', { workspace: 'proving-ground' }).code, 'workspace.protected');
  assert.equal(c.call('delete_workspace', { workspace: 'ghost' }).code, 'unknown-workspace');
  assert.ok(c.call('fork', { from: 'ws', name: 'ws-a' }).ok);
  assert.ok(c.call('fork', { from: 'ws', name: 'ws-b' }).ok);
  const hf = c.call('delete_workspace', { workspace: 'ws' }) as any;
  assert.equal(hf.code, 'workspace.has-forks');
  assert.deepEqual(hf.details.forks, ['ws-a', 'ws-b']);
  assert.match(hf.message, /ws-a, ws-b/);
  for (const w of ['ws-a', 'ws-b', 'ws']) assert.ok(c.call('delete_workspace', { workspace: w }).ok, w);
  assert.deepEqual((c.call('query_world', {}) as any).workspaces.map((w: any) => w.id).sort(), ['carry-yard', 'proving-ground']);
  assert.deepEqual((c.call('list', {}) as any).takes[0].referencedByCheckpoint, [], "a deleted workspace's runs are unreferenced");
  assert.ok(c.call('fork', { from: 'proving-ground', name: 'again', at: ex.checkpoint.id }).ok, 'its checkpoints stay addressable');

  // room: listing comes from the store index; deleting a workspace frees its take for eviction
  const { EngineRoom } = await import('../../simulation/engine-room.ts');
  const s = sqliteStorage();
  const room = new EngineRoom(s.storage, { takes: 2 });
  const runIn = (ws: string, x: number) => {
    assert.ok((room.call(2026, 'fork', { from: 'proving-ground', name: ws }) as any).ok);
    const p = room.call(2026, 'bind_plan', { template: walkPlan(`${ws}-walk`, x, -20), bindings: { a: 'n1' }, workspace: ws }) as any;
    const e = room.call(2026, 'execute', { plan_id: p.plan_id, workspace: ws }) as any;
    assert.ok(e.ok, e.message);
    return e.take_id as string;
  };
  const tA = runIn('ra', -5), tB = runIn('rb', -8);
  const rl = room.call(2026, 'list', { include: ['takes'] }) as any;
  assert.deepEqual(rl.takes.map((t: any) => [t.take_id, t.order, t.kept, t.referencedByCheckpoint.length > 0]), [[tA, 0, true, true], [tB, 1, true, true]]);
  assert.ok(rl.takes.every((t: any) => t.bytes > 1000));
  const extra = room.call(2026, 'bind_plan', { template: walkPlan('ra-more', -6, -24), bindings: { a: 'n1' }, workspace: 'ra' }) as any;
  const full = room.call(2026, 'rehearse', { plan_id: extra.plan_id, keep: true }) as any;
  assert.equal(full.code, 'room.storage-full');
  assert.match(full.message, /engine_delete_workspace/);
  assert.ok((room.call(2026, 'delete_workspace', { workspace: 'rb' }) as any).ok);
  const kept = room.call(2026, 'rehearse', { plan_id: extra.plan_id, keep: true }) as any;
  assert.ok(kept.ok, JSON.stringify(kept).slice(0, 300));
  assert.deepEqual((room.call(2026, 'list', { include: ['takes'] }) as any).takes.map((t: any) => t.take_id), [tA, kept.take.take_id], "rb's take was evicted");
});

test('api: every refusal is one JSON envelope { ok:false, code, message, details? } — input validation, engine refusals, failed rehearsals', async () => {
  const c = fresh();
  const envelope = (r: any, code: string) => {
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.equal(r.code, code, JSON.stringify(r));
    assert.equal(typeof r.message, 'string');
    assert.ok(r.message.length > 5, r.message);
    if (r.details !== undefined) assert.equal(typeof r.details, 'object');
    assert.deepEqual(JSON.parse(JSON.stringify(r)), JSON.parse(JSON.stringify(r)), 'plain JSON');
    return r;
  };
  const bad = envelope(c.call('fork', { from: 'proving-ground', name: 'has space', extra: 1 }), 'op.invalid-input');
  assert.deepEqual(bad.details.issues.map((i: any) => i.path).sort(), ['(root)', 'name']);
  assert.match(bad.message, /^fork: input: /);
  envelope(c.call('edit_world', { workspace: 'ws', note: 'x', edits: [{ op: 'teleport', id: 'n1' }] }), 'op.invalid-input');
  envelope(c.call('nope', {}), 'op.unknown');
  envelope(c.call('rehearse', { plan_id: 'x'.repeat(24) }), 'plan.unknown');
  envelope(c.call('get_take', { take_id: 'nope' }), 'take.unknown');
  envelope(c.call('fork', { from: 'proving-ground', name: 'ws' }), 'exists');
  envelope(c.call('log', { workspace: 'ghost' }), 'unknown-workspace');
  envelope(c.call('edit_world', { workspace: 'proving-ground', note: 'x', edits: [{ op: 'remove', id: 'panel' }] }), 'workspace.protected');
  envelope(c.call('delete_workspace', { workspace: 'proving-ground' }), 'workspace.protected');
  const bb = envelope(c.call('bind_plan', { template: crossTemplate, bindings: { crew: ['n1', 'ghost', 'panel'], deck: [10, 10] }, workspace: 'ws' }), 'plan.invalid');
  assert.ok(bb.diagnostics.length >= 2, 'bind keeps its diagnostics payload');
  // a failed rehearsal: message names the failing step; the report still rides along
  const imp = bind(c, walkPlan('into-wall', -15, -15), { a: 'p1' });
  const rf = envelope(c.call('rehearse', { plan_id: imp }), 'rehearsal.failed');
  assert.match(rf.message, /step s \(walk_to\) route\./);
  assert.equal(rf.report.steps[0].status, 'failed');
  // the MCP listing publishes the zod JSON Schema but passes input through to the controller
  const { listedSchema } = await import('../../simulation/engine-tools.ts');
  for (const t of engineTools()) {
    const ls = listedSchema(t.inputSchema)['~standard'];
    assert.deepEqual(ls.jsonSchema.input({ target: 'draft-2020-12' }), (t.inputSchema as any)['~standard'].jsonSchema.input({ target: 'draft-2020-12' }), t.name);
    assert.deepEqual(ls.validate({ junk: [1] }), { value: { junk: [1] } });
  }
});

// ---- mid-action pause / resume through the control plane (engine_execute pauseAt, engine_resume) ----

const deliveryPlan = (to: { x: number; z: number; yaw: number }) => ({
  schema: 'mars-sequence/1', id: 'beam-delivery', params: { crew: { kind: 'actors' }, beam: { kind: 'entity' } },
  steps: [{ id: 'deliver', verb: 'carry', params: { crew: '$crew', item: '$beam', to } }],
});

test('pause/resume (room): execute pauseAt mid-walk → resume ends in the unpaused final state; snapshots are state blobs; survives a room restart', async () => {
  const { EngineRoom } = await import('../../simulation/engine-room.ts');
  const s = sqliteStorage();
  let room = new EngineRoom(s.storage);
  for (const w of ['full', 'paused', 'chain']) assert.ok((room.call(2026, 'fork', { from: 'proving-ground', name: w }) as any).ok);
  const b = room.call(2026, 'bind_plan', { template: crossTemplate, bindings: crossBindings, workspace: 'full' }) as any;
  const full = room.call(2026, 'execute', { plan_id: b.plan_id, workspace: 'full' }) as any;
  assert.ok(full.ok, full.message);
  // pause 5 s in: n1 is walking north through the passage, s1 is held at its south end (single-file)
  const p = room.call(2026, 'execute', { plan_id: b.plan_id, workspace: 'paused', pauseAt: 5 }) as any;
  assert.ok(p.ok, p.message);
  assert.equal(p.paused, true);
  assert.equal(p.resumable, true);
  assert.deepEqual(p.at, { t: 5, tick: 100 });
  assert.deepEqual(p.live.map((a: any) => [a.id, a.verb]), [['step:north', 'walk_to'], ['step:south', 'walk_to']]);
  assert.deepEqual(p.steps.map((x: any) => x.status), ['executing', 'blocked', 'pending']);
  assert.equal(p.checkpoint.resumable, true);
  assert.deepEqual(p.checkpoint.cause, { kind: 'pause', note: 'paused at t = 5 s (t = 5 s)', take: p.take_id, plan: b.plan_id });
  assert.equal(p.take.ticks, 100, 'the take so far covers 0–5 s');
  // the snapshot is a content-addressed blob next to the states, never inline in the index
  const resumeKeys = Object.keys(p._meta.stored).filter((k) => k.startsWith('y2026/state/resume.'));
  assert.equal(resumeKeys.length, 1);
  assert.equal(JSON.parse(s.blob('y2026/history')).resumes, undefined, 'index carries no snapshots');
  assert.equal(p._meta.stored[resumeKeys[0]], s.blob(resumeKeys[0]).length);
  console.log(`  pause blob ${p.snapshotBytes} B (stable JSON), stored ${s.blob(resumeKeys[0]).length} B; state storage ${JSON.stringify(p._meta.storage.state)}; pause ${p._meta.elapsedMs} ms`);
  assert.equal((room.call(2026, 'query_world', {}) as any).workspaces.find((w: any) => w.id === 'paused').paused, true);
  // a paused head is not a resting state: no other plan, bind or edit on it
  const other = room.call(2026, 'bind_plan', { template: walkPlan('x', 0, -5), bindings: { a: 'p1' }, workspace: 'full' }) as any;
  assert.equal((room.call(2026, 'execute', { plan_id: other.plan_id, workspace: 'paused' }) as any).code, 'workspace.paused');
  assert.equal((room.call(2026, 'bind_plan', { template: walkPlan('x', 0, -5), bindings: { a: 'p1' }, workspace: 'paused' }) as any).code, 'workspace.paused');
  assert.equal((room.call(2026, 'edit_world', { workspace: 'paused', note: 'x', edits: [{ op: 'move', id: 'panel', lying: { x: 0, z: 0, yaw: 0 } }] }) as any).code, 'workspace.paused');
  // a restarted room (DO eviction) loads the snapshot blob lazily and resumes to the unpaused final state
  room = new EngineRoom(s.storage);
  const r = room.call(2026, 'resume', { workspace: 'paused' }) as any;
  assert.ok(r.ok, r.message);
  assert.equal(r.report.finalStateHash, full.report.finalStateHash, 'resumed run ends in exactly the unpaused state');
  assert.equal(r.checkpoint.stateHash, full.checkpoint.stateHash);
  assert.equal(r.report.metrics.ticks, full.report.metrics.ticks, 'report spans the whole run');
  assert.equal(r.report.status, 'completed');
  assert.deepEqual(r.run, { start: b.baselineCheckpoint, takes: [p.take_id, r.take_id] });
  assert.equal(r.take.ticks, full.take.ticks - 100, 'the segment take covers 5 s → end');
  assert.deepEqual(r.checkpoint.cause, { kind: 'simulation-run', take: r.take_id, plan: b.plan_id });
  assert.equal(r.checkpoint.parent, p.checkpoint.id);
  console.log(`  resume ${r._meta.elapsedMs} ms (+ load ${r._meta.loadMs} ms) vs unpaused execute ${full._meta.elapsedMs} ms`);
  // both segment takes stay referenced (pause cause + simulation-run cause)
  const refs = (room.call(2026, 'list', { include: ['takes'] }) as any).takes;
  assert.deepEqual(refs.find((t: any) => t.take_id === p.take_id).referencedByCheckpoint, [p.checkpoint.id]);
  // a chain: pause when north completes, again when climb starts, then finish — same final state
  const c1 = room.call(2026, 'execute', { plan_id: b.plan_id, workspace: 'chain', pauseAt: { step: 'north', event: 'completed' } }) as any;
  assert.ok(c1.ok, c1.message);
  assert.equal(c1.steps[0].status, 'completed');
  assert.equal((room.call(2026, 'resume', { workspace: 'chain', until: 1 }) as any).code, 'resume.bad-until');
  assert.equal((room.call(2026, 'resume', { workspace: 'chain', until: { step: 'nope', event: 'started' } }) as any).code, 'pause.unknown-step');
  const c2 = room.call(2026, 'resume', { workspace: 'chain', until: { step: 'climb', event: 'started' } }) as any;
  assert.ok(c2.ok && c2.paused, c2.message);
  assert.deepEqual(c2.live.map((a: any) => a.id), ['step:climb']);
  const c3 = room.call(2026, 'resume', { workspace: 'chain' }) as any;
  assert.ok(c3.ok, c3.message);
  assert.equal(c3.report.finalStateHash, full.report.finalStateHash);
  assert.equal(c3.run.takes.length, 3);
  assert.deepEqual((room.call(2026, 'log', { workspace: 'chain' }) as any).checkpoints.map((x: any) => x.cause.kind), ['simulation-run', 'pause', 'pause', 'canonical-publish']);
  // a pause point the run never reaches: an ordinary execute that says so
  assert.ok((room.call(2026, 'fork', { from: 'proving-ground', name: 'late' }) as any).ok);
  const late = room.call(2026, 'execute', { plan_id: b.plan_id, workspace: 'late', pauseAt: 999 }) as any;
  assert.ok(late.ok, late.message);
  assert.equal(late.paused, false);
  assert.equal(late.report.finalStateHash, full.report.finalStateHash);
});

test('pause/resume (room): fork at a pause, resume both with different commands → distinct states; the pause checkpoint stays resumable', async () => {
  const { EngineRoom } = await import('../../simulation/engine-room.ts');
  const s = sqliteStorage();
  const room = new EngineRoom(s.storage);
  const canon = roomSnapshot(room);
  assert.ok((room.call(2026, 'fork', { from: 'proving-ground', name: 'p' }) as any).ok);
  const b = room.call(2026, 'bind_plan', { template: walkPlan('n1-far', -8, -22), bindings: { a: 'n1' }, workspace: 'p' }) as any;
  const p = room.call(2026, 'execute', { plan_id: b.plan_id, workspace: 'p', pauseAt: 3 }) as any;
  assert.ok(p.ok, p.message);
  for (const name of ['p-alt', 'p-plain']) {
    const f = room.call(2026, 'fork', { from: 'p', name }) as any;
    assert.ok(f.ok, f.message);
    assert.equal(f.workspace.head, p.checkpoint.id);
  }
  assert.equal((room.call(2026, 'fork', { from: 'p', name: 'p-inv', inventory: 'unlimited' }) as any).code, 'workspace.paused');
  const ws = (room.call(2026, 'query_world', {}) as any).workspaces;
  assert.deepEqual(ws.filter((w: any) => w.paused).map((w: any) => w.id).sort(), ['p', 'p-alt', 'p-plain']);
  const bad = room.call(2026, 'resume', { workspace: 'p', commands: [{ verb: 'walk_to', params: { actor: 's1', x: 'far' } }] }) as any;
  assert.equal(bad.code, 'resume.invalid-command');
  assert.match(bad.message, /commands\[0\] \(walk_to\)/);
  assert.equal((room.call(2026, 'resume', { workspace: 'p', commands: [{ verb: 'fly', params: {} }] }) as any).code, 'resume.invalid-command');
  const a = room.call(2026, 'resume', { workspace: 'p', commands: [{ verb: 'walk_to', params: { actor: 's1', x: -5, z: 5 } }] }) as any;
  assert.ok(a.ok, a.message);
  assert.deepEqual(a.commands, ['resume1-1']);
  assert.equal(a.report.steps.find((x: any) => x.id === 'resume1-1').status, 'completed');
  const alt = room.call(2026, 'resume', { workspace: 'p-alt', commands: [{ id: 'aside', verb: 'walk_to', params: { actor: 's1', x: 0, z: -5 } }] }) as any;
  assert.ok(alt.ok, alt.message);
  assert.notEqual(a.report.finalStateHash, alt.report.finalStateHash, 'different commands → different futures');
  const s1 = (w: string) => (room.call(2026, 'query_world', { workspace: w, ids: ['s1'] }) as any).entities[0].pose.p;
  assert.ok(hypot(s1('p')[0] + 5, s1('p')[2] - 5) < 0.3 && hypot(s1('p-alt')[0], s1('p-alt')[2] + 5) < 0.3, `${s1('p')} / ${s1('p-alt')}`);
  // the parent pause checkpoint is untouched: p-plain still sits on it, resumable, and resumes to the unpaused state
  assert.equal((room.call(2026, 'log', { workspace: 'p-plain' }) as any).head, p.checkpoint.id);
  const plain = room.call(2026, 'resume', { workspace: 'p-plain' }) as any;
  assert.ok(plain.ok, plain.message);
  assert.ok((room.call(2026, 'fork', { from: 'proving-ground', name: 'unpaused' }) as any).ok);
  const un = room.call(2026, 'execute', { plan_id: b.plan_id, workspace: 'unpaused' }) as any;
  assert.equal(plain.report.finalStateHash, un.report.finalStateHash);
  assert.notEqual(plain.report.finalStateHash, a.report.finalStateHash);
  const again = roomSnapshot(room);
  assert.equal(again.heads['proving-ground'], canon.heads['proving-ground'], 'canonical untouched');
  assert.deepEqual(again.poses['proving-ground'], canon.poses['proving-ground']);
  // one snapshot blob serves the checkpoint and all three forks
  assert.equal(s.keys().filter((k) => k.startsWith('y2026/state/resume.')).length, 1);
});

test('pause/resume: pauseAt during a carry is refused naming the carry (allowDrop only before the lift); resume on a resting head is resume.not-resumable', async () => {
  const { EngineRoom } = await import('../../simulation/engine-room.ts');
  const s = sqliteStorage();
  const room = new EngineRoom(s.storage);
  room.call(2026, 'fork', { from: 'carry-yard', name: 'cy' });
  const b = room.call(2026, 'bind_plan', { template: deliveryPlan({ x: 18, z: 11, yaw: Math.PI / 2 }), bindings: { crew: ['p1', 'p2'], beam: 'b1' }, workspace: 'cy' }) as any;
  const head = (room.call(2026, 'log', { workspace: 'cy' }) as any).head;
  const rows = dumpRows(s.db);
  const r = room.call(2026, 'execute', { plan_id: b.plan_id, workspace: 'cy', pauseAt: 5 }) as any;
  assert.equal(r.code, 'snapshot.non-resumable');
  assert.match(r.message, /action step:deliver \(carry\) is not resumable: carry drives in-process walk sub-execs/);
  assert.deepEqual(r.details.subjects, ['step:deliver']);
  assert.deepEqual(r.details.live.map((a: any) => [a.id, a.verb]), [['step:deliver', 'carry']]);
  assert.equal((room.call(2026, 'log', { workspace: 'cy' }) as any).head, head, 'nothing committed');
  assert.equal(dumpRows(s.db), rows, 'nothing stored');
  // mid-carry the beam is held: dropping the carry is refused too
  const held = room.call(2026, 'execute', { plan_id: b.plan_id, workspace: 'cy', pauseAt: 5, allowDrop: true }) as any;
  assert.equal(held.code, 'snapshot.drop-unsafe');
  assert.match(held.message, /b1 is carried by it/);
  // before the lift the carry can be dropped: the resumed run cancels it, so it fails and commits nothing
  const early = room.call(2026, 'execute', { plan_id: b.plan_id, workspace: 'cy', pauseAt: 0.5, allowDrop: true }) as any;
  assert.ok(early.ok, early.message);
  assert.deepEqual(early.dropped.map((d: any) => d.id), ['step:deliver']);
  const res = room.call(2026, 'resume', { workspace: 'cy' }) as any;
  assert.equal(res.code, 'execution.failed');
  assert.match(res.message, /step deliver cancelled: .*dropped when the runtime was snapshotted/);
  assert.equal((room.call(2026, 'log', { workspace: 'cy' }) as any).head, early.checkpoint.id, 'a failed resume leaves the pause head');
  // resting heads: nothing to resume
  room.call(2026, 'fork', { from: 'proving-ground', name: 'w' });
  const nr = room.call(2026, 'resume', { workspace: 'w' }) as any;
  assert.equal(nr.code, 'resume.not-resumable');
  assert.match(nr.message, /canonical-publish checkpoint, not a mid-action pause/);
  const wb = room.call(2026, 'bind_plan', { template: walkPlan('w-walk', -5, 5), bindings: { a: 'p1' }, workspace: 'w' }) as any;
  assert.ok((room.call(2026, 'execute', { plan_id: wb.plan_id, workspace: 'w' }) as any).ok);
  assert.equal((room.call(2026, 'resume', { workspace: 'w' }) as any).code, 'resume.not-resumable', 'a simulation-run head is not resumable either');
  assert.equal((room.call(2026, 'resume', { workspace: 'proving-ground' }) as any).code, 'workspace.protected');
  assert.equal((room.call(2026, 'resume', { workspace: 'nope' }) as any).code, 'unknown-workspace');
  assert.equal((room.call(2026, 'execute', { plan_id: wb.plan_id, workspace: 'w', pauseAt: { step: 'zz', event: 'started' } }) as any).code, 'plan.stale', 'stale is checked first');
});

// ---- LM-003 / LM-004 region-scoped staleness, LM-001 auto rebind (W58) ----------------------------

const edit = (c: EngineController, workspace: string, edits: unknown[]) => {
  const r = c.call('edit_world', { workspace, edits, note: 'staleness test' }) as any;
  assert.ok(r.ok, JSON.stringify(r));
  return r;
};
const box4 = (x0: number, z0: number, x1: number, z1: number) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

test('staleness (LM-004): an edit far from every step keeps the plan valid; one on the route stales it naming the step', () => {
  const c = fresh();
  const plan = bind(c, walkPlan('p1-walk', -5, 5), { a: 'p1' });
  const reh = c.call('rehearse', { plan_id: plan }) as any;
  assert.ok(reh.ok);
  // far: a no-go region 40 m away and the north bench nudged 0.3 m, both outside p1's walk (3.5, 12.5) → (-5, 5)
  edit(c, 'ws', [{ op: 'region', id: 'far', kind: 'no-go', polygon: box4(40, 40, 45, 45) }, { op: 'move', id: 'bench-n', pose: { p: [-24, 0, 1.5], yaw: Math.PI } }]);
  const r2 = c.call('rehearse', { plan_id: plan }) as any;
  assert.equal(r2.stale, undefined, 'a far edit does not stale');
  assert.match(r2.outsideEnvelope.summary, /bench-n changed \(pose\)/);
  assert.deepEqual(r2.outsideEnvelope.diff.regions, ['far']);
  const ex = c.call('execute', { plan_id: plan, workspace: 'ws' }) as any;
  assert.ok(ex.ok, ex.message);
  assert.match(ex.outsideEnvelope.summary, /regions changed: far/);
  // near: a second fork, the same walk, and the panel laid down across the route
  assert.ok(c.call('fork', { from: 'proving-ground', name: 'ws2' }).ok);
  const plan2 = bind(c, walkPlan('p1-walk', -5, 5), { a: 'p1' }, 'ws2');
  assert.equal(plan2, plan, 'same template, bindings and baseline → the same plan');
  edit(c, 'ws2', [{ op: 'move', id: 'panel', lying: { x: -1, z: 8, yaw: 0 } }]);
  const st = c.call('execute', { plan_id: plan, workspace: 'ws2' }) as any;
  assert.equal(st.code, 'plan.stale');
  assert.deepEqual(st.affected, [{ step: 's', causes: ['panel (pose)'] }]);
  assert.match(st.message, /step s ← panel \(pose\)/);
  const head = c.history.head('ws2').id;
  assert.equal((c.call('rehearse', { plan_id: plan, workspace: 'ws2' }) as any).stale.affected[0].step, 's');
  assert.equal(c.history.head('ws2').id, head, 'a stale plan never commits');
});

test('staleness (LM-004): an unrehearsed plan is scoped too (envelope from a run at its baseline); a changed bound entity always stales', () => {
  const c = fresh();
  const plan = bind(c, walkPlan('p1-walk', -5, 5), { a: 'p1' });
  edit(c, 'ws', [{ op: 'region', id: 'far', kind: 'no-go', polygon: box4(40, 40, 45, 45) }]);
  const ex = c.call('execute', { plan_id: plan, workspace: 'ws' }) as any;
  assert.ok(ex.ok, ex.message);
  assert.deepEqual(ex.outsideEnvelope.diff.regions, ['far']);
  // p1 is a bound actor: moving it (even 30 m away from the old route) stales the step that names it
  assert.ok(c.call('fork', { from: 'proving-ground', name: 'ws2' }).ok);
  edit(c, 'ws2', [{ op: 'move', id: 'p1', pose: { p: [3.5, 0, 14], yaw: 0 } }]);
  const st = c.call('execute', { plan_id: plan, workspace: 'ws2' }) as any;
  assert.equal(st.code, 'plan.stale');
  assert.deepEqual(st.affected, [{ step: 's', causes: ['p1 (pose)'] }]);
});

test('staleness (LM-003): a layout-only region edit stales a gather into that region (layout is physical); physicalHash moves', () => {
  const c = fresh();
  const tpl = { schema: 'mars-sequence/1', id: 'lawn-gather', params: { a: { kind: 'actors' } }, steps: [{ id: 'g', verb: 'gather', params: { actors: '$a', region: 'lawn' } }, { id: 'up', verb: 'stand', params: { actor: 'n1' }, at: 40 }] };
  const plan = bind(c, tpl, { a: ['n1'] });
  const reh = c.call('rehearse', { plan_id: plan }) as any;
  assert.ok(reh.ok, reh.message);
  const lawn = (c.call('query_world', { workspace: 'ws', include: ['regions'] }) as any).regions.find((r: any) => r.id === 'lawn');
  const before = c.history.head('ws').physicalHash;
  const e = edit(c, 'ws', [{ op: 'region', id: 'lawn', kind: 'place', polygon: lawn.polygon, label: lawn.label, layout: { focus: [-24, -20] } }]);
  assert.deepEqual(e.diff.regions, ['lawn'], 'the layout alone is a physical difference');
  assert.notEqual(c.history.head('ws').physicalHash, before);
  const st = c.call('execute', { plan_id: plan, workspace: 'ws' }) as any;
  assert.equal(st.code, 'plan.stale');
  assert.deepEqual(st.diff.regions, ['lawn']);
  assert.deepEqual(st.affected.find((a: any) => a.step === 'g'), { step: 'g', causes: ['region lawn'] });
  // a label-only region edit stays non-physical
  const e2 = edit(c, 'ws', [{ op: 'region', id: 'lawn', kind: 'place', polygon: lawn.polygon, label: 'renamed', layout: { focus: [-24, -20] } }]);
  assert.deepEqual(e2.diff.regions, []);
});

test('rebind (LM-001): execute/rehearse rebind:auto re-binds a stale plan against the head (plan.rebound + diff); a broken binding is plan.rebind-failed naming the step', () => {
  const c = fresh();
  const plan = bind(c, walkPlan('p1-walk', -5, 5), { a: 'p1' });
  assert.ok((c.call('rehearse', { plan_id: plan }) as any).ok);
  edit(c, 'ws', [{ op: 'move', id: 'panel', lying: { x: -1, z: 8, yaw: 0 } }]);
  assert.equal(c.call('execute', { plan_id: plan, workspace: 'ws' }).code, 'plan.stale', 'opt-out (default) keeps the refusal');
  assert.equal(c.call('execute', { plan_id: plan, workspace: 'ws', rebind: 'refuse' }).code, 'plan.stale');
  assert.equal(c.call('execute', { plan_id: plan, workspace: 'ws', rebind: 'always' }).code, 'op.invalid-input');
  const rr = c.call('rehearse', { plan_id: plan, rebind: 'auto' }) as any;
  assert.ok(rr.ok, rr.message);
  assert.equal(rr.stale, undefined, 'the re-bound plan is rehearsed from the head');
  assert.equal(rr.rebound.type, 'plan.rebound');
  assert.equal(rr.rebound.from, plan);
  assert.notEqual(rr.plan_id, plan);
  assert.equal(rr.rebound.to, rr.plan_id);
  assert.deepEqual(rr.rebound.affected, [{ step: 's', causes: ['panel (pose)'] }]);
  assert.equal(rr.rebound.toBaseline, c.history.head('ws').id);
  const ex = c.call('execute', { plan_id: plan, workspace: 'ws', rebind: 'auto' }) as any;
  assert.ok(ex.ok, ex.message);
  assert.equal(ex.plan_id, rr.plan_id, 'same template + bindings + head → the same re-bound plan');
  assert.equal(ex.take_id, rr.take.take_id, 'execution reproduces the re-bound rehearsal');
  assert.deepEqual(ex.checkpoint.cause, { kind: 'simulation-run', take: ex.take_id, plan: rr.plan_id });
  const listed = (c.call('list', { include: ['plans'] }) as any).plans.map((p: any) => p.plan_id);
  assert.ok(listed.includes(rr.plan_id));
  assert.equal(c.plan(rr.plan_id)!.reboundFrom, plan);
  // not stale → rebind:auto is a no-op (no rebound event, same plan)
  const plan2 = bind(c, walkPlan('p1-back', 3.5, 12.5), { a: 'p1' });
  const ok2 = c.call('execute', { plan_id: plan2, workspace: 'ws', rebind: 'auto' }) as any;
  assert.ok(ok2.ok, ok2.message);
  assert.equal(ok2.rebound, undefined);
  // a bound actor removed by a design edit cannot re-bind: refused, naming the step and the diagnostic
  assert.ok(c.call('fork', { from: 'proving-ground', name: 'free', inventory: 'unlimited' }).ok);
  edit(c, 'free', [{ op: 'spawn', id: 'x1', def: 'human', pose: { p: [0, 0, 0], yaw: 0 } }]);
  const px = bind(c, walkPlan('x1-walk', 2, 2), { a: 'x1' }, 'free');
  edit(c, 'free', [{ op: 'remove', id: 'x1' }]);
  const rf = c.call('execute', { plan_id: px, workspace: 'free', rebind: 'auto' }) as any;
  assert.equal(rf.code, 'plan.rebind-failed');
  assert.deepEqual(rf.details.steps, ['s']);
  assert.match(rf.message, /step s: parameter "a": no entity "x1"/);
  assert.deepEqual(rf.details.stale.affected, [{ step: 's', causes: ['x1 (removed)'] }]);
});

test('store_camera_track (LM-013): a compiled directed track is stored beside its take — hash unchanged, listed, replayable; refusals', async () => {
  const { sampleTrack, trackData } = await import('../camera/track.ts');
  const { MAX_TAKE_CAMERA_BYTES } = await import('../api/controller.ts');
  const c = fresh();
  const plan = bind(c, walkPlan('p1-walk', -5, 5), { a: 'p1' });
  const reh = c.call('rehearse', { plan_id: plan }) as any;
  const take = reh.take.take_id as string;
  const other = c.call('rehearse', { plan_id: bind(c, walkPlan('p1-other', 0, 0), { a: 'p1' }) }) as any;
  // compile a track the way the studio does (here: planned by the engine, then relabelled as a downloaded directed track)
  const at = c.call('attach_camera_track', { take_id: take, shot: { kind: 'fixed', position: [0, 10, 30], target: [0, 0, 0] }, track_id: 'src' }) as any;
  assert.ok(at.ok, at.message);
  const src = (c.call('get_take', { take_id: take, include: ['cameras'] }) as any).cameras[0];
  const hash = c.takes.takeHash(take);
  const track = { ...src, id: 'dir-studio-1', kind: 'directed' };
  const r = c.call('store_camera_track', { take_id: take, track }) as any;
  assert.ok(r.ok, r.message);
  assert.equal(r.stored, true);
  assert.equal(r.takeHashUnchanged, true);
  assert.equal(c.takes.takeHash(take), hash);
  const listed = (c.call('get_take', { take_id: take }) as any).cameras;
  assert.deepEqual(listed.map((x: any) => [x.id, x.kind]), [['dir-studio-1', 'directed'], ['src', 'planned']]);
  assert.equal(listed[0].samples, src.data.samples.length);
  const back = (c.call('get_take', { take_id: take, include: ['cameras'] }) as any).cameras.find((x: any) => x.id === 'dir-studio-1');
  for (const t of [0, 1.23, 5]) assert.deepEqual(sampleTrack(trackData(back), t), sampleTrack(trackData(src), t), `replay t=${t}`);
  assert.ok((c.call('list', { take_id: take }) as any).cameras.some((x: any) => x.id === 'dir-studio-1'));
  // identical re-store is a no-op; a clash / other take / bad payload / oversize are named refusals
  assert.equal((c.call('store_camera_track', { take_id: take, track }) as any).stored, false);
  const clash = c.call('store_camera_track', { take_id: take, track: { ...track, kind: 'directed-v2' } }) as any;
  assert.equal(clash.code, 'camera.track-exists');
  assert.equal(c.call('store_camera_track', { take_id: other.take.take_id, track }).code, 'camera.track-take-mismatch');
  assert.equal(c.call('store_camera_track', { take_id: take, track: { ...track, id: 'x2', data: { ...track.data, schema: 'nope' } } }).code, 'camera.track-invalid');
  assert.equal(c.call('store_camera_track', { take_id: take, track: { ...track, id: 'x3', data: { ...track.data, samples: [] } } }).code, 'camera.track-invalid');
  const long = c.call('store_camera_track', { take_id: take, track: { ...track, id: 'x4', data: { ...track.data, duration: track.data.duration + 60 } } }) as any;
  assert.equal(long.code, 'camera.track-invalid');
  assert.match(long.message, /lasts .* but take/);
  assert.equal(c.call('store_camera_track', { take_id: 'nope', track }).code, 'take.unknown');
  assert.equal(c.call('store_camera_track', { take_id: take, track: { ...track, id: 'bad id!' } }).code, 'op.invalid-input');
  // byte cap per take (not a count): two ~60 %-of-cap tracks — the first fits, the second is camera.store-full
  const per = JSON.stringify(track.data.samples[0]).length + 1;
  const n = Math.ceil((0.6 * MAX_TAKE_CAMERA_BYTES) / per);
  const bigTrack = (id: string) => ({ ...track, id, data: { ...track.data, hz: (n - 1) / track.data.duration, samples: Array.from({ length: n }, (_, i) => ({ ...track.data.samples[0], t: (i * track.data.duration) / (n - 1) })) } });
  const b1 = c.call('store_camera_track', { take_id: take, track: bigTrack('x5') }) as any;
  assert.ok(b1.ok, b1.message);
  const b2 = c.call('store_camera_track', { take_id: take, track: bigTrack('x6') }) as any;
  assert.equal(b2.code, 'camera.store-full');
  assert.ok(b2.details.bytes > MAX_TAKE_CAMERA_BYTES);
  assert.equal(c.call('store_camera_track', { take_id: take, track: bigTrack('x7'), extra: 1 }).code, 'op.invalid-input');
});

test('edit_world (LM-005): a parked vehicle moves with the same footprint checks; a ridden one is edit.vehicle-ridden', async () => {
  const { provingGroundWorld } = await import('../api/seeds.ts');
  const { vehicle } = await import('../vehicles/actions.ts');
  const history = seedHistory();
  const w = provingGroundWorld();
  w.entities.bike = vehicle('bike', 'bicycle', 1, 12.5);
  history.publishCanonical('pg-bike', 'proving ground with a bicycle', w, 'LM-005 test');
  const c = createController({ history, scenes: ENGINE_SCENES });
  assert.ok(c.call('fork', { from: 'pg-bike', name: 'v' }).ok);
  const mv = c.call('edit_world', { workspace: 'v', edits: [{ op: 'move', id: 'bike', pose: { p: [-3, 0, 12.5], yaw: 0 } }], note: 'park it west' }) as any;
  assert.ok(mv.ok, mv.message);
  assert.deepEqual(mv.diff.changed, [{ id: 'bike', fields: ['pose'] }]);
  // footprint checks still apply: into the test wall / onto a person / off the floor
  const blocked = c.call('edit_world', { workspace: 'v', edits: [{ op: 'move', id: 'bike', pose: { p: [3.5, 0, 12.5], yaw: 0 } }], note: 'onto p1' }) as any;
  assert.equal(blocked.code, 'edit.blocked');
  assert.deepEqual(blocked.details.subjects, ['bike', 'p1']);
  assert.equal(c.call('edit_world', { workspace: 'v', edits: [{ op: 'move', id: 'bike', pose: { p: [400, 0, 400], yaw: 0 } }], note: 'off' }).code, 'edit.off-floor');
  // p1 mounts it (a simulated run); a design edit may not move it from under the rider
  const mount = bind(c, { schema: 'mars-sequence/1', id: 'mount', params: { a: { kind: 'actor' } }, steps: [{ id: 'go', verb: 'walk_to', params: { actor: '$a', x: -2.6, z: 11.7 } }, { id: 'm', verb: 'mount', params: { actor: '$a', vehicle: 'bike' }, after: ['go'] }] }, { a: 'p1' }, 'v');
  const ex = c.call('execute', { plan_id: mount, workspace: 'v' }) as any;
  assert.ok(ex.ok, ex.message);
  const ridden = c.call('edit_world', { workspace: 'v', edits: [{ op: 'move', id: 'bike', pose: { p: [-3, 0, 10], yaw: 0 } }], note: 'move ridden' }) as any;
  assert.equal(ridden.code, 'edit.vehicle-ridden');
  assert.deepEqual(ridden.details.subjects, ['bike', 'p1']);
  assert.match(ridden.message, /ridden by p1; dismount first/);
  assert.equal(c.call('edit_world', { workspace: 'v', edits: [{ op: 'remove', id: 'bike' }], note: 'remove ridden' }).code, 'edit.vehicle-ridden');
});

// ---- LM-007 / 008 / 010: camera sentences over the op API (W58) --------------------------------------

test('parse_camera (LM-007/008): Gene’s four sentences through the op — racks alias → the take’s rack bay, kitchen unknown in 2026, deictic question', async () => {
  const { flagship } = await import('./camera-direct-fixtures.ts');
  const { take, input } = flagship();
  const c = createController({ history: seedHistory(), scenes: { ...ENGINE_SCENES, [take.finalState.base.campus]: input.scene } });
  c.takes.put(take);
  const four = [
    'do a pan across Chiba with the sunset in the background',
    'do a 270° revolution around the main pallet racks over 2 minutes',
    'go inside the kitchen and face the sink',
    'look at this crowd of people having this activity',
  ];
  const r = c.call('parse_camera', { take_id: take.id, sentences: four }) as any;
  assert.equal(r.ok, false);
  assert.equal(r.code, 'camera.direct.unknown', 'first refusal (sentence 3) names the code');
  assert.deepEqual(r.directions.map((d: any) => d.index), [0, 1]);
  assert.deepEqual(r.directions[0].direction, { subject: { kind: 'region', ref: 'chiba' }, motion: { verb: 'pan' }, context: { sunBehind: { sunset: true } } });
  const racks = r.directions[1];
  assert.equal(racks.subject.said, 'rack bay');
  assert.match(racks.subject.id, /^structure:/, 'the alias resolves to the take’s rack bay structure');
  assert.deepEqual(racks.direction, { subject: { kind: 'assembly', ref: racks.subject.id }, motion: { verb: 'orbit', degrees: 270 }, duration: 120 });
  assert.deepEqual(r.refusals.map((x: any) => [x.index, x.code]), [[2, 'camera.direct.unknown'], [3, 'camera.parse.deictic']]);
  assert.match(r.refusals[0].message, /no region named 'kitchen-interior'/);
  assert.match(r.refusals[1].question, /which activity/i);
  assert.deepEqual(r.refusals[1].span, [8, 12]);
  // determinism + read-only
  assert.deepEqual(c.call('parse_camera', { take_id: take.id, sentences: four }), r);
  assert.equal(c.cameras(take.id).length, 0);
  // input refusals
  assert.equal(c.call('parse_camera', { sentences: four }).code, 'op.invalid-input');
  assert.equal(c.call('parse_camera', { take_id: take.id, workspace: 'proving-ground', sentences: four }).code, 'op.invalid-input');
  assert.equal(c.call('parse_camera', { take_id: take.id, sentences: [] }).code, 'op.invalid-input');
  assert.equal(c.call('parse_camera', { take_id: 'nope', sentences: four }).code, 'take.unknown');
});

test('parse_camera (LM-007/008/010): 2024 kitchen + sink resolve; bare 2026 racks are a question with candidates; unknown names and unsupported phrasing are refusals', async () => {
  const { campus2024, campus2026 } = await import('./camera-direct-fixtures.ts');
  const y24 = campus2024(), y26 = campus2026();
  const history = seedHistory();
  history.publishCanonical('y24', 'Mars 2024', y24.world, 'test');
  history.publishCanonical('y26', 'Mars 2026', y26.world, 'test');
  const c = createController({ history, scenes: { ...ENGINE_SCENES, [y24.world.base.campus]: y24.scene, [y26.world.base.campus]: y26.scene } });
  const k = c.call('parse_camera', { workspace: 'y24', sentences: ['go inside the kitchen and face the sink'] }) as any;
  assert.ok(k.ok, k.message);
  assert.deepEqual(k.directions[0].direction, { subject: { kind: 'region', ref: 'kitchen-interior' }, motion: { verb: 'fly_through' }, context: { interior: 'kitchen-interior', lookAt: 'sink' } });
  assert.equal(k.source.campus, y24.world.base.campus);
  // no built bay in the bare 2026 campus: the rack alias falls back to the scene's rack buildings — a question, not a guess
  const amb = c.call('parse_camera', { workspace: 'y26', sentences: ['do a 270° revolution around the main pallet racks over 2 minutes'] }) as any;
  assert.equal(amb.code, 'camera.direct.ambiguous');
  assert.ok(['north-rack-building', 'west-rack-building'].every((id) => amb.refusals[0].candidates.includes(id)), JSON.stringify(amb.refusals[0].candidates));
  assert.match(amb.refusals[0].question, /Which assembly/);
  // a named rack building resolves directly
  const north = c.call('parse_camera', { workspace: 'y26', sentences: ['pan across the north rack building'] }) as any;
  assert.ok(north.ok, north.message);
  assert.deepEqual([north.directions[0].subject.kind, north.directions[0].subject.id], ['region', 'north-rack-building'], 'a building region is named once, as the region');
  // unknown: lists what is known
  const venus = c.call('parse_camera', { workspace: 'y26', sentences: ['hold on Venus'] }) as any;
  assert.equal(venus.code, 'camera.direct.unknown');
  assert.ok(venus.refusals[0].details.known.some((x: any) => x.id === 'chiba'));
  // LM-010: untested paraphrases are refusals / notes by design, through the op too
  const para = c.call('parse_camera', { workspace: 'y26', sentences: ['zoom in on Chiba', 'orbit around Chiba', 'hold on Chiba with a wide lens', 'watch the crowd of people eating'] }) as any;
  assert.deepEqual(para.refusals.map((x: any) => [x.index, x.code]), [[0, 'camera.parse.unknown-verb'], [1, 'camera.parse.missing'], [3, 'camera.direct.unknown']]);
  assert.deepEqual(para.directions.map((d: any) => [d.index, d.notes]), [[2, ['wide lens has no numeric fov; lens choice left to the engine']]]);
  assert.match(para.refusals[2].message, /nobody is doing 'eat'/);
});

test('direct_camera (LM-007): `sentences` are parsed then compiled in one call — the same track as the parsed directions; refusals compile nothing', async () => {
  const { flagship } = await import('./camera-direct-fixtures.ts');
  const { take, input } = flagship();
  const c = createController({ history: seedHistory(), scenes: { ...ENGINE_SCENES, [take.finalState.base.campus]: input.scene } });
  c.takes.put(take);
  const sentence = 'do a 270° revolution around the main pallet racks over 2 minutes';
  const parsed = (c.call('parse_camera', { take_id: take.id, sentences: [sentence] }) as any).directions.map((d: any) => d.direction);
  const r = c.call('direct_camera', { take_id: take.id, sentences: [sentence] }) as any;
  assert.ok(r.ok, r.message);
  assert.equal(r.track_id, `dir-${hashOf({ take: take.id, directions: parsed, hz: 10 }).slice(0, 12)}`, 'same id as direct_camera { directions: parsed }');
  assert.equal(r.parsed[0].subject.said, 'rack bay');
  assert.equal(r.takeHashUnchanged, true);
  assert.deepEqual(c.cameras(take.id).map((x) => x.id), [r.track_id]);
  const bad = c.call('direct_camera', { take_id: take.id, sentences: [sentence, 'zoom in on Chiba'] }) as any;
  assert.equal(bad.code, 'camera.parse.unknown-verb');
  assert.deepEqual(bad.refusals.map((x: any) => x.index), [1]);
  assert.equal(c.cameras(take.id).length, 1, 'a refused sentence compiles and stores nothing');
  assert.equal(c.call('direct_camera', { take_id: take.id }).code, 'op.invalid-input');
  assert.equal(c.call('direct_camera', { take_id: take.id, sentences: [sentence], directions: parsed }).code, 'op.invalid-input');
});
