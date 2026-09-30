import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import type { CampusYearFile } from '../campus/history.ts';
import { loadCampusFile } from '../campus/history-node.ts';
import { compareToCanonical, yearBuildSetup, yearBuildSupportDiagnostic } from '../scenarios/year-build.ts';
import { rehearse } from '../rehearsal/rehearse.ts';

const LEGACY_SOURCE = 'a0c347e0374b473876c97f536dc44dba42399521:viewer/public/engine/campus-2022.json';
function historicalFile(): CampusYearFile {
  return JSON.parse(execFileSync('git', ['show', LEGACY_SOURCE], { encoding: 'utf8' })) as CampusYearFile;
}

test('current reconciled east-house reports every unsupported skeleton part without acquiring it or abandoning a stance', () => {
  for (const bays of [1, undefined]) {
    const s = yearBuildSetup(2022, 'east-house', loadCampusFile(2022), { bays });
    const refusal = yearBuildSupportDiagnostic(s.build);
    assert.equal(refusal?.code, 'year-build.unsupported');
    assert.equal(refusal!.subjects!.length, bays ? 3 : 9);
    for (const id of refusal!.subjects!) {
      assert.match(refusal!.message, new RegExp(id));
      assert.ok(!s.plan.steps.some((step) => step.params.piece === id || step.params.item === id || step.params.beam === id), `${id} remains in its material stack`);
    }
    assert.match(refusal!.message, /chiba-12-foot-orange-beam-0684c6e5/);
    assert.match(refusal!.message, /kitchen-12-foot-orange-beam-11ad38b2/);
    // Project each installer's choreography: every next climb is after the ordinary physical descent.
    const aloft = new Map<string, string>();
    for (const step of s.plan.steps) {
      const actor = step.params.actor as string;
      if (step.verb === 'climb_stance') {
        assert.ok(!aloft.has(actor), `${step.id}: ${actor} already climbed in ${aloft.get(actor)}`);
        aloft.set(actor, step.id);
      } else if (step.verb === 'leave_stance') {
        assert.ok(aloft.has(actor), `${step.id}: ${actor} has a stance to descend from`);
        aloft.delete(actor);
      }
    }
    assert.equal(aloft.size, 0, 'every emitted climb has its ordinary descent');
  }
});

test('exact pre-W51 east-house source supports all 66 skeleton parts without changing the historical plan', () => {
  const file = historicalFile();
  assert.equal(file.contentHash, '8b88e6f090c79b92784954787f0329295286d5b6f5e76f0d9d450023da8c49f2');
  const s = yearBuildSetup(2022, 'east-house', file);
  assert.equal(yearBuildSupportDiagnostic(s.build), null);
  assert.equal(s.build.targets.length, 66);
  assert.equal(s.plan.steps.length, 552);
  assert.equal(s.plan.planHash, '84d7d437b5edb5748ca22f5f', 'identical to main before staging preflight');
  assert.equal(yearBuildSetup(2022, 'east-house', file, { bays: 1 }).plan.planHash, 'c70cb7ad61873b7575d1141d');
});

// Required historical completion proof (~51 s), alongside the mandatory current-source refusal audit.
// It does not establish support for the current production source.
test('exact historical source whole skeleton: completion, support, cleanup, unchanged pin', () => {
  const s = yearBuildSetup(2022, 'east-house', historicalFile());
  const r = rehearse(s.history, s.workspace, s.plan, s.cfg);
  assert.equal(r.report.status, 'completed', JSON.stringify(r.report.steps.filter((p) => p.status !== 'completed').slice(0, 3)));
  assert.deepEqual(r.report.violations, []);
  assert.equal(r.report.settled, true, r.report.unsettled.join('; '));
  assert.deepEqual(compareToCanonical(r.finalState, s.build).filter((p) => !p.ok), []);
  for (const id of s.build.bindings.crew) {
    assert.equal(r.finalState.entities[id].human!.on, undefined, id);
    assert.equal(r.finalState.entities[id].human!.grip, undefined, id);
  }
  assert.equal(r.report.metrics.ticks, 117277);
  assert.equal(r.report.finalStateHash, 'd382e4614e8ae157ad971ab7a4cb2b922c4737197006b39b4a209dc0db040617');
});
