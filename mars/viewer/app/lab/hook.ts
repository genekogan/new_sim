// window.__marsEngine: test/automation hook for the Engine Lab (e2e/lab.spec.ts).
import type { LabView, OverlayName } from './lab-view.ts';
import { SCENARIOS } from './scenarios.ts';
import { sequenceRows } from './sequence-hud.tsx';
import { entityCorners } from '../../engine/spatial/service.ts';
import { slotStates } from './overlay-slots.ts';
import { scriptOf } from './campfire-evening.ts';

export type EngineHook = ReturnType<typeof installHook>;

export function installHook(view: LabView, notify: () => void) {
  const sim = view.sim;
  const state = () => {
    const rt = sim.rt;
    return {
      scenario: sim.scenario.name,
      tick: rt.tick,
      time: +rt.time.toFixed(3),
      done: sim.done(),
      paused: sim.paused,
      speed: sim.speed,
      humans: Object.values(rt.world.entities)
        .filter((e) => e.kind === 'human')
        .map((e) => ({ id: e.id, p: e.pose.p.map((x) => +x.toFixed(4)), yaw: +e.pose.yaw.toFixed(4), level: e.human!.level, activity: e.human!.activity, task: e.human!.task ?? null })),
      checks: sim.checks(),
      stats: sim.stats(),
    };
  };
  const hook = {
    get ready() {
      return view.loaded && view.frames >= 3;
    },
    get frames() {
      return view.frames;
    },
    get error() {
      return view.error;
    },
    scenarios: () => SCENARIOS.map((s) => ({ name: s.name, title: s.title, continuous: !!s.continuous })),
    /** Load a scenario (fresh world). Pass { paused: false } to let it play in real time.
     *  Scenarios with async data (year walkabouts) return a Promise of the state. */
    runScenario(name: string, opts: { paused?: boolean; speed?: number } = {}) {
      const go = () => {
        sim.paused = opts.paused ?? true;
        sim.speed = opts.speed ?? sim.speed;
        sim.load(name);
        notify();
        return state();
      };
      const s = SCENARIOS.find((x) => x.name === name);
      return s?.prepare ? s.prepare().then(go) : go();
    },
    /** Static geometry finished loading (year walkabouts: studio Kit scene photos / 2026 GLB). */
    get backdropReady() {
      return view.staticsReady;
    },
    /** The scenario's panel HUD lines (year walkabouts: file size, fetch/parse/build ms). */
    scenarioHud: () => sim.scenario.hud?.(sim.rt) ?? [],
    /** Fast-forward n fixed ticks synchronously (stops at the scenario's tick budget). */
    step(n = 1) {
      sim.stepN(n);
      notify();
      return state();
    },
    /** Step until done or maxTicks; returns final state. */
    runToEnd(maxTicks = 20 * 600) {
      for (let i = 0; i < maxTicks && !sim.done(); i++) sim.step();
      notify();
      return state();
    },
    /** Sequence presets: per-step status/phase/blocked diagnostics, plus the blocked/failed/violation log. */
    sequence: () => ({ steps: sequenceRows(sim), diagnostics: sim.diagnostics.slice() }),
    /** Fast-forward until every named sequence step has `status` (default completed), or done / maxTicks. */
    runUntilSteps(ids: string[], status = 'completed', maxTicks = 20 * 600) {
      const ok = () => {
        const rows = sequenceRows(sim);
        return !!rows && ids.every((id) => rows.find((r) => r.id === id)?.status === status);
      };
      for (let i = 0; i < maxTicks && !ok() && !sim.done(); i++) sim.step();
      notify();
      return { ...state(), reached: ok() };
    },
    /** Components with engine pose, phase, support and world-space box corners (engine entityCorners). */
    components: () =>
      Object.values(sim.rt.world.entities)
        .filter((e) => e.kind === 'component')
        .map((e) => ({ id: e.id, def: e.def, phase: e.phase, support: e.support?.kind, pose: JSON.parse(JSON.stringify(e.pose)), corners: entityCorners(e), rendered: view.components.bounds(e.id) })),
    stateHash: () => sim.rt.stateHash(),
    /** Interaction slots (seats, fire places): claim holder, claimant, occupant, free/claimed/occupied. */
    slots: () => slotStates(sim.rt).map((q) => ({ ...q, p: [+q.p[0].toFixed(4), +q.p[1].toFixed(4)], yaw: +q.yaw.toFixed(4) })),
    /** Social presets: the fired script events (record ids/status/diagnostic) and the scripted diagnostics. */
    social: () => {
      const s = scriptOf(sim.rt);
      if (!s) return null;
      return {
        fired: s.fired.map((f) => ({ id: f.id, label: f.label, tick: f.tick, cancelled: f.cancelled ?? null, recs: f.recs.map((r) => ({ id: r.id, verb: r.verb, status: r.status, phase: r.phase ?? null, code: r.diagnostic?.code ?? null, message: r.diagnostic?.message ?? null })) })),
        notes: s.notes.slice(),
      };
    },
    pause(on = true) {
      sim.paused = on;
      notify();
    },
    setSpeed(x: number) {
      sim.speed = x;
      notify();
    },
    state,
    violations: () => sim.rt.violations.map((v) => ({ ...v })),
    records: () => [...sim.rt.records.values()].map((r) => JSON.parse(JSON.stringify(r))),
    log: () => sim.log.slice(),
    setOverlay(name: OverlayName, on: boolean) {
      view.setOverlay(name, on);
      notify();
    },
    overlays: () => [...view.overlays],
    camera(pos: number[], target: number[]) {
      view.look(pos, target);
    },
    /** Framing presets for a scenario: top-down diagnostic and oblique. */
    cameraPreset(kind: 'top' | 'oblique') {
      view.preset(kind);
    },
    info: () => view.info(),
    perf: () => sim.stats(),
    /** Pose readout per person for the current tick (feet / soles, stair gait, posture, arms vs targets): docs/engineering/POSES.md. */
    bones: (id?: string) => view.poseNow().bones(id),
    /** Stair flights the renderer uses (tread centres along the axis and tread-top heights). */
    stairs: () => view.humans.stairs(),
  };
  (window as { __marsEngine?: unknown }).__marsEngine = hook;
  return hook;
}

export function removeHook() {
  delete (window as { __marsEngine?: unknown }).__marsEngine;
}
