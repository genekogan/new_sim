// physicalView / physicalHash semantics and simulation-run causes in history (spec §16, §21).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashOf } from '../core/hash.ts';
import { physicalView } from '../world/types.ts';
import { WorldHistory } from '../history/store.ts';
import { bindTemplate } from '../sequence/bind.ts';
import { execute } from '../rehearsal/rehearse.ts';
import { config, crossBindings, crossTemplate, pgHistory, pgWorld, registry } from './sequence-fixtures.ts';

const ph = (w: ReturnType<typeof pgWorld>) => hashOf(physicalView(w));

test('physicalHash ignores env, clock, labels, tags and provenance', () => {
  const base = ph(pgWorld());
  const edits: ((w: ReturnType<typeof pgWorld>) => void)[] = [
    (w) => (w.env.weather.rain = 1),
    (w) => (w.env.datetime = '2026-03-02T06:00'),
    (w) => (w.tick = 999),
    (w) => (w.entities.n1.label = 'someone'),
    (w) => (w.entities.n1.tags = ['crew']),
    (w) => (w.entities.panel.provenance = { origin: 'canonical', confidence: 'documented' }),
  ];
  for (const e of edits) {
    const w = pgWorld();
    e(w);
    assert.equal(ph(w), base, e.toString());
  }
});

test('physicalHash tracks poses, phases, supports, activity, inventory and RNG', () => {
  const base = ph(pgWorld());
  const edits: ((w: ReturnType<typeof pgWorld>) => void)[] = [
    (w) => (w.entities.panel.pose.p[0] += 0.01),
    (w) => (w.entities.panel.phase = 'staged'),
    (w) => (w.entities.panel.support = { kind: 'held', by: ['n1'] }),
    (w) => (w.entities.n1.human!.activity = 'walk'),
    (w) => delete w.entities.p1,
    (w) => (w.inventory = 'unlimited'),
    (w) => (w.rng = [1, 2, 3, 4]),
  ];
  for (const e of edits) {
    const w = pgWorld();
    e(w);
    assert.notEqual(ph(w), base, e.toString());
  }
});

test('official execution appends a simulation-run checkpoint naming the take and plan', () => {
  const h = pgHistory();
  const plan = bindTemplate(crossTemplate, crossBindings, { history: h, baseline: 'ws', registry: registry() });
  const ex = execute(h, 'ws', plan, config(), { label: 'crossing' });
  assert.ok(ex.ok);
  const log = h.log('ws');
  assert.deepEqual(log.map((c) => c.cause.kind), ['simulation-run', 'canonical-publish']);
  assert.equal(log[0].label, 'crossing');
  assert.equal(log[0].parent, plan.baselineCheckpoint);
  assert.equal(log[0].rulesVersion, plan.rulesVersion);
  // history round-trips with the new checkpoint intact
  const h2 = WorldHistory.fromJSON(JSON.parse(JSON.stringify(h.toJSON())));
  assert.equal(hashOf(h2.read('ws')), ex.take.finalStateHash);
});

