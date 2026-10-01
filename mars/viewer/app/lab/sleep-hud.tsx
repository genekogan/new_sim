import { useState } from 'react';
import type { LabSim } from './sim.ts';
import { groundSleepFixture } from '../../engine/scenarios/sleep.ts';
import { sleepReadout } from './sleep.ts';
export function SleepHud({ sim, refresh }: { sim: LabSim; refresh: () => void }) {
  const [feedback, setFeedback] = useState('Start sleep and Play. Pause wakes safely; Resume retains elapsed rest.');
  if (!['ground-sleep', 'ground-sleep-rotated'].includes(sim.scenario.name)) return null;
  const rt = sim.rt, state = sleepReadout(rt);
  const active = state && rt.isActive(state.action);
  const rotated = sim.scenario.name === 'ground-sleep-rotated';
  const actor = rotated ? 'visitor' : 'sleeper';
  const companion = rotated ? 'sleeper' : 'visitor';
  const busy = rt.holder(`actor:${actor}`).length > 0;
  const submit = (verb: string, params: unknown) => { const r = rt.submit(verb, params); setFeedback(r.diagnostic ? `${r.diagnostic.code}: ${r.diagnostic.message}` : 'Command accepted; Play advances the same physical execution.'); refresh(); };
  return <section className="lab-hud lab-classroom" data-testid="sleep-hud">
    <h3>Supported ground sleep</h3>
    <p>Hypothetical mat and participants. One free-handed person rests on their stomach and gets up using the current rig. Pause or direction first wakes and releases the physical mat; the unfinished purpose remains. Resume approaches from the actual location. End cleans up and ends it. No elevated bed or active reload restoration; Reset replaces this world.</p>
    <div data-testid="sleep-readout">{state ? `${state.mode} · ${state.elapsed.toFixed(1)}/${state.bindings.duration}s · ${state.remaining.toFixed(1)}s remaining` : 'Not started'}</div>
    {state?.diagnostic && <p role="status">{state.diagnostic.code}: {state.diagnostic.message}</p>}
    <div className="lab-classroom-controls">
      <button disabled={!!active || busy} onClick={() => { const f = groundSleepFixture(rotated ? [2,1] : [0,0], rotated ? 0.63 : 0); submit('sleep', { ...f.p, actor, duration: 18 }); }}>Start sleep</button>
      <button disabled={!active || !state || ['paused','waiting','draining','completed'].includes(state.mode)} onClick={() => submit('sleep_control', { sleep: state!.action, intent: 'pause' })}>Pause sleep</button>
      <button disabled={!active || !state || !['paused','waiting'].includes(state.mode) || busy} onClick={() => submit('sleep_control', { sleep: state!.action, intent: 'resume' })}>Resume same sleep</button>
      <button disabled={!active} onClick={() => submit('sleep_control', { sleep: state!.action, intent: 'end' })}>End sleep</button>
      <button onClick={() => submit('walk_to', { actor, x: -5, z: 3 })}>Direct sleeper away</button>
      <button onClick={() => submit('walk_to', { actor: companion, x: -6, z: -4 })}>Visitor walks past mat</button>
    </div>
    <p role="status">{feedback}</p>
  </section>;
}
