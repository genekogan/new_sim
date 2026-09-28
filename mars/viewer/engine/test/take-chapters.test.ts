// Chapter takes (W31, engine/take/chapters.ts): one continuous run recorded as consecutive takes cut at plan barriers.
// 1. the mechanism on a small open-ground plan: the chaptered run IS the unchaptered run (same ticks, same final hash),
//    each chapter starts where the one before ended, a bound that is not a barrier is refused;
// 2. the shipped chapter sets (public/engine/takes/manifest.json `chapterSets`): the first frame of chapter k is the final
//    state of chapter k − 1, the chapters' ticks sum to the set's, the last final state is the set's (for the 2022
//    east-house A+B: the year-build-b.test.ts pin ddb634d6… @ 600 599).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashOf } from '../core/hash.ts';
import { humanHumanSeparation, humanStaticClearance } from '../runtime/invariants.ts';
import { Spatial } from '../spatial/service.ts';
import { emptyWorld, human } from '../world/factory.ts';
import { walkTo } from '../locomotion/walk.ts';
import { runPlan, type EngineConfig } from '../rehearsal/rehearse.ts';
import { chapterContinuity, isBarrier, runPlanChapters } from '../take/chapters.ts';
import { TakeLibrary } from '../take/store.ts';
import type { BoundPlan, StepSpec } from '../sequence/types.ts';
import type { ActionDef } from '../actions/types.ts';
import type { Take } from '../take/types.ts';
import { openGround } from './frame-fixtures.ts';

const walk = (id: string, actor: string, x: number, z: number, after?: string[]): StepSpec => ({ id, verb: 'walk_to', params: { actor, x, z }, ...(after ? { after } : {}) });
// a and b walk out; then (after both) each walks on; then (after both) back
const STEPS: StepSpec[] = [
  walk('a1', 'a', 4, 0), walk('b1', 'b', -4, 2),
  walk('a2', 'a', 4, 4, ['a1', 'b1']), walk('b2', 'b', -4, -3, ['a1', 'b1']),
  walk('a3', 'a', 1, 0, ['a2', 'b2']), walk('b3', 'b', -1, 0, ['a2', 'b2']),
];
const plan = { steps: STEPS, planHash: 'chapters-test' } as unknown as BoundPlan;
const cfg: EngineConfig = {
  registry: new Map<string, ActionDef>([[walkTo.verb, walkTo as ActionDef]]),
  invariants: [humanHumanSeparation, humanStaticClearance],
  services: () => ({ spatial: new Spatial(openGround()) }),
};
const start = () => {
  const w = emptyWorld('open', openGround());
  w.entities.a = human('a', 0, -1);
  w.entities.b = human('b', 0, 1);
  return w;
};

test('chapter takes: the chaptered run is the unchaptered run cut at barriers — same ticks and final state, chapter k starts where k − 1 ended; a non-barrier bound is refused', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((i) => isBarrier(STEPS, i)), [true, false, true, false, true, false, true]);
  const whole = runPlan(start(), 'cp', plan, cfg, 'test');
  assert.equal(whole.report.status, 'completed');
  const ch = runPlanChapters(start(), 'cp', plan, cfg, 'test', [{ id: 'out', at: 0 }, { id: 'on', at: 2 }, { id: 'back', at: 4 }]);
  assert.equal(ch.report.status, 'completed');
  assert.deepEqual(ch.report.violations, []);
  assert.equal(ch.report.metrics.ticks, whole.report.metrics.ticks);
  assert.equal(ch.report.finalStateHash, whole.take.finalStateHash);
  assert.equal(ch.takes.length, 3);
  assert.equal(ch.takes.reduce((n, t) => n + t.ticks, 0), whole.take.ticks);
  assert.equal(ch.takes[0].baselineStateHash, whole.take.baselineStateHash);
  assert.equal(ch.takes[2].finalStateHash, whole.take.finalStateHash);
  assert.deepEqual(ch.chapters.map((c) => [c.id, c.fromStep, c.toStep, c.fromTick, c.toTick]), [
    ['out', 0, 2, 0, ch.chapters[0].toTick], ['on', 2, 4, ch.chapters[0].toTick, ch.chapters[1].toTick], ['back', 4, 6, ch.chapters[1].toTick, whole.take.ticks],
  ]);
  const lib = new TakeLibrary();
  for (const t of ch.takes) lib.put(t); // content addresses verify
  for (let k = 1; k < 3; k++) {
    assert.deepEqual(chapterContinuity(ch.takes[k - 1], ch.takes[k]), []);
    assert.equal(ch.takes[k].startTick, ch.takes[k - 1].startTick + ch.takes[k - 1].ticks);
    // a chapter holds only its own steps' lifecycles
    const own = new Set(STEPS.slice(ch.chapters[k].fromStep, ch.chapters[k].toStep).map((s) => `step:${s.id}`));
    assert.ok(ch.takes[k].events.every((e) => e.type !== 'action' || !e.id.startsWith('step:') || own.has(e.id)), JSON.stringify(ch.takes[k].events.slice(0, 3)));
  }
  // the continuity check does catch a break (a chapter paired with the wrong predecessor)
  assert.ok(chapterContinuity(ch.takes[0], ch.takes[2]).length > 0);
  // bound 1 is not a barrier: b1 starts at once, while a1 is still walking
  assert.throws(() => runPlanChapters(start(), 'cp', plan, cfg, 'test', [{ id: 'x', at: 0 }, { id: 'y', at: 1 }]), /not a barrier/);
});

