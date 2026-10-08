// Camera-owned adapter. Existing Lab hooks read data and apply render poses only.
import type { EngineHook } from '../app/lab/hook.ts';
import type { SpatialScene } from '../engine/spatial/types.ts';
import {
  classroomWorld,
  classroomScene,
} from '../engine/scenarios/classroom.ts';
import { Observer, cameraScene } from './observation.ts';
import { Advisory } from './provider.ts';
import { safePose, safetyWorld } from './physical.ts';
import { sweepCrossing } from '../engine/camera/quality.ts';
import type { DirectorProvider, Policy, Observation } from './types.ts';
import { Director } from './director.ts';
import type { ProgramFrame } from './replay.ts';
import { ActivityObserver, activityCameraScenario } from './activity-observation.ts';
import type { CameraEntity, CameraActivityFact } from './activity-observation.ts';
// Optional plumbing checkpoint d98d9e5; released older hooks retain labeled fallback.
type CameraHook = Omit<EngineHook, 'camera' | 'cameraGeometry'> & {
  readonly scenarioEpoch?: number;
  cameraGeometry?: () => unknown;
  camera: (position: number[], target: number[], fov?: number) => unknown;
  cameraEntities?: () => readonly CameraEntity[];
  cameraActivityReadout?: () => { activities: readonly CameraActivityFact[] };
};
export function attachLabCamera(
  hook: CameraHook,
  policy: Policy = 'clear',
  provider?: DirectorProvider,
  options: { document?: Document } = {},
) {
  const viewDocument = options.document ?? document,
    viewWindow = viewDocument.defaultView ?? window;
  const advisory = provider ? new Advisory(provider) : undefined,
    director = new Director(policy),
    observer = new Observer(),
    activityObserver = new ActivityObserver();
  let scenario = hook.state().scenario,
    fixture = classroomWorld(scenario === 'classroom-8' ? 8 : 4),
    scene = cameraScene(fixture, classroomScene()),
    epoch = hook.scenarioEpoch,
    session = 1;
  observer.reset(`camera-review-${scenario}-${session}`);
  activityObserver.reset(observer.session);
  director.reset(observer.session);
  const frames: ProgramFrame[] = [],
    observations: Observation[] = [],
    overhead: number[] = [];
  let raf = 0,
    disposed = false,
    lastWall = -Infinity,
    lastTick = -1,
    lastGeometryEpoch = -1,
    lastAspect = -1,
    controlDirty = true,
    dragging = false,
    manualUntil = -Infinity,
    lastManual: ProgramFrame['pose'] | undefined;
  const label = viewDocument.createElement('div');
  Object.assign(label.style, {
    position: 'fixed',
    bottom: '12px',
    left: '310px',
    padding: '9px 14px',
    color: 'white',
    background: '#16212ddd',
    font: '14px monospace',
    zIndex: '10000',
    pointerEvents: 'none',
  });
  viewDocument.body.appendChild(label);
  const canvas = viewDocument.querySelector('canvas');
  const manualStart = () => {
    controlDirty = true;
    dragging = true;
    lastManual = hook.cameraPose() as ProgramFrame['pose'];
    director.takeover({
      pose: lastManual,
      expires: hook.state().time + 6,
      movement: 'still',
    });
  };
  const manualEnd = () => {
    if (!dragging) return;
    dragging = false;
    manualUntil = performance.now() + 250;
    director.takeover({
      pose: hook.cameraPose() as ProgramFrame['pose'],
      expires: hook.state().time + 6,
      movement: 'still',
    });
  };
  const wheel = () => {
    manualStart();
    dragging = false;
    manualUntil = performance.now() + 250;
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      dragging = false;
      manualUntil = -Infinity;
      director.release();
      controlDirty = true;
    }
  };
  canvas?.addEventListener('pointerdown', manualStart);
  viewWindow.addEventListener('pointerup', manualEnd);
  viewWindow.addEventListener('pointercancel', manualEnd);
  canvas?.addEventListener('wheel', wheel, { passive: true });
  viewWindow.addEventListener('keydown', key);
  const loop = (wall: number) => {
    if (disposed) return;
    raf = viewWindow.requestAnimationFrame(loop);
    const movementDt = Number.isFinite(lastWall) ? (wall - lastWall) / 1000 : 0;
    lastWall = wall;
    const started = performance.now(),
      state = hook.state();
    const runChanged =
      hook.scenarioEpoch !== epoch ||
      state.scenario !== scenario ||
      state.tick < lastTick;
    if (runChanged) {
      epoch = hook.scenarioEpoch;
      scenario = state.scenario;
      fixture = classroomWorld(scenario === 'classroom-8' ? 8 : 4);
      scene = cameraScene(fixture, classroomScene());
      observer.reset(`camera-review-${scenario}-${++session}`);
      activityObserver.reset(observer.session);
      director.reset(observer.session);
      frames.length = 0;
      observations.length = 0;
      overhead.length = 0;
      lastTick = -1;
      lastGeometryEpoch = -1;
      lastAspect = -1;
      controlDirty = true;
      dragging = false;
      manualUntil = -Infinity;
      lastManual = undefined;
    }
    const manualActive = dragging || performance.now() < manualUntil;
    const geometry = hook.cameraGeometry?.() as
      | { scene?: SpatialScene; epoch?: number }
      | undefined;
    const geometryChanged = (geometry?.epoch ?? 0) !== lastGeometryEpoch;
    const aspect =
      canvas && canvas.width > 0 && canvas.height > 0
        ? canvas.width / canvas.height
        : NaN;
    const refreshShot = state.tick !== lastTick || geometryChanged || controlDirty || aspect !== lastAspect;
    if (
      state.tick === lastTick &&
      state.paused &&
      !manualActive &&
      !geometryChanged &&
      !controlDirty &&
      aspect === lastAspect
    )
      return;
    controlDirty = false;
    lastAspect = aspect;
    lastGeometryEpoch = geometry?.epoch ?? 0;
    lastTick = state.tick;
    if (!state.scenario.startsWith('classroom-') && !activityCameraScenario(state.scenario)) {
      label.textContent =
        'camera.unsupported-scenario: choose a supported live activity';
      return;
    }
    let o: Observation;
    if (activityCameraScenario(state.scenario)) {
      if (!hook.cameraEntities || !hook.cameraActivityReadout || !geometry?.scene) {
        label.textContent = 'camera.activity.readout-unavailable: current activity/world hooks required';
        return;
      }
      o = activityObserver.read(hook.cameraEntities(), hook.cameraActivityReadout().activities,
        state.tick, state.time, geometry.scene, geometry.epoch ?? 0, aspect);
      for (const diagnostic of activityObserver.diagnostics) director.note(diagnostic);
    } else {
      for (const h of state.humans) {
        const e = fixture.entities[h.id];
        if (e) {
          e.pose.p = h.p as [number, number, number];
          e.pose.yaw = h.yaw;
          e.human!.activity = h.activity;
        }
      }
      if (geometry?.scene) scene = geometry.scene;
      const screen = scene.obstacles.find((o) => o.id === 'screen');
      if (screen)
        fixture.entities.screen.pose.p = [
          screen.obb.c[0],
          screen.y0,
          screen.obb.c[1],
        ];
      o = observer.read(
        fixture,
        state.tick,
        state.time,
        scene,
        hook.classroom().session,
        geometry?.epoch ?? 0,
        aspect,
      );
    }
    let actualManual: ProgramFrame['pose'] | undefined;
    if (manualActive) {
      const pose = hook.cameraPose() as ProgramFrame['pose'];
      if (
        safePose(o, pose) &&
        (!lastManual ||
          !sweepCrossing(safetyWorld(o), lastManual.position, pose.position))
      ) {
        actualManual = structuredClone(pose);
        lastManual = actualManual;
        director.takeover({
          pose: actualManual,
          expires: o.time + 6,
          movement: 'still',
        });
      } else {
        director.release();
        dragging = false;
        manualUntil = -Infinity;
        director.note('camera.manual-invalid: unsafe orbit pose refused');
        if (lastManual && safePose(o, lastManual))
          hook.camera(lastManual.position, lastManual.target, lastManual.fov);
      }
    }
    const result = refreshShot || manualActive
      ? director.update(o, runChanged ? 0 : movementDt)
      : director.track(o, movementDt),
      request = director.request();
    if (request)
      advisory?.ask(request, wall, (reply, req) => director.accept(reply, req));
    const pose = actualManual ?? result.pose;
    if (pose) {
      if (!manualActive || !actualManual)
        hook.camera(pose.position, pose.target, pose.fov);
      else if (actualManual) director.pose = actualManual;
      frames.push({
        time: o.time,
        pose: structuredClone(pose),
        cut: result.cut,
        shot: result.shot,
      });
    }
    observations.push(structuredClone(o));
    overhead.push(performance.now() - started);
    if (frames.length > 2400) frames.shift();
    if (observations.length > 2400) observations.shift();
    if (overhead.length > 2400) overhead.shift();
    label.textContent = `${director.operator ? 'OPERATOR' : 'AUTO'} · ${policy} · ${result.shot ?? 'NO SAFE VIEW'} · ${result.cut ? 'CUT' : result.reason} · ${geometry?.scene ? 'live geometry' : 'fixed furniture adapter'}`;
  };
  raf = viewWindow.requestAnimationFrame(loop);
  return {
    preferredSubject() {
      return director.observation?.activity.focus ?? director.observation?.activity.members[0];
    },
    takeover(subject: string, seconds = 5) {
      controlDirty = true;
      director.takeover({ subject, expires: hook.state().time + seconds });
    },
    release() {
      controlDirty = true;
      dragging = false;
      manualUntil = -Infinity;
      director.release();
    },
    report() {
      const sorted = [...overhead].sort((a, b) => a - b);
      return {
        policy,
        session: observer.session,
        advisory: advisory
          ? {
              calls: advisory.calls,
              failures: advisory.failures,
              accounting: advisory.accounting,
            }
          : undefined,
        furniture: hook.cameraGeometry
          ? 'live effective geometry'
          : 'released fixed classroom fixture',
        live: true,
        decisions: director.decisions,
        diagnostics: director.diagnostics,
        frames,
        observations,
        overhead: {
          samples: sorted.length,
          meanMs:
            sorted.reduce((a, b) => a + b, 0) / Math.max(1, sorted.length),
          p95Ms: sorted[Math.floor(sorted.length * 0.95)],
          maxMs: sorted.at(-1),
        },
      };
    },
    dispose() {
      disposed = true;
      advisory?.dispose();
      viewWindow.cancelAnimationFrame(raf);
      canvas?.removeEventListener('pointerdown', manualStart);
      canvas?.removeEventListener('wheel', wheel);
      viewWindow.removeEventListener('pointerup', manualEnd);
      viewWindow.removeEventListener('pointercancel', manualEnd);
      viewWindow.removeEventListener('keydown', key);
      label.remove();
    },
  };
}
