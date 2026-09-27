// Rehearsal vs official execution (spec §16, §21–22, §28 fork isolation / plan invalidation).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashOf } from '../core/hash.ts';
import { HistoryError } from '../history/store.ts';
import { Spatial } from '../spatial/service.ts';
import { provingGround } from '../scenes/proving-ground.ts';
import { bindTemplate } from '../sequence/bind.ts';
import { execute, rehearse, checkPlan } from '../rehearsal/rehearse.ts';
import { TakeLibrary } from '../take/store.ts';
import { config, crossBindings, crossTemplate, PANEL_IN_PASSAGE, pgHistory, registry } from './sequence-fixtures.ts';

const bind = (h: ReturnType<typeof pgHistory>, baseline = 'ws') => bindTemplate(crossTemplate, crossBindings, { history: h, baseline, registry: registry() });

test('rehearsal/live consistency: same plan + same baseline → identical final state and take', () => {
  const h = pgHistory();
  const plan = bind(h);
  const reh = rehearse(h, 'ws', plan, config());
  assert.ok(reh.report.ok, JSON.stringify(reh.report.diagnostics));
  assert.equal(reh.stale, undefined);
  const ex = execute(h, 'ws', plan, config());
  assert.ok(ex.ok, 'executed');
  assert.equal(ex.report.finalStateHash, reh.report.finalStateHash);
  assert.deepEqual(ex.take.tracks, reh.take.tracks);
  assert.deepEqual(ex.take.events, reh.take.events);
  assert.equal(ex.take.id, reh.take.id);
  assert.equal(ex.checkpoint.stateHash, reh.take.finalStateHash);
  assert.deepEqual(ex.checkpoint.cause, { kind: 'simulation-run', take: ex.take.id, plan: plan.planHash });
  assert.equal(h.head('ws').id, ex.checkpoint.id);
  assert.ok(ex.report.metrics.pathLength > 25 && ex.report.metrics.duration > 20);
  // a successful execution consumed the baseline: executing the same plan again is stale
  const again = execute(h, 'ws', plan, config());
  assert.ok(!again.ok && again.code === 'plan.stale');
});

test('rehearsal is private: history, heads and checkpoints untouched', () => {
  const h = pgHistory();
  const plan = bind(h);
  const before = hashOf(h.toJSON());
  const r = rehearse(h, 'ws', plan, config());
  assert.ok(r.report.ok);
  assert.equal(hashOf(h.toJSON()), before);
  // the returned final state is a private copy
  r.finalState.entities.n1.pose.p[0] = 1e3;
  assert.equal(hashOf(h.toJSON()), before);
});

test('fork isolation: canonical refuses execution; executing in one branch leaves parent and sibling unchanged', () => {
  const h = pgHistory();
  h.fork('pg', 'sib', 'sibling');
  const plan = bind(h, 'pg'); // plans may be bound against the canonical checkpoint...
  const canon = h.head('pg'), sib = h.head('sib');
  const refused = execute(h, 'pg', plan, config());
  assert.ok(!refused.ok && refused.code === 'workspace.protected', '...but canonical states must be forked first');
  const ex = execute(h, 'ws', plan, config());
  assert.ok(ex.ok);
  assert.equal(h.head('pg').id, canon.id);
  assert.equal(h.head('sib').id, sib.id);
  assert.deepEqual(h.read('pg').entities.n1.pose.p, [15, 0, -20]);
  assert.deepEqual(h.read('sib').entities.n1.pose.p, [15, 0, -20]);
  assert.notDeepEqual(h.read('ws').entities.n1.pose.p, [15, 0, -20]);
  // the sibling can still execute the same plan independently, with the same result
  const ex2 = execute(h, 'sib', plan, config());
  assert.ok(ex2.ok);
  assert.equal(ex2.checkpoint.stateHash, ex.checkpoint.stateHash);
  assert.equal(h.head('pg').id, canon.id);
});

