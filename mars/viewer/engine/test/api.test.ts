// Engine API controller (spec §13, §15, §16, §24): the same op registry drives
// in-process calls and the Durable Object's engine_* MCP tools.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
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
