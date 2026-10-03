// Standalone engine proof; test inputs are not a Soul routine or day driver.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { Runtime } from '../mars/viewer/engine/runtime/runtime.ts';
import { compactRuntime, compactionIssue } from '../mars/viewer/engine/runtime/compact.ts';
import { createRegistry, servicesFor, ENGINE_INVARIANTS } from '../mars/viewer/engine/api/registry.ts';
import { provingGround } from '../mars/viewer/engine/scenes/proving-ground.ts';
import { mealWorld, runMeal } from '../mars/viewer/engine/scenarios/meal.ts';

const services = servicesFor({ 'proving-ground': provingGround() });
const seed = mealWorld();
const baseline = new Runtime(structuredClone(seed), createRegistry(), services(seed), ENGINE_INVARIANTS);
runMeal(baseline);
for (const actor of ['p1', 'p2', 'p3', 'p4']) baseline.submit('stand', { actor });
baseline.runUntilIdle(1000, [...baseline.records.values()].filter(r => r.verb === 'stand').map(r => r.id));
for (const prefix of ['bowl', 'spoon']) {
  const ids = ['p1', 'p2', 'p3', 'p4'].map((actor, i) => baseline.submit('put_item', { actor, item: `${prefix}${i + 1}`, surfaceSlot: 'ground' }).id);
  baseline.runUntilIdle(1000, ids);
}
baseline.runUntilIdle(10);
assert.equal(compactionIssue(baseline), null);
let compacted = compactRuntime(baseline, services);
const rows: { day: number; tick: number; hash: string; recordsBefore: number; recordsAfter: number; nsPerTick: number; heap: number }[] = [];
for (let day = 1; day <= 48; day++) {
  const goal = day % 2 ? [-10, -4] : [-6, -12];
  for (const rt of [baseline, compacted]) assert.notEqual(rt.submit('walk_to', { actor: 'p1', x: goal[0], z: goal[1] }, { id: `day-${day}-walk` }).status, 'failed');
  const until = compacted.tick + 72000;
  let compactMs = 0;
  while (compacted.tick < until) {
    baseline.step();
    const start = performance.now(); compacted.step(); compactMs += performance.now() - start;
  }
  assert.equal(compacted.stateHash(), baseline.stateHash(), `day ${day} world equivalence`);
  assert.equal(compactionIssue(compacted), null);
  assert.equal(compacted.violations.length, 0);
  const recordsBefore = compacted.records.size;
  compacted = compactRuntime(compacted, services);
  assert.equal(compacted.stateHash(), baseline.stateHash(), `day ${day} after renewal`);
  globalThis.gc?.();
  const row = { day, tick: compacted.tick, hash: compacted.stateHash(), recordsBefore, recordsAfter: compacted.records.size, nsPerTick: compactMs * 1e6 / 72000, heap: process.memoryUsage().heapUsed };
  rows.push(row);
  console.log(JSON.stringify(row));
}
writeFileSync(process.argv[2] ?? '/tmp/sim-compaction-proof.json', JSON.stringify({ days: 48, dayTicks: 72000, exactWorldHashes: true, rows }, null, 2));