test('plan invalidation: moving an obstacle into the route after rehearsal makes execution stale', () => {
  const h = pgHistory();
  const plan = bind(h);
  assert.ok(rehearse(h, 'ws', plan, config()).report.ok);
  const w = h.read('ws');
  w.entities.panel.pose = { ...PANEL_IN_PASSAGE };
  h.commit('ws', w, { kind: 'design-edit', note: 'lean a plywood sheet across the passage' });
  const head = h.head('ws').id;
  const ex = execute(h, 'ws', plan, config());
  assert.ok(!ex.ok && ex.code === 'plan.stale');
  assert.ok(ex.diff);
  assert.deepEqual(ex.diff.changed, [{ id: 'panel', fields: ['pose'] }]);
  assert.match(ex.message, /panel changed \(pose\)/);
  assert.equal(h.head('ws').id, head, 'a stale plan never commits');
  // rehearsal still runs from the plan's own baseline, but flags the staleness
  const r = rehearse(h, 'ws', plan, config());
  assert.ok(r.report.ok);
  assert.equal(r.stale?.code, 'plan.stale');
  // rebinding against the new head produces a fresh plan that passes the baseline check
  // (not executed here: with the passage closed both walkers detour around the same wall end)
  const plan2 = bind(h);
  assert.notEqual(plan2.planHash, plan.planHash);
  assert.equal(plan2.baselineCheckpoint, head);
  assert.ok(checkPlan(h, 'ws', plan2).ok);
});

test('plan invalidation: env/weather, labels and provenance edits do NOT stale a plan', () => {
  const h = pgHistory();
  const plan = bind(h);
  const reh = rehearse(h, 'ws', plan, config());
  const w = h.read('ws');
  w.env = { datetime: '2026-03-01T19:30', weather: { clouds: 0.8, rain: 0.3, wind: 0.5, dust: 0.1, wet: 0.4 } };
  w.entities.n1.label = 'Nadia';
  w.entities.panel.provenance = { origin: 'reconstruction-edit', confidence: 'participant', note: 'seen in photo' };
  h.commit('ws', w, { kind: 'design-edit', note: 'dusk, light rain' });
  assert.ok(checkPlan(h, 'ws', plan).ok);
  const ex = execute(h, 'ws', plan, config());
  assert.ok(ex.ok, !ex.ok ? ex.message : '');
  // same performance; the successor carries the env edit forward
  assert.deepEqual(ex.take.tracks, reh.take.tracks);
  assert.equal(h.read('ws').env.weather.rain, 0.3);
  assert.equal(h.read('ws').entities.n1.label, 'Nadia');
});

test('plan invalidation: inventory mode, RNG state and rules version are physical assumptions', () => {
  for (const edit of ['inventory', 'rng'] as const) {
    const h = pgHistory();
    const plan = bind(h);
    const w = h.read('ws');
    if (edit === 'inventory') w.inventory = 'unlimited';
    else w.rng = [1, 2, 3, 4];
    h.commit('ws', w, { kind: 'design-edit', note: edit });
    const ex = execute(h, 'ws', plan, config());
    assert.ok(!ex.ok && ex.code === 'plan.stale' && ex.diff?.other.includes(edit), edit);
  }
  const h = pgHistory();
  const plan = bind(h);
  h.rulesVersion = 'mars-rules/test-2';
  const ex = execute(h, 'ws', plan, config());
  assert.ok(!ex.ok && ex.code === 'plan.stale' && /rules/.test(ex.message));
  assert.throws(() => rehearse(h, 'ws', plan, config()), (e: any) => e instanceof HistoryError && e.code === 'plan.stale');
});

test('failed official runs are not committed; the take is still recorded', () => {
  const h = pgHistory();
  const plan = bindTemplate(
    { schema: 'mars-sequence/1', id: 'doomed', params: {}, steps: [{ id: 'w', verb: 'walk_to', params: { actor: 'n1', x: 0, z: -20 } }, { id: 'boom', verb: 'wait_ticks', params: { n: 10, fail: true } }] },
    {},
    { history: h, baseline: 'ws', registry: registry() },
  );
  const lib = new TakeLibrary();
  const head = h.head('ws').id;
  const ex = execute(h, 'ws', plan, config(), { takes: lib });
  assert.ok(!ex.ok && ex.code === 'execution.failed');
  assert.equal(ex.report.status, 'aborted');
  assert.ok(lib.has(ex.take.id));
  assert.equal(h.head('ws').id, head);
  const forced = execute(h, 'ws', plan, config(), { commitOnFailure: true });
  assert.ok(forced.ok);
  assert.equal(forced.report.status, 'aborted');
});

test('tampered plans and mismatched service scenes fail loudly', () => {
  const h = pgHistory();
  const plan = bind(h);
  const bad = structuredClone(plan);
  (bad.steps[0].params as any).x = 0;
  const ex = execute(h, 'ws', bad, config());
  assert.ok(!ex.ok && ex.code === 'plan.corrupt');
  const cfg = { ...config(), services: () => ({ spatial: new Spatial(provingGround({ stairsBUsable: true })) }) };
  assert.throws(() => rehearse(h, 'ws', plan, cfg), (e: any) => e.code === 'services.base-mismatch');
});
