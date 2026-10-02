import { useEffect, useRef, useState } from 'react';
import type { LabSim } from './sim.ts';
import { latestOpenJam } from '../../engine/activities/open-jam.ts';
import { openJamBinding } from '../../engine/scenarios/open-jam.ts';
import { MusicSound } from './music-sound.ts';
export function OpenJamHud({
  sim,
  refresh,
}: {
  sim: LabSim;
  refresh: () => void;
}) {
  const [feedback, setFeedback] = useState(
      'Start open jam, then Play. Enable sound to hear both original scores.',
    ),
    [enabled, setEnabled] = useState(false),
    sound = useRef<MusicSound | null>(null),
    rt = sim.rt;
  useEffect(
    () => () => {
      const prior = sound.current;
      sound.current = null;
      void prior?.dispose();
    },
    [rt],
  );
  if (sim.scenario.name !== 'open-jam') return null;
  const jam = latestOpenJam(rt),
    active = !!jam && rt.isActive(jam.action);
  const command = (command: 'pause' | 'resume' | 'end') => {
    const r = rt.submit('open_jam_control', { jam: jam!.action, command });
    setFeedback(
      r.diagnostic
        ? `${r.diagnostic.code}: ${r.diagnostic.message}`
        : `${command}: retained rounds use ordinary safe physical handoffs.`,
    );
    refresh();
  };
  const audio = async () => {
    if (sound.current) {
      const prior = sound.current;
      sound.current = null;
      setEnabled(false);
      await prior.dispose();
      return;
    }
    try {
      const next = new MusicSound(sim, 'music-computer');
      sound.current = next;
      await next.enable();
      if (sim.rt === rt && sound.current === next) setEnabled(true);
    } catch (error) {
      void sound.current?.dispose();
      sound.current = null;
      setEnabled(false);
      setFeedback(`audio.unavailable: ${String(error)}`);
    }
  };
  return (
    <section className="lab-hud lab-classroom" data-testid="open-jam-hud">
      <h3>Open jam · performer exchange</h3>
      <p>
        Hypothetical sound practice inspired by Open Jacks. Two people take
        turns at the same computer and chair, making original electronic scores.
        Each physically leaves before the next arrives; the listener and floor
        participants have independent departures. This models digital sound
        practice, not acoustic instruments.
      </p>
      <div data-testid="open-jam-readout">
        {jam
          ? `${jam.mode} · round ${Math.min(jam.index + 1, jam.bindings.rounds.length)}/${jam.bindings.rounds.length} · ${jam.bindings.rounds[jam.index]?.actor ?? 'finished'} · ${jam.finished.length} completed`
          : 'Computer and supported chair ready.'}
      </div>
      {jam?.diagnostic && (
        <p role="status">
          {jam.diagnostic.code}: {jam.diagnostic.message}
        </p>
      )}
      <div className="lab-classroom-controls">
        <button onClick={() => void audio()}>
          {enabled ? 'Mute sound' : 'Enable sound'}
        </button>
        <button
          disabled={!!jam}
          onClick={() => {
            const r = rt.submit('open_jam', openJamBinding());
            setFeedback(
              r.diagnostic
                ? `${r.diagnostic.code}: ${r.diagnostic.message}`
                : 'First performer approaching; Play advances the exchange.',
            );
            refresh();
          }}
        >
          Start open jam
        </button>
        <button
          disabled={!active || jam?.mode === 'paused'}
          onClick={() => command('pause')}
        >
          Pause jam
        </button>
        <button
          disabled={!active || jam?.mode !== 'paused'}
          onClick={() => command('resume')}
        >
          Resume jam
        </button>
        <button disabled={!active} onClick={() => command('end')}>
          End jam
        </button>
        <button
          disabled={!active || jam?.mode !== 'playing'}
          onClick={() => {
            const actor = jam!.bindings.rounds[jam!.index].actor,
              r = rt.submit('walk_to', { actor, x: 6, z: -4 });
            setFeedback(
              r.diagnostic
                ? `${r.diagnostic.code}: ${r.diagnostic.message}`
                : `${actor} follows your direction; Resume explicitly returns to the unfinished round.`,
            );
            refresh();
          }}
        >
          Direct current performer away
        </button>
        <button
          disabled={
            !active || !jam?.current || jam.current.mode !== 'gathering'
          }
          onClick={() => {
            const r = rt.submit('music_gathering_control', {
              gathering: jam!.current!.action,
              actor: 'dancer-a',
              command: 'leave',
            });
            setFeedback(
              r.diagnostic
                ? `${r.diagnostic.code}: ${r.diagnostic.message}`
                : 'Dancer safely leaves; this departure remains respected in later rounds.',
            );
            refresh();
          }}
        >
          Leave dance floor
        </button>
      </div>
      <ul>
        {jam?.finished.map((r, i) => (
          <li key={i}>
            {r.actor}: {r.score}, {r.playedSeconds.toFixed(1)}s complete
          </li>
        ))}
      </ul>
      <p role="status">
        {jam?.mode === 'completed'
          ? 'Both scores complete; the same computer and chair remain, all owned resources released.'
          : feedback}
      </p>
      <p>
        Pause jam releases actors while retaining its unfinished purpose. Global
        Pause freezes time. Reset starts a fresh world; active save/load remains
        unsupported. Live camera observes both performers without controlling
        execution.
      </p>
    </section>
  );
}
