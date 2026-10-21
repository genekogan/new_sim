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
import { bootEden, timed, referenceMs } from '../test/eden-capabilities-timing.ts';

// The Eden 2026 template is lane/engine content, not in every trunk; without it the budget cannot be measured here.
const NO_EDEN = existsSync(new URL('../../../worlds/templates/eden-2026.json', import.meta.url)) ? false : 'needs worlds/templates/eden-2026.json (lane/engine content)';

// L3 (suite trust): the wall-clock budgets are in units of the runner's own speed (referenceMs, ~32 ms on the laptop),
// like eden-here-budget, so a slow shared runner is not judged by the laptop's clock; the counts below stay strict.
// Laptop 2026-10-17: first 33 units (1.09 s), after a walk 17 units (0.56 s). The budgets are ~12x that and still far
// under P4's failures (79-85 s first = ~2500 units; 45 s after a walk = ~1400 units). Was a fixed 40 s / 20 s.
const FIRST_BUDGET_REFS = 400, LATER_BUDGET_REFS = 200;

test('Eden 2026: a new Soul\'s capabilities stay within budget, first and after a walk', { timeout: 600_000, skip: NO_EDEN }, async (t) => {
  const w = await bootEden();
  t.after(() => w.close());
  const nav = (w.host.engine as unknown as { rt: { services: { spatial: { ground: { stats: Record<string, number>; fineMax: number; fine: Map<string, unknown>; keyOf(tx: number, tz: number, rel: unknown): string; fineTile(tx: number, tz: number, rel: unknown, key?: string, keep?: boolean): unknown } } } } }).rt.services.spatial.ground;
  // which fine tiles each sweep builds (a build of a tile an earlier sweep already built is a rebuild: LRU thrash)
  const built: string[] = [], fineTile = nav.fineTile.bind(nav);
  // (keep = false is the connectivity audit's read-through, never cached: forwarded as is and not an engine build)
  nav.fineTile = (tx, tz, rel, key = nav.keyOf(tx, tz, rel), keep = true) => { if (keep && !nav.fine.has(key)) built.push(key); return fineTile(tx, tz, rel, key, keep); };
  const ref = referenceMs(), FIRST_BUDGET_MS = FIRST_BUDGET_REFS * ref, LATER_BUDGET_MS = LATER_BUDGET_REFS * ref;
  const s0 = { ...nav.stats }, h0 = strandedMetrics().hits;
  const first = timed(() => w.edge.capabilities(w.soul));
  assert.ok(first.value.length > 300, `a full list (${first.value.length})`);
  assert.ok(first.value.some((c) => c.verb === 'walk' && c.available), 'some walk is available');
  t.diagnostic(`first capabilities: ${Math.round(first.ms)} ms = ${(first.ms / ref).toFixed(0)} units of ${ref.toFixed(1)} ms (budget ${FIRST_BUDGET_REFS} units = ${Math.round(FIRST_BUDGET_MS)} ms)`);
  assert.ok(first.ms < FIRST_BUDGET_MS, `first capabilities took ${Math.round(first.ms)} ms (budget ${FIRST_BUDGET_REFS} x ${ref.toFixed(1)} ms = ${Math.round(FIRST_BUDGET_MS)} ms)`);
  // E-life: the sweep now reads only nearby places' tiles (loops/strolls within reach; spots probed within reach), so the
  // far rooms' window floors are read about once each: bounded builds is the check (P4's failure mode was a build per
  // standing point, thousands), not more reuse than builds
  const floorBuilds = nav.stats.floorBuilds - s0.floorBuilds, floorHits = nav.stats.floorHits - s0.floorHits;
  assert.ok(floorBuilds <= 100, `window floors are built once per far room window (${floorBuilds} built, ${floorHits} reused)`);
  const sweep1 = new Set(built);
  assert.ok(sweep1.size <= nav.fineMax, `one sweep's fine tiles fit the cache (${sweep1.size} built, ${nav.fineMax} kept)`);
  // (E-life: upper-storey rooms are now checked only from inside their building, so a first sweep from outside may make
  // no failed upstairs search at all; the stranded-search memo stays covered by its own path tests)
  void strandedMetrics; void h0;
  // L1: point reads off the windows (stroll stops, standing room round far things) build no fine tiles any more, so a
  // sweep builds a few dozen at most (was ~230 on Eden 2026, which needed a 48-tile cache); the cache is 24 + the windows
  assert.ok(sweep1.size <= 30, `a sweep builds few fine tiles (${sweep1.size})`);

  // walk somewhere, past the per-thing goal cache (50 ticks): the next call recomputes every goal from warm tiles
  const walk = (first.value as { id: string; verb: string; available?: boolean; target?: { kind?: string } }[]).find((c) => c.verb === 'walk' && c.available && c.target?.kind === 'place')!;
  const acted = await accept(w.host, Promise.resolve(w.edge.act(w.soul, { capability: walk.id }))) as { accepted?: boolean };
  assert.equal(acted.accepted, true, JSON.stringify(acted));
  await w.settle(60);
  built.length = 0;
  const later = timed(() => w.edge.capabilities(w.soul));
  t.diagnostic(`capabilities after walking: ${Math.round(later.ms)} ms = ${(later.ms / ref).toFixed(0)} units (budget ${LATER_BUDGET_REFS} units = ${Math.round(LATER_BUDGET_MS)} ms)`);
  assert.ok(later.ms < LATER_BUDGET_MS, `capabilities after walking took ${Math.round(later.ms)} ms (budget ${LATER_BUDGET_REFS} x ${ref.toFixed(1)} ms = ${Math.round(LATER_BUDGET_MS)} ms)`);
  assert.deepEqual(built.filter((k) => sweep1.has(k)), [], 'no fine tile rebuilt for a second sweep (new ground near where it walked is built once)');
});
