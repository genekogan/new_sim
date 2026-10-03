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


test('state store (review M5): index without states, lazy state reads, commits put only the new state, old blobs migrate', () => {
  const h = pgHistory();
  const w1 = h.read('ws');
  w1.entities.n1.pose.p = [14, 0, -20];
  h.commit('ws', w1, { kind: 'design-edit', note: 'move n1' });
  const w2 = h.read('ws');
  w2.entities.s1.pose.p = [14, 0, -10];
  h.commit('ws', w2, { kind: 'design-edit', note: 'move s1' });
  // an old-format blob (states inline) — what the Durable Object stored before
  const old = JSON.parse(JSON.stringify(h.toJSON()));
  assert.equal(old.states.length, 3);

  const blobs = new Map<string, string>();
  let gets = 0, puts = 0;
  const store = {
    has: (k: string) => blobs.has(k),
    get: (k: string) => (gets++, blobs.has(k) ? JSON.parse(blobs.get(k)!) : undefined),
    put: (k: string, s: unknown) => (puts++, void blobs.set(k, JSON.stringify(s))),
  };
  // migrate on first load: every inline state becomes its own blob; the index drops them
  const migrated = WorldHistory.fromJSON(old);
  assert.equal(migrated.attachStateStore(store), 3);
  const index = JSON.parse(JSON.stringify(migrated.toJSON({ states: false })));
  assert.equal(index.states, undefined);
  assert.ok(JSON.stringify(index).length < JSON.stringify(old).length / 2, 'index is small');
  assert.deepEqual([...blobs.keys()].sort(), old.states.map(([k]: [string]) => k).sort());

  // reload from index + store: states load on demand (once), contents identical to the old blob
  const h2 = WorldHistory.fromJSON(index);
  h2.attachStateStore(store);
  gets = 0;
  for (const ws of ['pg', 'ws']) assert.equal(hashOf(h2.read(ws)), hashOf(h.read(ws)));
  for (const cp of h.log('ws')) assert.equal(hashOf(h2.read(cp.id)), cp.stateHash);
  assert.equal(gets, 3, 'each state fetched once');
  h2.read('ws');
  assert.equal(gets, 3, 'then served from the cache');

  // a commit puts exactly the new state; re-committing a known state puts nothing
  puts = 0;
  const w3 = h2.read('ws');
  w3.entities.p1.pose.p = [3, 0, 12];
  const cp3 = h2.commit('ws', w3, { kind: 'design-edit', note: 'move p1' });
  assert.equal(puts, 1);
  assert.ok(blobs.has(cp3.stateHash));
  h2.fork('pg', 'ws2', 'second');
  h2.commit('ws2', h.read('ws'), { kind: 'design-edit', note: 'same as ws before p1' });
  assert.equal(puts, 1, 'known state is not written again');
  // the full format still round-trips (tests/files) and a missing state fails loudly
  assert.equal(hashOf(WorldHistory.fromJSON(JSON.parse(JSON.stringify(h.toJSON()))).read('ws')), hashOf(h.read('ws')));
  const bare = WorldHistory.fromJSON(index);
  assert.throws(() => bare.read('ws'), /not stored/);
});
