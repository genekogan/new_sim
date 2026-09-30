// Actual engine runtime + causal observation sidecar. Re-shot policies have no lookahead.
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Runtime } from '../engine/runtime/runtime.ts';
import {
  createRegistry,
  servicesFor,
  ENGINE_INVARIANTS,
} from '../engine/api/registry.ts';
import { readClassroom } from '../engine/activities/index.ts';
import {
  classroomWorld,
  classroomScene,
  classroomParams,
} from '../engine/scenarios/classroom.ts';
import { TakeRecorder } from '../engine/take/recorder.ts';
import { Observer, cameraScene } from './observation.ts';
import { Director } from './director.ts';
import type { Observation } from './types.ts';
import type { ProgramFrame } from './replay.ts';
const base = classroomScene(),
  w = classroomWorld(4),
  rt = new Runtime(
    w,
    createRegistry(),
    servicesFor({ classroom: base })(w),
    ENGINE_INVARIANTS,
  );
const scene = cameraScene(w, base),
  observer = new Observer();
observer.reset('recorded-classroom-1');
const recorder = new TakeRecorder(rt, {
  rulesVersion: 'camera-review-recorded-classroom',
  tol: 0,
});
const session = rt.submit('classroom_session', {
  ...classroomParams(4),
  talkSeconds: 90,
  questionSeconds: 8,
});
const observations: Observation[] = [];
const events = [];
for (let i = 0; i < 1400; i++) {
  if (i === 500 || i === 700 || i === 900) {
    const intent =
      i === 500
        ? { kind: 'question', actor: 'guest1' }
        : i === 700
          ? { kind: 'depart', actor: 'guest1' }
          : { kind: 'advance' };
    const r = rt.submit('classroom_control', { session: session.id, intent });
    events.push({
      tick: rt.tick,
      intent,
      status: r.status,
      diagnostic: r.diagnostic,
    });
  }
  rt.step();
  if (i % 2 === 0) {
    let o = observer.read(
      rt.world,
      rt.tick,
      rt.time,
      scene,
      readClassroom(rt, session.id),
      rt.time < 58 ? 0 : rt.time < 64 ? 1 : 2,
    );
    // Clearly labeled CAMERA-OWNED moving occluder fixture in filmed view only.
    // It is not part of authoritative take/world and never influences actors.
    if (o.time >= 58 && o.time < 64) {
      o.scene = {
        ...scene,
        obstacles: [
          ...scene.obstacles,
          {
            id: 'camera-fixture-partition',
            label: 'CAMERA-OWNED synthetic moved partition',
            kind: 'wall',
            obb: { c: [2.2, -2.7], half: [0.12, 2.5], yaw: 0 },
            y0: 0,
            y1: 2.5,
          },
        ],
      };
      o = observer.read(
        rt.world,
        rt.tick,
        rt.time,
        o.scene,
        readClassroom(rt, session.id),
        1,
      );
    }
    if (o.time >= 64)
      o = observer.read(
        rt.world,
        rt.tick,
        rt.time,
        scene,
        readClassroom(rt, session.id),
        2,
      );
    observations.push(structuredClone(o));
  }
}
const take = recorder.finish();
const film = (policy: 'clear' | 'restrained') => {
  const d = new Director(policy),
    frames: ProgramFrame[] = [];
  for (const o of observations) {
    const result = d.update(o);
    if (result.pose)
      frames.push({
        time: o.time,
        pose: structuredClone(result.pose),
        cut: result.cut,
        shot: result.shot,
      });
  }
  return { frames, decisions: d.decisions, diagnostics: d.diagnostics };
};
const before = rt.stateHash(),
  clear = film('clear'),
  restrained = film('restrained');
if (rt.stateHash() !== before)
  throw Error('camera mutated authoritative runtime');
const out = 'e2e/artifacts/codex-autonomous-camera-comparison';
mkdirSync(out, { recursive: true });
writeFileSync(
  `${out}/sequence.json`,
  JSON.stringify({
    schema: 'mars-camera-review/1',
    hypothetical: true,
    live: false,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
    branch: execFileSync('git', ['branch', '--show-current'], {
      encoding: 'utf8',
    }).trim(),
    note: 'Actual recorded classroom runtime. Observation sidecar is causal. Synthetic partition58–64s exists ONLY in camera fixture/render, not authoritative take. Recorded activity attention not restored by TakePeople; no replay attention claim.',
    take,
    scene,
    observations,
    policies: { clear, restrained },
    events,
    violations: rt.violations,
    worldHash: before,
  }),
);
console.log(
  JSON.stringify({
    out,
    ticks: take.ticks,
    violations: rt.violations.length,
    clearCuts: clear.decisions.filter((d) => d.cut).length,
    restrainedCuts: restrained.decisions.filter((d) => d.cut).length,
    events,
  }),
);
