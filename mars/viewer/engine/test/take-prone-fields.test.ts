// W32's prone receiver publishes human.proneYaw (the lying body's world heading) and human.phaseK (progress within the
// hand-up phase). TakeRecorder records them as discrete changes (mars-take/4, additive): proneYaw in integer mrad, phaseK
// in integer %; absent fields record nothing, so takes without a prone receiver are byte-identical to before
// (record-campus-take.mjs --check on every manifest take).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashOf } from '../core/hash.ts';
import { Runtime } from '../runtime/runtime.ts';
import { Spatial } from '../spatial/service.ts';
import { emptyWorld, human } from '../world/factory.ts';
import { TakeRecorder } from '../take/recorder.ts';
import { replayFinalState, sampleTake } from '../take/replay.ts';
import { TAKE_SCHEMA } from '../take/types.ts';
import { openGround } from './frame-fixtures.ts';

test('take fields proneYaw (mrad) and phaseK (%): recorded when a prone receiver publishes them, cleared with null, replayed as state; nothing recorded when absent; still mars-take/4', () => {
  const w = emptyWorld('open', openGround());
  w.entities.h = human('h', 0, 0);
  w.entities.k = human('k', 2, 0); // never prone
  const rt = new Runtime(w, new Map(), { spatial: new Spatial(openGround()) }, []);
  const rec = new TakeRecorder(rt, { rulesVersion: 'test' });
  rt.step(); // t 1: nothing prone yet
  const H = rt.world.entities.h.human!;
  H.proneYaw = 0.5;
  H.phaseK = 0;
  rt.step(); // t 2: lies down
  H.phaseK = 0.337;
  rt.step(); // t 3
  delete H.proneYaw;
  delete H.phaseK;
  rt.step(); // t 4: up again
  const take = rec.finish();
  assert.equal(take.schema, TAKE_SCHEMA);
  assert.equal(TAKE_SCHEMA, 'mars-take/4');
  const prone = take.changes.filter((c) => c[2] === 'proneYaw' || c[2] === 'phaseK');
  assert.deepEqual(prone, [[2, 'h', 'proneYaw', 500], [2, 'h', 'phaseK', 0], [3, 'h', 'phaseK', 34], [4, 'h', 'proneYaw', null], [4, 'h', 'phaseK', null]]);
  assert.ok(!take.changes.some((c) => c[1] === 'k' && (c[2] === 'proneYaw' || c[2] === 'phaseK')));
  const at3 = sampleTake(take, 3 * take.dt).entities.h.state;
  assert.equal(at3.proneYaw, 500);
  assert.equal(at3.phaseK, 34);
  const at1 = sampleTake(take, 1 * take.dt).entities.h.state;
  assert.ok(!('proneYaw' in at1) && !('phaseK' in at1));
  assert.equal(hashOf(replayFinalState(take)), take.finalStateHash);
});
