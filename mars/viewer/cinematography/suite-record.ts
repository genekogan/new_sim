// Camera-owned demonstration scripts. All actor motion is the existing engine.
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Runtime } from '../engine/runtime/runtime.ts';
import {
  createRegistry,
  servicesFor,
  ENGINE_INVARIANTS,
} from '../engine/api/registry.ts';
import {
  classroomWorld,
  classroomScene,
  classroomParams,
} from '../engine/scenarios/classroom.ts';
import { readClassroom } from '../engine/activities/index.ts';
import { readWorkstation } from '../engine/objects/workstation.ts';
import { SCENARIOS, buildRuntime } from '../app/lab/scenarios.ts';
import { TakeRecorder } from '../engine/take/recorder.ts';
import { Observer, cameraScene } from './observation.ts';
import { Director } from './director.ts';
import type { Observation, Policy } from './types.ts';
import type { ProgramFrame } from './replay.ts';
import type { SpatialScene } from '../engine/spatial/types.ts';

type Case = {
  id: string;
  label: string;
  duration: number;
  window: number;
  scene: SpatialScene;
  rt: Runtime;
  step: (rt: Runtime) => void;
  observe: (rt: Runtime, o: Observation) => void;
  note: string;
};
function classroom() {
  const scene = classroomScene(),
    w = classroomWorld(4);
  return {
    scene,
    rt: new Runtime(
      w,
      createRegistry(),
      servicesFor({ classroom: scene })(w),
      ENGINE_INVARIANTS,
    ),
  };
}
const cases: Case[] = [];
function presentation(id: string, disruption = false) {
  const { scene, rt } = classroom();
  const session = rt.submit('classroom_session', {
    ...classroomParams(),
    talkSeconds: 90,
    questionSeconds: 5,
  });
  cases.push({
    id,
    label: disruption
      ? 'Operator + blocked view'
      : 'Presentation + question + rotation',
    scene,
    rt,
    duration: 50,
    window: 20,
    step(rt) {
      if (rt.tick === 440)
        rt.submit('classroom_control', {
          session: session.id,
          intent: { kind: 'question', actor: 'guest1' },
        });
      if (rt.tick === 600)
        rt.submit('classroom_control', {
          session: session.id,
          intent: { kind: 'advance' },
        });
    },
    observe(rt, o) {
      if (disruption && rt.time >= 24 && rt.time < 32) {
        o.scene = {
          ...o.scene,
          obstacles: [
            ...o.scene.obstacles,
            {
              id: 'camera-only-partition',
              kind: 'wall',
              obb: { c: [2.2, -2.7], half: [0.12, 2.5], yaw: 0 },
              y0: 0,
              y1: 2.5,
            },
          ],
        };
        o.geometryVersion = 1;
      } else o.geometryVersion = rt.time >= 32 ? 2 : 0;
    },
    note: disruption
      ? 'Camera-only partition24–32s; operator guest2 at25–29s. No actor/architecture edits for filming.'
      : 'Actual Lab classroom engine; scripted authoritative question and advance.',
  });
}
presentation('presentation');
{
  const { scene, rt } = classroom();
  const session = rt.submit('classroom_session', {
    ...classroomParams(),
    talkSeconds: 1,
    conversationSeconds: 35,
  });
  cases.push({
    id: 'conversation',
    label: 'Conversation + floor changes + departure',
    scene,
    rt,
    duration: 75,
    window: 38,
    step(rt) {
      if (rt.tick === 960)
        rt.submit('walk_to', { actor: 'guest1', x: -8, z: 11 });
      if (rt.tick === 840)
        rt.submit('walk_to', { actor: 'visitor', x: 7, z: 8 });
    },
    observe(rt, o) {
      const read = readClassroom(rt, session.id),
        g = read?.groups.find((g) => g.status === 'talking');
      if (g) {
        o.activity = {
          ...o.activity,
          phase: 'conversing',
          members: g.members,
          speaker: g.floorHolder,
          focus: g.attentionTarget?.actor,
          presenter: undefined,
          display: undefined,
        };
      }
    },
    note: 'Actual classroom conversation groups and public floor. Visitor approaches vicinity; not a claimed group admission. Guest1 gets authoritative walk departure.',
  });
}
{
  const s = SCENARIOS.find((s) => s.name === 'wall')!,
    rt = buildRuntime(s);
  s.start(rt);
  cases.push({
    id: 'walking',
    label: 'Walking: open space around obstructing wall',
    scene: s.scene(),
    rt,
    duration: 25,
    window: 0,
    step(rt) {
      s.tick?.(rt);
    },
    observe(_rt, o) {
      o.activity = {
        phase: 'walking',
        members: ['p1'],
        focus: 'p1',
        departing: [],
      };
    },
    note: 'Actual Lab wall-avoidance walk. No riding demonstrated in this checkpoint.',
  });
}
{
  const { scene, rt } = classroom();
  rt.submit('work_at', {
    actor: 'worker',
    station: 'workstation',
    seat: 'work-chair#seat',
    duration: 40,
    task: 'camera-demo-notes',
  });
  cases.push({
    id: 'workstation',
    label: 'Person + workstation interaction',
    scene,
    rt,
    duration: 45,
    window: 8,
    step() {},
    observe(rt, o) {
      const s = readWorkstation(rt, 'workstation');
      if (!('code' in s))
        o.activity = {
          phase: s.status === 'active' ? 'working' : s.status,
          members: ['worker'],
          focus: s.user ?? 'worker',
          display: 'workstation',
          departing: [],
        };
    },
    note: 'Actual registered work_at and workstation readout. Other classroom actors idle; no parallel task model.',
  });
}
{
  const s = SCENARIOS.find((s) => s.name === 'campfire-evening')!,
    rt = buildRuntime(s);
  s.start(rt);
  cases.push({
    id: 'simultaneous',
    label: 'Simultaneous gathering, conversation and walkers',
    scene: s.scene(),
    rt,
    duration: 50,
    window: 20,
    step(rt) {
      s.tick?.(rt);
    },
    observe(rt, o) {
      const group =
        rt.time < 27 ? ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'] : ['c1', 'c2'];
      o.activity = {
        phase: rt.time < 27 ? 'arriving' : 'conversing',
        members: group,
        focus: rt.time < 27 ? 'g1' : rt.time < 33 ? 'c1' : 'c2',
        speaker: rt.time < 33 ? 'c1' : 'c2',
        departing: [],
      };
    },
    note: 'Actual Lab campfire concurrent actions. Camera-owned attention/speaker cue at27/33s, labeled synthetic; world never changes with camera policy.',
  });
}
presentation('operator', true);
const out = 'e2e/artifacts/codex-autonomous-camera-suite';
mkdirSync(out, { recursive: true });
const results = cases.map((c) => {
  const recorder = new TakeRecorder(c.rt, {
      rulesVersion: 'camera-suite-live-causal',
      tol: 0,
    }),
    observer = new Observer();
  observer.reset(`suite:${c.id}`);
  const observations: Observation[] = [];
  let previous = '',
    version = 0;
  const session = [...c.rt.records.values()].find(
    (r) => r.verb === 'classroom_session',
  )?.id;
  for (let i = 0; i < c.duration * 20; i++) {
    c.step(c.rt);
    c.rt.step();
    if (i % 2) continue;
    const spatial = c.rt.services.spatial as {
      sync?: (w: typeof c.rt.world) => void;
      scene: SpatialScene;
    };
    spatial.sync?.(c.rt.world);
    const scene = spatial.scene ?? cameraScene(c.rt.world, c.scene);
    const o = observer.read(
      c.rt.world,
      c.rt.tick,
      c.rt.time,
      scene,
      session ? readClassroom(c.rt, session) : undefined,
    );
    c.observe(c.rt, o);
    const fp = JSON.stringify([o.activity, o.geometryVersion]);
    if (fp !== previous) {
      version++;
      previous = fp;
    }
    o.semanticVersion = version;
    observations.push(structuredClone(o));
  }
  const take = recorder.finish(),
    hash = c.rt.stateHash();
  const policies = Object.fromEntries(
    (['clear', 'restrained', 'continuous'] as Policy[]).map((policy) => {
      const d = new Director(policy),
        frames: ProgramFrame[] = [];
      let manual = false,
        released = false;
      for (const o of observations) {
        if (c.id === 'operator' && o.time >= 25 && !manual) {
          d.takeover({ subject: 'guest2', expires: 29 });
          manual = true;
        }
        if (c.id === 'operator' && o.time >= 29 && !released) {
          d.release();
          released = true;
        }
        const p = d.update(o);
        if (p.pose)
          frames.push({
            time: o.time,
            pose: structuredClone(p.pose),
            cut: p.cut,
            shot: p.shot,
          });
      }
      return [
        policy,
        { frames, decisions: d.decisions, diagnostics: d.diagnostics },
      ];
    }),
  );
  if (c.rt.stateHash() !== hash) throw Error('camera.suite-authority-mutated');
  return {
    id: c.id,
    label: c.label,
    note: c.note,
    duration: c.duration,
    window: c.window,
    take,
    scene: c.scene,
    observations,
    policies,
    worldHash: hash,
    violations: c.rt.violations,
    records: [...c.rt.records.values()].map((r) => ({
      verb: r.verb,
      status: r.status,
      diagnostic: r.diagnostic,
    })),
  };
});
writeFileSync(
  `${out}/suite.json`,
  JSON.stringify({
    schema: 'mars-camera-suite/1',
    branch: execFileSync('git', ['branch', '--show-current'], {
      encoding: 'utf8',
    }).trim(),
    commit: execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
    live: false,
    cases: results,
  }),
);
console.log(
  JSON.stringify(
    results.map((c) => ({
      id: c.id,
      violations: c.violations.length,
      records: c.records,
      frames: Object.fromEntries(
        Object.entries(c.policies).map(([k, v]) => [k, v.frames.length]),
      ),
    })),
  ),
);
