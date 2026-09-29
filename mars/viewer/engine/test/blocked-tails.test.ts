import { test } from 'node:test';
import assert from 'node:assert/strict';
import { completionBlockedTails } from '../sequence/blocked-tails.ts';
import type { StepSpec } from '../sequence/types.ts';
import type { StepReport } from '../sequence/runner.ts';
const step = (id: string, extra: Partial<StepSpec> = {}): StepSpec => ({ id, verb: 'mark', params: {}, ...extra });
const reports = (steps: StepSpec[]): StepReport[] => steps.map((s) => ({ id: s.id, verb: s.verb, status: s.id === 'live' ? 'blocked' : 'pending', started: s.id === 'live', blockedTicks: 0, ...(s.id === 'live' ? { actionId: 'action' } : {}) }));
const live = new Set(['action']);
test('tail proof is a fixed point over completion gates; started gates are not completion gates', () => {
  const steps = [step('live'), step('second', { when: { event: 'completed', step: 'first' } }), step('first', { after: ['live'], at: 100 })];
  assert.deepEqual(completionBlockedTails(steps, reports(steps), live), ['first', 'second']);
  for (const extra of [{ at: 100 }, { when: { event: 'started' as const, step: 'live' } }]) {
    const independent = [...steps, step('independent', extra)];
    assert.equal(completionBlockedTails(independent, reports(independent), live), null);
  }
  assert.equal(completionBlockedTails(steps, reports(steps), new Set()), null);
});
test('malformed or unknown dependency graphs cannot certify pending work inert', () => {
  for (const tail of [step('tail', { after: ['live', 'missing'] }), step('tail', { after: ['tail'] }), step('tail', { when: { event: 'unknown' as 'completed', step: 'live' } })]) {
    const steps = [step('live'), tail];
    assert.equal(completionBlockedTails(steps, reports(steps), live), null);
  }
  const duplicate = [step('live'), step('tail', { after: ['live'] }), step('tail', { after: ['live'] })];
  assert.equal(completionBlockedTails(duplicate, reports(duplicate), live), null);
  const cycle = [step('live'), step('a', { after: ['b'] }), step('b', { after: ['a'] })];
  assert.equal(completionBlockedTails(cycle, reports(cycle), live), null);
  cycle[1].after!.push('live');
  assert.equal(completionBlockedTails(cycle, reports(cycle), live), null, 'even a cycle completion-gated by live work is invalid');
  assert.equal(completionBlockedTails([step('live')], [], live), null);
});
