// Engine P4: a Soul's first GET /v1/edge/capabilities on Eden 2026 blocked the server 79–85 s (192 s on a 4-core cloud
// box), and calls after a walk up to 45 s: every far place built its own window with all upper floors, and the rooms a
// building's stairs do not reach searched the whole window for each of 14 standing points. The capabilities are
// synchronous, so their wall time is how long the event loop is blocked. Budgets here are generous (several times the
// measured 7–9 s and 2–4 s on that box); the counts say why the time stays down.
import test from 'node:test';
import assert from 'node:assert/strict';
import { strandedMetrics } from '../../../mars/viewer/engine/spatial/path.ts';
import { accept } from '../test/native-owner-fixture.ts';
import { existsSync } from 'node:fs';
import { bootEden, timed } from '../test/eden-capabilities-timing.ts';

// The Eden 2026 template is lane/engine content, not in every trunk; without it the budget cannot be measured here.
const NO_EDEN = existsSync(new URL('../../../worlds/templates/eden-2026.json', import.meta.url)) ? false : 'needs worlds/templates/eden-2026.json (lane/engine content)';

const FIRST_BUDGET_MS = 40_000, LATER_BUDGET_MS = 20_000;

test('Eden 2026: a new Soul\'s capabilities stay within budget, first and after a walk', { timeout: 600_000, skip: NO_EDEN }, async (t) => {
  const w = await bootEden();
  t.after(() => w.close());
  const nav = (w.host.engine as unknown as { rt: { services: { spatial: { ground: { stats: Record<string, number>; fineMax: number; fine: Map<string, unknown>; keyOf(tx: number, tz: number, rel: unknown): string; fineTile(tx: number, tz: number, rel: unknown, key?: string): unknown } } } } }).rt.services.spatial.ground;
  // which fine tiles each sweep builds (a build of a tile an earlier sweep already built is a rebuild: LRU thrash)
  const built: string[] = [], fineTile = nav.fineTile.bind(nav);
  nav.fineTile = (tx, tz, rel, key = nav.keyOf(tx, tz, rel)) => { if (!nav.fine.has(key)) built.push(key); return fineTile(tx, tz, rel, key); };
  const s0 = { ...nav.stats }, h0 = strandedMetrics().hits;
  const first = timed(() => w.edge.capabilities(w.soul));
  assert.ok(first.value.length > 300, `a full list (${first.value.length})`);
  assert.ok(first.value.some((c) => c.verb === 'walk' && c.available), 'some walk is available');
  assert.ok(first.ms < FIRST_BUDGET_MS, `first capabilities took ${Math.round(first.ms)} ms (budget ${FIRST_BUDGET_MS})`);
  // E-life: the sweep now reads only nearby places' tiles (loops/strolls within reach; spots probed within reach), so the
  // far rooms' window floors are read about once each: bounded builds is the check (P4's failure mode was a build per
  // standing point, thousands), not more reuse than builds
  const floorBuilds = nav.stats.floorBuilds - s0.floorBuilds, floorHits = nav.stats.floorHits - s0.floorHits;
  assert.ok(floorBuilds <= 100, `window floors are built once per far room window (${floorBuilds} built, ${floorHits} reused)`);
  const sweep1 = new Set(built);
  assert.ok(sweep1.size <= nav.fineMax, `one sweep's fine tiles fit the cache (${sweep1.size} built, ${nav.fineMax} kept)`);
  assert.ok(strandedMetrics().hits - h0 > 0, 'standing points in rooms the stairs do not reach are refused without a search');
  assert.ok(nav.fineMax >= 40, 'paged worlds keep enough fine tiles for a capabilities sweep');

  // walk somewhere, past the per-thing goal cache (50 ticks): the next call recomputes every goal from warm tiles
  const walk = (first.value as { id: string; verb: string; available?: boolean; target?: { kind?: string } }[]).find((c) => c.verb === 'walk' && c.available && c.target?.kind === 'place')!;
  const acted = await accept(w.host, Promise.resolve(w.edge.act(w.soul, { capability: walk.id }))) as { accepted?: boolean };
  assert.equal(acted.accepted, true, JSON.stringify(acted));
  await w.settle(60);
  built.length = 0;
  const later = timed(() => w.edge.capabilities(w.soul));
  assert.ok(later.ms < LATER_BUDGET_MS, `capabilities after walking took ${Math.round(later.ms)} ms (budget ${LATER_BUDGET_MS})`);
  assert.deepEqual(built.filter((k) => sweep1.has(k)), [], 'no fine tile rebuilt for a second sweep (new ground near where it walked is built once)');
});