type SetEntry = { id: string; ticks: number; finalStateHash: string; startStateHash: string; chapters: { id: string; take: string; file: string; from: number; to: number; ticks: number }[] };
type Entry = { id: string; file: string; ticks: number; finalStateHash: string; chapter?: { of: string; index: number; id: string; startsFrom: string | null; startHash: string } };
const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '../../public');
const MANIFEST = join(PUBLIC, 'engine/takes/manifest.json');
const manifest = existsSync(MANIFEST) ? (JSON.parse(readFileSync(MANIFEST, 'utf8')) as { takes: Entry[]; otherYears?: Entry[]; chapterSets?: SetEntry[] }) : null;

test('chapter sets in the manifest: the first frame of chapter k is the final state of chapter k − 1 (hash, entities0, replayed first frame); Σ ticks and the last final state are the set\'s; the 2022 east-house A+B ends at its pin', () => {
  const sets = manifest?.chapterSets ?? [];
  assert.ok(sets.length >= 1, 'the manifest has a chapter set');
  const entries = [...(manifest!.takes ?? []), ...(manifest!.otherYears ?? [])];
  for (const set of sets) {
    let prev: Take | null = null;
    let sum = 0;
    for (const [k, c] of set.chapters.entries()) {
      const e = entries.find((x) => x.id === c.take);
      assert.ok(e, `${set.id} chapter ${c.id}: take ${c.take} is a manifest entry`);
      assert.equal(e!.file, c.file);
      const take = (JSON.parse(readFileSync(join(PUBLIC, c.file), 'utf8')) as { take: Take }).take;
      assert.equal(take.id, c.take);
      assert.equal(take.ticks, c.ticks);
      assert.equal(c.to - c.from, c.ticks);
      assert.equal(c.from, sum, `${c.id} starts where the chapters before it end`);
      assert.equal(hashOf(take.finalState), take.finalStateHash);
      assert.deepEqual(e!.chapter, { of: set.id, index: k, id: c.id, startsFrom: prev ? prev.id : null, startHash: take.baselineStateHash });
      if (prev) assert.deepEqual(chapterContinuity(prev, take), [], `${set.id}: chapter ${c.id} does not start where ${set.chapters[k - 1].id} ended`);
      else assert.equal(take.baselineStateHash, set.startStateHash);
      sum += take.ticks;
      prev = take;
    }
    assert.equal(sum, set.ticks);
    assert.equal(prev!.finalStateHash, set.finalStateHash);
  }
  const ab = sets.find((s) => /2022 east-house \(A\+B\)/.test((s as unknown as { label: string }).label));
  assert.ok(ab, 'the 2022 east-house A+B set');
  // year-build-b.test.ts PIN_FULL_AB
  assert.equal(ab!.ticks, 600599);
  assert.equal(ab!.finalStateHash, 'ddb634d6e73d99e679421ceecaaec20a0936643d25dc33845082dd6a4ecdf30a');
});
