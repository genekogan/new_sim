import { useState } from 'react';
import type { LabSim } from './sim.ts';
import { latestGroupWarmup } from '../../engine/activities/group-warmup.ts';
import { groupWarmupBinding } from '../../engine/scenarios/group-warmup.ts';
export function GroupWarmupHud({
  sim,
  refresh,
}: {
  sim: LabSim;
  refresh: () => void;
}) {
  const [feedback, setFeedback] = useState(
    'Start warm-up, then Play. Followers arrive at different times and follow the guide with individual delay.',
  );
  if (sim.scenario.name !== 'group-warmup') return null;
  const rt = sim.rt,
    s = latestGroupWarmup(rt),
    active = !!s && rt.isActive(s.action);
  const begin = (resume: boolean) => {
    const r = rt.submit(
      'group_warmup',
      resume && s
        ? { ...s.bindings, resumeFrom: s.action }
        : groupWarmupBinding(),
    );
    setFeedback(
      r.diagnostic
        ? `${r.diagnostic.code}: ${r.diagnostic.message}`
        : resume
          ? 'Resuming retained instructor timing; departures stay respected.'
          : 'Guide approaching the clear practice floor.',
    );
    refresh();
  };
  const control = (
    command: 'join' | 'leave' | 'pause' | 'end',
    actor?: string,
  ) => {
    const r = rt.submit('group_warmup_control', {
      warmup: s!.action,
      command,
      ...(actor ? { actor } : {}),
    });
    setFeedback(
      r.diagnostic
        ? `${r.diagnostic.code}: ${r.diagnostic.message}`
        : `${actor ?? 'Group'}: ${command}, with safe hand lowering and ordinary resource release.`,
    );
    refresh();
  };
  return (
    <section className="lab-hud lab-classroom" data-testid="group-warmup-hud">
      <h3>Guided standing warm-up</h3>
      <p>
        A hypothetical guide and four followers practise settle, raise, open and
        lower phases on clear flat ground. Individual arrival and response
        delays keep them distinct. Wellness inspiration includes neighbouring
        Bombay community yoga; this is not a historical Mars-organized yoga
        class.
      </p>
      <div data-testid="warmup-readout">
        {s
          ? `${s.status} · ${s.phase} · ${s.elapsed.toFixed(1)}/${4 * s.bindings.phaseDuration * s.bindings.cycles}s`
          : 'Clear practice places ready.'}
      </div>
      <div className="lab-classroom-controls">
        <button disabled={!!s} onClick={() => begin(false)}>
          Start warm-up
        </button>
        <button
          disabled={!active || s?.mode !== 'practice'}
          onClick={() => control('pause')}
        >
          Pause warm-up
        </button>
        <button disabled={active || !s || s.ended} onClick={() => begin(true)}>
          Resume warm-up
        </button>
        <button
          disabled={!active || s?.mode !== 'practice'}
          onClick={() => control('end')}
        >
          End warm-up
        </button>
      </div>
      {s?.participants
        .filter((m) => m.role === 'follower')
        .map((m) => (
          <div key={m.actor} data-testid={`warmup-${m.actor}`}>
            {m.actor}: {m.state} · follows {m.timing.phase}
            <button
              disabled={
                !active ||
                s.mode !== 'practice' ||
                (!!m.child && rt.isActive(m.child))
              }
              onClick={() => control('join', m.actor)}
            >
              Join {m.actor}
            </button>
            <button
              disabled={
                !active ||
                s.mode !== 'practice' ||
                !m.child ||
                !rt.isActive(m.child) ||
                m.withdrawn
              }
              onClick={() => control('leave', m.actor)}
            >
              Leave {m.actor}
            </button>
          </div>
        ))}
      <button
        disabled={!active}
        onClick={() => {
          const r = rt.submit('walk_to', { actor: 'guide', x: 6, z: 4 });
          setFeedback(
            r.diagnostic
              ? `${r.diagnostic.code}: ${r.diagnostic.message}`
              : 'Guide follows your direction after safe lowering; the group retains its unfinished timing.',
          );
          refresh();
        }}
      >
        Direct guide away
      </button>
      <p role="status">
        {s?.diagnostic
          ? `${s.diagnostic.code}: ${s.diagnostic.message}`
          : s?.status === 'completed'
            ? 'Practice complete; hands lowered, all participants and places released.'
            : feedback}
      </p>
      <p>
        Standing arm practice only: feet remain planted after arrival. No
        single-leg balance, floor yoga, stretching certification or active
        save/load. Leave lowers hands in place; a later direction can walk away.
      </p>
    </section>
  );
}
