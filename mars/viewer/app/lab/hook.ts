// window.__marsEngine: test/automation hook for the Engine Lab (e2e/lab.spec.ts).
import type { LabView, OverlayName } from './lab-view.ts';
import { SCENARIOS } from './scenarios.ts';

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
    /** Load a scenario (fresh world). Pass { paused: false } to let it play in real time. */
    runScenario(name: string, opts: { paused?: boolean; speed?: number } = {}) {
      sim.paused = opts.paused ?? true;
      sim.speed = opts.speed ?? sim.speed;
      sim.load(name);
      notify();
      return state();
    },
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
  };
  (window as { __marsEngine?: unknown }).__marsEngine = hook;
  return hook;
}

export function removeHook() {
  delete (window as { __marsEngine?: unknown }).__marsEngine;
}
