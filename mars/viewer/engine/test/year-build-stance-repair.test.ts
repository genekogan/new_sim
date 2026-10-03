import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import type { CampusYearFile } from '../campus/history.ts';
import { loadCampusFile } from '../campus/history-node.ts';
import { compareToCanonical, yearBuildSetup, yearBuildSupportDiagnostic } from '../scenarios/year-build.ts';
import { groupStability, isSupported } from '../construction/rules.ts';
import { rehearse } from '../rehearsal/rehearse.ts';

const LEGACY_SOURCE = 'a0c347e0374b473876c97f536dc44dba42399521:viewer/public/engine/campus-2022.json';
function historicalFile(): CampusYearFile {
  return JSON.parse(execFileSync('git', ['show', LEGACY_SOURCE], { encoding: 'utf8' })) as CampusYearFile;
}

test('byte-verified pre-review7648dbf east-house reports every unsupported skeleton part without acquiring it or abandoning a stance', () => {
  const bytes = readFileSync(new URL('./fixtures/campus-history-pre-review-7648dbf/campus-2022.json', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), 'e21a398fede6e7c02e75374eb4a0003f49c743eba367c7cda2d2cda8f6d0e95e');
  const file = JSON.parse(bytes.toString()) as CampusYearFile;
  assert.equal(file.contentHash, 'f8090a99bc9ed24ab37f096ad2bd37bca49d277ae3d7167e51c711d856d4c479');
  for (const bays of [1, undefined]) {
    const s = yearBuildSetup(2022, 'east-house', file, { bays });
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

// Required historical completion proof (~51 s), alongside the mandatory source-era refusal audit.
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

// This uses the actual public source, independently of the older refusal/pinned
// fixtures. Admission alone is not completion and no new fixed hash is pinned.
for (const bays of [1, undefined]) test(`current public2022 east-house ${bays ? 'first bay' : 'whole skeleton'}: actual completion, canonical identity/support and stance cleanup`, () => {
  const file = loadCampusFile(2022), s = yearBuildSetup(2022, 'east-house', file, { bays });
  assert.equal(s.graph.sceneHash, file.contentHash);
  assert.equal(yearBuildSupportDiagnostic(s.build), null, JSON.stringify(s.build.unplaced));
  assert.equal(s.build.targets.length, bays ? 24 : 66);
  const r = rehearse(s.history, s.workspace, s.plan, s.cfg);
  assert.equal(r.report.status, 'completed', JSON.stringify({ diagnostics: r.report.diagnostics, steps: r.report.steps.filter(p => p.status !== 'completed').slice(0, 3) }));
  assert.deepEqual(r.report.violations, []); assert.equal(r.report.settled, true, r.report.unsettled.join('; '));
  assert.deepEqual(compareToCanonical(r.finalState, s.build).filter(p => !p.ok), []);
  const failureSite = r.report.steps.find(p => p.id === 's0021-climb-stance');
  assert.ok(failureSite, 'the originally reported public failure site is actually executed');
  assert.equal(failureSite.status, 'completed');
  const aloft = new Map<string, string>(), reports = new Map(r.report.steps.map(p => [p.id, p]));
  for (const step of s.plan.steps) {
    const actor = step.params.actor as string;
    if (step.verb === 'climb_stance') {
      assert.ok(!aloft.has(actor), `${step.id}: ${actor} already climbed in ${aloft.get(actor)}`); aloft.set(actor, step.id);
    } else if (step.verb === 'leave_stance') {
      assert.ok(aloft.has(actor), `${step.id}: ${actor} has an owned stance to descend from`);
      assert.equal(reports.get(step.id)!.status, 'completed'); aloft.delete(actor);
    }
  }
  assert.equal(aloft.size, 0);
  for (const target of s.build.targets) {
    const entity = r.finalState.entities[target.node];
    assert.ok(entity, `${target.node}: same canonical part identity`); assert.equal(entity.def, target.def);
    if (target.kind === 'beam') {
      assert.equal(entity.support?.kind, 'connected');
      if (entity.support?.kind === 'connected') {
        assert.equal(entity.support.to.length, 2);
        assert.ok(entity.support.to.every(id => r.finalState.entities[id]?.def === 'upright-16ft-kit'));
      }
      assert.equal(entity.connections?.length, 2);
    } else {
      assert.equal(entity.support?.kind, 'connected', 'ordinary release_support connects standing uprights to stabilizing beams');
      assert.equal(isSupported(r.finalState, entity), true, target.node);
      assert.deepEqual(groupStability(r.finalState, entity).missing, [], target.node);
      if (entity.support?.kind === 'connected') {
        assert.ok(entity.support.to.length > 0);
        assert.ok(entity.support.to.every(id => r.finalState.entities[id]?.def === 'beam-12ft'));
      }
    }
  }
  for (const id of s.build.bindings.crew) {
    assert.equal(r.finalState.entities[id].human!.on, undefined, id);
    assert.equal(r.finalState.entities[id].human!.grip, undefined, id);
    assert.equal(r.finalState.entities[id].human!.task, undefined, id);
  }
  console.log(`[current2022 east-house ${bays ? 'first-bay' : 'whole'}] source ${file.contentHash}, ${s.plan.steps.length}steps, ${r.report.metrics.ticks}ticks, final ${r.report.finalStateHash}`);
});
